import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers/chrome-storage-mock.js";

// ─── chrome.storage.session polyfill ─────────────────────────────────────────
// recipe-engine.js가 import될 때 globalThis.chrome を참조하므로 미리 설치.

const mock = installChromeMock();

// 매 테스트 전 storage와 in-memory Map 초기화.
// recipe-engine 모듈은 최초 import 시 Map이 빈 상태이므로
// clearAll() 로 Map도 함께 리셋한다.
import {
  createRecipeSession, getRecipeSession, clearRecipeSession,
  currentGoal, markGoalDone, markGoalBlocked,
  restoreRecipeSessions,
} from "../lib/recipe-engine.js";

// 내부 Map을 직접 초기화할 방법이 없으므로 clearRecipeSession 으로 정리.
async function clearAll(tabIds) {
  for (const id of tabIds) await clearRecipeSession(id);
  mock.reset();
}

// ─── 왕복 복구 테스트 ─────────────────────────────────────────────────────────

describe("restoreRecipeSessions — 저장·복구 왕복", () => {
  beforeEach(async () => { await clearAll([1, 2]); });

  it("createRecipeSession 후 storage에 persisted", async () => {
    await createRecipeSession(1, "R01");
    const raw = await chrome.storage.session.get("recipe_sessions");
    assert.ok(raw.recipe_sessions?.["1"], "tab 1 persisted");
    assert.equal(raw.recipe_sessions["1"].recipeId, "R01");
  });

  it("복구 후 goalIdx 보존", async () => {
    await createRecipeSession(1, "R04");  // R04는 goals 2개
    await markGoalDone(1);               // goalIdx 0 → 1

    // in-memory Map 비우기 (모듈 재로드 시뮬레이션 — 직접 접근 불가하므로
    // storage를 그대로 두고 clearAll 대신 수동으로 스토리지만 보존)
    await clearRecipeSession(1);                 // in-memory만 지우면 persist가 덮어씀
    // storage를 복원 후 restoreRecipeSessions 재실행
    mock.session.seed({ recipe_sessions: { "1": { tabId: 1, recipeId: "R04", recipeVersion: 1, goalIdx: 1, completedGoalIds: ["step_0"], status: "running" } } });
    await restoreRecipeSessions();

    const s = getRecipeSession(1);
    assert.equal(s?.goalIdx, 1, "goalIdx 1 복구됨");
    assert.deepEqual(s?.completedGoalIds, ["step_0"], "completedGoalIds 복구됨");
  });

  it("clearRecipeSession 후 storage에서도 제거", async () => {
    await createRecipeSession(2, "R01");
    await clearRecipeSession(2);
    const raw = await chrome.storage.session.get("recipe_sessions");
    assert.ok(!raw.recipe_sessions?.["2"], "tab 2 제거됨");
  });

  it("markGoalDone 후 goalIdx storage에 반영", async () => {
    await createRecipeSession(1, "R04");
    await markGoalDone(1);
    const raw = await chrome.storage.session.get("recipe_sessions");
    assert.equal(raw.recipe_sessions["1"].goalIdx, 1);
    assert.deepEqual(raw.recipe_sessions["1"].completedGoalIds, ["step_0"]);
  });

  it("markGoalBlocked 후 status storage에 반영", async () => {
    await createRecipeSession(1, "R01");
    await markGoalBlocked(1);
    const raw = await chrome.storage.session.get("recipe_sessions");
    assert.equal(raw.recipe_sessions["1"].status, "blocked");
  });
});

// ─── storage 비어 있을 때 ──────────────────────────────────────────────────────

describe("restoreRecipeSessions — storage 빈 상태", () => {
  it("storage 가 비어 있으면 크래시 없이 빈 상태로 시작", async () => {
    mock.reset();
    await restoreRecipeSessions();
    assert.equal(getRecipeSession(99), null, "빈 세션");
  });

  it("storage 키가 아예 없어도 크래시 없음", async () => {
    mock.reset();
    await assert.doesNotReject(() => restoreRecipeSessions());
  });
});

// ─── 스키마 불일치 처리 ───────────────────────────────────────────────────────

describe("restoreRecipeSessions — 스키마 불일치", () => {
  beforeEach(async () => { await clearAll([1]); });

  it("status 누락 시 세션 버림", async () => {
    mock.session.seed({ recipe_sessions: { "1": { tabId: 1, recipeId: "R01", goalIdx: 0, completedGoalIds: [] } } });
    await restoreRecipeSessions();
    assert.equal(getRecipeSession(1), null, "status 누락 → 버림");
  });

  it("recipeId 누락 시 세션 버림", async () => {
    mock.session.seed({ recipe_sessions: { "1": { tabId: 1, goalIdx: 0, completedGoalIds: [], status: "running" } } });
    await restoreRecipeSessions();
    assert.equal(getRecipeSession(1), null, "recipeId 누락 → 버림");
  });

  it("status 가 알 수 없는 값이면 세션 버림", async () => {
    mock.session.seed({ recipe_sessions: { "1": { tabId: 1, recipeId: "R01", goalIdx: 0, completedGoalIds: [], status: "unknown_state" } } });
    await restoreRecipeSessions();
    assert.equal(getRecipeSession(1), null, "unknown status → 버림");
  });

  it("completedGoalIds 가 배열이 아니면 버림", async () => {
    mock.session.seed({ recipe_sessions: { "1": { tabId: 1, recipeId: "R01", goalIdx: 0, completedGoalIds: null, status: "running" } } });
    await restoreRecipeSessions();
    assert.equal(getRecipeSession(1), null, "completedGoalIds null → 버림");
  });

  it("유효한 세션은 복구, 깨진 세션은 버림 (혼합)", async () => {
    mock.session.seed({
      recipe_sessions: {
        "1": { tabId: 1, recipeId: "R01", goalIdx: 0, completedGoalIds: [], status: "running" },
        "2": { tabId: 2, broken: true },  // 스키마 불일치
      },
    });
    await restoreRecipeSessions();
    assert.ok(getRecipeSession(1), "유효한 세션 복구됨");
    assert.equal(getRecipeSession(2), null, "깨진 세션 버려짐");
  });
});
