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

**Context:** (2026-10-06 갱신) T3·T6 구현 뒤 실제 Chromium(MV3 확장 로드, Playwright)으로 recipe-done 질문·이벤트 기록·체크시트 흐름을 한 번 확인했지만 그 프로브는 저장소에 없다. `options/checksheet.js`(DOM)도 같은 이유로 자동 테스트가 없다. /plan-eng-review D8에서 TODOS.md에 기록하기로 결정(2026-10-02). 대안이던 "이번 PR에 수동 스모크 체크리스트 포함"(C)은 선택되지 않았다. 따라서 **관찰 시작 전 panel.js 변경에는 자동·수동 검증이 모두 없다**(미해결 항목으로 보고서에 남김). 시작점: `package.json`은 `node --test test/*.test.js`뿐이고 DOM 환경이 없다. `test/recipe-session.test.js:9-23` 등의 chrome 목은 T5(D6)의 공통 헬퍼로 합쳐진다.

**Effort:** M (human: ~1일 / CC: ~1시간)
**Priority:** P2
**Depends on:** A 단계 evallog·panel 변경 완료

### 러너가 "goal 달성"과 "다음 화면 도달"을 구분

**What:** 화면 이동 전용 절차(목표까지 갈 수 없을 때 "이동을 위해 눌러야 하는 링크까지만" 만든 절차)가 끝나도 goal을 `done`으로 올리지 않고, 새 화면에서 다시 해석하도록 러너 계약을 바꾼다.

**Why:** 지금은 그 절차의 마지막 step을 통과하면 `session.status='done'` → `handleGuidanceDone` → `markGoalDone`이라 실제 설정 없이 goal이 완료로 집계된다. 완주율과 goal 단위 완주율(중단 규칙 30%)이 부풀려진다.

**Context:** `lib/procedure-generator.js:28-30`(프롬프트가 이동 전용 절차를 허용), `sidepanel/panel.js:496`(`markGoalDone` 호출), `lib/recipe-engine.js:101-116`. /plan-eng-review run 3(R16)에서 기록(2026-10-03). A 단계는 러너를 고치지 않고 `procedureKind`(`nav_only`/`action`/`mixed`)와 허위 완주의 겹침만 기록·보고한다(R11 = A). 그 데이터가 수정 방향과 우선순위를 정한다. 수정 방식(예: goal을 `in_progress`로 유지)의 실현 가능성은 시험하지 않았다.

**Effort:** M (human: ~1일 / CC: ~1시간)
**Priority:** P2
**Depends on:** A 단계 관찰 결과(R11 `procedureKind` 데이터)

### B 이전 러너 견고화

**What:** (1) `goalLabel`(`panel.js:331`)·복구 문구(`recover.js`)·단계 힌트 `step.onFail`(`panel.js:342-345`)에도 "관측된 라벨만" guard 적용, (2) provider 요청에 timeout(`providers.js` fetch 3곳), (3) `recipe-engine.js`의 세션 저장을 탭별로 격리(지금은 세션 맵 전체를 한 키에 써서 창이 둘이면 서로를 덮어씀).

**Why:** 지금 guard는 `instruct`의 따옴표 구간만 `usedLabels`와 교차 검증하고(`guard.js:86-102`) 화면 제목·복구 문구는 검사를 거치지 않는다. AI 요청에는 시간 제한이 없어 응답이 안 오면 끝없이 기다릴 수 있다. 사이드패널이 창마다 열리면 한 패널이 지운 세션을 다른 패널의 저장이 되살린다. 실제 사용자 콘텐츠를 읽는 B 이전에 필요하다.

**Context:** `lib/guard.js:86-102`, `sidepanel/panel.js:331,342-345`, `lib/recover.js:12-31`, `lib/providers.js:38,59,93`, `lib/recipe-engine.js:14,50-58`. /plan-eng-review run 3(R17)에서 기록(2026-10-03). 세 번째는 인스턴스 2개 프로브로 재현했다(A가 지운 탭 세션을 B의 `persist()`가 되살림). 기존 "B 진행 게이트에 페이지 콘텐츠 주입 내성 시험 추가"와 입력 설계 문서의 "B 단계로 미루는 통제" 목록과 함께 B 이전 보안·안정성 검토에서 다룬다. A 단계는 이 구멍들을 안은 채 측정하며 러너를 고치지 않는다(R11 = A).

**Effort:** L (human: ~2일 / CC: ~2시간)
**Priority:** P2
**Depends on:** A 통과

### 관찰 재시도와 평가 로그 견고화(관찰 시작 전·후 보완)

**What:** (해결됨 2026-10-06: 같은 슬롯 재시도는 마지막 시도를 세고 앞선 중단은 재시도로 보고, 멈춤은 계속 반영. `scripts/eval-report.js` `matchPlan`, 관찰 체크리스트 1.5.) 남은 항목: (3) `late` 카운트를 "관찰자 종결 뒤"와 "시스템이 먼저 종결한 뒤"로 나눠 후자를 손실로 센다. (4) `clearAll`이 사이드패널 쪽 메모리 카운트·진행 중 세션과 어긋나지 않게 epoch 키를 둔다. (5) 옵션 페이지의 비동기 새로고침이 읽는 동안 수정된 폼을 지우는 경합과, 두 옵션 탭에서 실패 카운트가 내보내기 스냅샷에 안 들어가는 경합을 막는다. (해결됨 2026-10-06, 사용자 결정: (2) 조건 1은 관찰자 확인 완주만 센다. (6) 탭을 닫은 뒤에도 시스템이 닫은 abandoned run을 관찰자가 한 번 `crashOrHang`으로 덮을 수 있다.)

**Why:** 이 항목들은 모두 `/review`·`/ship`의 적대적·Red Team 리뷰가 낸 INFORMATIONAL 발견이고, 판정이 틀리거나 20회 관찰이 무효가 되는 방향으로만 실패한다(fail-closed 쪽이 대부분). (2)·(6)은 승인된 결정 규칙을 바꾸는 항목이라 사용자 결정을 받아 반영했다.

**Context:** `scripts/eval-report.js`(`matchPlan`, 조건 1, `lossCounts`), `lib/evallog.js`(`handleEvent`의 late 분기, `finalizeRun`의 reconcile 예외, `clearAll`, `exportAll`), `options/checksheet.js`(`refresh`). 리뷰 기록은 `gstack-review-read`의 2026-10-06 항목. 관찰 중에는 코드를 고치지 않는다는 규칙(`docs/observation-checklist.md` 2.1)이 있어 남은 항목은 **관찰 시작 전에** 정하는 편이 좋다.

**Effort:** M (human: ~1일 / CC: ~1시간)
**Priority:** P1
**Depends on:** 관찰 시작 전 사용자 결정
