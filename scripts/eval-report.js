#!/usr/bin/env node
// Stage A 판정 리포트. 규칙: docs/designs/recipe-registry-runner-first.md "Decision rule",
// 계약: docs/observation-checklist.md Part 1. (Phase A 하네스 scripts/eval.js 와는 별개다.)
//
// 사용: node scripts/eval-report.js <evallog 내보내기.json> [--json]
// 입력은 옵션 페이지 "JSON 내보내기"의 마지막 파일 하나다(20회를 한 프로필에 누적, R18).
// 판정은 evalRound 별로 따로 하고 풀링하지 않는다. 가장 큰 라운드의 판정이 최종이다.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { isCodedObservation, TERMINAL_STATUSES, AUDIT_SURFACES } from "../lib/evallog.js";

export const VERDICT = Object.freeze({
  INCOMPLETE: "INCOMPLETE",
  PIVOT: "PIVOT",
  PROCEED_B: "PROCEED_B",
  REOBSERVE: "REOBSERVE",
});

// 계획 run 명단(20회): dev 10 + nondev 10.
export const PLAN = Object.freeze([
  ...["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10"].map((r) => ({ participantId: "dev", tester: "dev", recipeId: r })),
  ...[
    ["P1", "R01"], ["P1", "R04"], ["P2", "R02"], ["P2", "R05"], ["P3", "R03"],
    ["P3", "R06"], ["P4", "R01"], ["P4", "R06"], ["P5", "R02"], ["P5", "R04"],
  ].map(([participantId, recipeId]) => ({ participantId, tester: "nondev", recipeId })),
]);

const MAIN_RECIPES = new Set(["R01", "R02", "R03", "R04", "R05", "R06"]); // 분모 16회
const NONDEV = ["P1", "P2", "P3", "P4", "P5"];
const TERMINAL = new Set(TERMINAL_STATUSES);

// ─── 통계 ────────────────────────────────────────────────────────────────────

function binomCdf(k, n, p) {
  // P(X <= k)
  let sum = 0;
  let term = Math.pow(1 - p, n);
  for (let i = 0; i <= k; i += 1) {
    sum += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.min(1, sum);
}

// 정확 이항(Clopper-Pearson) 95% 구간. 이분법으로 푼다.
export function exactCI(k, n, alpha = 0.05) {
  if (n === 0) return null;
  const bisect = (f) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      if (f(mid)) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // 하한: P(X >= k | p) = alpha/2 가 되는 p. p 가 커질수록 P(X>=k) 증가.
  const lower = k === 0 ? 0 : bisect((p) => 1 - binomCdf(k - 1, n, p) < alpha / 2);
  // 상한: P(X <= k | p) = alpha/2 가 되는 p. p 가 커질수록 P(X<=k) 감소.
  const upper = k === n ? 1 : bisect((p) => binomCdf(k, n, p) > alpha / 2);
  return [lower, upper];
}

export function percentile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx];
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const ratio = (k, n) => ({ k, n, rate: n ? k / n : null, ci: exactCI(k, n) });

// ─── run 판독 ────────────────────────────────────────────────────────────────

// goalCount(세션 시작 때 기록한 레시피의 goal 수)와 같은 수의 goal 이 모두 done 이어야 한다.
// goalCount 가 없는 기록은 완주로 인정하지 않는다(빠진 goal 을 걸러 낼 수 없다).
const goalsAllDone = (run) =>
  Number.isInteger(run.goalCount) && run.goals.length === run.goalCount && run.goals.length > 0 &&
  run.goals.every((g) => g.result === "done");
const noSkips = (run) => (run.skippedSteps ?? 0) === 0 && run.goals.every((g) => (g.skippedSteps ?? 0) === 0);

// 레시피 완주 = 효과 상태 completed, 모든 goal done, skipped 없음.
export function isFullCompletion(row) {
  return row.effectiveStatus === "completed" && goalsAllDone(row.run) && noSkips(row.run);
}

// 코딩된 회차에서 "안 맡김" 또는 (혼자 할 수 있음 그리고 Q1 ≥ 1).
function meetsSelfReliance(obs) {
  return isCodedObservation(obs) && (obs.q2.choice === "keep" || (obs.q3 === true && obs.q1 >= 1));
}
function meetsPivotSignal(obs) {
  return isCodedObservation(obs) && obs.q2.choice === "delegate" && obs.q2.reasonCode === "tedious";
}

// ─── 명단 대조 ───────────────────────────────────────────────────────────────

// health(내보내기에 담긴 손실·중복 카운트)에서 판정을 막는 손실만 센다.
export function lossCounts(health) {
  const failed = (health?.run?.failed ?? 0) + (health?.obs?.failed ?? 0);
  const unmatched = (health?.run?.unmatched ?? 0) + (health?.obs?.unmatched ?? 0);
  return { failed, unmatched, total: failed + unmatched };
}

export function matchPlan(rows) {
  const slots = PLAN.map((slot) => ({ ...slot, rows: [] }));
  const unplanned = [];
  for (const row of rows) {
    const { participantId, recipeId, tester } = row.run;
    const slot = slots.find((s) => s.participantId === participantId && s.recipeId === recipeId && s.tester === tester);
    if (slot) slot.rows.push(row);
    else unplanned.push(row);
  }
  const missing = slots.filter((s) => s.rows.length === 0);
  const duplicates = slots.filter((s) => s.rows.length > 1);
  const inProgress = rows.filter((r) => !TERMINAL.has(r.effectiveStatus));
  return { slots, missing, duplicates, unplanned, inProgress };
}

// ─── 한 라운드 판정 ──────────────────────────────────────────────────────────

export function evaluateRound(rows, evalRound, health = null) {
  const match = matchPlan(rows);
  const problems = [];
  for (const s of match.missing) problems.push(`기록 없음: ${s.participantId} ${s.recipeId}`);
  for (const s of match.duplicates) problems.push(`중복 기록(명단에 없는 추가 기록): ${s.participantId} ${s.recipeId} × ${s.rows.length}`);
  for (const r of match.unplanned) problems.push(`명단에 없는 기록: ${r.run.participantId ?? "?"} ${r.run.recipeId ?? "?"} (${r.runId})`);
  for (const r of match.inProgress) problems.push(`종결되지 않음: ${r.run.participantId ?? "?"} ${r.run.recipeId ?? "?"} (${r.effectiveStatus})`);
  // 기록 손실(쓰기 실패, 부착하지 못한 이벤트)이 있으면 이 기록으로 판정하지 않는다. late·dup 은 손실이 아니다.
  const lost = lossCounts(health);
  if (lost.total > 0) problems.push(`기록 손실: 쓰기 실패 ${lost.failed}건, 부착 못 한 이벤트 ${lost.unmatched}건(레시피 밖 사용도 포함). 새 evalRound 로 다시 관찰하거나 원인을 확인하세요.`);

  const planned = match.slots.flatMap((s) => s.rows.slice(0, 1).map((row) => ({ slot: s, row })));
  const main = planned.filter(({ slot }) => MAIN_RECIPES.has(slot.recipeId));
  const nondevMain = main.filter(({ slot }) => slot.tester === "nondev");

  // 완주율(분모 R01~R06 16회).
  const complete = ratio(main.filter(({ row }) => isFullCompletion(row)).length, main.length);
  const completeNondev = ratio(nondevMain.filter(({ row }) => isFullCompletion(row)).length, nondevMain.length);

  // goal 단위 완주율(시도한 goal 기준, 수동 진행 없이 done).
  let attempted = 0;
  let doneGoals = 0;
  for (const { row } of main) {
    for (const g of row.run.goals) {
      attempted += 1;
      if (g.result === "done" && (g.skippedSteps ?? 0) === 0) doneGoals += 1;
    }
  }
  const goalLevel = ratio(doneGoals, attempted);

  // 허위 완주(완주로 기록됐는데 관찰자 확인 실패). 미확인은 따로 센다.
  const allPlanned = planned.map(({ row }) => row);
  const completedRows = allPlanned.filter((r) => r.effectiveStatus === "completed");
  const falseCompletions = completedRows.filter((r) => r.obs?.observerVerified === false);
  const unverified = completedRows.filter((r) => r.obs?.observerVerified !== true && r.obs?.observerVerified !== false);
  const mismatches = completedRows.filter(
    (r) => typeof r.obs?.observerVerified === "boolean" && r.run.userConfirmedReal !== undefined && r.run.userConfirmedReal !== r.obs.observerVerified,
  );
  const navOnlyRows = allPlanned.filter((r) => r.run.goals.some((g) => g.procedureKind === "nav_only"));
  const navOnlyAndFalse = navOnlyRows.filter((r) => falseCompletions.includes(r));

  // 조건 3: 안전 항목(관찰자 확인, 미확인은 미충족).
  const bySlot = (recipeId) => planned.filter(({ slot }) => slot.recipeId === recipeId).map(({ row }) => row);
  const secretRows = [...bySlot("R06"), ...bySlot("R08")];
  const oauthRows = [...bySlot("R07"), ...bySlot("R09")].filter((r) => r.run.tester === "dev");
  const payloadRows = bySlot("R10").filter((r) => r.run.tester === "dev");
  const cond3Parts = {
    secret: { total: secretRows.length, ok: secretRows.filter((r) => r.obs?.secretSentToLlm === false).length, leaked: secretRows.filter((r) => r.obs?.secretSentToLlm === true).length },
    oauth: { total: oauthRows.length, ok: oauthRows.filter((r) => r.obs?.oauthResumeOk === true).length },
    payload: { total: payloadRows.length, ok: payloadRows.filter((r) => r.obs?.payloadSentToLlm === false).length, leaked: payloadRows.filter((r) => r.obs?.payloadSentToLlm === true).length },
  };
  // 어느 레시피에서든 비밀값·payload 전송이 기록되면 조건 3 은 미충족이다(R06·R08·R10 외에도).
  const leakedRuns = allPlanned.filter((r) => r.obs?.secretSentToLlm === true || r.obs?.payloadSentToLlm === true);
  const cond3 = cond3Parts.secret.ok === cond3Parts.secret.total && cond3Parts.oauth.ok === cond3Parts.oauth.total &&
    cond3Parts.payload.ok === cond3Parts.payload.total && leakedRuns.length === 0;

  // 조건 4: 관측되지 않은 라벨 노출 0(다섯 곳 모두 코딩 필요), 크래시·무한 대기 0.
  const AUDIT = AUDIT_SURFACES;
  const auditUncoded = allPlanned.filter((r) => !AUDIT.every((k) => typeof r.obs?.audit?.[k] === "boolean"));
  const auditExposed = allPlanned.filter((r) => AUDIT.some((k) => r.obs?.audit?.[k] === true));
  const crashed = allPlanned.filter((r) => r.effectiveStatus === "crashOrHang");
  const cond4 = auditUncoded.length === 0 && auditExposed.length === 0 && crashed.length === 0;

  // 참가자 단위(R9): 두 회차 코드가 모두 조건을 만족해야 센다.
  const participants = NONDEV.map((pid) => {
    const mine = planned.filter(({ slot }) => slot.participantId === pid).map(({ row }) => row);
    const coded = mine.filter((r) => isCodedObservation(r.obs)).length;
    const both = mine.length === 2;
    return {
      participantId: pid,
      coded,
      selfReliant: both && mine.every((r) => meetsSelfReliance(r.obs)),
      pivotSignal: both && mine.every((r) => meetsPivotSignal(r.obs)),
    };
  });
  const selfReliantCount = participants.filter((p) => p.selfReliant).length;
  const pivotCount = participants.filter((p) => p.pivotSignal).length;

  const conditions = {
    c1: { label: "레시피 완주율 50% 이상 (R01~R06 16회 중 8회)", met: complete.k >= 8, detail: `${complete.k}/${complete.n}` },
    c2: { label: "허위 완주 1건 이하 (관찰자 확인 기준, 미확인 없음)", met: falseCompletions.length <= 1 && unverified.length === 0, detail: `허위 ${falseCompletions.length}, 미확인 ${unverified.length}` },
    c3: { label: "비밀값 LLM 전송 0, OAuth 재개 성공, payload 미포함", met: cond3, detail: `비밀값 ${cond3Parts.secret.ok}/${cond3Parts.secret.total}, OAuth ${cond3Parts.oauth.ok}/${cond3Parts.oauth.total}, payload ${cond3Parts.payload.ok}/${cond3Parts.payload.total}, 전송 기록 ${leakedRuns.length}건` },
    c4: { label: "관측되지 않은 라벨 노출 0, 크래시·무한 대기 0", met: cond4, detail: `노출 ${auditExposed.length}, 감사 미코딩 ${auditUncoded.length}, crashOrHang ${crashed.length}` },
    c5: { label: "nondev 5명 중 3명 이상이 '안 맡김' 또는 '혼자 할 수 있음+Q1≥1'", met: selfReliantCount >= 3, detail: `${selfReliantCount}/5` },
  };
  const pivot = {
    goalLevelBelow30: goalLevel.n > 0 && goalLevel.rate < 0.3,
    delegateTedious4: pivotCount >= 4,
    goalLevel,
    pivotCount,
  };

  let verdict;
  let reason;
  if (problems.length > 0) {
    verdict = VERDICT.INCOMPLETE;
    reason = "계획 run 명단 또는 기록 건강 상태에 문제가 있습니다. B 진행도 피벗도 내지 않습니다.";
  } else if (pivot.goalLevelBelow30 || pivot.delegateTedious4) {
    verdict = VERDICT.PIVOT;
    reason = pivot.goalLevelBelow30
      ? `goal 단위 완주율 ${pct(goalLevel.rate)} < 30% (v2 가정 재검토)`
      : `nondev ${pivotCount}/5명이 '맡김'+'귀찮음/보기 싫음' (대신 해 주되 설명하는 모드)`;
  } else if (Object.values(conditions).every((c) => c.met)) {
    verdict = VERDICT.PROCEED_B;
    reason = "B 진행 조건 1~5를 모두 충족했습니다.";
  } else {
    verdict = VERDICT.REOBSERVE;
    reason = `미충족 조건: ${Object.entries(conditions).filter(([, c]) => !c.met).map(([k]) => k.replace("c", "")).join(", ")}. 같은 구성으로 한 번 더(evalRound +1) 관찰합니다.`;
  }

  // 피벗이 우선이어도 안전 항목 위반은 판정 이유에 드러낸다.
  if (leakedRuns.length > 0) reason += ` [경고: 비밀값·payload LLM 전송이 ${leakedRuns.length}건 기록됨(조건 3)]`;
  if (crashed.length > 0) reason += ` [경고: crashOrHang ${crashed.length}건(조건 4)]`;

  const resolverMs = main.flatMap(({ row }) => row.run.goals.flatMap((g) => g.resolverMs ?? []));
  const p50 = percentile(resolverMs, 0.5);
  return {
    evalRound,
    verdict,
    reason,
    problems,
    conditions,
    pivot,
    participants,
    info: {
      complete, completeNondev, goalLevel,
      goalLevel60: goalLevel.n > 0 && goalLevel.rate >= 0.6,
      resolverP50: p50,
      resolverP50Within6s: p50 !== null && p50 <= 6000,
      falseCompletions: falseCompletions.length,
      mismatches: mismatches.length,
      navOnlyRuns: navOnlyRows.length,
      navOnlyAndFalse: navOnlyAndFalse.length,
      postFinalizeEvents: rows.reduce((n, r) => n + (r.postFinalizeEvents ?? 0), 0),
    },
  };
}

// 내보내기 파일의 최소 형태 검사. 문제가 있으면 사유 문자열, 없으면 null.
export function validateExport(exported) {
  if (!exported || typeof exported !== "object" || !Array.isArray(exported.runs)) return "runs 배열이 없습니다.";
  for (const [i, row] of exported.runs.entries()) {
    const run = row?.run;
    if (!run || typeof run !== "object" || !Array.isArray(run.goals) || typeof row.runId !== "string") {
      return `runs[${i}] 의 형식이 올바르지 않습니다(run, run.goals, runId).`;
    }
  }
  return null;
}

// 내보내기 전체 → 라운드별 판정. 최종 판정은 가장 큰 라운드의 것이다.
export function buildReport(exported) {
  const rows = exported?.runs ?? [];
  const roundOf = (r) => Number(r.run.evalRound ?? 1); // "1" 과 1 을 다른 라운드로 쪼개지 않는다
  const rounds = [...new Set(rows.map(roundOf))].sort((a, b) => a - b);
  if (rounds.length === 0) rounds.push(1);
  const results = rounds.map((round) => evaluateRound(rows.filter((r) => roundOf(r) === round), round, exported?.health ?? null));
  return { exportedAt: exported?.exportedAt ?? null, extVersion: exported?.extVersion ?? null, health: exported?.health ?? null, rounds: results, final: results.at(-1) };
}

// ─── 출력 ────────────────────────────────────────────────────────────────────

const ci = (r) => (r.ci ? ` (95% 구간 ${pct(r.ci[0])}~${pct(r.ci[1])})` : "");

export function renderReport(report) {
  const out = [];
  out.push("# Stage A 판정 리포트");
  out.push("");
  out.push("> 파일럿 휴리스틱이며 통계 검증이 아닙니다. 구간은 보고만 하고 게이트로 쓰지 않습니다.");
  if (report.extVersion) out.push(`> 확장 버전 ${report.extVersion}`);
  const h = report.health;
  const lossy = h && ["run", "obs"].some((c) => Object.values(h[c] ?? {}).some((n) => n > 0));
  if (lossy) out.push(`> 기록 건강 상태에 손실·중복 카운트가 있습니다: ${JSON.stringify(h)}`);
  out.push("");
  for (const r of report.rounds) {
    out.push(`## evalRound ${r.evalRound}${r === report.final ? " (최종)" : ""}: **${r.verdict}**`);
    out.push(r.reason);
    out.push("");
    if (r.problems.length) {
      out.push("### 명단 대조");
      for (const p of r.problems) out.push(`- ${p}`);
      out.push("");
    }
    out.push("### B 진행 조건");
    for (const [k, c] of Object.entries(r.conditions)) out.push(`- ${k.replace("c", "")}. ${c.met ? "충족" : "미충족"} — ${c.label}: ${c.detail}`);
    out.push("");
    out.push("### 피벗 조건");
    out.push(`- goal 단위 완주율 30% 미만: ${r.pivot.goalLevelBelow30 ? "해당" : "아님"} (${r.pivot.goalLevel.k}/${r.pivot.goalLevel.n}${ci(r.pivot.goalLevel)})`);
    out.push(`- nondev 4명 이상이 '맡김'+'귀찮음/보기 싫음': ${r.pivot.delegateTedious4 ? "해당" : "아님"} (${r.pivot.pivotCount}/5)`);
    out.push("");
    out.push("### 참가자 요약");
    for (const p of r.participants) out.push(`- ${p.participantId}: 코딩된 회차 ${p.coded}/2 · 안 맡김/혼자 가능 ${p.selfReliant ? "충족" : "미충족"} · 맡김+귀찮음 ${p.pivotSignal ? "해당" : "아님"}`);
    out.push("");
    out.push("### 보고(게이트 아님)");
    const i = r.info;
    out.push(`- 레시피 완주율(R01~R06): ${i.complete.k}/${i.complete.n}${ci(i.complete)}`);
    out.push(`- nondev 하위 합계: ${i.completeNondev.k}/${i.completeNondev.n}${ci(i.completeNondev)}`);
    out.push(`- goal 단위 완주율: ${i.goalLevel.k}/${i.goalLevel.n}${ci(i.goalLevel)} — 60% 이상 ${i.goalLevel60 ? "예" : "아니오"}`);
    out.push(`- resolver 응답 p50: ${i.resolverP50 === null ? "측정 없음" : `${i.resolverP50}ms`} — 6초 이하 ${i.resolverP50Within6s ? "예" : "아니오"}`);
    out.push(`- 허위 완주 ${i.falseCompletions}건, 참가자 답과 관찰자 판정 불일치 ${i.mismatches}건`);
    out.push(`- 화면 이동만 한 절차(nav_only)가 있는 run ${i.navOnlyRuns}건 중 허위 완주와 겹침 ${i.navOnlyAndFalse}건`);
    out.push(`- 종결 뒤 러너 이벤트(postFinalizeEvents) 합계 ${i.postFinalizeEvents}건`);
    out.push("");
  }
  // 파일에서 온 문자열에 제어 문자(ANSI 이스케이프 등)가 있어도 터미널을 흔들지 못하게 한다.
  return out.join("\n").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main(argv) {
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("사용: node scripts/eval-report.js <evallog 내보내기.json> [--json]");
    return 2;
  }
  let exported;
  try {
    exported = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`내보내기 파일을 읽지 못했습니다: ${err.message}`);
    return 2;
  }
  const invalid = validateExport(exported);
  if (invalid) {
    console.error(`내보내기 파일 형식 오류: ${invalid}`);
    return 2;
  }
  const report = buildReport(exported);
  console.log(argv.includes("--json") ? JSON.stringify(report, null, 2) : renderReport(report));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
