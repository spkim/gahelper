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
