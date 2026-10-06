// eval-report 용 가짜 20회 내보내기. 기본값은 "B 진행" 조건을 모두 만족한다.
import { PLAN } from "../../scripts/eval-report.js";

const AUDIT_CLEAN = { instruct: false, goalLabel: false, recoverText: false, badge: false, onFail: false };

function goal(index, result = "done", extra = {}) {
  return { index, result, screens: 1, resolverMs: [1500], attempts: 1, guardRejects: [], procedureKind: "action", blockedCause: null, skippedSteps: 0, ...extra };
}

export function makeRow(slot, i, over = {}) {
  const evalRound = over.evalRound ?? 1;
  const runId = `r${evalRound}-${i}`;
  const status = over.status ?? "completed";
  const run = {
    runId, schemaVersion: 1, extVersion: "0.0.0-test", tester: slot.tester, participantId: slot.participantId,
    evalRound, recipeId: slot.recipeId, goalCount: over.goalCount ?? 2, tabId: i, status, startedAt: over.startedAt ?? 1000 + i, endedAt: 2000 + i, endCause: null,
    currentGoalIdx: 2, goals: over.goals ?? [goal(0), goal(1)], popupPauses: 0, skippedSteps: 0, lastSeq: 3, events: [],
    userConfirmedReal: true,
  };
  const nondev = slot.tester === "nondev";
  const obs = over.obs === null ? null : {
    runId, revision: 1, observerVerified: true, audit: { ...AUDIT_CLEAN },
    secretSentToLlm: ["R06", "R08"].includes(slot.recipeId) ? false : null,
    oauthResumeOk: ["R07", "R09"].includes(slot.recipeId) ? true : null,
    payloadSentToLlm: slot.recipeId === "R10" ? false : null,
    ...(nondev ? { q1: 2, q2: { choice: "keep", reasonCode: "learn", quote: "" }, q3: true } : {}),
    ...over.obs,
  };
  return { runId, run, obs, effectiveStatus: obs?.finalOutcome ?? status, postFinalizeEvents: 0 };
}

// overrides: (slot, index) => over | undefined
export function buildExport(overrides = () => undefined, evalRound = 1) {
  const runs = PLAN.map((slot, i) => makeRow(slot, i, { evalRound, ...(overrides(slot, i) ?? {}) }));
  return { schemaVersion: 1, exportedAt: 1, extVersion: "0.0.0-test", config: null, health: { run: {}, obs: {} }, runs };
}

export { goal };
