// v2 §4.6 — signature 정규화 및 structural_hash.
// probe.js 가 스크럽까지 마친 raw signature 를 받아, 안정 정규화 후 SHA-256 해시.

export function normalizeText(s) {
  return String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeNode(n) {
  const text = normalizeText(n.text ?? "");
  // 숫자만으로 이루어진 텍스트(카운터·날짜)는 지문을 흔들지 않도록 # 로 치환.
  const stableText = /^\d+$/.test(text) ? "#" : text;
  const ariaLabel = n.ariaLabel ? normalizeText(n.ariaLabel) : undefined;
  const nearLabels = Array.isArray(n.nearLabels)
    ? n.nearLabels.map(normalizeText).filter(Boolean).sort()
    : [];
  return {
    tag: normalizeText(n.tag).toLowerCase(),
    role: n.role ? normalizeText(n.role) : undefined,
    ariaLabel,
    text: stableText,
    nearLabels,
  };
}

export function normalizeSignature(sig) {
  if (!Array.isArray(sig)) return [];
  const nodes = sig.map(normalizeNode);
  nodes.sort((a, b) => {
    const ka = `${a.tag}|${a.role ?? ""}|${a.ariaLabel ?? ""}|${a.text}`;
    const kb = `${b.tag}|${b.role ?? ""}|${b.ariaLabel ?? ""}|${b.text}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return nodes;
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",")}}`;
  }
  if (v === undefined) return "null";
  return JSON.stringify(v);
}

export async function structuralHash(sig) {
  const normalized = normalizeSignature(sig);
  const bytes = new TextEncoder().encode(stableStringify(normalized));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// resolver 프롬프트를 위한 축약형. 100 요소를 넘으면 nearLabels 를 뺀다. (§7.2)
export function compact(sig) {
  const nodes = normalizeSignature(sig);
  const heavy = nodes.length > 100;
  return nodes.map((n) => {
    const out = { tag: n.tag, text: n.text };
    if (n.role) out.role = n.role;
    if (n.ariaLabel) out.ariaLabel = n.ariaLabel;
    if (!heavy && n.nearLabels?.length) out.nearLabels = n.nearLabels;
    return out;
  });
}
