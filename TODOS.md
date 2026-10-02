# TODOS

## Recipe Runner (A 단계 이후)

### 관찰 후 안내 vs 대신 해 주기(H4)를 실제로 측정

**What:** 세션 후 Q2 전에 관찰자가 "대신 해 주는 시연"(Wizard of Oz)을 짧게 보여주고 고르게 한다.

**Why:** 설계의 핵심 가정 H1("사람들은 목표 달성과 함께 이해·통제를 원한다")이 지금은 "대신 해 주는 도구였다면 맡겼을까요?"라는 가정 질문으로만 검증된다. 실제 선택을 보면 훨씬 강한 증거가 된다.

**Context:** `docs/designs/recipe-registry-runner-first.md`의 H4와 Decision rule 참고. /plan-ceo-review D18에서 보류(2026-10-02). 코드 없이 절차만으로 가능하다(XS). **착수 트리거:** 처음 2명을 관찰한 뒤 Q2 응답이 "모르겠다"처럼 모호하거나, 같은 사람의 사전 선택(안내)과 Q2 답이 엇갈릴 때.

**Effort:** XS (human: ~몇 시간 / CC: ~10분)
**Priority:** P2
**Depends on:** A 단계 관찰 시작(evallog와 체크시트 구현)

### B 진행 게이트에 페이지 콘텐츠 주입 내성 시험 추가

**What:** B 단계(gadgetarms 연동) 진행 전에, 화면에 보이는 사용자 콘텐츠(Gmail 제목, Drive 파일명 등)에 주입된 지시 문구가 resolver를 통해 안내 문구로 새지 않는지 시험한다.

**Why:** `lib/guard.js`는 관측된 라벨만 허용하는데, 화면에 주입된 문구도 "관측된 라벨"이라 guard를 통과한다. A 단계는 테스트 계정과 합성 콘텐츠라 위험이 낮지만 실제 사용자 콘텐츠를 읽는 B 이후에는 높다.

**Context:** /plan-ceo-review Section 3에서 발견, D22에서 TODOS.md에 기록하기로 결정(2026-10-02). 이 항목은 승인된 B 게이트 5개 조건을 바꾸지 않는다(B 착수 전에 사용자가 게이트에 넣을지 결정). 시작점: R04(Gmail)와 R05(Drive) 레시피로 의도적으로 주입 문구를 넣은 테스트 콘텐츠를 만들어 resolver 출력과 guard 결과를 확인.

**Effort:** M (human: ~2일 / CC: ~1시간)
**Priority:** P2
**Depends on:** A 통과, B 진행 결정

### panel.js DOM 자동 테스트 환경(jsdom) 도입

**What:** `sidepanel/panel.js`(876줄, DOM 코드)의 레시피 흐름을 자동 테스트할 수 있는 환경(jsdom 등)을 만든다.

**Why:** 이번 A 단계의 panel.js 변경(recipe-done 질문 저장, 엔진 이벤트 훅 등록, 건너뛴 단계 수 기록, resolve 호출 계측)은 자동 테스트가 없다. 특히 `handleGuidanceDone`에서 `clearSession(tabId)` 전에 `session.skipped`를 읽는 호출 순서가 어긋나면 수동으로 넘긴 goal이 완주로 침묵 집계된다(Failure modes의 CRITICAL GAP).

**Context:** /plan-eng-review D8에서 TODOS.md에 기록하기로 결정(2026-10-02). 대안이던 "이번 PR에 수동 스모크 체크리스트 포함"(C)은 선택되지 않았다. 따라서 **관찰 시작 전 panel.js 변경에는 자동·수동 검증이 모두 없다**(미해결 항목으로 보고서에 남김). 시작점: `package.json`은 `node --test test/*.test.js`뿐이고 DOM 환경이 없다. `test/recipe-session.test.js:9-23` 등의 chrome 목은 T5(D6)의 공통 헬퍼로 합쳐진다.

**Effort:** M (human: ~1일 / CC: ~1시간)
**Priority:** P2
**Depends on:** A 단계 evallog·panel 변경 완료
