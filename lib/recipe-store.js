// JSON import assertions (assert/with) 는 Node 18 과 Chrome 최신 버전이 각각 다른 구문을 요구하므로
// JS 객체로 인라인해서 호환성 문제를 피한다.

const ADSENSE_SETUP = {
  id: "adsense-setup",
  version: 1,
  name: "Google AdSense 설정",
  description: "AdSense 계정에 사이트를 등록하고 광고 준비 상태를 확인한다.",
  type: "setup",
  match: {
    hosts: ["adsense.google.com"],
    urlIncludes: ["/adsense/"],
  },
  goals: [
    { id: "register-site",    label: "사이트 등록" },
    { id: "verify-site",      label: "사이트 연결 확인" },
    { id: "check-ads-txt",    label: "ads.txt 확인", optional: true },
    { id: "review-readiness", label: "심사 준비 확인" },
  ],
};

const SEARCH_CONSOLE_SETUP = {
  id: "search-console-setup",
  version: 1,
  name: "Google Search Console 설정",
  description: "Search Console에 속성을 추가하고 소유권을 확인한다.",
  type: "setup",
  match: {
    hosts: ["search.google.com"],
    urlIncludes: ["/search-console/"],
  },
  goals: [
    { id: "add-property",     label: "속성 추가" },
    { id: "verify-ownership", label: "소유권 확인" },
    { id: "check-coverage",   label: "색인 생성 상태 확인", optional: true },
  ],
};

const GENERIC_SETUP = {
  id: "generic-setup",
  version: 1,
  name: "일반 설정 안내",
  description: "사전 등록되지 않은 모든 사이트의 설정을 현재 화면 관측으로 안내한다. fallback Recipe.",
  type: "setup",
  goals: [],
};

// generic-setup은 항상 마지막 — fallback이며 match 규칙이 없다.
const REGISTRY = [ADSENSE_SETUP, SEARCH_CONSOLE_SETUP, GENERIC_SETUP].map(validateRecipe);

function validateRecipe(r) {
  if (!r || typeof r !== 'object') throw new Error('Recipe must be an object');
  if (!r.id || typeof r.id !== 'string') throw new Error('Recipe.id required');
  if (typeof r.version !== 'number') throw new Error('Recipe.version must be a number');
  if (r.type !== 'setup') throw new Error(`Recipe.type "${r.type}" not supported`);
  if (!Array.isArray(r.goals)) throw new Error('Recipe.goals must be an array');
  for (const [i, g] of r.goals.entries()) {
    if (!g.id || typeof g.id !== 'string') throw new Error(`Goal[${i}].id required`);
    if (!g.label || typeof g.label !== 'string') throw new Error(`Goal[${i}].label required`);
  }
  return r;
}

export function getRecipe(id) {
  return REGISTRY.find((r) => r.id === id) ?? null;
}

export function listRecipes() {
  return REGISTRY.slice();
}

// URL/host 기반 후보 Recipe 반환. generic-setup은 포함하지 않는다.
export function matchRecipes({ host, url } = {}) {
  const out = [];
  for (const r of REGISTRY) {
    if (!r.match) continue;
    const hosts = r.match.hosts ?? [];
    const urlIncludes = r.match.urlIncludes ?? [];
    const hostMatch = host ? hosts.some((h) => host === h || host.endsWith(`.${h}`)) : false;
    const urlMatch = url ? urlIncludes.some((u) => url.includes(u)) : false;
    if (hostMatch || urlMatch) out.push(r);
  }
  return out;
}
