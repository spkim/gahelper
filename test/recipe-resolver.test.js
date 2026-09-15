import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipe } from '../lib/recipe-resolver.js';

describe('resolveRecipe — explicit 선택', () => {
  it('명시적 recipeId를 최우선으로 선택한다', () => {
    const r = resolveRecipe({ explicitRecipeId: 'adsense-setup', url: 'https://naver.com' });
    assert.equal(r.recipeId, 'adsense-setup');
    assert.equal(r.source, 'explicit');
  });
  it('존재하지 않는 explicitRecipeId는 다음 우선순위로 넘긴다', () => {
    const r = resolveRecipe({ explicitRecipeId: 'nonexistent-recipe' });
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });
});

describe('resolveRecipe — launch intent', () => {
  it('launchIntent.recipeId로 선택한다', () => {
    const r = resolveRecipe({ launchIntent: { recipeId: 'search-console-setup' } });
    assert.equal(r.recipeId, 'search-console-setup');
    assert.equal(r.source, 'launch-intent');
  });
  it('존재하지 않는 launchIntent → 다음 우선순위', () => {
    const r = resolveRecipe({ launchIntent: { recipeId: 'nonexistent' } });
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });
  it('explicit이 launchIntent보다 우선한다', () => {
    const r = resolveRecipe({
      explicitRecipeId: 'adsense-setup',
      launchIntent: { recipeId: 'search-console-setup' },
    });
    assert.equal(r.recipeId, 'adsense-setup');
    assert.equal(r.source, 'explicit');
  });
});

describe('resolveRecipe — active session 유지', () => {
  it('진행 중인 RecipeSession을 유지한다', () => {
    const r = resolveRecipe({ activeRecipeSession: { recipeId: 'adsense-setup' } });
    assert.equal(r.recipeId, 'adsense-setup');
    assert.equal(r.source, 'session');
  });
  it('존재하지 않는 session recipeId → 다음 우선순위', () => {
    const r = resolveRecipe({ activeRecipeSession: { recipeId: 'deleted-recipe' } });
    assert.equal(r.source, 'generic');
  });
});

describe('resolveRecipe — URL 기반 선택', () => {
  it('AdSense URL에서 adsense-setup 선택', () => {
    const r = resolveRecipe({ url: 'https://adsense.google.com/adsense/publisher' });
    assert.equal(r.recipeId, 'adsense-setup');
    assert.equal(r.source, 'url');
  });
  it('Search Console URL에서 search-console-setup 선택', () => {
    const r = resolveRecipe({ url: 'https://search.google.com/search-console/welcome' });
    assert.equal(r.recipeId, 'search-console-setup');
    assert.equal(r.source, 'url');
  });
  it('미등록 사이트 URL → generic-setup', () => {
    const r = resolveRecipe({ url: 'https://www.tistory.com/manage/settings' });
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });
  it('잘못된 URL이어도 generic-setup으로 안전하게 fallback', () => {
    const r = resolveRecipe({ url: 'not-a-valid-url' });
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });
});

describe('resolveRecipe — generic fallback', () => {
  it('컨텍스트 없으면 generic-setup', () => {
    const r = resolveRecipe({});
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });
  it('인자 없어도 generic-setup', () => {
    const r = resolveRecipe();
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });
});

describe('resolveRecipe — 우선순위 검증', () => {
  it('session이 URL보다 우선한다', () => {
    const r = resolveRecipe({
      activeRecipeSession: { recipeId: 'search-console-setup' },
      url: 'https://adsense.google.com/adsense/',
    });
    assert.equal(r.recipeId, 'search-console-setup');
    assert.equal(r.source, 'session');
  });
});
