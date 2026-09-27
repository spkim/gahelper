import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyLocal } from "../lib/engine.js";

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

// 요소가 발견된 probe 결과.
function found(overrides = {}) {
  return { url: "https://example.com/settings", found: { v: { found: true, ...overrides } } };
}

// 요소가 DOM 에 없는 probe 결과 (probe.js 가 반환하는 실제 형태).
function notFoundEl() {
  return { url: "https://example.com/settings", found: { v: { found: false } } };
}

// 로케이터 자체가 실패해 키 'v' 가 없는 probe 결과 (비정상 경로).
function noItem() {
  return { url: "https://example.com/settings", found: {} };
}

function urlOnly(url) {
  return { url, found: {} };
}

// ─── guards ───────────────────────────────────────────────────────────────────

describe("verifyLocal — guards", () => {
  it("verify 가 null 이면 false", () => {
    assert.equal(verifyLocal(null, found()), false);
  });
  it("probeResult 가 null 이면 false", () => {
    assert.equal(verifyLocal({ is: "found" }, null), false);
  });
  it("verify 와 probeResult 가 모두 null 이면 false", () => {
    assert.equal(verifyLocal(null, null), false);
  });
});

// ─── urlIncludes ─────────────────────────────────────────────────────────────

describe("verifyLocal — urlIncludes", () => {
  it("URL 에 text 가 포함되면 통과", () => {
    assert.ok(verifyLocal({ is: "urlIncludes", text: "/settings" }, urlOnly("https://example.com/settings/profile")));
  });
  it("URL 에 text 가 없으면 불통과", () => {
    assert.ok(!verifyLocal({ is: "urlIncludes", text: "/settings" }, urlOnly("https://example.com/home")));
  });
  it("공백 정규화 후 매칭", () => {
    // normalizeSpace 가 양쪽 적용됨.
    assert.ok(verifyLocal({ is: "urlIncludes", text: " /settings " }, urlOnly("https://example.com/settings")));
  });
  it("found 항목이 없어도 url 기반으로 판정한다", () => {
    // urlIncludes 는 probeResult.found.v 를 쓰지 않는다.
    assert.ok(verifyLocal({ is: "urlIncludes", text: "/settings" }, noItem()));
  });
});

// ─── found ────────────────────────────────────────────────────────────────────

describe("verifyLocal — found", () => {
  it("요소가 있으면 통과", () => {
    assert.ok(verifyLocal({ is: "found" }, found()));
  });
  it("요소가 DOM 에 없으면 불통과", () => {
    assert.ok(!verifyLocal({ is: "found" }, notFoundEl()));
  });
  it("item 키 자체가 없으면 불통과", () => {
    assert.ok(!verifyLocal({ is: "found" }, noItem()));
  });
});

// ─── notFound ─────────────────────────────────────────────────────────────────

describe("verifyLocal — notFound", () => {
  it("요소가 DOM 에 없으면 통과 (의도한 상태)", () => {
    assert.ok(verifyLocal({ is: "notFound" }, notFoundEl()));
  });
  it("요소가 있으면 불통과", () => {
    assert.ok(!verifyLocal({ is: "notFound" }, found()));
  });
  it("item 키 자체가 없으면 false (probe 실패 — 보수적 판정)", () => {
    // probe 가 아무 결과도 없을 때는 notFound 도 통과로 오판하지 않는다.
    assert.ok(!verifyLocal({ is: "notFound" }, noItem()));
  });
});

// ─── checked ──────────────────────────────────────────────────────────────────

describe("verifyLocal — checked", () => {
  it("체크된 상태이면 통과", () => {
    assert.ok(verifyLocal({ is: "checked" }, found({ checked: true })));
  });
  it("체크 해제 상태이면 불통과", () => {
    assert.ok(!verifyLocal({ is: "checked" }, found({ checked: false })));
  });
  it("요소가 없으면 불통과 (checked 값이 undefined)", () => {
    assert.ok(!verifyLocal({ is: "checked" }, notFoundEl()));
  });
  it("item 키 자체가 없으면 불통과", () => {
    assert.ok(!verifyLocal({ is: "checked" }, noItem()));
  });
});

// ─── unchecked ────────────────────────────────────────────────────────────────

describe("verifyLocal — unchecked", () => {
  it("요소가 있고 체크 해제 상태이면 통과", () => {
    assert.ok(verifyLocal({ is: "unchecked" }, found({ checked: false })));
  });
  it("요소가 있고 체크된 상태이면 불통과", () => {
    assert.ok(!verifyLocal({ is: "unchecked" }, found({ checked: true })));
  });
  it("요소가 없으면 불통과 (found:false 로 item.found 조건 실패)", () => {
    assert.ok(!verifyLocal({ is: "unchecked" }, notFoundEl()));
  });
  it("item 키 자체가 없으면 불통과", () => {
    assert.ok(!verifyLocal({ is: "unchecked" }, noItem()));
  });
});

// ─── valueIn ─────────────────────────────────────────────────────────────────

describe("verifyLocal — valueIn", () => {
  it("value 가 목록 안에 있으면 통과", () => {
    assert.ok(verifyLocal(
      { is: "valueIn", values: ["공개", "전체공개"] },
      found({ value: "공개" })
    ));
  });
  it("value 가 목록에 없으면 불통과", () => {
    assert.ok(!verifyLocal(
      { is: "valueIn", values: ["공개"] },
      found({ value: "비공개" })
    ));
  });
  it("공백 정규화 후 매칭 (normalizeCompact — 모든 공백 제거)", () => {
    // "전체 공개" → "전체공개", values 의 "전체공개" 와 일치.
    assert.ok(verifyLocal(
      { is: "valueIn", values: ["전체공개"] },
      found({ value: "전체 공개" })
    ));
  });
  it("value 앞뒤 공백 제거 후 매칭", () => {
    assert.ok(verifyLocal(
      { is: "valueIn", values: ["공개"] },
      found({ value: "  공개  " })
    ));
  });
  it("요소가 없으면 불통과", () => {
    assert.ok(!verifyLocal(
      { is: "valueIn", values: ["공개"] },
      notFoundEl()
    ));
  });
  it("values 가 빈 배열이면 항상 불통과", () => {
    assert.ok(!verifyLocal(
      { is: "valueIn", values: [] },
      found({ value: "공개" })
    ));
  });
  it("values 가 없으면 (undefined) 불통과", () => {
    assert.ok(!verifyLocal(
      { is: "valueIn" },
      found({ value: "공개" })
    ));
  });
});

// ─── textPresent ─────────────────────────────────────────────────────────────

describe("verifyLocal — textPresent", () => {
  it("text 가 item.text 에 포함되면 통과", () => {
    assert.ok(verifyLocal(
      { is: "textPresent", text: "저장" },
      found({ text: "설정이 저장되었습니다" })
    ));
  });
  it("text 가 item.text 에 없으면 불통과", () => {
    assert.ok(!verifyLocal(
      { is: "textPresent", text: "저장" },
      found({ text: "취소되었습니다" })
    ));
  });
  it("공백 정규화 후 부분 일치 (normalizeSpace)", () => {
    // "저장  완료" → "저장 완료", verify.text "저장 완료" 와 일치.
    assert.ok(verifyLocal(
      { is: "textPresent", text: "저장 완료" },
      found({ text: "설정이 저장  완료되었습니다" })
    ));
  });
  it("요소가 없으면 불통과", () => {
    assert.ok(!verifyLocal(
      { is: "textPresent", text: "저장" },
      notFoundEl()
    ));
  });
  it("item 키 자체가 없으면 불통과", () => {
    assert.ok(!verifyLocal(
      { is: "textPresent", text: "저장" },
      noItem()
    ));
  });
});

// ─── default ─────────────────────────────────────────────────────────────────

describe("verifyLocal — 알 수 없는 is 값", () => {
  it("정의되지 않은 is → false (모델이 만들어낸 조건을 허용하지 않음)", () => {
    assert.ok(!verifyLocal({ is: "alwaysTrue" }, found()));
    assert.ok(!verifyLocal({ is: "" }, found()));
    assert.ok(!verifyLocal({ is: undefined }, found()));
  });
});

// ─── 오탐 방지 (False-positive prevention) ────────────────────────────────────

describe("verifyLocal — 오탐 방지", () => {
  it("요소가 사라진 경우(found:false) 어떤 긍정 조건도 통과하지 않는다", () => {
    const absent = notFoundEl();
    assert.ok(!verifyLocal({ is: "found" },       absent), "found");
    assert.ok(!verifyLocal({ is: "checked" },      absent), "checked");
    assert.ok(!verifyLocal({ is: "unchecked" },    absent), "unchecked");
    assert.ok(!verifyLocal({ is: "valueIn", values: ["x"] }, absent), "valueIn");
    assert.ok(!verifyLocal({ is: "textPresent", text: "" }, absent), "textPresent");
  });

  it("로케이터 자체가 실패한 경우(item 없음) 어떤 조건도 통과하지 않는다", () => {
    const none = noItem();
    assert.ok(!verifyLocal({ is: "found" },       none), "found");
    assert.ok(!verifyLocal({ is: "notFound" },    none), "notFound");
    assert.ok(!verifyLocal({ is: "checked" },      none), "checked");
    assert.ok(!verifyLocal({ is: "unchecked" },    none), "unchecked");
    assert.ok(!verifyLocal({ is: "valueIn", values: ["x"] }, none), "valueIn");
    assert.ok(!verifyLocal({ is: "textPresent", text: "" }, none), "textPresent");
  });
});
