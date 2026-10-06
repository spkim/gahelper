// v3 §9 — Recipe goal lifecycle 관리.
// Guidance Engine(engine.js)과 직접 의존 없음.
// panel.js 오케스트레이터가 두 엔진을 조율한다:
//
//   goal = recipeEngine.currentGoal(tabId)              ← 현재 Recipe goal (WHAT)
//   await guidanceEngine flow(tabId, goal.label, ...)   ← 현재 화면 안내 (HOW)
//   recipeEngine.markGoalDone(tabId)                    ← 다음 goal 진행
//   recipeEngine.markGoalBlocked(tabId)                 ← 막힘 처리
//
// recipe-engine 은 probe, signature, guidance-engine 을 import 하지 않는다.
// chrome.storage.session write-through: 패널 재열기 / 워커 재시작 시 세션 복구.
import { getRecipe } from './recipe-store.js';

const sessions = new Map();
const STORAGE_KEY = "recipe_sessions";

// ─── 이벤트 리스너 ────────────────────────────────────────────────────────────
// 전이마다 {type, tabId, recipeId, goalIdx, ts}를 한 곳(listener)으로 보낸다. 새 import 없음.
// goal_done·goal_skipped·session_cleared 에는 세션 최종 `status` 를 더한다.
// listener 의 동기 예외·비동기 거부는 삼킨다(러너는 계속된다). 세션이 없으면 이벤트도 없다.
let listener = null;

export function setRecipeEventListener(fn) {
  listener = typeof fn === 'function' ? fn : null;
}

function emit(type, session, goalIdx, extra) {
  if (!listener || !session) return;
  const evt = { type, tabId: session.tabId, recipeId: session.recipeId, goalIdx, ts: Date.now(), ...extra };
  try {
    Promise.resolve(listener(evt)).catch(() => {});
  } catch {
    // listener 예외 격리
  }
}

// ─── storage 헬퍼 ─────────────────────────────────────────────────────────────

function isValidSession(s) {
  return (
    s && typeof s === 'object' &&
    typeof s.tabId === 'number' &&
    typeof s.recipeId === 'string' &&
    typeof s.goalIdx === 'number' &&
    ['running', 'done', 'blocked', 'paused'].includes(s.status) &&
    Array.isArray(s.completedGoalIds) &&
    (s.popupTabId == null || typeof s.popupTabId === 'number')
  );
}

// 패널 init() 시 chrome.storage.session 에서 in-memory Map 복구.
// 스키마 불일치 항목은 버리고 로그만 남긴다.
export async function restoreRecipeSessions() {
  try {
    const data = await chrome.storage.session.get(STORAGE_KEY);
    const stored = data[STORAGE_KEY] ?? {};
    for (const [tabId, session] of Object.entries(stored)) {
      if (!isValidSession(session)) {
        console.warn("[setup-copilot] recipe session 복구 실패 — 스키마 불일치, 버림:", tabId);
        continue;
      }
      sessions.set(Number(tabId), session);
    }
  } catch (err) {
    console.warn("[setup-copilot] recipe session restore 실패:", err?.message);
  }
}

// 상태 변경 후 storage.session 에 동기화. await 해서 완료 후 UI를 갱신해야 한다.
async function persist() {
  const obj = {};
  for (const [k, v] of sessions) obj[k] = v;
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: obj });
  } catch (err) {
    console.warn("[setup-copilot] recipe session persist 실패:", err?.message);
  }
}

// ─── 세션 ──────────────────────────────────────────────────────────────────

export async function createRecipeSession(tabId, recipeId) {
  const recipe = getRecipe(recipeId);
  if (!recipe) throw new Error(`Recipe not found: ${recipeId}`);
  const session = {
    tabId,
    recipeId,
    recipeVersion: recipe.version,
    goalIdx: 0,
    completedGoalIds: [],
    status: 'running',
    popupTabId: null,
  };
  sessions.set(tabId, session);
  await persist();
  emit('session_created', session, 0, { goalCount: recipe.goals.length });
  return session;
}

export function getRecipeSession(tabId) {
  return sessions.get(tabId) ?? null;
}

export async function clearRecipeSession(tabId) {
  const session = sessions.get(tabId);
  sessions.delete(tabId);
  await persist();
  emit('session_cleared', session, session?.goalIdx ?? 0, { status: session?.status });
}

// ─── Goal 조회 ─────────────────────────────────────────────────────────────

// 현재 실행해야 할 RecipeGoal. 완료·blocked 상태이거나 goals 가 없으면 null.
export function currentGoal(tabId) {
  const session = sessions.get(tabId);
  if (!session || session.status !== 'running') return null;
  return getRecipe(session.recipeId)?.goals[session.goalIdx] ?? null;
}

// ─── Goal lifecycle ────────────────────────────────────────────────────────

// 현재 goal 완료 → 다음 goal 진행.
// 반환: { status: 'running'|'done', nextGoal: RecipeGoal|null }
export async function markGoalDone(tabId) {
  const session = requireSession(tabId);
  const recipe = requireRecipe(session.recipeId);

  const goal = recipe.goals[session.goalIdx];
  const doneIdx = session.goalIdx;
  if (goal) session.completedGoalIds.push(goal.id);
  session.goalIdx += 1;

  if (session.goalIdx >= recipe.goals.length) {
    session.status = 'done';
    await persist();
    emit('goal_done', session, doneIdx, { status: 'done' });
    return { status: 'done', nextGoal: null };
  }
  await persist();
  emit('goal_done', session, doneIdx, { status: session.status });
  return { status: 'running', nextGoal: recipe.goals[session.goalIdx] };
}

// 현재 goal 에서 막힘 — RecipeSession 전체가 blocked 상태가 된다.
export async function markGoalBlocked(tabId) {
  const session = requireSession(tabId);
  session.status = 'blocked';
  await persist();
  emit('goal_blocked', session, session.goalIdx);
}

// optional goal 건너뜀 → 다음 goal 진행.
// 반환: { status: 'running'|'done', nextGoal: RecipeGoal|null }
export async function skipOptionalGoal(tabId) {
  const session = requireSession(tabId);
  const recipe = requireRecipe(session.recipeId);

  const goal = recipe.goals[session.goalIdx];
  if (!goal?.optional) throw new Error(`Goal "${goal?.id}" is not optional`);

  const skippedIdx = session.goalIdx;
  session.goalIdx += 1;

  if (session.goalIdx >= recipe.goals.length) {
    session.status = 'done';
    await persist();
    emit('goal_skipped', session, skippedIdx, { status: 'done' });
    return { status: 'done', nextGoal: null };
  }
  await persist();
  emit('goal_skipped', session, skippedIdx, { status: session.status });
  return { status: 'running', nextGoal: recipe.goals[session.goalIdx] };
}

// ─── 팝업 일시정지 ────────────────────────────────────────────────────────────

// 팝업/새 탭이 열렸을 때 세션을 paused 상태로 전환.
export async function pauseForPopup(tabId, popupTabId) {
  const session = requireSession(tabId);
  session.status = 'paused';
  session.popupTabId = popupTabId;
  await persist();
  emit('paused', session, session.goalIdx);
}

// 팝업이 닫히거나 사용자가 수동으로 재개할 때 호출.
// 반환: 실제로 재개됐으면 true, 이미 paused 가 아니면 false (동시 호출 방어).
// status 변경이 await 이전에 동기적으로 완료되므로 두 번째 호출은 반드시 false.
export async function resumeFromPopup(tabId) {
  const session = sessions.get(tabId);
  if (!session || session.status !== 'paused') return false;
  session.status = 'running';
  session.popupTabId = null;
  await persist();
  emit('resumed', session, session.goalIdx);
  return true;
}

// 어느 세션이 popupTabId 를 기다리고 있는지 역방향 조회.
// 팝업 탭이 닫힐 때 원래 탭 id 를 찾기 위해 사용.
export function getSessionForPopup(popupTabId) {
  for (const [tabId, session] of sessions) {
    if (session.popupTabId === popupTabId) return { tabId, session };
  }
  return null;
}

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────────

function requireSession(tabId) {
  const s = sessions.get(tabId);
  if (!s) throw new Error(`No recipe session for tab ${tabId}`);
  return s;
}

function requireRecipe(recipeId) {
  const r = getRecipe(recipeId);
  if (!r) throw new Error(`Recipe not found: ${recipeId}`);
  return r;
}
