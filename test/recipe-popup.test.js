import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers/chrome-storage-mock.js";

installChromeMock();

import {
  createRecipeSession,
  getRecipeSession,
  pauseForPopup,
  resumeFromPopup,
  getSessionForPopup,
  clearRecipeSession,
} from "../lib/recipe-engine.js";

// 테스트용 tabId 상수
const TAB = 10;
const POPUP_TAB = 99;

describe("popup pause/resume 상태 머신", () => {
  beforeEach(async () => {
    await clearRecipeSession(TAB);
    await clearRecipeSession(POPUP_TAB);
  });

  it("running → paused: pauseForPopup 후 status=paused, popupTabId 기록", async () => {
    await createRecipeSession(TAB, "R01");
    await pauseForPopup(TAB, POPUP_TAB);
    const s = getRecipeSession(TAB);
    assert.equal(s.status, "paused");
    assert.equal(s.popupTabId, POPUP_TAB);
  });

  it("paused → running: resumeFromPopup 후 status=running, popupTabId=null", async () => {
    await createRecipeSession(TAB, "R01");
    await pauseForPopup(TAB, POPUP_TAB);
    await resumeFromPopup(TAB);
    const s = getRecipeSession(TAB);
    assert.equal(s.status, "running");
    assert.equal(s.popupTabId, null);
  });

  it("첫 번째 resumeFromPopup → true 반환", async () => {
    await createRecipeSession(TAB, "R01");
    await pauseForPopup(TAB, POPUP_TAB);
    const result = await resumeFromPopup(TAB);
    assert.equal(result, true);
  });

  it("이중 호출 방어: 두 번째 resumeFromPopup → false 반환 (status 변화 없음)", async () => {
    await createRecipeSession(TAB, "R01");
    await pauseForPopup(TAB, POPUP_TAB);
    await resumeFromPopup(TAB);           // 첫 번째 — status = running
    const second = await resumeFromPopup(TAB); // 두 번째 — no-op
    assert.equal(second, false);
    const s = getRecipeSession(TAB);
    assert.equal(s.status, "running");
  });

  it("paused 아닌 세션에 resumeFromPopup → false 반환", async () => {
    await createRecipeSession(TAB, "R01");
    const result = await resumeFromPopup(TAB); // running 상태
    assert.equal(result, false);
    const s = getRecipeSession(TAB);
    assert.equal(s.status, "running");
  });
});

describe("getSessionForPopup 역방향 조회", () => {
  beforeEach(async () => {
    await clearRecipeSession(TAB);
  });

  it("popupTabId 로 원래 탭 세션을 찾을 수 있다", async () => {
    await createRecipeSession(TAB, "R01");
    await pauseForPopup(TAB, POPUP_TAB);
    const result = getSessionForPopup(POPUP_TAB);
    assert.ok(result);
    assert.equal(result.tabId, TAB);
    assert.equal(result.session.popupTabId, POPUP_TAB);
  });

  it("popupTabId 가 없으면 null 반환", () => {
    const result = getSessionForPopup(9999);
    assert.equal(result, null);
  });
});

describe("isValidSession — paused 상태 복구", () => {
  it("status=paused + popupTabId=숫자 → 복구 가능 (스키마 유효)", async () => {
    await createRecipeSession(TAB, "R01");
    await pauseForPopup(TAB, POPUP_TAB);
    const s = getRecipeSession(TAB);
    // isValidSession 조건: status in ['running','done','blocked','paused'] + popupTabId number|null
    assert.equal(s.status, "paused");
    assert.equal(typeof s.popupTabId, "number");
  });

  it("createRecipeSession 기본값: popupTabId=null", async () => {
    await clearRecipeSession(TAB);
    await createRecipeSession(TAB, "R01");
    const s = getRecipeSession(TAB);
    assert.equal(s.popupTabId, null);
  });
});
