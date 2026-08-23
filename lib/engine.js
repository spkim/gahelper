import { findGoal, getProcedure } from "./catalog.js";
import { probe } from "./probe-client.js";

const sessions = new Map();

function normalize(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCompact(s) {
  return String(s ?? "").replace(/\s+/g, "").trim();
}

export function getSession(tabId) {
  return sessions.get(tabId) ?? null;
}

export function clearSession(tabId) {
  sessions.delete(tabId);
}

export function startSession(tabId, pack, goalId) {
  const goal = findGoal(pack, goalId);
  if (!goal) throw new Error(`goal not found: ${goalId}`);
  const session = {
    tabId,
    packId: pack.id,
    goalId,
    procIdx: 0,
    stepIdx: 0,
    attempts: 0,
    status: "running",
    completedProcs: [],
  };
  sessions.set(tabId, session);
  return session;
}

export function currentProcedure(pack, session) {
  const goal = findGoal(pack, session.goalId);
  if (!goal) return { goal: null, procId: null, proc: null };
  const procId = goal.procedures[session.procIdx];
  return { goal, procId, proc: getProcedure(pack, procId) };
}

export function currentStep(pack, session) {
  const { proc } = currentProcedure(pack, session);
  return proc?.steps?.[session.stepIdx] ?? null;
}

export function verifyLocal(verify, probeResult) {
  if (!verify || !probeResult) return false;
  if (verify.is === "urlIncludes") {
    return normalize(probeResult.url ?? "").includes(normalize(verify.text));
  }
  const item = probeResult.found?.[verify.probe];
  if (!item) return false;
  switch (verify.is) {
    case "found":
      return !!item.found;
    case "notFound":
      return !item.found;
    case "checked":
      return !!item.checked;
    case "unchecked":
      return item.found && !item.checked;
    case "valueIn": {
      if (!item.found) return false;
      const v = normalizeCompact(item.value);
      return (verify.values ?? []).map(normalizeCompact).includes(v);
    }
    case "textPresent":
      return item.found && normalize(item.text ?? "").includes(normalize(verify.text));
    default:
      return false;
  }
}

function locatorsForStep(step, proc) {
  if (!step?.verify || step.verify.is === "urlIncludes") return {};
  const key = step.verify.probe;
  const locator = proc.probes?.[key];
  return locator ? { [key]: locator } : {};
}

function locatorsForAllSteps(proc) {
  const locators = {};
  for (const step of proc.steps) {
    if (step.verify.is === "urlIncludes") continue;
    const key = step.verify.probe;
    const locator = proc.probes?.[key];
    if (locator) locators[key] = locator;
  }
  return locators;
}

function advanceOnPass(pack, session) {
  const { proc, goal } = currentProcedure(pack, session);
  if (!proc || !goal) return;
  session.stepIdx += 1;
  session.attempts = 0;
  if (session.stepIdx >= proc.steps.length) {
    if (!session.completedProcs.includes(session.procIdx)) {
      session.completedProcs.push(session.procIdx);
    }
    session.procIdx += 1;
    session.stepIdx = 0;
    if (session.procIdx >= goal.procedures.length) {
      session.status = "done";
    }
  }
}

export async function tickStep(pack, session) {
  if (session.status !== "running") return session;
  const step = currentStep(pack, session);
  if (!step) return session;
  const { proc } = currentProcedure(pack, session);
  const result = await probe(session.tabId, locatorsForStep(step, proc));
  if (verifyLocal(step.verify, result)) {
    advanceOnPass(pack, session);
  }
  return session;
}

export async function skipAlreadyPassed(pack, session) {
  while (session.status === "running") {
    const { proc } = currentProcedure(pack, session);
    if (!proc) break;
    const result = await probe(session.tabId, locatorsForAllSteps(proc));
    const startProcIdx = session.procIdx;
    let advanced = false;
    while (
      session.status === "running" &&
      session.procIdx === startProcIdx &&
      session.stepIdx < proc.steps.length
    ) {
      const step = proc.steps[session.stepIdx];
      if (!verifyLocal(step.verify, result)) break;
      advanceOnPass(pack, session);
      advanced = true;
    }
    if (!advanced) break;
  }
  return session;
}

export async function checkEntryReady(pack, tabId) {
  const ready = pack.entry?.ready;
  if (!ready) return true;
  const result = await probe(tabId, { __entry: ready });
  if (ready.by === "urlIncludes") {
    return !!result?.found?.__entry?.found;
  }
  return !!result?.found?.__entry?.found;
}

export function reportFail(session) {
  session.attempts += 1;
  if (session.attempts >= 2) session.status = "blocked";
  return session;
}

export function resumeFromBlocked(session) {
  session.status = "running";
  session.attempts = 0;
  return session;
}

export function restartSession(session) {
  session.procIdx = 0;
  session.stepIdx = 0;
  session.attempts = 0;
  session.status = "running";
  session.completedProcs = [];
  return session;
}

export function setEntryStatus(session) {
  if (session.status !== "entry") session.status = "entry";
  return session;
}

export function setRunningStatus(session) {
  if (session.status === "entry") {
    session.status = "running";
    session.attempts = 0;
  }
  return session;
}
