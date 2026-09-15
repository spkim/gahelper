import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRecipe, listRecipes, matchRecipes } from '../lib/recipe-store.js';

describe('getRecipe', () => {
  it('generic-setup을 반환한다', () => {
    const r = getRecipe('generic-setup');
    assert.equal(r?.id, 'generic-setup');
    assert.equal(r?.type, 'setup');
  });
  it('adsense-setup을 반환한다', () => {
    const r = getRecipe('adsense-setup');
    assert.equal(r?.id, 'adsense-setup');
    assert.ok(Array.isArray(r?.goals) && r.goals.length > 0);
  });
  it('search-console-setup을 반환한다', () => {
    const r = getRecipe('search-console-setup');
    assert.equal(r?.id, 'search-console-setup');
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
  it('3개의 Recipe를 반환한다', () => {
    assert.equal(listRecipes().length, 3);
  });
  it('generic-setup이 포함된다', () => {
    assert.ok(listRecipes().some((r) => r.id === 'generic-setup'));
  });
  it('adsense-setup이 포함된다', () => {
    assert.ok(listRecipes().some((r) => r.id === 'adsense-setup'));
  });
  it('원본 배열을 변경해도 REGISTRY에 영향 없다', () => {
    const list = listRecipes();
    list.pop();
    assert.equal(listRecipes().length, 3);
  });
});

describe('matchRecipes — host 매칭', () => {
  it('adsense.google.com → adsense-setup', () => {
    const m = matchRecipes({ host: 'adsense.google.com' });
    assert.ok(m.some((r) => r.id === 'adsense-setup'));
  });
  it('search.google.com → search-console-setup', () => {
    const m = matchRecipes({ host: 'search.google.com' });
    assert.ok(m.some((r) => r.id === 'search-console-setup'));
  });
  it('미등록 host → 빈 배열', () => {
    assert.deepEqual(matchRecipes({ host: 'tistory.com' }), []);
  });
  it('generic-setup은 matchRecipes에 포함되지 않는다', () => {
    assert.ok(!matchRecipes({ host: 'adsense.google.com' }).some((r) => r.id === 'generic-setup'));
  });
});

describe('matchRecipes — URL 매칭', () => {
  it('AdSense URL → adsense-setup', () => {
    const m = matchRecipes({ url: 'https://adsense.google.com/adsense/publisher' });
    assert.ok(m.some((r) => r.id === 'adsense-setup'));
  });
  it('Search Console URL → search-console-setup', () => {
    const m = matchRecipes({ url: 'https://search.google.com/search-console/welcome' });
    assert.ok(m.some((r) => r.id === 'search-console-setup'));
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
