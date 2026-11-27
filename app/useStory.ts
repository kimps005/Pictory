"use client";

// 동화 진행 로직 전부 (화면 없음).
// 화면(목업)은 이 훅이 돌려주는 값과 함수만 연결하면 된다. 스타일·레이아웃은 마음대로 바꿔도 된다.
//
//   const s = useStory();
//   s.step                 "form" | "loading" | "story" | "card"   지금 어느 화면인지
//   s.error                화면에 그대로 보여줘도 되는 에러 문장 ("" 이면 없음)
//   s.title, s.scenes      동화 제목, 지금까지의 장면 본문(string[])
//   s.choice               지금 고를 수 있는 선택 { prompt, options[2] } (없으면 null)
//   s.isEnding             결말까지 왔으면 true → "부모 카드 보기" 버튼을 보여준다
//   s.card                 부모 카드 (step === "card" 일 때)
//   s.savedMemo            지난 동화에서 저장한 부모 메모 (없으면 "")
//   s.usedFallback         AI가 불안정해서 미리 만든 동화/템플릿이 쓰였으면 true
//   s.start({ age, situation, durationMin, protagonist? })   동화 시작
//   s.pick(option)         선택지 하나를 고른다
//   s.showCard()           부모 카드를 만든다
//   s.saveMemo(text)       부모 메모 저장
//   s.nextStory(memo?)     같은 입력으로 다음 동화 시작 (메모를 이어받는다)
//   s.reset()              처음 화면으로
//
// 서버는 상태를 저장하지 않는다. 이 훅이 장면·선택을 들고 있다가 매 요청에 같이 보낸다.

import { useCallback, useState } from "react";
import { removeKey, useStored, writeRaw, writeRawAndWait } from "@/lib/localStore";
import { useStoryImages } from "./useStoryImages";
import type {
  ChosenChoice,
  ParentCard,
  StoryChoice,
  StoryChoiceOption,
  StoryRequest,
  StorySegment,
} from "@/lib/story/schema";

export type Step = "form" | "loading" | "story" | "card";
export type LoadingPurpose = "story" | "card";
export type StartInput = Omit<StoryRequest, "previousMemo">;

export interface StoryDraft {
  version: 1;
  savedAt: number;
  req: StoryRequest;
  title: string;
  scenes: string[];
  choice: StoryChoice | null;
  chosen: ChosenChoice[];
  isEnding: boolean;
  usedFallback: boolean;
  page: number;
}

// 부모 메모는 사용자(로그인 계정)마다 따로 저장한다.
const memoKey = (user: string) => `story-choice:lastMemo:${user}`;
const draftKey = (user: string) => `story-choice:draft:${user}`;

function parseDraft(raw: string | null): StoryDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoryDraft>;
    if (
      value.version !== 1 || typeof value.savedAt !== "number" || !value.req ||
      typeof value.title !== "string" || !Array.isArray(value.scenes) ||
      !Array.isArray(value.chosen) || typeof value.isEnding !== "boolean" ||
      typeof value.page !== "number"
    ) return null;
    return value as StoryDraft;
  } catch {
    return null;
  }
}

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/story${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "요청에 실패했어요.");
  return data as T;
}

export function useStory(user = "guest") {
  const { images, appendImages, clearImages, setDrawing, hasDrawing } = useStoryImages();
  const draft = parseDraft(useStored(draftKey(user)));
  const [step, setStep] = useState<Step>("form");
  const [loadingPurpose, setLoadingPurpose] = useState<LoadingPurpose>("story");
  const [error, setError] = useState("");
  const [usedFallback, setUsedFallback] = useState(false);

  const [req, setReq] = useState<StoryRequest | null>(null);
  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState<string[]>([]);
  const [choice, setChoice] = useState<StoryChoice | null>(null);
  const [chosen, setChosen] = useState<ChosenChoice[]>([]);
  const [isEnding, setIsEnding] = useState(false);
  const [card, setCard] = useState<ParentCard | null>(null);
  const [resumePage, setResumePage] = useState<number | null>(null);

  const savedMemo = useStored(memoKey(user)) ?? "";

  // 로딩 화면을 띄우고 호출한다. 실패하면 에러 문장을 남기고 backTo 화면으로 돌아간다.
  const run = useCallback(async <T,>(fn: () => Promise<T>, backTo: Step, purpose: LoadingPurpose = "story"): Promise<T | undefined> => {
    setError("");
    setLoadingPurpose(purpose);
    setStep("loading");
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "문제가 생겼어요.");
      setStep(backTo);
    }
  }, []);

  const begin = useCallback(
    async (next: StoryRequest): Promise<boolean> => {
      clearImages();
      setResumePage(null);
      next = { ...next, hasUserDrawing: hasDrawing() };
      setReq(next);
      const seg = await run(() => api<StorySegment>("", next), "form");
      if (!seg) return false;
      removeKey(draftKey(user));
      setReq({ ...next, characterBible: seg.characterBible, supportingCast: seg.supportingCast });
      appendImages(seg, next.protagonist);
      setTitle(seg.title);
      setScenes(seg.scenes.map((s) => s.text));
      setChoice(seg.choice);
      setIsEnding(seg.isEnding);
      setChosen([]);
      setCard(null);
      setUsedFallback(!!seg.fallback);
      setStep("story");
      return true;
    },
    [run, clearImages, hasDrawing, appendImages, user],
  );

  const start = useCallback(
    async (input: StartInput, previousMemo?: string) => {
      const situation = input.situation.trim();
      if (!situation) {
        setError("고민 상황을 입력하거나 골라주세요.");
        return false;
      }
      return begin({
        age: input.age,
        situation,
        durationMin: input.durationMin,
        protagonist: input.protagonist?.trim() || undefined,
        previousMemo: previousMemo?.trim() || undefined,
        recentContext: input.recentContext?.trim() || undefined,
      });
    },
    [begin],
  );

  const pick = useCallback(
    async (option: Pick<StoryChoiceOption, "text"> & { copingType: ChosenChoice["copingType"] }) => {
      if (!req || !choice) return;
      const nextChosen = [...chosen, { prompt: choice.prompt, text: option.text, copingType: option.copingType }];
      const seg = await run(
        () => api<StorySegment>("/continue", { ...req, title, scenesSoFar: scenes, choices: nextChosen }),
        "story",
      );
      if (!seg) return;
      // 조연 설정은 처음 정한 것을 유지하고, 새 인물이 덧붙었을 때만 갱신한다.
      const supportingCast =
        seg.supportingCast && (!req.supportingCast || seg.supportingCast.startsWith(req.supportingCast))
          ? seg.supportingCast
          : req.supportingCast || seg.supportingCast;
      if (supportingCast !== req.supportingCast) setReq({ ...req, supportingCast });
      appendImages({ ...seg, characterBible: req.characterBible || seg.characterBible, supportingCast }, req.protagonist);
      setChosen(nextChosen);
      setScenes((prev) => [...prev, ...seg.scenes.map((s) => s.text)]);
      setChoice(seg.choice);
      setIsEnding(seg.isEnding);
      if (seg.fallback) setUsedFallback(true);
      setStep("story");
    },
    [req, choice, chosen, title, scenes, run, appendImages],
  );

  const showCard = useCallback(async () => {
    if (!req) return;
    const c = await run(
      () =>
        api<ParentCard>("/parent-card", {
          age: req.age,
          situation: req.situation,
          protagonist: req.protagonist,
          title,
          choices: chosen,
        }),
      "story",
      "card",
    );
    if (!c) return;
    setCard(c);
    if (c.fallback) setUsedFallback(true);
    setStep("card");
  }, [req, title, chosen, run]);

  const saveMemo = useCallback(
    (text: string) => writeRaw(memoKey(user), text.trim()),
    [user],
  );

  const saveDraft = useCallback(async (page: number) => {
    if (!req || step !== "story") return false;
    const value: StoryDraft = {
      version: 1,
      savedAt: Date.now(),
      req,
      title,
      scenes,
      choice,
      chosen,
      isEnding,
      usedFallback,
      page: Math.max(0, Math.min(page, scenes.length - 1)),
    };
    try {
      await writeRawAndWait(draftKey(user), JSON.stringify(value));
      return true;
    } catch {
      setError("동화를 DB에 저장하지 못했어요. 연결 상태를 확인해 주세요.");
      return false;
    }
  }, [req, step, title, scenes, choice, chosen, isEnding, usedFallback, user]);

  const resumeDraft = useCallback(() => {
    if (!draft) return false;
    setReq(draft.req);
    setTitle(draft.title);
    setScenes(draft.scenes);
    setChoice(draft.choice);
    setChosen(draft.chosen);
    setIsEnding(draft.isEnding);
    setUsedFallback(draft.usedFallback);
    setCard(null);
    setError("");
    setResumePage(draft.page);
    setStep("story");
    return true;
  }, [draft]);

  const clearDraft = useCallback(() => removeKey(draftKey(user)), [user]);

  // 같은 입력으로 다음 동화를 시작한다. memo를 안 주면 저장된 메모를 쓴다.
  const nextStory = useCallback(
    async (memo?: string) => {
      if (!req) return;
      await begin({ ...req, previousMemo: (memo ?? savedMemo).trim() || undefined });
    },
    [req, begin, savedMemo],
  );

  const reset = useCallback(() => {
    clearImages();
    setStep("form");
    setError("");
  }, [clearImages]);

  return {
    images,
    setDrawing,
    step,
    loadingPurpose,
    error,
    req,
    title,
    scenes,
    choice,
    chosen,
    isEnding,
    card,
    savedMemo,
    draft,
    resumePage,
    usedFallback,
    start,
    pick,
    showCard,
    saveMemo,
    saveDraft,
    resumeDraft,
    clearDraft,
    nextStory,
    reset,
  };
}
