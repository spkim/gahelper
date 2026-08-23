import {
  getSettings,
  upsertProvider,
  deleteProvider,
  setActiveProvider,
  onSettingsChanged,
} from "../lib/storage.js";
import { testConnection, DEFAULT_MODELS, KIND_LABELS } from "../lib/providers.js";

const els = {
  list: document.getElementById("providers-list"),
  empty: document.getElementById("providers-empty"),
  btnShowAdd: document.getElementById("btn-show-add"),
  formSection: document.getElementById("form-section"),
  formTitle: document.getElementById("form-title"),
  form: document.getElementById("provider-form"),
  fieldBaseUrl: document.getElementById("field-baseurl"),
  btnCancel: document.getElementById("btn-cancel"),
  btnToggleVisibility: document.getElementById("btn-toggle-visibility"),
};

let editingId = null;

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

function renderProviders(settings) {
  const providers = settings.providers ?? [];
  els.empty.hidden = providers.length !== 0;
  els.list.innerHTML = "";

  for (const p of providers) {
    const isActive = p.id === settings.activeProviderId;
    const li = document.createElement("li");
    li.className = "provider-card";
    li.dataset.active = String(isActive);
    li.dataset.id = p.id;

    const showBaseUrl = p.kind === "compatible" && !!p.baseUrl;
    li.innerHTML = `
      <div class="card-head">
        <span class="card-label"></span>
        <span class="card-kind"></span>
        ${isActive ? '<span class="active-badge">활성</span>' : ""}
      </div>
      <dl class="card-meta">
        <div><dt>모델</dt><dd class="mono" data-slot="model"></dd></div>
        <div><dt>API 키</dt><dd class="mono" data-slot="apiKey"></dd></div>
        ${showBaseUrl ? '<div><dt>Base URL</dt><dd class="mono" data-slot="baseUrl"></dd></div>' : ""}
      </dl>
      <p class="card-status" hidden></p>
      <div class="card-actions">
        ${isActive ? "" : '<button type="button" data-action="activate" class="btn-ghost">활성화</button>'}
        <button type="button" data-action="test" class="btn-ghost">연결 테스트</button>
        <button type="button" data-action="edit" class="btn-ghost">편집</button>
        <button type="button" data-action="delete" class="btn-danger">삭제</button>
      </div>
    `;

    li.querySelector(".card-label").textContent = p.label;
    li.querySelector(".card-kind").textContent = KIND_LABELS[p.kind] ?? p.kind;
    li.querySelector('[data-slot="model"]').textContent = p.model;
    li.querySelector('[data-slot="apiKey"]').textContent = maskKey(p.apiKey);
    if (showBaseUrl) li.querySelector('[data-slot="baseUrl"]').textContent = p.baseUrl;

    els.list.appendChild(li);
  }
}

function toggleBaseUrlField(kind) {
  const show = kind === "compatible";
  els.fieldBaseUrl.hidden = !show;
  els.form.elements.baseUrl.required = show;
}

function setKeyVisibility(shown) {
  els.form.elements.apiKey.type = shown ? "text" : "password";
  els.btnToggleVisibility.textContent = shown ? "숨기기" : "보기";
}

function openForm({ mode, provider }) {
  editingId = provider?.id ?? null;
  els.formTitle.textContent = mode === "edit" ? "공급자 편집" : "공급자 추가";
  els.form.reset();

  const kind = provider?.kind ?? "anthropic";
  els.form.elements.label.value = provider?.label ?? "";
  els.form.elements.kind.value = kind;
  els.form.elements.model.value = provider?.model ?? DEFAULT_MODELS[kind] ?? "";
  els.form.elements.baseUrl.value = provider?.baseUrl ?? "";
  els.form.elements.apiKey.value = provider?.apiKey ?? "";

  setKeyVisibility(false);
  toggleBaseUrlField(kind);

  els.formSection.hidden = false;
  els.form.elements.label.focus();
  els.formSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeForm() {
  editingId = null;
  els.form.reset();
  setKeyVisibility(false);
  els.formSection.hidden = true;
}

async function handleSubmit(evt) {
  evt.preventDefault();
  const data = new FormData(els.form);
  const kind = String(data.get("kind") ?? "");
  const label = String(data.get("label") ?? "").trim();
  const model = String(data.get("model") ?? "").trim();
  const apiKey = String(data.get("apiKey") ?? "").trim();
  const baseUrl = String(data.get("baseUrl") ?? "").trim();

  if (!label || !model || !apiKey) return;
  if (kind === "compatible" && !baseUrl) return;

  const provider = {
    id: editingId ?? crypto.randomUUID(),
    label,
    kind,
    model,
    apiKey,
    ...(kind === "compatible" ? { baseUrl } : {}),
  };

  await upsertProvider(provider);
  closeForm();
}

async function handleListClick(evt) {
  const btn = evt.target.closest("button[data-action]");
  if (!btn) return;
  const card = btn.closest(".provider-card");
  if (!card) return;

  const providerId = card.dataset.id;
  const action = btn.dataset.action;
  const settings = await getSettings();
  const provider = settings.providers.find((p) => p.id === providerId);
  if (!provider) return;

  if (action === "activate") {
    await setActiveProvider(providerId);
    return;
  }

  if (action === "delete") {
    if (!confirm(`"${provider.label}" 공급자를 삭제할까요?`)) return;
    await deleteProvider(providerId);
    return;
  }

  if (action === "edit") {
    openForm({ mode: "edit", provider });
    return;
  }

  if (action === "test") {
    const status = card.querySelector(".card-status");
    status.hidden = false;
    delete status.dataset.tone;
    status.textContent = "연결 중…";
    btn.disabled = true;
    try {
      const result = await testConnection(provider);
      status.dataset.tone = "success";
      status.textContent = `연결 성공${result.reply ? ` — 응답: ${result.reply}` : ""}`;
    } catch (err) {
      status.dataset.tone = "error";
      status.textContent = err?.message ?? "연결에 실패했습니다.";
    } finally {
      btn.disabled = false;
    }
  }
}

async function init() {
  els.btnShowAdd.addEventListener("click", () => openForm({ mode: "add" }));
  els.btnCancel.addEventListener("click", closeForm);
  els.form.addEventListener("submit", handleSubmit);

  els.form.elements.kind.addEventListener("change", (e) => {
    const kind = e.target.value;
    toggleBaseUrlField(kind);
    const modelInput = els.form.elements.model;
    if (!modelInput.value || Object.values(DEFAULT_MODELS).includes(modelInput.value)) {
      modelInput.value = DEFAULT_MODELS[kind] ?? "";
    }
  });

  els.btnToggleVisibility.addEventListener("click", () => {
    setKeyVisibility(els.form.elements.apiKey.type === "password");
  });

  els.list.addEventListener("click", handleListClick);

  onSettingsChanged(renderProviders);
  renderProviders(await getSettings());
}

init();
