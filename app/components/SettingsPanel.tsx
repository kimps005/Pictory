"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FONT_CLASS } from "@/lib/settings";
import { TTS_VOICES } from "@/lib/tts";
import { useApp, useAuth } from "../providers";
import Icon from "./Icon";
import { btnSecondary, Card, errorCls, Segmented } from "./ui";

const VOICE_PREVIEW = "옛날 옛적에, 작은 토끼가 살았어요. 우리 함께 동화 속으로 떠나 볼까요?";

export default function SettingsPanel() {
  const { settings, setSettings, clearMyData, n } = useApp();
  const { logOut, deleteAccount } = useAuth();
  const router = useRouter();
  const { stop } = n;
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    stop();
    return stop;
  }, [stop]);

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <h2 className="story text-xl text-ink">동화 읽어주는 목소리</h2>
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
        <button
          type="button"
          onClick={() => n.speaking ? n.stop() : void n.speak(VOICE_PREVIEW, settings.ttsVoice)}
          className={`${btnSecondary} w-full`}
        >
          <Icon name={n.speaking ? "stop" : "volume"} size={18} />
          {n.speaking ? "미리 듣기 멈춤" : "선택한 목소리 미리 듣기"}
        </button>
        {n.error && <p role="alert" className={errorCls}>{n.error}</p>}
      </Card>

      <Card className="space-y-4">
        <h2 className="story text-xl text-ink">동화 글자 크기</h2>
        <Segmented
          label="동화 글자 크기"
          value={settings.fontSize}
          onChange={(fontSize) => setSettings({ ...settings, fontSize })}
          options={[
            { value: "sm" as const, label: "작게" },
            { value: "md" as const, label: "보통" },
            { value: "lg" as const, label: "크게" },
            { value: "xl" as const, label: "아주 크게" },
          ]}
        />
        <p className={`story rounded-xl bg-sunk px-4 py-3 text-ink ${FONT_CLASS[settings.fontSize]}`}>
          옛날 옛적에, 작은 토끼가 살았어요.
        </p>
      </Card>

      <Card className="space-y-4">
        <h2 className="story text-xl text-ink">내 기록</h2>
        <p className="text-[15px] leading-7 text-ink-2">동화와 마음 기록은 계정에 저장돼, 로그인하면 다른 기기에서도 이어볼 수 있어요.</p>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("이 계정에 저장된 동화, 감정, 몽 기록과 설정을 모두 지울까요? 계정은 유지돼요.")) clearMyData();
          }}
          className={`${btnSecondary} text-danger`}
        >
          내 기록 모두 지우기
        </button>
      </Card>

      <button
        type="button"
        onClick={() => {
          void logOut().catch((error) => console.error("[sign out]", error)).finally(() => router.replace("/"));
        }}
        className={`${btnSecondary} w-full`}
      >
        로그아웃
      </button>

      <button
        type="button"
        onClick={() => {
          setDeleteError("");
          setConfirmingDeletion(true);
        }}
        className="calm w-full rounded-xl border border-danger/30 bg-paper px-4 py-3 text-[15px] font-medium text-danger hover:bg-danger/5"
      >
        계정 탈퇴
      </button>

      {confirmingDeletion && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="presentation">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-description"
            className="w-full max-w-md space-y-5 rounded-3xl border border-line bg-paper p-6 shadow-2xl"
          >
            <div className="space-y-2">
              <h2 id="delete-account-title" className="story text-2xl text-ink">계정을 탈퇴할까요?</h2>
              <p id="delete-account-description" className="text-[15px] leading-7 text-ink-2">
                탈퇴하면 저장된 동화와 마음 기록을 포함한 모든 데이터가 삭제되며, 다시 복구할 수 없어요. 정말 탈퇴하시겠어요?
              </p>
            </div>
            {deleteError && <p role="alert" className={errorCls}>{deleteError}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmingDeletion(false)}
                className={`${btnSecondary} disabled:opacity-60`}
              >
                취소
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleting(true);
                  void deleteAccount().then(({ error }) => {
                    if (error) {
                      setDeleteError(error);
                      setDeleting(false);
                      return;
                    }
                    setConfirmingDeletion(false);
                    router.replace("/");
                  }).catch(() => {
                    setDeleteError("계정을 탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.");
                    setDeleting(false);
                  });
                }}
                className="calm rounded-xl bg-danger px-5 py-3 text-[15px] font-medium text-white hover:brightness-95 disabled:opacity-60"
              >
                {deleting ? "탈퇴 처리 중…" : "계정 탈퇴"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
