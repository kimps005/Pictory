"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TtsVoice } from "@/lib/tts";

export function useNarration() {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [rate, setRate] = useState(0.9);
  const token = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const clearPlayback = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    audio.current?.pause();
    audio.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }, []);

  const stop = useCallback(() => {
    token.current++;
    clearPlayback();
    setSpeaking(false);
    setError("");
  }, [clearPlayback]);

  const speak = useCallback(
    async (text: string | string[], voice: TtsVoice) => {
      const content = (Array.isArray(text) ? text : [text]).join("\n\n").trim();
      if (!content) return;

      const mine = ++token.current;
      clearPlayback();
      const request = new AbortController();
      controller.current = request;
      setError("");
      setSpeaking(true);

      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: content, voice, rate }),
          signal: request.signal,
        });
        if (mine !== token.current) return;
        if (!response.ok) {
          const result = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(result?.error || "음성을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
        }

        const url = URL.createObjectURL(await response.blob());
        if (mine !== token.current) {
          URL.revokeObjectURL(url);
          return;
        }
        audioUrl.current = url;
        const player = new Audio(url);
        audio.current = player;
        const finish = () => {
          if (mine !== token.current) return;
          clearPlayback();
          setSpeaking(false);
        };
        player.onended = finish;
        player.onerror = finish;
        await player.play();
      } catch (cause) {
        if (mine !== token.current) return;
        clearPlayback();
        setSpeaking(false);
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "음성을 재생하지 못했어요.");
      }
    },
    [clearPlayback, rate],
  );

  useEffect(() => () => clearPlayback(), [clearPlayback]);

  return { speaking, error, rate, setRate, speak, stop };
}
