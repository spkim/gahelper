import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { guard, extractQuoted, buildTextPool } from "../lib/guard.js";

// 유닛 테스트 — node --test test/guard.test.js

const SIG = [
  { tag: "button", text: "저장", nearLabels: [], role: undefined, ariaLabel: undefined },
  { tag: "a", text: "카테고리 관리", nearLabels: [], role: undefined, ariaLabel: undefined },
  { tag: "input", text: "공개", nearLabels: ["공개 여부"], role: undefined, ariaLabel: undefined },
  { tag: "h2", text: "기본 설정", nearLabels: [], role: undefined, ariaLabel: undefined },
  { tag: "button", text: "취소", nearLabels: [], role: undefined, ariaLabel: undefined },
];

// 정상 절차 — 관측된 라벨만 사용, verify 있음.
const VALID_PROC = {
  goalLabel: "카테고리 설정",
  steps: [
    {
      instruct: "'카테고리 관리' 링크를 클릭하세요.",
      target: { by: "linkText", text: "카테고리 관리" },
      verify: { probe: { by: "urlIncludes", text: "/category" }, is: "found" },
      onFail: "상단 메뉴에서 카테고리를 찾아보세요.",
    },
    {
      instruct: "'저장' 버튼을 눌러 변경사항을 저장하세요.",
      target: { by: "buttonText", text: "저장" },
      verify: { probe: { by: "buttonText", text: "저장" }, is: "found" },
      onFail: null,
    },
  ],
};

describe("extractQuoted", () => {
  it("반따옴표를 추출한다", () => {
    const out = extractQuoted("'카테고리 관리' 링크를 클릭하세요.");
    assert.deepEqual(out, ["카테고리 관리"]);
  });
  it("꺾쇠를 추출한다", () => {
    const out = extractQuoted("[저장] 버튼을 누르세요.");
    assert.deepEqual(out, ["저장"]);
  });
  it("여러 따온표를 추출한다", () => {
    const out = extractQuoted("'기본 설정' 탭의 '저장' 버튼.");
    assert.deepEqual(out, ["기본 설정", "저장"]);
  });
  it("따온표가 없으면 빈 배열", () => {
    assert.deepEqual(extractQuoted("그냥 텍스트"), []);
  });
  it("겹낫표를 추출한다", () => {
    const out = extractQuoted("「카테고리 관리」 링크를 클릭하세요.");
    assert.deepEqual(out, ["카테고리 관리"]);
  });
});

describe("buildTextPool", () => {
  it("text/ariaLabel/nearLabels 를 합친다", () => {
    const sig = [
      { tag: "button", text: "저장", ariaLabel: "Save", nearLabels: ["이름"] },
    ];
    const pool = buildTextPool(sig);
    assert.ok(pool.has("저장"));
    assert.ok(pool.has("save"));
    assert.ok(pool.has("이름"));
  });
});

describe("guard — 통과 케이스", () => {
  it("정상 절차는 통과한다", () => {
    const result = guard(VALID_PROC, SIG);
    assert.equal(result.ok, true);
    assert.deepEqual(result.reasons, []);
  });

  it("urlIncludes verify 는 관측 풀 검사를 건너뛴다", () => {
    const proc = {
      steps: [
        {
          instruct: "'카테고리 관리' 페이지로 이동합니다.",
          verify: { is: "urlIncludes", text: "/manage/category" },
        },
      ],
    };
    const result = guard(proc, SIG);
    assert.equal(result.ok, true);
  });

  it("steps:[] 는 ok:true, empty:true 를 반환한다", () => {
    const result = guard({ steps: [] }, SIG);
    assert.equal(result.ok, true);
    assert.equal(result.empty, true);
  });
});

describe("guard — 불통과 케이스 (절차 전체 폐기)", () => {
  it("verify 없는 step 은 폐기한다", () => {
    const proc = {
      steps: [
        { instruct: "'저장' 버튼을 누르세요." },
      ],
    };
    const result = guard(proc, SIG);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("no_verify")));
  });

  it("관측되지 않은 라벨을 instruct 에 쓰면 폐기한다", () => {
    const proc = {
      steps: [
        {
          instruct: "'존재하지않는메뉴' 항목을 클릭하세요.",
          verify: { probe: { by: "buttonText", text: "저장" }, is: "found" },
        },
      ],
    };
    const result = guard(proc, SIG);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("unobserved_label")));
  });

  it("관측되지 않은 로케이터 text 는 폐기한다", () => {
    const proc = {
      steps: [
        {
          instruct: "'저장' 버튼을 누르세요.",
          verify: { probe: { by: "buttonText", text: "phantom_button" }, is: "found" },
        },
      ],
    };
    const result = guard(proc, SIG);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("unobserved_locator")));
  });

  it("css 로케이터는 즉시 폐기한다", () => {
    const proc = {
      steps: [
        {
          instruct: "'저장' 버튼을 누르세요.",
          target: { by: "css", selector: ".save-btn" },
          verify: { probe: { by: "buttonText", text: "저장" }, is: "found" },
        },
      ],
    };
    const result = guard(proc, SIG);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((r) => r.includes("css_locator")));
  });

  it("procedure 자체가 없으면 폐기한다", () => {
    const result = guard(null, SIG);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("no_procedure"));
  });

  it("steps 가 배열이 아니면 폐기한다", () => {
    const result = guard({ steps: "not an array" }, SIG);
    assert.equal(result.ok, false);
  });

  it("textPresent verify.text 가 관측되지 않으면 폐기한다", () => {
    const proc = {
      steps: [
        {
          instruct: "설정을 확인하세요.",
          verify: {
            probe: { by: "textPresent", text: "ghost_text" },
            is: "textPresent",
            text: "ghost_text",
          },
        },
      ],
    };
    const result = guard(proc, SIG);
    assert.equal(result.ok, false);
  });
});

describe("guard — 관측 풀 부분 일치", () => {
  it("긴 텍스트 안에 라벨이 포함되면 통과한다", () => {
    const sig = [
      { tag: "button", text: "설정 저장하기", nearLabels: [], ariaLabel: undefined },
    ];
    const proc = {
      steps: [
        {
          instruct: "'저장' 버튼을 누르세요.",
          verify: { probe: { by: "buttonText", text: "저장" }, is: "found" },
        },
      ],
    };
    const result = guard(proc, sig);
    assert.equal(result.ok, true);
  });
});
