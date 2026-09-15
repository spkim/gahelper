import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeSession, getRecipeSession, clearRecipeSession,
  currentGoal, markGoalDone, markGoalBlocked, skipOptionalGoal,
} from '../lib/recipe-engine.js';

// adsense-setup goals (순서대로):
//   0: register-site
//   1: verify-site
//   2: check-ads-txt  (optional)
//   3: review-readiness
//
// search-console-setup goals:
//   0: add-property
//   1: verify-ownership
//   2: check-coverage  (optional, 마지막)

const TAB = 2001;

function fresh(recipeId = 'adsense-setup') {
  clearRecipeSession(TAB);
  return createRecipeSession(TAB, recipeId);
}

// ─── createRecipeSession ───────────────────────────────────────────────────

describe('createRecipeSession', () => {
  it('세션을 생성하고 초기 상태를 설정한다', () => {
    const s = fresh();
    assert.equal(s.tabId, TAB);
    assert.equal(s.recipeId, 'adsense-setup');
    assert.equal(s.goalIdx, 0);
    assert.equal(s.status, 'running');
    assert.deepEqual(s.completedGoalIds, []);
  });

  it('getRecipeSession 으로 조회된다', () => {
    fresh();
    const s = getRecipeSession(TAB);
    assert.equal(s?.recipeId, 'adsense-setup');
  });

  it('존재하지 않는 recipeId → throw', () => {
    assert.throws(() => createRecipeSession(TAB, 'nonexistent-recipe'), /not found/i);
  });

  it('version 이 Recipe 와 일치한다', () => {
    const s = fresh();
    assert.equal(s.recipeVersion, 1);
  });
});

// ─── currentGoal ──────────────────────────────────────────────────────────

describe('currentGoal — 첫 goal 시작', () => {
  it('첫 번째 goal 을 반환한다', () => {
    fresh();
    assert.equal(currentGoal(TAB)?.id, 'register-site');
  });

  it('세션 없으면 null', () => {
    clearRecipeSession(TAB);
    assert.equal(currentGoal(TAB), null);
  });

  it('blocked 상태이면 null', () => {
    fresh();
    markGoalBlocked(TAB);
    assert.equal(currentGoal(TAB), null);
  });

  it('done 상태이면 null', () => {
    fresh();
    markGoalDone(TAB); markGoalDone(TAB); markGoalDone(TAB); markGoalDone(TAB);
    assert.equal(currentGoal(TAB), null);
  });
});

// ─── markGoalDone ─────────────────────────────────────────────────────────

describe('markGoalDone — goal 성공 → 다음 goal', () => {
  it('첫 goal 완료 → 두 번째 goal 로 이동', () => {
    fresh();
    const result = markGoalDone(TAB);
    assert.equal(result.status, 'running');
    assert.equal(result.nextGoal?.id, 'verify-site');
    assert.equal(currentGoal(TAB)?.id, 'verify-site');
  });

  it('완료된 goal id 가 completedGoalIds 에 기록된다', () => {
    fresh();
    markGoalDone(TAB);
    assert.deepEqual(getRecipeSession(TAB)?.completedGoalIds, ['register-site']);
  });

  it('두 번째 goal 완료 → 세 번째(optional) goal', () => {
    fresh();
    markGoalDone(TAB);
    const result = markGoalDone(TAB);
    assert.equal(result.nextGoal?.id, 'check-ads-txt');
    assert.equal(result.nextGoal?.optional, true);
  });
});

describe('markGoalDone — 마지막 goal 성공 → recipe done', () => {
  it('마지막 goal 완료 → status: done', () => {
    fresh();
    markGoalDone(TAB); // register-site
    markGoalDone(TAB); // verify-site
    markGoalDone(TAB); // check-ads-txt
    const result = markGoalDone(TAB); // review-readiness (마지막)
    assert.equal(result.status, 'done');
    assert.equal(result.nextGoal, null);
    assert.equal(getRecipeSession(TAB)?.status, 'done');
  });

  it('완료 시 모든 goal id 가 기록된다', () => {
    fresh();
    markGoalDone(TAB); markGoalDone(TAB); markGoalDone(TAB); markGoalDone(TAB);
    assert.deepEqual(getRecipeSession(TAB)?.completedGoalIds, [
      'register-site', 'verify-site', 'check-ads-txt', 'review-readiness',
    ]);
  });

  it('세션 없으면 throw', () => {
    clearRecipeSession(TAB);
    assert.throws(() => markGoalDone(TAB), /No recipe session/);
  });
});

// ─── markGoalBlocked ──────────────────────────────────────────────────────

describe('markGoalBlocked — blocked → recipe blocked', () => {
  it('status 를 blocked 로 변경한다', () => {
    fresh();
    markGoalBlocked(TAB);
    assert.equal(getRecipeSession(TAB)?.status, 'blocked');
  });

  it('goalIdx 는 변경되지 않는다', () => {
    fresh();
    markGoalDone(TAB); // idx → 1
    markGoalBlocked(TAB);
    assert.equal(getRecipeSession(TAB)?.goalIdx, 1);
  });

  it('세션 없으면 throw', () => {
    clearRecipeSession(TAB);
    assert.throws(() => markGoalBlocked(TAB), /No recipe session/);
  });
});

// ─── skipOptionalGoal ─────────────────────────────────────────────────────

describe('skipOptionalGoal — optional goal skip', () => {
  it('optional goal 을 건너뛰고 다음 goal 로 진행한다', () => {
    fresh();
    markGoalDone(TAB); // register-site
    markGoalDone(TAB); // verify-site → 현재 check-ads-txt (optional)
    const result = skipOptionalGoal(TAB);
    assert.equal(result.status, 'running');
    assert.equal(result.nextGoal?.id, 'review-readiness');
    assert.equal(currentGoal(TAB)?.id, 'review-readiness');
  });

  it('건너뛴 goal 은 completedGoalIds 에 포함되지 않는다', () => {
    fresh();
    markGoalDone(TAB); markGoalDone(TAB); // register-site, verify-site 완료
    skipOptionalGoal(TAB); // check-ads-txt skip
    assert.ok(!getRecipeSession(TAB)?.completedGoalIds.includes('check-ads-txt'));
  });

  it('non-optional goal skip 시도 → throw', () => {
    fresh(); // register-site 는 optional 아님
    assert.throws(() => skipOptionalGoal(TAB), /not optional/);
  });

  it('마지막 goal 이 optional 이고 skip 하면 done', () => {
    fresh('search-console-setup');
    // goals: add-property, verify-ownership, check-coverage(optional, 마지막)
    markGoalDone(TAB); // add-property
    markGoalDone(TAB); // verify-ownership → 현재 check-coverage
    const result = skipOptionalGoal(TAB);
    assert.equal(result.status, 'done');
    assert.equal(result.nextGoal, null);
  });
});

// ─── completed goal 복구 ──────────────────────────────────────────────────

describe('completed goal 복구', () => {
  it('goalIdx 와 completedGoalIds 로 이전 진행 상태를 파악할 수 있다', () => {
    fresh();
    markGoalDone(TAB); // register-site
    markGoalDone(TAB); // verify-site
    // 현재 위치: check-ads-txt (index 2)
    assert.equal(currentGoal(TAB)?.id, 'check-ads-txt');
    assert.equal(getRecipeSession(TAB)?.goalIdx, 2);
    assert.deepEqual(getRecipeSession(TAB)?.completedGoalIds, [
      'register-site', 'verify-site',
    ]);
  });
});

// ─── clearRecipeSession ───────────────────────────────────────────────────

describe('clearRecipeSession', () => {
  it('세션을 삭제한다', () => {
    fresh();
    clearRecipeSession(TAB);
    assert.equal(getRecipeSession(TAB), null);
  });

  it('존재하지 않는 세션 삭제도 오류 없음', () => {
    assert.doesNotThrow(() => clearRecipeSession(99999));
  });
});
