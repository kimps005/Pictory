import { readJsonBody } from "@/lib/http";
import { fallbackParentInsight, parseParentInsightRequest } from "@/lib/parentInsights";
import { generateParentInsight } from "@/lib/story/generate";
import { buildParentInsightPrompt, PARENT_INSIGHT_SYSTEM_PROMPT } from "@/lib/story/insight-prompts";

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request, parseParentInsightRequest);
  if (parsed instanceof Response) return parsed;

  try {
    return Response.json(await generateParentInsight(PARENT_INSIGHT_SYSTEM_PROMPT, buildParentInsightPrompt(parsed)));
  } catch (error) {
    console.error("[/api/insights]", error);
    return Response.json(fallbackParentInsight(parsed));
  }
}
