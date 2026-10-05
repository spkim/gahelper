# Setup Copilot — 부록 R: 레시피 MVP

v2 스펙 위에 **레시피 10개를 순서대로 실행하는 최소 러너**를 얹어, gadgetarms 레시피 방식이 실제 화면에서 작동하는지 검증한다.

이 부록은 v2 본문을 완화하지 않는다. 본문과 충돌하면 본문이 이긴다. 애매한 지점은 임의로 결정하지 말고 질문할 것.

**전제:** v2 §11 Phase A의 1~6번(뼈대, 공급자, 관측, guard, resolver+engine, router+recover)이 완료되어 있어야 한다. 캐시(Phase B), 백엔드(Phase C), gadgetarms 사이트 연동은 이 MVP에 포함하지 않는다.

---

## R1. 이 MVP가 답해야 할 질문

1. 의도만 적힌 레시피(화면 라벨 없음)로 여러 goal을 이어서 완주할 수 있는가
2. 모달, iframe 대화상자, OAuth 팝업, 캔버스 UI 중 어디서 무너지는가
3. 화면에 평문으로 뜨는 API 키·시크릿이 LLM으로 새지 않는가
4. **verify는 통과했는데 실제 설정은 바뀌지 않은 "허위 완주"가 얼마나 나오는가**
5. 비개발자가 도움 없이 끝까지 갈 수 있는가

4번이 이 MVP에서 새로 측정하는 가장 중요한 지표다. v2 수용 기준은 verify 통과를 완주로 보지만, 사용자에게 의미 있는 건 실제 결과다.

---

## R2. 레시피 10종과 검증 대상

`lib/recipe-store.js`에 번들한다(런타임 소스는 이 파일이다. 별도 JSON 사본 `recipes/recipes-mvp.json`은 어디서도 import되지 않아 삭제했다).

| ID | 레시피 | Tier | 모달 | 여러 화면 | iframe | OAuth 팝업 | 화면 속 비밀값 | 클립보드 | 캔버스 |
|---|---|---|---|---|---|---|---|---|---|
| R01 | ChatGPT 맞춤 지침 | 1 | ● | | | | | | |
| R02 | Claude 선호 설정 | 1 | | ● | | | | | |
| R03 | 캘린더 기본 알림 | 1 | | ● | | | | | |
| R04 | 지메일 라벨 + 필터 | 2 | | ● | | | | | |
| R05 | 드라이브 폴더 공유 | 2 | | | ● | | | | |
| R06 | Anthropic API 키 발급 | 2 | | | | | ● | | |
| R07 | Claude + 드라이브 연결 | 3 | | | | ● | | | |
| R08 | 노션 통합 생성·연결 | 3 | | ● | | | ● | | |
| R09 | n8n + 지메일 자격증명 | 3 | ● | | | ● | | | |
| R10 | n8n 워크플로우 붙여넣기·실행 | 4 | | | | | | ● | ● |

Tier는 예상 난이도다. Tier 1이 무너지면 제품 가정의 문제이고, Tier 4만 무너지면 레시피 범위의 문제다(§R7).

R06은 확장 자신의 온보딩(API 키 등록)을 겸한다. 통과하면 이 레시피를 그대로 첫 실행 안내로 쓸 수 있다.

---

## R3. 레시피 스키마

```ts
type RecipeFile = { schemaVersion: 1; recipes: Recipe[] };

type Recipe = {
  id: string;
  title: string;
  tier: 1 | 2 | 3 | 4;
  tests: string[];            // 평가용 태그. 런타임 동작에 영향 없음
  prereq: string[];           // 시작 전 사용자에게 보여줄 준비물
  steps: RecipeStep[];
  manualCheck: string;        // 테스터가 수동 확인할 실제 결과
  securityCheck?: string;
};

type RecipeStep = {
  site: string;               // 이 goal 을 시작할 URL
  goalText: string;           // 의도. 화면 라벨을 적지 않는다
  payload?: { kind: "clipboard"; label: string; content: string };
};
```

**`goalText`는 라벨이 아니라 의도다.** "'새 키 만들기' 버튼 누르기"가 아니라 "새 API 키 만들기"로 쓴다. 따옴표로 감싼 단어가 있어도(예: R04의 '거래처') 그건 사용자가 입력할 값이지 화면 라벨이 아니다. goalText는 resolver 입력으로만 쓰이며 **사용자에게 보이는 안내 문구에는 guard를 통과한 resolver 출력만 나간다.** 이 구조는 v2 원칙 2를 그대로 유지한다.

---

## R4. 러너 최소 사양

### R4.1 파일

```
lib/recipe-store.js   레시피 레지스트리(번들된 R01~R10, 스키마 검증). 런타임 소스
lib/recipe-engine.js  레시피 세션 상태 기계
lib/evallog.js        실행 로그 기록·내보내기 (로컬 전용)
```

(구현에서 `lib/recipes.js`는 `recipe-store.js`와 `recipe-engine.js`로 나뉘었다. `recipes/recipes-mvp.json`은 삭제됐다.)

기존 `engine.js`는 수정하지 않는다. 러너는 engine을 goal 단위로 호출하는 상위 계층이다.

### R4.2 레시피 세션 상태

```ts
type RecipeSession = {
  recipeId: string;
  stepIndex: number;          // 현재 goal 인덱스
  windowId: number;           // 탭이 아니라 창에 묶는다
  results: ("pending" | "done" | "blocked" | "skipped")[];
  startedAt: number;
};
```

`chrome.storage.session`에 저장한다. 패널을 닫았다 열어도 이어진다. `storage.sync`·`storage.local`에는 저장하지 않는다.

stepIndex는 engine이 `done`을 반환할 때만 증가한다. `blocked`에서 사용자가 "수동으로 진행"을 누르면 결과를 `skipped`로 기록하고 증가한다. **모델 응답은 stepIndex에 영향을 줄 수 없다.** (v2 원칙 3과 동일)

### R4.3 흐름

1. **`recipe-pick`** — 레시피 목록. 제목과 Tier만 보여준다.
2. **`recipe-intro`** — 준비물(`prereq`)과 **전체 goal 목록**을 보여주고 "시작" 버튼. MVP 레시피는 번들이라 신뢰할 수 있지만, 외부 레시피를 받게 될 이후를 위해 이 화면을 처음부터 둔다. 이것은 외부 입력의 신뢰 경계이며 v2 §13의 "confirmations 0 확인 다이얼로그 금지"와 무관하다.
3. **goal 진입 카드** — "다음: {site 도메인}에서 진행합니다" + "이 사이트 열기" 버튼. 버튼 클릭(사용자 제스처) 안에서 `chrome.permissions.request({ origins: [origin] })` → 현재 탭을 `site`로 이동.
4. **engine 실행** — 레시피 goal은 **router를 생략**하고 `goalText`를 바로 resolver에 넘긴다. 범위 판정은 레시피 작성 단계에서 끝난 것으로 본다. **guard와 verify는 생략하지 않는다.**
5. goal `done` → 다음 goal 진입 카드. 마지막이면 `recipe-done`.
6. **`recipe-done`** — 결과 요약과 `manualCheck` 문구를 보여주고 "실제로 됐나요? 예 / 아니오"를 묻는다. 이 답이 허위 완주 측정값이다.

스텝 레일은 2단이다. 바깥 레일은 레시피 goal, 안쪽 레일은 현재 goal의 화면 단계.

### R4.4 새 탭·팝업 (OAuth)

MVP에서는 **OAuth 로그인 창 안을 안내하지 않는다.** 구글 동의 화면에 권한을 추가로 요청하는 건 사용자에게 부담이 크고, 로그인 화면은 판독 대상으로도 민감하다.

- goal 진행 중 같은 창 또는 팝업으로 새 탭이 열리면 engine을 일시정지하고 고정 문구를 보여준다.
  > 새로 열린 로그인 창에서 진행해 주세요. 끝나면 이 창이 자동으로 이어집니다.
- 팝업·새 탭이 닫히거나 원래 탭이 다시 활성화되면 원래 탭을 재관측하고 verify 폴링을 재개한다.
- 이 문구도 하드코딩 고정 문자열이다.

R07·R09가 이 경로를 검증한다.

### R4.5 클립보드 페이로드

`payload`가 있는 goal은 진입 카드에 "{label} 복사" 버튼을 둔다. 사이드패널에서 `navigator.clipboard.writeText()`로 복사한다. 페이지를 조작하지 않으므로 v2 원칙 1에 어긋나지 않는다.

**payload 내용은 LLM 요청에 포함하지 않는다.** resolver에는 "사용자가 붙여넣을 내용을 이미 복사해 두었다"는 사실만 goalText로 전달된다.

### R4.6 비밀값 스크럽 추가 (v2 §5.3 보강)

MVP의 필수 선행 작업이다. R06·R08은 발급 직후 키를 평문으로 화면에 띄운다.

probe.js 스크럽 단계에 다음을 추가한다. 매치된 텍스트는 signature와 probe 결과에서 `[secret]`으로 치환한다.

```js
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_\-]{10,}/,     // Anthropic
  /sk-[A-Za-z0-9_\-]{20,}/,         // OpenAI 계열
  /ntn_[A-Za-z0-9]{20,}/,           // Notion
  /secret_[A-Za-z0-9]{20,}/,        // Notion (구형)
  /gh[pousr]_[A-Za-z0-9]{20,}/,     // GitHub
  /xox[abprs]-[A-Za-z0-9\-]{10,}/,  // Slack
  /AIza[0-9A-Za-z_\-]{30,}/,        // Google API key
];
// 접두사 없는 토큰: 공백 없는 24자 이상 문자열 중
// 대문자·소문자·숫자가 모두 섞이고 엔트로피가 높은 것
const looksLikeToken = s =>
  /^[A-Za-z0-9_\-\.]{24,}$/.test(s) &&
  /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) &&
  shannon(s) > 3.5;
```

`input[type=text]`의 value도 같은 규칙을 적용한다. 많은 서비스가 키를 읽기 전용 입력칸에 넣어 보여준다.

### R4.7 실행 로그 (lib/evallog.js)

로컬에만 기록하고, 옵션 페이지에서 JSON으로 내보낸다. 서버 전송 없음.

```ts
type RunLog = {
  recipeId: string; tester: "dev" | "nondev"; startedAt: number;
  goals: {
    index: number; result: "done" | "blocked" | "skipped";
    screens: number;             // resolver 호출 횟수 = 거친 화면 수
    resolverMs: number[];
    guardRejects: string[];      // v2 §7.3 reasons
    blockedCause?: "empty_steps" | "guard_twice" | "verify_twice" | "locator_fail";
    popupPauses: number;
  }[];
  userConfirmedReal: boolean | null;   // recipe-done 의 예/아니오
  durationMs: number;
};
```

로그에 signature, goalText 이외의 사용자 입력, 화면 텍스트를 넣지 않는다.

---

## R5. 테스트 절차

**계정:** 개인·회사 계정을 쓰지 않는다. 테스트 전용 구글 계정, ChatGPT·Claude·노션 무료 계정, Anthropic 콘솔, n8n Cloud 체험판(또는 Docker 로컬 n8n — 이 경우 `site`를 `http://localhost:5678/`로 바꾼다)을 준비한다.

**실행:** 레시피 10개 × 테스터 2명 = 20회.
- **dev** — 개발자 본인. 버그와 구조적 실패를 잡는다.
- **nondev** — AI 도구를 거의 안 써본 사람. 옆에서 **말로 도와주지 않는다.** 막히면 "수동으로 진행"을 누르게 하고 기록만 한다. 이 20회 중 10회가 gadgetarms 타겟 가설의 실제 검증이다.

**초기화:** 실행 사이에 결과를 되돌린다(필터 삭제, 커넥터 해제, 키·통합 삭제, 공유 해제). 단, R04는 dev가 한 번 더 **초기화 없이** 실행해 v2 §6.3 "이미 통과 스킵"을 확인한다.

**보안 확인:** R06·R08 실행 시 사이드패널 개발자 도구의 네트워크 탭을 열어 LLM 요청 본문에서 키 접두사를 검색한다.

---

## R6. 통과 기준

v2 Phase A 기준을 그대로 가져오고, 레시피 지표를 더한다.

### v2에서 유지

- [ ] goal 단위 완주율 ≥ 60% (verify 통과로 `done`)
- [ ] 관측되지 않은 라벨 사용자 화면 노출 = 0
- [ ] `blocked`에서 크래시·무한 대기 = 0
- [ ] resolver 응답 p50 ≤ 6초

### 레시피 MVP 신규

- [ ] **레시피 완주율 ≥ 50%** (20회 중 10회 이상, 모든 goal이 `done`, `skipped` 없음)
- [ ] **허위 완주 ≤ 1건** — `done`인데 `userConfirmedReal: false`. 발생 시 해당 verify를 전부 분석한다
- [ ] **비밀값 LLM 전송 = 0** (R06·R08 네트워크 탭 확인)
- [ ] OAuth 팝업 후 원래 탭 재개 성공 (R07·R09 전 실행)
- [ ] payload 내용이 LLM 요청에 포함되지 않음 (R10)
- [ ] nondev 레시피 완주율 측정 (기준값 없음, 기록만)

---

## R7. 결과 해석

| 결과 | 의미 | 다음 행동 |
|---|---|---|
| Tier 1~2 goal 완주율 < 30% | v2 실시간 판독 가정 자체가 흔들림 | 레시피 이전에 resolver·signature 문제. v2 §11 재검토 |
| Tier 1~2 통과, Tier 3 실패 | 팝업 연속성 문제 | §R4.4 개선 후 재측정 |
| Tier 1~3 통과, R10만 실패 | 캔버스 UI 판독 한계 | 레시피 범위를 "설정 화면에서 끝나는 과제"로 제한. n8n은 자격증명·설정까지만 안내하고 워크플로우 작성은 정적 가이드로 |
| 허위 완주 2건 이상 | verify가 "화면이 바뀜"을 "설정이 적용됨"으로 오인 | resolver 프롬프트에 "저장 후 확인 가능한 상태"를 verify로 쓰라는 규칙 추가 |
| dev 완주, nondev 실패 다수 | 기술은 되는데 안내 문구가 어려움 | 문구 규칙(한 문장, 쉬운 말) 강화. 일반 사용자 타겟 재검토 |
| 전부 통과 | 레시피 방식 성립 | Phase B 캐시 착수, gadgetarms 연동(externally_connectable) 설계 |

---

## R8. 하지 말 것

- 레시피 `goalText`에 화면 라벨·메뉴 경로 적기
- 레시피 goal이라는 이유로 guard·verify 생략 (router 생략만 허용)
- OAuth·로그인 화면 안을 판독·안내
- payload·비밀값을 LLM 요청이나 실행 로그에 포함
- nondev 테스트 중 말로 도와주기 — 측정값이 무의미해진다
- 개인·회사 계정으로 테스트
- 이 MVP에 캐시·백엔드·사이트 연동을 함께 넣기
