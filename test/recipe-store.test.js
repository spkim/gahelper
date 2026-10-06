import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRecipe, listRecipes, matchRecipes } from '../lib/recipe-store.js';
import { lintRecipe, lintSite, lintLabel, lintPayload, LIMITS } from './helpers/recipe-lint.js';

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

// ─── 레시피 린트(C2) ──────────────────────────────────────────────────────────
// 규칙은 test/helpers/recipe-lint.js. 레지스트리 11개가 통과해야 하고, 규칙마다 음성 케이스가 실패해야 한다.

describe('recipe lint — 레지스트리', () => {
  for (const recipe of listRecipes()) {
    it(`${recipe.id} 는 린트를 통과한다`, () => {
      assert.deepEqual(lintRecipe(recipe), []);
    });
  }
  it('generic-setup 만 goals 가 비어 있다', () => {
    const empty = listRecipes().filter((r) => r.goals.length === 0).map((r) => r.id);
    assert.deepEqual(empty, ['generic-setup']);
  });
});

describe('recipe lint — 음성 케이스', () => {
  const good = () => ({ id: 'RX', goals: [{ id: 'step_0', label: '지메일에서 거래처 라벨 만들기', site: 'https://mail.google.com/' }] });
  const has = (violations, re) => assert.ok(violations.some((v) => re.test(v)), `${re} not in ${JSON.stringify(violations)}`);

  it('기준 레시피는 통과한다', () => assert.deepEqual(lintRecipe(good()), []));

  it('site: URL 이 아님, http, 인증 정보, 도메인 없음, 쿼리·해시', () => {
    has(lintSite('chatgpt.com', 'x'), /올바른 URL/);
    has(lintSite('http://chatgpt.com/', 'x'), /https/);
    has(lintSite('https://user:pw@chatgpt.com/', 'x'), /인증 정보/);
    has(lintSite('https://localhost/', 'x'), /도메인/);
    has(lintSite('https://chatgpt.com/?token=1', 'x'), /쿼리/);
    has(lintSite('https://chatgpt.com/#a', 'x'), /쿼리/);
    assert.deepEqual(lintSite(undefined, 'x'), []);
  });

  it('label: 메뉴 경로, 조작 지시, URL·선택자, 길이', () => {
    has(lintLabel('설정 > 개인화 > 맞춤 지침 열기', 'x'), /메뉴 경로/);
    has(lintLabel('설정 → 개인화에서 지침 입력하기', 'x'), /메뉴 경로/);
    has(lintLabel('저장 버튼을 클릭해서 지침 저장하기', 'x'), /조작 지시/);
    has(lintLabel('https://chatgpt.com/ 에서 지침 설정하기', 'x'), /URL/);
    has(lintLabel('div.menu[role=button] 찾아서 열기', 'x'), /선택자/);
    has(lintLabel('열기', 'x'), /짧음/);
    has(lintLabel('가'.repeat(LIMITS.labelMax + 1), 'x'), /김/);
    has(lintLabel(undefined, 'x'), /문자열/);
  });

  it('payload: kind, 빈 label·content, 길이, label 에 content 포함', () => {
    const p = { kind: 'clipboard', label: '테스트용 노드', content: '{}' };
    assert.deepEqual(lintPayload(p, '노드를 붙여넣고 실행하기', 'x'), []);
    has(lintPayload({ ...p, kind: 'file' }, 'l', 'x'), /clipboard/);
    has(lintPayload({ ...p, label: ' ' }, 'l', 'x'), /label 이 비어/);
    has(lintPayload({ ...p, content: '' }, 'l', 'x'), /content 가 비어/);
    has(lintPayload({ ...p, content: 'a'.repeat(LIMITS.payloadContentMax + 1) }, 'l', 'x'), /넘음/);
    has(lintPayload({ ...p, content: 'SECRETBODY' }, '붙여넣기 SECRETBODY 실행', 'x'), /label 에 payload.content/);
  });

  it('goals: 비어 있음(generic-setup 외), goal id 중복, generic-setup 에 goal', () => {
    has(lintRecipe({ id: 'RX', goals: [] }), /goals 가 비어/);
    const dup = good();
    dup.goals.push({ ...dup.goals[0] });
    has(lintRecipe(dup), /id 중복/);
    has(lintRecipe({ id: 'generic-setup', goals: good().goals }), /비어 있어야/);
    assert.deepEqual(lintRecipe({ id: 'generic-setup', goals: [] }), []);
  });
});
