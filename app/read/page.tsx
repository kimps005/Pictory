"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CUSTOM_COPING } from "@/lib/story/schema";
import { TTS_VOICES } from "@/lib/tts";
import { useApp } from "../providers";
import Icon from "../components/Icon";
import SceneArt from "../components/SceneArt";
import StoryText from "../components/StoryText";
import { useReaderPagination } from "../useReaderPagination";
import { DrawingAnimation, WritingAnimation } from "../components/LoadingAnimation";
import { btnIcon, btnPrimary, btnSecondary, errorCls, inputCls, noteCls, Segmented } from "../components/ui";

export default function ReadPage() {
  const { s, n, settings, setSettings } = useApp();
  const router = useRouter();
  const [page, setPage] = useState<number | null>(null);
  const { step, resumeDraft, resumePage } = s;
  const [custom, setCustom] = useState("");
  const [enterAtEnd, setEnterAtEnd] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 이 화면에 맞지 않는 단계면 알맞은 화면으로 보낸다
  useEffect(() => {
    if (step === "card") router.replace("/card");
    else if (step === "form" && !resumeDraft()) router.replace("/create");
  }, [step, resumeDraft, router]);

  const last = Math.max(s.scenes.length - 1, 0);
  const cur = Math.min(page ?? resumePage ?? 0, last);
  const atLast = cur === last;
  const reading = useReaderPagination(s.scenes[cur] ?? "", settings.fontSize, cur, enterAtEnd, s.step === "story");
  const atSceneEnd = reading.index === reading.count - 1;
  const showChoice = reading.ready && atSceneEnd;

  // 사용자가 버튼을 누른 순간에 읽기를 시작해야 브라우저가 소리를 허용한다.
  const go = (to: number, fromEnd = false) => {
    setEnterAtEnd(fromEnd);
    setPage(to);
    if (n.speaking) void n.speak(s.scenes[to], settings.ttsVoice);
  };

  if (s.step === "loading") {
    return (
      <main className="page-turn mx-auto w-full max-w-md space-y-4 px-4 py-8 md:max-w-5xl md:px-8 md:py-12">
        {s.usedFallback && <FallbackNote />}
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-line bg-surface px-6 py-24 text-center">
          {s.loadingPurpose === "card" ? <Icon name="book" size={40} className="text-accent-text" /> : <WritingAnimation />}
          <p aria-live="polite" className="story text-xl text-ink">
            {s.loadingPurpose === "card" ? "부모님 대화 카드를 준비하고 있어요" : "동화를 쓰고 있어요"}
          </p>
          <div className="flex gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="soft-pulse size-2 rounded-full bg-accent"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (s.step !== "story") return null;

  return (
    <main className="page-turn mx-auto w-full max-w-md space-y-6 px-4 py-6 md:max-w-6xl md:space-y-8 md:px-8 md:py-10">
      <div className="reader-stage space-y-6">
      {s.error && (
        <p role="alert" className={errorCls}>
          {s.error}
        </p>
      )}
      {n.error && <p role="alert" className={errorCls}>{n.error}</p>}
      {s.usedFallback && <FallbackNote />}

      <div className="flex items-start justify-between gap-3">
        <h1 className="story text-2xl text-sky-ink md:text-3xl">{s.title}</h1>
        <button
          type="button"
          onClick={async () => {
            if (!(await s.saveDraft(cur))) return;
            n.stop();
            router.push("/");
          }}
          className="calm shrink-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-2 hover:bg-sunk"
        >
          저장하고 나가기
        </button>
      </div>

      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-1.5 md:grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] md:gap-3">
      <button
        type="button"
        onClick={() => reading.index > 0 ? reading.turn(-1) : go(cur - 1, true)}
        disabled={cur === 0 && reading.index === 0}
        aria-label="이전 쪽"
        className={`${btnIcon} h-24 w-full md:h-32`}
      >
        <Icon name="left" />
      </button>
      <article className="reader-book relative grid min-w-0 gap-6 book-page overflow-hidden rounded-2xl border p-4 md:grid-cols-2 md:gap-8 md:p-6">
        {/* 책갈피: 이 서비스의 표시. 읽는 카드에서만 쓴다 */}
        <span
          aria-hidden
          className="absolute -top-px right-6 h-8 w-5 bg-accent [clip-path:polygon(0_0,100%_0,100%_100%,50%_72%,0_100%)]"
        />

        <div className="reader-art w-full md:self-stretch">
          {s.images[cur]?.loading ? (
            <DrawingAnimation fill />
          ) : (
            <SceneArt fill index={cur} imageUrl={s.images[cur]?.url} title={s.title} />
          )}
          {s.images[cur]?.error && <p role="alert" className={`${errorCls} mt-2`}>그림을 만들지 못했어요. {s.images[cur].error}</p>}
          {s.images[cur]?.backgroundSource === "local-fallback" && <p className="mt-2 text-sm text-ink-3">그림 생성 서비스가 바빠 기본 배경을 사용했어요.</p>}
        </div>

        <div className="reader-content flex min-w-0 flex-col gap-4 px-1 py-2 md:px-0 md:py-2 md:pr-3">
          <StoryText
            text={s.scenes[cur]}
            fontSize={settings.fontSize}
            textRef={reading.textRef}
            actions={(
              <span className="float-right ml-3 inline-flex gap-2 whitespace-normal align-middle leading-none">
                <button
                  type="button"
                  onClick={() => n.speaking ? n.stop() : void n.speak(s.scenes[cur], settings.ttsVoice)}
                  aria-label={n.speaking ? "낭독 멈춤" : "읽어주기"}
                  title={n.speaking ? "낭독 멈춤" : "읽어주기"}
                  aria-pressed={n.speaking}
                  className={btnIcon}
                >
                  <Icon name={n.speaking ? "stop" : "volume"} />
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="낭독 설정 열기"
                  title="낭독 설정"
                  className={btnIcon}
                >
                  <Icon name="sliders" />
                </button>
              </span>
            )}
          />

          <div className="reader-controls shrink-0 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-1 gap-1" aria-hidden>
                {s.scenes.map((_, i) => (
                  <span key={i} className={`h-1 flex-1 rounded-full ${i <= cur ? "bg-accent" : "bg-line"}`} />
                ))}
              </div>
              <span aria-live="polite" className="shrink-0 text-sm tabular-nums text-ink-3">
                {cur + 1} / {s.scenes.length}
                {reading.count > 1 && <span className="ml-2">({reading.index + 1} / {reading.count}쪽)</span>}
              </span>
            </div>

            {atLast && s.choice && !s.isEnding && (
              <section
                className={`space-y-2.5 ${showChoice ? "" : "invisible pointer-events-none select-none"}`}
                aria-label="이야기 선택"
                aria-hidden={!showChoice}
              >
                <p className="story text-center text-base text-ink md:text-lg">{s.choice.prompt}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {s.choice.options.map((o) => (
                    <button
                      key={o.id}
                      disabled={!showChoice}
                      onClick={() => {
                        n.stop();
                        setPage(s.scenes.length); // 새 장면의 첫 쪽으로
                        void s.pick(o);
                      }}
                      className="calm flex min-h-12 items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-[15px] leading-6 text-ink hover:border-accent hover:bg-sunk active:translate-y-px"
                    >
                      {o.text}
                      <Icon name="right" size={16} className="text-ink-3" />
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = custom.trim();
                    if (!text) return;
                    n.stop();
                    setPage(s.scenes.length);
                    setCustom("");
                    void s.pick({ text, copingType: CUSTOM_COPING });
                  }}
                >
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    disabled={!showChoice}
                    maxLength={60}
                    aria-label="직접 입력"
                    placeholder="내가 생각한 방법을 직접 써 볼래요"
                    className={`${inputCls} min-w-0 flex-1 py-2`}
                  />
                  <button type="submit" disabled={!showChoice || !custom.trim()} className={`${btnSecondary} h-11 shrink-0 px-3 text-sm disabled:opacity-40`}>
                    이렇게 할래요
                  </button>
                </form>
              </section>
            )}
          </div>
        </div>
      </article>
      <button
        type="button"
        onClick={() => !atSceneEnd ? reading.turn(1) : go(cur + 1)}
        disabled={atLast && atSceneEnd}
        aria-label="다음 쪽"
        className={`${btnIcon} h-24 w-full md:h-32`}
      >
        <Icon name="right" />
      </button>
      </div>
      </div>

      {atLast && reading.ready && atSceneEnd && s.isEnding && (
        <section className="page-turn book-page mx-auto w-full max-w-xl rounded-2xl border px-6 py-10 text-center">
          <svg viewBox="0 0 200 24" className="mx-auto h-5 w-44 text-accent" aria-hidden>
            <path d="M6 12h74M120 12h74" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            <path d="M100 2l3 7 7.5.6-5.7 4.9 1.8 7.3L100 18l-6.6 3.8 1.8-7.3-5.7-4.9L97 9z" fill="currentColor" />
          </svg>
          <p className="story mt-5 text-3xl text-ink">끝</p>
          <p className="story mt-2 text-base text-ink-2">「{s.title}」 이야기를 끝까지 읽었어요</p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              onClick={() => {
                n.stop();
                void s.showCard();
              }}
              className={`${btnPrimary} w-full max-w-xs`}
            >
              부모님께: 대화 카드 보기
            </button>
            <button
              onClick={() => {
                n.stop();
                setEnterAtEnd(false);
                setPage(0);
                reading.turn(-reading.index);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="text-sm text-ink-2 underline underline-offset-4"
            >
              처음부터 다시 읽기
            </button>
          </div>
        </section>
      )}

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setSettingsOpen(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setSettingsOpen(false); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="reading-settings-title"
            className="w-full max-w-sm space-y-5 rounded-2xl border border-line bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="reading-settings-title" className="story text-xl text-ink">낭독 설정</h2>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="닫기" className={btnIcon}>
                <Icon name="close" />
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-ink-3">목소리</p>
              <Segmented
                label="낭독 목소리"
                value={settings.ttsVoice}
                onChange={(ttsVoice) => {
                  n.stop();
                  setSettings({ ...settings, ttsVoice });
                }}
                options={[
                  { value: "sunhi" as const, label: TTS_VOICES.sunhi.label },
                  { value: "hyunsu" as const, label: TTS_VOICES.hyunsu.label },
                ]}
                fullWidth
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-ink-3">속도</p>
              <Segmented
                label="낭독 속도"
                value={n.rate}
                onChange={n.setRate}
                options={[
                  { value: 0.7, label: "느리게" },
                  { value: 0.9, label: "보통" },
                  { value: 1.1, label: "빠르게" },
                ]}
                fullWidth
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function FallbackNote() {
  return <p className={noteCls}>AI가 바빠서 미리 준비한 이야기를 들려드리고 있어요.</p>;
}

