# 픽토리 (Pictory)

> 아이의 그림(Picture)이 하나의 이야기(Story)가 된다.

아이가 요즘 겪는 고민을 동화로 겪어 보게 하는 모바일 우선 웹앱입니다. 아이가 이야기 속에서 고른 선택은 부모와의 대화 카드가 되고, 부모가 남긴 메모는 다음 동화로 이어집니다. 대상은 만 3~8세입니다.

```
고민 고르기 → 동화 읽기 + 선택 2번 → 부모 대화 카드 → 메모 → 다음 동화에 반영
```

## 목차

- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [빠르게 시작하기](#빠르게-시작하기)
- [환경변수](#환경변수)
- [아키텍처](#아키텍처)
- [프로젝트 구조](#프로젝트-구조)
- [API](#api)
- [AI 장애 대응 (폴백)](#ai-장애-대응-폴백)
- [보안과 개인정보](#보안과-개인정보)
- [개발 가이드](#개발-가이드)
- [배포](#배포)

## 주요 기능

| 기능 | 설명 | 화면 |
|---|---|---|
| 동화 만들기 | 고민 상황, 나이, 길이(자동 또는 1~10분)를 고르고 주인공을 직접 그릴 수 있습니다 | `/create` |
| 선택형 동화 읽기 | 장면마다 삽화가 붙고, 아이가 선택지 2번을 고르거나 직접 입력해 이야기가 갈라집니다 | `/read` |
| 낭독 | Azure Speech 음성 2종(선히·현수), 속도 3단계 | `/read` |
| 부모 대화 카드 | 아이가 고른 선택을 인용한 질문 3개와 답변 팁 | `/card` |
| 내 서재 | 끝까지 읽은 동화와 부모 메모 보관 | `/library` |
| 몽이 키우기 | 감정 스티커, 별 모으기, 돌봄으로 자라는 펫 | `/pet` |
| 부모 마음 리포트 | 최근 7일의 감정·선택·메모를 바탕으로 한 실천 제안과 주간 리포트 | `/insights` |
| 설정 | 글자 크기, 낭독 목소리, 계정 탈퇴 | `/settings` |

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | Next.js 16 (App Router, Cache Components), React 19, TypeScript |
| 스타일 | Tailwind CSS 4 |
| 이야기·리포트 생성 | Google Gemini (`@google/genai`, JSON 스키마 응답) |
| 삽화 생성 | Cloudflare Workers AI, FLUX.2 Klein 4B |
| 그림 처리 | `sharp` (종이 배경 제거, 장면 합성) |
| 낭독 | Azure Speech Neural TTS |
| 인증·DB | Supabase Auth, Postgres (RLS) |
| 배포 | Vercel |

## 빠르게 시작하기

**필요한 것:** Node.js 20 이상(LTS 권장), Supabase 프로젝트, Gemini API 키

```bash
npm install
# 프로젝트 루트에 .env.local을 만들고 아래 환경변수 표의 값을 채웁니다
npm run dev   # http://localhost:3000
```

처음 한 번만 하는 Supabase 설정:

1. Supabase SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql)을 실행합니다. `user_data` 테이블과 RLS 정책이 만들어집니다.
2. **Authentication → Providers → Email**에서 **Confirm email**을 끕니다. 아이디는 내부적으로 `아이디@accounts.pictory.app` 형식의 이메일로 저장되며, 실제 메일은 보내지 않습니다.
3. **Authentication → URL Configuration**에 로컬 주소와 배포 도메인을 등록합니다.

## 환경변수

`.env*` 파일은 `.gitignore`에 들어 있어 커밋되지 않습니다. 키를 코드나 채팅에 붙여 넣지 마세요.

| 변수 | 필수 | 범위 | 설명 |
|---|:---:|---|---|
| `GEMINI_API_KEY` | ✅ | 서버 | 동화, 부모 카드, 리포트 생성과 삽화 속 주인공 확인 |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | 공개 | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | 공개 | Supabase publishable key (브라우저용 공개 키) |
| `SUPABASE_SERVICE_ROLE_KEY` | 탈퇴 기능 | 서버 | 계정 탈퇴 API(`/api/account`)에서만 사용 |
| `CLOUDFLARE_ACCOUNT_ID` | 삽화 | 서버 | Workers AI 계정 ID |
| `CLOUDFLARE_API_TOKEN` | 삽화 | 서버 | Workers AI 권한 토큰 |
| `AZURE_SPEECH_KEY` | 낭독 | 서버 | Azure Speech 리소스 키 |
| `AZURE_SPEECH_REGION` | 낭독 | 서버 | 소문자 지역명 (예: `koreacentral`) |
| `GEMINI_MODEL` | | 서버 | 기본 모델. 기본값 `gemini-3.5-flash-lite` |
| `GEMINI_FALLBACK_MODELS` | | 서버 | 기본 모델이 실패할 때 쓸 모델(쉼표 구분). 기본값 `gemini-3.5-flash,gemini-3.6-flash` |
| `GEMINI_VISION_MODEL` | | 서버 | 주인공 확인용 비전 모델. 없으면 `GEMINI_MODEL`을 씁니다 |

> [!WARNING]
> 서버 전용 키(`SUPABASE_SERVICE_ROLE_KEY`, Cloudflare, Azure, Gemini)에는 절대 `NEXT_PUBLIC_` 접두사를 붙이지 마세요. 붙이면 브라우저 번들에 그대로 포함됩니다.

선택 기능의 키가 없으면 그 기능만 꺼집니다. 삽화 API는 503을 돌려주고, 동화와 선택은 계속 진행됩니다.

<details>
<summary>Azure Speech 리소스 만들기</summary>

1. [Azure Portal](https://portal.azure.com/)에서 **Speech** 리소스를 만듭니다. 시작 단계라면 **F0 (Free)** 계층으로 충분합니다.
2. **Keys and Endpoint**에서 키와 지역을 확인해 `.env.local`에 넣습니다.
3. F0는 Neural TTS가 월 50만 자까지 무료이고, 리소스당 60초에 20건까지 요청할 수 있습니다.

</details>

## 아키텍처

```
브라우저 (React 클라이언트)
 ├─ useStory          동화 진행 상태: 장면, 선택, 부모 카드, 이어 읽기
 ├─ useStoryImages    장면별 삽화 요청 큐 (실패해도 읽기를 막지 않음)
 ├─ useNarration      낭독 재생
 ├─ usePet            몽이 상태
 └─ lib/localStore    메모리 캐시 ⇄ Supabase user_data (사용자별 키-값)
        │
        ▼
Next.js Route Handlers (서버, 상태 없음)
 ├─ /api/story/*      → Gemini (모델 순환 재시도) → 실패하면 폴백 동화
 ├─ /api/image        → Cloudflare FLUX → Gemini 비전으로 주인공 확인 → 필요하면 아이 그림 합성
 ├─ /api/tts          → Azure Speech
 ├─ /api/insights     → Gemini → 실패하면 템플릿 리포트
 └─ /api/account      → Supabase Admin (토큰 검증 후 본인 계정만 삭제)
```

**설계 원칙**

- **서버에 이야기 상태를 두지 않습니다.** 클라이언트가 지금까지의 장면과 선택을 매 요청에 함께 보냅니다. 서버는 요청을 검증하고 생성만 합니다.
- **AI가 실패해도 화면은 멈추지 않습니다.** 동화, 부모 카드, 리포트, 삽화 배경에 각각 대체 경로가 있습니다.
- **아이 그림이 주인공입니다.** 그림을 그리면 원본에서 종이 배경을 지운 캐릭터를 모델에 참조로 줍니다. 생성된 장면에 그 캐릭터가 없으면 한 번 다시 시도하고, 그래도 없으면 배경만 그린 뒤 아이 그림을 직접 합성합니다.
- **사용자 데이터는 Supabase에만 저장합니다.** 브라우저 메모리는 화면 표시용 캐시이고, 로그인할 때 DB에서 다시 불러옵니다.

## 프로젝트 구조

```
app/
  api/                      Route Handlers (위 아키텍처 참고)
  create/ read/ card/       동화 만들기 → 읽기 → 부모 카드
  library/ pet/ insights/   서재, 몽이, 부모 리포트
  login/ settings/          로그인·가입, 설정·탈퇴
  components/               공용 UI (Shell, ui.tsx, 일러스트)
  providers.tsx             인증과 앱 전역 상태 (AuthCtx, AppCtx)
  useStory.ts               동화 진행 로직 (화면 없음)
  useStoryImages.ts         삽화 생성 큐
  useNarration.ts           낭독
  usePet.ts                 몽이 상태
  useReaderPagination.ts    큰 글씨에서 넘치는 본문을 쪽으로 나누기
lib/
  story/
    schema.ts               요청·응답 타입과 Gemini JSON 스키마 ← 먼저 볼 파일
    prompts.ts              시스템·시작·이어쓰기·부모 카드 프롬프트
    generate.ts             Gemini 호출 (모델 순환, 시간 예산 45초)
    validate.ts             요청 본문 검증
    fallback.ts             폴백 동화와 부모 카드 템플릿
    fallback-data.json      미리 만든 분기 동화 (자동 생성)
  image/                    삽화 프롬프트, Cloudflare 호출, 그림 오려내기·합성, 주인공 확인
  http.ts                   JSON 본문 파싱 공용 헬퍼
  localStore.ts             사용자 데이터 저장소 (useStored 훅)
  supabase/client.ts        브라우저 Supabase 클라이언트
scripts/gen-fallback.mjs    fallback-data.json 다시 만들기
supabase/schema.sql         DB 스키마와 RLS 정책
tests/                      node:test 회귀 테스트
```

## API

모든 엔드포인트는 `POST`(탈퇴만 `DELETE`)입니다. 실패하면 `{ "error": "화면에 보여줘도 되는 문장" }`을 돌려줍니다.

| 엔드포인트 | 요청 | 응답 |
|---|---|---|
| `/api/story` | `{ age, situation, durationMin?, protagonist?, previousMemo?, recentContext? }` | `StorySegment`: 장면 + 첫 선택 |
| `/api/story/continue` | 위 필드 + `{ title, scenesSoFar[], choices[1\|2] }` | 선택이 1개면 장면 + 두 번째 선택, 2개면 결말(`isEnding: true`) |
| `/api/story/parent-card` | `{ age, situation, protagonist?, title, choices[] }` | `ParentCard`: `{ summary, questions[3], answerTip }` |
| `/api/insights` | `{ moods[≤7], stories[≤8] }` | `ParentInsight`: `{ actionCard, weeklyReport, storyGuidance }` |
| `/api/image` | `multipart/form-data`: `mode`, `prompt`, `image_0`, `scene_ref` 등 | PNG/JPEG 이미지 (`x-protagonist-check`, `x-background-source` 헤더) |
| `/api/tts` | `{ text, voice: "sunhi"\|"hyunsu", rate: 0.7\|0.9\|1.1 }` | `audio/mpeg` |
| `/api/account` | `Authorization: Bearer <access_token>` | `{ ok: true }` |

`copingType`은 `도움요청` · `스스로진정` · `회피` · `직면` · `직접입력` 중 하나입니다. 정확한 타입은 [`lib/story/schema.ts`](lib/story/schema.ts)에 있습니다.

<details>
<summary>요청 예시</summary>

```jsonc
// POST /api/story
{ "age": 5, "situation": "치과가 무서워", "durationMin": 5, "protagonist": "파란 토끼" }

// POST /api/story/continue — 앞 응답의 title과 장면 text, 아이가 고른 선택을 그대로 보냅니다
{ "age": 5, "situation": "치과가 무서워", "title": "치과에 간 날",
  "scenesSoFar": ["장면1", "장면2"],
  "choices": [{ "prompt": "어떻게 할까요?", "text": "엄마 손을 꼭 잡아요", "copingType": "도움요청" }] }
```

</details>

## AI 장애 대응 (폴백)

Gemini 호출은 한 번에 최대 20초를 기다립니다. 실패하면 대체 모델을 돌아가며 전체 45초 안에서 다시 시도하고, 그래도 실패하면 아래 경로로 넘어갑니다. 폴백 응답에는 `fallback: true`가 붙고, 화면에 작은 안내 문구가 나옵니다.

| 호출 | 실패하면 |
|---|---|
| `/api/story` | 미리 만든 동화 4편 중 하나. 상황에 "치과", "어린이집", "동생", "주사", "병원"이 들어가야 하고, 해당하지 않으면 500 |
| `/api/story/continue` | 폴백 동화로 시작한 이야기만 이어집니다. 선택에 따라 7구간으로 갈라집니다 |
| `/api/story/parent-card` | 아이의 선택을 끼워 넣은 템플릿 카드 (항상 성공) |
| `/api/insights` | 템플릿 리포트 (항상 성공) |
| `/api/image` | 사용량 초과나 장애일 때 로컬 기본 배경에 아이 그림을 합성 |

폴백 동화 다시 만들기 (`npm run dev`를 켠 상태에서 약 3분):

```bash
node scripts/gen-fallback.mjs
```

> [!NOTE]
> 화면 프리셋([`lib/story/presets.ts`](lib/story/presets.ts))과 스크립트의 프리셋 목록은 다릅니다. 프리셋 문구를 바꿨다면 스크립트의 `PRESETS`도 함께 맞춘 뒤 다시 생성하세요.

폴백 경로 직접 확인하기 (PowerShell):

```powershell
$env:GEMINI_API_KEY="x"; npm run dev
```

## 보안과 개인정보

- **계정 분리:** `user_data`는 RLS 정책(`auth.uid() = user_id`)으로 본인 행만 읽고 쓸 수 있습니다. 비로그인(`anon`) 권한은 회수돼 있습니다.
- **탈퇴:** 서버가 access token을 Supabase로 검증한 뒤 그 사용자만 삭제합니다. 데이터는 `ON DELETE CASCADE`로 함께 지워집니다.
- **입력 검증:** 모든 API가 길이와 형식을 서버에서 다시 검증합니다. 낭독 텍스트는 XML 특수문자를 처리한 뒤 SSML에 넣습니다.
- **아이 정보 최소화:** 프롬프트는 아이 이름을 받지 않고, 진단·훈계 표현을 쓰지 않도록 설계돼 있습니다.

> [!IMPORTANT]
> **알려진 제한 사항**
> - 시연용 로컬 관리자 계정(`admin123`)이 클라이언트 코드에 들어 있습니다. 이 계정의 데이터는 그 브라우저의 `localStorage`에만 저장됩니다.
> - 생성 API(`/api/story*`, `/api/image`, `/api/tts`)에 로그인 확인과 사용량 제한이 없습니다. 공개 배포 전에 추가를 검토하세요.

## 개발 가이드

```bash
npm run dev                     # 개발 서버
npm run lint                    # ESLint
npx tsc --noEmit                # 타입 검사
node --test tests/*.test.cjs    # 테스트
npm run build                   # 프로덕션 빌드
```

푸시 전에는 린트, 타입 검사, 테스트, 빌드를 모두 통과시키세요.

**작업할 때 알아둘 것**

- **이 저장소의 Next.js는 일반 버전과 API가 다릅니다.** 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 확인하세요. ([AGENTS.md](AGENTS.md))
- **새 화면은 `useApp()`으로 상태를 받습니다.** 동화 진행은 `s`(`useStory`), 낭독은 `n`, 펫은 `pet`입니다. 화면 단계는 `s.step`(`form` → `loading` → `story` → `card`)으로 움직입니다.
- **사용자 데이터는 `useStored(key)`로 읽고 `writeRaw(key, value)`로 씁니다.** 키는 `story-choice:<종류>:<userId>` 형식입니다.
- **프롬프트를 고칠 때** ([`lib/story/prompts.ts`](lib/story/prompts.ts)):
  - 어떤 선택도 틀린 선택으로 다루지 않습니다(회피 포함).
  - 진단·훈계 표현을 쓰지 않습니다.
  - 수정한 뒤 같은 입력으로 여러 번 돌려 JSON 형식이 깨지지 않는지 확인합니다.
- **삽화 프롬프트**에서 주인공은 항상 `the main character`로만 부릅니다. 외형은 참조 이미지나 `characterBible`이 정합니다.
- 커밋 메시지는 간결한 한국어로 씁니다.

## 배포

Vercel에 배포합니다. `.env.local`은 배포되지 않으므로 **Settings → Environment Variables**에 [환경변수](#환경변수)를 모두 넣고 다시 배포하세요. 삽화 API는 `maxDuration = 120`초를 쓰므로 이 실행 시간을 지원하는 플랜이 필요합니다.
