"use client";

// 로그인 전 첫 화면. 한 편의 짧은 동화처럼 위에서 아래로 읽힌다.
//  1) 히어로: 아이가 곰돌이를 그리고 → 그림 속 곰돌이가 이야기 속 언덕으로 뛰어든다 (CSS 애니메이션 한 번, 이후 잔잔히 숨 쉼)
//  2) 세 장의 이야기: 그림 → 선택 → 대화 (스크롤하면 한 장씩 나타나고 안에서 조용히 반복)
//  3) 직접 골라 보는 한 장면
//  4) 곰돌이가 잠드는 마지막 장 + 시작 버튼
// 모든 움직임은 globals.css의 .lp-* 규칙이고, 움직임 줄이기 설정에서는 마지막 모습으로 바로 보인다.

import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import Icon from "./Icon";
import SceneArt from "./SceneArt";
import { btnPrimary } from "./ui";

const vars = (o: Record<string, string | number>) => o as CSSProperties;

/* ───────── 곰돌이 그림 (아이가 그린 느낌의 단순한 도형) ───────── */

const INK = "#8a5a2b";
type Part = {
  tag: "circle" | "ellipse" | "path";
  a: Record<string, string | number>;
  fill: string;
  at: number; // 그려지기 시작하는 시각(초)
  t: number; // 선을 긋는 시간(초)
  stroke?: string;
  sw?: number;
};

// DOM 순서 = 겹치는 순서. at = 그려지는 순서.
const BEAR_PARTS: Part[] = [
  { tag: "circle", a: { cx: 44, cy: 32, r: 11 }, fill: "#e8bd78", at: 1.1, t: 0.3 },
  { tag: "circle", a: { cx: 96, cy: 32, r: 11 }, fill: "#e8bd78", at: 1.4, t: 0.3 },
  { tag: "ellipse", a: { cx: 50, cy: 136, rx: 11, ry: 8 }, fill: "#e8bd78", at: 3.1, t: 0.25 },
  { tag: "ellipse", a: { cx: 90, cy: 136, rx: 11, ry: 8 }, fill: "#e8bd78", at: 3.35, t: 0.25 },
  { tag: "circle", a: { cx: 40, cy: 102, r: 9 }, fill: "#e8bd78", at: 3.6, t: 0.25 },
  { tag: "circle", a: { cx: 100, cy: 102, r: 9 }, fill: "#e8bd78", at: 3.85, t: 0.25 },
  { tag: "ellipse", a: { cx: 70, cy: 106, rx: 27, ry: 28 }, fill: "#f0cd8d", at: 2.3, t: 0.5 },
  { tag: "ellipse", a: { cx: 70, cy: 112, rx: 15, ry: 16 }, fill: "#f8e3b4", at: 2.8, t: 0.3 },
  { tag: "circle", a: { cx: 70, cy: 58, r: 30 }, fill: "#f0cd8d", at: 1.7, t: 0.6 },
  { tag: "circle", a: { cx: 58, cy: 54, r: 3 }, fill: "#3b2f25", stroke: "#3b2f25", sw: 1, at: 4.0, t: 0.1 },
  { tag: "circle", a: { cx: 82, cy: 54, r: 3 }, fill: "#3b2f25", stroke: "#3b2f25", sw: 1, at: 4.1, t: 0.1 },
  { tag: "ellipse", a: { cx: 70, cy: 66, rx: 6, ry: 4.2 }, fill: INK, at: 4.25, t: 0.15 },
  { tag: "path", a: { d: "M63 75q7 6 14 0" }, fill: "none", at: 4.4, t: 0.2 },
];

function BearArt({ animated = false, sleeping = false }: { animated?: boolean; sleeping?: boolean }) {
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {BEAR_PARTS.map((p, i) => {
        // 자는 곰돌이는 눈을 감은 선으로
        if (sleeping && p.tag === "circle" && p.a.r === 3) {
          const x = Number(p.a.cx);
          return <path key={i} d={`M${x - 5} 54q5 5 10 0`} fill="none" stroke="#3b2f25" strokeWidth={2.2} />;
        }
        const common = {
          key: i,
          fill: p.fill,
          stroke: p.stroke ?? INK,
          strokeWidth: p.sw ?? 3.2,
          ...p.a,
        };
        return animated
          ? createElement(p.tag, { ...common, pathLength: 1, className: "lp-draw", style: vars({ "--d": `${p.at}s`, "--t": `${p.t}s` }) })
          : createElement(p.tag, common);
      })}
    </g>
  );
}

// 테이프로 붙인 종이 한 장 속의 곰돌이 (데모 장면에서 쓴다)
function ChildDrawing({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`-rotate-3 rounded-sm border border-line bg-surface p-2 shadow-[0_4px_12px_rgba(59,47,37,0.14)] ${className}`}
    >
      <span className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 rotate-2 bg-[#f6e3b4]/80" />
      <svg viewBox="0 0 140 150" className="block w-full">
        <BearArt />
        <circle cx="120" cy="18" r="9" fill="#fcd34d" stroke="#f59e0b" strokeWidth="3" />
      </svg>
    </div>
  );
}

/* ───────── 스크롤하면 나타나기 ───────── */

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.dataset.in = "true";
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.dataset.in = "true";
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`lp-reveal ${className}`} style={vars({ "--d": `${delay}s` })}>
      {children}
    </div>
  );
}

/* ───────── 1. 히어로 무대 ───────── */

const FIREFLIES = [
  { x: 150, y: 210, dx: 26, dy: -18, t: 5.2, d: 0 },
  { x: 250, y: 190, dx: -22, dy: -26, t: 6.4, d: 1.2 },
  { x: 330, y: 215, dx: 18, dy: -30, t: 5.8, d: 2.4 },
  { x: 60, y: 235, dx: 24, dy: -14, t: 7, d: 0.6 },
  { x: 420, y: 200, dx: -20, dy: -22, t: 6, d: 3 },
];
const SCENE_STARS = [
  [40, 40], [150, 28], [220, 62], [300, 34], [372, 70], [440, 38], [190, 110], [330, 120], [64, 120],
] as const;

function HeroStage() {
  return (
    <div className="relative rounded-3xl border border-line bg-surface p-3 shadow-[0_10px_40px_rgba(59,47,37,0.18),0_0_90px_rgba(255,214,120,0.16)] md:p-4">
      {/* 책갈피 */}
      <span
        aria-hidden
        className="absolute -top-px right-8 h-9 w-5 bg-accent [clip-path:polygon(0_0,100%_0,100%_100%,50%_72%,0_100%)]"
      />

      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#efdfc0]">
        {/* 책상 위: 연필 자국 같은 점 */}
        <svg aria-hidden className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 480 360" preserveAspectRatio="xMidYMid slice">
          <pattern id="lp-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="1.2" fill="#d9c39a" />
          </pattern>
          <rect width="480" height="360" fill="url(#lp-dots)" />
        </svg>

        {/* 이야기 속 풍경: 곰돌이가 살아날 때 동그랗게 번져 나온다 */}
        <div className="lp-scene absolute inset-0">
          <svg aria-hidden className="h-full w-full" viewBox="0 0 480 360" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="lp-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f3cf96" />
                <stop offset="1" stopColor="#f8e8c6" />
              </linearGradient>
            </defs>
            <rect width="480" height="360" fill="url(#lp-sky)" />
            <g fill="#fffdf8">
              {SCENE_STARS.map(([x, y], i) => (
                <circle key={i} className="sky-star" cx={x} cy={y} r={i % 3 === 0 ? 2.2 : 1.5} style={{ animationDelay: `-${i * 0.37}s` }} />
              ))}
            </g>
            <g className="lp-moon">
              <circle cx="100" cy="86" r="62" fill="#fffdf8" opacity=".2" />
              <circle cx="100" cy="86" r="44" fill="#fffdf8" opacity=".35" />
              <circle cx="100" cy="86" r="32" fill="#fffdf8" />
            </g>
            <g className="lp-cloud" fill="#fffdf8" opacity=".75">
              <ellipse cx="330" cy="96" rx="44" ry="11" />
              <ellipse cx="358" cy="88" rx="28" ry="11" />
            </g>
            <path d="M0 250c84-40 156-36 240-10s168 22 240-14v134H0z" fill="#e8bd78" />
            {/* 창문에 불이 켜진 작은 집 */}
            <g>
              <path d="M388 244l25-19 25 19z" fill="#8a5a2b" />
              <rect x="394" y="244" width="38" height="28" fill="#b9803a" />
              <rect x="408" y="252" width="10" height="13" rx="1" fill="#ffd36b" className="lp-glow" />
              <circle cx="413" cy="258" r="16" fill="#ffd36b" opacity=".25" className="lp-glow" />
            </g>
            {/* 나무 */}
            <g fill="#7aa860">
              <rect x="55" y="246" width="6" height="22" fill="#8a5a2b" />
              <path d="M58 212l-19 40h38z" />
              <path d="M58 226l-23 38h46z" />
            </g>
            <path d="M0 292c96-32 180-24 264 0s144 14 216-10v78H0z" fill="#d49a4c" />
            <path d="M0 332c108-16 204-10 300 4s120 4 180-4v28H0z" fill="#b9803a" />
            {FIREFLIES.map((f, i) => (
              <circle
                key={i}
                className="lp-fly"
                cx={f.x}
                cy={f.y}
                r="2.6"
                fill="#ffe9a8"
                style={vars({ "--dx": `${f.dx}px`, "--dy": `${f.dy}px`, "--t": `${f.t}s`, "--fd": `${f.d}s` })}
              />
            ))}
          </svg>
        </div>

        {/* 종이와 곰돌이. 같은 좌표계를 쓰는 두 번째 그림 층 */}
        <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 480 360" preserveAspectRatio="xMidYMid slice">
          {/* 그림 종이: 처음엔 가운데에서 그려지고, 곰돌이가 떠난 뒤 왼쪽 아래 구석에 붙는다 */}
          <g transform="translate(240 180) rotate(-3)">
            <g className="lp-paper-in">
              <g className="lp-paper">
                <rect x="-95" y="-100" width="190" height="200" rx="4" fill="#fffdf8" stroke="#3b2f25" strokeOpacity=".12" />
                <rect x="-26" y="-110" width="52" height="16" fill="#f6e3b4" opacity=".85" transform="rotate(2)" />
                <circle cx="62" cy="-62" r="11" fill="#fcd34d" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" pathLength={1} className="lp-draw" style={vars({ "--d": "0.8s", "--t": "0.3s" })} />
                <path d="M-78 86q26-9 52 0t52 0 44-4" fill="none" stroke="#86b56a" strokeWidth="3.5" strokeLinecap="round" pathLength={1} className="lp-draw" style={vars({ "--d": "0.2s", "--t": "0.6s" })} />
                <g transform="translate(-70 -62)">
                  <BearArt animated />
                </g>
              </g>
            </g>
          </g>

          {/* 살아난 곰돌이: 종이 위 그림과 같은 자리에서 일어나 언덕으로 뛰어간다 */}
          <g transform="translate(240 180) rotate(-3) translate(-70 -62)">
            <g className="lp-live">
              <g className="lp-bob">
                <BearArt />
              </g>
            </g>
          </g>

          {/* 연필 */}
          <g className="lp-pencil">
            <g transform="rotate(35)">
              <path d="M0 0l-3.5-10h7z" fill="#e8bd78" />
              <path d="M0 0l-1.2-3.6h2.4z" fill="#3b2f25" />
              <rect x="-3.5" y="-36" width="7" height="26" fill="#f59e0b" />
              <rect x="-3.5" y="-41" width="7" height="5" rx="1.5" fill="#e56b6f" />
            </g>
          </g>
        </svg>
      </div>

      {/* 자막: 그리는 동안 → 이야기가 시작되면 */}
      <div className="grid px-2 pb-2 pt-5 md:px-3">
        <div className="lp-capA col-start-1 row-start-1">
          <p className="text-sm text-ink-3">아이가 그림을 그려요</p>
          <p className="story mt-1 text-xl leading-8 text-ink">오늘 밤의 주인공, 곰돌이를 그리고 있어요</p>
        </div>
        <div className="lp-capB col-start-1 row-start-1">
          <p className="story text-lg leading-8 text-ink md:text-xl">
            그림 속 곰돌이가 이야기 속으로 들어왔어요.
            <br className="hidden md:block" /> 치과 의자 앞에서 가슴이 콩닥콩닥 뛰어요.
          </p>
          <p className="lp-capC mt-3 text-sm text-ink-3">곰돌이는 어떻게 할까요?</p>
          <div className="lp-capC mt-2 flex flex-wrap gap-2">
            {["선생님 손을 꼭 잡아요", "눈을 감고 숨을 크게 쉬어요"].map((t) => (
              <a
                key={t}
                href="#demo"
                className="calm lp-nudge rounded-xl border border-line bg-surface px-3 py-2 text-[15px] text-ink hover:border-accent hover:bg-sunk"
              >
                {t}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-10 md:min-h-[calc(100dvh-9rem)] md:grid-cols-[1fr_1.12fr] md:gap-14">
      <div>
        <p className="lp-rise inline-flex items-center gap-2 text-[15px] text-sky-ink-2" style={vars({ "--d": "0.1s" })}>
          <span aria-hidden className="h-px w-8 bg-sky-ink-2/60" />
          잠들기 전 3분, 아이와 함께 읽는 그림책
        </p>
        <h1 className="story mt-4 text-4xl leading-[1.25] text-sky-ink md:text-[3.4rem] md:leading-[1.2]">
          <span className="lp-rise block" style={vars({ "--d": "0.25s" })}>아이의 그림이</span>
          <span className="lp-rise block" style={vars({ "--d": "0.5s" })}>
            하나의 <span className="lp-underline">이야기</span>가 됩니다
          </span>
        </h1>
        <p className="lp-rise mt-6 max-w-lg text-[17px] leading-8 text-sky-ink-2" style={vars({ "--d": "0.8s" })}>
          만 4~7세 아이가 그린 주인공이 이야기 속에서 아이의 고민을 만나고, 아이는 주인공이 어떻게 할지 직접 고릅니다.
          부모님께는 그 선택을 바탕으로 한 대화 질문을 드립니다.
        </p>
        <div className="lp-rise mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center" style={vars({ "--d": "1.05s" })}>
          <Link href="/login" className={`${btnPrimary} sm:w-56`}>
            이야기 만들기 시작
          </Link>
          <a href="#demo" className="calm inline-flex items-center gap-1 text-[15px] text-sky-ink-2 underline-offset-4 hover:text-sky-ink hover:underline">
            먼저 체험해 보기 <Icon name="right" size={16} />
          </a>
        </div>
      </div>

      <div className="lp-rise" style={vars({ "--d": "0.4s" })}>
        <HeroStage />
      </div>
    </section>
  );
}

/* ───────── 2. 세 장의 이야기 ───────── */

function ChapterShell({ no, title, text, flip, children }: { no: string; title: string; text: string; flip?: boolean; children: ReactNode }) {
  return (
    <Reveal className="grid items-center gap-6 md:grid-cols-2 md:gap-16">
      <div className={flip ? "md:order-2" : ""}>
        <p className="story flex items-baseline gap-3 text-sky-ink-2">
          <span className="text-5xl leading-none text-accent md:text-6xl">{no}</span>
          <span className="text-[15px]">번째 장</span>
        </p>
        <h2 className="story mt-3 text-2xl leading-snug text-sky-ink md:text-3xl">{title}</h2>
        <p className="mt-3 max-w-md text-[16px] leading-8 text-sky-ink-2">{text}</p>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_28px_rgba(0,0,0,0.12)] md:p-7">{children}</div>
    </Reveal>
  );
}

// 1장: 크레용으로 그림이 그려졌다 사라지기를 반복
function DrawLoop() {
  return (
    <svg viewBox="0 0 320 200" className="block w-full" aria-hidden>
      <rect x="10" y="8" width="300" height="184" rx="6" fill="#fffdf8" stroke="#3b2f25" strokeOpacity=".12" />
      <g className="lp-loop-wrap" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="lp-loop" pathLength={1} d="M40 150q40-10 80 0t80 0 80-4" stroke="#86b56a" strokeWidth="5" style={vars({ "--ld": "0s" })} />
        <circle className="lp-loop" pathLength={1} cx="258" cy="52" r="18" stroke="#f59e0b" strokeWidth="5" style={vars({ "--ld": "0.25s" })} />
        <circle className="lp-loop" pathLength={1} cx="120" cy="104" r="26" stroke="#8a5a2b" strokeWidth="5" style={vars({ "--ld": "0.55s" })} />
        <circle className="lp-loop" pathLength={1} cx="100" cy="74" r="9" stroke="#8a5a2b" strokeWidth="5" style={vars({ "--ld": "0.85s" })} />
        <circle className="lp-loop" pathLength={1} cx="140" cy="74" r="9" stroke="#8a5a2b" strokeWidth="5" style={vars({ "--ld": "1s" })} />
        <path className="lp-loop" pathLength={1} d="M112 112q8 7 16 0" stroke="#3b2f25" strokeWidth="4" style={vars({ "--ld": "1.3s" })} />
        <path className="lp-loop" pathLength={1} d="M186 120l12-26 12 26z" stroke="#e56b6f" strokeWidth="5" style={vars({ "--ld": "1.6s" })} />
      </g>
      <g className="lp-crayon">
        <g transform="rotate(30)">
          <path d="M0 0l-4-12h8z" fill="#f59e0b" />
          <rect x="-4" y="-44" width="8" height="32" fill="#f59e0b" opacity=".85" />
          <rect x="-4" y="-44" width="8" height="8" fill="#92400e" />
        </g>
      </g>
    </svg>
  );
}

// 2장: 두 선택지 중 하나가 눌리고 이야기가 이어진다
function ChoiceLoop() {
  return (
    <div className="space-y-3">
      <p className="story text-lg text-ink">곰돌이는 어떻게 할까요?</p>
      <div className="space-y-2">
        <div className="flex min-h-12 items-center rounded-xl border border-line bg-surface px-4 text-[15px] text-ink">선생님 손을 꼭 잡아요</div>
        <div className="lp-pick relative flex min-h-12 items-center rounded-xl border border-line bg-surface px-4 text-[15px] text-ink">
          눈을 감고 숨을 크게 쉬어요
          <span aria-hidden className="lp-tap absolute right-6 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full border-2 border-accent" />
        </div>
      </div>
      <div className="relative min-h-[4.5rem]">
        <p className="lp-after story absolute inset-x-0 top-0 rounded-xl bg-sunk px-4 py-3 text-[17px] leading-7 text-ink">
          숨을 크게 쉬자 콩닥콩닥이 천천히 가라앉았어요. 곰돌이는 살짝 웃었어요.
        </p>
      </div>
    </div>
  );
}

// 3장: 부모의 질문 → 아이의 대답 → 한 줄 메모가 다음 이야기로
function TalkLoop() {
  return (
    <div className="space-y-3">
      <div className="lp-b1 max-w-[88%]">
        <p className="mb-1 text-xs text-ink-3">부모님</p>
        <p className="story rounded-2xl rounded-tl-sm bg-sunk px-4 py-3 text-[17px] leading-7 text-ink">“마음이 콩닥거릴 때 우리는 뭘 해 볼 수 있을까?”</p>
      </div>
      <div className="grid justify-items-end">
        <div className="lp-dots col-start-1 row-start-1 flex gap-1 self-end rounded-2xl bg-accent/25 px-4 py-3" aria-hidden>
          <i className="h-2 w-2 rounded-full bg-accent-text" />
          <i className="h-2 w-2 rounded-full bg-accent-text" />
          <i className="h-2 w-2 rounded-full bg-accent-text" />
        </div>
        <div className="lp-b2 col-start-1 row-start-1 max-w-[88%]">
          <p className="mb-1 text-right text-xs text-ink-3">아이</p>
          <p className="story rounded-2xl rounded-tr-sm bg-[#fdf0d2] px-4 py-3 text-[17px] leading-7 text-ink">“숨을 크게 쉬면 괜찮아져요.”</p>
        </div>
      </div>
      <p className="lp-b3 flex items-center gap-2 rounded-xl border border-dashed border-accent/60 px-4 py-2.5 text-[15px] text-ink-2">
        <Icon name="book" size={16} className="text-accent-text" />
        한 줄 메모는 다음 이야기로 이어져요
      </p>
    </div>
  );
}

function Chapters() {
  return (
    <section className="mt-24 md:mt-36">
      <Reveal className="text-center">
        <p className="story text-[15px] text-sky-ink-2">이야기는 이렇게 흘러가요</p>
        <h2 className="story mt-2 text-balance text-2xl text-sky-ink md:text-4xl">그림 한 장에서 시작되는 세 장면</h2>
      </Reveal>
      <div className="mt-12 space-y-16 md:mt-16 md:space-y-28">
        <ChapterShell no="1" title="아이의 그림과 마음을 담습니다" text="아이가 그린 주인공을 정하고, 치과가 무서워 같은 요즘 아이의 고민을 고르거나 직접 적습니다.">
          <DrawLoop />
        </ChapterShell>
        <ChapterShell flip no="2" title="이야기 속에서 선택합니다" text="그림 속 주인공이 어떻게 할지 아이가 직접 고릅니다. 그 선택에 아이의 마음이 담깁니다.">
          <ChoiceLoop />
        </ChapterShell>
        <ChapterShell no="3" title="부모와 이야기합니다" text="아이의 선택을 바탕으로 대화 질문을 드립니다. 한 줄 메모는 다음 이야기로 이어집니다.">
          <TalkLoop />
        </ChapterShell>
      </div>
    </section>
  );
}

/* ───────── 3. 직접 골라 보는 한 장면 ───────── */

const DEMO = {
  scene: "곰돌이는 치과 의자에 앉았어요. 윙윙 소리가 들리자 가슴이 콩닥콩닥 뛰었어요.",
  prompt: "곰돌이는 어떻게 할까요",
  options: [
    {
      text: "선생님 손을 꼭 잡아요",
      next: "선생님이 손을 마주 잡아 주었어요. 손끝이 따뜻해서 마음이 조금 놓였어요.",
      question: "손을 잡았을 때 마음이 어땠을까?",
    },
    {
      text: "눈을 감고 숨을 크게 쉬어요",
      next: "숨을 크게 쉬자 콩닥콩닥이 천천히 가라앉았어요. 곰돌이는 살짝 웃었어요.",
      question: "마음이 콩닥거릴 때 우리는 뭘 해 볼 수 있을까?",
    },
  ],
};

function BookDemo() {
  const [picked, setPicked] = useState<number | null>(null);
  const p = picked === null ? null : DEMO.options[picked];

  return (
    <div className="relative grid overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_8px_30px_rgba(0,0,0,0.18)] md:grid-cols-2">
      <div className="relative p-4 md:p-6">
        <SceneArt index={picked === null ? 0 : picked + 1} className="md:h-full md:aspect-auto" />
        <ChildDrawing className="absolute bottom-8 left-8 w-28 md:bottom-10 md:left-10 md:w-36" />
      </div>

      <div className="relative flex flex-col justify-center gap-6 border-t border-line p-6 md:border-l md:border-t-0 md:p-10">
        <span
          aria-hidden
          className="absolute -top-px right-6 h-8 w-5 bg-accent [clip-path:polygon(0_0,100%_0,100%_100%,50%_72%,0_100%)]"
        />

        <p className="story text-xl leading-9 text-ink md:text-2xl md:leading-[2.4rem]">{DEMO.scene}</p>

        {p === null ? (
          <div key="ask" className="rise space-y-3">
            <p className="story text-lg text-ink">{DEMO.prompt}</p>
            <div className="grid gap-2">
              {DEMO.options.map((o, i) => (
                <button
                  key={o.text}
                  onClick={() => setPicked(i)}
                  className="calm flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left text-[15px] text-ink hover:border-accent hover:bg-sunk active:translate-y-px"
                >
                  {o.text}
                  <Icon name="right" size={16} className="text-ink-3" />
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-3">하나를 눌러 보세요</p>
          </div>
        ) : (
          <div key={`answer-${picked}`} className="rise space-y-4" aria-live="polite">
            <p className="story text-xl leading-9 text-ink md:text-2xl md:leading-[2.4rem]">{p.next}</p>
            <div className="rounded-xl bg-sunk px-4 py-3">
              <p className="text-sm text-ink-3">부모님께 가는 질문</p>
              <p className="story mt-1 text-lg text-ink">“{p.question}”</p>
            </div>
            <button onClick={() => setPicked(null)} className="calm text-sm text-ink-2 underline hover:text-ink">
              다른 선택 보기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Demo() {
  return (
    <section id="demo" className="mt-24 scroll-mt-24 md:mt-36">
      <Reveal className="mb-8 text-center md:mb-10">
        <p className="story text-[15px] text-sky-ink-2">잠깐, 직접 해 볼까요?</p>
        <h2 className="story mt-2 text-balance text-2xl text-sky-ink md:text-4xl">곰돌이의 다음 이야기는 아이가 정해요</h2>
      </Reveal>
      <Reveal delay={0.1}>
        <BookDemo />
      </Reveal>
    </section>
  );
}

/* ───────── 4. 곰돌이가 잠드는 마지막 장 ───────── */

const FACTS = ["아이 이름 없이 시작해요", "3분 안에 읽을 수 있어요", "기록은 계정에 저장돼요"];

function Goodnight() {
  return (
    <section className="mt-24 md:mt-36">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#1b2a5c] to-[#0e1a3a] px-6 pb-0 pt-10 text-[#fff4d6] shadow-[0_12px_40px_rgba(0,0,0,0.25)] md:px-14 md:pt-14">
          {/* 별 */}
          <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice">
            {[[60, 40], [140, 90], [230, 30], [330, 70], [420, 36], [510, 80], [570, 30], [30, 150], [480, 150]].map(([x, y], i) => (
              <circle key={i} className="sky-star" cx={x} cy={y} r={i % 2 ? 1.4 : 2} fill="#fff" style={{ animationDelay: `-${i * 0.5}s` }} />
            ))}
          </svg>

          <div className="relative grid items-end gap-6 md:grid-cols-[1fr_auto] md:gap-12">
            <div className="pb-8 md:pb-14">
              <p className="story text-[15px] text-[#c3cbe8]">곰돌이는 이제 새근새근 잠들었어요.</p>
              <h2 className="story mt-3 text-3xl leading-snug md:text-4xl">오늘 밤, 아이의 그림으로 첫 이야기를 만들어 보세요</h2>
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-[#c3cbe8]">
                {FACTS.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/login" className={`${btnPrimary} mt-8 md:w-56`}>
                이야기 만들기 시작
              </Link>
            </div>

            {/* 잠든 곰돌이와 둥실 떠오르는 zZ */}
            <svg aria-hidden viewBox="0 0 220 190" className="mx-auto -mb-px block w-52 md:w-72">
              <g className="lp-zz" fill="#fff4d6" fontFamily="var(--font-story)">
                <text x="140" y="40" fontSize="22" className="lp-z1">z</text>
                <text x="158" y="22" fontSize="16" className="lp-z2">z</text>
                <text x="172" y="8" fontSize="12" className="lp-z3">z</text>
              </g>
              <path d="M0 150q60-34 120-14t100-6v60H0z" fill="#1a2650" />
              <g transform="translate(40 40) scale(.8)">
                <BearArt sleeping />
              </g>
              <path d="M0 176q70-22 130-6t90-4v24H0z" fill="#0b132e" />
            </svg>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ───────── 조립 ───────── */

export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-md px-4 pt-8 md:max-w-6xl md:px-8 md:pt-12">
      <Hero />
      <Chapters />
      <Demo />
      <Goodnight />
    </main>
  );
}

