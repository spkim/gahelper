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
        let guardOk = false, matchRate = 0, extra = 0, missing = 0, error = null;

        try {
          const res = await resolveLib.resolve(provider, goalLabel, sig);
          if (res?.empty) {
            console.log("⚠ resolver: steps 없음 (관련 요소 미관측)");
            guardOk = true;
          } else {
            const gResult = guard(res.procedure, sig);
            guardOk = gResult.ok;
            if (!guardOk) {
              console.log("✗ guard 불통과:", gResult.reasons.slice(0, 3));
            } else {
              const score = scoreSteps(proc.steps, res.procedure.steps);
              matchRate = score.matchRate;
              extra = score.extra;
              missing = score.missing;
              console.log(
                `✓ guard OK | 일치율 ${(matchRate * 100).toFixed(0)}% | 여분 ${extra} | 누락 ${missing}`
              );
            }
          }
        } catch (err) {
          error = err.message;
          console.log("✗ 오류:", err.message);
        }
        results.push({ pack: pack.id, goal: goalLabel, proc: procId, guardOk, matchRate, extra, missing, error });
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

    console.log(`\n━━ 요약 ━━`);
    console.log(`총 ${total}건 | guard 통과율 ${((guardPass / total) * 100).toFixed(0)}% | 평균 step 일치율 ${(avgMatch * 100).toFixed(0)}%`);
    console.log(`Phase A 기준: guard 통과율 100%, 완주율 ≥60%`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
