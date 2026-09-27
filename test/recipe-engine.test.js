import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── chrome.storage.session polyfill ──────────────────────────────────────────
// recipe-engine.js 의 persist() 가 chrome.storage.session 을 사용하므로 먼저 설치.
let _store = {};

if (!globalThis.chrome) {
  globalThis.chrome = {
    storage: {
      session: {
        get: async (key) => {
          const val = _store[key];
          return val !== undefined ? { [key]: JSON.parse(JSON.stringify(val)) } : {};
        },
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) _store[k] = v;
        },
      },
      local: { get: async () => ({}), set: async () => {} },
    },
  };
}

import {
  createRecipeSession, getRecipeSession, clearRecipeSession,
  currentGoal, markGoalDone, markGoalBlocked, skipOptionalGoal,
} from '../lib/recipe-engine.js';

// R04 — goals 2개 (step_0, step_1), 모두 필수
// R01 — goal 1개 (step_0), 필수
const TAB = 2001;

async function fresh(recipeId = 'R04') {
  await clearRecipeSession(TAB);
  _store = {};
  return createRecipeSession(TAB, recipeId);
}

beforeEach(async () => {
  await clearRecipeSession(TAB);
  _store = {};
});

// ─── createRecipeSession ───────────────────────────────────────────────────

describe('createRecipeSession', () => {
  it('세션을 생성하고 초기 상태를 설정한다', async () => {
    const s = await fresh();
    assert.equal(s.tabId, TAB);
    assert.equal(s.recipeId, 'R04');
    assert.equal(s.goalIdx, 0);
    assert.equal(s.status, 'running');
    assert.deepEqual(s.completedGoalIds, []);
  });

  it('getRecipeSession 으로 조회된다', async () => {
    await fresh();
    const s = getRecipeSession(TAB);
    assert.equal(s?.recipeId, 'R04');
  });

  it('존재하지 않는 recipeId → throw', async () => {
    await assert.rejects(
      () => createRecipeSession(TAB, 'nonexistent-recipe'),
      /not found/i,
    );
  });

  it('version 이 Recipe 와 일치한다', async () => {
    const s = await fresh();
    assert.equal(s.recipeVersion, 1);
  });
});

// ─── currentGoal ──────────────────────────────────────────────────────────

describe('currentGoal — 첫 goal 시작', () => {
  it('첫 번째 goal 을 반환한다', async () => {
    await fresh();
    assert.equal(currentGoal(TAB)?.id, 'step_0');
  });

  it('세션 없으면 null', async () => {
    await clearRecipeSession(TAB);
    assert.equal(currentGoal(TAB), null);
  });

  it('blocked 상태이면 null', async () => {
    await fresh();
    await markGoalBlocked(TAB);
    assert.equal(currentGoal(TAB), null);
  });

  it('done 상태이면 null', async () => {
    await fresh();                 // R04: 2 goals
    await markGoalDone(TAB);      // step_0 → step_1
    await markGoalDone(TAB);      // step_1 → done
    assert.equal(currentGoal(TAB), null);
  });
});

// ─── markGoalDone ─────────────────────────────────────────────────────────

describe('markGoalDone — goal 성공 → 다음 goal', () => {
  it('첫 goal 완료 → 두 번째 goal 로 이동', async () => {
    await fresh();
    const result = await markGoalDone(TAB);
    assert.equal(result.status, 'running');
    assert.equal(result.nextGoal?.id, 'step_1');
    assert.equal(currentGoal(TAB)?.id, 'step_1');
  });

  it('완료된 goal id 가 completedGoalIds 에 기록된다', async () => {
    await fresh();
    await markGoalDone(TAB);
    assert.deepEqual(getRecipeSession(TAB)?.completedGoalIds, ['step_0']);
  });
});

describe('markGoalDone — 마지막 goal 성공 → recipe done', () => {
  it('마지막 goal 완료 → status: done', async () => {
    await fresh();
    await markGoalDone(TAB);      // step_0 완료
    const result = await markGoalDone(TAB); // step_1 완료 (마지막)
    assert.equal(result.status, 'done');
    assert.equal(result.nextGoal, null);
    assert.equal(getRecipeSession(TAB)?.status, 'done');
  });

  it('완료 시 모든 goal id 가 기록된다', async () => {
    await fresh();
    await markGoalDone(TAB);
    await markGoalDone(TAB);
    assert.deepEqual(getRecipeSession(TAB)?.completedGoalIds, ['step_0', 'step_1']);
  });

  it('세션 없으면 throw', async () => {
    await clearRecipeSession(TAB);
    await assert.rejects(() => markGoalDone(TAB), /No recipe session/);
  });
});

// ─── markGoalBlocked ──────────────────────────────────────────────────────

describe('markGoalBlocked — blocked → recipe blocked', () => {
  it('status 를 blocked 로 변경한다', async () => {
    await fresh();
    await markGoalBlocked(TAB);
    assert.equal(getRecipeSession(TAB)?.status, 'blocked');
  });

  it('goalIdx 는 변경되지 않는다', async () => {
    await fresh();
    await markGoalDone(TAB);      // idx → 1
    await markGoalBlocked(TAB);
    assert.equal(getRecipeSession(TAB)?.goalIdx, 1);
  });

  it('세션 없으면 throw', async () => {
    await clearRecipeSession(TAB);
    await assert.rejects(() => markGoalBlocked(TAB), /No recipe session/);
  });
});

// ─── skipOptionalGoal ─────────────────────────────────────────────────────

describe('skipOptionalGoal — non-optional goal skip 시도', () => {
  it('non-optional goal skip 시도 → throw', async () => {
    await fresh(); // step_0 는 optional 아님
    await assert.rejects(() => skipOptionalGoal(TAB), /not optional/);
  });
});

// ─── completed goal 복구 ──────────────────────────────────────────────────

describe('completed goal 복구', () => {
  it('goalIdx 와 completedGoalIds 로 이전 진행 상태를 파악할 수 있다', async () => {
    await fresh();
    await markGoalDone(TAB); // step_0
    assert.equal(currentGoal(TAB)?.id, 'step_1');
    assert.equal(getRecipeSession(TAB)?.goalIdx, 1);
    assert.deepEqual(getRecipeSession(TAB)?.completedGoalIds, ['step_0']);
  });
});

// ─── clearRecipeSession ───────────────────────────────────────────────────

describe('clearRecipeSession', () => {
  it('세션을 삭제한다', async () => {
    await fresh();
    await clearRecipeSession(TAB);
    assert.equal(getRecipeSession(TAB), null);
  });

  it('존재하지 않는 세션 삭제도 오류 없음', async () => {
    await assert.doesNotReject(() => clearRecipeSession(99999));
  });
});
