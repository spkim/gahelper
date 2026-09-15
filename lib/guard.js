// v2 §7.3 — observed_only + verify 존재 런타임 강제.
// 모델을 신뢰하지 않는다. 불통과 시 절차 전체를 폐기.
import { normalizeText } from "./signature.js";

// instruct 에서 따온표/꺾쇠로 감싼 구간을 뽑는다.
// resolver 프롬프트는 화면 라벨을 반드시 따온표로 감싸도록 지시해야 한다.
const QUOTE_RES = [
  /'([^']+)'/g,   // 반따옴표
  /"([^"]+)"/g,   // 쌍따옴표
  /\[([^\]]+)\]/g, // 꺾쇠
  /「([^」]+)」/g,  // 한국어 겹낫표
  /『([^』]+)』/g,  // 한국어 겹낫표(이중)
  /\u2018([^\u2019]+)\u2019/g, // 영문 ' '
  /\u201C([^\u201D]+)\u201D/g, // 영문 " "
];

export function extractQuoted(text) {
  if (!text) return [];
  const out = [];
  for (const re of QUOTE_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = m[1]?.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function buildTextPool(signature) {
  const pool = new Set();
  for (const n of signature ?? []) {
    if (n.text) pool.add(normalizeText(n.text).toLowerCase());
    if (n.ariaLabel) pool.add(normalizeText(n.ariaLabel).toLowerCase());
    for (const l of n.nearLabels ?? []) {
      const t = normalizeText(l).toLowerCase();
      if (t) pool.add(t);
    }
  }
  return pool;
}

// 라벨 text 가 관측 풀에 있는지 확인.
// pool 의 어느 텍스트가 t 를 포함하면 통과 (짧은 라벨이 긴 텍스트 안에 있는 경우 수용).
function poolHas(pool, text) {
  const t = normalizeText(text ?? "").toLowerCase();
  if (!t) return true;
  if (pool.has(t)) return true;
  for (const p of pool) if (p.includes(t)) return true;
  return false;
}

// 절차를 검사한다. signature 는 normalizeSignature 이전 raw DomSignature[].
// 반환: { ok: boolean, reasons: string[] }
export function guard(procedure, signature) {
  if (!procedure || typeof procedure !== "object") {
    return { ok: false, reasons: ["no_procedure"] };
  }
  const steps = procedure.steps;
  if (!Array.isArray(steps)) {
    return { ok: false, reasons: ["no_steps"] };
  }
  if (steps.length === 0) {
    // 관련 요소 없음 — guard 불통과가 아니라 "경로 없음" 신호.
    // engine 이 별도 처리하도록 ok:true 로 반환하되 empty 플래그를 세운다.
    return { ok: true, empty: true, reasons: [] };
  }

  const reasons = [];
  const pool = buildTextPool(signature);

  for (const [i, s] of steps.entries()) {
    if (!s || typeof s !== "object") {
      reasons.push(`step${i}:not_object`); continue;
    }
    if (!s.verify) {
      reasons.push(`step${i}:no_verify`);
    }

    // instruct 안의 인용 라벨은 관측 풀에 있어야 한다.
    for (const q of extractQuoted(s.instruct ?? "")) {
      if (!poolHas(pool, q)) {
        reasons.push(`step${i}:unobserved_label:${q}`);
      }
    }

    // target 과 verify.probe 로케이터 검사.
    const locSlots = [
      { where: "target", loc: s.target },
      { where: "verify.probe", loc: s.verify?.probe },
    ];
    for (const { where, loc } of locSlots) {
      if (!loc) continue;
      if (typeof loc !== "object") {
        reasons.push(`step${i}:${where}:bad_locator`); continue;
      }
      if (loc.by === "css") {
        reasons.push(`step${i}:${where}:css_locator`);
      } else if (loc.by !== "urlIncludes") {
        if (!poolHas(pool, loc.text ?? "")) {
          reasons.push(`step${i}:${where}:unobserved_locator:${loc.text ?? ""}`);
        }
      }
    }

    // verify.textPresent 의 text 도 화면에 실재해야 한다.
    if (s.verify?.is === "textPresent" && typeof s.verify.text === "string") {
      if (!poolHas(pool, s.verify.text)) {
        reasons.push(`step${i}:verify.text:unobserved:${s.verify.text}`);
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
