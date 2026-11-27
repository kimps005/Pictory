"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StorySegment } from "@/lib/story/schema";
import { backgroundScenePrompt, drawingScenePrompt, textScenePrompt } from "@/lib/image/story-image";

export interface SceneImage {
  url?: string;
  loading: boolean;
  error?: string;
  backgroundSource?: string;
}

// 화면과 분리된 이미지 진행. 실패하거나 늦어져도 동화·선택·낭독을 막지 않는다.
export function useStoryImages() {
  const [images, setImages] = useState<SceneImage[]>([]);
  const drawing = useRef<File | null>(null);
  const epoch = useRef(0);
  const controller = useRef(new AbortController());
  const urls = useRef<string[]>([]);
  const reference = useRef<File | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const count = useRef(0);

  const clearImages = useCallback(() => {
    epoch.current++;
    controller.current.abort();
    controller.current = new AbortController();
    urls.current.forEach(url => URL.revokeObjectURL(url));
    urls.current = [];
    reference.current = null;
    queue.current = Promise.resolve();
    count.current = 0;
    setImages([]);
  }, []);

  useEffect(() => () => {
    epoch.current++;
    controller.current.abort();
    urls.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  const setDrawing = useCallback((file: File | null) => { drawing.current = file; }, []);
  const hasDrawing = useCallback(() => !!drawing.current, []);

  const appendImages = useCallback((segment: StorySegment, protagonist?: string) => {
    const version = epoch.current;
    const signal = controller.current.signal;
    const original = drawing.current;
    const offset = count.current;
    count.current += segment.scenes.length;
    setImages(previous => [...previous, ...segment.scenes.map(() => ({ loading: true }))]);

    queue.current = queue.current.then(async () => {
      for (const [i, scene] of segment.scenes.entries()) {
        if (signal.aborted || version !== epoch.current) return;
        const update = (value: SceneImage) => {
          if (version === epoch.current) setImages(previous => previous.map((item, index) => index === offset + i ? value : item));
        };
        try {
          const form = new FormData();
          const cast = segment.supportingCast || "";
          form.set("mode", original ? "drawing-scene" : reference.current ? "scene" : "text");
          if (original) {
            const previous = reference.current;
            form.set("prompt", drawingScenePrompt(scene.imagePrompt, cast, !!previous));
            // 서버가 주인공 누락을 감지하면 쓰는 재시도용·배경용 프롬프트
            form.set("retryPrompt", drawingScenePrompt(scene.imagePrompt, cast, !!previous, true));
            form.set("backgroundPrompt", backgroundScenePrompt(scene.imagePrompt, scene.text));
            form.set("image_0", original);
            if (previous) form.set("scene_ref", previous);
          } else {
            form.set("prompt", textScenePrompt(scene.imagePrompt, scene.text,
              segment.characterBible || protagonist || "a small friendly storybook animal", cast, !!reference.current));
            if (reference.current) form.set("image_0", reference.current);
          }
          const response = await fetch("/api/image", { method: "POST", body: form, signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || "삽화를 만들지 못했어요.");
          }
          const blob = await response.blob();
          if (signal.aborted || version !== epoch.current) return;
          if (!blob.type.startsWith("image/")) throw new Error("삽화 응답 형식이 올바르지 않아요.");
          if (original) {
            // 그림 주인공이 확인된 모델 생성 장면만 다음 장면의 화풍·조연 참고로 쓴다.
            // 합성 장면은 배경만 모델이 그렸으므로 참고에서 뺀다.
            const check = response.headers.get("x-protagonist-check");
            if (check === "pass" && ["image/png", "image/jpeg"].includes(blob.type))
              reference.current = new File([blob], "previous-page.png", { type: blob.type });
          } else if (!reference.current) reference.current = new File([blob], "character-reference.png", { type: blob.type });
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          update({ url, loading: false, backgroundSource: response.headers.get("x-background-source") || "generated" });
        } catch (error) {
          if (signal.aborted || version !== epoch.current) return;
          update({ loading: false, error: error instanceof Error ? error.message : "삽화를 만들지 못했어요." });
        }
      }
    });
  }, []);

  return { images, appendImages, clearImages, setDrawing, hasDrawing };
}
