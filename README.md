# 픽토리 (Pictory)

아이의 그림(Picture)이 하나의 이야기(Story)가 된다.

아이의 고민을 동화로 겪게 하고, 아이가 고른 선택으로 부모와의 대화를 만들고, 그 대화가 다음 동화로 이어지는 서비스. (만 4~7세 · 모바일 우선 웹앱)

## 시작하기

1. Node.js LTS 설치 후 의존성 설치

```bash
npm install
```

2. 프로젝트 루트에 `.env.local` 파일을 만들고 Gemini 키를 넣는다. (이 파일은 깃에 올라가지 않는다. 키를 채팅이나 코드에 붙이지 말 것)

```
GEMINI_API_KEY=발급받은_키
CLOUDFLARE_ACCOUNT_ID=Cloudflare_계정_ID
CLOUDFLARE_API_TOKEN=Workers_AI_권한_토큰
NEXT_PUBLIC_SUPABASE_URL=Supabase_프로젝트_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=Supabase_publishable_key
SUPABASE_SERVICE_ROLE_KEY=Supabase_service_role_key
```

Supabase 프로젝트를 만든 뒤 SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql)을 한 번 실행한다. URL과 publishable key는 Supabase Project Settings → API Keys에서 확인한다. Auth → URL Configuration에 로컬 주소와 배포 도메인도 등록한다. 이 앱은 보호자 이메일·비밀번호 로그인으로 바뀌었고, 동화·감정·몽·설정 데이터는 Supabase의 `user_data` 테이블에 저장된다. 데이터는 계정별 RLS 정책으로 분리한다. 이전 닉네임 로그인 세션이 이 브라우저에 남아 있으면 첫 로그인 때 기존 기기 기록을 새 계정으로 옮긴다.

3. 개발 서버 실행 후 http://localhost:3000 접속

```bash
npm run dev
```

배포(Vercel)에는 `.env.local`이 올라가지 않는다. Vercel 프로젝트 소유자가 Settings → Environment Variables에 위 환경변수들을 추가하고 새 배포를 해야 한다. Supabase publishable key는 브라우저에서 쓰는 공개 키이며, service role key는 계정 탈퇴 API가 서버에서만 사용한다. 비밀 키나 service role key를 `NEXT_PUBLIC_` 환경변수로 설정하지 않는다.

삽화 생성에는 Cloudflare Workers AI 계정 ID와 API 토큰이 필요하다. 배포 환경에도 위 두 값을 설정한다. 직접 그리거나 PNG/JPG 그림을 올리면 원본 그림을 장면 배경에 합성한다.

선택 환경변수: `GEMINI_MODEL` (기본 `gemini-3.5-flash-lite`). 기획안의 `gemini-2.5-flash`는 신규 사용자에게 막혀 있다. `gemini-3.8-flash`는 품질이 낫지만 수요가 몰리면 수십 초 걸린다.

## Azure Speech 낭독(TTS)

현수(`ko-KR-HyunsuMultilingualNeural`)와 선히(`ko-KR-SunHiNeural`) 음성만 서버 API에서 허용한다. 브라우저는 `/api/tts`에 글과 음성 선택만 보내고, Azure Speech 키는 서버에만 둔다.

1. [Azure Portal](https://portal.azure.com/)에서 **Speech** 리소스를 만든다. 적은 사용량으로 시작하려면 가격 책정 계층에서 **F0 (Free)** 를 선택한다.
2. 생성한 Speech 리소스의 **Keys and Endpoint**에서 키를 복사하고 리소스의 지역(Region)도 확인한다. 지역은 예를 들어 `koreacentral`처럼 소문자로 입력한다.
3. 로컬에서는 `.env.local`에 다음 값을 채운다.

   ```dotenv
   AZURE_SPEECH_KEY=발급받은_Speech_키
   AZURE_SPEECH_REGION=리소스_지역
   ```

4. Vercel 프로젝트의 **Settings → Environment Variables**에도 `AZURE_SPEECH_KEY`와 `AZURE_SPEECH_REGION`을 추가한 뒤 재배포한다.

F0 실시간 Neural TTS는 월 50만 자 무료이며, 요청은 Speech 리소스당 60초에 최대 20건이다. 글자 한도와 요청 한도는 별개다. Azure 키는 `NEXT_PUBLIC_` 접두사를 붙이지 않는다.

## 구조

```
app/
  page.tsx                  → StoryApp을 렌더링할 뿐
  useStory.ts               → 동화 진행 로직 전부 (상태, API 호출, 메모 저장). 화면 없음  ← 새 화면은 이것만 연결
  StoryApp.tsx              → 훅의 값을 그리기만 하는 임시 화면 (입력 → 동화 → 선택 → 부모 카드 → 메모). 스타일 없음
  api/story/
    route.ts                → POST /api/story           이야기 시작
    continue/route.ts       → POST /api/story/continue  선택 반영 이어쓰기
    parent-card/route.ts    → POST /api/story/parent-card 부모 카드
lib/story/
  schema.ts                 → 모든 요청·응답 타입과 Gemini용 JSON 스키마  ← 가장 먼저 볼 파일
  prompts.ts                → 프롬프트 3종 (시작·이어쓰기·부모 카드). 문구만 고치면 품질이 바뀐다
  generate.ts               → Gemini 호출 (JSON 형식이 깨지면 1회 재시도)
  validate.ts               → 요청 본문 검증
  fallback.ts               → AI 실패 시 안전망 (미리 만든 동화 + 부모 카드 템플릿)
  fallback-data.json        → 프리셋 4개의 미리 만든 분기 동화 (자동 생성)
  presets.ts                → 화면의 고민 상황 프리셋 4개
scripts/
  gen-fallback.mjs          → fallback-data.json 다시 만들기
```

## 동화 한 편의 흐름

서버는 상태를 저장하지 않는다. 화면이 지금까지의 장면과 아이의 선택을 들고 있다가 매 요청에 같이 보낸다.

| 순서 | 호출 | 받는 것 |
|---|---|---|
| 1 | `POST /api/story` | 장면 2~3개(3분 2개, 5분 3개) + 첫 번째 선택 |
| 2 | 아이가 선택 → `POST /api/story/continue` (`choices` 1개) | 장면 2~3개 + 두 번째 선택 |
| 3 | 아이가 선택 → `POST /api/story/continue` (`choices` 2개) | 결말 장면 2~3개 (`isEnding: true`, `choice: null`) |
| 4 | `POST /api/story/parent-card` | 부모 카드 |
| 5 | 부모가 메모 저장 → 다음 동화는 1번에 `previousMemo`를 넣어 호출 | 메모를 이어받은 새 동화 |

### 요청 예시

```jsonc
// POST /api/story
{ "age": 5, "situation": "치과가 무서워", "durationMin": 5, "protagonist": "파란 토끼", "previousMemo": "윙 소리가 무섭대요" }
// protagonist, previousMemo는 선택

// POST /api/story/continue  (1번 응답의 title, 장면 text들, 아이가 고른 선택을 그대로 보낸다)
{ "age": 5, "situation": "치과가 무서워", "durationMin": 5, "protagonist": "파란 토끼",
  "title": "치과에 간 날",
  "scenesSoFar": ["장면1 text", "장면2 text"],
  "choices": [{ "prompt": "어떻게 할까요?", "text": "엄마 손을 꼭 잡아요", "copingType": "도움요청" }] }

// POST /api/story/parent-card
{ "age": 5, "situation": "치과가 무서워", "protagonist": "파란 토끼", "title": "치과에 간 날",
  "choices": [ /* 아이가 고른 선택 전부 */ ] }
```

### 응답 형식

- 이야기 (`StorySegment`): `{ title, scenes: [{ text, imagePrompt }], choice: { prompt, options: [{ id, text, copingType }] } | null, isEnding }`
- 부모 카드 (`ParentCard`): `{ summary, questions: [{ text, hint }] (정확히 3개), answerTip }`
- `copingType`은 `도움요청` · `스스로진정` · `회피` · `직면` 중 하나다.
- 실패하면 `{ "error": "메시지" }`와 400(입력 오류) 또는 500을 돌려준다. 화면에 그대로 보여줘도 되는 문장이다.

## 담당별로 알아둘 것

**프론트**
- **새 화면(목업)은 `useStory` 훅만 연결하면 된다.** API 호출, 장면·선택 상태, 메모 저장은 전부 [app/useStory.ts](app/useStory.ts)가 한다. 파일 맨 위 주석에 돌려주는 값과 함수 목록이 있다.
  ```tsx
  const s = useStory();
  s.step; s.error; s.title; s.scenes; s.choice; s.isEnding; s.card; s.savedMemo; s.usedFallback
  s.start({ age, situation, durationMin, protagonist }); s.pick(option); s.showCard(); s.saveMemo(text); s.nextStory(memo); s.reset();
  ```
- `StoryApp.tsx`는 훅을 쓴 임시 화면이라 통째로 갈아끼워도 된다. 스타일도 마음대로 바꾼다.
- 화면 단계는 `step`(`form` / `loading` / `story` / `card`)으로 돈다.
- `s.usedFallback`이 `true`면 AI 대신 미리 만든 동화가 쓰인 것이다. 임시 화면처럼 작은 안내 문구를 보여주면 된다.
- 선택을 누르면 1~4초 동안 `loading` 화면이 되어 기존 장면이 사라진다. 장면을 유지한 채 로딩을 표시하면 더 좋다.
- 사용자별 동화, 감정, 펫, 설정, 초안은 Supabase `user_data`에 저장한다. 브라우저 메모리는 화면 표시용 캐시이며, 로그인 직후 DB에서 다시 불러온다.
- 아직 없는 것: 삽화 표시, 낭독(TTS), 그림 업로드.

**이미지**
- 기획안의 이미지 생성은 Cloudflare Workers AI(FLUX.2 klein)다. Gemini 키로는 이미지를 만들 수 없다(무료 티어 없음).
- 각 장면의 `imagePrompt`는 영어 한 문장이고, 주인공을 항상 `the main character`로만 부른다. 주인공 외형은 캐릭터 참조 이미지로 정해지는 구조라서다.
- 그림 업로드 자리는 `StoryApp.tsx`의 "주인공" 입력칸이다.

**프롬프트**
- 문구는 `lib/story/prompts.ts`에 모여 있다. 지켜야 할 규칙: 어떤 선택도 틀린 선택으로 다루지 않는다(회피 포함), 훈계·진단·심리 분석 표현을 쓰지 않는다, 아이 이름을 받지 않는다.
- 수정 후에는 같은 입력으로 여러 번 돌려서 JSON 형식이 안 깨지는지 확인한다.

## AI가 실패할 때 (폴백)

시연 중에 Gemini가 느리거나 막혀도 멈추지 않도록 안전망이 있다. Gemini 호출은 한 번에 12초를 넘기면 포기하고(1회 재시도), 그래도 실패하면 아래로 넘어간다.

| 호출 | 실패하면 | 응답에 붙는 표시 |
|---|---|---|
| `/api/story` (시작) | 프리셋 4개(또는 "치과", "어린이집", "동생", "주사", "병원"이 들어간 직접 입력)는 미리 만든 동화를 준다. 그 외 입력은 500 에러 | `fallback: true` |
| `/api/story/continue` | 미리 만든 동화로 시작한 이야기는 계속 이어진다. AI가 만든 시작 뒤에 실패하면 500 에러 | `fallback: true` |
| `/api/story/parent-card` | 아이가 고른 선택을 끼워 넣은 템플릿 카드. 어떤 입력에도 항상 동작 | `fallback: true` |

- 미리 만든 동화는 프리셋마다 7구간(시작 1 + 선택별 중간 2 + 결말 4)이라 선택에 따라 갈라진다. 주인공은 AI가 고른 동물이라 입력한 주인공 이름은 반영되지 않는다.
- 프리셋 문구나 프롬프트를 바꿨다면 폴백 동화도 다시 만든다. `npm run dev`를 켠 상태에서 (약 3분):
  ```bash
  node scripts/gen-fallback.mjs
  ```
  결과는 `lib/story/fallback-data.json`에 저장된다. 읽어 보고 어색한 문장은 JSON을 직접 고쳐도 된다.
- 실패를 흉내 내 보려면 잘못된 키로 서버를 켠다: `GEMINI_API_KEY=x npm run dev` (PowerShell은 `$env:GEMINI_API_KEY="x"; npm run dev`).

## 개발 명령

```bash
npm run dev     # 개발 서버
npm run lint    # 린트
npm run build   # 프로덕션 빌드 (푸시 전에 한 번 돌리면 안전하다)
```

이 프로젝트의 Next.js는 일반 버전과 다른 점이 있다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 확인할 것. ([AGENTS.md](AGENTS.md) 참고)

## 아직 안 된 것

- Vercel 배포본 동작 확인 (환경변수 포함)
- 휴대폰 폭에서의 화면 확인
- 삽화, 낭독, 그림 → 캐릭터 변환
