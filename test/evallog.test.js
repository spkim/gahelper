import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers/chrome-storage-mock.js";
import { installWebLocksMock, uninstallWebLocksMock } from "./helpers/web-locks-mock.js";

const mock = installChromeMock();
const E = await import("../lib/evallog.js");

const created = (tabId = 1, extra = {}) => ({ type: "session_created", tabId, recipeId: "r1", goalIdx: 0, ts: 1000, ...extra });
const evt = (type, tabId = 1, extra = {}) => ({ type, tabId, recipeId: "r1", goalIdx: 0, ts: 2000, ...extra });
const runKeys = () => Object.keys(mock.local.dump()).filter((k) => k.startsWith("sc.evallog.run."));
const readRun = () => mock.local.dump()[runKeys()[0]];

beforeEach(() => {
  mock.reset();
  uninstallWebLocksMock();
});
after(() => uninstallWebLocksMock());

describe("pure helpers", () => {
  it("classifyProcedure", () => {
    const nav = { target: { by: "linkText", text: "a" }, verify: { is: "urlIncludes", value: "/x" } };
    const act = { target: { by: "role", name: "b" }, verify: { is: "textVisible", value: "z" } };
    assert.equal(E.classifyProcedure({ steps: [nav, nav] }), "nav_only");
    assert.equal(E.classifyProcedure({ steps: [act] }), "action");
    assert.equal(E.classifyProcedure({ steps: [nav, act] }), "mixed");
    assert.equal(E.classifyProcedure({ steps: [] }), "empty");
    assert.equal(E.classifyProcedure(null), "empty");
  });

  it("extractReasonCode", () => {
    assert.equal(E.extractReasonCode("step0:unobserved_label:Account: sk-ant-secret"), "unobserved_label");
    assert.equal(E.extractReasonCode("step2:target:unobserved_locator"), "unobserved_locator");
    assert.equal(E.extractReasonCode("step1:verify.probe:unobserved:foo"), "unobserved");
    assert.equal(E.extractReasonCode("json_parse_error"), "json_parse_error");
    assert.equal(E.extractReasonCode("something sk-ant-xyz"), "unknown");
    assert.equal(E.extractReasonCode(42), "unknown");
  });

  it("effectiveStatus", () => {
    assert.equal(E.effectiveStatus({ status: "in_progress" }, { finalOutcome: "crashOrHang" }), "crashOrHang");
    assert.equal(E.effectiveStatus({ status: "completed" }, null), "completed");
    assert.equal(E.effectiveStatus(null, null), null);
  });

  it("findAbandoned", () => {
    const runs = [
      { runId: "a", tabId: 1, status: "in_progress" },
      { runId: "b", tabId: 2, status: "in_progress" },
      { runId: "c", tabId: 3, status: "in_progress" },
      { runId: "d", tabId: 1, status: "completed" },
    ];
    assert.deepEqual(E.findAbandoned(runs, [1, 3], { 1: "a", 3: "other" }), ["b", "c"]);
  });
});

describe("coded rounds", () => {
  const obs = { q1: 1, q2: { choice: "keep", reasonCode: "tedious", quote: "" }, q3: false };
  it("isCodedObservation requires q1, q2.choice and q3", () => {
    assert.equal(E.isCodedObservation(obs), true);
    assert.equal(E.isCodedObservation({ ...obs, q1: null }), false);
    assert.equal(E.isCodedObservation({ ...obs, q2: { choice: null } }), false);
    assert.equal(E.isCodedObservation({ ...obs, q3: null }), false);
    assert.equal(E.isCodedObservation(undefined), false);
  });

  it("summarizeParticipants groups by round and participant, nondev planned 2", () => {
    const row = (participantId, evalRound, tester, o) => ({ run: { participantId, evalRound, tester }, obs: o });
    const out = E.summarizeParticipants([
      row("P1", 1, "nondev", obs),
      row("P1", 1, "nondev", null),
      row("P1", 2, "nondev", obs),
      row("dev", 1, "dev", obs),
    ]);
    assert.deepEqual(out.map((g) => [g.evalRound, g.participantId, g.runs, g.coded, g.plannedRuns]), [
      [1, "dev", 1, 1, null],
      [1, "P1", 2, 1, 2],
      [2, "P1", 1, 1, 2],
    ]);
  });
});

describe("event lifecycle", () => {
  it("created → goal_done(done) → completed, active mapping kept until cleared", async () => {
    await E.onRecipeEvent(created());
    const active = mock.session.dump()["sc.evallog.active"];
    assert.ok(active["1"]);
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    const run = readRun();
    assert.equal(run.status, "completed");
    assert.equal(run.goals[0].result, "done");
    assert.equal(run.events.map((e) => e.seq).join(), "1,2");
    await E.onRecipeEvent(evt("session_cleared", 1, { status: "done" }));
    assert.equal(readRun().status, "completed");
    assert.deepEqual(mock.session.dump()["sc.evallog.active"], {});
  });

  it("session_cleared before done → abandoned(cleared)", async () => {
    await E.onRecipeEvent(created());
    await E.onRecipeEvent(evt("session_cleared", 1, { status: "running" }));
    const run = readRun();
    assert.equal(run.status, "abandoned");
    assert.equal(run.endCause, "cleared");
  });

  it("new session on same tab abandons the previous run (replaced)", async () => {
    await E.onRecipeEvent(created());
    await E.onRecipeEvent(created(1, { ts: 3000 }));
    const runs = Object.values(mock.local.dump()).filter((v) => v?.runId);
    assert.equal(runs.length, 2);
    assert.deepEqual(runs.map((r) => r.status).sort(), ["abandoned", "in_progress"]);
    assert.equal(runs.find((r) => r.status === "abandoned").endCause, "replaced");
  });

  it("skipped, blocked, paused update goals and counters", async () => {
    await E.onRecipeEvent(created());
    await E.onRecipeEvent(evt("goal_blocked"));
    await E.onRecipeEvent(evt("paused"));
    await E.onRecipeEvent(evt("resumed"));
    await E.onRecipeEvent(evt("goal_skipped", 1, { status: "running" }));
    const run = readRun();
    assert.equal(run.goals[0].result, "skipped_optional");
    assert.equal(run.popupPauses, 1);
    assert.equal(run.currentGoalIdx, 1);
  });

  it("unmatched event is counted, never throws", async () => {
    await E.onRecipeEvent(evt("goal_done", 99));
    assert.equal((await E.getHealth()).run.unmatched, 1);
  });

  it("copies config into the run", async () => {
    await E.setConfig({ tester: "dev", participantId: "dev", evalRound: 2 });
    await E.onRecipeEvent(created());
    const run = readRun();
    assert.equal(run.tester, "dev");
    assert.equal(run.participantId, "dev");
    assert.equal(run.evalRound, 2);
  });
});

describe("리뷰 보강: 종결·부착·분류", () => {
  it("종결된 run 에는 늦은 이벤트·resolve·skip 이 기록을 바꾸지 못한다(late 집계)", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    const before = JSON.stringify(readRun());
    await E.onRecipeEvent(evt("goal_blocked", 1));
    await E.recordResolve(1, { resolverMs: 5, attempts: [{ reasons: ["x"] }] });
    await E.recordSkip(1);
    assert.equal(JSON.stringify(readRun()), before);
    assert.equal((await E.getHealth()).run.late, 3);
  });

  it("다른 레시피의 늦은 이벤트는 현재 run 에 붙지 않는다", async () => {
    await E.onRecipeEvent(created());
    await E.onRecipeEvent({ ...evt("goal_done", 1), recipeId: "OTHER" });
    assert.equal(readRun().goals.length, 0);
    assert.equal((await E.getHealth()).run.unmatched, 1);
  });

  it("done 으로 정리됐는데 완료 이벤트를 잃은 run 은 completed 로 닫는다", async () => {
    await E.onRecipeEvent(created());
    await E.onRecipeEvent(evt("session_cleared", 1, { status: "done" }));
    const run = readRun();
    assert.equal(run.status, "completed");
    assert.equal(run.endCause, "done_on_clear");
  });

  it("session_created 의 goalCount 를 run 에 남긴다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 3 }));
    assert.equal(readRun().goalCount, 3);
  });

  it("recordConfirm 은 저장 여부를 돌려준다", async () => {
    assert.deepEqual(await E.recordConfirm(99, true), { ok: false });
    await E.onRecipeEvent(created());
    assert.deepEqual(await E.recordConfirm(1, true), { ok: true });
    assert.deepEqual(await E.recordConfirm(1, false), { ok: true }); // 중복도 이미 저장된 것
    const realSet = mock.local.set;
    await E.onRecipeEvent(created(2));
    mock.local.set = async () => { throw new Error("quota"); };
    try {
      assert.deepEqual(await E.recordConfirm(2, true), { ok: false });
    } finally {
      mock.local.set = realSet;
    }
  });

  it("blockedCauseFor", () => {
    assert.equal(E.blockedCauseFor({ message: "guard_fail", attempts: [{ reasons: ["a"] }] }), "guard_fail");
    assert.equal(E.blockedCauseFor({ message: "x", attempts: [{ reasons: ["json_parse_error"] }] }), "json_parse_error");
    assert.equal(E.blockedCauseFor({ message: "x", attempts: [{ reasons: ["provider_error"] }] }), "resolve_error");
    assert.equal(E.blockedCauseFor(undefined), "resolve_error");
  });

  it("provider_error 도 알려진 이유 코드다", () => {
    assert.equal(E.extractReasonCode("provider_error"), "provider_error");
  });
});

describe("reconcile 로 닫힌 run 의 관찰자 종결 (D2)", () => {
  async function reconciledRun() {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.markAbandoned([]); // 탭이 열려 있지 않음 → reconcile
    return runKeys()[0].slice("sc.evallog.run.".length);
  }

  it("reconcile 로 abandoned 된 run 은 crashOrHang 으로 종결할 수 있고 효과 상태가 바뀐다", async () => {
    const id = await reconciledRun();
    assert.equal(readRun().endCause, "reconcile");
    const f = await E.finalizeRun(id, "crashOrHang");
    assert.equal(f.ok, true);
    const [row] = await E.listRuns();
    assert.equal(row.effectiveStatus, "crashOrHang");
    assert.equal(readRun().status, "abandoned", "run 키는 바뀌지 않는다");
    assert.equal((await E.finalizeRun(id, "abandoned")).reason, "already_finalized", "한 번만");
  });

  it("탭을 닫거나 다시 시작해 cleared 로 닫힌 run 도 한 번 crashOrHang 으로 덮을 수 있다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.onRecipeEvent(evt("session_cleared", 1, { status: "running" })); // cleared
    const id = runKeys()[0].slice("sc.evallog.run.".length);
    assert.equal(readRun().endCause, "cleared");
    assert.equal((await E.finalizeRun(id, "crashOrHang")).ok, true);
    assert.equal((await E.listRuns())[0].effectiveStatus, "crashOrHang");
    assert.equal((await E.finalizeRun(id, "abandoned")).reason, "already_finalized");
  });

  it("정상 완료·rejected 로 닫힌 run 은 여전히 종결할 수 없다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    const id = runKeys()[0].slice("sc.evallog.run.".length);
    assert.equal((await E.finalizeRun(id, "crashOrHang")).reason, "already_terminal");
  });
});

describe("2차 리뷰 보강", () => {
  const idOf = () => runKeys()[0].slice("sc.evallog.run.".length);

  it("관찰자가 종결한 run 에는 러너의 늦은 기록이 들어오지 않는다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    const id = idOf();
    await E.finalizeRun(id, "crashOrHang");
    const before = JSON.stringify(readRun());
    await E.recordSkip(1);
    await E.recordResolve(1, { resolverMs: 9, attempts: [{ reasons: ["x"] }] });
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    assert.equal(JSON.stringify(readRun()), before);
    assert.equal((await E.getHealth()).run.late, 3);
  });

  it("매핑이 이미 없는 session_cleared 는 손실(unmatched)이 아니라 late 다", async () => {
    await E.onRecipeEvent(created());
    await E.markAbandoned([]); // 탭 없음: 매핑 정리
    await E.onRecipeEvent(evt("session_cleared", 1, { status: "running" }));
    const h = (await E.getHealth()).run;
    assert.equal(h.unmatched ?? 0, 0);
    assert.equal(h.late, 1);
  });

  it("종결된 run 의 session_cleared 는 매핑만 지우고 이벤트를 덧붙이지 않는다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    const n = readRun().events.length;
    await E.onRecipeEvent(evt("session_cleared", 1, { status: "done" }));
    assert.equal(readRun().events.length, n);
    assert.equal(readRun().endCause, "done");
    assert.deepEqual(mock.session.dump()["sc.evallog.active"], {});
  });

  it("saveObservation: 읽은 뒤 다른 곳에서 먼저 저장됐으면 stale 로 거부한다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    const id = idOf();
    assert.equal((await E.saveObservation(id, { secretSentToLlm: true }, { expectedRevision: 0 })).ok, true);
    const stale = await E.saveObservation(id, { secretSentToLlm: false }, { expectedRevision: 0 });
    assert.equal(stale.reason, "stale");
    assert.equal(stale.revision, 1);
    assert.equal(mock.local.dump()[`sc.evallog.obs.${id}`].secretSentToLlm, true, "안전 위반 기록이 덮이지 않는다");
    assert.equal((await E.saveObservation(id, { q1: 1 }, { expectedRevision: 1 })).ok, true);
    assert.equal((await E.saveObservation(id, { q1: 2 })).ok, true, "expectedRevision 없으면 기존 동작");
  });

  it("setConfig: 문자열이 아닌 참가자 ID 와 tester 짝 불일치를 거부한다", async () => {
    assert.equal((await E.setConfig({ participantId: ["P1"] })).reason, "invalid_participant");
    assert.equal((await E.setConfig({ tester: "nondev", participantId: "dev" })).reason, "tester_mismatch");
    assert.equal((await E.setConfig({ tester: "dev", participantId: "P1" })).reason, "tester_mismatch");
    assert.equal((await E.setConfig({ tester: "dev", participantId: "dev" })).ok, true);
  });

  it("관찰자가 종결한 run 의 session_cleared 는 탭 매핑을 지운다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.finalizeRun(idOf(), "crashOrHang");
    await E.onRecipeEvent(evt("session_cleared", 1, { status: "running" }));
    assert.deepEqual(mock.session.dump()["sc.evallog.active"], {});
    const n = readRun().events.length;
    await E.markAbandoned([1]); // 매핑이 없으니 열려 있는 탭이어도 reconcile 대상(이벤트 1건 추가)
    assert.ok(readRun().events.length >= n);
  });

  it("clearAll 은 메모리에 남은 손실 카운트도 비운다", async () => {
    await E.onRecipeEvent(created());
    const realSet = mock.local.set;
    mock.local.set = async () => { throw new Error("quota"); };
    try { await E.recordSkip(1); } finally { mock.local.set = realSet; }
    assert.equal((await E.getHealth()).run.failed, 1);
    await E.clearAll();
    assert.deepEqual((await E.getHealth()).run, {});
    await E.onRecipeEvent(created(2));
    assert.deepEqual((await E.getHealth()).run, {}, "삭제 뒤 되살아나지 않는다");
  });

  it("exportAll 은 run·관찰·건강 상태를 한 번에 읽는다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    await E.onRecipeEvent(evt("goal_done", 99)); // unmatched +1
    const out = await E.exportAll();
    assert.equal(out.runs.length, 1);
    assert.equal(out.health.run.unmatched, 1);
  });

  it("blockedCauseFor 는 err.code 를 우선한다", () => {
    assert.equal(E.blockedCauseFor({ code: "guard_fail", message: "다른 문구" }), "guard_fail");
  });

  it("recordConfirm 은 완료된 run 에서도 저장된다", async () => {
    await E.onRecipeEvent(created(1, { goalCount: 1 }));
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    assert.deepEqual(await E.recordConfirm(1, true), { ok: true });
    assert.equal(readRun().userConfirmedReal, true);
  });

  it("recordResolve: 알 수 없는 blockedCause 는 unknown", async () => {
    await E.onRecipeEvent(created());
    await E.recordResolve(1, { blockedCause: "bogus" });
    assert.equal(readRun().goals[0].blockedCause, "unknown");
  });

  it("finalizeRun: endCause 별로 종결 가능 여부를 가른다", async () => {
    for (const [cause, status, ok] of [["reconcile", "abandoned", true], ["replaced", "abandoned", true], ["cleared", "abandoned", true], ["done", "completed", false], ["done_on_clear", "completed", false]]) {
      mock.reset();
      mock.local.seed({ "sc.evallog.run.x": { runId: "x", status, endCause: cause, goals: [], events: [], tabId: 1 } });
      assert.equal((await E.finalizeRun("x", "crashOrHang")).ok, ok, cause);
    }
  });
});

describe("recording", () => {
  it("recordResolve stores codes only, never label text or secrets", async () => {
    await E.onRecipeEvent(created());
    await E.recordResolve(1, {
      resolverMs: 812.4,
      attempts: [{ reasons: ["step0:unobserved_label:내 키 sk-ant-abcdefghijklmnop"] }, { reasons: [] }],
      procedure: { steps: [{ target: { by: "linkText", text: "비밀" }, verify: { is: "urlIncludes", value: "/a" } }] },
      blockedCause: "weird",
    });
    const run = readRun();
    const g = run.goals[0];
    assert.equal(g.screens, 1);
    assert.deepEqual(g.resolverMs, [812]);
    assert.equal(g.attempts, 2);
    assert.deepEqual(g.guardRejects, ["unobserved_label"]);
    assert.equal(g.procedureKind, "nav_only");
    assert.equal(g.blockedCause, "unknown");
    const dumped = JSON.stringify(await E.exportAll());
    assert.ok(!dumped.includes("sk-ant"));
    assert.ok(!dumped.includes("비밀"));
  });

  it("recordSkip persists across a fresh module instance, seq continues", async () => {
    await E.onRecipeEvent(created());
    await E.recordSkip(1, { stepIdx: 0 });
    const E2 = await import("../lib/evallog.js?second");
    await E2.recordSkip(1, { stepIdx: 1 });
    const run = readRun();
    assert.equal(run.skippedSteps, 2);
    assert.equal(run.goals[0].skippedSteps, 2);
    assert.deepEqual(run.events.map((e) => e.seq), [1, 2, 3]);
  });

  it("recordConfirm keeps the first answer, counts dup", async () => {
    await E.onRecipeEvent(created());
    await E.recordConfirm(1, true);
    await E.recordConfirm(1, false);
    assert.equal(readRun().userConfirmedReal, true);
    assert.equal((await E.getHealth()).run.dup, 1);
  });
});

describe("concurrency", () => {
  it("fallback queue keeps 30 concurrent events with unique seq", async () => {
    await E.onRecipeEvent(created());
    await Promise.all(Array.from({ length: 30 }, () => E.recordSkip(1)));
    const run = readRun();
    assert.equal(run.skippedSteps, 30);
    assert.equal(new Set(run.events.map((e) => e.seq)).size, 31);
  });

  it("two module instances share the named lock (60 events kept)", async () => {
    installWebLocksMock();
    const E2 = await import("../lib/evallog.js?locks2");
    await E.onRecipeEvent(created());
    await Promise.all([
      ...Array.from({ length: 30 }, () => E.recordSkip(1)),
      ...Array.from({ length: 30 }, () => E2.recordSkip(1)),
    ]);
    const run = readRun();
    assert.equal(run.skippedSteps, 60);
    assert.equal(new Set(run.events.map((e) => e.seq)).size, 61);
  });
});

describe("observer side", () => {
  async function finishedRun() {
    await E.onRecipeEvent(created());
    await E.onRecipeEvent(evt("goal_done", 1, { status: "done" }));
    return Object.keys(mock.local.dump()).find((k) => k.startsWith("sc.evallog.run.")).slice("sc.evallog.run.".length);
  }

  it("saveObservation rejects in_progress", async () => {
    await E.onRecipeEvent(created());
    const id = runKeys()[0].slice("sc.evallog.run.".length);
    assert.equal((await E.saveObservation(id, { q1: 1 })).reason, "in_progress");
  });

  it("saveObservation: revision++, run key untouched, unknown fields dropped, secrets scrubbed", async () => {
    const id = await finishedRun();
    const before = JSON.stringify(readRun());
    const r1 = await E.saveObservation(id, { q1: 2, q2: { choice: "keep", reasonCode: "tedious", quote: "key sk-ant-abcdefghijklmnop" }, evil: 1 });
    assert.equal(r1.ok, true);
    assert.equal(r1.obs.revision, 1);
    assert.ok(!("evil" in r1.obs));
    assert.ok(!r1.obs.q2.quote.includes("sk-ant-abcdefghijklmnop"));
    const r2 = await E.saveObservation(id, { q3: true });
    assert.equal(r2.obs.revision, 2);
    assert.equal(r2.obs.q1, 2);
    assert.equal(JSON.stringify(readRun()), before);
  });

  it("saveObservation stores safety fields and rejects non-tri values", async () => {
    const id = await finishedRun();
    const ok = await E.saveObservation(id, { secretSentToLlm: false, oauthResumeOk: null, payloadSentToLlm: true });
    assert.equal(ok.obs.secretSentToLlm, false);
    assert.equal(ok.obs.payloadSentToLlm, true);
    assert.equal((await E.saveObservation(id, { secretSentToLlm: "no" })).field, "secretSentToLlm");
  });

  it("saveObservation rejects invalid fields", async () => {
    const id = await finishedRun();
    assert.equal((await E.saveObservation(id, { q1: 7 })).field, "q1");
    assert.equal((await E.saveObservation(id, { audit: { badge: "x" } })).field, "audit.badge");
    assert.equal((await E.saveObservation("nope", {})).reason, "run_not_found");
  });

  it("finalizeRun: only in_progress, irreversible, sets effective status, flags post-finalize events", async () => {
    await E.onRecipeEvent(created());
    const id = runKeys()[0].slice("sc.evallog.run.".length);
    assert.equal((await E.finalizeRun(id, "completed")).reason, "bad_outcome");
    const f = await E.finalizeRun(id, "crashOrHang");
    assert.equal(f.ok, true);
    assert.equal((await E.finalizeRun(id, "abandoned")).reason, "already_finalized");
    assert.equal(readRun().status, "in_progress");
    await E.recordSkip(1);
    const [row] = await E.listRuns();
    assert.equal(row.effectiveStatus, "crashOrHang");
    assert.ok(row.postFinalizeEvents >= 0);
    const done = await finishedRunOther();
    assert.equal((await E.finalizeRun(done, "abandoned")).reason, "already_terminal");
  });

  async function finishedRunOther() {
    await E.onRecipeEvent(created(5));
    await E.onRecipeEvent(evt("goal_done", 5, { status: "done" }));
    const k = Object.entries(mock.local.dump()).find(([, v]) => v?.tabId === 5)[0];
    return k.slice("sc.evallog.run.".length);
  }

  it("markAbandoned reconciles closed tabs and prunes active map", async () => {
    await E.onRecipeEvent(created(1));
    await E.onRecipeEvent(created(2));
    const dead = await E.markAbandoned([2]);
    assert.equal(dead.length, 1);
    const runs = Object.values(mock.local.dump()).filter((v) => v?.runId);
    assert.equal(runs.find((r) => r.tabId === 1).status, "abandoned");
    assert.equal(runs.find((r) => r.tabId === 1).endCause, "reconcile");
    assert.equal(runs.find((r) => r.tabId === 2).status, "in_progress");
    assert.deepEqual(Object.keys(mock.session.dump()["sc.evallog.active"]), ["2"]);
  });

  it("setConfig validates", async () => {
    assert.equal((await E.setConfig({ tester: "x" })).reason, "invalid_tester");
    assert.equal((await E.setConfig({ participantId: "P100" })).reason, "invalid_participant");
    assert.equal((await E.setConfig({ evalRound: 0 })).reason, "invalid_round");
    const ok = await E.setConfig({ tester: "nondev", participantId: "P7", evalRound: 3 });
    assert.deepEqual(ok.config, { tester: "nondev", participantId: "P7", evalRound: 3 });
    assert.deepEqual(await E.getConfig(), ok.config);
  });
});

describe("export / clear / failures", () => {
  it("export and clear touch only sc.evallog.* and never sc.settings", async () => {
    mock.local.seed({ "sc.settings": { providers: [{ apiKey: "sk-ant-REALKEY0123456789" }] }, other: 1 });
    await E.onRecipeEvent(created());
    const dump = JSON.stringify(await E.exportAll());
    assert.ok(!dump.includes("REALKEY"));
    const r = await E.clearAll();
    assert.equal(r.ok, true);
    const left = mock.local.dump();
    assert.ok(left["sc.settings"]);
    assert.equal(left.other, 1);
    assert.deepEqual(Object.keys(left).filter((k) => k.startsWith("sc.evallog.")), []);
    assert.equal(mock.session.dump()["sc.evallog.active"], undefined);
  });

  it("write failure: no throw, failed counted in memory, flushed on a later success", async () => {
    await E.onRecipeEvent(created());
    const realSet = mock.local.set;
    mock.local.set = async () => {
      throw new Error("quota");
    };
    await assert.doesNotReject(E.recordSkip(1));
    assert.equal((await E.getHealth()).run.failed, 1);
    mock.local.set = realSet;
    await E.recordSkip(1);
    assert.equal(mock.local.dump()["sc.evallog.stats.run"].failed, 1);
    assert.equal(readRun().skippedSteps, 1);
  });
});
