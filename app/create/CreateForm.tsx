"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeKey, useStored, writeRaw } from "@/lib/localStore";
import { EMPTY_CREATE_DRAFT, parseCreateDraft, type CreateDraft } from "@/lib/createDraft";
import { buildRecentStoryContext, cachedStoryGuidance } from "@/lib/parentInsights";
import { PRESETS } from "@/lib/story/presets";
import { MAX_AGE, MAX_DURATION, MIN_AGE, MIN_DURATION } from "@/lib/story/schema";
import { useApp } from "../providers";
import Icon from "../components/Icon";
import { WritingAnimation } from "../components/LoadingAnimation";
import { btnPrimary, chipCls, errorCls, inputCls, Label, Segmented } from "../components/ui";

// 화면에만 보여 주는 추가 예시. PRESETS와 달리 폴백 동화가 없어서 AI 실패 시엔 직접 추가한 고민처럼 다뤄진다.
// (PRESETS를 늘리면 폴백 데이터를 다시 만들어야 하므로 여기 따로 둔다)
const MORE_EXAMPLES = [
  "밤에 혼자 자기 무서워",
  "친구랑 다퉜어",
  "양치하기 싫어",
  "채소 먹기 싫어",
  "엄마랑 떨어지기 싫어",
  "화가 나면 소리 질러",
  "장난감 나누기 싫어",
] as const;
const EXAMPLES: readonly string[] = [...PRESETS, ...MORE_EXAMPLES];

export function CreateForm({ fresh = false }: { fresh?: boolean }) {
  const { s, user, library, pet } = useApp();
  const router = useRouter();

  // 직접 추가한 고민 상황도 사용자 계정에 저장해 다시 고를 수 있게 한다.
  const customKey = `story-choice:situations:${user}`;
  const formKey = `story-choice:create-form:${user}`;
  const customRaw = useStored(customKey);
  const formRaw = useStored(formKey);
  const insightRaw = useStored(`story-choice:insight:${user}`);
  const [form, setForm] = useState<CreateDraft>(() => fresh ? EMPTY_CREATE_DRAFT : parseCreateDraft(formRaw) ?? EMPTY_CREATE_DRAFT);
  const custom = useMemo<string[]>(() => {
    try {
      const v = JSON.parse(customRaw || "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, [customRaw]);
  const [adding, setAdding] = useState(() => !fresh && Boolean(parseCreateDraft(formRaw)?.customSituation));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPointer = useRef<number | null>(null);
  const history = useRef<ImageData[]>([]);
  const historyIndex = useRef(-1);
  const [historyPosition, setHistoryPosition] = useState({ index: -1, length: 0 });
  const hasSketch = Boolean(form.sketchDataUrl);
  const [color, setColor] = useState("#47372f");
  const [eraser, setEraser] = useState(false);
  const [brushSize, setBrushSize] = useState(12);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [localError, setLocalError] = useState("");

  const updateForm = (patch: Partial<CreateDraft>) => {
    const next = { ...form, ...patch };
    setForm(next);
    writeRaw(formKey, JSON.stringify(next));
  };

  useEffect(() => {
    if (!fresh) return;
    removeKey(formKey);
    router.replace("/create/new");
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [fresh, formKey, router]);

  // 저장된 그림은 처음 한 번만 캔버스에 복원한다. 획마다 다시 그리면 되돌리기 기록이 초기화된다.
  const initialSketch = useRef(form.sketchDataUrl);
  useEffect(() => {
    const source = initialSketch.current;
    const canvas = canvasRef.current;
    if (fresh || !source || !canvas) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      history.current = [snapshot];
      historyIndex.current = 0;
      setHistoryPosition({ index: 0, length: 1 });
    };
    image.src = source;
    return () => { active = false; };
  }, [fresh]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * e.currentTarget.width / rect.width, y: (e.clientY - rect.top) * e.currentTarget.height / rect.height };
  };

  const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointer.current !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    if (historyIndex.current < 0) {
      history.current = [ctx.getImageData(0, 0, e.currentTarget.width, e.currentTarget.height)];
      historyIndex.current = 0;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingPointer.current = e.pointerId;
    const { x, y } = point(e);
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    setLocalError("");
  };

  const moveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointer.current !== e.pointerId) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const saveHistory = (ctx: CanvasRenderingContext2D) => {
    const snapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const previous = history.current[historyIndex.current];
    if (previous && !snapshot.data.some((value, index) => value !== previous.data[index])) return;
    const next = history.current.slice(0, historyIndex.current + 1);
    next.push(snapshot);
    if (next.length > 21) next.shift();
    history.current = next;
    historyIndex.current = next.length - 1;
    setHistoryPosition({ index: historyIndex.current, length: next.length });
    const hasInk = snapshot.data.some((value, index) => index % 4 === 3 && value > 0);
    updateForm({ sketchDataUrl: hasInk ? ctx.canvas.toDataURL("image/png") : "" });
  };

  const clearSketch = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      saveHistory(ctx);
    }
    drawingPointer.current = null;
    if (!canvas || !ctx) updateForm({ sketchDataUrl: "" });
  };

  const restoreHistory = (offset: number) => {
    const nextIndex = historyIndex.current + offset;
    const snapshot = history.current[nextIndex];
    const ctx = canvasRef.current?.getContext("2d");
    if (!snapshot || !ctx || drawingPointer.current !== null) return;
    ctx.putImageData(snapshot, 0, 0);
    historyIndex.current = nextIndex;
    setHistoryPosition({ index: nextIndex, length: history.current.length });
    const hasInk = snapshot.data.some((value, index) => index % 4 === 3 && value > 0);
    updateForm({ sketchDataUrl: hasInk ? ctx.canvas.toDataURL("image/png") : "" });
  };

  const endStroke = (pointerId: number) => {
    if (drawingPointer.current !== pointerId) return;
    drawingPointer.current = null;
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) saveHistory(ctx);
  };

  const saveCustom = (list: string[]) => writeRaw(customKey, JSON.stringify(list));

  const addCustom = () => {
    const t = form.customSituation.trim();
    if (!t) return;
    if (!EXAMPLES.includes(t) && !custom.includes(t)) saveCustom([...custom, t].slice(-8));
    updateForm({ situation: t, customSituation: "" });
    setAdding(false);
    setLocalError("");
  };

  const removeCustom = (t: string) => {
    saveCustom(custom.filter((x) => x !== t));
    if (form.situation === t) updateForm({ situation: "" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLock.current) return;
    if (!form.situation.trim()) {
      setLocalError("고민을 고르거나 + 버튼으로 직접 추가해 주세요.");
      return;
    }
    let durationMin: number | undefined;
    if (form.lengthMode === "custom") {
      durationMin = Number(form.durationText);
      if (!Number.isInteger(durationMin) || durationMin < MIN_DURATION || durationMin > MAX_DURATION) {
        setLocalError(`길이는 ${MIN_DURATION}~${MAX_DURATION}분 사이 숫자로 적어 주세요.`);
        return;
      }
    }
    setLocalError("");
    submitLock.current = true;
    setSubmitting(true);
    try {
      let selectedDrawing: File | null = null;
      const canvas = canvasRef.current;
      if (hasSketch && canvas) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("그림을 저장하지 못했어요. 다시 시도해 주세요.");
        selectedDrawing = new File([blob], "protagonist.png", { type: "image/png" });
      }
      s.setDrawing(selectedDrawing);
      const recentContext = [buildRecentStoryContext(library, pet.state.moods), cachedStoryGuidance(insightRaw)]
        .filter(Boolean)
        .join("\n")
        .slice(0, 600);
      // 성공하기 전에는 작성 화면을 유지한다. /read에서 되돌아오면 캔버스가 사라진다.
      const started = await s.start({ age: form.age, situation: form.situation, durationMin, protagonist: form.protagonist, recentContext });
      if (started) {
        removeKey(formKey);
        router.push("/read");
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "동화를 만들지 못했어요. 다시 시도해 주세요.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const error = localError || s.error;

  return (
    <main aria-busy={submitting} className="page-turn mx-auto w-full max-w-md px-4 py-8 md:max-w-5xl md:px-8 md:py-12">
      {submitting && (
        <section role="status" className="flex flex-col items-center gap-6 rounded-2xl border border-line bg-surface px-6 py-24 text-center">
          <WritingAnimation />
          <p className="story text-xl text-ink">동화를 쓰고 있어요</p>
        </section>
      )}
      {s.draft && (
        <section className="mt-6 rounded-2xl border border-accent/35 bg-[#fff7e9] p-4 sm:p-5" aria-label="저장한 동화">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="story text-lg text-ink">이어서 읽을 동화</h2>
              <p className="mt-1 truncate text-sm text-ink-2">{s.draft.title}</p>
              <p className="mt-1 text-xs text-ink-3">{s.draft.scenes.length}쪽까지 읽음 · {new Date(s.draft.savedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} 저장</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => router.push("/read")} className="calm rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90">이어서 보기</button>
              <button type="button" onClick={s.clearDraft} className="calm rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink-2 hover:bg-sunk">삭제</button>
            </div>
          </div>
        </section>
      )}

      {!submitting && error && (
        <p role="alert" className={errorCls}>
          {error}
        </p>
      )}

      {/* 숨기기만 해서 생성 실패 시 선택값, 캔버스, 되돌리기 기록을 모두 유지한다. */}
      <form hidden={submitting} onSubmit={submit} className={`space-y-6 ${error ? "mt-6" : ""}`}>
        <div className="grid gap-8 rounded-2xl border border-line bg-[#fbf2de] p-5 shadow-[0_6px_20px_rgba(20,15,40,0.28)] md:grid-cols-2 md:gap-10 md:p-7">
        <section className="space-y-4">
          <h2 className="story text-xl text-ink">요즘 아이의 마음은</h2>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((p) => (
              <button key={p} type="button" onClick={() => updateForm({ situation: p })} className={chipCls(form.situation === p)}>
                {p}
              </button>
            ))}

            {custom.map((c) => (
              <span
                key={c}
                className={`calm inline-flex min-h-10 items-center rounded-lg border text-[15px] ${
                  form.situation === c ? "border-accent bg-[#fdf0d2] text-ink" : "border-line bg-surface text-ink-2"
                }`}
              >
                <button type="button" onClick={() => updateForm({ situation: c })} className="px-3 py-2 text-left hover:text-ink">
                  {c}
                </button>
                <button
                  type="button"
                  onClick={() => removeCustom(c)}
                  aria-label={`${c} 삭제`}
                  className="calm mr-1 inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-sunk hover:text-ink"
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}

            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
              aria-label="고민 직접 추가"
              className="calm inline-flex h-10 items-center gap-1 rounded-lg border border-dashed border-ink-3/50 px-3 text-[15px] text-ink-2 hover:border-accent hover:bg-sunk hover:text-ink"
            >
              <Icon name="plus" size={16} />
              직접 추가
            </button>
          </div>

          {adding && (
            <div className="flex gap-2">
              <input
                value={form.customSituation}
                onChange={(e) => updateForm({ customSituation: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault(); // 이야기 만들기가 아니라 칩 추가만 한다
                    addCustom();
                  }
                }}
                maxLength={100}
                autoFocus
                aria-label="추가할 고민"
                placeholder="예: 머리 감기 싫어 (아이 이름은 적지 마세요)"
                className="calm h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-3 focus:border-accent-text"
              />
              <button
                type="button"
                onClick={addCustom}
                disabled={!form.customSituation.trim()}
                className="calm h-10 shrink-0 rounded-lg bg-ink px-4 text-[15px] text-paper hover:opacity-90 disabled:opacity-40"
              >
                추가
              </button>
            </div>
          )}
        </section>

        <section className="space-y-6">
          <h2 className="story text-xl text-ink">동화 설정</h2>

          <div className="space-y-2">
            <Label>아이 나이</Label>
            <div>
              <Segmented
                label="아이 나이"
                value={form.age}
                onChange={(age) => updateForm({ age })}
                options={Array.from({ length: MAX_AGE - MIN_AGE + 1 }, (_, i) => MIN_AGE + i).map((a) => ({
                  value: a,
                  label: a === MIN_AGE ? `~${a}세` : a === MAX_AGE ? `${a}세~` : `${a}세`, // 칸이 좁아 양 끝은 짧게
                }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>길이</Label>
            <div className="flex items-center gap-2">
              <Segmented
                label="동화 길이"
                value={form.lengthMode}
                onChange={(lengthMode) => updateForm({ lengthMode })}
                options={[
                  { value: "auto" as const, label: "자동" },
                  { value: "custom" as const, label: "직접 정하기" },
                ]}
              />
              {form.lengthMode === "custom" && (
                <label className="flex shrink-0 items-center gap-1">
                  <span className="w-16">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.durationText}
                    onChange={(e) => updateForm({ durationText: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
                    aria-label="동화 길이(분)"
                    className={`${inputCls} h-12 py-0 text-center tabular-nums`}
                  />
                  </span>
                  <span className="text-[15px] text-ink">분</span>
                </label>
              )}
            </div>
            <div className="grid text-[13px] text-ink-3">
              <p className={`col-start-1 row-start-1 ${form.lengthMode === "custom" ? "invisible" : ""}`} aria-hidden={form.lengthMode === "custom"}>
                AI가 이야기에 맞춰 길이를 정해요. 최대 {MAX_DURATION}분까지 걸릴 수 있어요.
              </p>
              <p className={`col-start-1 row-start-1 ${form.lengthMode === "auto" ? "invisible" : ""}`} aria-hidden={form.lengthMode === "auto"}>
                {MIN_DURATION}~{MAX_DURATION}분 사이로 적어 주세요
              </p>
            </div>
          </div>

        </section>
        </div>

        <section className="space-y-5 rounded-2xl border border-line bg-[#fbf2de] p-5 shadow-[0_6px_20px_rgba(20,15,40,0.28)] md:p-7">
          <label className="block space-y-2">
            <Label>주인공 이름</Label>
            <input
              value={form.protagonist}
              onChange={(e) => updateForm({ protagonist: e.target.value })}
              maxLength={50}
              placeholder="예: 파란 토끼 (비워도 돼요)"
              className={inputCls}
            />
          </label>
          <div className="space-y-3">
            <div>
              <span className="block text-sm text-ink">주인공을 그려 보세요 (선택)</span>
              <p className="mt-1 text-sm text-ink-3">손가락이나 마우스로 자유롭게 그려 주세요.</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="그림 색상">
              {[["#47372f", "갈색"], ["#e66558", "빨강"], ["#f5a623", "주황"], ["#e7c53b", "노랑"], ["#63a873", "초록"], ["#5c8ec7", "파랑"], ["#a47bc0", "보라"]].map(([value, name]) => (
                <button key={value} type="button" aria-label={name} aria-pressed={!eraser && color === value} onClick={() => { setColor(value); setEraser(false); }}
                  className={`size-8 rounded-full border-2 ${!eraser && color === value ? "border-ink ring-2 ring-accent ring-offset-2" : "border-white"}`}
                  style={{ backgroundColor: value }} />
              ))}
              <button type="button" aria-label="지우개" title="지우개" aria-pressed={eraser} onClick={() => setEraser(true)} className={`flex size-8 items-center justify-center rounded-full border-2 ${eraser ? "border-ink bg-[#fdf0d2] text-ink ring-2 ring-accent ring-offset-2" : "border-line bg-surface text-ink-2"}`}>
                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8.5 20 3.8 15.3a2 2 0 0 1 0-2.8l8.7-8.7a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L12 20" />
                  <path d="M7 10.5 14.5 18" />
                  <path d="M8.5 20H21" />
                </svg>
              </button>
            </div>
            <label className="flex w-40 items-center gap-2 text-sm text-ink-2">
              <span className="shrink-0">선 굵기</span>
              <input type="range" min="4" max="40" step="2" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="min-w-0 flex-1 accent-amber-600" />
              <span className="w-6 text-right tabular-nums">{brushSize}</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto" role="group" aria-label="그림 작업 기록">
              <button type="button" onClick={() => restoreHistory(-1)} disabled={historyPosition.index <= 0} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 disabled:opacity-40">↶ 되돌리기</button>
              <button type="button" onClick={() => restoreHistory(1)} disabled={historyPosition.index < 0 || historyPosition.index >= historyPosition.length - 1} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 disabled:opacity-40">↷ 다시 실행</button>
            </div>
              <button type="button" onClick={clearSketch} disabled={!hasSketch} className="text-sm text-ink-2 underline underline-offset-4 disabled:opacity-40">다시 그리기</button>
            </div>
            <div className="sketchbook">
            <canvas ref={canvasRef} width={1200} height={800} aria-label="주인공 그림판" onPointerDown={startStroke} onPointerMove={moveStroke}
              onPointerUp={(e) => endStroke(e.pointerId)}
              onPointerCancel={(e) => endStroke(e.pointerId)}
              onLostPointerCapture={(e) => endStroke(e.pointerId)}
              className="sketchbook-paper block aspect-[3/2] w-full touch-none" />
            </div>
          </div>
        </section>

        <div className="md:flex md:justify-center">
          <button type="submit" disabled={submitting} className={`${btnPrimary} md:w-64 disabled:opacity-50`}>
            동화 만들기
          </button>
        </div>
      </form>
    </main>
  );
}
