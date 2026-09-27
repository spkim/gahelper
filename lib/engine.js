// v2 §6 — signature 기반 상태 기계.
import { probe } from "./probe-client.js";

const sessions = new Map();

// ─── 세션 ──────────────────────────────────────────────────────────────────

export function getSession(tabId) {
  return sessions.get(tabId) ?? null;
}

export function clearSession(tabId) {
  sessions.delete(tabId);
}

export function createSession(tabId) {
  const session = {
    tabId,
    goalText: null,
    structuralHash: null,
    signature: null,
    procedure: null,
    stepIdx: 0,
    attempts: 0,
    status: "prompt",
    recoverText: null,
    skipped: [],
  };
  sessions.set(tabId, session);
  return session;
}

export function currentStep(session) {
  return session?.procedure?.steps?.[session.stepIdx] ?? null;
}

// ─── verify 로컬 판정 ───────────────────────────────────────────────────────

function normalizeCompact(s) {
  return String(s ?? "").replace(/\s+/g, "").trim();
}

function normalizeSpace(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

// probe 결과에서 단일 로케이터 키 'v' 를 읽어 verify 조건 판정.
export function verifyLocal(verify, probeResult) {
  if (!verify || !probeResult) return false;

  // urlIncludes 는 probe 결과 url 로만 판정.
  if (verify.is === "urlIncludes") {
    const url = normalizeSpace(probeResult.url ?? "");
    return url.includes(normalizeSpace(verify.text));
  }

  const item = probeResult.found?.v;
  if (!item) return false;

  switch (verify.is) {
    case "found":    return !!item.found;
    case "notFound": return !item.found;
    case "checked":  return !!item.checked;
    case "unchecked":return item.found && !item.checked;
    case "valueIn": {
      if (!item.found) return false;
      const v = normalizeCompact(item.value);
      return (verify.values ?? []).map(normalizeCompact).includes(v);
    }
    case "textPresent":
      return item.found && normalizeSpace(item.text ?? "").includes(normalizeSpace(verify.text));
    default: return false;
  }
}

// verify 를 한 번만 probe 해서 판정.
async function probeVerify(session, verify) {
  if (verify?.is === "urlIncludes") {
    const result = await probe(session.tabId, {});
    return verifyLocal(verify, result);
  }
  if (!verify?.probe) return false;
  const result = await probe(session.tabId, { v: verify.probe });
  return verifyLocal(verify, result);
}

// ─── 단계 진행 ─────────────────────────────────────────────────────────────

function advanceStep(session) {
  const total = session.procedure?.steps?.length ?? 0;
  session.stepIdx += 1;
  session.attempts = 0;
  if (session.stepIdx >= total) {
    session.status = "done";
  }
}

// 현재 단계 verify 를 probe 해서 통과 시 stepIdx 를 올린다.
export async function tickStep(session) {
  if (session.status !== "running") return;
  const step = currentStep(session);
  if (!step?.verify) return;
  const passed = await probeVerify(session, step.verify).catch(() => false);
  if (passed) advanceStep(session);
}

// 세션 시작 시 이미 통과한 앞 단계를 스킵한다 (§6.3).
// 현재 화면의 전체 probe 를 한 번만 보내 판단.
export async function skipAlreadyPassed(session) {
  const steps = session.procedure?.steps ?? [];
  while (session.status === "running" && session.stepIdx < steps.length) {
    const step = steps[session.stepIdx];
    if (!step?.verify) break;
    const passed = await probeVerify(session, step.verify).catch(() => false);
    if (!passed) break;
    advanceStep(session);
  }
}

// ─── 실패 / 막힘 ────────────────────────────────────────────────────────────

export function reportFail(session) {
  session.attempts += 1;
  if (session.attempts >= 2) session.status = "blocked";
}

export function resumeFromBlocked(session) {
  session.status = "running";
  session.attempts = 0;
  session.recoverText = null;
}

// "수동으로 진행" — blocked 상태에서 현재 step을 스킵하고 다음으로 이동.
// 건너뛴 step은 session.skipped 에 기록한다.
export function manualAdvance(session) {
  if (!session.skipped) session.skipped = [];
  const step = currentStep(session);
  if (step) session.skipped.push({ stepIdx: session.stepIdx, instruct: step.instruct });
  advanceStep(session);
}

// ─── 화면 변경 감지 (§6.4) ──────────────────────────────────────────────────

// 실행 중 verify.probe 가 전부 해석 불가하면 절차를 폐기하고 재해석 신호를 반환.
// 반환 true → 호출자는 re-resolve 를 실행.
export async function checkShouldReinterpret(session) {
  if (session.status !== "running") return false;
  const steps = session.procedure?.steps ?? [];
  const remaining = steps.slice(session.stepIdx);
  if (!remaining.length) return false;

  // urlIncludes verify 는 항상 해석 가능이므로 제외.
  const probeableSteps = remaining.filter(
    (s) => s.verify?.probe && s.verify.is !== "urlIncludes",
  );
  if (!probeableSteps.length) return false;

  // 남은 단계의 로케이터를 모두 한 번에 probe.
  const locators = Object.fromEntries(
    probeableSteps.map((s, i) => [`_c${i}`, s.verify.probe]),
  );
  try {
    const result = await probe(session.tabId, locators);
    const allUnresolvable = Object.values(result?.found ?? {}).every((v) => !v.found);
    return allUnresolvable;
  } catch {
    return false;
  }
}

// 재해석 시작 — stepIdx 를 0 으로 돌린다. §6.3 의 스킵이 다시 작동.
export function resetForReinterpret(session, newSignature, newHash) {
  session.stepIdx = 0;
  session.attempts = 0;
  session.recoverText = null;
  session.status = "running";
  if (newSignature !== undefined) session.signature = newSignature;
  if (newHash !== undefined) session.structuralHash = newHash;
}
