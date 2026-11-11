"use client";

// 앱 전체에서 공유하는 상태: 로그인, 동화 진행(useStory), 낭독(useNarration), 내 서재, 설정.
//
// 계정 인증과 사용자 데이터 저장은 Supabase Auth 및 RLS가 적용된 Postgres를 사용한다.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseLibrary, type SavedStory } from "@/lib/library";
import { clearUserData, clearUserDataMemory, hydrateLocalUserData, hydrateUserData, readRaw, useStored, waitForUserDataWrites, writeRaw } from "@/lib/localStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "@/lib/settings";
import { useNarration } from "./useNarration";
import { usePet } from "./usePet";
import { useStory } from "./useStory";

// ───────── 로그인 ─────────

const ADMIN_ID = "admin123";
const ADMIN_PASSWORD = "admin123";
const ADMIN_USER_ID = "local-admin";
const ADMIN_SESSION_KEY = "story-choice:admin-session";
const ACCOUNT_DOMAIN = "accounts.pictory.app";
const ACCOUNT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{3,19}$/;

function accountEmail(idOrEmail: string) {
  const value = idOrEmail.trim().toLowerCase();
  return value.includes("@") ? value : `${value}@${ACCOUNT_DOMAIN}`;
}

interface AuthValue {
  ready: boolean;
  user: string | null;
  displayName: string;
  authError: string;
  signUp: (accountId: string, password: string, nickname: string) => Promise<{ error: string; notice?: string }>;
  logIn: (accountIdOrEmail: string, password: string) => Promise<{ error: string; notice?: string }>;
  logOut: () => Promise<void>;
  deleteAccount: () => Promise<{ error: string }>;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth는 AppProviders 안에서만 쓸 수 있어요.");
  return v;
}

// ───────── 앱 상태 ─────────

type StoryHook = ReturnType<typeof useStory>;
type NarrationHook = ReturnType<typeof useNarration>;
type PetHook = ReturnType<typeof usePet>;

interface AppValue {
  user: string;
  displayName: string;
  s: StoryHook;
  n: NarrationHook;
  pet: PetHook;
  library: SavedStory[];
  settings: Settings;
  setSettings: (next: Settings) => void;
  saveMemo: (text: string) => void; // 방금 읽은 동화의 메모로 저장 + 다음 동화에 이어짐
  deleteStory: (id: string) => void;
  clearMyData: () => void;
}

const AppCtx = createContext<AppValue | null>(null);

export function useApp() {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp은 로그인한 화면 안에서만 쓸 수 있어요.");
  return v;
}

function StoryProvider({ user, displayName, children }: { user: string; displayName: string; children: ReactNode }) {
  const s = useStory(user);
  const n = useNarration();

  const libKey = `story-choice:library:${user}`;
  const settingsKey = `story-choice:settings:${user}`;
  const libRaw = useStored(libKey);
  const settingsRaw = useStored(settingsKey);
  const library = useMemo(() => parseLibrary(libRaw), [libRaw]);
  const settings = useMemo(() => parseSettings(settingsRaw), [settingsRaw]);
  const pet = usePet(user, library);
  const markPetCare = pet.markCare;
  const clearStoryDraft = s.clearDraft;

  // 부모 카드가 만들어지면 그 동화를 서재에 한 번 저장한다.
  const savedCard = useRef<unknown>(null);
  const currentId = useRef("");
  useEffect(() => {
    if (s.step !== "card" || !s.card || !s.req || savedCard.current === s.card) return;
    savedCard.current = s.card;
    const id = String(Date.now());
    currentId.current = id;
    const entry: SavedStory = {
      id,
      createdAt: Date.now(),
      title: s.title,
      situation: s.req.situation,
      age: s.req.age,
      protagonist: s.req.protagonist,
      scenes: s.scenes,
      choices: s.chosen,
      card: s.card,
      memo: "",
    };
    writeRaw(libKey, JSON.stringify([entry, ...parseLibrary(readRaw(libKey))]));
    markPetCare();
    clearStoryDraft();
  }, [s.step, s.card, s.req, s.title, s.scenes, s.chosen, libKey, markPetCare, clearStoryDraft]);

  const saveMemo = useCallback(
    (text: string) => {
      s.saveMemo(text);
      const list = parseLibrary(readRaw(libKey));
      const i = list.findIndex((x) => x.id === currentId.current);
      if (i >= 0) {
        list[i] = { ...list[i], memo: text.trim() };
        writeRaw(libKey, JSON.stringify(list));
      }
      if (text.trim()) markPetCare();
    },
    [s, libKey, markPetCare],
  );

  const deleteStory = useCallback(
    (id: string) => writeRaw(libKey, JSON.stringify(parseLibrary(readRaw(libKey)).filter((x) => x.id !== id))),
    [libKey],
  );

  const clearMyData = useCallback(() => {
    void clearUserData().catch((error) => console.error("[clear user data]", error));
    s.reset();
  }, [s]);

  const setSettings = useCallback((next: Settings) => writeRaw(settingsKey, JSON.stringify(next)), [settingsKey]);

  const value: AppValue = { user, displayName, s, n, pet, library, settings: settings ?? DEFAULT_SETTINGS, setSettings, saveMemo, deleteStory, clearMyData };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState("");

  const activateUser = useCallback(async (id: string, name: string) => {
    await hydrateUserData(id);
    setUser(id);
    setDisplayName(name || "보호자");
    setAuthError("");
  }, []);

  const activateAdmin = useCallback(() => {
    hydrateLocalUserData(ADMIN_USER_ID);
    localStorage.setItem(ADMIN_SESSION_KEY, "1");
    setUser(ADMIN_USER_ID);
    setDisplayName("관리자");
    setAuthError("");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        if (localStorage.getItem(ADMIN_SESSION_KEY) === "1") {
          activateAdmin();
          setReady(true);
          return;
        }
        const client = getSupabaseBrowserClient();
        if (!client) {
          setAuthError("Supabase 설정이 아직 연결되지 않았어요. 프로젝트 관리자에게 환경변수 설정을 요청해 주세요.");
          setReady(true);
          return;
        }
        try {
          const { data, error } = await client.auth.getUser();
          if (error && error.name !== "AuthSessionMissingError") throw error;
          if (data.user) await activateUser(data.user.id, String(data.user.user_metadata?.nickname ?? data.user.email?.split("@")[0] ?? "보호자"));
        } catch (error) {
          setAuthError(error instanceof Error ? `계정 정보를 불러오지 못했어요: ${error.message}` : "계정 정보를 불러오지 못했어요.");
        } finally {
          setReady(true);
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activateAdmin, activateUser]);

  const signUp = useCallback(async (accountId: string, password: string, nickname: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return { error: "Supabase 설정이 아직 연결되지 않았어요." };
    const normalizedId = accountId.trim().toLowerCase();
    if (!ACCOUNT_ID_PATTERN.test(normalizedId)) return { error: "아이디는 영문 소문자나 숫자로 시작해 4~20자로 만들어 주세요. _와 -도 쓸 수 있어요." };
    if (normalizedId === ADMIN_ID) return { error: "이미 사용 중인 아이디예요." };
    if (password.length < 8) return { error: "비밀번호는 8자 이상이어야 해요." };
    if (!nickname.trim()) return { error: "보호자 닉네임을 입력해 주세요." };
    const { data, error } = await client.auth.signUp({
      // Supabase Auth 내부 식별자일 뿐이며 실제 이메일 발송에는 사용하지 않는다.
      email: accountEmail(normalizedId),
      password,
      options: {
        data: { nickname: nickname.trim().slice(0, 20), accountId: normalizedId },
      },
    });
    if (error) {
      const lower = error.message.toLowerCase();
      const message = lower.includes("already") || lower.includes("registered")
        ? "이미 사용 중인 아이디예요."
        : lower.includes("email rate limit exceeded")
          ? "Supabase에서 이메일 인증이 아직 켜져 있어요. Authentication 설정에서 Confirm email을 꺼 주세요."
          : error.message;
      return { error: message };
    }
    if (data.user && data.session) {
      try { await activateUser(data.user.id, nickname.trim()); }
      catch { return { error: "계정은 만들어졌지만 DB를 불러오지 못했어요. 잠시 후 다시 로그인해 주세요." }; }
      return { error: "" };
    }
    return { error: "가입은 요청됐지만 바로 로그인되지 않았어요. Supabase에서 Confirm email을 꺼 주세요." };
  }, [activateUser]);

  const logIn = useCallback(async (accountIdOrEmail: string, password: string) => {
    const identifier = accountIdOrEmail.trim().toLowerCase();
    if (identifier === ADMIN_ID) {
      if (password !== ADMIN_PASSWORD) return { error: "관리자 아이디 또는 비밀번호가 맞지 않아요." };
      activateAdmin();
      return { error: "" };
    }
    const client = getSupabaseBrowserClient();
    if (!client) return { error: "Supabase 설정이 아직 연결되지 않았어요." };
    const { data, error } = await client.auth.signInWithPassword({ email: accountEmail(identifier), password });
    if (error) return { error: error.message };
    try {
      await activateUser(data.user.id, String(data.user.user_metadata?.nickname ?? data.user.email?.split("@")[0] ?? "보호자"));
      return { error: "" };
    } catch {
      return { error: "DB를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
  }, [activateAdmin, activateUser]);

  const logOut = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    await waitForUserDataWrites();
    clearUserDataMemory();
    localStorage.removeItem(ADMIN_SESSION_KEY);
    setUser(null);
    setDisplayName("");
    if (client) await client.auth.signOut();
  }, []);

  const deleteAccount = useCallback(async () => {
    await waitForUserDataWrites();
    if (user === ADMIN_USER_ID) {
      await clearUserData();
      clearUserDataMemory();
      localStorage.removeItem(ADMIN_SESSION_KEY);
      setUser(null);
      setDisplayName("");
      return { error: "" };
    }

    const client = getSupabaseBrowserClient();
    if (!client) return { error: "Supabase 설정을 확인해 주세요." };
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !session?.access_token) return { error: "로그인 정보를 확인할 수 없어요. 다시 로그인한 뒤 시도해 주세요." };

    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      return { error: body.error || "계정을 탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요." };
    }

    clearUserDataMemory();
    setUser(null);
    setDisplayName("");
    // 계정 삭제로 refresh token도 폐기되어 signOut 오류는 무시한다.
    await client.auth.signOut().catch(() => undefined);
    return { error: "" };
  }, [user]);

  const auth: AuthValue = { ready, user, displayName, authError, signUp, logIn, logOut, deleteAccount };

  return (
    <AuthCtx.Provider value={auth}>
      {/* 계정이 바뀌면 동화 진행 상태도 새로 시작하도록 key를 준다 */}
      {user ? (
        <StoryProvider key={user} user={user} displayName={displayName}>
          {children}
        </StoryProvider>
      ) : (
        children
      )}
    </AuthCtx.Provider>
  );
}
