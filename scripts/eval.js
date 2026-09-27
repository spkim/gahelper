#!/usr/bin/env node
// Phase A 회귀 테스트 하네스.
// 사용: node scripts/eval.js [--fixture fixtures/tistory.json] [--dry-run]
//
// 환경 변수:
//   ANTHROPIC_API_KEY  또는  OPENAI_API_KEY
//   MODEL              (선택, 기본 claude-haiku-4-5-20251001 or gpt-4o-mini)
//
// node 용 stub — chrome.* API 를 polyfill 해서 lib/resolver, lib/guard 를 직접 실행.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── chrome.* polyfill ───────────────────────────────────────────────────────
// providers.js 의 fetch 호출은 실제 실행. guard/signature/resolver 는 DOM 없이 동작.
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
// Node 18+ 에서 globalThis.crypto 는 읽기 전용이므로 할당하지 않는다.

// ─── 인자 파싱 ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fixtureArg = (() => {
  const i = args.indexOf("--fixture");
  return i >= 0 ? args[i + 1] : null;
})();

// ─── 공급자 설정 ─────────────────────────────────────────────────────────────
function makeProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      kind: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.MODEL ?? "claude-haiku-4-5-20251001",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      kind: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.MODEL ?? "gpt-4o-mini",
    };
  }
  return null;
}

// ─── 합성 signature 빌드 ─────────────────────────────────────────────────────
// v1 fixture 의 probes/steps 에서 텍스트를 추출해 DomSignature 노드로 변환.
// 실제 DOM 관측이 아니므로 eval 전용으로만 사용한다.
function buildSyntheticSignature(procedure) {
  const seen = new Set();
  const out = [];

  function addNode(tag, text) {
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push({ tag, text, nearLabels: [] });
  }

  // probes 의 locator text
  for (const locator of Object.values(procedure.probes ?? {})) {
    if (!locator || !locator.text) continue;
    const tag = locator.by === "linkText" ? "a"
               : locator.by === "buttonText" ? "button"
               : locator.by === "labelText" ? "label"
               : "span";
    addNode(tag, locator.text);
  }

  // steps 의 locate → probes key → text
  for (const step of procedure.steps ?? []) {
    if (step.locate && procedure.probes?.[step.locate]?.text) {
      const loc = procedure.probes[step.locate];
      const tag = loc.by === "linkText" ? "a" : loc.by === "buttonText" ? "button" : "span";
      addNode(tag, loc.text);
    }
    // instruct 에서 따온표 텍스트도 signature 에 포함 (guard 통과 지원).
    const quoted = step.instruct?.match(/'([^']+)'/g) ?? [];
    for (const q of quoted) {
      addNode("span", q.slice(1, -1));
    }
  }

  return out;
}

// ─── step 상세 출력 ───────────────────────────────────────────────────────────
function printStepDetails(steps) {
  for (const [i, s] of steps.entries()) {
    const labels = s.usedLabels;
    const isArr = Array.isArray(labels);
    const count = isArr ? labels.length : -1;
    const labelsStr = isArr
      ? (labels.length ? labels.map((l) => `"${l}"`).join(", ") : "없음")
      : "필드누락(검사불가)";
    const countStr = count >= 0 ? `${count}항목` : "불가";
    console.log(`      step${i} [검사 ${countStr}] "${s.instruct}" | usedLabels=[${labelsStr}]`);
  }
}

// ─── p50 계산 ─────────────────────────────────────────────────────────────────
function p50(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ─── 라벨 따옴표 규약 체크 ────────────────────────────────────────────────────
// SYSTEM 프롬프트 규칙: 화면 라벨은 따온표('...' 또는 "...")로 감싸야 함.
// target.text 가 instruct 에 따옴표 없이 노출된 step 수를 센다.
function checkQuoteConformance(steps) {
  let total = 0, quoted = 0, violations = [];
  for (const s of steps ?? []) {
    const text = s.target?.text;
    if (!text) continue;
    total++;
    const hasQuote = s.instruct?.includes(`'${text}'`) || s.instruct?.includes(`"${text}"`);
    if (hasQuote) { quoted++; }
    else { violations.push(text); }
  }
  return { total, quoted, violations };
}

// ─── step 일치 측정 ──────────────────────────────────────────────────────────
function scoreSteps(expected, generated) {
  if (!generated?.length) return { matchRate: 0, extra: 0, missing: expected.length };
  // 간단한 휴리스틱: instruct 가 비슷하면 일치로 간주.
  function norm(s) { return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim(); }
  let matched = 0;
  const genNorm = generated.map((s) => norm(s.instruct));
  for (const e of expected) {
    const en = norm(e.instruct);
    if (genNorm.some((g) => g.includes(en.slice(0, 10)) || en.includes(g.slice(0, 10)))) matched++;
  }
  return {
    matchRate: matched / expected.length,
    extra: Math.max(0, generated.length - matched),
    missing: expected.length - matched,
  };
}

// ─── 절차 품질 분석 ───────────────────────────────────────────────────────────

// sig 에서 텍스트 풀을 만든다 (guard 와 동일 방식, 소문자 정규화).
function buildPool(sig) {
  const pool = new Set();
  for (const n of sig ?? []) {
    if (n.text) pool.add(n.text.toLowerCase().trim());
    if (n.ariaLabel) pool.add(n.ariaLabel.toLowerCase().trim());
    for (const l of n.nearLabels ?? []) {
      const t = l.toLowerCase().trim();
      if (t) pool.add(t);
    }
  }
  return pool;
}

function poolContains(pool, text) {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  if (pool.has(t)) return true;
  for (const p of pool) if (p.includes(t) || t.includes(p)) return true;
  return false;
}

// verify 가 시작 시점에 이미 참일 가능성을 판정한다.
//   true  → 아마도 참 (pre-pass 의심)
//   false → 아마도 거짓 (정상)
//   null  → 알 수 없음 (url 등 런타임에만 판정 가능)
function wouldPassAtStart(verify, pool) {
  if (!verify) return false;
  if (verify.is === "urlIncludes") return null; // 실제 URL 없이 판정 불가

  const probe = verify.probe;
  if (!probe) return false;
  if (probe.by === "urlIncludes") return null;

  const inSig = poolContains(pool, probe.text);

  switch (verify.is) {
    case "found":      return inSig;           // 요소가 이미 존재
    case "notFound":   return !inSig;          // 요소가 처음부터 없음
    case "textPresent":return inSig;           // 요소가 있고 텍스트도 있을 가능성
    case "checked":    return null;            // 체크 여부는 모름
    case "unchecked":  return null;
    case "valueIn":    return null;
    default:           return false;
  }
}

// target 과 verify.probe 가 같은 텍스트를 참조하는지 (동어반복 verify 탐지).
// "저장 버튼 클릭 → verify: 저장 버튼이 found" 처럼 행동의 결과를 확인하지 않는 경우.
function isTautological(step) {
  const tgtText = step.target?.text?.toLowerCase().trim();
  const verText = step.verify?.probe?.text?.toLowerCase().trim();
  if (!tgtText || !verText) return false;
  if (tgtText !== verText) return false;
  // 상태 변화를 확인하는 is 는 동어반복이 아니다 (checked/unchecked/valueIn).
  const is = step.verify?.is ?? "";
  return ["found", "textPresent", "notFound"].includes(is);
}

// 생성된 절차 전체를 분석한다.
function analyzeProc(steps, sig) {
  if (!steps?.length) return null;
  const pool = buildPool(sig);
  const tautIdx = [];
  const prePassIdx = [];

  for (const [i, s] of steps.entries()) {
    if (isTautological(s)) tautIdx.push(i);
    if (wouldPassAtStart(s.verify, pool) === true) prePassIdx.push(i);
  }

  const lastIdx = steps.length - 1;
  const lastSuspect = tautIdx.includes(lastIdx) || prePassIdx.includes(lastIdx);

  return { tautIdx, prePassIdx, lastSuspect };
}

// 분석 결과를 출력한다 (guard 통과 후 호출).
function printAnalysis(steps, analysis) {
  if (!analysis) return;
  const lines = [];

  for (const [i, s] of steps.entries()) {
    const tags = [];
    if (analysis.tautIdx.includes(i)) {
      const v = s.verify?.probe?.text ?? "?";
      const is = s.verify?.is ?? "?";
      tags.push(`동어반복(target="${v}", verify.is=${is})`);
    }
    if (analysis.prePassIdx.includes(i) && !analysis.tautIdx.includes(i)) {
      tags.push("시작시점-이미참-의심");
    }
    if (tags.length) {
      lines.push(`      step${i}: ${tags.join(" | ")}`);
    }
  }

  if (lines.length || analysis.lastSuspect) {
    console.log("    ⚠ 절차 분석:");
    for (const l of lines) console.log(l);
    if (analysis.lastSuspect) {
      console.log(`      ★ 마지막 step(${steps.length - 1}) 허위완주 의심`);
    }
  }
}

// ─── 픽스처 로드 ─────────────────────────────────────────────────────────────
async function loadFixtures() {
  if (fixtureArg) {
    const fp = path.resolve(ROOT, fixtureArg);
    const data = JSON.parse(await fs.readFile(fp, "utf8"));
    return [data];
  }
  const dir = path.join(ROOT, "fixtures");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  return Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8"))));
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { guard } = await import("../lib/guard.js");
  let resolveLib = null;
  const provider = makeProvider();

  if (!dryRun && !provider) {
    console.error("ANTHROPIC_API_KEY 또는 OPENAI_API_KEY 가 없습니다. --dry-run 으로 실행하거나 키를 설정하세요.");
    process.exit(1);
  }
  if (!dryRun) {
    resolveLib = await import("../lib/procedure-generator.js");
  }

  const fixtures = await loadFixtures();
  const results = [];

  for (const pack of fixtures) {
    console.log(`\n=== ${pack.id} (${pack.label}) ===`);

    for (const goal of pack.goals ?? []) {
      for (const procId of goal.procedures ?? []) {
        const proc = pack.procedures?.[procId];
        if (!proc) continue;
        const goalLabel = goal.label;
        const sig = buildSyntheticSignature(proc);

        if (dryRun) {
          console.log(`  [dry] ${goalLabel} / ${procId} — ${proc.steps?.length ?? 0} steps, sig ${sig.length} nodes`);
          results.push({ pack: pack.id, goal: goalLabel, proc: procId, guardOk: "skip", matchRate: "skip" });
          continue;
        }

        process.stdout.write(`  ${goalLabel} / ${procId} … `);
        let guardOk = false, matchRate = 0, extra = 0, missing = 0, error = null, ms = 0;
        let analysis = null, quoteConf = null, guardWarnings = [], zeroCheckCount = 0;

        try {
          const t0 = Date.now();
          const res = await resolveLib.resolve(provider, goalLabel, sig);
          ms = Date.now() - t0;
          if (res?.empty) {
            console.log(`⚠ resolver: steps 없음 (관련 요소 미관측) [${ms}ms]`);
            guardOk = true;
          } else {
            const gResult = guard(res.procedure, sig);
            guardOk = gResult.ok;
            guardWarnings = gResult.warnings ?? [];
            if (!guardOk) {
              console.log(`✗ guard 불통과 [${ms}ms]:`, gResult.reasons.slice(0, 3));
            } else if (guardWarnings.length) {
              process.stdout.write(`  ⚠ guard 경고: ${guardWarnings.join(", ")}\n`);
            }
            if (guardOk) {
              const score = scoreSteps(proc.steps, res.procedure.steps);
              matchRate = score.matchRate;
              extra = score.extra;
              missing = score.missing;
              analysis = analyzeProc(res.procedure.steps, sig);
              quoteConf = checkQuoteConformance(res.procedure.steps);
              zeroCheckCount = res.procedure.steps.filter(
                (s) => Array.isArray(s.usedLabels) && s.usedLabels.length === 0
              ).length;
              const quoteStr = quoteConf.total
                ? `따옴표 ${quoteConf.quoted}/${quoteConf.total}`
                : "target없음";
              console.log(
                `✓ guard OK | 일치율 ${(matchRate * 100).toFixed(0)}% | 여분 ${extra} | 누락 ${missing} | ${quoteStr} [${ms}ms]`
              );
              if (quoteConf.violations.length) {
                console.log(`    ⚠ 따옴표 누락: ${quoteConf.violations.map((v) => `'${v}'`).join(", ")}`);
              }
              printStepDetails(res.procedure.steps);
              printAnalysis(res.procedure.steps, analysis);
            }
          }
        } catch (err) {
          error = err.message;
          console.log("✗ 오류:", err.message);
        }
        results.push({ pack: pack.id, goal: goalLabel, proc: procId, guardOk, matchRate, extra, missing, error, ms,
          tautCount: analysis?.tautIdx.length ?? 0,
          prePassCount: analysis?.prePassIdx.length ?? 0,
          lastSuspect: analysis?.lastSuspect ?? false,
          quoteTotal: quoteConf?.total ?? 0,
          quoteOk: quoteConf?.quoted ?? 0,
          guardWarnCount: guardWarnings.length,
          zeroCheckCount,
        });
      }
    }
  }

  // 요약
  if (!dryRun) {
    const total = results.length;
    const guardPass = results.filter((r) => r.guardOk === true).length;
    const avgMatch = results
      .filter((r) => typeof r.matchRate === "number")
      .reduce((a, r) => a + r.matchRate, 0) / (results.filter((r) => typeof r.matchRate === "number").length || 1);

    const totalTaut = results.reduce((a, r) => a + (r.tautCount ?? 0), 0);
    const totalPrePass = results.reduce((a, r) => a + (r.prePassCount ?? 0), 0);
    const lastSuspectCount = results.filter((r) => r.lastSuspect).length;
    const msTimes = results.filter((r) => r.ms > 0).map((r) => r.ms);
    const avgMs = msTimes.reduce((a, v) => a + v, 0) / (msTimes.length || 1);
    const p50Ms = p50(msTimes);

    const totalQuoteTotal = results.reduce((a, r) => a + (r.quoteTotal ?? 0), 0);
    const totalQuoteOk = results.reduce((a, r) => a + (r.quoteOk ?? 0), 0);
    const quoteRateStr = totalQuoteTotal
      ? `${totalQuoteOk}/${totalQuoteTotal} (${((totalQuoteOk / totalQuoteTotal) * 100).toFixed(0)}%)`
      : "해당없음";

    console.log(`\n━━ 요약 ━━`);
    console.log(`총 ${total}건 | guard 통과율 ${((guardPass / total) * 100).toFixed(0)}% | 평균 step 일치율 ${(avgMatch * 100).toFixed(0)}%`);
    const totalGuardWarn = results.reduce((a, r) => a + (r.guardWarnCount ?? 0), 0);
    const totalZeroCheck = results.reduce((a, r) => a + (r.zeroCheckCount ?? 0), 0);
    console.log(`동어반복 step ${totalTaut}건 | 시작시점-이미참 step ${totalPrePass}건 | 마지막step 허위완주 의심 ${lastSuspectCount}건`);
    console.log(`guard 경고(동어반복) ${totalGuardWarn}건 | 라벨 따옴표 규약: ${quoteRateStr}`);
    if (totalZeroCheck > 0) {
      console.log(`⚠ 검사 항목 0개 step: ${totalZeroCheck}건 — 라벨 없는 step 이거나 usedLabels 누락 의심`);
    } else {
      console.log(`검사 항목 0개 step: 0건 ✓`);
    }
    console.log(`응답 시간 p50=${p50Ms}ms avg=${avgMs.toFixed(0)}ms`);
    console.log(`Phase A 기준: guard 통과율 100%, 완주율 ≥60%`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
