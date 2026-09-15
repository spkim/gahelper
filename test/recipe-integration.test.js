import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolveRecipe } from '../lib/recipe-resolver.js';
import {
  createRecipeSession, clearRecipeSession, currentGoal,
  markGoalDone, markGoalBlocked, skipOptionalGoal, getRecipeSession,
} from '../lib/recipe-engine.js';
import { getRecipe, listRecipes } from '../lib/recipe-store.js';
import { guard } from '../lib/guard.js';

const TAB = 3001;
const FIXTURES_DIR = new URL('../fixtures', import.meta.url).pathname;

function fresh(recipeId) {
  clearRecipeSession(TAB);
  return createRecipeSession(TAB, recipeId);
}

// ─── Recipe 콘텐츠 검증 ────────────────────────────────────────────────────

describe('Recipe 콘텐츠 — UI 하드코딩 금지', () => {
  // CSS selector 패턴: querySelector, getElementById, attribute selector [attr=...], CSS rule block
  // .class 는 ads.txt 같은 파일 확장자와 구분이 어려우므로 제외.
  const CSS_RE = /querySelector|getElementById|\[[\w-]+=|\{[^}]*\}|:nth-child|:hover/;
  // 좌표/크기 패턴: 100px, top:, position:
  const COORD_RE = /\d+px|top\s*:|left\s*:|position\s*:/;

  for (const recipe of listRecipes()) {
    if (recipe.id === 'generic-setup') continue;

    it(`${recipe.id}: goal label 에 CSS selector 없음`, () => {
      for (const g of recipe.goals) {
        assert.ok(!CSS_RE.test(g.label),
          `goal "${g.id}".label 에 CSS 패턴 있음: "${g.label}"`);
        assert.ok(!CSS_RE.test(g.description ?? ''),
          `goal "${g.id}".description 에 CSS 패턴 있음`);
      }
    });

    it(`${recipe.id}: goal label 에 좌표/픽셀값 없음`, () => {
      for (const g of recipe.goals) {
        assert.ok(!COORD_RE.test(g.label),
          `goal "${g.id}".label 에 좌표값 있음: "${g.label}"`);
      }
    });

    it(`${recipe.id}: goals 는 의미적 명칭 (id, label, optional 만 허용)`, () => {
      for (const g of recipe.goals) {
        const keys = Object.keys(g);
        const allowed = new Set(['id', 'label', 'description', 'optional']);
        for (const k of keys) {
          assert.ok(allowed.has(k),
            `goal "${g.id}" 에 허용되지 않는 필드: "${k}" — Recipe 에 UI 상세 정보를 넣지 마라`);
        }
      }
    });
  }
});

// ─── AdSense Recipe 전체 흐름 ─────────────────────────────────────────────

describe('AdSense Recipe — resolver → engine → 완주', () => {
  it('AdSense URL → resolver 가 adsense-setup 선택', () => {
    const r = resolveRecipe({ url: 'https://adsense.google.com/adsense/publisher' });
    assert.equal(r.recipeId, 'adsense-setup');
    assert.equal(r.source, 'url');
  });

  it('4개 goal 을 순서대로 완주한다', () => {
    fresh('adsense-setup');
    const expected = ['register-site', 'verify-site', 'check-ads-txt', 'review-readiness'];
    for (const id of expected) {
      assert.equal(currentGoal(TAB)?.id, id, `goal 순서 불일치: ${id}`);
      markGoalDone(TAB);
    }
    assert.equal(getRecipeSession(TAB)?.status, 'done');
  });

  it('optional goal(check-ads-txt) skip 후 완주한다', () => {
    fresh('adsense-setup');
    markGoalDone(TAB); // register-site
    markGoalDone(TAB); // verify-site
    assert.equal(currentGoal(TAB)?.id, 'check-ads-txt');
    skipOptionalGoal(TAB);
    assert.equal(currentGoal(TAB)?.id, 'review-readiness');
    markGoalDone(TAB);
    assert.equal(getRecipeSession(TAB)?.status, 'done');
  });

  it('verify-site 에서 blocked → recipe blocked', () => {
    fresh('adsense-setup');
    markGoalDone(TAB); // register-site
    assert.equal(currentGoal(TAB)?.id, 'verify-site');
    markGoalBlocked(TAB);
    assert.equal(getRecipeSession(TAB)?.status, 'blocked');
    assert.equal(currentGoal(TAB), null);
  });
});

// ─── Search Console Recipe 전체 흐름 ──────────────────────────────────────

describe('Search Console Recipe — resolver → engine → 완주', () => {
  it('Search Console URL → resolver 가 search-console-setup 선택', () => {
    const r = resolveRecipe({ url: 'https://search.google.com/search-console/welcome' });
    assert.equal(r.recipeId, 'search-console-setup');
    assert.equal(r.source, 'url');
  });

  it('3개 goal 을 순서대로 완주한다', () => {
    clearRecipeSession(TAB);
    createRecipeSession(TAB, 'search-console-setup');
    const expected = ['add-property', 'verify-ownership', 'check-coverage'];
    for (const id of expected) {
      assert.equal(currentGoal(TAB)?.id, id);
      markGoalDone(TAB);
    }
    assert.equal(getRecipeSession(TAB)?.status, 'done');
  });

  it('마지막 optional goal(check-coverage) skip 후 done', () => {
    clearRecipeSession(TAB);
    createRecipeSession(TAB, 'search-console-setup');
    markGoalDone(TAB); // add-property
    markGoalDone(TAB); // verify-ownership
    assert.equal(currentGoal(TAB)?.optional, true);
    const result = skipOptionalGoal(TAB);
    assert.equal(result.status, 'done');
  });
});

// ─── Safety: Recipe goal label observed-only ──────────────────────────────

describe('Safety — Recipe goal label 이 signature 에 없으면 guard 차단', () => {
  it('AdSense goal label 은 빈 signature 에서 guard 를 통과하지 못한다', () => {
    const recipe = getRecipe('adsense-setup');
    for (const goal of recipe.goals) {
      const proc = {
        goalLabel: goal.label,
        steps: [{
          instruct: `'${goal.label}' 항목을 찾으세요.`,
          target: { by: 'buttonText', text: goal.label },
          verify: { probe: { by: 'buttonText', text: goal.label }, is: 'found' },
          onFail: null,
        }],
      };
      const result = guard(proc, []); // 빈 signature
      assert.equal(result.ok, false,
        `guard 가 "${goal.label}" 을 빈 signature 에서 통과시키면 안 됨`);
    }
  });

  it('Search Console goal label 도 동일하게 차단된다', () => {
    const recipe = getRecipe('search-console-setup');
    for (const goal of recipe.goals) {
      const proc = {
        goalLabel: goal.label,
        steps: [{
          instruct: `'${goal.label}' 화면으로 이동하세요.`,
          target: { by: 'linkText', text: goal.label },
          verify: { probe: { by: 'linkText', text: goal.label }, is: 'found' },
          onFail: null,
        }],
      };
      assert.equal(guard(proc, []).ok, false);
    }
  });

  it('goal label 이 실제 signature 에 있으면 guard 를 통과한다', () => {
    // 화면에 goal label 과 동일한 텍스트가 실제로 관측된 경우
    const sig = [
      { tag: 'h2', text: '사이트 등록', nearLabels: [] },
      { tag: 'button', text: '확인', nearLabels: [] },
    ];
    const proc = {
      goalLabel: '사이트 등록',
      steps: [{
        instruct: "'확인' 버튼을 눌러 진행하세요.",
        target: { by: 'buttonText', text: '확인' },
        verify: { probe: { by: 'buttonText', text: '확인' }, is: 'found' },
        onFail: null,
      }],
    };
    assert.equal(guard(proc, sig).ok, true);
  });
});

// ─── generic-setup 호환성 ─────────────────────────────────────────────────

describe('generic-setup — 미등록 사이트 fallback', () => {
  it('미등록 사이트는 항상 generic-setup 으로 fallback 된다', () => {
    const urls = [
      'https://tistory.com/manage',
      'https://wordpress.com/settings',
      'https://notion.so/settings',
      'https://unknown-saas.example.com/config',
    ];
    for (const url of urls) {
      const r = resolveRecipe({ url });
      assert.equal(r.recipeId, 'generic-setup', `${url} should fallback`);
      assert.equal(r.source, 'generic');
    }
  });

  it('generic-setup 은 goals 가 없다 — RecipeSession 없이 guidance 경로 사용', () => {
    const recipe = getRecipe('generic-setup');
    assert.deepEqual(recipe?.goals, []);
    // panel.js 는 generic-setup 시 createRecipeSession 을 호출하지 않는다.
    // 이 테스트는 그 계약을 문서화한다.
  });
});

// ─── Fixture 호환성 ───────────────────────────────────────────────────────

describe('기존 fixtures 호환성', () => {
  it('fixtures 는 모두 draft:true 를 갖는다 (production Recipe 가 아님)', async () => {
    const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 3, 'fixtures 가 3개 이상이어야 함');

    for (const f of files) {
      const data = JSON.parse(await readFile(`${FIXTURES_DIR}/${f}`, 'utf8'));
      assert.equal(data.draft, true,
        `${f}: draft:true 가 없음 — fixture 가 production Recipe 로 잘못 취급될 위험`);
    }
  });

  it('fixture id 가 recipe-store id 와 충돌하지 않는다', async () => {
    const storeIds = new Set(listRecipes().map((r) => r.id));
    const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.json'));

    for (const f of files) {
      const data = JSON.parse(await readFile(`${FIXTURES_DIR}/${f}`, 'utf8'));
      assert.ok(!storeIds.has(data.id),
        `fixture "${data.id}" 가 recipe-store 의 Recipe id 와 충돌함`);
    }
  });
});
