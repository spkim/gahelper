# Setup Copilot — 프로젝트 스펙 v2

크롬 확장(MV3). 웹 서비스의 설정 화면을 **읽기 전용으로 관찰**하면서, 사용자에게 한 번에 한 단계씩 설정 방법을 안내하는 대화형 셋업 위저드.

**프로젝트의 메인 자산은 실시간 판독 능력이다.** 확장은 눈앞에 열려 있는 설정 화면의 구조를 그 자리에서 읽고, 그 관측에 근거해서만 절차를 만들어 안내한다. 설정 지식 DB는 **캐시이자 품질 로그**다. 없어도 제품은 작동해야 하고, 있으면 빨라지고 저렴해진다.

> v1과의 차이: v1은 "사전 저작된 DB를 실행하고, 화면 판독으로 검증"하는 구조였다. v2는 **"화면 판독으로 절차를 만들고, 캐시로 가속"**하는 구조다. 안전장치(관측된 라벨만 사용)는 버리지 않는다. 검사 지점을 **관리자 승인 파이프라인에서 클라이언트 런타임으로 이동**시킨다.

이 문서는 구현 계약서다. 여기 적힌 제약은 편의를 위해 완화하지 말 것. 애매한 지점이 나오면 임의로 결정하지 말고 질문할 것.

---

## 1. 제품 원칙

이 여섯 가지가 다른 모든 결정을 이긴다.

1. **자동화하지 않는다.** 확장은 값을 바꾸거나 버튼을 클릭하지 않는다. DOM은 읽기만 하고, 사용자에게 무엇을 할지 알려준다. 유일하게 허용되는 페이지 조작은 `scrollIntoView`와 하이라이트 오버레이뿐이다.

2. **지금 이 화면에서 관측된 것만 말한다.** 안내 문구에 등장하는 모든 메뉴·버튼·라벨은 **현재 세션의 signature 안에 실재해야 한다.** 과거 관측, 캐시, 학습 지식, 웹검색 결과에서 온 라벨은 현재 signature에 없으면 사용할 수 없다. 이 검사는 LLM에게 맡기지 않고 **런타임 코드가 강제한다.**

3. **한 번에 한 단계.** 렌더링 슬롯은 하나뿐이다. 단계 인덱스는 검증 통과로만 증가한다. 모델 응답은 인덱스에 영향을 줄 수 없다.

4. **설정 외의 대화를 하지 않는다.** 범위 밖 요청은 고정 문구로 거절한다. **단, "우리가 아직 모르는 사이트"는 범위 밖이 아니다.** (§7.1)

5. **모든 절차는 검증 가능하다.** `verify` 없는 step은 실행을 거부한다. LLM이 생성한 절차도 예외 없다.

6. **스크럽은 우회할 수 없다.** 개인정보 제거는 content script 내부에서 일어난다. 스크럽되지 않은 DOM 텍스트는 어떤 경로로도 content script 경계를 넘지 않는다. (§5.3)

---

## 2. 시스템 구성

```
[Chrome Extension MV3]                          [Backend API — Phase C]
   sidepanel ── 오케스트레이션 + LLM 호출          /cache/lookup      (read)
   content/probe.js ── DOM 관측·스크럽·하이라이트   /cache/contribute  (write, 옵트인)
   lib/probe-client.js ── probe 메시징              /cache/confirm     (write, 옵트인)
   lib/signature.js ── 정규화, structural_hash
   lib/resolver.js  ── 절차 실시간 생성 (LLM)   [DB — Phase C]
   lib/guard.js     ── observed_only 런타임 검사    procedure_cache
   lib/engine.js    ── 상태 기계, verify 루프       observations
   lib/router.js    ── 범위 판정 (LLM)              confirmations
   lib/recover.js   ── 막힘 해설 (LLM)
   lib/cache.js     ── IndexedDB 캐시 (Phase B)
   lib/providers.js ── AI 공급자 어댑터
   lib/storage.js   ── chrome.storage.local 래퍼
   fixtures/        ── 회귀 테스트용 정답 절차
```

**의존 방향이 v1과 반대다.** `engine`은 `cache`가 없어도 동작한다. `cache`는 `resolver` 호출을 생략시키는 최적화일 뿐이며, 캐시 미스는 오류가 아니라 정상 경로다.

### 파일 명세

```
setup-copilot/
  manifest.json
  background/service-worker.js
  lib/
    storage.js          chrome.storage.local 래퍼
    providers.js         AI 공급자 어댑터 (통합 chat())
    probe-client.js      content script 메시징 래퍼
    signature.js         정규화, structural_hash 계산
    router.js            범위 판정 + 캐시 goal 매칭 (LLM 지점 1)
    resolver.js          절차 실시간 생성 (LLM 지점 2)
    guard.js             observed_only / verify 존재 런타임 검사
    engine.js            상태 기계 (단계 진행, verify 폴링)
    recover.js           막힘 해설 (LLM 지점 3)
    cache.js             IndexedDB 캐시 + (Phase C) API 클라이언트
  content/probe.js       DOM 관측, 스크럽, 로케이터 해석, signature, 하이라이트
  sidepanel/  panel.html, panel.css, panel.js
  options/    options.html, options.css, options.js
  fixtures/   tistory.json, youtube.json, blogger.json  (회귀 테스트 전용)
  icons/      16/32/48/128 png
  README.md
```

`background/service-worker.js`, `sidepanel/panel.js`, `options/options.js`는 ES 모듈. LLM 호출과 오케스트레이션은 사이드패널에서 직접 수행한다.

> **도식 점검(2026-10-05, T13): 이 절의 도식·파일 명세는 낡았다.** 위는 Phase C까지 포함한 목표 구조이고, 현재 코드(Stage A)와 다음이 다르다. 목표 구조 서술은 그대로 두고 차이만 기록한다.
> - 없음(미구현): `lib/cache.js`와 캐시 조회·기여 경로(§6.2의 캐시 분기는 코드에 없다. 지금은 항상 resolver로 간다). 백엔드는 `api-server/`·`docker-compose.yml` 골격만 있고 확장이 호출하지 않는다.
> - 이름이 다름: `lib/resolver.js` → `lib/procedure-generator.js`. 지금 `lib/recipe-resolver.js`는 이것이 아니라 URL로 레시피를 고르는 모듈이다.
> - 도식에 없는 모듈: `recipe-store.js`(번들 레시피 레지스트리), `recipe-engine.js`(레시피 세션), `recipe-resolver.js`, `evallog.js`(Stage A 평가 로그), `scrub.js`(키 형태 스크럽, `content/probe.js`의 스크럽과 동기화 필요), `recent-goals.js`, `registered-domain.js`, `options/checksheet.js`, `scripts/eval-report.js`.
> - 의존 방향: 도식은 `sidepanel`이 엔진들을 직접 조율한다고 하는데 실제로는 `panel.js`가 guidance 엔진(`engine.js`)과 레시피 엔진을 함께 조율하고, 레시피 엔진이 `evallog` 리스너를 호출한다(`setRecipeEventListener`).
> - `README.md`는 목록에 있으나 저장소에 없다. 나머지(`manifest.json`, `background/`, `content/probe.js`, `sidepanel/`, `options/`, `fixtures/` 3종, `icons/`)는 일치한다.

---

## 3. 매니페스트

v1과 동일하다. 이 권한 모델은 v2에서 **더 잘 맞는다** — 임의 사이트를 지원하는 게 예외가 아니라 기본 경로이기 때문이다.

```json
{
  "manifest_version": 3,
  "name": "Setup Copilot",
  "version": "0.2.0",
  "minimum_chrome_version": "116",
  "permissions": ["storage", "sidePanel", "scripting", "tabs"],
  "host_permissions": [
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

Phase C에서 `https://api.setup-copilot.example/*`를 추가한다. Phase A·B에서는 백엔드 호스트를 넣지 않는다.

대상 사이트는 매니페스트에 박지 않는다. 사용자가 특정 사이트에서 처음 도움을 요청할 때 `chrome.permissions.request({ origins })`로 **그 도메인만** 받는다. 이 호출은 사용자 제스처 안에서 일어나야 한다.

권한 요청 문구는 고정이다.

> 이 사이트의 설정 화면을 읽어 안내하려면 권한이 필요합니다. 화면을 바꾸거나 클릭하지는 않습니다.

서비스 워커는 설치 시 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`를 호출하고, 최초 설치 시 옵션 페이지를 연다.

---

## 4. 데이터 모델

### 4.1 확장 로컬 설정 (`chrome.storage.local`)

`sc.settings` 키 하나.

```ts
type Settings = {
  version: 3;
  providers: Provider[];
  activeProviderId: string | null;
  cacheContributionOptIn: boolean;   // 기본 false — Phase C
  contributorHash: string | null;    // 익명 UID 해시
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

`chrome.storage.sync`는 **쓰지 않는다.** API 키가 구글 계정으로 동기화되면 안 된다. `storage.local`도 평문이므로 옵션 페이지에 명시할 것.

`contributorHash`는 `crypto.randomUUID()`를 SHA256 한 값. 옵트인 토글을 켤 때 최초 생성.

### 4.2 절차 (런타임 객체)

**v2에서 절차는 1차적으로 런타임 객체다.** DB 행이 아니다. 캐시에 저장될 수도 있고 안 될 수도 있다.

```ts
type Procedure = {
  goalLabel: string;          // "스킨 변경"
  steps: Step[];
  origin: "live" | "cache";   // 이번 세션에서 생성 | 캐시에서 로드
  confirmations: number;      // 이 절차가 완주된 횟수 (캐시 유래일 때만 > 0)
};

type Step = {
  instruct: string;           // 사용자에게 보여줄 문구
  target?: Locator;           // 하이라이트할 요소 (선택)
  verify: Verify;             // 필수
  onFail?: string;            // 실패 시 힌트 (선택)
};
```

`verify`가 없는 step은 `guard.js`가 절차 전체를 폐기한다. (§7.3)

### 4.3 캐시 스키마 (Phase B: IndexedDB / Phase C: PostgreSQL)

캐시 키는 **버전 번호가 아니라 화면 지문**이다. 같은 시각에 여러 지문이 동시에 유효할 수 있음을 전제한다.

#### `procedure_cache`
```
cache_id           PK
structural_hash    TEXT      화면 지문 (인덱스)
origin_host        TEXT      "www.tistory.com" (조회 힌트용, 판정에는 미사용)
goal_label         TEXT      "스킨 변경"
procedure          JSON      Step[]
confirmations      INT       완주 확인 횟수
distinct_reporters INT       서로 다른 contributorHash 수 (Phase C)
first_seen_at, last_used_at
status                       active | retired
```

**`latest` 포인터를 두지 않는다.** v1의 `pages.latest_snapshot_id`가 단일 핫 포인터였기 때문에 A/B 테스트·플랜별 UI·점진적 롤아웃이 공존할 때 버전이 무한 진동했다. v2는 지문별로 독립 행을 두고, 조회는 언제나 **현재 관측된 지문의 정확 일치**로만 한다. 유사도 임계값(v1의 자카드 0.7)은 존재하지 않는다.

#### `observations` (Phase C, 옵트인)
```
observation_id     PK
structural_hash
origin_host
scrubbed_signature JSON
reporter_hash
seen_at
```

지문의 실사용 빈도를 파악하는 용도. 절차 생성이나 판정에는 쓰이지 않는다.

**append-only.** `status = retired`로만 표시하며 물리 삭제하지 않는다.

### 4.4 로케이터

v1과 동일. 문자열 텍스트 기준을 기본으로 한다. 해시 클래스명은 UI 개편 한 번에 전부 죽는다. `css`는 최후 수단.

```ts
type Locator =
  | { by: "css"; selector: string }
  | { by: "labelText"; text: string; control?: "select" | "input" | "checkbox" | "textarea" }
  | { by: "linkText"; text: string }
  | { by: "buttonText"; text: string }
  | { by: "textPresent"; text: string }
  | { by: "urlIncludes"; text: string };
```

`labelText`는 `<label for>` → 라벨 형제·부모 내 첫 컨트롤 순으로 탐색. 텍스트 비교는 공백 정규화 후 부분 일치.

### 4.5 검증

```ts
type Verify =
  | { probe: Locator; is: "found" | "notFound" | "checked" | "unchecked" }
  | { probe: Locator; is: "valueIn"; values: string[] }
  | { probe: Locator; is: "textPresent"; text: string }
  | { is: "urlIncludes"; text: string };
```

**검증 판정은 전부 로컬 JS다. 모델을 호출하지 않는다.** 값 비교는 공백 제거 후 수행한다.

이 원칙은 v2에서 **더 중요해진다.** 절차가 실시간 생성물이므로, 절차의 품질을 판정하는 유일한 객관적 장치가 `verify`다. verify가 통과하지 못하면 절차가 틀린 것이고, 엔진은 `blocked`로 안전하게 떨어진다. 이것이 실시간 생성의 안전망이다.

### 4.6 signature

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

정규화 규칙(구현 시 고정할 것):
- 공백 연속을 단일 공백으로, 앞뒤 트림
- 유니코드 NFKC
- 숫자만으로 이루어진 텍스트 노드는 `#`으로 치환 (카운터·날짜가 지문을 흔드는 것 방지)
- 정렬 키는 `tag|role|ariaLabel|text`

---

## 5. 관측 · 스크럽 · Signature (content/probe.js)

`chrome.scripting.executeScript({ files: ["content/probe.js"] })`로 필요할 때 주입. 중복 주입 가드(`window.__scProbe`).

`chrome.tabs.sendMessage`로 명령:

- `{ cmd: "probe", locators }` → `ProbeResult`
- `{ cmd: "signature", scope? }` → `DomSignature[]` (설정 UI로 판단되는 폼 컨트롤·링크·헤더·버튼만)
- `{ cmd: "highlight", locator }` → 스크롤 + 2초 하이라이트

```ts
type ProbeResult = {
  url: string;          // 스크럽 후
  title: string;        // 스크럽 후
  found: Record<string, {
    found: boolean;
    tag?: string;
    type?: string;
    value?: string;
    checked?: boolean;
    text?: string;      // 200자 제한, 스크럽 후
    visible?: boolean;
    disabled?: boolean;
  }>;
};
```

### 5.1 signature 수집 범위

포함: `input`, `select`, `textarea`, `button`, `a`, `label`, `h1`~`h4`, `[role=tab]`, `[role=menuitem]`, `[role=switch]`, `summary`

제외:
- 사용자 작성 콘텐츠 영역 (`article`, `[contenteditable]`, 글 목록·본문 컨테이너)
- `[type=password]`, `[autocomplete*=cc-]`, `[name*=card]`
- 화면 밖 요소 (`offsetParent === null`)

`DOM 전체를 절대 반환하지 않는다.` `document.body.innerText`를 반환하는 코드 경로가 존재해서는 안 된다.

### 5.2 SPA · iframe

`MutationObserver`로 최대 5초 대기 후 재시도. iframe은 `allFrames: true`로 주입하고, 프레임별 결과 중 `found` 개수가 가장 많은 것을 채택한다. signature는 프레임별로 계산해 각각 캐시 조회한다.

### 5.3 스크럽 — 우회 불가 경계

**스크럽은 content script 내부, 반환 직전에 수행한다.** 원본 텍스트는 어떤 필드에도, 어떤 디버그 경로에도 담기지 않는다.

v1에서는 스크럽이 기여 업로드 경로(`lib/contrib.js`) 기준으로 기술되어 있었다. v2에서는 **모든 LLM 호출이 관측값을 외부로 보내므로**, 스크럽이 선택 경로가 아니라 유일 경로다. 위치를 `contrib.js`에서 `probe.js`로 옮기는 것이 이 스펙의 필수 요구사항이다.

치환 규칙:
- 이메일 → `***@***`
- 전화번호(국내/국제) → `***`
- URL 및 텍스트 내 사용자 식별자 — `{blog}.tistory.com`의 `{blog}`, `/@handle`, `/user/{id}` → `***`
- 로그인 컨텍스트에서 검출된 사용자 이름 → `***`
- 32자 이상의 영숫자 연속열(토큰·키 후보) → `***`
- `text`는 200자 자름

**옵션 페이지에 다음을 명시한다.**

> 안내를 만들기 위해, 현재 설정 화면의 메뉴·버튼 이름을 당신이 등록한 AI 공급자로 전송합니다. 이메일·이름·글 내용 등 개인정보는 전송 전에 제거됩니다. 값이 아니라 화면 구조만 전송됩니다.

---

## 6. 엔진 (lib/engine.js)

### 6.1 세션 상태

```ts
type Session = {
  tabId: number;
  goalText: string | null;        // 정규화된 사용자 의도
  structuralHash: string | null;  // 이번 세션이 실행 중인 화면 지문
  signature: DomSignature | null; // 원칙 2 검사의 기준 (세션 내 보관)
  procedure: Procedure | null;
  stepIdx: number;
  attempts: number;
  status: "prompt" | "resolving" | "entry" | "running" | "blocked" | "done" | "refuse";
};
```

세션은 `tabId`를 키로 보관. `chrome.tabs.onRemoved`에서 정리.

### 6.2 진행 루프

```
사용자 입력
   ↓
router (LLM 지점 1) — 설정 작업인가?
   ├ 아니오 → refuse (고정 문구)
   └ 예 → goalText 정규화
       ↓
현재 탭이 설정 화면인가?
   ├ 아니오 → entry
   │    ├ 캐시에 해당 서비스 진입 URL 있음 → 이동 버튼
   │    └ 없음 → "설정 페이지를 열어 주세요" + 열리면 자동 재개
   └ 예
       ↓
signature 수집 → structural_hash 계산
       ↓
캐시 조회 (정확 일치)
   ├ 히트 → guard 재검사 → 통과 시 procedure (origin: cache)
   │           └ 불통과 → 캐시 행 retire → 미스로 강하
   └ 미스 → resolver (LLM 지점 2) → guard 검사
                ├ 통과 → procedure (origin: live)
                └ 불통과 → 1회 재시도 → 실패 시 blocked
       ↓
이미 통과한 앞 단계 스킵 (§6.3)
       ↓
실행 루프:
   - 1초 폴링, 현재 단계 verify probe
   - 통과 → stepIdx++, attempts = 0
   - "안 돼요" → attempts++, 2회 → blocked → recover (LLM 지점 3)
       ↓
done
   ├ origin: live 이고 옵트인 → 캐시 기여 (Phase C)
   └ origin: cache → confirmations++ (Phase C)
```

**캐시 미스는 오류가 아니다.** UI에 실패로 표시하지 않는다. `resolving` 상태의 인디케이터가 조금 더 길게 도는 것 외에 사용자가 인지할 차이가 없어야 한다.

폴링은 패널이 보이지 않을 때(`document.hidden`) 멈춘다.

### 6.3 이미 통과 스킵

시작 시 전체 단계를 한 번 probe해서 통과한 앞부분은 스킵하고 시작한다. (v1과 동일)

### 6.4 화면 변경 감지

**절차 실행 중** 화면이 바뀌면 (`structural_hash` 변경) — 이는 정상이다. 단계를 진행하면 화면은 당연히 바뀐다. 지문 변경 자체를 이상 신호로 취급하지 않는다.

단, 다음 두 경우는 절차를 폐기하고 재해석한다.

- 남은 모든 step의 `verify.probe`가 새 화면에서 해석 불가
- 사용자가 명시적으로 "화면이 달라요"를 누름

재해석 = 새 signature로 §6.2를 다시 타는 것. `stepIdx`는 0으로 돌아가되, §6.3의 스킵이 이미 완료한 부분을 되찾아준다.

**v1의 drift / redesign / 자카드 임계값은 v2에 존재하지 않는다.** 눈앞의 화면을 매번 읽으므로 "어느 버전인가"라는 질문 자체가 발생하지 않는다.

---

## 7. LLM 사용 지점

세 지점. 모두 **stateless**. 대화 히스토리를 누적 전달하지 않는다.

**호출 단위는 단계별이 아니라 화면 진입 시 1회다.** resolver는 그 화면에서 목표까지 가는 전체 절차를 한 번에 받아온다. verify 폴링 루프는 모델을 호출하지 않는다. (§4.5)

### 7.1 router (lib/router.js) — 범위 판정

v1의 라우터는 카탈로그에 있는 goal 목록 안에서만 분류하는 **닫힌 세계**였다. 그 결과 "DB에 없는 사이트"와 "설정 작업이 아닌 요청"이 똑같이 거절됐다. v2는 이 둘을 분리한다.

| 요청 | v1 | v2 |
|---|---|---|
| "블로그 글 하나 써줘" | 거절 | 거절 (유지) |
| "네이버 블로그 스킨 바꾸고 싶어" (미수록) | 거절 | **실시간 경로** |

```js
const system = `당신은 요청 분류기입니다. 답변이나 안내를 생성하지 마세요.
사용자 문장이 "웹 서비스의 설정을 바꾸는 작업"인지 판정해 JSON만 출력합니다.

설정 작업인 예: 스킨/테마 변경, 공개 범위 변경, 알림 끄기, 도메인 연결,
  댓글 설정, 결제 수단 변경, 계정 삭제, 2단계 인증 켜기
설정 작업이 아닌 예: 글쓰기, 번역, 코드 작성, 잡담, 일반 지식 질문,
  콘텐츠 추천, 오류 원인 분석

${cachedGoals.length ? `이 화면에서 이미 알려진 작업 목록:
${cachedGoals.map(g => `- ${g.id}: ${g.label}`).join("\n")}
사용자 문장이 이 중 하나와 같은 작업이면 matchedGoalId 에 그 id 를 넣으세요.
확실하지 않으면 null 로 두세요.` : ""}

goalText 는 사용자 의도를 한 문장으로 정규화한 것입니다. 서비스 이름이
문장에 있으면 유지하세요.

출력 형식:
{"scope":"settings"|"out_of_scope","goalText":string,"matchedGoalId":string|null}`;
```

응답은 코드가 다시 검증한다.

```js
if (parsed.scope !== "settings") return { kind: "refuse" };
const goalText = String(parsed.goalText ?? "").slice(0, 200);
if (!goalText) return { kind: "refuse" };
const matched = cachedGoals.find(g => g.id === parsed.matchedGoalId) ?? null;
return { kind: "proceed", goalText, cachedGoal: matched };
```

**캐시 goal 목록은 힌트다. 후보 집합이 아니다.** 목록에 없어도 `scope: "settings"`면 진행한다. `matchedGoalId`가 카탈로그에 없는 값이면 조용히 `null`로 떨어뜨리고 진행한다.

**refuse 문구는 코드에 하드코딩된 고정 문자열이다.** 모델이 거절 문장을 쓰게 두면 거기서 대화가 이어진다.

> 설정 변경을 돕는 도구입니다. 이 요청은 도와드릴 수 없습니다.
> 예: "티스토리 스킨 바꾸고 싶어", "유튜브 댓글 끄고 싶어"

`goals.synonyms` 테이블은 v2에 없다. 동의어 목록을 손으로 관리하는 것은 또 하나의 수작업 병목이며, 모델이 원래 잘하는 일이다.

### 7.2 resolver (lib/resolver.js) — 절차 실시간 생성

**이 지점이 v2의 핵심이다.** v1에서 백엔드 관리자 전용이었던 `/guidance/propose`가 클라이언트 런타임으로 이동한 것에 해당한다.

입력: `goalText` + 현재 화면의 스크럽된 `signature`

```js
const system = `당신은 설정 절차 작성기입니다.
아래 observed 는 사용자가 지금 보고 있는 설정 화면의 요소 목록입니다.

규칙:
- observed 에 실제로 존재하는 텍스트만 instruct, target, verify 에 사용하세요.
  observed 에 없는 메뉴, 버튼, 탭, 경로를 쓰면 응답 전체가 폐기됩니다.
- 각 step 에는 verify 가 반드시 있어야 합니다. verify 는 그 단계가
  끝났는지를 화면에서 확인할 수 있는 조건입니다.
- 목표까지 이 화면에서 갈 수 없으면 (다른 화면으로 이동해야 하면),
  이동을 위해 눌러야 하는 링크까지만 절차로 만드세요. 그 다음은
  화면이 바뀐 후 다시 판단합니다.
- 목표와 관련된 요소가 observed 에 전혀 없으면 {"steps":[]} 를 출력하세요.
  추측하지 마세요.
- 최대 6 step. 각 instruct 는 한 문장, 한국어.
- 설명이나 인사 없이 JSON만 출력하세요.

출력 형식:
{"goalLabel":string,"steps":[{"instruct":string,
  "target":Locator|null,"verify":Verify,"onFail":string|null}]}

Locator: {"by":"linkText"|"buttonText"|"labelText"|"textPresent"|"urlIncludes","text":string}
Verify: {"probe":Locator,"is":"found"|"notFound"|"checked"|"unchecked"|"textPresent","text"?:string}
        또는 {"is":"urlIncludes","text":string}`;

const user = JSON.stringify({ goal: goalText, observed: compact(signature) });
```

`compact()`는 signature에서 `tag`, `text`, `role`, `ariaLabel`만 추린 축약형이다. `nearLabels`는 100개 요소를 넘을 때만 포함한다.

`{"steps": []}`가 오면 `blocked`로 진입하되, 메시지는 실패가 아니라 안내다.

> 이 화면에서 관련 항목을 찾지 못했습니다. 설정 메뉴의 다른 화면일 수 있습니다.

### 7.3 guard (lib/guard.js) — 런타임 강제

**원칙 2와 5를 실제로 보장하는 코드다. 모델을 신뢰하지 않는다.**

```js
export function guard(procedure, signature) {
  const pool = buildTextPool(signature);   // 정규화된 관측 텍스트 집합
  const reasons = [];

  if (!Array.isArray(procedure?.steps)) reasons.push("no_steps");

  for (const [i, s] of (procedure.steps ?? []).entries()) {
    if (!s.verify) reasons.push(`step${i}:no_verify`);

    // instruct 안의 인용된 라벨은 모두 관측 풀에 있어야 한다
    for (const q of extractQuoted(s.instruct)) {
      if (!pool.has(norm(q))) reasons.push(`step${i}:unobserved_label:${q}`);
    }
    for (const loc of [s.target, s.verify?.probe].filter(Boolean)) {
      if (loc.by === "css") reasons.push(`step${i}:css_locator`);
      else if (loc.by !== "urlIncludes" && !pool.has(norm(loc.text))) {
        reasons.push(`step${i}:unobserved_locator:${loc.text}`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}
```

- 불통과 시 **절차 전체를 폐기한다.** 문제 step만 잘라내지 않는다. 잘라내면 중간이 빈 절차가 사용자에게 간다.
- 1회 재시도(불통과 사유를 프롬프트에 첨부)까지 허용. 두 번째도 실패면 `blocked`.
- 불통과 사유는 로컬 로그에만 남긴다. 사용자에게 노출하지 않는다.
- **guard는 캐시 히트에도 적용된다.** 캐시된 절차가 현재 화면에서 검사를 통과하지 못하면 그 행을 `retired`로 표시하고 미스로 강하한다. 이것이 v1의 자카드 임계값을 대체하는 장치이며, 임계값 없이 작동한다.

`extractQuoted`는 `instruct` 안의 따온표·꺾쇠(`'...'`, `"..."`, `[...]`, `「...」`)로 감싼 구간을 뽑는다. **resolver 프롬프트는 화면 라벨을 반드시 따온표로 감싸도록 지시해야 하고**, 이 규약이 guard의 정밀도를 결정한다. 구현 시 프롬프트에 이 요구를 명시할 것.

### 7.4 recover (lib/recover.js) — 막힘 해설

v1과 동일. 같은 단계를 2회 실패했을 때만 호출.

```js
const system = `당신은 설정 안내 도우미입니다. 아래 observed 에 실제로 존재하는 항목만
언급하세요. observed 에 없는 메뉴, 버튼, 경로를 지어내면 안 됩니다.
필요한 요소가 observed 에 없으면 정확히 이렇게 답하세요:
"화면 구조가 예상과 다릅니다. 수동으로 진행해야 할 수 있습니다."
2~3문장, 한국어, 다음 행동 하나만 제시하세요.`;

const user = JSON.stringify({ step: step.instruct, observed: probeResult.found, attempts });
```

응답 400자 자름.

### 7.5 웹검색

**v2에서 웹검색은 사용하지 않는다.** v1은 초안 생성 시 참조로 허용했으나, 실행 판정은 언제나 실제 DOM이었으므로 참조의 실효가 없었다. 실시간 판독에서는 더욱 불필요하다. 검색 결과의 라벨은 guard의 관측 풀에 없으므로 어차피 전부 폐기된다.

---

## 8. 공급자 어댑터 (lib/providers.js)

v1과 동일.

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
| `compatible` | `{baseUrl}/chat/completions` | `Authorization: Bearer` | openai와 동일 |

Anthropic은 브라우저 직접 호출 시:
```
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
```

시스템 프롬프트 위치는 공급자마다 다르다. 어댑터가 흡수.

오류 매핑: 401/403 → "API 키를 확인해 주세요", 429 → "요청이 많습니다", 5xx → "일시적인 문제". 원본 오류 본문 노출 금지.

**v2 추가:** resolver는 응답 길이가 크므로 `maxTokens` 기본값을 2048로 둔다. JSON 파싱 실패는 guard 불통과와 동일하게 처리한다(1회 재시도 후 blocked).

---

## 9. 화면

### 9.1 사이드패널 상태

v1의 상태 집합을 거의 유지하되 **의미가 바뀐다.**

| 상태 | 조건 | 화면 | v1 대비 |
|---|---|---|---|
| `no-provider` | provider 없음 | 안내 + 인라인 폼. **입력창 없음.** | 동일 |
| `prompt` | provider OK, 세션 없음 | "어떤 설정을 도와드릴까요?" + 입력창 + 최근 사용 chip | 동일 |
| `resolving` | router / 캐시 조회 / resolver 진행 | 회전 인디케이터 (텍스트 없음) | **캐시 미스를 포함** |
| `entry` | 현재 탭이 설정 화면 아님 | 진입 카드 | **미수록 서비스도 지원** |
| `running` | 세션 진행 | 스텝 레일 + 현재 단계 | 동일 |
| `blocked` | 2회 실패 / guard 2회 불통과 / steps 비어 있음 | 복구 해설 + "수동으로 진행" / "다시 시도" | 사유 확대 |
| `done` | 완료 | 완료 요약 + "다른 설정 하기" + (Phase C) 기여 프롬프트 | 동일 |
| `refuse` | 설정 작업 아님 | 고정 문구 + prompt 복귀 | **범위 축소** |

**삭제된 상태**

- `choose` — router가 후보 집합에서 고르지 않으므로 불필요. 모호하면 그냥 진행하고, 화면에서 관련 요소를 못 찾으면 `blocked`가 받는다.
- `page-unknown` — v1에서 이것은 "DB에 없는 화면"이라는 죽는 상태였다. v2에서는 그게 정상 경로이므로 `resolving`이 흡수한다.
- `draft` — 별도 상태가 아니라 **모든 실시간 절차의 기본 성격**이다. §9.2의 배지로 표현한다.

### 9.2 신뢰도 표시

v1은 `verified`(관리자 승인)와 `draft`(미승인)를 나눴다. v2는 **완주 확인 횟수**로 대체한다. 사람의 승인이 아니라 실행 결과가 신뢰도를 만든다.

| `confirmations` | 배지 | 문구 |
|---|---|---|
| 0 (`origin: live`) | `--clay` 스트라이프 | 화면을 읽어 만든 안내입니다 |
| 1–2 | 없음 | — |
| 3 이상 | `--moss` 점 | 여러 번 확인된 안내입니다 |

`confirmations: 0`에서 **사용자 확인 다이얼로그를 띄우지 않는다.** v1은 초안 실행 전 확인을 요구했으나, v2에서 그것은 기본 경로이므로 모든 첫 사용에 마찰을 넣는 셈이 된다. 배지로 충분하다. 원칙 1(자동화 안 함) 덕분에 잘못된 절차의 최대 피해는 "엉뚱한 버튼을 짚어줌"이고, 사용자가 실행 주체이므로 되돌릴 수 있다.

### 9.3 시각 언어

v1과 동일. 이 제품의 성격은 **계기판**이다. 채팅 UI처럼 보이면 안 된다.

**시그니처: 좌측 스텝 레일.** 검증 통과 단계는 채워지고, 현재 단계는 외곽선 강조, 남은 단계는 비어 있다. 현재 단계만 카드로 펼쳐진다.

관측된 DOM 값은 **고정폭 글꼴**. 사람이 쓴 안내 문구와 기계가 읽은 값을 시각적으로 구분한다. 예: 현재 값 `부분공개` → 목표 값 `전체공개`.

```css
--paper:  #F4F6F8;   /* 배경 */
--card:   #FFFFFF;
--ink:    #101A24;   /* 본문 */
--muted:  #6B7780;   /* 보조 */
--line:   #DDE3E8;
--azure:  #1B5FA8;   /* 현재 단계, 주요 동작 */
--moss:   #2E7D5B;   /* 검증 통과, 확인된 절차 */
--clay:   #9A3E2F;   /* 막힘, 경고, 실시간 생성 배지 */
```

원격 폰트 금지. 본문은 system UI 스택, 데이터는 `ui-monospace, SFMono-Regular, Menlo, monospace`.

다크 모드는 `prefers-color-scheme`로 토큰 교체. 포커스 링 유지, `prefers-reduced-motion` 존중.

### 9.4 옵션 페이지

공급자 목록(카드), 추가/편집/삭제, 활성 전환, "연결 테스트".

키 입력은 `type="password"` + 보기 토글. 마스킹 표시(`sk-...abcd`). 평문 저장 경고 명시.

**전송 고지** — §5.3의 문구를 상시 표시한다. 토글이 아니다. 이 전송은 제품 동작의 전제이므로 끌 수 없고, 대신 숨기지 않는다.

**캐시 기여 옵트인 토글** (Phase C) — 기본 off.

> 켜면 이 확장이 만든 설정 절차와 화면 구조를 익명으로 공유합니다. 다른 사용자가 같은 화면에서 더 빠르게 안내받을 수 있습니다. 개인정보는 전송 전에 제거됩니다. 언제든 끌 수 있습니다.

---

## 10. fixtures — 회귀 테스트 자산

v1의 `packs/tistory.json`, `packs/youtube.json`, `packs/blogger.json`은 **삭제하지 않는다.** 런타임 카탈로그에서 빼고 `fixtures/`로 옮겨 **채점 기준선**으로 쓴다.

사람이 손으로 검증한 정답 절차가 있는 3개 사이트는, 실시간 생성 품질을 측정할 유일한 근거다.

```
node scripts/eval.js --fixture fixtures/tistory.json
```

각 fixture goal에 대해:
1. 저장된 signature를 resolver에 입력
2. 생성된 절차를 정답 절차와 비교
3. 측정: guard 통과율, step 일치율, 정답 대비 여분/누락 step 수

**resolver 프롬프트를 수정할 때마다 이 스크립트를 돌린다.** 프롬프트 변경은 회귀를 부르기 쉽고, 육안으로는 잡히지 않는다.

fixture는 런타임 카탈로그가 아니므로 `lib/cache.js`가 읽지 않는다. 확장 번들에서 제외해도 된다.

---

## 11. 구현 순서

각 단계가 끝나면 멈추고 확인받을 것.

**v1과의 가장 큰 차이는 순서다.** v1은 Phase A(로컬 팩)와 Phase B(DB)를 모두 완주해도 "낯선 사이트에서 실시간 안내가 정확한가"라는 핵심 가정이 미검증으로 남았다. 두 Phase 모두 사전 저작된 절차를 실행했기 때문이다. v2는 그 가정을 **1번으로** 검증한다.

### Phase A — 실시간 경로 단독 (캐시 없음, 백엔드 없음)

사이트를 **하나도 하드코딩하지 않는다.**

1. **뼈대** — 매니페스트, 서비스 워커, 빈 패널/옵션
2. **공급자** — storage, providers, 옵션 페이지 전체
3. **관측** — probe.js, 스크럽(§5.3), 로케이터 해석, signature, 하이라이트
4. **guard** — guard.js 단독. 유닛 테스트 먼저. 조작된 절차를 반드시 폐기하는지 확인
5. **resolver + engine** — 실시간 절차 생성 → guard → verify 폴링 → done/blocked
6. **router + recover** — 범위 판정, 고정 거절, 막힘 해설
7. **평가 하네스** — `scripts/eval.js`, fixtures 3종

#### Phase A 통과 기준 — 여기서 통과하지 못하면 중단한다

카탈로그에 없는 **설정 화면 10곳**(네이버 블로그, 스마트스토어, 카페24, 카카오채널, GitHub, Notion, Slack, X, 인스타그램, 구글 계정)에서 각 2개 목표, 총 20건을 수동 측정한다.

- [ ] 완주율 ≥ 60% (verify 통과로 `done` 도달)
- [ ] **관측되지 않은 라벨이 사용자 화면에 노출된 건수 = 0** (guard가 구조적으로 보장. 위반 시 guard 버그)
- [ ] `blocked` 도달 시에도 크래시·무한 대기 없음 = 100%
- [ ] fixtures 3종 guard 통과율 = 100%
- [ ] resolver 응답 p50 ≤ 6초

완주율이 30% 미만이면 **제품 가정 자체가 틀렸다.** 캐시를 붙여도 해결되지 않는다. 이 지점에서 방향을 재검토한다.

### Phase B — 로컬 캐시

8. **cache.js (IndexedDB)** — `structural_hash` 정확 일치 조회, 히트 시 resolver 생략
9. **confirmations** — 완주 시 카운트 증가, §9.2 배지
10. **guard 재검사 경로** — 캐시 히트가 guard 불통과 시 retire → 미스로 강하

#### Phase B 통과 기준

- [ ] 동일 화면 재방문 시 LLM 호출 0회, 절차 즉시 표시
- [ ] 캐시 히트율 실측 (같은 사용자, 2주)
- [ ] 화면이 바뀐 뒤 재방문 시 자동으로 retire → 실시간 재생성

**히트율이 30% 미만이면 Phase C를 착수하지 않는다.** 백엔드가 불필요하다는 뜻이다. 서버 캐시는 로컬 캐시가 가치를 증명한 뒤의 확장이다.

### Phase C — 서버 캐시 + 기여

11. **백엔드 스켈레톤** — Postgres, `/cache/lookup` (read-only)
12. **기여 옵트인** — `/cache/contribute`, `/cache/confirm`, `distinct_reporters`
13. **retire 신호 집계** — 여러 사용자에게서 guard 불통과가 반복된 행을 자동 retire

관리자 승인 큐는 **만들지 않는다.** v1의 `guidance_proposals` → 관리자 검토 → 승격 경로는 1인 운영에서 병목이 되며, 승인 대기 중 사용자는 어차피 LLM 생성물을 보게 되므로 지연만 추가할 뿐이다. 승격은 `confirmations`로 자동화한다.

관리자 도구는 **retire 강제와 남용 신고 처리**에만 둔다.

---

## 12. 수용 기준

### 최우선

- [ ] **카탈로그·캐시에 전혀 없는 사이트의 설정 페이지에서 요청 → 실시간 절차 생성 → guard 통과 → verify 통과로 완주**
- [ ] **resolver가 생성한 절차에 현재 signature에 없는 라벨이 포함되면 런타임에서 절차 전체가 폐기되고, 사용자에게 노출되지 않는다**
- [ ] **스크럽 이전의 DOM 텍스트가 LLM 요청 본문에 포함되지 않는다** (네트워크 탭으로 검증)
- [ ] **verify 없는 step을 포함한 절차는 실행되지 않는다** (LLM 생성물 포함)
- [ ] **캐시·백엔드가 전부 없거나 죽어도 제품이 정상 작동한다**

### 보안 · 프라이버시

- [ ] `storage.sync`를 사용하는 코드가 없다
- [ ] `document.body.innerText`를 반환하는 코드 경로가 없다
- [ ] signature에 이메일/전화번호 정규식 매치가 없다
- [ ] `[type=password]`가 signature와 probe 결과에 포함되지 않는다
- [ ] 잘못된 API 키 사용 시 키 문자열이 화면·콘솔에 노출되지 않음
- [ ] 매니페스트에 `<all_urls>` 상시 권한이 없다
- [ ] 사이트 권한이 사용자 제스처 안에서만 요청된다
- [ ] (Phase C) `cacheContributionOptIn: false` 상태에서 어떤 관측 데이터도 백엔드로 전송되지 않는다

### 동작

- [ ] 공급자 미등록 상태에서는 입력창이 존재하지 않는다
- [ ] 공급자 2개 이상 등록 후 전환 가능, 각각 자기 키로 동작
- [ ] "블로그 글 하나 써줘" 입력 → 고정 거절 문구
- [ ] **"네이버 블로그 스킨 바꾸고 싶어" 입력 → 거절되지 않고 실시간 경로로 진행**
- [ ] 절차 시작 시 이미 통과된 단계는 스킵
- [ ] probe 응답에 요청하지 않은 DOM 미포함
- [ ] 탭 전환 시 그 탭의 세션 표시
- [ ] 로케이터 전부 실패해도 크래시 없이 `blocked`
- [ ] 페이지 조작이 `scrollIntoView`와 하이라이트 오버레이로 한정된다
- [ ] 캐시 미스가 UI에 실패로 표시되지 않는다
- [ ] `confirmations: 0` 절차에 `--clay` 배지가 표시된다
- [ ] (Phase B) 동일 화면 재방문 시 LLM 호출이 발생하지 않는다
- [ ] (Phase B) 캐시된 절차가 guard 불통과 시 retire되고 실시간 경로로 강하한다

---

## 13. 하지 말 것

### v1에서 유지

- 값 변경, 클릭, 폼 제출 등 페이지 조작 — 하이라이트와 스크롤만 허용
- DOM 전체 또는 `document.body.innerText`를 모델에 전달
- 대화 히스토리 누적 전달
- 검증 판정을 모델에게 위임
- 거절·오류 문구를 모델이 생성
- 한 응답에 여러 단계 렌더
- `storage.sync`에 키 저장
- 원격 폰트·스크립트 로드
- 매니페스트에 `<all_urls>` 상시 권한
- verify 없는 step을 실행
- 사용자 프로필/글 내용을 signature 또는 probe 결과에 포함
- 웹검색 결과를 verify로 사용

### v2 신규

- **현재 세션의 signature에 없는 라벨을 안내 문구·로케이터·verify에 사용** (guard가 절차 전체 폐기)
- **guard 불통과 시 문제 step만 잘라내고 나머지를 실행** — 전체를 폐기할 것
- **스크럽을 content script 밖에서 수행** — 원본 텍스트가 경계를 넘으면 안 됨
- **캐시된 절차를 guard 없이 실행** — 캐시는 신뢰 대상이 아니라 후보 제공자
- **캐시 미스를 오류·거절로 표시**
- **`latest` 단일 포인터로 화면 버전을 관리** — 지문별 독립 행, 정확 일치 조회
- **유사도 임계값으로 화면 동일성을 판정** — v1의 자카드 0.7 방식은 제거됨
- **관리자 승인을 절차 노출의 조건으로 두기** — 승격 조건일 뿐
- **동의어 목록을 손으로 관리**
- **캐시·백엔드를 제품 동작의 전제로 두기**
- **`confirmations: 0`이라는 이유로 실행 전 확인 다이얼로그 강제**

---

## 부록 A — v1 → v2 대응표

| v1 | v2 | 비고 |
|---|---|---|
| `sites`, `pages`, `goals` | 없음 | 현재 탭과 signature가 대체 |
| `page_snapshots` | `procedure_cache.structural_hash` | latest 포인터 없음 |
| `procedures` (DB 행) | `Procedure` (런타임 객체) + 캐시 | 1차는 런타임 |
| `contributions` | `observations` | 역할 동일, 필수성만 강등 |
| `guidance_proposals` | 없음 | resolver가 런타임에 수행 |
| 백엔드 `observed_only` 검증 | `lib/guard.js` | **위치 이동 = 이 스펙의 핵심** |
| drift / redesign / 자카드 0.7 | 없음 | 매번 실시간 판독 |
| `verified` (관리자 승인) | `confirmations` (완주 횟수) | 자동 승격 |
| `draft` 상태 | 기본 성격 + 배지 | 예외가 아님 |
| `page-unknown` 상태 | `resolving`에 흡수 | 정상 경로 |
| `choose` 상태 | 없음 | 닫힌 후보 집합 폐지 |
| `packs/` (런타임 카탈로그) | `fixtures/` (회귀 테스트) | 삭제 아님, 용도 변경 |
| 라우터: 닫힌 세계 분류 | 라우터: 범위 판정 + 힌트 | 미수록 ≠ 범위 밖 |

## 부록 B — 남은 위험

1. **호출 비용과 지연.** v1의 "기본 경로에서 모델을 호출하지 않는다"가 깨진다. 완화: 화면당 1회 호출, verify 루프는 로컬, 사용자 자기 API 키, Phase B 캐시. 그래도 첫 방문은 항상 수 초 대기다. `resolving` 인디케이터의 체감 품질이 실제 이탈률을 좌우한다.

2. **품질 하한.** 실시간 생성물의 품질은 절차마다 흔들린다. 안전망은 verify다. 틀린 절차는 verify를 통과하지 못하고 `blocked`로 떨어진다. **`blocked`가 자주 나오는 것은 버그가 아니라 설계된 실패 모드다.** 다만 사용자에게는 여전히 실패로 보이므로, `blocked` 문구가 "수동으로 진행"이라는 실행 가능한 출구를 반드시 제공해야 한다.

3. **guard의 정밀도가 프롬프트 규약에 의존한다.** `extractQuoted` 방식은 resolver가 라벨을 따온표로 감싼다는 규약을 전제한다. 규약이 깨지면 검사가 헐거워진다. 대안(라벨을 별도 필드로 분리 출력)을 Phase A에서 함께 실험할 것.

4. **자기 API 키 요구가 진입 장벽이다.** 일반 사용자 대상 제품이면서 API 키 등록을 요구하는 것은 모순에 가깝다. Phase A는 이 전제로 진행하되, B2B 온보딩(사업자가 키 비용 부담)이나 프록시 모드를 별도 검토할 것. **이것은 기술 문제가 아니라 수익 모델 문제이며, 이 스펙의 범위를 넘는다.**
