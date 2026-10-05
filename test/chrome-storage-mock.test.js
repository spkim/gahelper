import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installChromeMock } from "./helpers/chrome-storage-mock.js";

const mock = installChromeMock();

describe("chrome-storage-mock", () => {
  beforeEach(() => mock.reset());

  it("local은 실제로 읽고 쓴다", async () => {
    await chrome.storage.local.set({ a: 1, b: { c: 2 } });
    assert.deepEqual(await chrome.storage.local.get("a"), { a: 1 });
    assert.deepEqual(await chrome.storage.local.get(["a", "b", "none"]), { a: 1, b: { c: 2 } });
    assert.deepEqual(await chrome.storage.local.get(null), { a: 1, b: { c: 2 } });
    assert.deepEqual(await chrome.storage.local.get({ a: 9, z: 7 }), { a: 1, z: 7 });
  });

  it("session과 local은 서로 분리된다", async () => {
    await chrome.storage.session.set({ k: "s" });
    await chrome.storage.local.set({ k: "l" });
    assert.equal((await chrome.storage.session.get("k")).k, "s");
    assert.equal((await chrome.storage.local.get("k")).k, "l");
  });

  it("값은 복제되어 저장·반환된다(참조 공유 없음)", async () => {
    const obj = { list: [1] };
    await chrome.storage.local.set({ obj });
    obj.list.push(2);
    const got = await chrome.storage.local.get("obj");
    assert.deepEqual(got.obj.list, [1]);
    got.obj.list.push(3);
    assert.deepEqual((await chrome.storage.local.get("obj")).obj.list, [1]);
  });

  it("없는 키는 결과에 없다", async () => {
    assert.deepEqual(await chrome.storage.local.get("missing"), {});
  });

  it("remove·clear가 동작한다", async () => {
    await chrome.storage.local.set({ a: 1, b: 2, c: 3 });
    await chrome.storage.local.remove("a");
    await chrome.storage.local.remove(["b"]);
    assert.deepEqual(await chrome.storage.local.get(null), { c: 3 });
    await chrome.storage.local.clear();
    assert.deepEqual(await chrome.storage.local.get(null), {});
  });

  it("onChanged가 areaName과 oldValue/newValue를 전달한다", async () => {
    const seen = [];
    const fn = (changes, area) => seen.push({ changes, area });
    chrome.storage.onChanged.addListener(fn);
    await chrome.storage.local.set({ x: 1 });
    await chrome.storage.local.set({ x: 2 });
    await chrome.storage.session.set({ y: 1 });
    await chrome.storage.local.remove("x");
    chrome.storage.onChanged.removeListener(fn);
    await chrome.storage.local.set({ x: 3 });
    assert.deepEqual(seen, [
      { changes: { x: { newValue: 1 } }, area: "local" },
      { changes: { x: { oldValue: 1, newValue: 2 } }, area: "local" },
      { changes: { y: { newValue: 1 } }, area: "session" },
      { changes: { x: { oldValue: 2 } }, area: "local" },
    ]);
  });

  it("seed·dump는 이벤트 없이 상태를 다룬다", async () => {
    let fired = 0;
    chrome.storage.onChanged.addListener(() => fired++);
    mock.local.seed({ a: { b: 1 } });
    assert.deepEqual(mock.local.dump(), { a: { b: 1 } });
    assert.equal(fired, 0);
  });
});
