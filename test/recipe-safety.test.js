import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { guard } from '../lib/guard.js';
import { getRecipe } from '../lib/recipe-store.js';
import { resolveRecipe } from '../lib/recipe-resolver.js';

// Safety regression: Recipe 계층이 추가돼도 안전 계약이 유지되는지 확인.

const SIG_SETTINGS_PAGE = [
  { tag: 'button', text: '저장',  nearLabels: [] },
  { tag: 'input',  text: '',     nearLabels: ['도메인'] },
  { tag: 'h2',     text: '사이트 설정', nearLabels: [] },
  { tag: 'a',      text: '설정 홈', nearLabels: [] },
];

describe('Safety — Recipe goal label observed-only', () => {
  it('Recipe goal label이 signature에 없으면 guard가 절차를 폐기한다', () => {
    const recipe = getRecipe('adsense-setup');
    const goalLabel = recipe.goals[0].label; // "사이트 등록" — signature에 없음

    const proc = {
      goalLabel,
      steps: [{
        instruct: `'${goalLabel}' 버튼을 클릭하세요.`,
        target: { by: 'buttonText', text: goalLabel },
        verify: { probe: { by: 'buttonText', text: '저장' }, is: 'found' },
        onFail: null,
      }],
    };

    const result = guard(proc, SIG_SETTINGS_PAGE);
    assert.equal(result.ok, false, 'guard가 관측되지 않은 Recipe label을 차단해야 함');
    assert.ok(result.reasons.some((r) => r.includes('unobserved')));
  });

  it('같은 화면에서 관측된 라벨만 쓴 절차는 guard를 통과한다', () => {
    const proc = {
      goalLabel: '사이트 설정',
      steps: [{
        instruct: "'저장' 버튼을 눌러 변경사항을 적용하세요.",
        target: { by: 'buttonText', text: '저장' },
        verify: { probe: { by: 'buttonText', text: '저장' }, is: 'found' },
        onFail: null,
      }],
    };

    const result = guard(proc, SIG_SETTINGS_PAGE);
    assert.equal(result.ok, true);
  });
});

describe('Safety — verify 없는 step 폐기', () => {
  it('verify가 없는 step이 있으면 절차 전체를 폐기한다', () => {
    const proc = {
      goalLabel: '저장',
      steps: [{
        instruct: "'저장' 클릭",
        target: { by: 'buttonText', text: '저장' },
        onFail: null,
        // verify 없음
      }],
    };
    const result = guard(proc, SIG_SETTINGS_PAGE);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes('no_verify')));
  });
});

describe('Safety — guard 불통과 절차 전체 폐기', () => {
  it('단 하나의 step이 위반해도 절차 전체가 폐기된다', () => {
    const proc = {
      goalLabel: '테스트',
      steps: [
        {
          instruct: "'저장' 버튼을 누르세요.",
          target: { by: 'buttonText', text: '저장' },
          verify: { probe: { by: 'buttonText', text: '저장' }, is: 'found' },
          onFail: null,
        },
        {
          instruct: "'존재하지않는버튼' 을 클릭하세요.",
          target: { by: 'buttonText', text: '존재하지않는버튼' },
          verify: { probe: { by: 'buttonText', text: '저장' }, is: 'found' },
          onFail: null,
        },
      ],
    };
    const result = guard(proc, SIG_SETTINGS_PAGE);
    assert.equal(result.ok, false, '하나라도 위반이면 전체 폐기');
  });
});

describe('Safety — cache/backend 없어도 generic-setup 선택', () => {
  it('외부 의존 없이 generic-setup이 선택된다', () => {
    const r = resolveRecipe({ url: 'https://unknown-cms.example.com/settings' });
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });

  it('컨텍스트가 전혀 없어도 generic-setup이 선택된다', () => {
    const r = resolveRecipe();
    assert.equal(r.recipeId, 'generic-setup');
    assert.equal(r.source, 'generic');
  });
});
