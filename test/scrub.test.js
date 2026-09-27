import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scrubSecrets, looksLikeToken, shannon } from "../lib/scrub.js";

// ─── shannon ─────────────────────────────────────────────────────────────────

describe("shannon", () => {
  it("빈 문자열 → 0", () => assert.equal(shannon(""), 0));
  it("단일 문자 → 0", () => assert.equal(shannon("a"), 0));
  it("두 문자 균등 분포 → 1.0", () => {
    assert.ok(Math.abs(shannon("ab") - 1.0) < 1e-9);
  });
  it("26개 고유 문자 → log2(26) ≈ 4.7", () => {
    // 알파벳 a-z 각 1회
    assert.ok(shannon("abcdefghijklmnopqrstuvwxyz") > 4.0);
  });
});

// ─── looksLikeToken ──────────────────────────────────────────────────────────

describe("looksLikeToken — 토큰으로 판정", () => {
  it("24자 이상, 대소문자+숫자, 고엔트로피 → 토큰", () => {
    // 26개 고유 문자 → 엔트로피 ≈ 4.7
    assert.ok(looksLikeToken("AbCdEfGhIj1234KlMnOpQrStUv"));
  });
});

describe("looksLikeToken — 토큰이 아님", () => {
  it("23자 이하 → 아님", () => {
    assert.ok(!looksLikeToken("AbCdEfGhIj1234KlMnOpQrS")); // 23자
  });
  it("대문자 없음 → 아님", () => {
    assert.ok(!looksLikeToken("abcdefghij1234klmnopqrstuv"));
  });
  it("소문자 없음 → 아님", () => {
    assert.ok(!looksLikeToken("ABCDEFGHIJ1234KLMNOPQRSTUV"));
  });
  it("숫자 없음 → 아님", () => {
    assert.ok(!looksLikeToken("AbCdEfGhIjKlMnOpQrStUvWxYz"));
  });
  it("저엔트로피 (반복 패턴) → 아님", () => {
    // AaAaAa... — 엔트로피 ≈ 1.9
    assert.ok(!looksLikeToken("AaAaAaAaAaAaAaAa12121212"));
  });
  it("공백 포함 → 아님", () => {
    assert.ok(!looksLikeToken("AbCd EfGh 1234 KlMnOpQrSt"));
  });
  it("허용되지 않는 특수문자(슬래시) → 아님", () => {
    assert.ok(!looksLikeToken("AbCdEfGhIj1234KlMn/OpQrStUv"));
  });
  it("콜론 포함 → 아님", () => {
    assert.ok(!looksLikeToken("AbCdEfGh:IjKl1234MnOpQrStUv"));
  });
});

// ─── scrubSecrets — SECRET_PATTERNS ──────────────────────────────────────────

describe("scrubSecrets — 접두사 패턴", () => {
  it("Anthropic sk-ant- 키 → [secret]", () => {
    const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrSt";
    assert.equal(scrubSecrets(key), "[secret]");
  });

  it("OpenAI sk- 키 → [secret]", () => {
    const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz";
    assert.equal(scrubSecrets(key), "[secret]");
  });

  it("Anthropic 키는 OpenAI 패턴이 아닌 Anthropic 패턴으로 치환됨 (순서 보장)", () => {
    // sk-ant- 로 시작하는 키가 sk- 패턴에 먼저 잡히지 않아야 한다.
    // 결과는 어차피 [secret] 이지만, 중간 상태 없이 한 번만 치환되어야 한다.
    const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrSt";
    assert.equal(scrubSecrets(key), "[secret]");
  });

  it("Notion ntn_ 키 → [secret]", () => {
    const key = "ntn_AbCdEfGhIjKlMnOpQrStUvWxYz";
    assert.equal(scrubSecrets(key), "[secret]");
  });

  it("Notion legacy secret_ 키 → [secret]", () => {
    const key = "secret_AbCdEfGhIjKlMnOpQrStUvWxYz";
    assert.equal(scrubSecrets(key), "[secret]");
  });

  it("GitHub ghp_ 키 → [secret]", () => {
    assert.equal(scrubSecrets("ghp_AbCdEfGhIjKlMnOpQrStUvWxYz"), "[secret]");
  });
  it("GitHub gho_ 키 → [secret]", () => {
    assert.equal(scrubSecrets("gho_AbCdEfGhIjKlMnOpQrStUvWxYz"), "[secret]");
  });
  it("GitHub ghu_ 키 → [secret]", () => {
    assert.equal(scrubSecrets("ghu_AbCdEfGhIjKlMnOpQrStUvWxYz"), "[secret]");
  });
  it("GitHub ghs_ 키 → [secret]", () => {
    assert.equal(scrubSecrets("ghs_AbCdEfGhIjKlMnOpQrStUvWxYz"), "[secret]");
  });
  it("GitHub ghr_ 키 → [secret]", () => {
    assert.equal(scrubSecrets("ghr_AbCdEfGhIjKlMnOpQrStUvWxYz"), "[secret]");
  });

  it("Slack xoxb- 키 → [secret]", () => {
    const key = ["xoxb", "123456789012", "AbCdEfGhIjKlMn"].join("-");
    assert.equal(scrubSecrets(key), "[secret]");
  });
  it("Slack xoxa- 키 → [secret]", () => {
    const key = ["xoxa", "AbCdEfGhIjKl"].join("-");
    assert.equal(scrubSecrets(key), "[secret]");
  });

  it("Google AIza 키 → [secret]", () => {
    const key = "AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123456";
    assert.equal(scrubSecrets(key), "[secret]");
  });

  it("문장 중간의 키도 치환된다", () => {
    const text = "키를 복사하세요: sk-ant-api03-AbCdEfGhIjKlMnOpQrSt 이 키는 비밀입니다";
    const result = scrubSecrets(text);
    assert.ok(!result.includes("sk-ant-"), "원본 키가 남아있음");
    assert.ok(result.includes("[secret]"), "[secret]으로 치환되어야 함");
    assert.ok(result.includes("키를 복사하세요:"), "주변 문구가 보존되어야 함");
  });

  it("한 문장에 여러 키가 있으면 전부 치환된다", () => {
    const text = "anthropic=sk-ant-api03-AbCdEfGhIjKlMnOpQrSt notion=ntn_AbCdEfGhIjKlMnOpQrStUvWxYz";
    const result = scrubSecrets(text);
    assert.ok(!result.includes("sk-ant-"));
    assert.ok(!result.includes("ntn_"));
    assert.equal((result.match(/\[secret\]/g) ?? []).length, 2);
  });
});

// ─── scrubSecrets — looksLikeToken 고엔트로피 캐치 ─────────────────────────

describe("scrubSecrets — looksLikeToken 캐치 (접두사 없는 고엔트로피)", () => {
  it("고엔트로피 24자 이상 혼합 토큰 → [secret]", () => {
    assert.equal(scrubSecrets("AbCdEfGhIj1234KlMnOpQrStUv"), "[secret]");
  });

  it("문장 안의 고엔트로피 토큰도 치환된다", () => {
    const text = "토큰: AbCdEfGhIj1234KlMnOpQrStUv 복사됨";
    const result = scrubSecrets(text);
    assert.ok(result.includes("[secret]"));
    assert.ok(!result.includes("AbCdEfGhIj"));
  });

  it("저엔트로피 24자 문자열은 치환하지 않는다", () => {
    // AaAaAaAaAaAaAaAa12121212 — 엔트로피 ≈ 1.9
    assert.equal(scrubSecrets("AaAaAaAaAaAaAaAa12121212"), "AaAaAaAaAaAaAaAa12121212");
  });
});

// ─── scrubSecrets — 오탐 방지 ────────────────────────────────────────────────

describe("scrubSecrets — 오탐 방지 (일반 텍스트는 변경 없음)", () => {
  it("한국어 라벨 → 변경 없음", () => {
    assert.equal(scrubSecrets("저장"), "저장");
    assert.equal(scrubSecrets("카테고리 관리"), "카테고리 관리");
    assert.equal(scrubSecrets("설정 저장하기"), "설정 저장하기");
  });

  it("짧은 영어 라벨 → 변경 없음", () => {
    assert.equal(scrubSecrets("Save"), "Save");
    assert.equal(scrubSecrets("Cancel"), "Cancel");
    assert.equal(scrubSecrets("Settings"), "Settings");
  });

  it("URL 경로 → 변경 없음 (슬래시로 인해 looksLikeToken 불일치)", () => {
    assert.equal(scrubSecrets("https://www.tistory.com/manage/category"), "https://www.tistory.com/manage/category");
  });

  it("날짜 문자열 → 변경 없음", () => {
    assert.equal(scrubSecrets("2024-01-15"), "2024-01-15");
    assert.equal(scrubSecrets("2024-01-15T00:00:00Z"), "2024-01-15T00:00:00Z");
  });

  it("버전 문자열 → 변경 없음", () => {
    // 대문자 없음 → looksLikeToken 불일치
    assert.equal(scrubSecrets("v2.3.1-release-candidate"), "v2.3.1-release-candidate");
    assert.equal(scrubSecrets("v2.3.1-release-candidate-20240115"), "v2.3.1-release-candidate-20240115");
  });

  it("접두사 길이 미달 키 → 변경 없음", () => {
    assert.equal(scrubSecrets("sk-ant-short"), "sk-ant-short"); // 5자 < 10자
    assert.equal(scrubSecrets("sk-short"), "sk-short");         // 5자 < 20자
    assert.equal(scrubSecrets("ntn_short"), "ntn_short");       // 5자 < 20자
  });

  it("숫자만으로 이루어진 긴 문자열 → 변경 없음 (소문자 없음)", () => {
    assert.equal(scrubSecrets("12345678901234567890123456"), "12345678901234567890123456");
  });

  it("null → 빈 문자열", () => {
    assert.equal(scrubSecrets(null), "");
  });

  it("빈 문자열 → 빈 문자열", () => {
    assert.equal(scrubSecrets(""), "");
  });

  it("[secret] 이 이미 치환된 자리를 재처리하지 않는다", () => {
    // [secret] 은 looksLikeToken 패턴에 맞지 않으므로 이중 치환 없음
    assert.equal(scrubSecrets("[secret]"), "[secret]");
  });
});
