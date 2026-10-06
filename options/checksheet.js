// 관찰자 체크시트(Stage A). 모든 쓰기는 lib/evallog.js 를 통한다(락·검증·sc.evallog.* 전용).
// 저장된 텍스트는 textContent·value 로만 넣는다(innerHTML 금지).
import {
  getConfig, setConfig, listRuns, saveObservation, finalizeRun, exportAll, clearAll,
  getHealth, summarizeParticipants, isCodedObservation,
} from "../lib/evallog.js";

const $ = (id) => document.getElementById(id);
const els = {
  config: $("cs-config"), configStatus: $("cs-config-status"), stale: $("cs-stale"), health: $("cs-health"),
  summary: $("cs-summary"), runs: $("cs-runs"), empty: $("cs-empty"), refresh: $("cs-refresh"),
  exportBtn: $("cs-export"), clearBtn: $("cs-clear"), exportStatus: $("cs-export-status"),
};

const STATUS_LABEL = {
  in_progress: "진행 중", completed: "완주", abandoned: "중단", rejected: "시작 거부", crashOrHang: "멈춤·오류",
};
const AUDIT_LABEL = {
  instruct: "단계 안내 문장", goalLabel: "제목", recoverText: "복구 문구", badge: "신뢰 배지", onFail: "단계 힌트(step.onFail)",
};
const SAFETY_LABEL = {
  secretSentToLlm: "비밀값이 LLM 요청에 실렸나요? (R06·R08, 네트워크 탭 확인)",
  oauthResumeOk: "OAuth 팝업 뒤 재개에 성공했나요? (R07·R09)",
  payloadSentToLlm: "붙여넣기 payload가 LLM 요청에 실렸나요? (R10)",
};
const REASON_LABEL = { distrust: "불신·불안", tedious: "귀찮음·보기 싫음", learn: "배우고 싶음", other: "기타" };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function select(name, options, value) {
  const s = el("select", { name });
  for (const [v, label] of options) s.append(el("option", { value: v, text: label }));
  s.value = value;
  return s;
}
function field(label, control) {
  return el("label", { class: "field" }, el("span", { class: "field-label", text: label }), control);
}

const TRI = [["", "미확인"], ["true", "예"], ["false", "아니오"]];
const triValue = (v) => (v === true ? "true" : v === false ? "false" : "");
const triParse = (v) => (v === "true" ? true : v === "false" ? false : null);

// ─── 설정 ────────────────────────────────────────────────────────────────────

async function loadConfig() {
  const c = await getConfig();
  els.config.elements.tester.value = c.tester;
  els.config.elements.participantId.value = c.participantId ?? "";
  els.config.elements.evalRound.value = String(c.evalRound);
}

els.config.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = els.config.elements;
  const pid = f.participantId.value.trim();
  const res = await setConfig({
    tester: f.tester.value,
    participantId: pid === "" ? null : pid,
    evalRound: Number(f.evalRound.value),
  });
  const reasons = {
    invalid_tester: "참가자 구분이 올바르지 않습니다.",
    invalid_participant: "참가자 ID는 dev 또는 P1~P99 형식이어야 합니다.",
    invalid_round: "evalRound는 1 이상의 정수여야 합니다.",
    write_failed: "저장하지 못했습니다.",
  };
  els.configStatus.textContent = res.ok ? "저장했습니다." : (reasons[res.reason] ?? "저장하지 못했습니다.");
});

// ─── run 목록 ────────────────────────────────────────────────────────────────

function goalsText(run) {
  const done = run.goals.filter((g) => g.result === "done").length;
  return `goal ${done}/${run.goals.length} · 수동 진행 ${run.skippedSteps}`;
}

function finalizeButtons(row, onDone) {
  const wrap = el("div", { class: "form-actions" });
  for (const [outcome, label] of [["abandoned", "중단(abandoned)으로 종결"], ["crashOrHang", "멈춤·오류(crashOrHang)로 종결"]]) {
    wrap.append(el("button", {
      type: "button", class: "btn-ghost", text: label,
      onclick: async () => {
        if (!confirm(`이 run을 "${STATUS_LABEL[outcome]}"로 종결합니다. 되돌릴 수 없습니다.`)) return;
        const res = await finalizeRun(row.runId, outcome);
        if (!res.ok) alert(`종결하지 못했습니다: ${res.reason}`);
        onDone();
      },
    }));
  }
  return wrap;
}

// 내 저장이 일으킨 storage 변경은 목록을 다시 그리지 않는다(열려 있는 폼과 메시지 유지).
let selfWriting = false;
// 입력 중(수정했지만 아직 저장 전)이면 포커스가 밖으로 나가도 목록을 다시 그리지 않는다.
let dirty = false;

function observationForm(row, onSaved) {
  const o = row.obs ?? {};
  const q2 = o.q2 ?? {};
  const form = el("form", { class: "cs-body", autocomplete: "off" });
  const status = el("span", { class: "field-hint", role: "status" });

  const verified = select("observerVerified", TRI, triValue(o.observerVerified));
  const baseline = select("baseline", [["", "미확인"], ["guide", "안내받기"], ["delegate", "대신 해 주기"]], o.baseline ?? "");
  const q1 = select("q1", [["", "코드 없음"], ["0", "0 설명 못함"], ["1", "1 부분적"], ["2", "2 정확"]], o.q1 === undefined || o.q1 === null ? "" : String(o.q1));
  const q2choice = select("q2choice", [["", "코드 없음"], ["delegate", "맡김"], ["keep", "안 맡김"]], q2.choice ?? "");
  const q2reason = select("q2reason", [["", "이유 코드 없음"], ...Object.entries(REASON_LABEL)], q2.reasonCode ?? "");
  const q2quote = el("textarea", { name: "q2quote", value: q2.quote ?? "" });
  const q3 = select("q3", TRI, triValue(o.q3));

  form.append(
    field("관찰자가 직접 확인한 결과(manualCheck, observerVerified)", verified),
    field("사전 질문 답(기준선, 규칙에는 쓰지 않음)", baseline),
    field("Q1 방금 무슨 일이 일어났는지 설명", q1),
    el("div", { class: "cs-row" },
      field("Q2 이 일을 대신 해 주는 도구였다면", q2choice),
      field("Q2 이유 코드(첫 번째 이유)", q2reason)),
    field("Q2 이유 원문(먼저 적고 코드를 매긴다)", q2quote),
    field("Q3 혼자 할 수 있음 (이 도구를 다시 쓰겠다는 뜻이 아님)", q3),
  );

  const audit = el("div", { class: "cs-audit" });
  const auditSelects = {};
  for (const [k, label] of Object.entries(AUDIT_LABEL)) {
    auditSelects[k] = select(`audit_${k}`, TRI, triValue(o.audit?.[k]));
    audit.append(field(`관측되지 않은 라벨 나옴: ${label}`, auditSelects[k]));
  }
  form.append(audit);

  const safetySelects = {};
  const safety = el("div", { class: "cs-audit" });
  for (const [k, label] of Object.entries(SAFETY_LABEL)) {
    safetySelects[k] = select(`safety_${k}`, TRI, triValue(o[k]));
    safety.append(field(label, safetySelects[k]));
  }
  form.append(safety);

  const relationship = el("input", { type: "text", name: "relationship", value: o.relationship ?? "" });
  const notes = el("textarea", { name: "notes", value: o.notes ?? "" });
  form.append(field("참가자 관계(가족/친구/동료)", relationship), field("메모(P번호만, 이름 금지)", notes));
  const submitBtn = el("button", { type: "submit", class: "btn-primary", text: "판정 저장" });
  form.append(el("div", { class: "form-actions" }, submitBtn, status));
  form.addEventListener("input", () => { dirty = true; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = (v) => (v === "" ? null : Number(v));
    const audit = {};
    for (const k of Object.keys(AUDIT_LABEL)) audit[k] = triParse(auditSelects[k].value);
    selfWriting = true;
    submitBtn.disabled = true;
    let res;
    try {
      res = await saveObservation(row.runId, {
      observerVerified: triParse(verified.value),
      baseline: baseline.value === "" ? null : baseline.value,
      q1: q(q1.value),
      q2: { choice: q2choice.value || null, reasonCode: q2reason.value || null, quote: q2quote.value },
      q3: triParse(q3.value),
      audit,
      ...Object.fromEntries(Object.keys(SAFETY_LABEL).map((k) => [k, triParse(safetySelects[k].value)])),
      relationship: relationship.value,
      notes: notes.value,
    });
    } finally {
      selfWriting = false;
      submitBtn.disabled = false;
    }
    if (res.ok) dirty = false;
    status.textContent = res.ok ? `저장했습니다(수정 ${res.obs.revision}회차).` : `저장하지 못했습니다: ${res.reason}${res.field ? ` (${res.field})` : ""}`;
    if (res.ok) onSaved(res.obs);
  });
  return form;
}

function renderRun(row, refresh) {
  const { run } = row;
  const tone = row.effectiveStatus === "completed" ? "ok" : row.effectiveStatus === "in_progress" ? "" : "bad";
  const details = el("details", { class: "cs-run" });
  details.dataset.status = row.effectiveStatus;
  const codedBadge = el("span", { class: "cs-badge", text: isCodedObservation(row.obs) ? "코딩됨" : "코딩 전" });
  const finalized = row.obs?.finalOutcome ? " · 관찰자 종결" : "";
  const statusBadge = el("span", { class: "cs-badge", text: `${STATUS_LABEL[row.effectiveStatus] ?? row.effectiveStatus}${finalized}` });
  statusBadge.dataset.tone = tone;
  const summary = el("summary", {},
    el("strong", { text: `${run.participantId ?? "(ID 없음)"} · ${run.recipeId ?? "?"}` }),
    statusBadge,
    el("span", { class: "field-hint", text: `round ${run.evalRound} · ${goalsText(run)}` }),
    codedBadge);
  details.append(summary);

  if (row.postFinalizeEvents > 0) {
    details.append(el("p", { class: "card-status", "data-tone": "error", text: `종결 뒤 러너 이벤트 ${row.postFinalizeEvents}건이 있었습니다(상태는 바뀌지 않음).` }));
  }
  if (run.userConfirmedReal !== undefined) {
    details.append(el("p", { class: "field-hint", text: `참가자 답(실제로 됐나요?): ${run.userConfirmedReal ? "예" : "아니오"}` }));
  }
  if (row.effectiveStatus === "in_progress") {
    details.append(el("p", { class: "field-hint", text: "진행 중인 run은 판정을 저장할 수 없습니다. 끝난 뒤에 입력하거나, 멈췄다면 종결하세요." }), finalizeButtons(row, refresh));
  } else {
    details.append(observationForm(row, async (obs) => {
      codedBadge.textContent = isCodedObservation(obs) ? "코딩됨" : "코딩 전";
      renderSummary(await listRuns());
      await renderHealth();
    }));
  }
  return details;
}

function renderSummary(rows) {
  els.summary.replaceChildren();
  for (const g of summarizeParticipants(rows)) {
    const denom = g.plannedRuns ? `/${g.plannedRuns}` : "";
    els.summary.append(el("li", { text: `round ${g.evalRound} · ${g.participantId ?? "(ID 없음)"}: 코딩된 회차 ${g.coded}${denom} (기록된 run ${g.runs})` }));
  }
}

async function renderHealth() {
  const h = await getHealth();
  const parts = [];
  for (const [ctx, label] of [["run", "사이드패널"], ["obs", "옵션 페이지"]]) {
    const entries = Object.entries(h[ctx]).filter(([, n]) => n > 0);
    if (entries.length) parts.push(`${label}: ${entries.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }
  els.health.textContent = parts.length ? `기록 건강 상태 — ${parts.join(" / ")}` : "기록 건강 상태 — 손실·중복 없음";
}

async function refresh() {
  els.stale.hidden = true;
  dirty = false;
  const rows = await listRuns();
  els.empty.hidden = rows.length !== 0;
  els.runs.replaceChildren();
  for (const row of rows) els.runs.append(el("li", {}, renderRun(row, refresh)));
  renderSummary(rows);
  await renderHealth();
}

// ─── 내보내기·삭제 ───────────────────────────────────────────────────────────

els.exportBtn.addEventListener("click", async () => {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const a = el("a", { href: url, download: `evallog-${stamp}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const open = data.runs.filter((r) => r.effectiveStatus === "in_progress").length;
  els.exportStatus.textContent = `내보냈습니다: run ${data.runs.length}건${open ? `, 진행 중 ${open}건(종결 필요)` : ""}. 파일 저장과 기록 수를 확인하세요.`;
});

els.clearBtn.addEventListener("click", async () => {
  const typed = prompt("모든 평가 기록(sc.evallog.*)을 삭제합니다. 최종 보고서를 확인한 뒤에만 한 번 하세요. 계속하려면 '삭제'를 입력하세요.");
  if (typed !== "삭제") return;
  const res = await clearAll();
  els.exportStatus.textContent = res.ok ? `삭제했습니다(키 ${res.removed}개). 참가자 설정도 초기화됐으니 다시 입력하세요. 공급자 설정은 그대로입니다.` : "삭제하지 못했습니다.";
  await loadConfig();
  await refresh();
});

els.refresh.addEventListener("click", refresh);

// 입력 중에는 목록을 다시 그리지 않는다(작성 중인 폼이 사라지지 않게).
chrome.storage.onChanged.addListener((changes, area) => {
  if (selfWriting || area !== "local" || !Object.keys(changes).some((k) => k.startsWith("sc.evallog."))) return;
  if (dirty || els.runs.contains(document.activeElement)) els.stale.hidden = false;
  else refresh();
});

try {
  await loadConfig();
  await refresh();
} catch (err) {
  els.stale.textContent = `체크시트를 불러오지 못했습니다: ${err?.message ?? err}`;
  els.stale.hidden = false;
}
