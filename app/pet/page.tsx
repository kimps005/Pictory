"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../providers";
import Icon from "../components/Icon";
import PetRoom from "./PetRoom";
import HatchIntro from "./HatchIntro";
import { MoodIcon } from "./room-art";
import { localDateKey, nextPetStage, petStage, type PetMood } from "@/lib/pet";

const MOODS: { value: PetMood }[] = [
  { value: "기쁨" }, { value: "평온" }, { value: "속상" }, { value: "용기" }, { value: "두근" },
];
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function monthCells(year: number, month: number) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDate }, (_, index) => index + 1),
  ];
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function PetPage() {
  const { pet, library } = useApp();
  const [action, setAction] = useState<"fed" | "petted" | undefined>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [popping, setPopping] = useState(false); // 알이 깨진 직후 몽이가 튀어나오는 동안
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(pet.state.name);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const today = pet.today;
  const todayDate = new Date(`${today}T12:00:00`);
  const [shownMonth, setShownMonth] = useState({ year: todayDate.getFullYear(), month: todayDate.getMonth() });
  const careDays = pet.state.careDates.length;
  const growthDays = pet.state.growthDays;
  const stage = petStage(growthDays);
  const next = nextPetStage(growthDays);
  const fed = pet.state.fedDates.includes(today);
  const petted = pet.state.pettedDates.includes(today);
  const mood = pet.state.moods[today];
  const progress = next ? Math.min(100, ((growthDays - stage.days) / (next.days - stage.days)) * 100) : 100;
  const cells = monthCells(shownMonth.year, shownMonth.month);
  const selectedMood = selectedDate ? pet.state.moods[selectedDate] : undefined;
  const selectedStories = selectedDate
    ? library.filter((story) => localDateKey(story.createdAt) === selectedDate)
    : [];

  useEffect(() => {
    if (!selectedDate && !calendarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedDate) setSelectedDate(null);
      else setCalendarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedDate, calendarOpen]);

  const react = (nextAction: "fed" | "petted") => {
    const succeeded = nextAction === "fed" ? pet.feed() : pet.pet();
    if (!succeeded) return;
    setAction(nextAction);
    window.setTimeout(() => setAction(undefined), 1400);
  };

  const moveMonth = (amount: number) => {
    const moved = new Date(shownMonth.year, shownMonth.month + amount, 1);
    setShownMonth({ year: moved.getFullYear(), month: moved.getMonth() });
  };

  const canCare = pet.state.points >= 1;
  const showIntro = !pet.state.introSeen;
  const introReveal = () => { setPopping(true); window.setTimeout(() => setPopping(false), 3200); };
  const replayIntro = () => { setPopping(false); pet.setIntroSeen(false); };

  return (
    <main className="page-turn mx-auto w-full max-w-md px-4 py-8 md:max-w-4xl md:px-8 md:py-12">
      {showIntro && typeof document !== "undefined" && createPortal(<HatchIntro onReveal={introReveal} onDone={() => pet.setIntroSeen(true)} />, document.body)}

      <div className="mt-8">
        <PetRoom
          name={pet.state.name} stageName={stage.name} stageMessage={stage.message} stageIndex={stage.index}
          careDays={careDays} points={pet.state.points} mood={mood} action={action}
          speech={popping ? "안녕! 나는 " + pet.state.name + "이야" : action === "fed" ? "냠냠, 마음이 든든해졌어!" : action === "petted" ? "헤헤, 네 손은 참 따뜻해" : mood === "속상" ? "오늘은 내가 조용히 곁에 있을게" : mood === "용기" ? "우리 같이 한 걸음 내디뎌 보자!" : "오늘도 이야기 들려줄래?"}
          fed={fed} petted={petted} canCare={canCare} progress={progress} nextName={next?.name}
          renaming={renaming} nameDraft={nameDraft} onNameDraft={setNameDraft}
          onStartRename={() => { setNameDraft(pet.state.name); setRenaming(true); }}
          onSaveRename={() => { pet.rename(nameDraft); if (nameDraft.trim()) setRenaming(false); }}
          onCancelRename={() => { setNameDraft(pet.state.name); setRenaming(false); }}
          onMood={pet.setMood} onCare={react} onOpenCalendar={() => setCalendarOpen(true)}
          onReplayIntro={replayIntro} mongi={popping ? "pop" : showIntro ? "hidden" : undefined}
        />
      </div>

      {calendarOpen && typeof document !== "undefined" && createPortal((
        <div className="fixed inset-0 z-40 grid place-items-center bg-ink/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCalendarOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="마음 스티커 달력" className="relative max-h-[90dvh] w-full max-w-xl overflow-y-auto">
            <button type="button" onClick={() => setCalendarOpen(false)} aria-label="닫기" className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full text-xl text-ink-3 hover:bg-sunk">×</button>
      <section className="rounded-2xl border border-line bg-surface p-5 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="story text-2xl text-ink">마음 스티커 달력</h2>
            <p className="mt-1 text-sm text-ink-3">매일 고른 마음이 차곡차곡 모여요</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달" className="calm flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-sunk"><Icon name="left" /></button>
            <p className="min-w-28 text-center text-[15px] font-medium text-ink">{shownMonth.year}년 {shownMonth.month + 1}월</p>
            <button type="button" onClick={() => moveMonth(1)} aria-label="다음 달" className="calm flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-sunk"><Icon name="right" /></button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-7 text-center text-xs text-ink-3">
          {WEEKDAYS.map((weekday) => <span key={weekday} className="py-2">{weekday}</span>)}
          {cells.map((day, index) => {
            if (!day) return <span key={`blank-${index}`} aria-hidden className="aspect-square" />;
            const key = dateKey(shownMonth.year, shownMonth.month, day);
            const recordedMood = pet.state.moods[key];
            const isToday = key === today;
            return (
              <div key={key} className="flex aspect-square items-center justify-center p-0.5">
                <button type="button" onClick={() => setSelectedDate(key)} aria-label={`${day}일${recordedMood ? `, ${recordedMood} 마음` : ""}, 기록 보기`} className={`relative flex size-full max-h-12 max-w-12 flex-col items-center justify-center rounded-xl transition hover:bg-sunk focus-visible:outline-2 focus-visible:outline-accent ${isToday ? "bg-[#fdf0d2] ring-1 ring-accent" : recordedMood ? "bg-paper" : ""}`}>
                  <span className={`text-[11px] leading-none ${isToday ? "font-medium text-accent-text" : "text-ink-3"}`}>{day}</span>
                  <span className="mt-0.5 flex min-h-[18px] items-center justify-center leading-none" aria-hidden>{recordedMood ? <MoodIcon mood={recordedMood} size={18} /> : null}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 border-t border-line pt-4 text-xs text-ink-2">
          {MOODS.map((item) => <span key={item.value} className="inline-flex items-center gap-1"><MoodIcon mood={item.value} size={16} /> {item.value}</span>)}
        </div>
      </section>
          </div>
        </div>
      ), document.body)}

      {selectedDate && typeof document !== "undefined" && createPortal((
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDate(null); }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="calendar-detail-title" className="relative max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-line bg-surface p-5 shadow-xl sm:p-7">
            <button type="button" onClick={() => setSelectedDate(null)} aria-label="닫기" className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full text-xl text-ink-3 hover:bg-sunk">×</button>
            <h2 id="calendar-detail-title" className="story pr-10 text-2xl text-ink">
              {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
            </h2>

            <section className="mt-6 rounded-2xl bg-[#fff7e9] p-4">
              <h3 className="text-sm font-medium text-ink-2">이날의 마음</h3>
              {selectedMood ? (
                <p className="mt-2 flex items-center gap-2 text-lg text-ink"><MoodIcon mood={selectedMood} size={26} />{selectedMood}</p>
              ) : <p className="mt-2 text-sm text-ink-3">이날은 마음 스티커를 남기지 않았어요.</p>}
            </section>

            <section className="mt-5">
              <h3 className="story text-xl text-ink">그날 만든 동화</h3>
              {selectedStories.length ? (
                <div className="mt-3 space-y-3">
                  {selectedStories.map((story) => {
                    const keywords = Array.from(new Set(story.choices.map((choice) => choice.copingType)));
                    return (
                      <article key={story.id} className="rounded-2xl border border-line p-4">
                        <h4 className="font-medium text-ink">{story.title}</h4>
                        <p className="mt-2 text-sm leading-6 text-ink-2">상황 · {story.situation}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {keywords.length ? keywords.map((keyword) => <span key={keyword} className="rounded-full bg-[#fdf0d2] px-3 py-1 text-xs text-accent-text">{keyword}</span>) : <span className="rounded-full bg-sunk px-3 py-1 text-xs text-ink-2">함께 읽기</span>}
                        </div>
                        {story.choices.length > 0 && <p className="mt-3 text-sm leading-6 text-ink-2">아이가 고른 마음 · {story.choices.map((choice) => `“${choice.text}”`).join(" · ")}</p>}
                        <details className="mt-4 rounded-xl bg-paper px-3 py-2">
                          <summary className="cursor-pointer text-sm font-medium text-ink-2">동화 내용 보기</summary>
                          <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-ink-2">
                            {story.scenes.map((scene, index) => <li key={`${story.id}-scene-${index}`}>{scene}</li>)}
                          </ol>
                        </details>
                        {story.card?.summary && <p className="mt-3 text-sm leading-6 text-ink-2">마음 살펴보기 · {story.card.summary}</p>}
                        {story.memo && <p className="mt-3 rounded-xl bg-[#f5f0e6] p-3 text-sm leading-6 text-ink-2">부모 메모 · {story.memo}</p>}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 rounded-2xl bg-paper p-4 text-sm leading-6 text-ink-3">이날 완성한 동화가 아직 없어요.</p>
              )}
            </section>
          </section>
        </div>
      ), document.body)}

    </main>
  );
}
