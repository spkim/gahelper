import { getSettings, getActiveProvider, onSettingsChanged } from "../lib/storage.js";
import { route, REFUSE_MESSAGE } from "../lib/router.js";
import {
  getSession, clearSession, createSession,
  currentStep, tickStep, skipAlreadyPassed,
  reportFail, resumeFromBlocked, checkShouldReinterpret, resetForReinterpret,
} from "../lib/engine.js";
import {
  getActiveTab, hasOriginPermission, requestOriginPermission,
  injectProbe, probe, highlight, signature as captureSignature,
} from "../lib/probe-client.js";
import { structuralHash } from "../lib/signature.js";
import { resolve } from "../lib/procedure-generator.js";
import { explain as recoverExplain, FALLBACK_MESSAGE } from "../lib/recover.js";
import { resolveRecipe } from "../lib/recipe-resolver.js";
import { getRecipe, listRecipes } from "../lib/recipe-store.js";
import {
  createRecipeSession, getRecipeSession, clearRecipeSession,
  currentGoal, markGoalDone,
} from "../lib/recipe-engine.js";

// ─── 상수 / 전역 ─────────────────────────────────────────────────────────────

const POLL_MS = 1000;

const els = {
  root: document.getElementById("state-slot"),
  templates: {
    "no-provider":  document.getElementById("tpl-no-provider"),
    "recipe-select": document.getElementById("tpl-recipe-select"),
    "resolving":    document.getElementById("tpl-resolving"),
    "entry":        document.getElementById("tpl-entry"),
    "running":      document.getElementById("tpl-running"),
    "blocked":      document.getElementById("tpl-blocked"),
    "done":         document.getElementById("tpl-done"),
    "recipe-done":  document.getElementById("tpl-recipe-done"),
    "refuse":       document.getElementById("tpl-refuse"),
  },
};

let settings = null;
let currentTab = null;
let renderedKey = null;
let pollTimer = null;
let ticking = false;

// session 없는 상태에서의 UI 모드.
let uiMode = "prompt"; // "prompt" | "resolving" | "refuse"

// ─── 상태 계산 ───────────────────────────────────────────────────────────────

function computeKind() {
  if (!settings) return "loading";
  if (!settings.activeProviderId) return "no-provider";
  const session = currentTab ? getSession(currentTab.id) : null;
  const recipeSession = currentTab ? getRecipeSession(currentTab.id) : null;
  if (session) {
    if (session.status === "done") {
      // recipe 가 아직 진행 중이면 다음 goal 로 전환하는 동안 resolving 표시.
      if (recipeSession?.status === "running") return "resolving";
      return "done";
    }
    if (session.status === "blocked") return "blocked";
    if (session.status === "entry")   return "entry";
    return "running";
  }
  if (recipeSession?.status === "done") return "recipe-done";
  if (uiMode === "resolving") return "resolving";
  if (uiMode === "refuse")    return "refuse";
  return "recipe-select";
}

function renderKey(kind) {
  const session = currentTab ? getSession(currentTab.id) : null;
  const recipeSession = currentTab ? getRecipeSession(currentTab.id) : null;
  return JSON.stringify({
    kind,
    tab: currentTab?.id ?? null,
    stepIdx: session?.stepIdx ?? null,
    attempts: session?.attempts ?? null,
    status: session?.status ?? null,
    confirmations: session?.procedure?.confirmations ?? null,
    origin: session?.procedure?.origin ?? null,
    recoverText: session?.recoverText ?? null,
    recipeId: recipeSession?.recipeId ?? null,
    recipeStatus: recipeSession?.status ?? null,
    goalIdx: recipeSession?.goalIdx ?? null,
    uiMode,
  });
}

// ─── 렌더 ────────────────────────────────────────────────────────────────────

function cloneTemplate(kind) {
  return els.templates[kind].content.firstElementChild.cloneNode(true);
}

function render(force = false) {
  const kind = computeKind();
  const key = renderKey(kind);
  if (!force && key === renderedKey) return;
  renderedKey = key;

  els.root.innerHTML = "";
  if (kind === "loading") return;

  const node = cloneTemplate(kind);
  if      (kind === "no-provider")  renderNoProvider(node);
  else if (kind === "recipe-select") renderRecipeSelect(node);
  else if (kind === "resolving")    { /* spinner only */ }
  else if (kind === "entry")        renderEntry(node);
  else if (kind === "running")      renderRunning(node);
  else if (kind === "blocked")      renderBlocked(node);
  else if (kind === "done")         renderDone(node);
  else if (kind === "recipe-done")  renderRecipeDone(node);
  else if (kind === "refuse")       renderRefuse(node);
  els.root.appendChild(node);
}

function renderNoProvider(node) {
  node.querySelector('[data-action="open-options"]').addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderRecipeSelect(node) {
  const tabId = currentTab?.id ?? null;
  const recipeSession = tabId ? getRecipeSession(tabId) : null;

  // URL 기반 추천
  const urlRecDiv = node.querySelector('[data-slot="url-rec"]');
  if (currentTab?.url) {
    try {
      const resolved = resolveRecipe({ url: currentTab.url });
      if (resolved.source === "url") {
        const recipe = getRecipe(resolved.recipeId);
        if (recipe) {
          urlRecDiv.hidden = false;
          node.querySelector('[data-slot="rec-name"]').textContent = recipe.name;
          node.querySelector('[data-action="start-rec"]').addEventListener("click", () => {
            startRecipeFlow(resolved.recipeId);
          });
        }
      }
    } catch {}
  }

  // 이어하기
  if (recipeSession?.status === "running") {
    const resumeSection = node.querySelector('[data-slot="resume-section"]');
    resumeSection.hidden = false;
    const recipe = getRecipe(recipeSession.recipeId);
    node.querySelector('[data-slot="resume-name"]').textContent =
      recipe?.name ?? recipeSession.recipeId;
    node.querySelector('[data-action="resume-rec"]').addEventListener("click", () => {
      const goal = currentGoal(tabId);
      if (goal) startFlow(goal.label);
    });
  }

  // Recipe 칩
  const chips = node.querySelector('[data-slot="chips"]');
  for (const recipe of listRecipes()) {
    if (recipe.id === "generic-setup") continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recipe-chip btn-ghost btn-sm";
    btn.textContent = recipe.name;
    btn.addEventListener("click", () => startRecipeFlow(recipe.id));
    chips.appendChild(btn);
  }

  // 자연어 입력
  const form = node.querySelector('[data-slot="form"]');
  const input = node.querySelector('[data-slot="input"]');
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) handleRouteSubmit(text);
  });
  setTimeout(() => input?.focus?.(), 0);
}

function renderEntry(node) {
  const session = currentTab ? getSession(currentTab.id) : null;
  const goalText = session?.goalText ?? "설정 화면";
  node.querySelector('[data-slot="lede"]').textContent =
    `'${goalText}' 을(를) 위한 설정 화면을 열어 주세요. 화면이 준비되면 자동으로 진행합니다.`;
  node.querySelector('[data-slot="note"]').textContent =
    "설정 메뉴나 해당 서비스를 직접 열고 이 패널로 돌아오세요.";
  const goBtn = node.querySelector('[data-action="go-entry"]');
  goBtn.textContent = "현재 화면으로 진행";
  goBtn.addEventListener("click", () => tryResolveCurrentTab());
  node.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    const tabId = currentTab?.id;
    if (tabId) { clearSession(tabId); clearRecipeSession(tabId); }
    uiMode = "prompt";
    render(true);
  });
}

function renderRail(container, steps, stepIdx) {
  container.innerHTML = "";
  for (let i = 0; i < steps.length; i++) {
    const li = document.createElement("li");
    li.className = "rail-node";
    li.dataset.state = i < stepIdx ? "pass" : i === stepIdx ? "current" : "pending";
    container.appendChild(li);
    if (i < steps.length - 1) {
      const conn = document.createElement("li");
      conn.className = "rail-connector";
      conn.dataset.state = i < stepIdx ? "pass" : "pending";
      container.appendChild(conn);
    }
  }
}

function renderTrustBadge(node, procedure) {
  const badge = node.querySelector('[data-slot="trust-badge"]');
  if (!badge) return;
  const c = procedure?.confirmations ?? 0;
  const origin = procedure?.origin ?? "live";
  if (origin === "live" && c === 0) {
    badge.hidden = false;
    badge.dataset.level = "live";
    badge.textContent = "화면을 읽어 만든 안내";
  } else if (c >= 3) {
    badge.hidden = false;
    badge.dataset.level = "confirmed";
    badge.textContent = "여러 번 확인된 안내";
  }
}

function renderRunning(node) {
  const tabId = currentTab.id;
  const session = getSession(tabId);
  const { procedure, stepIdx } = session;
  const step = currentStep(session);
  if (!procedure || !step) return;

  // Recipe 진행 표시
  const recipeSession = getRecipeSession(tabId);
  const progressEl = node.querySelector('[data-slot="goal-progress"]');
  if (progressEl && recipeSession?.status === "running") {
    const recipe = getRecipe(recipeSession.recipeId);
    const total = recipe?.goals?.length ?? 0;
    const done = recipeSession.completedGoalIds?.length ?? 0;
    progressEl.hidden = false;
    const textEl = progressEl.querySelector('[data-slot="goal-progress-text"]');
    if (textEl) textEl.textContent = `${recipe?.name ?? ""} — ${done + 1} / ${total}`;
  }

  renderRail(node.querySelector('[data-slot="rail"]'), procedure.steps, stepIdx);
  node.querySelector('[data-slot="proc-index"]').textContent =
    `${stepIdx + 1} / ${procedure.steps.length}`;
  node.querySelector('[data-slot="proc-title"]').textContent = procedure.goalLabel ?? "";
  node.querySelector('[data-slot="instruct"]').textContent = step.instruct;
  renderTrustBadge(node, procedure);

  const locateBtn = node.querySelector('[data-slot="locate-btn"]');
  if (!step.target) { locateBtn.disabled = true; }
  else locateBtn.addEventListener("click", () => handleLocate(step));

  node.querySelector('[data-action="fail"]').addEventListener("click", handleFail);
  node.querySelector('[data-action="reinterpret"]').addEventListener("click", () => handleReinterpret());

  if (session.attempts >= 1) {
    const hint = node.querySelector('[data-slot="hint"]');
    hint.hidden = false;
    hint.textContent = step.onFail ?? "";
  }
}

function renderBlocked(node) {
  const tabId = currentTab.id;
  const session = getSession(tabId);
  const { procedure, stepIdx } = session;
  const step = currentStep(session);

  const recoverEl = node.querySelector('[data-slot="recover"]');
  recoverEl.textContent = session.recoverText
    ?? "이 단계에서 두 번 막혔습니다. 수동으로 진행하거나 처음부터 다시 시작하세요.";

  const manualBtn = node.querySelector('[data-action="manual"]');

  if (!procedure || !step) {
    node.querySelector('[data-slot="rail"]')?.parentElement?.classList?.add('hidden');
    node.querySelector('[data-slot="proc-index"]').textContent = "";
    node.querySelector('[data-slot="proc-title"]').textContent = "";
    node.querySelector('[data-slot="instruct"]').textContent = "";
    manualBtn.style.display = "none";
  } else {
    renderRail(node.querySelector('[data-slot="rail"]'), procedure.steps, stepIdx);
    node.querySelector('[data-slot="proc-index"]').textContent =
      `${stepIdx + 1} / ${procedure.steps.length}`;
    node.querySelector('[data-slot="proc-title"]').textContent = procedure.goalLabel ?? "";
    node.querySelector('[data-slot="instruct"]').textContent = step.instruct;
    manualBtn.addEventListener("click", () => {
      const s = getSession(tabId);
      if (!s) return;
      resumeFromBlocked(s);
      s.stepIdx += 1;
      if (s.stepIdx >= (s.procedure?.steps?.length ?? 0)) s.status = "done";
      else s.status = "running";
      s.recoverText = null;
      render(true);
      ensurePolling();
    });
  }

  node.querySelector('[data-action="restart"]').addEventListener("click", () => {
    if (tabId) { clearSession(tabId); clearRecipeSession(tabId); }
    uiMode = "prompt";
    render(true);
  });
}

function renderDone(node) {
  const tabId = currentTab?.id;
  const session = tabId ? getSession(tabId) : null;
  node.querySelector('[data-slot="goal-label"]').textContent =
    session?.procedure?.goalLabel ?? "";
  node.querySelector('[data-action="restart"]').addEventListener("click", () => {
    if (tabId) { clearSession(tabId); clearRecipeSession(tabId); }
    uiMode = "prompt";
    render(true);
  });
}

function renderRecipeDone(node) {
  const tabId = currentTab?.id;
  const recipeSession = tabId ? getRecipeSession(tabId) : null;
  const recipe = recipeSession ? getRecipe(recipeSession.recipeId) : null;
  node.querySelector('[data-slot="goal-label"]').textContent = recipe?.name ?? "";
  node.querySelector('[data-action="restart"]').addEventListener("click", () => {
    if (tabId) { clearSession(tabId); clearRecipeSession(tabId); }
    uiMode = "prompt";
    render(true);
  });
}

function renderRefuse(node) {
  node.querySelector('[data-slot="lede"]').textContent = REFUSE_MESSAGE;
  node.querySelector('[data-action="retry"]').addEventListener("click", () => {
    uiMode = "prompt";
    render(true);
  });
}

// ─── Recipe 플로우 ────────────────────────────────────────────────────────────

async function startRecipeFlow(recipeId) {
  const tabId = currentTab?.id;
  if (!tabId) return;

  // generic-setup 은 RecipeSession 없이 자연어 입력 경로 사용.
  if (recipeId === "generic-setup") return;

  clearRecipeSession(tabId);
  createRecipeSession(tabId, recipeId);
  const goal = currentGoal(tabId);
  if (!goal) return;

  await startFlow(goal.label);
}

// guidance session 이 done 상태가 됐을 때 recipe 진행을 조율한다.
async function handleGuidanceDone() {
  const tabId = currentTab?.id;
  if (!tabId) return;

  const recipeSession = getRecipeSession(tabId);
  if (!recipeSession || recipeSession.status !== "running") {
    render(true);
    return;
  }

  const result = markGoalDone(tabId);
  clearSession(tabId);

  if (result.status === "done") {
    render(true); // recipe-done
    return;
  }

  uiMode = "resolving";
  render(true);
  await startFlow(result.nextGoal.label);
}

// ─── 플로우 ──────────────────────────────────────────────────────────────────

async function ensureOriginGranted(url) {
  if (await hasOriginPermission(url)) return true;
  return requestOriginPermission(url);
}

async function resolveProcedure(session, provider, goalText) {
  let sigRes;
  try {
    sigRes = await captureSignature(session.tabId);
  } catch (err) {
    console.warn("[setup-copilot] captureSignature 실패", err?.message);
    session.status = "blocked";
    session.recoverText = "화면 구조를 읽지 못했습니다. 페이지가 완전히 로드됐는지 확인하세요.";
    return false;
  }
  console.info("[setup-copilot] signature", sigRes?.signature?.length ?? 0, "nodes | url:", sigRes?.url?.slice(0, 60));

  const sig = sigRes?.signature ?? [];
  const hash = await structuralHash(sig).catch(() => null);
  session.signature = sig;
  session.structuralHash = hash;

  let resolveResult;
  try {
    resolveResult = await resolve(provider, goalText, sig);
  } catch (err) {
    console.warn("[setup-copilot] resolve 실패", err?.message, err?.reasons);
    session.status = "blocked";
    session.recoverText = `안내를 만들지 못했습니다: ${err?.message ?? "알 수 없는 오류"}. 잠시 후 다시 시도하거나 수동으로 진행하세요.`;
    return false;
  }

  if (resolveResult.empty) {
    session.status = "blocked";
    session.recoverText = "이 화면에서 관련 항목을 찾지 못했습니다. 설정 메뉴의 다른 화면일 수 있습니다.";
    return false;
  }

  session.procedure = resolveResult.procedure;
  session.stepIdx = 0;
  session.attempts = 0;
  session.status = "running";
  return true;
}

async function handleRouteSubmit(userText) {
  if (uiMode === "resolving") return;
  const provider = getActiveProvider(settings);
  if (!provider) { uiMode = "refuse"; render(true); return; }

  const url = currentTab?.url ?? "";
  const probeable = url.startsWith("http://") || url.startsWith("https://");
  let permGranted = !probeable;
  if (probeable) {
    permGranted = await ensureOriginGranted(url);
  }

  uiMode = "resolving";
  render(true);

  let routeResult;
  try {
    routeResult = await route(provider, userText);
  } catch {
    routeResult = { kind: "refuse" };
  }

  if (routeResult.kind === "refuse") {
    uiMode = "refuse";
    render(true);
    return;
  }

  const { goalText } = routeResult;
  await startFlow(goalText, { permGranted, url });
}

async function startFlow(goalText, hint = {}) {
  if (!currentTab?.id) {
    uiMode = "prompt";
    render(true);
    return;
  }
  const provider = getActiveProvider(settings);
  if (!provider) { uiMode = "refuse"; render(true); return; }

  const url = hint.url ?? currentTab.url ?? "";
  const probeable = url.startsWith("http://") || url.startsWith("https://");

  if (!probeable) {
    const session = createSession(currentTab.id);
    session.goalText = goalText;
    session.status = "entry";
    uiMode = "prompt";
    render(true);
    ensurePolling();
    return;
  }

  const granted = hint.permGranted ?? (await ensureOriginGranted(url));
  if (!granted) {
    const session = createSession(currentTab.id);
    session.goalText = goalText;
    session.status = "entry";
    uiMode = "prompt";
    render(true);
    ensurePolling();
    return;
  }

  await injectProbe(currentTab.id).catch(() => {});

  const session = createSession(currentTab.id);
  session.goalText = goalText;

  const ok = await resolveProcedure(session, provider, goalText);
  if (ok) await skipAlreadyPassed(session).catch(() => {});

  uiMode = "prompt";
  render(true);
  ensurePolling();
}

async function tryResolveCurrentTab() {
  const session = currentTab ? getSession(currentTab.id) : null;
  if (!session || session.status !== "entry") return;
  const provider = getActiveProvider(settings);
  if (!provider) return;

  const url = currentTab.url ?? "";
  const probeable = url.startsWith("http://") || url.startsWith("https://");
  if (!probeable) return;

  const granted = await hasOriginPermission(url);
  if (!granted) {
    const ok = await requestOriginPermission(url);
    if (!ok) return;
  }
  await injectProbe(currentTab.id).catch(() => {});

  const goalText = session.goalText ?? "";
  const ok = await resolveProcedure(session, provider, goalText);
  if (ok) await skipAlreadyPassed(session).catch(() => {});
  render(true);
  ensurePolling();
}

async function handleLocate(step) {
  if (!step.target || !currentTab?.id) return;
  try { await highlight(currentTab.id, step.target); } catch {}
}

async function handleFail() {
  const session = currentTab ? getSession(currentTab.id) : null;
  if (!session) return;
  const wasRunning = session.status === "running";
  reportFail(session);
  render(true);
  if (wasRunning && session.status === "blocked") {
    await runRecover(session);
  }
}

async function handleReinterpret() {
  const session = currentTab ? getSession(currentTab.id) : null;
  if (!session) return;
  const provider = getActiveProvider(settings);
  if (!provider) return;
  const goalText = session.goalText ?? "";
  uiMode = "resolving";
  render(true);
  const sig = (await captureSignature(currentTab.id).catch(() => null))?.signature ?? [];
  const hash = await structuralHash(sig).catch(() => null);
  resetForReinterpret(session, sig, hash);
  const ok = await resolveProcedure(session, provider, goalText);
  if (ok) await skipAlreadyPassed(session).catch(() => {});
  uiMode = "prompt";
  render(true);
  ensurePolling();
}

async function runRecover(session) {
  const provider = getActiveProvider(settings);
  const step = currentStep(session);
  if (!provider || !step) {
    session.recoverText = FALLBACK_MESSAGE;
    render(true);
    return;
  }
  let observed = {};
  if (step.verify?.probe && currentTab?.id) {
    try {
      const result = await probe(currentTab.id, { v: step.verify.probe });
      observed = result?.found ?? {};
    } catch {}
  }
  const text = await recoverExplain(provider, step, observed, session.attempts);
  if (getSession(currentTab?.id) === session) {
    session.recoverText = text;
    render(true);
  }
}

// ─── 폴링 ────────────────────────────────────────────────────────────────────

async function pollTick() {
  if (ticking || document.hidden) return;
  const session = currentTab ? getSession(currentTab.id) : null;
  if (!session) return;

  ticking = true;
  try {
    // tickStep 밖에서 done 이 된 경우(manual-advance 마지막 step 등) recipe 진행을 이어간다.
    if (session.status === "done") {
      const recipeSession = currentTab ? getRecipeSession(currentTab.id) : null;
      if (recipeSession?.status === "running") await handleGuidanceDone();
      return;
    }

    if (session.status === "entry") {
      const url = currentTab.url ?? "";
      if (url.startsWith("http://") || url.startsWith("https://")) {
        const granted = await hasOriginPermission(url);
        if (granted) await tryResolveCurrentTab();
      }
    } else if (session.status === "running") {
      const before = { stepIdx: session.stepIdx, status: session.status };
      await tickStep(session).catch(() => {});
      const changed =
        before.stepIdx !== session.stepIdx || before.status !== session.status;

      if (session.status === "done") {
        await handleGuidanceDone();
      } else if (!changed && session.status === "running") {
        const should = await checkShouldReinterpret(session).catch(() => false);
        if (should) await handleReinterpret();
      } else if (changed) {
        render(true);
      }
    }
  } finally {
    ticking = false;
  }
}

function ensurePolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(pollTick, POLL_MS);
}

// ─── 탭 감시 ─────────────────────────────────────────────────────────────────

async function refreshContext() {
  const prevId = currentTab?.id ?? null;
  const prevUrl = currentTab?.url ?? null;
  currentTab = await getActiveTab();

  if (currentTab?.id !== prevId) {
    uiMode = "prompt";
  }

  if (currentTab?.url !== prevUrl) {
    const session = currentTab ? getSession(currentTab.id) : null;
    if (session?.status === "entry") {
      injectProbe(currentTab.id).catch(() => {});
    }
  }

  render();
}

function attachWatchers() {
  chrome.tabs.onActivated.addListener(refreshContext);
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (currentTab?.id === tabId && (info.url || info.status === "complete")) {
      refreshContext();
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearSession(tabId);
    clearRecipeSession(tabId);
    if (currentTab?.id === tabId) refreshContext();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshContext();
  });
  onSettingsChanged((next) => {
    settings = next;
    render(true);
  });
}

// ─── 초기화 ──────────────────────────────────────────────────────────────────

async function init() {
  settings = await getSettings();
  attachWatchers();
  ensurePolling();
  await refreshContext();
}

init();
