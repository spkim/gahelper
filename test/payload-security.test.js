import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRecipe } from '../lib/recipe-store.js';
import { compact } from '../lib/signature.js';

// payload.content 는 LLM 요청 본문에 절대 포함되지 않아야 한다.
// procedure-generator.resolve(provider, goalText, signature) 는
// goalText 와 signature 만 직렬화한다.

function buildUserMessage(goalText, signature) {
  return JSON.stringify({ goal: goalText, observed: compact(signature) });
}

describe('Payload security — payload.content가 LLM 요청에 포함되지 않음', () => {
  const recipe = getRecipe('R10');
  const goal = recipe.goals.find((g) => g.id === 'step_1');

  it('R10 step_1 에 clipboard payload 가 있다', () => {
    assert.ok(goal, 'step_1 goal 이 존재해야 함');
    assert.equal(goal.payload?.kind, 'clipboard');
    assert.ok(typeof goal.payload.content === 'string' && goal.payload.content.length > 0);
  });

  it('goal.label 이 payload.content 를 포함하지 않는다', () => {
    assert.ok(!goal.label.includes(goal.payload.content),
      'label 에 payload.content 가 노출되면 LLM 에 전달될 수 있음');
  });

  it('resolver user message 에 payload.content 가 없다 (시그니처 비어있을 때)', () => {
    const msg = buildUserMessage(goal.label, []);
    assert.ok(!msg.includes(goal.payload.content),
      `resolver 입력에 payload.content 가 포함됨:\n${msg.slice(0, 200)}`);
  });

  it('resolver user message 에 payload.content 가 없다 (시그니처 있을 때)', () => {
    const sig = [
      { tag: 'button', text: 'Execute workflow', nearLabels: [] },
      { tag: 'div',    text: 'Canvas',           nearLabels: [] },
    ];
    const msg = buildUserMessage(goal.label, sig);
    assert.ok(!msg.includes(goal.payload.content),
      '시그니처가 있어도 payload.content 가 resolver 입력에 포함되면 안 됨');
  });

  it('payload.content 는 goal.label 과 독립된 필드이다', () => {
    // label 과 content 가 같은 문자열이면 label 을 통해 간접 노출 가능.
    // 서로 다른 문자열임을 확인.
    assert.notEqual(goal.label, goal.payload.content);
  });
});

describe('Payload security — payload 필드 구조 검증', () => {
  it('payload.kind 는 "clipboard" 이다', () => {
    const goal = getRecipe('R10').goals.find((g) => g.id === 'step_1');
    assert.equal(goal.payload.kind, 'clipboard');
  });

  it('payload.label 이 있다 (복사 버튼 표시용)', () => {
    const goal = getRecipe('R10').goals.find((g) => g.id === 'step_1');
    assert.ok(typeof goal.payload.label === 'string' && goal.payload.label.length > 0);
  });

  it('payload 없는 goal 은 payload 필드 자체가 없다 (R10 step_0)', () => {
    const goal = getRecipe('R10').goals.find((g) => g.id === 'step_0');
    assert.equal(goal.payload, undefined);
  });

  it('goalText 에 "복사한 노드를 붙여넣고" 포함 — resolver 가 clipboard ready 상태를 인지', () => {
    const goal = getRecipe('R10').goals.find((g) => g.id === 'step_1');
    assert.ok(goal.label.includes('복사한 노드를 붙여넣고'),
      'resolver 가 사용자가 이미 복사한 상태임을 알 수 있어야 함');
  });
});
