// Stage A 평가 로그. 계약: docs/observation-checklist.md Part 1.
//
// 저장 키(chrome.storage.local, 접두어 `sc.evallog.`)와 쓰는 곳:
//   sc.evallog.run.<runId>   사이드패널만(상태 전이, goal 기록, 이벤트)
//   sc.evallog.obs.<runId>   옵션 페이지만(관찰자 판정, 종결 결과)
//   sc.evallog.config        옵션 페이지만(참가자·라운드 설정)
//   sc.evallog.stats.run|obs 각 쓰는 쪽(손실·중복 카운트)
//   sc.evallog.active        사이드패널(chrome.storage.session, tabId → runId)
// `sc.settings`(API 키 포함)는 내보내지도 지우지도 않는다. 목록·정리는 저장소 전체를 한 번 읽어(`get(null)`)
// 접두어로 거르므로 값이 메모리에는 올라온다. 걸러내는 곳은 pickPrefixed 와 RUN 필터뿐이니 바꿀 때 주의한다.
//
// 모든 읽기-수정-쓰기는 이름 있는 락(navigator.locks)에서 한다. 락이 없으면 이 모듈 안의
// promise 대기열로 폴백한다(같은 화면 안만 보호한다).
//
// 기록하지 않는 것: 화면 텍스트, 라벨 텍스트, 비밀값. guard 이유는 이유 코드만 저장한다.
import { scrubSecrets } from "./scrub.js";

export const SCHEMA_VERSION = 1;
export const LOCK_NAME = "sc.evallog";

const PREFIX = "sc.evallog.";
const RUN = `${PREFIX}run.`;
const OBS = `${PREFIX}obs.`;
const CONFIG_KEY = `${PREFIX}config`;
const ACTIVE_KEY = `${PREFIX}active`;
const STATS_KEY = { run: `${PREFIX}stats.run`, obs: `${PREFIX}stats.obs` };

// 엔진 이벤트 계약(T2가 이 이름과 형식으로 보낸다).
// 모든 이벤트: { type, tabId, recipeId, goalIdx, ts }. goal_done·goal_skipped·session_cleared 는
// 세션의 최종 `status`('running'|'done'|'blocked'|'paused')를 더한다.
export const EVENT = Object.freeze({
  SESSION_CREATED: "session_created",
  GOAL_DONE: "goal_done",
  GOAL_BLOCKED: "goal_blocked",
  GOAL_SKIPPED: "goal_skipped",
  PAUSED: "paused",
  RESUMED: "resumed",
  SESSION_CLEARED: "session_cleared",
});

export const TERMINAL_STATUSES = Object.freeze(["completed", "abandoned", "rejected", "crashOrHang"]);
export const OBSERVER_OUTCOMES = Object.freeze(["abandoned", "crashOrHang"]);

// ─── 락 ──────────────────────────────────────────────────────────────────────

let fallbackChain = Promise.resolve();

function withLock(fn) {
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === "function") {
    return locks.request(LOCK_NAME, async () => fn());
  }
  const run = fallbackChain.then(() => fn());
  fallbackChain = run.catch(() => {});
  return run;
}

// ─── 순수 함수 ───────────────────────────────────────────────────────────────

// 알려진 guard 이유 코드. 긴 것부터 접두 매칭한다(`unobserved` 가 `unobserved_label` 을 가리지 않게).
const KNOWN_REASON_CODES = [
  "quoted_not_in_usedLabels",
  "unobserved_locator",
  "unobserved_label",
  "json_parse_error",
  "provider_error",
  "no_usedLabels",
  "no_procedure",
  "unobserved",
  "no_verify",
  "no_steps",
  "not_object",
  "bad_locator",
  "css_locator",
];

// guard 이유 원문(`step0:unobserved_label:<화면 라벨>` 등)에서 코드만 뽑는다.
// 라벨 안에 ':' 가 있어도 안전하도록 split 이 아니라 접두 매칭을 쓴다.
export function extractReasonCode(reason) {
  if (typeof reason !== "string") return "unknown";
  let rest = reason.replace(/^step\d+:/, "");
  rest = rest.replace(/^(?:target|verify\.probe|verify\.text):/, "");
  for (const code of KNOWN_REASON_CODES) {
    if (rest === code || rest.startsWith(`${code}:`)) return code;
  }
  return "unknown";
}

function isNavStep(step) {
  return step?.target?.by === "linkText" && step?.verify?.is === "urlIncludes";
}

// 화면 이동 전용 절차 분류(정보용, 게이트 아님). 라벨 텍스트는 보지도 저장하지도 않는다.
export function classifyProcedure(procedure) {
  const steps = Array.isArray(procedure?.steps) ? procedure.steps : [];
  if (steps.length === 0) return "empty";
  const nav = steps.filter(isNavStep).length;
  if (nav === steps.length) return "nav_only";
  if (nav === 0) return "action";
  return "mixed";
}

// 효과 상태 = 관찰자 종결 ?? run 기록 상태.
export function effectiveStatus(run, obs) {
  return obs?.finalOutcome ?? run?.status ?? null;
}

// 코딩된 회차: 참가자 답 Q1·Q2(맡김 여부)·Q3 가 모두 있는 관찰. 하나라도 비면 코딩되지 않은 것이다(R9).
export function isCodedObservation(obs) {
  return (
    !!obs &&
    [0, 1, 2].includes(obs.q1) &&
    (obs.q2?.choice === "delegate" || obs.q2?.choice === "keep") &&
    (obs.q3 === true || obs.q3 === false)
  );
}

// listRuns() 행 → 참가자별 요약. evalRound 별로 따로 묶는다(풀링 금지).
// nondev 는 회차당 2회 계획이라 `coded/2` 로 보고한다. dev 는 개수만 센다.
export function summarizeParticipants(rows) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const { participantId, evalRound, tester } = row.run;
    const key = `${evalRound}\u0000${participantId ?? "?"}`;
    if (!groups.has(key)) groups.set(key, { evalRound, participantId: participantId ?? null, tester, runs: 0, coded: 0 });
    const g = groups.get(key);
    g.runs += 1;
    if (isCodedObservation(row.obs)) g.coded += 1;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, plannedRuns: g.tester === "nondev" ? 2 : null }))
    .sort((a, b) => a.evalRound - b.evalRound || String(a.participantId).localeCompare(String(b.participantId)));
}

// 열린 탭 목록(`chrome.tabs.query`)과 활성 매핑으로 abandoned 대상을 찾는다(순수 함수).
// in_progress run 의 탭이 없거나 활성 세션 매핑이 그 run 이 아니면 abandoned.
export function findAbandoned(runs, openTabIds, activeMap = {}) {
  const open = new Set((openTabIds ?? []).map(Number));
  const out = [];
  for (const run of runs ?? []) {
    if (run?.status !== "in_progress") continue;
    const alive = open.has(Number(run.tabId)) && activeMap[String(run.tabId)] === run.runId;
    if (!alive) out.push(run.runId);
  }
  return out;
}

// ─── 저장소 접근 ─────────────────────────────────────────────────────────────

const local = () => chrome.storage.local;
const session = () => chrome.storage.session;

async function getOne(area, key) {
  return (await area.get(key))[key];
}

async function readActive() {
  return (await getOne(session(), ACTIVE_KEY)) ?? {};
}

async function readConfigRaw() {
  return { tester: "nondev", participantId: null, evalRound: 1, ...(await getOne(local(), CONFIG_KEY)) };
}

function extVersion() {
  try {
    return chrome.runtime?.getManifest?.()?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function newRunId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── 손실·중복 카운트 ────────────────────────────────────────────────────────
// 락 안에서 호출하지 않는다(락은 재진입되지 않는다). guarded() 가 락을 푼 뒤 반영한다.

const pending = { run: {}, obs: {} };

async function bump(ctx, field) {
  if (field) pending[ctx][field] = (pending[ctx][field] ?? 0) + 1;
  if (Object.keys(pending[ctx]).length === 0) return;
  try {
    await withLock(async () => {
      const key = STATS_KEY[ctx];
      const cur = (await getOne(local(), key)) ?? {};
      // 저장하는 동안 쌓인 카운트를 지우지 않도록, 저장한 만큼만 뺀다.
      const snap = { ...pending[ctx] };
      for (const [f, n] of Object.entries(snap)) cur[f] = (cur[f] ?? 0) + n;
      await local().set({ [key]: cur });
      for (const [f, n] of Object.entries(snap)) {
        pending[ctx][f] -= n;
        if (pending[ctx][f] <= 0) delete pending[ctx][f];
      }
    });
  } catch {
    // 카운트조차 저장하지 못하면 메모리에 남겨 getHealth() 가 합산한다.
  }
}

// ctx: 'run'(사이드패널 쪽) | 'obs'(옵션 페이지 쪽). fn(notes) 가 notes 에 ['dup'] 등을 쌓는다.
async function guarded(ctx, fn, onError) {
  const notes = [];
  let result;
  try {
    result = await withLock(() => fn(notes));
  } catch {
    notes.push("failed");
    result = onError;
  }
  for (const field of notes) await bump(ctx, field);
  if (notes.length === 0) await bump(ctx); // 이전 쓰기 실패로 메모리에 남은 카운트를 비운다.
  return result;
}

export async function getHealth() {
  const out = { run: {}, obs: {} };
  for (const ctx of ["run", "obs"]) {
    let stored = {};
    try {
      stored = (await getOne(local(), STATS_KEY[ctx])) ?? {};
    } catch {
      // 읽기 실패는 메모리 값만 보고한다.
    }
    const merged = { ...stored };
    for (const [f, n] of Object.entries(pending[ctx])) merged[f] = (merged[f] ?? 0) + n;
    out[ctx] = merged;
  }
  return out;
}

// ─── run 쪽(사이드패널) ──────────────────────────────────────────────────────

function newRun(evt, config, now) {
  return {
    runId: newRunId(),
    schemaVersion: SCHEMA_VERSION,
    extVersion: extVersion(),
    tester: config.tester,
    participantId: config.participantId,
    evalRound: config.evalRound,
    recipeId: evt.recipeId ?? null,
    goalCount: Number.isInteger(evt.goalCount) ? evt.goalCount : null,
    tabId: evt.tabId,
    status: "in_progress",
    startedAt: now,
    endedAt: null,
    endCause: null,
    currentGoalIdx: 0,
    goals: [],
    popupPauses: 0,
    skippedSteps: 0,
    lastSeq: 0,
    events: [],
  };
}

function ensureGoal(run, idx) {
  const i = Number.isInteger(idx) && idx >= 0 ? idx : 0;
  while (run.goals.length <= i) {
    run.goals.push({
      index: run.goals.length,
      result: null,
      screens: 0,
      resolverMs: [],
      attempts: 0,
      guardRejects: [],
      procedureKind: null,
      blockedCause: null,
      skippedSteps: 0,
    });
  }
  return run.goals[i];
}

// (runId, seq) 멱등: seq 가 주어지고 이미 있으면 false.
function pushEvent(run, type, extra = {}, seq) {
  if (seq !== undefined && run.events.some((e) => e.seq === seq)) return false;
  run.lastSeq = Math.max(run.lastSeq, seq ?? 0) + (seq === undefined ? 1 : 0);
  run.events.push({ seq: seq ?? run.lastSeq, type, ts: extra.ts ?? Date.now(), ...extra });
  return true;
}

function terminalize(run, status, now, cause) {
  if (run.status !== "in_progress") return false;
  run.status = status;
  run.endedAt = now;
  run.endCause = cause;
  return true;
}

async function writeRun(run) {
  await local().set({ [RUN + run.runId]: run });
}

async function activeRun(tabId, notes) {
  const active = await readActive();
  const runId = active[String(tabId)];
  if (!runId) {
    notes.push("unmatched");
    return { active, run: null };
  }
  const run = await getOne(local(), RUN + runId);
  if (!run) {
    notes.push("unmatched");
    return { active, run: null };
  }
  // 관찰자가 종결한 run 에는 러너의 늦은 기록이 들어오지 않는다(판정에 쓰이는 goal 통계가 바뀌지 않게).
  const obs = await getOne(local(), OBS + runId);
  if (obs?.finalOutcome) {
    notes.push("late");
    return { active, run: null };
  }
  return { active, run };
}

async function handleEvent(evt, notes) {
  if (!evt || typeof evt.tabId !== "number") return;
  const tabKey = String(evt.tabId);
  const now = evt.ts ?? Date.now();

  if (evt.type === EVENT.SESSION_CREATED) {
    const active = await readActive();
    const prevId = active[tabKey];
    if (prevId) {
      const prev = await getOne(local(), RUN + prevId);
      if (prev && terminalize(prev, "abandoned", now, "replaced")) await writeRun(prev);
    }
    const run = newRun(evt, await readConfigRaw(), now);
    pushEvent(run, evt.type, { ts: now, goalIdx: 0 });
    await writeRun(run);
    active[tabKey] = run.runId;
    await session().set({ [ACTIVE_KEY]: active });
    return;
  }

  // 정리 이벤트는 매핑이 이미 없어도 손실이 아니다(재오픈 정리·중복 정리).
  const hadMapping = Boolean((await readActive())[tabKey]);
  const { active, run } = await activeRun(evt.tabId, notes);
  if (!run) {
    // 관찰자가 종결한 run 이라도 정리 이벤트는 탭 매핑을 지운다(남아 있으면 재오픈 정리가 run 에 이벤트를 덧붙인다).
    if (evt.type === EVENT.SESSION_CLEARED && hadMapping && notes.includes("late")) {
      delete active[tabKey];
      await session().set({ [ACTIVE_KEY]: active });
      return;
    }
    if (evt.type === EVENT.SESSION_CLEARED && !hadMapping) {
      const i = notes.indexOf("unmatched");
      if (i >= 0) notes.splice(i, 1);
      notes.push("late");
    }
    return;
  }
  // 같은 탭을 차지한 다른 레시피의 늦은 이벤트는 이 run 에 붙이지 않는다.
  if (run.recipeId && evt.recipeId && run.recipeId !== evt.recipeId) {
    notes.push("unmatched");
    return;
  }
  // 종결된 run 의 기록(goal 결과·카운트)은 바꾸지 않는다. 정리 이벤트는 매핑만 지운다(이벤트를 덧붙이지 않는다).
  if (run.status !== "in_progress") {
    if (evt.type === EVENT.SESSION_CLEARED) {
      delete active[tabKey];
      await session().set({ [ACTIVE_KEY]: active });
    } else {
      notes.push("late");
    }
    return;
  }
  const idx = Number.isInteger(evt.goalIdx) ? evt.goalIdx : run.currentGoalIdx;

  switch (evt.type) {
    case EVENT.GOAL_DONE: {
      const goal = ensureGoal(run, idx);
      goal.result = "done";
      run.currentGoalIdx = idx + 1;
      if (evt.status === "done") terminalize(run, "completed", now, "done");
      break;
    }
    case EVENT.GOAL_SKIPPED: {
      ensureGoal(run, idx).result = "skipped_optional";
      run.currentGoalIdx = idx + 1;
      if (evt.status === "done") terminalize(run, "completed", now, "done");
      break;
    }
    case EVENT.GOAL_BLOCKED:
      ensureGoal(run, idx).result = "blocked";
      break;
    case EVENT.PAUSED:
      run.popupPauses += 1;
      break;
    case EVENT.RESUMED:
      break;
    case EVENT.SESSION_CLEARED:
      // 세션이 done 으로 정리됐는데 완료 이벤트를 잃었다면 reconcile 이 abandoned 로 오판하지 않게 여기서 닫는다.
      // goal 이 빠졌다면 eval-report 의 goalsAllDone(goalCount 비교)이 완주로 세지 않는다.
      if (evt.status === "done") terminalize(run, "completed", now, "done_on_clear");
      else terminalize(run, "abandoned", now, "cleared");
      break;
    default:
      return;
  }
  pushEvent(run, evt.type, { ts: now, goalIdx: idx });
  await writeRun(run);

  if (evt.type === EVENT.SESSION_CLEARED) {
    delete active[tabKey];
    await session().set({ [ACTIVE_KEY]: active });
  }
}

// 엔진 이벤트 리스너. 실패해도 던지지 않는다(러너 계속, 손실 카운트).
export function onRecipeEvent(evt) {
  return guarded("run", (notes) => handleEvent(evt, notes), undefined);
}

const BLOCKED_CAUSES = ["guard_fail", "json_parse_error", "empty", "capture_failed", "resolve_error"];

// resolve() 실패(err)를 blockedCause 로 분류한다. 패널이 쓰는 순수 함수.
export function blockedCauseFor(err) {
  if (err?.code === "guard_fail" || err?.message === "guard_fail") return "guard_fail";
  const last = err?.attempts?.at?.(-1)?.reasons ?? [];
  if (last.includes("json_parse_error")) return "json_parse_error";
  return "resolve_error";
}

// resolve() 한 번의 결과 계측. attempts 는 resolve() 가 돌려준 { reasons } 목록.
export function recordResolve(tabId, { resolverMs, attempts = [], procedure = null, blockedCause = null } = {}) {
  return guarded(
    "run",
    async (notes) => {
      const { run } = await activeRun(tabId, notes);
      if (!run) return;
      if (run.status !== "in_progress") {
        notes.push("late");
        return;
      }
      const goal = ensureGoal(run, run.currentGoalIdx);
      goal.screens += 1;
      if (Number.isFinite(resolverMs)) goal.resolverMs.push(Math.round(resolverMs));
      goal.attempts += attempts.length;
      for (const a of attempts) {
        for (const r of a?.reasons ?? []) goal.guardRejects.push(extractReasonCode(r));
      }
      if (procedure) goal.procedureKind = classifyProcedure(procedure);
      if (blockedCause) goal.blockedCause = BLOCKED_CAUSES.includes(blockedCause) ? blockedCause : "unknown";
      pushEvent(run, "resolve", { goalIdx: goal.index });
      await writeRun(run);
    },
    undefined,
  );
}

// 수동 진행(skip)을 발생 즉시 기록한다(패널을 닫았다 열어도 남는다).
export function recordSkip(tabId, { stepIdx } = {}) {
  return guarded(
    "run",
    async (notes) => {
      const { run } = await activeRun(tabId, notes);
      if (!run) return;
      if (run.status !== "in_progress") {
        notes.push("late");
        return;
      }
      const goal = ensureGoal(run, run.currentGoalIdx);
      goal.skippedSteps += 1;
      run.skippedSteps += 1;
      pushEvent(run, "skip", { goalIdx: goal.index, stepIdx: Number.isInteger(stepIdx) ? stepIdx : null });
      await writeRun(run);
    },
    undefined,
  );
}

// recipe-done "실제로 됐나요?" 답. 더블클릭·재열기에는 첫 답만 남기고 중복으로 센다.
// 반환 { ok }: 저장했거나 이미 답이 있으면 true, run 을 못 찾거나 쓰기가 실패하면 false.
export function recordConfirm(tabId, answer) {
  return guarded(
    "run",
    async (notes) => {
      const { run } = await activeRun(tabId, notes);
      if (!run) return { ok: false };
      if (run.userConfirmedReal !== undefined) {
        notes.push("dup");
        return { ok: true };
      }
      run.userConfirmedReal = answer === true;
      pushEvent(run, "confirm");
      await writeRun(run);
      return { ok: true };
    },
    { ok: false },
  );
}

// 패널 init: in_progress run 중 탭이 닫혔거나 활성 세션이 아닌 것을 abandoned 로 종결한다.
export function markAbandoned(openTabIds) {
  return guarded(
    "run",
    async () => {
      const all = await local().get(null);
      const runs = Object.entries(all)
        .filter(([k]) => k.startsWith(RUN))
        .map(([, v]) => v);
      const active = await readActive();
      const dead = findAbandoned(runs, openTabIds, active);
      const now = Date.now();
      for (const runId of dead) {
        const run = all[RUN + runId];
        if (terminalize(run, "abandoned", now, "reconcile")) {
          pushEvent(run, "abandoned", { ts: now });
          await writeRun(run);
        }
      }
      const open = new Set((openTabIds ?? []).map(String));
      let changed = false;
      for (const tabKey of Object.keys(active)) {
        if (!open.has(tabKey)) {
          delete active[tabKey];
          changed = true;
        }
      }
      if (changed) await session().set({ [ACTIVE_KEY]: active });
      return dead;
    },
    [],
  );
}

// ─── 관찰자 쪽(옵션 페이지) ──────────────────────────────────────────────────

export async function getConfig() {
  return readConfigRaw();
}

export function setConfig(partial = {}) {
  return guarded(
    "obs",
    async () => {
      const next = { ...(await readConfigRaw()) };
      if ("tester" in partial) {
        if (partial.tester !== "dev" && partial.tester !== "nondev") return { ok: false, reason: "invalid_tester" };
        next.tester = partial.tester;
      }
      if ("participantId" in partial) {
        const p = partial.participantId;
        if (p !== null && !(typeof p === "string" && /^(dev|P[1-9][0-9]?)$/.test(p))) return { ok: false, reason: "invalid_participant" };
        next.participantId = p;
      }
      if ("evalRound" in partial) {
        if (!Number.isInteger(partial.evalRound) || partial.evalRound < 1) return { ok: false, reason: "invalid_round" };
        next.evalRound = partial.evalRound;
      }
      // dev 는 참가자 ID dev, nondev 는 P1~P99 로만 짝지을 수 있다(잘못 태그된 run 은 되돌릴 수 없다).
      if (next.participantId !== null && (next.tester === "dev") !== (next.participantId === "dev")) {
        return { ok: false, reason: "tester_mismatch" };
      }
      await local().set({ [CONFIG_KEY]: next });
      return { ok: true, config: next };
    },
    { ok: false, reason: "write_failed" },
  );
}

const REASON_CODES = ["distrust", "tedious", "learn", "other"]; // 불신·불안, 귀찮음·보기 싫음, 배우고 싶음, 기타
export const SAFETY_FIELDS = Object.freeze(["secretSentToLlm", "oauthResumeOk", "payloadSentToLlm"]);
export const AUDIT_SURFACES = ["instruct", "goalLabel", "recoverText", "badge", "onFail"];
const triBool = (v) => v === true || v === false || v === null;
const text = (v) => scrubSecrets(String(v ?? "")).slice(0, 2000);

// 화이트리스트 검증. 알려지지 않은 필드는 버리고, 잘못된 값은 실패로 돌려준다.
function sanitizeObservation(data) {
  const out = {};
  if ("observerVerified" in data) {
    if (!triBool(data.observerVerified)) return { error: "observerVerified" };
    out.observerVerified = data.observerVerified;
  }
  if ("q1" in data) {
    if (![0, 1, 2, null].includes(data.q1)) return { error: "q1" };
    out.q1 = data.q1;
  }
  if ("q2" in data) {
    const q2 = data.q2 ?? {};
    if (![null, undefined, "delegate", "keep"].includes(q2.choice)) return { error: "q2.choice" };
    if (![null, undefined, ...REASON_CODES].includes(q2.reasonCode)) return { error: "q2.reasonCode" };
    out.q2 = { choice: q2.choice ?? null, reasonCode: q2.reasonCode ?? null, quote: text(q2.quote) };
  }
  if ("q3" in data) {
    if (!triBool(data.q3)) return { error: "q3" };
    out.q3 = data.q3;
  }
  if ("baseline" in data) {
    if (![null, "guide", "delegate"].includes(data.baseline)) return { error: "baseline" };
    out.baseline = data.baseline;
  }
  if ("audit" in data) {
    const audit = data.audit ?? {};
    out.audit = {};
    for (const s of AUDIT_SURFACES) {
      if (s in audit) {
        if (!triBool(audit[s])) return { error: `audit.${s}` };
        out.audit[s] = audit[s];
      }
    }
  }
  // B 조건 3: 관찰자가 확인하는 안전 항목(R06·R08 비밀값 LLM 전송, R07·R09 OAuth 재개, R10 payload LLM 포함).
  for (const k of SAFETY_FIELDS) {
    if (k in data) {
      if (!triBool(data[k])) return { error: k };
      out[k] = data[k];
    }
  }
  if ("relationship" in data) out.relationship = text(data.relationship);
  if ("notes" in data) out.notes = text(data.notes);
  return { out };
}

// 관찰자 판정 저장. 진행 중 run 은 거부한다. run 키는 바꾸지 않는다.
// expectedRevision 이 주어지면 화면이 읽은 뒤 다른 곳에서 먼저 저장된 경우 거부한다(안전 항목을 옛 값으로 덮지 않게).
export function saveObservation(runId, data = {}, { expectedRevision } = {}) {
  return guarded(
    "obs",
    async () => {
      const run = await getOne(local(), RUN + runId);
      if (!run) return { ok: false, reason: "run_not_found" };
      const prev = (await getOne(local(), OBS + runId)) ?? {};
      if (effectiveStatus(run, prev) === "in_progress") return { ok: false, reason: "in_progress" };
      if (expectedRevision !== undefined && (prev.revision ?? 0) !== expectedRevision) return { ok: false, reason: "stale", revision: prev.revision ?? 0 };
      const { out, error } = sanitizeObservation(data);
      if (error) return { ok: false, reason: "invalid_field", field: error };
      const obs = { ...prev, ...out, runId, savedAt: Date.now(), revision: (prev.revision ?? 0) + 1 };
      await local().set({ [OBS + runId]: obs });
      return { ok: true, obs };
    },
    { ok: false, reason: "write_failed" },
  );
}

// 시스템이 추측으로 닫은 abandoned run 의 종결 원인. 관찰자가 한 번 실제 원인(crashOrHang)으로 덮을 수 있다.
// 탭을 닫거나 다시 시작해서(cleared·replaced) 멈춤이 단순 중단으로 기록된 경우를 포함한다.
const SYSTEM_ABANDON_CAUSES = Object.freeze(["reconcile", "cleared", "replaced"]);
export const isSystemAbandoned = (run) => run?.status === "abandoned" && SYSTEM_ABANDON_CAUSES.includes(run.endCause);

// 관찰자 종결. in_progress run(또는 시스템이 abandoned 로 닫은 run)에만 가능하고 되돌릴 수 없다. obs 키에만 쓴다.
export function finalizeRun(runId, outcome) {
  return guarded(
    "obs",
    async () => {
      if (!OBSERVER_OUTCOMES.includes(outcome)) return { ok: false, reason: "bad_outcome" };
      const run = await getOne(local(), RUN + runId);
      if (!run) return { ok: false, reason: "run_not_found" };
      const prev = (await getOne(local(), OBS + runId)) ?? {};
      if (prev.finalOutcome) return { ok: false, reason: "already_finalized" };
      // 시스템이 추측으로 닫은 abandoned run 은 관찰자가 실제 원인으로 덮을 수 있다. 그 밖의 종결은 되돌릴 수 없다.
      if (run.status !== "in_progress" && !isSystemAbandoned(run)) return { ok: false, reason: "already_terminal" };
      const obs = { ...prev, runId, finalOutcome: outcome, finalizedAt: Date.now() };
      await local().set({ [OBS + runId]: obs });
      return { ok: true, obs };
    },
    { ok: false, reason: "write_failed" },
  );
}

// ─── 읽기·내보내기·삭제(접두어 키만) ─────────────────────────────────────────

function pickPrefixed(all) {
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(PREFIX)));
}

function summarize(run, obs) {
  const finalizedAt = obs?.finalizedAt;
  return {
    runId: run.runId,
    run,
    obs: obs ?? null,
    effectiveStatus: effectiveStatus(run, obs),
    postFinalizeEvents: finalizedAt ? run.events.filter((e) => e.ts > finalizedAt).length : 0,
  };
}

function runsFrom(mine) {
  return Object.entries(mine)
    .filter(([k]) => k.startsWith(RUN))
    .map(([k, run]) => summarize(run, mine[OBS + k.slice(RUN.length)]))
    .sort((a, b) => a.run.startedAt - b.run.startedAt);
}

export async function listRuns() {
  return runsFrom(pickPrefixed(await local().get(null)));
}

// 락 안에서 저장소를 한 번만 읽어 run·관찰·건강 상태가 같은 시점의 것이 되게 한다.
export function exportAll() {
  return withLock(async () => {
    const mine = pickPrefixed(await local().get(null));
    const health = { run: { ...(mine[STATS_KEY.run] ?? {}) }, obs: { ...(mine[STATS_KEY.obs] ?? {}) } };
    for (const ctx of ["run", "obs"]) {
      for (const [f, n] of Object.entries(pending[ctx])) health[ctx][f] = (health[ctx][f] ?? 0) + n;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      extVersion: extVersion(),
      config: mine[CONFIG_KEY] ?? null,
      health,
      runs: runsFrom(mine),
    };
  });
}

export function clearAll() {
  return guarded(
    "obs",
    async () => {
      const keys = Object.keys(pickPrefixed(await local().get(null)));
      if (keys.length) await local().remove(keys);
      await session().remove(ACTIVE_KEY);
      // 삭제한 기록에 속한 메모리 카운트가 곧바로 저장소로 되살아나지 않게 비운다.
      pending.run = {};
      pending.obs = {};
      return { ok: true, removed: keys.length };
    },
    { ok: false, reason: "write_failed" },
  );
}
