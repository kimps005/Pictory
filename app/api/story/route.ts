import { readJsonBody } from "@/lib/http";
import { generateSegment } from "@/lib/story/generate";
import { buildStartPrompt } from "@/lib/story/prompts";
import { fallbackStart } from "@/lib/story/fallback";
import { parseStoryRequest } from "@/lib/story/validate";

// POST /api/story  — 이야기 시작 (장면 + 첫 선택)
// body: { age, situation, durationMin?(1~10, 없으면 자동), protagonist?, previousMemo? }
// 응답: StorySegment (lib/story/schema.ts)

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request, parseStoryRequest);
  if (parsed instanceof Response) return parsed;

  try {
    return Response.json(await generateSegment(buildStartPrompt(parsed)));
  } catch (e) {
    console.error("[/api/story]", e);
    const fb = fallbackStart(parsed); // AI 실패 시 미리 만든 동화
    if (fb) return Response.json(fb);
    return Response.json({ error: "이야기를 만들지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
