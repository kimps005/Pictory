"use client";

// 첫 화면에서 잠깐 멈춰 있다가, 스크롤(휠·터치·키보드)을 한 번 하면
// 아래 영역(targetId)으로 빠르게 쑥 내려간다. 올라갈 때도 첫 화면으로 쑥 돌아온다.
// 움직임을 줄이는 설정이면 애니메이션 없이 바로 이동한다.

import { useEffect, useRef, type ReactNode } from "react";

const DURATION = 620;
// 시작 반응은 빠르게, 끝은 부드럽게
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3.2);

export default function HeroParallax({ children, targetId }: { children: ReactNode; targetId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animating = false;
    let frameId = 0;
    const targetY = () => {
      const t = document.getElementById(targetId);
      return t ? Math.max(t.getBoundingClientRect().top + window.scrollY - 72, 0) : 0;
    };

    const go = (to: number) => {
      if (reduceMotion) {
        window.scrollTo({ top: to, behavior: "instant" });
        return;
      }

      animating = true;
      const from = window.scrollY;
      const start = performance.now();
      const step = (now: number) => {
        const p = Math.min((now - start) / DURATION, 1);
        // 전역 scroll-behavior: smooth가 프레임마다 이동을 다시 지연시키지 않게 한다.
        window.scrollTo({ top: from + (to - from) * easeOut(p), behavior: "instant" });
        if (p < 1) frameId = requestAnimationFrame(step);
        else animating = false;
      };
      frameId = requestAnimationFrame(step);
    };

    // dir: 1 = 아래로, -1 = 위로. 스냅했으면 true
    const trigger = (dir: number) => {
      const y = window.scrollY;
      const t = targetY();
      if (dir > 0 && y < t - 8) {
        go(t);
        return true;
      }
      if (dir < 0 && y > 0 && y <= t + 8) {
        go(0);
        return true;
      }
      return false;
    };

    const onWheel = (e: WheelEvent) => {
      if (animating) return e.preventDefault();
      if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (trigger(e.deltaY > 0 ? 1 : -1)) e.preventDefault();
    };

    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (animating) return e.preventDefault();
      const d = touchY - e.touches[0].clientY;
      if (Math.abs(d) < 24) return;
      if (trigger(d > 0 ? 1 : -1)) {
        e.preventDefault();
        touchY = e.touches[0].clientY;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const down = e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey);
      const up = e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey);
      if (!down && !up) return;
      if (animating || trigger(down ? 1 : -1)) e.preventDefault();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [targetId]);

  return <div ref={ref}>{children}</div>;
}
