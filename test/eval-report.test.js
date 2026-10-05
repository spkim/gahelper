import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildReport, evaluateRound, exactCI, percentile, renderReport, matchPlan, PLAN, VERDICT } from "../scripts/eval-report.js";
import { buildExport, goal } from "./helpers/eval-fixture.js";
import { installChromeMock } from "./helpers/chrome-storage-mock.js";

const final = (exp) => buildReport(exp).final;
const isMain = (slot) => ["R01", "R02", "R03", "R04", "R05", "R06"].includes(slot.recipeId);

describe("통계", () => {
  it("exactCI 는 문서의 구간과 일치한다", () => {
    const near = (a, b) => assert.ok(Math.abs(a - b) < 0.0015, `${a} vs ${b}`);
    let [lo, hi] = exactCI(8, 16); near(lo, 0.247); near(hi, 0.753);
    [lo, hi] = exactCI(3, 5); near(lo, 0.147); near(hi, 0.947);
    [lo, hi] = exactCI(4, 5); near(lo, 0.284); near(hi, 0.995);
    assert.deepEqual(exactCI(0, 5).map((x) => +x.toFixed(3)), [0, 0.522]);
    assert.equal(exactCI(0, 0), null);
  });
  it("percentile", () => {
    assert.equal(percentile([], 0.5), null);
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  });
});

describe("명단", () => {
  it("계획 명단은 20회(dev 10 + nondev 10)", () => {
    assert.equal(PLAN.length, 20);
    assert.equal(PLAN.filter((s) => s.tester === "dev").length, 10);
  });
});

describe("판정", () => {
  it("모든 조건을 만족하면 PROCEED_B", () => {
    const r = final(buildExport());
    assert.equal(r.verdict, VERDICT.PROCEED_B, r.reason);
    assert.equal(r.problems.length, 0);
    assert.equal(r.info.complete.k, 16);
  });

  it("기록이 없는 계획 run → INCOMPLETE (피벗 조건이 성립해도 판정하지 않음)", () => {
    const exp = buildExport((slot) => (isMain(slot) ? { goals: [goal(0, "blocked")], status: "abandoned" } : undefined));
    exp.runs.pop();
    const r = final(exp);
    assert.equal(r.verdict, VERDICT.INCOMPLETE);
    assert.match(r.problems.join("\n"), /기록 없음: P5 R04/);
  });

  it("in_progress 가 남으면 INCOMPLETE, 관찰자 종결(효과 상태)이면 판정한다", () => {
    const open = buildExport((slot) => (slot.participantId === "P5" && slot.recipeId === "R04" ? { status: "in_progress" } : undefined));
    assert.equal(final(open).verdict, VERDICT.INCOMPLETE);
    const closed = buildExport((slot) => (slot.participantId === "P5" && slot.recipeId === "R04"
      ? { status: "in_progress", obs: { finalOutcome: "crashOrHang" } } : undefined));
    const r = final(closed);
    assert.notEqual(r.verdict, VERDICT.INCOMPLETE);
    assert.equal(r.conditions.c4.met, false);
  });

  it("명단에 없는 기록과 중복 기록은 INCOMPLETE", () => {
    const extra = buildExport();
    extra.runs.push({ ...extra.runs[0], runId: "dup" });
    assert.equal(final(extra).verdict, VERDICT.INCOMPLETE);
    assert.match(final(extra).problems.join("\n"), /중복 기록/);
    const unplanned = buildExport();
    unplanned.runs[0].run.participantId = "P9";
    assert.match(final(unplanned).problems.join("\n"), /명단에 없는 기록/);
  });

  it("goal 단위 완주율 30% 미만 → PIVOT", () => {
    const exp = buildExport((slot) => (isMain(slot) ? { goals: [goal(0), goal(1, "blocked"), goal(2, "blocked"), goal(3, "blocked"), goal(4, "blocked")], status: "abandoned" } : undefined));
    const r = final(exp);
    assert.equal(r.verdict, VERDICT.PIVOT);
    assert.equal(r.pivot.goalLevelBelow30, true);
  });

  it("nondev 4명 이상이 맡김+귀찮음(두 회차 모두) → PIVOT, B 조건 충족해도 피벗 우선", () => {
    const tedious = { q2: { choice: "delegate", reasonCode: "tedious", quote: "" }, q1: 2, q3: true };
    const exp = buildExport((slot) => (["P1", "P2", "P3", "P4"].includes(slot.participantId) ? { obs: tedious } : undefined));
    const r = final(exp);
    assert.equal(r.verdict, VERDICT.PIVOT);
    assert.equal(r.pivot.pivotCount, 4);
  });

  it("한 회차만 맡김+귀찮음이면 그 참가자는 세지 않는다(R9)", () => {
    const tedious = { q2: { choice: "delegate", reasonCode: "tedious", quote: "" }, q1: 2, q3: true };
    let n = 0;
    const exp = buildExport((slot) => (["P1", "P2", "P3", "P4"].includes(slot.participantId) && n++ % 2 === 0 ? { obs: tedious } : undefined));
    assert.notEqual(final(exp).verdict, VERDICT.PIVOT);
  });

  it("완주율 50% 미만이면 REOBSERVE (피벗 기준 30%에는 못 미치지 않을 때)", () => {
    let k = 0;
    const exp = buildExport((slot) => {
      if (!isMain(slot)) return undefined;
      return k++ < 9 ? { goals: [goal(0), goal(1, "blocked")], status: "abandoned" } : undefined;
    });
    const r = final(exp);
    assert.equal(r.verdict, VERDICT.REOBSERVE, r.reason);
    assert.equal(r.conditions.c1.met, false);
    assert.equal(r.pivot.goalLevelBelow30, false);
  });

  it("수동 진행(skipped)이 있으면 완주가 아니다", () => {
    const exp = buildExport((slot) => (slot.recipeId === "R01" ? { goals: [goal(0, "done", { skippedSteps: 1 }), goal(1)] } : undefined));
    exp.runs.forEach((r) => { if (r.run.recipeId === "R01") r.run.skippedSteps = 1; });
    const r = final(exp);
    assert.equal(r.info.complete.k, 13); // R01 은 dev·P1·P4 3회
  });

  it("허위 완주 2건 이상이면 조건 2 미충족, 1건은 허용", () => {
    const f = (n) => { let c = 0; return buildExport((slot) => (isMain(slot) && c++ < n ? { obs: { observerVerified: false } } : undefined)); };
    assert.equal(final(f(1)).conditions.c2.met, true);
    assert.equal(final(f(2)).conditions.c2.met, false);
    assert.equal(final(f(2)).verdict, VERDICT.REOBSERVE);
  });

  it("observerVerified 미확인은 조건 2 미충족", () => {
    const exp = buildExport((slot) => (slot.recipeId === "R01" && slot.tester === "dev" ? { obs: { observerVerified: null } } : undefined));
    const r = final(exp);
    assert.equal(r.conditions.c2.met, false);
    assert.match(r.conditions.c2.detail, /미확인 1/);
  });

  it("안전 항목: 비밀값 전송, OAuth 실패, payload 포함, 미확인은 모두 조건 3 미충족", () => {
    const c3 = (recipeId, obs) => final(buildExport((slot) => (slot.recipeId === recipeId && slot.tester === "dev" ? { obs } : undefined))).conditions.c3.met;
    assert.equal(c3("R06", { secretSentToLlm: true }), false);
    assert.equal(c3("R08", { secretSentToLlm: null }), false);
    assert.equal(c3("R07", { oauthResumeOk: false }), false);
    assert.equal(c3("R09", { oauthResumeOk: null }), false);
    assert.equal(c3("R10", { payloadSentToLlm: true }), false);
    assert.equal(c3("R01", {}), true);
  });

  it("관측되지 않은 라벨 노출 또는 감사 미코딩은 조건 4 미충족", () => {
    const exposed = buildExport((slot) => (slot.recipeId === "R02" && slot.tester === "dev" ? { obs: { audit: { instruct: false, goalLabel: true, recoverText: false, badge: false, onFail: false } } } : undefined));
    assert.equal(final(exposed).conditions.c4.met, false);
    const uncoded = buildExport((slot) => (slot.recipeId === "R02" && slot.tester === "dev" ? { obs: { audit: { instruct: false } } } : undefined));
    assert.equal(final(uncoded).conditions.c4.met, false);
    assert.match(final(uncoded).conditions.c4.detail, /감사 미코딩 1/);
  });

  it("조건 5: 코드가 없는 회차가 있으면 그 참가자는 미충족, 3명이면 충족", () => {
    const weak = (pids) => buildExport((slot) => (pids.includes(slot.participantId)
      ? { obs: { q2: { choice: "delegate", reasonCode: "learn", quote: "" }, q3: false, q1: 0 } } : undefined));
    assert.equal(final(weak(["P1", "P2"])).conditions.c5.met, true);
    assert.equal(final(weak(["P1", "P2", "P3"])).conditions.c5.met, false);
    const uncodedOne = buildExport((slot) => (slot.participantId === "P1" && slot.recipeId === "R01" ? { obs: { q1: null } } : undefined));
    const p1 = final(uncodedOne).participants.find((p) => p.participantId === "P1");
    assert.equal(p1.coded, 1);
    assert.equal(p1.selfReliant, false);
  });

  it("'혼자 할 수 있음'은 Q1 이 1 이상일 때만 세어진다", () => {
    const exp = buildExport((slot) => (["P1", "P2", "P3"].includes(slot.participantId)
      ? { obs: { q2: { choice: "delegate", reasonCode: "learn", quote: "" }, q3: true, q1: 0 } } : undefined));
    assert.equal(final(exp).participants.filter((p) => p.selfReliant).length, 2);
  });
});

describe("라운드", () => {
  it("라운드별로 따로 판정하고 마지막 라운드가 최종이다(풀링 없음)", () => {
    const r1 = buildExport((slot) => (slot.recipeId === "R01" && slot.tester === "dev" ? { obs: { observerVerified: null } } : undefined), 1);
    const r2 = buildExport(undefined, 2);
    const report = buildReport({ ...r1, runs: [...r1.runs, ...r2.runs] });
    assert.deepEqual(report.rounds.map((r) => r.evalRound), [1, 2]);
    assert.equal(report.rounds[0].verdict, VERDICT.REOBSERVE);
    assert.equal(report.final.verdict, VERDICT.PROCEED_B);
    assert.equal(report.final.evalRound, 2);
  });
});

describe("보고 항목", () => {
  it("nav_only 와 허위 완주 겹침, postFinalizeEvents, 불일치, p50 을 보고한다", () => {
    const exp = buildExport((slot) => (slot.recipeId === "R01" && slot.tester === "dev"
      ? { goals: [goal(0, "done", { procedureKind: "nav_only", resolverMs: [9000] }), goal(1)], obs: { observerVerified: false } } : undefined));
    exp.runs[0].postFinalizeEvents = 3;
    const r = final(exp);
    assert.equal(r.info.navOnlyRuns, 1);
    assert.equal(r.info.navOnlyAndFalse, 1);
    assert.equal(r.info.falseCompletions, 1);
    assert.equal(r.info.mismatches, 1);
    assert.equal(r.info.postFinalizeEvents, 3);
    assert.equal(r.info.resolverP50, 1500);
  });

  it("renderReport 는 판정 하나와 신뢰구간을 낸다", () => {
    const text = renderReport(buildReport(buildExport()));
    assert.match(text, /\*\*PROCEED_B\*\*/);
    assert.match(text, /95% 구간/);
    assert.match(text, /nondev 하위 합계/);
    assert.equal((text.match(/\*\*(INCOMPLETE|PIVOT|PROCEED_B|REOBSERVE)\*\*/g) ?? []).length, 1);
  });

  it("matchPlan 은 종결 상태가 아닌 run 을 모은다", () => {
    const exp = buildExport((slot, i) => (i === 0 ? { status: "in_progress" } : undefined));
    assert.equal(matchPlan(exp.runs).inProgress.length, 1);
  });
});

describe("CLI", () => {
  it("파일을 읽어 리포트를 출력한다", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evalrep-"));
    const file = path.join(dir, "export.json");
    fs.writeFileSync(file, JSON.stringify(buildExport()));
    const out = execFileSync("node", ["scripts/eval-report.js", file], { encoding: "utf8" });
    assert.match(out, /PROCEED_B/);
    const json = JSON.parse(execFileSync("node", ["scripts/eval-report.js", file, "--json"], { encoding: "utf8" }));
    assert.equal(json.final.verdict, "PROCEED_B");
  });
  it("인자나 파일이 없으면 비정상 종료한다", () => {
    assert.throws(() => execFileSync("node", ["scripts/eval-report.js"], { stdio: "pipe" }));
    assert.throws(() => execFileSync("node", ["scripts/eval-report.js", "/nonexistent.json"], { stdio: "pipe" }));
  });
});

describe("evallog 내보내기와의 연결", () => {
  it("exportAll() 결과를 그대로 읽는다(한 run 뿐이므로 INCOMPLETE)", async () => {
    installChromeMock();
    const ev = await import("../lib/evallog.js");
    await ev.setConfig({ tester: "nondev", participantId: "P1", evalRound: 1 });
    const e = (type, x = {}) => ({ type, tabId: 7, recipeId: "R01", goalIdx: 0, ts: 5, ...x });
    await ev.onRecipeEvent(e("session_created"));
    await ev.onRecipeEvent(e("goal_done", { status: "done" }));
    const report = buildReport(await ev.exportAll());
    assert.equal(report.final.verdict, VERDICT.INCOMPLETE);
    assert.equal(report.final.info.complete.k, 1);
    assert.match(report.final.problems.join("\n"), /기록 없음: dev R01/);
  });
});
