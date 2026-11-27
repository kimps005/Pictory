import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { fetchCloudflareImage, ImageUpstreamError } from "@/lib/image/image-upstream";
import { DEFAULT_IMAGE_MODEL, isImageModel } from "@/lib/image/image-models";
import { composeDrawing, drawingReference, prepareDrawing } from "@/lib/image/compose-drawing";
import { fallbackBackground } from "@/lib/image/fallback-background";
import { checkProtagonist, type ProtagonistCheck } from "@/lib/image/verify-protagonist";
import sharp from "sharp";

export const maxDuration = 120;

const clampSize = (value: FormDataEntryValue | null) => {
  const size = Number(value || 512);
  return String(Number.isFinite(size) ? Math.min(512, Math.max(256, size)) : 512);
};

export async function POST(request: Request) {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  try {
    const incoming = await request.formData();
    const selectedModel = String(incoming.get("model") || DEFAULT_IMAGE_MODEL);
    if (!isImageModel(selectedModel)) return NextResponse.json({ error: "지원하지 않는 이미지 모델입니다.", errorCode: "IMAGE_MODEL_INVALID" }, { status: 400 });
    if (!accountId || !apiToken)
      return NextResponse.json({ error: "Cloudflare 계정과 API 토큰 설정을 확인해 주세요.", errorCode: "CLOUDFLARE_CREDENTIALS_MISSING" }, { status: 503 });
    const prompt = String(incoming.get("prompt") || "").trim();
    const mode = String(incoming.get("mode") || "text");
    if (!prompt) return NextResponse.json({ error: "이미지 프롬프트를 입력하세요.", errorCode: "IMAGE_PROMPT_REQUIRED" }, { status: 400 });
    if (!["text", "character", "scene", "drawing-scene", "drawing-composite"].includes(mode)) return NextResponse.json({ error: "지원하지 않는 이미지 생성 방식입니다.", errorCode: "IMAGE_MODE_INVALID" }, { status: 400 });
    const composite = mode === "drawing-composite";
    const drawingScene = mode === "drawing-scene";

    if (mode === "drawing-scene" || composite) {
      const drawing = incoming.get("image_0");
      if (!(drawing instanceof File) || drawing.size === 0) {
        return NextResponse.json({ error: "주인공 그림이 전달되지 않았어요. 그림을 다시 선택해 주세요.", errorCode: "DRAWING_REFERENCE_REQUIRED" }, { status: 400 });
      }
      if ([1, 2, 3].some((index) => incoming.has(`image_${index}`))) {
        return NextResponse.json({ error: "직접 그린 주인공은 원본 그림 한 장만 참조해야 합니다.", errorCode: "DRAWING_REFERENCE_CONFLICT" }, { status: 400 });
      }
    }

    const form = new FormData();
    let referenceCount = 0;
    let referenceHash = "";
    const references: File[] = [];
    form.set("prompt", prompt);
    form.set("width", clampSize(incoming.get("width")));
    form.set("height", clampSize(incoming.get("height")));
    for (let index = 0; index < 4; index += 1) {
      const reference = incoming.get(`image_${index}`) || (index === 0 ? incoming.get("image") : null);
      if (!(reference instanceof File) || reference.size === 0) continue;
      if (!["image/png", "image/jpeg"].includes(reference.type)) return NextResponse.json({ error: "PNG 또는 JPG 참고 이미지만 사용할 수 있습니다.", errorCode: "IMAGE_FILE_INVALID" }, { status: 400 });
      if (reference.size > (composite || drawingScene ? 10 : 5) * 1024 * 1024) return NextResponse.json({ error: `참고 이미지는 ${composite || drawingScene ? 10 : 5}MB 이하로 줄여 주세요.`, errorCode: "IMAGE_FILE_TOO_LARGE" }, { status: 413 });
      if (!composite && !drawingScene) form.set(`input_image_${index}`, reference, reference.name || `reference-${index}.png`);
      references.push(reference);
      referenceCount += 1;
      if (index === 0) referenceHash = createHash("sha256").update(Buffer.from(await reference.arrayBuffer())).digest("hex");
    }

    let preparedDrawing: Buffer | undefined;
    let referencePng: Buffer | undefined;
    if (composite || drawingScene) {
      try { preparedDrawing = await prepareDrawing(references[0]); }
      catch (error) {
        const empty = error instanceof Error && error.message === "DRAWING_EMPTY";
        return NextResponse.json({ error: empty ? "그림에서 주인공을 찾지 못했어요. 흰 배경 위에 선이나 색으로 주인공을 그려 주세요." : "원본 그림을 읽지 못했어요. PNG 또는 JPG 파일을 다시 선택해 주세요.",
          errorCode: empty ? "DRAWING_EMPTY" : "IMAGE_FILE_INVALID", requestId }, { status: 400 });
      }
      // The model sees only the cleaned character on plain white paper, so it
      // never confuses photo paper/table edges with the scene or the character.
      if (drawingScene) {
        referencePng = await drawingReference(preparedDrawing);
        form.set("input_image_0", new File([new Uint8Array(referencePng)], "protagonist.png", { type: "image/png" }));
        // A previous, verified page of the same book keeps style and supporting cast consistent.
        // It is a secondary reference only; the identity always comes from input_image_0.
        const sceneRef = incoming.get("scene_ref");
        if (sceneRef instanceof File && sceneRef.size > 0) {
          if (!["image/png", "image/jpeg"].includes(sceneRef.type) || sceneRef.size > 10 * 1024 * 1024)
            return NextResponse.json({ error: "이전 장면 참고 이미지 형식이 올바르지 않아요.", errorCode: "IMAGE_FILE_INVALID" }, { status: 400 });
          form.set("input_image_1", sceneRef, "previous-page.png");
        }
      }
    }
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId!)}/ai/run/${encodeURI(selectedModel)}`;
    const generate = (body: FormData) => fetchCloudflareImage(endpoint, apiToken!, body, request.signal);
    let result: { bytes: Buffer; mime: string; attempts: number; rayId?: string };
    let backgroundSource = "generated";
    let fallbackReason = "";
    let protagonistCheck: ProtagonistCheck | "composite" | "n/a" = drawingScene ? "unchecked" : "n/a";
    let pasteDrawing = false;
    try {
      result = await generate(form);
      if (drawingScene) {
        // Image models sometimes ignore the drawing and invent a new hero. Verify, retry once,
        // and if it still fails, paint a background plate and paste the child's own drawing.
        protagonistCheck = await checkProtagonist(referencePng!, result.bytes, result.mime, request.signal);
        if (protagonistCheck === "fail") {
          const retryPrompt = String(incoming.get("retryPrompt") || "").trim();
          if (retryPrompt) form.set("prompt", retryPrompt);
          result = await generate(form);
          protagonistCheck = await checkProtagonist(referencePng!, result.bytes, result.mime, request.signal);
        }
        if (protagonistCheck === "fail") {
          const backgroundPrompt = String(incoming.get("backgroundPrompt") || "").trim();
          pasteDrawing = true;
          protagonistCheck = "composite";
          if (backgroundPrompt) {
            const plate = new FormData();
            plate.set("prompt", backgroundPrompt);
            plate.set("width", String(form.get("width"))); plate.set("height", String(form.get("height")));
            result = await generate(plate);
            backgroundSource = "plate";
          } else {
            result = { ...result, bytes: await fallbackBackground(prompt), mime: "image/png" };
            backgroundSource = "local-fallback";
          }
        }
      }
    } catch (error) {
      const recoverable = ["IMAGE_QUOTA_EXCEEDED", "IMAGE_SERVICE_UNAVAILABLE", "IMAGE_SERVICE_BUSY",
        "IMAGE_UPSTREAM_TIMEOUT", "IMAGE_REQUEST_TIMEOUT", "IMAGE_NETWORK_ERROR"];
      if (!(composite || drawingScene) || !(error instanceof ImageUpstreamError) || !recoverable.includes(error.errorCode)) throw error;
      backgroundSource = "local-fallback";
      fallbackReason = error.errorCode;
      if (drawingScene) protagonistCheck = "composite";
      console.warn("image_background_fallback", { requestId, upstreamCode: error.upstreamCode,
        upstreamStatus: error.upstreamStatus, errorCode: error.errorCode, rayId: error.rayId });
      result = { bytes: await fallbackBackground(prompt), mime: "image/png", attempts: error.attempts, rayId: error.rayId };
    }
    // When the model could not draw the drawn hero, paste the original character instead.
    const pasted = composite || (drawingScene && (backgroundSource === "local-fallback" || pasteDrawing));
    const scale = Number(incoming.get("drawingScale") || 1);
    // 참고 이미지 입력은 PNG/JPG이므로 WebP 출력도 다음 장면에서 참조할 수 있게 정규화한다.
    const imageBytes = pasted ? await composeDrawing(result.bytes, preparedDrawing!, scale)
      : result.mime === "image/webp" ? await sharp(result.bytes).png().toBuffer() : result.bytes;
    const mime = pasted || result.mime === "image/webp" ? "image/png" : result.mime;
    console.info("image_request", { requestId, model: selectedModel, mode, referenceCount, referenceHash,
      promptHash: createHash("sha256").update(prompt).digest("hex"), attempts: result.attempts,
      referenceRole: pasted ? "composite" : "model", upstreamReferenceCount: pasted ? 0 : referenceCount, backgroundSource,
      protagonistCheck, rayId: result.rayId, durationMs: Math.round(performance.now() - startedAt), success: true });

    const serverDurationMs = performance.now() - startedAt;
    const payload = new Uint8Array(imageBytes.byteLength);
    payload.set(imageBytes);
    return new NextResponse(payload, { headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
      "x-image-model": selectedModel,
      "x-image-request-id": requestId,
      "x-image-attempts": String(result.attempts),
      // Distinguish a local composition source from a model's visual reference.
      "x-reference-role": pasted ? "composite" : "model",
      "x-upstream-reference-count": String(pasted ? 0 : referenceCount),
      "x-background-source": backgroundSource,
      "x-background-fallback-reason": fallbackReason,
      "x-protagonist-check": protagonistCheck,
      "x-reference-count": String(referenceCount),
      "x-reference-sha256": referenceHash,
      "x-server-duration-ms": serverDurationMs.toFixed(1),
    } });
  } catch (error) {
    const upstream = error instanceof ImageUpstreamError ? error : null;
    const aborted = error instanceof Error && /Timeout|Abort/.test(error.name);
    const errorCode = upstream?.errorCode || (aborted ? "IMAGE_REQUEST_TIMEOUT" : "IMAGE_REQUEST_FAILED");
    console.error("image_request", { requestId, errorCode, upstreamCode: upstream?.upstreamCode,
      upstreamStatus: upstream?.upstreamStatus, rayId: upstream?.rayId, attempts: upstream?.attempts,
      durationMs: Math.round(performance.now() - startedAt), success: false });
    return NextResponse.json({ error: upstream?.message || (aborted ? "이미지 생성 응답 시간이 초과됐어요. 다시 시도해 주세요." : "이미지 생성 요청을 처리하지 못했어요."),
      errorCode, requestId, upstreamCode: upstream?.upstreamCode,
      metrics: { serverDurationMs: performance.now() - startedAt, attempts: upstream?.attempts || 1 } },
      { status: upstream?.status || (aborted ? 504 : 500) });
  }
}
