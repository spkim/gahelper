const PACK_FILES = ["packs/tistory.json", "packs/youtube.json", "packs/blogger.json"];

let cache = null;

export async function loadPacks() {
  if (cache) return cache;
  const packs = [];
  for (const file of PACK_FILES) {
    try {
      const res = await fetch(chrome.runtime.getURL(file));
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = await res.json();
      const err = validatePack(data);
      if (err) {
        console.warn(`[setup-copilot] 팩 스킵 ${file}: ${err}`);
        continue;
      }
      packs.push(data);
    } catch (e) {
      console.warn(`[setup-copilot] 팩 로드 실패 ${file}`, e);
    }
  }
  cache = packs;
  return packs;
}

function validatePack(pack) {
  if (!pack || typeof pack !== "object") return "not an object";
  for (const k of ["id", "label", "matches", "origins", "entry", "goals", "procedures"]) {
    if (!(k in pack)) return `missing field: ${k}`;
  }
  if (!Array.isArray(pack.matches) || pack.matches.length === 0) return "matches empty";
  if (!Array.isArray(pack.origins) || pack.origins.length === 0) return "origins empty";
  if (!pack.entry?.url || !pack.entry?.label || !pack.entry?.ready) return "entry incomplete";
  if (!Array.isArray(pack.goals)) return "goals not array";
  if (!pack.procedures || typeof pack.procedures !== "object") return "procedures not object";
  for (const goal of pack.goals) {
    if (!goal.id || !goal.label || !Array.isArray(goal.procedures) || !goal.procedures.length) {
      return `bad goal: ${goal.id ?? "?"}`;
    }
    for (const pid of goal.procedures) {
      if (!pack.procedures[pid]) return `missing procedure "${pid}" (goal ${goal.id})`;
    }
  }
  for (const [pid, proc] of Object.entries(pack.procedures)) {
    if (!Array.isArray(proc.steps) || !proc.steps.length) return `procedure ${pid} has no steps`;
    for (const step of proc.steps) {
      if (!step.id || !step.instruct || !step.verify || !step.onFail) {
        return `bad step in ${pid}: ${step.id ?? "?"}`;
      }
    }
  }
  return null;
}

function escapeRe(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function matchPatternToRegex(pattern) {
  const m = pattern.match(/^([^:]+):\/\/([^/]*)(\/.*)?$/);
  if (!m) return null;
  const [, scheme, host, path = "/*"] = m;
  const schemeRe = scheme === "*" ? "https?" : escapeRe(scheme);
  let hostRe;
  if (host === "*") hostRe = "[^/]*";
  else if (host.startsWith("*.")) hostRe = `(?:[^/]+\\.)?${escapeRe(host.slice(2))}`;
  else hostRe = escapeRe(host);
  const pathRe = path.split("*").map(escapeRe).join(".*");
  return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`);
}

export function urlMatchesPack(pack, url) {
  if (!url) return false;
  for (const pattern of pack.matches) {
    const re = matchPatternToRegex(pattern);
    if (re?.test(url)) return true;
  }
  return false;
}

export function findPackForUrl(packs, url) {
  for (const pack of packs) if (urlMatchesPack(pack, url)) return pack;
  return null;
}

export function findGoal(pack, goalId) {
  return pack.goals.find((g) => g.id === goalId) ?? null;
}

export function getProcedure(pack, procId) {
  return pack.procedures?.[procId] ?? null;
}
