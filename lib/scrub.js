// §R4.6 비밀값 스크럽 패턴.
// content/probe.js 는 ES module import 를 쓸 수 없으므로 이 파일은 테스트 전용이다.
// probe.js 의 SECRET_PATTERNS / shannon / looksLikeToken 과 반드시 동기화할 것.

export const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,    // Anthropic
  /sk-[A-Za-z0-9_-]{20,}/g,        // OpenAI 계열
  /ntn_[A-Za-z0-9]{20,}/g,         // Notion
  /secret_[A-Za-z0-9]{20,}/g,      // Notion (구형)
  /gh[pousr]_[A-Za-z0-9]{20,}/g,   // GitHub
  /xox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AIza[0-9A-Za-z_-]{30,}/g,       // Google API key
];

export function shannon(s) {
  if (!s) return 0;
  const freq = {};
  for (const c of s) freq[c] = (freq[c] || 0) + 1;
  const len = s.length;
  // reduce 안에서 빼서 -0 발생을 방지한다.
  return Object.values(freq).reduce((sum, f) => {
    const p = f / len;
    return sum - p * Math.log2(p);
  }, 0);
}

// 접두사 없는 고엔트로피 토큰 판정.
// 24자 이상, 대·소문자·숫자 모두 포함, 허용 문자만, shannon > 3.5.
export function looksLikeToken(s) {
  return (
    /^[A-Za-z0-9_\-.]{24,}$/.test(s) &&
    /[A-Z]/.test(s) &&
    /[a-z]/.test(s) &&
    /[0-9]/.test(s) &&
    shannon(s) > 3.5
  );
}

// 문자열에서 비밀값을 [secret] 으로 치환한다.
// 접두사 패턴 → looksLikeToken 순으로 적용.
export function scrubSecrets(input) {
  if (input == null) return "";
  let s = String(input);
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    s = s.replace(re, "[secret]");
  }
  s = s.replace(/\S+/g, (m) => (looksLikeToken(m) ? "[secret]" : m));
  return s;
}
