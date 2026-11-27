import { readJsonBody } from "@/lib/http";
import { generateSegment } from "@/lib/story/generate";
import { buildContinuePrompt } from "@/lib/story/prompts";
import { fallbackContinue } from "@/lib/story/fallback";
import { parseContinueRequest } from "@/lib/story/validate";

// POST /api/story/continue  — 아이의 선택을 반영해 이야기 이어쓰기
// body: { age, situation, durationMin?(1~10, 없으면 자동), protagonist?, previousMemo?, title, scenesSoFar: string[], choices: ChosenChoice[] }
//  - choices가 1개면: 장면 2~3개 + 두 번째 선택을 돌려준다
//  - choices가 2개면: 결말 장면 2~3개를 돌려준다 (choice: null, isEnding: true)
// 응답: StorySegment (lib/story/schema.ts)

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request, parseContinueRequest);
  if (parsed instanceof Response) return parsed;

  try {
    return Response.json(await generateSegment(buildContinuePrompt(parsed)));
  } catch (e) {
    console.error("[/api/story/continue]", e);
    const fb = fallbackContinue(parsed); // 폴백 동화로 시작한 이야기만 이어갈 수 있다
    if (fb) return Response.json(fb);
    return Response.json({ error: "이야기를 이어가지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
