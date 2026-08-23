import { getSettings, getActiveProvider, onSettingsChanged } from "../lib/storage.js";
import { loadPacks, findPackForUrl, urlMatchesPack, findGoal, getProcedure } from "../lib/catalog.js";
import {
  getSession,
  clearSession,
  startSession,
  currentProcedure,
  currentStep,
  tickStep,
  skipAlreadyPassed,
  checkEntryReady,
  reportFail,
  restartSession,
  setEntryStatus,
  setRunningStatus,
} from "../lib/engine.js";
import {
  getActiveTab,
  isProbeableUrl,
  hasOriginPermission,
  requestOriginPermission,
  injectProbe,
  probe,
  highlight,
} from "../lib/probe-client.js";
import { classify, REFUSE_MESSAGE, CHOOSE_MESSAGE } from "../lib/router.js";
import { explain as recoverExplain, FALLBACK_MESSAGE } from "../lib/recover.js";

const els = {
  root: document.getElementById("state-slot"),
  banner: document.getElementById("draft-banner"),
  templates: {
    "no-provider": document.getElementById("tpl-no-provider"),
    "no-pack": document.getElementById("tpl-no-pack"),
    "ready": document.getElementById("tpl-ready"),
    "entry": document.getElementById("tpl-entry"),
    "running": document.getElementById("tpl-running"),
    "blocked": document.getElementById("tpl-blocked"),
    "done": document.getElementById("tpl-done"),
  },
};

const POLL_MS = 1000;

let settings = null;
let packs = [];
let currentTab = null;
let currentPack = null;
let renderedKey = null;
let pollTimer = null;
let ticking = false;
let readyMode = { kind: "default" };
let routerBusy = false;

function computeStateKind() {
  if (!settings) return "loading";
  if (!settings.activeProviderId) return "no-provider";
  if (!currentTab || !isProbeableUrl(currentTab.url)) return "no-pack";
  if (!currentPack) return "no-pack";
  const session = getSession(currentTab.id);
  if (!session) return "ready";
  if (!urlMatchesPack(currentPack, currentTab.url)) return "entry";
  if (session.status === "done") return "done";
  if (session.status === "blocked") return "blocked";
  if (session.status === "entry") return "entry";
  return "running";
}

function cloneTemplate(kind) {
  const tpl = els.templates[kind];
  return tpl.content.firstElementChild.cloneNode(true);
}

function renderKey(kind) {
  const session = currentTab ? getSession(currentTab.id) : null;
  return JSON.stringify({
    kind,
    tab: currentTab?.id ?? null,
    url: currentTab?.url ?? null,
    packId: currentPack?.id ?? null,
    goalId: session?.goalId ?? null,
    procIdx: session?.procIdx ?? null,
    stepIdx: session?.stepIdx ?? null,
    attempts: session?.attempts ?? null,
    status: session?.status ?? null,
    recoverText: session?.recoverText ?? null,
    activeProviderId: settings?.activeProviderId ?? null,
    readyMode: readyMode.kind,
    readyIds: readyMode.kind === "choose" ? readyMode.ids.join(",") : null,
    routerBusy,
  });
}

function render(force = false) {
  const kind = computeStateKind();
  const key = renderKey(kind);
  if (!force && key === renderedKey) return;
  renderedKey = key;

  els.banner.hidden = !(currentPack?.draft && kind !== "no-pack" && kind !== "no-provider");
  els.root.innerHTML = "";
  if (kind === "loading") return;

  const node = cloneTemplate(kind);
  if (kind === "no-provider") renderNoProvider(node);
  else if (kind === "no-pack") renderNoPack(node);
  else if (kind === "ready") renderReady(node);
  else if (kind === "entry") renderEntry(node);
  else if (kind === "running") renderRunning(node);
  else if (kind === "blocked") renderBlocked(node);
  else if (kind === "done") renderDone(node);

  els.root.appendChild(node);
}

function renderNoProvider(node) {
  node.querySelector('[data-action="open-options"]').addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderNoPack(node) {
  const list = node.querySelector('[data-slot="sites"]');
  for (const pack of packs) {
    const li = document.createElement("li");
    li.className = "site-item";
    li.innerHTML = `
      <span>
        <span class="site-label"></span>
        ${pack.draft ? '<span class="site-draft">draft</span>' : ""}
      </span>
      <button type="button" class="btn-ghost">열기</button>
    `;
    li.querySelector(".site-label").textContent = pack.label;
    li.querySelector("button").addEventListener("click", async () => {
      await openEntryUrl(pack);
    });
    list.appendChild(li);
  }
}

function renderReady(node) {
  const lede = node.querySelector('[data-slot="lede"]');
  if (readyMode.kind === "refuse") lede.textContent = REFUSE_MESSAGE;
  else if (readyMode.kind === "choose") lede.textContent = CHOOSE_MESSAGE;

  const form = node.querySelector('[data-slot="form"]');
  const input = node.querySelector('[data-slot="input"]');
  const submit = node.querySelector('[data-slot="submit"]');
  if (routerBusy) {
    input.disabled = true;
    submit.disabled = true;
    submit.textContent = "확인 중…";
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    handleRouteSubmit(text);
  });

  const chips = node.querySelector('[data-slot="chips"]');
  const goals = readyMode.kind === "choose"
    ? readyMode.ids.map((id) => currentPack.goals.find((g) => g.id === id)).filter(Boolean)
    : currentPack.goals;
  for (const goal of goals) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = goal.label;
    btn.addEventListener("click", () => handleChipClick(goal.id));
    chips.appendChild(btn);
  }
}

function renderEntry(node) {
  node.querySelector('[data-slot="note"]').textContent =
    currentPack.entry.note ?? currentPack.entry.url;
  const btn = node.querySelector('[data-action="go-entry"]');
  btn.textContent = currentPack.entry.label;
  btn.addEventListener("click", () => openEntryUrl(currentPack));
}

function renderRail(container, proc, session) {
  container.innerHTML = "";
  const total = proc.steps.length;
  for (let i = 0; i < total; i++) {
    const node = document.createElement("li");
    node.className = "rail-node";
    node.dataset.state = i < session.stepIdx ? "pass" : i === session.stepIdx ? "current" : "pending";
    container.appendChild(node);
    if (i < total - 1) {
      const c = document.createElement("li");
      c.className = "rail-connector";
      c.dataset.state = i < session.stepIdx ? "pass" : "pending";
      container.appendChild(c);
    }
  }
}

function renderRunning(node) {
  const session = getSession(currentTab.id);
  const { proc, goal } = currentProcedure(currentPack, session);
  const step = currentStep(currentPack, session);
  if (!proc || !step) return;

  renderRail(node.querySelector('[data-slot="rail"]'), proc, session);
  node.querySelector('[data-slot="proc-index"]').textContent =
    `${session.procIdx + 1} / ${goal.procedures.length}`;
  node.querySelector('[data-slot="proc-title"]').textContent = proc.label;
  node.querySelector('[data-slot="instruct"]').textContent = step.instruct;

  const locateBtn = node.querySelector('[data-slot="locate-btn"]');
  if (!step.locate) locateBtn.disabled = true;
  locateBtn.addEventListener("click", () => handleLocate(step, proc));

  const failBtn = node.querySelector('[data-action="fail"]');
  failBtn.addEventListener("click", handleFail);

  if (session.attempts >= 1) {
    const hint = node.querySelector('[data-slot="hint"]');
    hint.hidden = false;
    hint.textContent = step.onFail;
  }
}

function renderBlocked(node) {
  const session = getSession(currentTab.id);
  const { proc, goal } = currentProcedure(currentPack, session);
  const step = currentStep(currentPack, session);
  if (!proc || !step) return;

  renderRail(node.querySelector('[data-slot="rail"]'), proc, session);
  node.querySelector('[data-slot="proc-index"]').textContent =
    `${session.procIdx + 1} / ${goal.procedures.length}`;
  node.querySelector('[data-slot="proc-title"]').textContent = proc.label;
  node.querySelector('[data-slot="instruct"]').textContent = step.instruct;

  const recoverEl = node.querySelector('[data-slot="recover"]');
  if (session.recoverText) recoverEl.textContent = session.recoverText;

  node.querySelector('[data-action="manual"]').addEventListener("click", () => {
    const s = getSession(currentTab.id);
    if (!s) return;
    s.status = "running";
    s.attempts = 0;
    s.recoverText = null;
    render(true);
    ensurePolling();
  });
  node.querySelector('[data-action="restart"]').addEventListener("click", () => {
    const s = getSession(currentTab.id);
    if (!s) return;
    restartSession(s);
    s.recoverText = null;
    render(true);
    ensurePolling();
  });
}

function renderDone(node) {
  const session = getSession(currentTab.id);
  const goal = findGoal(currentPack, session.goalId);
  const list = node.querySelector('[data-slot="completed"]');
  for (const procId of goal.procedures) {
    const proc = getProcedure(currentPack, procId);
    if (!proc) continue;
    const li = document.createElement("li");
    li.textContent = proc.label;
    list.appendChild(li);
  }
  node.querySelector('[data-action="restart"]').addEventListener("click", () => {
    clearSession(currentTab.id);
    readyMode = { kind: "default" };
    render(true);
  });
}

async function openEntryUrl(pack) {
  if (!currentTab?.id) return;
  const granted = await ensureOriginGranted(pack.entry.url);
  if (!granted) return;
  await chrome.tabs.update(currentTab.id, { url: pack.entry.url });
}

async function ensureOriginGranted(url) {
  if (await hasOriginPermission(url)) return true;
  return requestOriginPermission(url);
}

async function handleChipClick(goalId) {
  if (!currentTab?.url || !currentPack) return;
  const granted = await ensureOriginGranted(currentTab.url);
  if (!granted) return;
  try {
    await injectProbe(currentTab.id);
  } catch (e) {
    console.warn("[setup-copilot] probe 주입 실패", e);
  }
  const session = startSession(currentTab.id, currentPack, goalId);
  const entryOk = await checkEntryReady(currentPack, currentTab.id).catch(() => false);
  if (!entryOk) {
    setEntryStatus(session);
  } else {
    try {
      await skipAlreadyPassed(currentPack, session);
    } catch (e) {
      console.warn("[setup-copilot] 초기 스킵 실패", e);
    }
  }
  render(true);
  ensurePolling();
}

async function handleLocate(step, proc) {
  if (!step.locate) return;
  const locator = proc.probes?.[step.locate];
  if (!locator) return;
  try {
    await highlight(currentTab.id, locator);
  } catch (e) {
    console.warn("[setup-copilot] 하이라이트 실패", e);
  }
}

async function handleFail() {
  const session = getSession(currentTab.id);
  if (!session) return;
  const before = session.status;
  reportFail(session);
  render(true);
  if (before !== "blocked" && session.status === "blocked") {
    await runRecover(session);
  }
}

async function fetchObserved(session) {
  const { proc } = currentProcedure(currentPack, session);
  const probes = proc?.probes ?? {};
  if (!Object.keys(probes).length) return {};
  try {
    const result = await probe(session.tabId, probes);
    return result?.found ?? {};
  } catch {
    return {};
  }
}

async function runRecover(session) {
  const provider = getActiveProvider(settings);
  const step = currentStep(currentPack, session);
  if (!provider || !step) {
    session.recoverText = FALLBACK_MESSAGE;
    render(true);
    return;
  }
  const observed = await fetchObserved(session);
  const text = await recoverExplain(provider, step, observed, session.attempts);
  const active = getSession(currentTab?.id);
  if (active !== session) return;
  session.recoverText = text;
  render(true);
}

async function handleRouteSubmit(userText) {
  if (routerBusy) return;
  const provider = getActiveProvider(settings);
  if (!provider || !currentPack) {
    readyMode = { kind: "refuse" };
    render(true);
    return;
  }
  routerBusy = true;
  render(true);
  try {
    const result = await classify(provider, currentPack, userText);
    if (result.kind === "goal") {
      readyMode = { kind: "default" };
      routerBusy = false;
      await handleChipClick(result.id);
      return;
    }
    if (result.kind === "choose") readyMode = { kind: "choose", ids: result.ids };
    else readyMode = { kind: "refuse" };
  } finally {
    routerBusy = false;
    render(true);
  }
}

async function pollTick() {
  if (ticking) return;
  if (document.hidden) return;
  const session = currentTab ? getSession(currentTab.id) : null;
  if (!session) return;
  if (session.status !== "running" && session.status !== "entry") return;

  ticking = true;
  try {
    if (session.status === "entry") {
      if (urlMatchesPack(currentPack, currentTab.url)) {
        const ok = await checkEntryReady(currentPack, currentTab.id).catch(() => false);
        if (ok) {
          setRunningStatus(session);
          await skipAlreadyPassed(currentPack, session).catch(() => {});
          render(true);
        }
      }
    } else if (session.status === "running") {
      const before = { procIdx: session.procIdx, stepIdx: session.stepIdx, status: session.status };
      await tickStep(currentPack, session).catch(() => {});
      if (
        before.procIdx !== session.procIdx ||
        before.stepIdx !== session.stepIdx ||
        before.status !== session.status
      ) {
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

async function refreshContext() {
  const prevTabId = currentTab?.id ?? null;
  const prevUrl = currentTab?.url ?? null;
  currentTab = await getActiveTab();
  if (currentTab?.id !== prevTabId || currentTab?.url !== prevUrl) {
    readyMode = { kind: "default" };
    routerBusy = false;
  }
  const session = currentTab ? getSession(currentTab.id) : null;
  if (session) {
    currentPack = packs.find((p) => p.id === session.packId) ?? null;
    if (
      currentPack &&
      session.status === "running" &&
      !urlMatchesPack(currentPack, currentTab.url)
    ) {
      setEntryStatus(session);
    }
  } else {
    currentPack = currentTab ? findPackForUrl(packs, currentTab.url) : null;
  }
  render();
}

function attachChromeWatchers() {
  chrome.tabs.onActivated.addListener(refreshContext);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (currentTab?.id === tabId && (changeInfo.url || changeInfo.status === "complete")) {
      refreshContext();
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearSession(tabId);
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

async function init() {
  settings = await getSettings();
  packs = await loadPacks();
  attachChromeWatchers();
  ensurePolling();
  await refreshContext();
  console.info("[setup-copilot] panel loaded", { packs: packs.length });
}

init();
