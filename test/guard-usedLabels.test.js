import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guard } from "../lib/guard.js";

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function sig(...texts) {
  return texts.map((t) => ({ tag: "span", text: t, nearLabels: [] }));
}

// 기본 정상 step. 개별 필드만 overrides로 교체.
function step(overrides = {}) {
  return {
    instruct: "화면에서 '설정'을 클릭하세요.",
    usedLabels: ["설정"],
    target: { by: "linkText", text: "설정" },
    verify: { is: "urlIncludes", text: "/settings" },
    onFail: null,
    ...overrides,
  };
}

function proc(steps) {
  return { goalLabel: "테스트", steps };
}

// ─── usedLabels 기본 검사 ─────────────────────────────────────────────────────

describe("guard — usedLabels 기본", () => {
  it("usedLabels 의 라벨이 모두 관측되면 통과", () => {
    const r = guard(proc([step()]), sig("설정"));
    assert.ok(r.ok);
  });

  it("usedLabels 에 미관측 라벨이 있으면 폐기", () => {
    const r = guard(proc([step({ usedLabels: ["설정", "없는메뉴"] })]), sig("설정"));
    assert.ok(!r.ok);
    assert.ok(r.reasons.some((x) => x.includes("unobserved_label:없는메뉴")), r.reasons.join());
  });

  it("usedLabels 필드 자체가 없으면 폐기", () => {
    const s = { instruct: "설정을 클릭하세요.", target: { by: "linkText", text: "설정" },
                verify: { is: "urlIncludes", text: "/settings" }, onFail: null };
    const r = guard(proc([s]), sig("설정"));
    assert.ok(!r.ok);
    assert.ok(r.reasons.some((x) => x.includes("no_usedLabels")), r.reasons.join());
  });

  it("usedLabels 가 빈 배열이고 instruct 에 따옴표 없으면 통과 — 라벨 없는 step 허용", () => {
    const r = guard(proc([step({ instruct: "페이지 하단으로 스크롤하세요.",
      usedLabels: [], target: null })]), sig("설정"));
    assert.ok(r.ok);
  });
});

// ─── 핵심 기능: 문장 형식과 독립된 검사 ──────────────────────────────────────

describe("guard — 문장 형식 독립", () => {
  it("따옴표 없이 라벨을 쓴 instruct + 정확한 usedLabels → 통과", () => {
    // 이전 guard 는 이 케이스에서 extractQuoted([]) → 검사 0개로 헐거워짐.
    // 이제 usedLabels 로 검사하므로 따옴표 없이 써도 정상 검증됨.
    const r = guard(proc([step({ instruct: "왼쪽 메뉴에서 설정을 클릭하세요.",
      usedLabels: ["설정"] })]), sig("설정"));
    assert.ok(r.ok);
  });

  it("따옴표 없이 썼는데 usedLabels 누락이면 폐기", () => {
    const s = { instruct: "왼쪽 메뉴에서 설정을 클릭하세요.",
                target: { by: "linkText", text: "설정" },
                verify: { is: "urlIncludes", text: "/settings" }, onFail: null };
    const r = guard(proc([s]), sig("설정"));
    assert.ok(!r.ok);
    assert.ok(r.reasons.some((x) => x.includes("no_usedLabels")));
  });
});

// ─── 교차 검증: quoted_not_in_usedLabels ─────────────────────────────────────

describe("guard — 교차 검증 (모델의 usedLabels 비우기 차단)", () => {
  it("instruct 의 따옴표 라벨이 usedLabels 에 없으면 폐기", () => {
    // 모델이 usedLabels=[] 로 비워서 pool 검사를 회피하려는 경우.
    const r = guard(proc([step({ instruct: "화면에서 '설정'을 클릭하세요.",
      usedLabels: [] })]), sig("설정"));
    assert.ok(!r.ok);
    assert.ok(r.reasons.some((x) => x.includes("quoted_not_in_usedLabels:설정")), r.reasons.join());
  });

  it("instruct 의 따옴표 라벨이 미관측 + usedLabels 에도 없으면 두 오류 모두 잡힘", () => {
    // 모델이 observed 에 없는 라벨을 따옴표로 쓰고 usedLabels 도 비운 경우.
    const r = guard(proc([step({ instruct: "화면에서 '관리자설정'을 클릭하세요.",
      usedLabels: [] })]), sig("설정"));
    assert.ok(!r.ok);
    assert.ok(r.reasons.some((x) => x.includes("quoted_not_in_usedLabels:관리자설정")), r.reasons.join());
  });

  it("instruct 따옴표 라벨이 usedLabels 에 있으면 교차 검증 통과", () => {
    const r = guard(proc([step({ instruct: "화면에서 '설정'을 클릭하세요.",
      usedLabels: ["설정"] })]), sig("설정"));
    assert.ok(r.ok);
  });
});

// ─── 기존 검사 유지 확인 ──────────────────────────────────────────────────────

describe("guard — 기존 검사 유지 (target/verify.probe pool 대조)", () => {
  it("target.text 가 미관측이면 여전히 폐기", () => {
    const r = guard(proc([step({ target: { by: "buttonText", text: "없는버튼" } })]), sig("설정"));
    assert.ok(!r.ok);
    assert.ok(r.reasons.some((x) => x.includes("unobserved_locator:없는버튼")));
  });

  it("verify 없으면 여전히 폐기", () => {
    const r = guard(proc([step({ verify: null })]), sig("설정"));
    assert.ok(!r.ok);
    assert.ok(r.reasons.some((x) => x.includes("no_verify")));
  });

  it("steps 빈 배열이면 empty:true 반환 (폐기 아님)", () => {
    const r = guard(proc([]), sig("설정"));
    assert.ok(r.ok);
    assert.ok(r.empty);
  });
});
