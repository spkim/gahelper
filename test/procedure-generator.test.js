import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "../lib/procedure-generator.js";

// providers.js 는 전역 fetch 를 쓰므로 그 이음새를 스텁한다(별도 주입 지점 없음).
const PROVIDER = { kind: "anthropic", apiKey: "test-key", model: "test-model" };
const SIG = [{ tag: "a", text: "설정", nearLabels: [] }];

const GOOD = {
  goalLabel: "설정 열기",
  steps: [
    {
      instruct: "화면에서 '설정'을 클릭하세요.",
      usedLabels: ["설정"],
      target: { by: "linkText", text: "설정" },
      verify: { is: "urlIncludes", text: "/settings" },
      onFail: null,
    },
  ],
};
// 화면에 없는 라벨 "Billing"을 쓰는 절차 → guard 가 unobserved_label 로 폐기.
const BAD_LABEL = {
  goalLabel: "결제 열기",
  steps: [{ ...GOOD.steps[0], instruct: "'Billing'을 클릭하세요.", usedLabels: ["Billing"], target: { by: "linkText", text: "Billing" } }],
};
const EMPTY = { goalLabel: "", steps: [] };

const okText = (text) => ({ ok: true, status: 200, json: async () => ({ content: [{ text }] }) });
const okJson = (obj) => okText(JSON.stringify(obj));

let calls;
let queue;
let realFetch;
let realWarn;
let realError;
let realInfo;

function stubFetch(responses) {
  queue = [...responses];
  calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (queue.length === 0) throw new Error("fetch 스텁 응답 소진");
    const next = queue.shift();
    return typeof next === "function" ? next() : next;
  };
}

describe("resolve() — attempts 반환 형식과 실패 모드", () => {
  beforeEach(() => {
    realFetch = globalThis.fetch;
    realWarn = console.warn;
    realError = console.error;
    realInfo = console.info;
    console.warn = console.error = console.info = () => {};
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    console.error = realError;
    console.info = realInfo;
  });

  it("첫 시도 통과: { procedure, attempts:[{reasons:[]}] }, 요청 1회", async () => {
    stubFetch([okJson(GOOD)]);
    const res = await resolve(PROVIDER, "설정 열기", SIG);
    assert.equal(res.procedure.goalLabel, "설정 열기");
    assert.deepEqual(res.attempts, [{ reasons: [] }]);
    assert.equal(calls.length, 1);
  });

  it("관련 요소 없음(steps 빈 배열): { empty:true, attempts }", async () => {
    stubFetch([okJson(EMPTY)]);
    const res = await resolve(PROVIDER, "결제", SIG);
    assert.equal(res.empty, true);
    assert.equal(res.procedure, undefined);
    assert.deepEqual(res.attempts, [{ reasons: [] }]);
  });

  it("빈 응답 두 번: json_parse_error 로 재시도 후 던지고 err.attempts 에 이력", async () => {
    stubFetch([okText(""), okText("")]);
    await assert.rejects(
      () => resolve(PROVIDER, "설정 열기", SIG),
      (err) => {
        assert.match(err.message, /JSON/);
        assert.deepEqual(err.attempts, [{ reasons: ["json_parse_error"] }, { reasons: ["json_parse_error"] }]);
        return true;
      },
    );
    assert.equal(calls.length, 2, "MAX_RETRIES=1 이므로 총 2회");
  });

  it("깨진 JSON 뒤 성공: attempts 에 실패·통과가 순서대로, 재시도 요청에 실패 사실이 담김", async () => {
    stubFetch([okText("{ not json"), okJson(GOOD)]);
    const res = await resolve(PROVIDER, "설정 열기", SIG);
    assert.deepEqual(res.attempts, [{ reasons: ["json_parse_error"] }, { reasons: [] }]);
    const retryUser = JSON.parse(calls[1].messages[0].content);
    assert.equal(retryUser.previousAttemptFailed, true);
    assert.match(retryUser.reasons, /json_parse_error/);
    const firstUser = JSON.parse(calls[0].messages[0].content);
    assert.equal(firstUser.previousAttemptFailed, undefined);
  });

  it("깨진 JSON 두 번: 던지고 attempts 2건", async () => {
    stubFetch([okText("{ x"), okText("[1,")]);
    await assert.rejects(
      () => resolve(PROVIDER, "설정 열기", SIG),
      (err) => {
        assert.equal(err.attempts.length, 2);
        assert.ok(err.attempts.every((a) => a.reasons[0] === "json_parse_error"));
        return true;
      },
    );
  });

  it("거절 응답(JSON 아닌 산문): 깨진 JSON 과 같은 경로로 재시도 후 던짐", async () => {
    stubFetch([okText("죄송하지만 그 요청은 도와드릴 수 없습니다."), okText("죄송합니다.")]);
    await assert.rejects(
      () => resolve(PROVIDER, "설정 열기", SIG),
      (err) => {
        assert.deepEqual(err.attempts.map((a) => a.reasons[0]), ["json_parse_error", "json_parse_error"]);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });

  it("존재하지 않는 라벨: guard 이유로 재시도, 이유 원문이 attempts 와 재시도 요청에 담김", async () => {
    stubFetch([okJson(BAD_LABEL), okJson(GOOD)]);
    const res = await resolve(PROVIDER, "설정 열기", SIG);
    assert.equal(res.attempts.length, 2);
    assert.ok(res.attempts[0].reasons.some((r) => r.startsWith("step0:unobserved_label:")), "첫 시도 이유");
    assert.deepEqual(res.attempts[1], { reasons: [] });
    const retryUser = JSON.parse(calls[1].messages[0].content);
    assert.match(retryUser.reasons, /unobserved_label/);
  });

  it("존재하지 않는 라벨 두 번: guard_fail 로 던지고 err.reasons 유지 + err.attempts 이력", async () => {
    stubFetch([okJson(BAD_LABEL), okJson(BAD_LABEL)]);
    await assert.rejects(
      () => resolve(PROVIDER, "설정 열기", SIG),
      (err) => {
        assert.equal(err.message, "guard_fail");
        assert.ok(err.reasons.some((r) => r.includes("unobserved_label")), "err.reasons 는 기존 계약");
        assert.equal(err.attempts.length, 2);
        assert.deepEqual(err.attempts[0].reasons, err.reasons);
        return true;
      },
    );
  });

  it("attempts 는 guard 결과의 복사본이다(attempts 를 바꿔도 err.reasons 불변)", async () => {
    stubFetch([okJson(BAD_LABEL), okJson(BAD_LABEL)]);
    await assert.rejects(
      () => resolve(PROVIDER, "설정 열기", SIG),
      (err) => {
        const before = [...err.reasons];
        err.attempts[1].reasons.push("mutated");
        assert.deepEqual(err.reasons, before);
        return true;
      },
    );
  });

  it("HTTP 오류(429): 현재 동작대로 한 번 재시도 후 던지고 attempts 2건", async () => {
    stubFetch([{ ok: false, status: 429 }, { ok: false, status: 429 }]);
    await assert.rejects(
      () => resolve(PROVIDER, "설정 열기", SIG),
      (err) => {
        assert.equal(err.status, 429);
        assert.equal(err.attempts.length, 2);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });
});
