import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getRegisteredDomain, sameRegisteredDomain } from "../lib/registered-domain.js";

describe("getRegisteredDomain", () => {
  it("accounts.google.com → google.com", () => {
    assert.equal(getRegisteredDomain("accounts.google.com"), "google.com");
  });

  it("mail.google.com → google.com", () => {
    assert.equal(getRegisteredDomain("mail.google.com"), "google.com");
  });

  it("app.n8n.cloud → n8n.cloud", () => {
    assert.equal(getRegisteredDomain("app.n8n.cloud"), "n8n.cloud");
  });

  it("n8n.cloud → n8n.cloud", () => {
    assert.equal(getRegisteredDomain("n8n.cloud"), "n8n.cloud");
  });

  it("chatgpt.com → chatgpt.com", () => {
    assert.equal(getRegisteredDomain("chatgpt.com"), "chatgpt.com");
  });

  it("2단계 TLD co.kr: foo.co.kr → foo.co.kr", () => {
    assert.equal(getRegisteredDomain("foo.co.kr"), "foo.co.kr");
  });

  it("2단계 TLD co.kr: sub.foo.co.kr → foo.co.kr", () => {
    assert.equal(getRegisteredDomain("sub.foo.co.kr"), "foo.co.kr");
  });

  it("2단계 TLD co.jp: foo.co.jp → foo.co.jp", () => {
    assert.equal(getRegisteredDomain("foo.co.jp"), "foo.co.jp");
  });

  it("2단계 TLD co.jp: sub.foo.co.jp → foo.co.jp", () => {
    assert.equal(getRegisteredDomain("sub.foo.co.jp"), "foo.co.jp");
  });

  it("2단계 TLD com.au: foo.com.au → foo.com.au", () => {
    assert.equal(getRegisteredDomain("foo.com.au"), "foo.com.au");
  });

  it("2단계 TLD com.au: sub.foo.com.au → foo.com.au", () => {
    assert.equal(getRegisteredDomain("sub.foo.com.au"), "foo.com.au");
  });

  it("단일 라벨 → null", () => {
    assert.equal(getRegisteredDomain("localhost"), null);
  });

  it("빈 문자열 → null", () => {
    assert.equal(getRegisteredDomain(""), null);
  });
});

describe("sameRegisteredDomain", () => {
  it("mail.google.com / accounts.google.com → true", () => {
    assert.equal(sameRegisteredDomain("mail.google.com", "accounts.google.com"), true);
  });

  it("app.n8n.cloud / n8n.cloud → true", () => {
    assert.equal(sameRegisteredDomain("app.n8n.cloud", "n8n.cloud"), true);
  });

  it("google.com / facebook.com → false", () => {
    assert.equal(sameRegisteredDomain("google.com", "facebook.com"), false);
  });

  it("chatgpt.com / openai.com → false", () => {
    assert.equal(sameRegisteredDomain("chatgpt.com", "openai.com"), false);
  });

  it("null 입력 → false", () => {
    assert.equal(sameRegisteredDomain(null, "google.com"), false);
    assert.equal(sameRegisteredDomain("google.com", null), false);
  });
});
