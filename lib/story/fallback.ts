import data from "./fallback-data.json";
import type {
  ContinueRequest,
  ParentCard,
  ParentCardRequest,
  StoryRequest,
  StorySegment,
} from "./schema";

// AI(Gemini)가 실패하거나 느릴 때 쓰는 안전망.
//  - 동화: 프리셋 상황 4개는 미리 만들어 둔 분기 동화를 준다. (선택지 id a/b에 따라 갈라지는 7구간)
//  - 부모 카드: 아이가 실제로 고른 선택을 끼워 넣는 템플릿으로 만든다. 어떤 입력에도 동작한다.
// 라우트가 AI 호출에 실패했을 때만 부른다. 결과에는 fallback: true가 붙는다.

interface FallbackStory {
  start: StorySegment;
  mid: Record<"a" | "b", StorySegment>;
  end: Record<"aa" | "ab" | "ba" | "bb", StorySegment>;
}

const stories = data as unknown as Record<string, FallbackStory>;

// 프리셋 문구와 정확히 같거나, 직접 입력한 문장에 핵심 단어가 들어 있으면 해당 폴백 동화를 쓴다.
const KEYWORDS: [string, string][] = [
  ["치과", "치과가 무서워"],
  ["어린이집", "어린이집 가기 싫어"],
  ["동생", "동생이 생겼어"],
  ["주사", "병원 주사가 무서워"],
  ["병원", "병원 주사가 무서워"],
];

function findStory(situation: string): FallbackStory | undefined {
  const s = situation.trim();
  if (stories[s]) return stories[s];
  const hit = KEYWORDS.find(([k]) => s.includes(k));
  return hit ? stories[hit[1]] : undefined;
}

function optionId(seg: StorySegment, text: string): "a" | "b" | undefined {
  const id = seg.choice?.options.find((o) => o.text === text)?.id;
  return id === "a" || id === "b" ? id : undefined;
}

const REFRAIN = "콩닥콩닥, 괜찮아 괜찮아.";

function withoutRepeatedRefrain(seg: StorySegment, previousScenes: string[] = []): StorySegment {
  let kept = previousScenes.some((scene) => scene.includes(REFRAIN)) ? 1 : 0;
  const scenes = seg.scenes.map((scene) => {
    let text = scene.text;
    const first = text.indexOf(REFRAIN);
    if (first >= 0 && kept === 0) {
      kept = 1;
      text = text.slice(0, first + REFRAIN.length) + text.slice(first + REFRAIN.length).replaceAll(REFRAIN, "");
    } else {
      text = text.replaceAll(REFRAIN, "");
    }
    return { ...scene, text: text.replace(/[\t ]{2,}/g, " ").replace(/ ([,.!?])/g, "$1").trim() };
  });
  return { ...seg, scenes };
}

const mark = (seg: StorySegment, previousScenes: string[] = []): StorySegment => ({
  ...withoutRepeatedRefrain(seg, previousScenes),
  fallback: true,
});

export function fallbackStart(req: StoryRequest): StorySegment | undefined {
  const story = findStory(req.situation);
  return story ? mark(story.start) : undefined;
}

// 폴백 동화의 시작 장면을 받아 온 경우에만 이어갈 수 있다. (제목과 선택 문장이 같아야 한다)
// AI가 만든 시작 뒤에 AI가 실패하면 undefined를 돌려주고, 라우트는 에러를 낸다.
export function fallbackContinue(req: ContinueRequest): StorySegment | undefined {
  const story = findStory(req.situation);
  if (!story || story.start.title !== req.title) return undefined;

  const first = optionId(story.start, req.choices[0].text);
  if (!first) return undefined;
  if (req.choices.length === 1) return mark(story.mid[first], req.scenesSoFar);

  const second = optionId(story.mid[first], req.choices[1].text);
  if (!second) return undefined;
  return mark(story.end[`${first}${second}` as "aa" | "ab" | "ba" | "bb"], req.scenesSoFar);
}

// 받침 유무에 따라 조사를 고른다. (한글이 아니면 받침 없는 것으로 본다)
function particle(word: string, withBatchim: string, without: string): string {
  const w = word.trim();
  const code = w.charCodeAt(w.length - 1);
  const has = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return has ? withBatchim : without;
}

const josa = (word: string, withBatchim: string, without: string) => `${word}${particle(word, withBatchim, without)}`;

const FIRST_CHOICE_HINT: Record<string, string> = {
  도움요청: "곁에 있어 주면 든든하다는 마음을 먼저 \"그랬구나, 같이 있고 싶었구나\" 하고 받아주세요.",
  스스로진정: "스스로 마음을 달래 보려 한 것을 \"혼자 해보려고 했구나\" 하고 알아봐 주세요.",
  회피: "피하고 싶은 마음을 다그치지 말고 \"그만큼 무서웠구나\" 하고 먼저 받아주세요.",
  직면: "용기를 내 보려는 마음을 \"해보고 싶었구나\" 하고 먼저 받아주세요.",
};

export function fallbackParentCard(req: ParentCardRequest): ParentCard {
  const who = req.protagonist?.trim() || "주인공";
  const [first, second] = req.choices;
  const picked = req.choices.map((c) => `'${c.text}'(${c.copingType})`).join("와 ");

  return {
    summary: `${req.title} 이야기에서 ${picked}를 골랐어요.`,
    questions: [
      {
        text: `이야기 속 ${who}한테 제일 힘든 순간은 언제였을까?`,
        hint: "아이가 대답하면 \"그랬구나\" 하고 먼저 받아주세요.",
      },
      {
        text: `이야기에서 "${first.text}"를 골랐는데, 그때 어떤 마음이었어?`,
        hint: FIRST_CHOICE_HINT[first.copingType] ?? "아이가 직접 떠올린 방법이니, 어떤 마음이었는지 \"그랬구나\" 하고 먼저 받아주세요.",
      },
      {
        text: second
          ? `"${second.text}"${particle(second.text, "은", "는")} ${josa(who, "이", "가")} 다음에 또 이런 일이 생기면 어떻게 쓰면 좋을까?`
          : `다음에 또 이런 일이 생기면 ${josa(who, "은", "는")} 어떻게 하면 좋을까?`,
        hint: "아이가 스스로 떠올린 방법을 기다려 주고, 어떤 대답이든 칭찬해 주세요.",
      },
    ],
    answerTip: "아이가 말로 하기 어려워하면 좋아하는 인형을 주인공 삼아 대신 말하게 하거나 그림으로 그려 보게 해 주세요.",
    fallback: true,
  };
}
