// 레시피 린트(C2). 런타임 코드가 아니라 테스트 전용 규칙이다. lib/recipe-store.js 의 validateRecipe 와
// 겹치지 않는 새 규칙만 둔다(id·version·type·goals 배열은 이미 그쪽에서 검사한다).
// lintRecipe(recipe) → 위반 문자열 배열(비어 있으면 통과).

export const LIMITS = Object.freeze({ labelMin: 8, labelMax: 120, payloadContentMax: 2000, payloadLabelMax: 60 });

// goal.label 은 LLM 의 goalText 가 된다. "무엇을 이루나"만 쓰고 화면 라벨·메뉴 경로·클릭 지시를 쓰지 않는다.
const MENU_PATH = /[>›»→]|->|\s\/\s/;
const UI_ACTION = /클릭|누르|눌러|탭하|선택하세요|click|tap /i;
const URL_OR_SELECTOR = /https?:\/\/|www\.|[#.][a-z][\w-]*\s*[{[>]|\[[a-z-]+=|<[a-z]+/i;

export function lintSite(site, where) {
  if (site === undefined) return [];
  const v = [];
  let url;
  try {
    url = new URL(site);
  } catch {
    return [`${where}: site 가 올바른 URL 이 아님 (${String(site).slice(0, 40)})`];
  }
  if (url.protocol !== "https:") v.push(`${where}: site 는 https 여야 함`);
  if (url.username || url.password) v.push(`${where}: site 에 인증 정보가 있음`);
  if (!url.hostname.includes(".")) v.push(`${where}: site 호스트에 도메인이 없음`);
  if (url.search || url.hash) v.push(`${where}: site 에 쿼리·해시가 있음`);
  return v;
}

export function lintLabel(label, where) {
  const v = [];
  if (typeof label !== "string") return [`${where}: label 이 문자열이 아님`];
  const text = label.trim();
  if (text.length < LIMITS.labelMin) v.push(`${where}: label 이 너무 짧음`);
  if (text.length > LIMITS.labelMax) v.push(`${where}: label 이 너무 김(${text.length}자)`);
  if (MENU_PATH.test(text)) v.push(`${where}: label 에 메뉴 경로 표기가 있음`);
  if (UI_ACTION.test(text)) v.push(`${where}: label 에 화면 조작 지시가 있음`);
  if (URL_OR_SELECTOR.test(text)) v.push(`${where}: label 에 URL 또는 선택자 모양이 있음`);
  return v;
}

export function lintPayload(payload, label, where) {
  if (payload === undefined) return [];
  const v = [];
  if (payload?.kind !== "clipboard") v.push(`${where}: payload.kind 는 clipboard 여야 함`);
  if (typeof payload?.label !== "string" || !payload.label.trim()) v.push(`${where}: payload.label 이 비어 있음`);
  else if (payload.label.length > LIMITS.payloadLabelMax) v.push(`${where}: payload.label 이 너무 김`);
  if (typeof payload?.content !== "string" || payload.content.length === 0) v.push(`${where}: payload.content 가 비어 있음`);
  else {
    if (payload.content.length > LIMITS.payloadContentMax) v.push(`${where}: payload.content 가 ${LIMITS.payloadContentMax}자를 넘음(${payload.content.length}자)`);
    if (typeof label === "string" && label.includes(payload.content)) v.push(`${where}: label 에 payload.content 가 들어 있음`);
  }
  return v;
}

export function lintRecipe(r) {
  const v = [];
  const isGeneric = r.id === "generic-setup";
  const goals = Array.isArray(r.goals) ? r.goals : [];

  if (isGeneric) {
    if (goals.length !== 0) v.push(`${r.id}: generic-setup 은 goals 가 비어 있어야 함`);
    return v; // fallback 레시피는 goal 단위 규칙의 대상이 아니다.
  }
  if (goals.length === 0) v.push(`${r.id}: goals 가 비어 있음 (generic-setup 만 예외)`);

  const seen = new Set();
  goals.forEach((g, i) => {
    const where = `${r.id}.goals[${i}]`;
    if (seen.has(g.id)) v.push(`${where}: goal id 중복 (${g.id})`);
    seen.add(g.id);
    v.push(...lintLabel(g.label, where), ...lintSite(g.site, where), ...lintPayload(g.payload, g.label, where));
  });
  return v;
}
