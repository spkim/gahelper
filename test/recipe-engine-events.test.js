import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers/chrome-storage-mock.js";

const mock = installChromeMock();

import {
  createRecipeSession, clearRecipeSession, markGoalDone, markGoalBlocked, skipOptionalGoal,
  pauseForPopup, resumeFromPopup, setRecipeEventListener,
} from "../lib/recipe-engine.js";
import { getRecipe } from "../lib/recipe-store.js";

const TAB = 3001;
let events;

beforeEach(async () => {
  setRecipeEventListener(null);
  await clearRecipeSession(TAB);
  mock.reset();
  events = [];
  setRecipeEventListener((e) => events.push(e));
});

describe("recipe-engine 이벤트", () => {
  it("전이마다 {type, tabId, recipeId, goalIdx, ts} 를 보낸다", async () => {
    await createRecipeSession(TAB, "R04"); // goals 2개
    await markGoalDone(TAB);
    await markGoalDone(TAB);
    await clearRecipeSession(TAB);
    assert.deepEqual(events.map((e) => e.type), ["session_created", "goal_done", "goal_done", "session_cleared"]);
    for (const e of events) {
      assert.equal(e.tabId, TAB);
      assert.equal(e.recipeId, "R04");
      assert.equal(typeof e.ts, "number");
    }
    assert.deepEqual(events.map((e) => e.goalIdx), [0, 0, 1, 2]);
  });

  it("goal_done·session_cleared 에 세션 최종 status 를 싣는다", async () => {
    await createRecipeSession(TAB, "R04");
    await markGoalDone(TAB);
    await markGoalDone(TAB);
    await clearRecipeSession(TAB);
    assert.deepEqual(events.filter((e) => e.type === "goal_done").map((e) => e.status), ["running", "done"]);
    assert.equal(events.at(-1).status, "done");
  });

  it("blocked, paused, resumed 이벤트", async () => {
    await createRecipeSession(TAB, "R04");
    await pauseForPopup(TAB, 55);
    await resumeFromPopup(TAB);
    await resumeFromPopup(TAB); // 이미 running: 이벤트 없음
    await markGoalBlocked(TAB);
    assert.deepEqual(events.map((e) => e.type), ["session_created", "paused", "resumed", "goal_blocked"]);
  });

  it("goal_skipped (선택 goal)", async () => {
    const goal = getRecipe("R04").goals[0];
    goal.optional = true;
    try {
      await createRecipeSession(TAB, "R04");
      await skipOptionalGoal(TAB);
    } finally {
      delete goal.optional;
    }
    const e = events.at(-1);
    assert.equal(e.type, "goal_skipped");
    assert.equal(e.goalIdx, 0);
    assert.equal(e.status, "running");
  });

  it("세션이 없으면 무이벤트, 실패한 호출도 무이벤트", async () => {
    await clearRecipeSession(TAB);
    await assert.rejects(() => markGoalDone(TAB));
    await assert.rejects(() => skipOptionalGoal(TAB));
    assert.deepEqual(events, []);
  });

  it("listener 의 동기 예외·비동기 거부가 러너를 막지 않는다", async () => {
    setRecipeEventListener(() => {
      throw new Error("boom");
    });
    await assert.doesNotReject(createRecipeSession(TAB, "R04"));
    setRecipeEventListener(async () => {
      throw new Error("async boom");
    });
    const r = await markGoalDone(TAB);
    assert.equal(r.status, "running");
    await new Promise((res) => setImmediate(res)); // 처리되지 않은 거부가 없어야 한다
  });

  it("listener 해제 후에는 이벤트가 없다", async () => {
    setRecipeEventListener(null);
    await createRecipeSession(TAB, "R04");
    assert.deepEqual(events, []);
  });
});

describe("엔진 → evallog 연결", () => {
  it("R04 완료 흐름이 completed run 으로 기록된다", async () => {
    const { onRecipeEvent } = await import("../lib/evallog.js");
    setRecipeEventListener(onRecipeEvent);
    await createRecipeSession(TAB, "R04");
    await markGoalDone(TAB);
    await markGoalDone(TAB);
    await clearRecipeSession(TAB);
    const runs = Object.entries(mock.local.dump()).filter(([k]) => k.startsWith("sc.evallog.run.")).map(([, v]) => v);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "completed");
    assert.deepEqual(runs[0].goals.map((g) => g.result), ["done", "done"]);
  });
});
