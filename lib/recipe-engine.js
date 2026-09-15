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
import { getRecipe } from './recipe-store.js';

const sessions = new Map();

// ─── 세션 ──────────────────────────────────────────────────────────────────

export function createRecipeSession(tabId, recipeId) {
  const recipe = getRecipe(recipeId);
  if (!recipe) throw new Error(`Recipe not found: ${recipeId}`);
  const session = {
    tabId,
    recipeId,
    recipeVersion: recipe.version,
    goalIdx: 0,
    completedGoalIds: [],
    status: 'running',
  };
  sessions.set(tabId, session);
  return session;
}

export function getRecipeSession(tabId) {
  return sessions.get(tabId) ?? null;
}

export function clearRecipeSession(tabId) {
  sessions.delete(tabId);
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
export function markGoalDone(tabId) {
  const session = requireSession(tabId);
  const recipe = requireRecipe(session.recipeId);

  const goal = recipe.goals[session.goalIdx];
  if (goal) session.completedGoalIds.push(goal.id);
  session.goalIdx += 1;

  if (session.goalIdx >= recipe.goals.length) {
    session.status = 'done';
    return { status: 'done', nextGoal: null };
  }
  return { status: 'running', nextGoal: recipe.goals[session.goalIdx] };
}

// 현재 goal 에서 막힘 — RecipeSession 전체가 blocked 상태가 된다.
export function markGoalBlocked(tabId) {
  requireSession(tabId).status = 'blocked';
}

// optional goal 건너뜀 → 다음 goal 진행.
// 반환: { status: 'running'|'done', nextGoal: RecipeGoal|null }
export function skipOptionalGoal(tabId) {
  const session = requireSession(tabId);
  const recipe = requireRecipe(session.recipeId);

  const goal = recipe.goals[session.goalIdx];
  if (!goal?.optional) throw new Error(`Goal "${goal?.id}" is not optional`);

  session.goalIdx += 1;

  if (session.goalIdx >= recipe.goals.length) {
    session.status = 'done';
    return { status: 'done', nextGoal: null };
  }
  return { status: 'running', nextGoal: recipe.goals[session.goalIdx] };
}

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────

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
