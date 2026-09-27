# Setup Copilot — 프로젝트 스펙

크롬 확장(MV3) + 백엔드 API. 웹 서비스의 설정 화면을 **읽기 전용으로 관찰**하면서, 사용자에게 한 번에 한 단계씩 설정 방법을 안내하는 대화형 셋업 위저드.

**프로젝트의 메인 자산은 설정 지식 DB다.** 확장은 이 DB 를 소비하고, 사용자의 관측 결과를 (옵트인으로) 기여하는 클라이언트다. 사이트 UI 가 바뀌면 새 스냅샷이 append 되고 옛 버전은 히스토리로 남는다.

이 문서는 구현 계약서다. 여기 적힌 제약은 편의를 위해 완화하지 말 것. 애매한 지점이 나오면 임의로 결정하지 말고 질문할 것.

---

## 1. 제품 원칙

이 다섯 가지가 다른 모든 결정을 이긴다.

1. **자동화하지 않는다.** 확장은 값을 바꾸거나 버튼을 클릭하지 않는다. DOM은 읽기만 하고, 사용자에게 무엇을 할지 알려준다. 유일하게 허용되는 페이지 조작은 `scrollIntoView`와 하이라이트 오버레이뿐이다.
2. **사실만 말한다.** 안내 문구는 DB 의 확정 원문이거나 실제로 관측된 DOM 값을 근거로 한 것이어야 한다. **관측되지 않은 라벨은 어떤 경로로도 사용자에게 노출하지 않는다** (LLM 초안 포함).
3. **한 번에 한 단계.** 렌더링 슬롯은 하나뿐이다. 단계 인덱스는 검증 통과로만 증가한다. 모델 응답은 인덱스에 영향을 줄 수 없다.
4. **설정 외의 대화를 하지 않는다.** 범위 밖 요청은 고정 문구로 거절하고 가능한 항목 목록을 다시 보여준다.
5. **모든 절차는 검증 가능하다.** `verify` 없는 step 은 DB 저장·클라이언트 실행 모두 거부한다.

---

## 2. 시스템 구성

```
[Chrome Extension MV3]                    [Backend API]                 [DB — PostgreSQL]
   sidepanel  ─── LLM (router, recover)      /sites                        sites
   content/probe.js ── DOM signature         /pages                        pages
   lib/catalog.js  ── API client + cache     /snapshots                    page_snapshots
   lib/snapshot.js ── drift 판정             /goals                        goals
   lib/contrib.js  ── 기여 스크럽/업로드      /procedures                   procedures
                                              /contributions (write)        contributions
                                              /guidance/propose (admin)     guidance_proposals
                                              /guidance/verify
                                              seed-from-packs 스크립트
```

확장은 백엔드에 직접 fetch 한다. 확장 안에서 DB 를 다루지 않는다. 오프라인 fallback 은 IndexedDB 미러.

### 파일 명세

```
setup-copilot/                (확장)
  manifest.json
  background/service-worker.js
  lib/
    storage.js               chrome.storage.local 래퍼
    providers.js             AI 공급자 어댑터 (통합 chat())
    catalog.js               API 클라이언트 + IndexedDB 캐시
    snapshot.js              signature 계산, drift/redesign 판정
    contrib.js               관측 스크럽 + 기여 업로드
    engine.js                상태 기계 (단계 진행, 검증)
    router.js                사용자 문장 → (site, goal) 분류 (LLM 지점 1)
    recover.js               막힘 해설 (LLM 지점 2)
  content/probe.js           DOM 관측, 로케이터 해석, signature 추출, 하이라이트
  sidepanel/  panel.html, panel.css, panel.js
  options/    options.html, options.css, options.js
  packs/                     seed JSON (백엔드 부트스트랩용, 확장 런타임 fallback 겸용)
  icons/                     16/32/48/128 png
  README.md

api-server/                  (별도 배포)
  src/routes/                REST endpoints
  src/proposal/              LLM 초안 파이프라인
  src/scrub/                 개인정보 정규식 스크럽
  migrations/                스키마 마이그레이션
  scripts/seed-from-packs.js
```

`background/service-worker.js`, `sidepanel/panel.js`, `options/options.js` 는 ES 모듈. LLM 호출과 오케스트레이션은 사이드패널에서 직접 수행한다.

---

## 3. 매니페스트

```json
{
  "manifest_version": 3,
  "name": "Setup Copilot",
  "version": "0.1.0",
  "minimum_chrome_version": "116",
  "permissions": ["storage", "sidePanel", "scripting", "tabs"],
  "host_permissions": [
    "https://api.setup-copilot.example/*",
    "https://api.anthropic.com/*",
    "https://api.openai.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "optional_host_permissions": ["*://*/*"],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "side_panel": { "default_path": "sidepanel/panel.html" },
  "options_page": "options/options.html",
  "action": { "default_title": "Setup Copilot 열기" }
}
```

대상 사이트는 매니페스트에 박지 않는다. 사용자가 특정 사이트를 처음 쓸 때 `chrome.permissions.request({ origins })` 로 해당 도메인만 받는다. 이 호출은 사용자 제스처 안에서 일어나야 한다.

서비스 워커는 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` 를 설치 시 호출하고, 최초 설치 시 옵션 페이지를 연다.

---

## 4. 데이터 모델

### 4.1 확장 로컬 설정 (`chrome.storage.local`)

`sc.settings` 키 하나.

```ts
type Settings = {
  version: 2;
  providers: Provider[];
  activeProviderId: string | null;
  contributionOptIn: boolean;      // 기본 false
  contributorHash: string | null;  // 익명 UID 해시 (기여 dedupe 용)
};

type Provider = {
  id: string;
  label: string;
  kind: "anthropic" | "openai" | "gemini" | "compatible";
  apiKey: string;
  model: string;
  baseUrl?: string;
};
```

`chrome.storage.sync` 는 **쓰지 않는다.** API 키가 구글 계정으로 동기화되면 안 된다. `storage.local` 도 평문이므로 옵션 페이지에 명시할 것.

`contributorHash` 는 `crypto.randomUUID()` 를 SHA256 한 값. 옵션 토글을 켤 때 최초 생성.

### 4.2 DB 스키마

**append-only 원칙: 옛 스냅샷·옛 절차는 물리 삭제하지 않는다. `superseded_by` / `status` 로만 표시한다.**

#### `sites`
```
site_id           PK          "tistory"
label                         "티스토리"
matches           JSON        Chrome match pattern 배열
entry_url                     설정 최상위 URL
entry_ready       JSON        Locator (진입 판정)
active            bool
created_at, updated_at
```

#### `pages`
사이트 내 개별 설정 화면 (논리적 route).
```
page_id           PK          "tistory:/manage/skin"
site_id           FK
route                         URL path 패턴 또는 논리 이름
label                         "스킨 관리"
canonical_probes  JSON        이 page 를 식별하는 최소 Locator 집합
latest_snapshot_id  FK        page_snapshots (핫 포인터)
```

#### `page_snapshots` — 페이지 구조의 시점 캡처 (핵심)
```
snapshot_id       PK          UUID
page_id           FK
structural_hash   TEXT        정규화된 signature 의 SHA256
dom_signature     JSON        DomSignature[] (스크럽 후)
observed_at       TIMESTAMP   최초 관측
last_seen_at      TIMESTAMP   최근 확인
observed_count    INT
contributor_count INT
superseded_by     FK          nullable, page_snapshots
status                        active | deprecated | rejected
diff_summary      JSON        이전 스냅샷 대비 라벨 추가/삭제/변경 요약
source                        seed | contributed | scraped
```

`pages.latest_snapshot_id` 만 이동한다. 옛 스냅샷은 남는다.

#### `goals` — 사용자 의도 (라우터 후보)
```
goal_id           PK          "tistory.skin_change"
site_id           FK
label                         "스킨 변경"
synonyms          JSON        ["스킨 바꾸기","테마 변경","블로그 디자인 변경"]
procedure_ids     JSON        실행할 procedure 순서 배열
active            bool
```

#### `procedures` — 스냅샷에 종속되는 실행 단위
```
procedure_id      PK
goal_id           FK
page_id           FK
compatible_snapshots  JSON    snapshot_id 배열 (이 절차가 유효한 스냅샷들)
steps             JSON        Step[]  — instruct/probe_ref/verify/onFail
authored_by                   human | llm_proposed | community_edit
verified          bool
verified_by
verified_at
supersedes        FK          이전 procedure_id (재작성된 경우)
```

절차는 스냅샷 갱신 시 자동 적응 시도 → 실패한 step 이 하나라도 있으면 초안 큐로.

#### `contributions` — 사용자 관측 기여 (옵트인)
```
contribution_id   PK
page_id           FK
snapshot_id       FK          매치되거나 새로 만든 스냅샷
raw_signature_hash            스크럽 전 원본 해시 (dedupe)
scrubbed_signature JSON       개인정보 제거된 관찰
contributor_hash              익명 UID 해시
submitted_at
change_type                   match | new_snapshot | drift_detected
```

#### `guidance_proposals` — LLM 이 생성한 절차 초안
```
proposal_id       PK
snapshot_id       FK
draft_procedure   JSON
llm_model
web_search_refs   JSON        [{url, title, quote}]
observed_only     bool        관측된 signature 안의 라벨만 사용했는지 (자동 검증)
status                        pending | approved | rejected
reviews           JSON        [{reviewer, at, decision, note}]
```

`observed_only = false` 이면 서버가 저장 자체를 거부한다. 승인되면 `procedures` 로 승격.

### 4.3 로케이터

문자열 텍스트 기준을 기본으로 한다. 해시 클래스명은 UI 개편 한 번에 전부 죽는다. `css` 는 최후 수단.

```ts
type Locator =
  | { by: "css"; selector: string }
  | { by: "labelText"; text: string; control?: "select" | "input" | "checkbox" | "textarea" }
  | { by: "linkText"; text: string }
  | { by: "buttonText"; text: string }
  | { by: "textPresent"; text: string }
  | { by: "urlIncludes"; text: string };
```

`labelText` 는 `<label for>` → 라벨 형제·부모 내 첫 컨트롤 순으로 탐색. 텍스트 비교는 공백 정규화 후 부분 일치.

### 4.4 검증

```ts
type Verify =
  | { probe: string; is: "found" | "notFound" | "checked" | "unchecked" }
  | { probe: string; is: "valueIn"; values: string[] }
  | { probe: string; is: "textPresent"; text: string }
  | { is: "urlIncludes"; text: string };
```

**검증 판정은 전부 로컬 JS다. 모델을 호출하지 않는다.** 값 비교는 공백 제거 후 수행한다.

### 4.5 signature

```ts
type DomSignature = {
  tag: string;
  role?: string;
  ariaLabel?: string;
  text: string;              // 200자 자름, 스크럽 후
  nearLabels: string[];      // 근처 라벨 최대 3개
}[];
```

정규화 후 안정 정렬 → SHA256 → `structural_hash`.

---

## 5. 관측 + Signature (content/probe.js, lib/snapshot.js)

`chrome.scripting.executeScript({ files: ["content/probe.js"] })` 로 필요할 때 주입. 중복 주입 가드(`window.__scProbe`).

`chrome.tabs.sendMessage` 로 명령:

- `{ cmd: "probe", locators }` → `ProbeResult`
- `{ cmd: "signature", scope? }` → `DomSignature[]` (설정 UI 로 판단되는 폼 컨트롤·링크·헤더·버튼만)
- `{ cmd: "highlight", locator }` → 스크롤 + 2초 하이라이트

```ts
type ProbeResult = {
  url: string;
  title: string;
  found: Record<string, {
    found: boolean;
    tag?: string;
    type?: string;
    value?: string;
    checked?: boolean;
    text?: string;    // 200자 제한, 스크럽 후
    visible?: boolean;
    disabled?: boolean;
  }>;
};
```

### 스크럽 규칙 (probe 결과와 signature 모두 적용)

- 이메일 정규식, 전화번호, URL 안의 사용자 식별자(`{blog}.tistory.com` 의 `{blog}`) 는 `***` 로 치환
- 사용자 작성 콘텐츠(글 제목/본문 영역) 는 signature 대상에서 제외
- 로그인 컨텍스트에서 알려진 사용자 이름은 마스킹
- `text` 는 200 자 자름

**DOM 전체를 절대 반환하지 않는다.** 요청된 로케이터 결과 또는 설정 UI 범위의 signature 만 반환.

SPA 대응: `MutationObserver` 로 최대 5초 대기 후 재시도. iframe: `allFrames: true` 로 주입, 프레임별 결과 중 `found` 개수가 가장 많은 것을 채택.

---

## 6. 엔진 (lib/engine.js) + 스냅샷 관리 (lib/snapshot.js)

### 6.1 세션 상태

```ts
type Session = {
  tabId: number;
  siteId: string | null;
  goalId: string | null;
  pageId: string | null;
  snapshotId: string | null;         // 이번 세션이 실행 중인 snapshot
  procedureId: string | null;
  procIdx: number;
  stepIdx: number;
  attempts: number;
  status: "resolving" | "entry" | "running" | "blocked" | "done" | "draft";
  isDraft: boolean;                  // procedure.verified === false 이면 true
};
```

세션은 `tabId` 를 키로 보관. `chrome.tabs.onRemoved` 에서 정리.

### 6.2 진행 루프

```
사용자 goal 선택 (라우터 또는 chip)
   ↓
site 대상 확인
   ├ 다른 사이트 → status = "entry" → entry_url 로 이동 유도
   └ 대상 사이트
       ↓
   canonical_probes 로 page 식별
       ↓
   page.latest_snapshot_id 로드 → 현재 관측 signature 계산
       ↓
   비교:
     hash == latest.hash               → verified procedure 실행
     자카드 >= 0.7 (drift)             → 새 snapshot 임시 생성 → 기존 procedure 재매핑 시도
                                          ├ 성공: compatible_snapshots 에 추가, running
                                          └ 실패: 초안 큐 진입, draft
     자카드 < 0.7 (redesign)           → 새 snapshot, 기존 procedure 무효, draft
       ↓
   (contributionOptIn) 관측 스크럽 후 /contributions 업로드
       ↓
   실행 루프 (기존과 동일):
     - 1초 폴링, 현재 단계 verify probe
     - 통과 → stepIdx++, attempts=0
     - "안 돼요" → attempts++, 2회 → blocked → recover 호출
```

폴링은 패널이 보이지 않을 때(`document.hidden`) 멈춘다.

### 6.3 이미 통과 스킵

시작 시 전체 단계를 한 번 probe 해서 통과한 앞부분은 스킵하고 시작한다.

### 6.4 drift / redesign 판정

- **drift** (라벨 자카드 ≥ 0.7): 새 snapshot 임시 생성. 기존 procedure 의 각 `probe_ref` 를 새 signature 에 재매핑 (라벨 정확 매치 → 유사 매치). 모든 step 이 매핑되면 verified 유지, 새 snapshot 을 `compatible_snapshots` 에 추가. 하나라도 실패하면 초안 큐.
- **redesign** (자카드 < 0.7): 새 snapshot 은 무조건 초안. UI 상단에 "이 페이지 구조가 크게 바뀐 것 같습니다. 커뮤니티 확인 전까지는 수동 안내로 진행됩니다." 표시.
- **초안 절차 실행**: 클라이언트가 `guidance_proposals` API 로 pending 초안을 조회. 있으면 "미검증 초안" 배지 + 사용자에게 실행 여부를 명시적으로 물음. 없으면 blocked 상태로 recover 유도.

---

## 7. LLM 사용 지점

기본 경로에서는 모델을 호출하지 않는다. 확장에는 두 지점, 백엔드에는 한 지점.

두 클라이언트 호출은 **stateless**. 대화 히스토리 누적 금지.

### 7.1 라우터 (lib/router.js) — 전역

이전 스펙에서는 현재 pack 안에서만 분류했다. 이제 **모든 site 의 모든 goal 을 후보로** 삼는다.

```js
const system = `당신은 설정 절차 분류기입니다. 답변을 생성하지 마세요.
사용자 문장을 아래 목록 중 하나로 분류해 JSON만 출력합니다.

사용 가능한 goal (형식: site_id.goal_id: label):
${allGoals.map(g => `- ${g.siteId}.${g.id}: ${g.label}`).join("\n")}

규칙:
- 목록에 없는 요청은 반드시 "out_of_scope"
- 설정 변경 외의 요청(글쓰기, 코드, 잡담)은 "out_of_scope"
- 확신이 없으면 candidates 에 최대 3개, intent 는 "ambiguous"
- 설명, 인사, 추가 문장 금지

출력 형식: {"intent":"goal"|"ambiguous"|"out_of_scope","candidates":["site_id.goal_id"]}`;
```

응답은 코드가 다시 검증한다. 카탈로그에 없는 ID 는 그 자리에서 버려진다.

```js
const valid = new Set(allGoals.map(g => `${g.siteId}.${g.id}`));
const picked = (parsed.candidates ?? []).filter(id => valid.has(id)).slice(0, 3);
if (parsed.intent === "out_of_scope" || picked.length === 0) return { kind: "refuse" };
if (picked.length > 1 || parsed.intent === "ambiguous") return { kind: "choose", ids: picked };
const [siteId, goalId] = picked[0].split(".");
return { kind: "goal", siteId, goalId };
```

**refuse 문구는 코드에 하드코딩된 고정 문자열이다.** 모델이 거절 문장을 쓰게 두면 거기서 대화가 이어진다.

> 이 화면에서 도울 수 있는 설정이 아닙니다. 지금 여기서 가능한 항목은 다음과 같습니다.

그리고 상위 goal 목록을 다시 렌더한다.

### 7.2 복구 해설 (lib/recover.js)

같은 단계를 2회 실패했을 때만 호출. 컨텍스트에는 현재 단계와 관측값만.

```js
const system = `당신은 설정 안내 도우미입니다. 아래 observed 에 실제로 존재하는 항목만 언급하세요.
observed 에 없는 메뉴, 버튼, 경로를 지어내면 안 됩니다.
필요한 요소가 observed 에 없으면 정확히 이렇게 답하세요:
"화면 구조가 예상과 다릅니다. 수동으로 진행해야 할 수 있습니다."
2~3문장, 한국어, 다음 행동 하나만 제시하세요.`;

const user = JSON.stringify({ step: step.instruct, observed: probeResult.found, attempts });
```

응답 길이 400자 자름.

### 7.3 절차 초안 생성 (백엔드 `/guidance/propose`) — 관리자 전용

새 snapshot 이 초안 큐에 들어왔을 때, 관리자가 트리거하는 절차 초안 생성.

- 입력: `snapshot.dom_signature` + `goal.label` + 선택적 `web_search_refs`
- 프롬프트 제약: **관측된 signature 안의 라벨만 사용**하여 초안 작성. 모든 step 은 verify 필수. verify.probe 는 signature 에 존재하는 요소만 참조.
- 자동 검증: 서버가 생성 결과에서 `observed_only` 를 판정. false 이면 저장 자체 거부.
- 웹검색은 **참조로만 남기고 실행 판정에 사용하지 않는다.** 실행 판정은 언제나 실제 DOM 관측.
- 승인 전에는 클라이언트에 절대 전달되지 않는다.

---

## 8. 공급자 어댑터 (lib/providers.js)

통합 인터페이스 하나만 노출.

```ts
async function chat(provider: Provider, opts: {
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
}): Promise<string>
```

| kind | 엔드포인트 | 인증 | 응답 경로 |
|---|---|---|---|
| `anthropic` | `https://api.anthropic.com/v1/messages` | `x-api-key` | `content[].text` |
| `openai` | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer` | `choices[0].message.content` |
| `gemini` | `.../v1beta/models/{model}:generateContent` | `?key=` | `candidates[0].content.parts[].text` |
| `compatible` | `{baseUrl}/chat/completions` | `Authorization: Bearer` | openai 와 동일 |

Anthropic 은 브라우저 직접 호출 시:
```
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
```

시스템 프롬프트 위치는 공급자마다 다르다. 어댑터가 흡수.

오류 매핑: 401/403 → "API 키를 확인해 주세요", 429 → "요청이 많습니다", 5xx → "일시적인 문제". 원본 오류 본문 노출 금지.

---

## 9. 화면

### 9.1 사이드패널 상태

**기본 진입점은 `prompt`.** 사용자는 어디에 있든 프롬프트로 시작한다. 이전 스펙의 `ready` (사이트별 진입) 는 제거.

| 상태 | 조건 | 화면 |
|---|---|---|
| `no-provider` | provider 없음 | 안내 + 인라인 폼. **입력창 없음.** |
| `prompt` | provider OK, 세션 없음 | "어떤 설정을 도와드릴까요?" + 입력창 + 자주 쓰는 goal 상위 5개 chip |
| `resolving` | 라우터 판정 중 | 회전 인디케이터 (텍스트 없음) |
| `choose` | 라우터가 ambiguous | 후보 goal 3개 카드, 각각 사이트명 표시 |
| `refuse` | 범위 밖 | 고정 문구 + prompt 로 복귀 |
| `entry` | 대상 사이트 밖 또는 대상 페이지 밖 | 진입 카드 (버튼 → `chrome.tabs.update(entry_url)`) |
| `page-unknown` | 사이트는 맞지만 canonical_probes 실패 | 관측 signature 를 백엔드에 조회 중 표시 |
| `running` | 세션 진행, verified 절차 | 스텝 레일 + 현재 단계 |
| `draft` | 세션 진행, 초안 절차 | 상단에 "미검증 초안" 배지, 나머지는 running 과 동일 |
| `blocked` | 2회 실패 | 복구 해설 + "수동으로 진행" / "처음부터" |
| `done` | 완료 | 완료 요약 + "다른 설정 하기" + (옵트인 미설정 시) "이 관측을 익명으로 기여하시겠습니까?" |

chip 을 누르면 라우터 호출 없이 바로 시작한다.

### 9.2 시각 언어

이 제품의 성격은 **계기판**이다. 채팅 UI 처럼 보이면 안 된다.

**시그니처: 좌측 스텝 레일.** 검증 통과 단계는 채워지고, 현재 단계는 외곽선 강조, 남은 단계는 비어 있다. 현재 단계만 카드로 펼쳐진다.

관측된 DOM 값은 **고정폭 글꼴**. 사람이 쓴 안내 문구와 기계가 읽은 값을 시각적으로 구분한다. 예: 현재 값 `부분공개` → 목표 값 `전체공개`.

초안 배지: `--clay` 계열 상단 스트라이프 + "미검증 초안" 라벨.

토큰:
```css
--paper:  #F4F6F8;   /* 배경 */
--card:   #FFFFFF;
--ink:    #101A24;   /* 본문 */
--muted:  #6B7780;   /* 보조 */
--line:   #DDE3E8;
--azure:  #1B5FA8;   /* 현재 단계, 주요 동작 */
--moss:   #2E7D5B;   /* 검증 통과 */
--clay:   #9A3E2F;   /* 막힘, 경고, 초안 배지 */
```

원격 폰트 금지. 본문은 system UI 스택, 데이터는 `ui-monospace, SFMono-Regular, Menlo, monospace`.

다크 모드는 `prefers-color-scheme` 로 토큰 교체. 포커스 링 유지, `prefers-reduced-motion` 존중.

### 9.3 옵션 페이지

공급자 목록(카드), 추가/편집/삭제, 활성 전환, "연결 테스트".

키 입력은 `type="password"` + 보기 토글. 마스킹 표시 (`sk-...abcd`). 평문 저장 경고 명시.

**기여 옵트인 토글** — 기본 off. 켜면 아래 문구:

> 켜면 이 확장이 관측한 설정 화면 구조를 익명으로 백엔드에 보냅니다. 개인정보(이메일·이름·글 내용) 는 전송 전에 제거됩니다. 언제든 끌 수 있습니다.

---

## 10. Seed 데이터 → DB 이관

`packs/tistory.json`, `packs/youtube.json`, `packs/blogger.json` 은 **초기 seed 데이터** 로 강등된다. 이후에는 관리 API 로 유입.

- 팩 하나 → `sites` 1행 + `pages` N행 + `page_snapshots` N행 (`source: "seed"`) + `goals` M행 + `procedures` M행 (`authored_by: "human"`, `verified: true`)
- seed 스냅샷의 `structural_hash` 는 임시값 (실제 브라우저 관측이 아니므로 참고용). 최초 사용자 관측 시 실제 signature 로 새 스냅샷이 생성되어 `latest_snapshot_id` 가 이동. seed 스냅샷도 히스토리에 남는다.
- 이전 스펙의 `draft: true` 플래그는 `procedure.verified: false` 로 대체.
- 확장은 백엔드 장애 시 packs/ 를 로컬 fallback 으로 읽을 수 있다 (오프라인 모드 - read-only, 기여 불가).

진입 URL 은 리다이렉트에 맡긴다:
- 티스토리 — `https://www.tistory.com/manage`
- 유튜브 — `https://studio.youtube.com/`
- Blogger — `https://www.blogger.com/`

---

## 11. 구현 순서

각 단계가 끝나면 멈추고 확인받을 것. Phase A 없이 B 로 건너뛰지 말 것.

### Phase A — 로컬 팩 스켈레톤 (현행)

1. **뼈대** — 매니페스트, 서비스 워커, 빈 패널/옵션.
2. **공급자** — storage, providers, 옵션 페이지 전체.
3. **관측** — probe.js, 로케이터 해석, 하이라이트.
4. **엔진 (로컬 팩)** — catalog 로컬 로더, engine, 진입 게이트, 폴링, 스텝 레일. LLM 없이 chip 만으로 절차 완주.
5. **LLM 두 지점 (로컬 팩)** — router (현재 pack 대상), recover. 범위 밖 거절.

### Phase B — DB 로 자산 이동

6. **백엔드 스켈레톤** — Postgres 스키마, 마이그레이션, 최소 REST(read-only), `seed-from-packs.js`.
7. **클라이언트 API 전환** — catalog.js 를 API 클라이언트 + IndexedDB 캐시로 교체. Phase A 흐름 그대로 재현 (안전 스위치: packs/ fallback 유지).
8. **라우터 전역화 + prompt-first 흐름** — `ready` 상태 제거, `prompt` 를 진입 상태로. 크로스-사이트 goal 이동 (`entry` 상태 확장).
9. **snapshot 파이프라인** — snapshot.js signature 계산, canonical_probes 로 page 식별, drift/redesign 판정, `page-unknown` / `draft` 상태.
10. **기여 옵트인** — contrib.js 스크럽 로직, `/contributions` 업로드, 옵션 토글, `contributorHash` 발급, 완료 카드의 기여 프롬프트.
11. **초안 파이프라인 (백엔드)** — `/guidance/propose`, 관리자 검토 도구, `observed_only` 자동 검증, procedures 승격.
12. **초안 실행 UI** — draft 상태 배지, 사용자 확인 다이얼로그, 초안 실패 시 blocked 로 fallback.

---

## 12. 수용 기준

### 확장 (Phase A + B 공통)

- [ ] `storage.sync` 를 사용하는 코드가 없다
- [ ] 공급자 미등록 상태에서는 입력창이 존재하지 않는다
- [ ] 공급자 2개 이상 등록 후 전환 가능, 각각 자기 키로 동작
- [ ] "블로그 글 하나 써줘" 입력 → 고정 거절 문구, 항목 목록 재노출
- [ ] 절차 시작 시 이미 통과된 단계는 스킵
- [ ] probe 응답에 요청하지 않은 DOM 미포함
- [ ] 탭 전환 시 그 탭의 세션 표시
- [ ] 로케이터 전부 실패해도 크래시 없이 blocked
- [ ] 잘못된 API 키 사용 시 키 문자열이 화면·콘솔에 노출되지 않음

### Phase B 신규 기준

- [ ] **어느 사이트에 있든 "스킨 변경하고 싶어" 입력 → 라우터가 `tistory.skin_change` 매칭 → 티스토리로 이동 유도 → 도착 후 자동 세션 시작**
- [ ] **verify 없는 step 을 포함한 procedure 는 API 가 저장 거부 (400)**
- [ ] **`observed_only=false` 인 초안은 어떤 API 응답에도 포함되지 않음**
- [ ] **초안(verified=false) 절차 실행 시 UI 상단에 배지 표시 + 사용자 확인 필요**
- [ ] **`contributionOptIn: false` 상태에서 어떤 관측 데이터도 백엔드로 전송되지 않음** (네트워크 탭으로 검증)
- [ ] **스크럽 후 signature 에 이메일/전화번호 정규식 매치가 없다**
- [ ] **UI 개편 감지 (자카드 < 0.7) 시 옛 snapshot 이 물리 삭제되지 않음** (히스토리 API 로 조회 가능)
- [ ] **canonical_probes 실패 시 `page-unknown` 상태로 진입, 크래시 없음**
- [ ] **백엔드 장애 시 확장이 packs/ fallback 으로 read-only 동작**

---

## 13. 하지 말 것

- 값 변경, 클릭, 폼 제출 등 페이지 조작 — 하이라이트와 스크롤만 허용
- DOM 전체 또는 `document.body.innerText` 를 모델에 전달
- 대화 히스토리 누적 전달
- 검증 판정을 모델에게 위임
- 거절·오류 문구를 모델이 생성
- 한 응답에 여러 단계 렌더
- `storage.sync` 에 키 저장
- 원격 폰트·스크립트 로드
- 실제 확인 없이 사이트 UI 라벨을 추측해 절차에 기입
- 매니페스트에 `<all_urls>` 상시 권한
- **관측되지 않은 라벨을 procedure 에 삽입** (서버 자동 reject)
- **verify 없는 step 을 저장 또는 실행**
- **옛 snapshot 또는 옛 procedure 를 물리 삭제** (append-only)
- **기여 옵트인 off 상태에서 관측 데이터를 백엔드로 전송**
- **초안 절차를 verified 로 위장하거나 배지 없이 실행**
- **웹검색 결과를 verify 로 사용** (참조 인용만 허용, 실행 판정은 언제나 실제 DOM)
- **사용자 프로필/글 내용을 signature 또는 probe 결과에 포함**
