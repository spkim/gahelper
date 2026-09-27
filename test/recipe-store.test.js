import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRecipe, listRecipes, matchRecipes } from '../lib/recipe-store.js';

describe('getRecipe', () => {
  it('generic-setup을 반환한다', () => {
    const r = getRecipe('generic-setup');
    assert.equal(r?.id, 'generic-setup');
    assert.equal(r?.type, 'setup');
  });
  it('R01을 반환한다', () => {
    const r = getRecipe('R01');
    assert.equal(r?.id, 'R01');
    assert.ok(Array.isArray(r?.goals) && r.goals.length > 0);
  });
  it('R04를 반환한다', () => {
    const r = getRecipe('R04');
    assert.equal(r?.id, 'R04');
    assert.ok(Array.isArray(r?.goals) && r.goals.length > 0);
  });
  it('존재하지 않는 id는 null', () => {
    assert.equal(getRecipe('nonexistent'), null);
  });
  it('빈 문자열은 null', () => {
    assert.equal(getRecipe(''), null);
  });
});

describe('listRecipes', () => {
  it('R01–R10 + generic-setup = 11개를 반환한다', () => {
    assert.equal(listRecipes().length, 11);
  });
  it('generic-setup이 포함된다', () => {
    assert.ok(listRecipes().some((r) => r.id === 'generic-setup'));
  });
  it('R01이 포함된다', () => {
    assert.ok(listRecipes().some((r) => r.id === 'R01'));
  });
  it('원본 배열을 변경해도 REGISTRY에 영향 없다', () => {
    const list = listRecipes();
    list.pop();
    assert.equal(listRecipes().length, 11);
  });
});

describe('matchRecipes — host 매칭', () => {
  it('chatgpt.com → R01', () => {
    const m = matchRecipes({ host: 'chatgpt.com' });
    assert.ok(m.some((r) => r.id === 'R01'));
  });
  it('mail.google.com → R04', () => {
    const m = matchRecipes({ host: 'mail.google.com' });
    assert.ok(m.some((r) => r.id === 'R04'));
  });
  it('미등록 host → 빈 배열', () => {
    assert.deepEqual(matchRecipes({ host: 'tistory.com' }), []);
  });
  it('generic-setup은 matchRecipes에 포함되지 않는다', () => {
    assert.ok(!matchRecipes({ host: 'chatgpt.com' }).some((r) => r.id === 'generic-setup'));
  });
});

describe('matchRecipes — URL 매칭', () => {
  it('ChatGPT URL → R01', () => {
    const m = matchRecipes({ url: 'https://chatgpt.com/settings' });
    assert.ok(m.some((r) => r.id === 'R01'));
  });
  it('Gmail URL → R04', () => {
    const m = matchRecipes({ url: 'https://mail.google.com/mail/u/0/#settings' });
    assert.ok(m.some((r) => r.id === 'R04'));
  });
  it('인자 없으면 빈 배열', () => {
    assert.deepEqual(matchRecipes(), []);
  });
});

describe('Recipe 유효성', () => {
  it('모든 Recipe에 id, version, type, goals가 있다', () => {
    for (const r of listRecipes()) {
      assert.ok(r.id, `${r.id}: id missing`);
      assert.equal(typeof r.version, 'number', `${r.id}: version`);
      assert.equal(r.type, 'setup', `${r.id}: type`);
      assert.ok(Array.isArray(r.goals), `${r.id}: goals`);
    }
  });
  it('goals가 있는 Recipe는 각 goal에 id와 label이 있다', () => {
    for (const r of listRecipes()) {
      for (const g of r.goals) {
        assert.ok(g.id, `${r.id}/${g.id}: goal id missing`);
        assert.ok(g.label, `${r.id}/${g.id}: goal label missing`);
      }
    }
  });
});
