// 등록 가능 도메인(eTLD+1) 추출기.
// 팝업 일시정지 로직에서 "같은 서비스인지" 판정에 사용.
// 완전한 PSL 대신 실용적 근사치: 알려진 2단계 TLD만 예외 처리.

const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in', 'co.id', 'co.il',
  'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tw', 'com.sg', 'com.ar', 'com.hk',
  'net.au', 'net.nz', 'org.uk', 'org.au', 'org.nz',
  'ac.uk', 'gov.uk', 'me.uk',
]);

// hostname → 등록 가능 도메인(eTLD+1). 판정 불가 시 null.
export function getRegisteredDomain(hostname) {
  if (!hostname) return null;
  const h = hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!h) return null;
  const parts = h.split('.');
  if (parts.length < 2) return null;

  if (parts.length >= 3) {
    const twoLevel = parts.slice(-2).join('.');
    if (TWO_LEVEL_TLDS.has(twoLevel)) {
      return parts.slice(-3).join('.');
    }
  }

  return parts.slice(-2).join('.');
}

// 두 hostname 이 같은 등록 도메인이면 true.
export function sameRegisteredDomain(h1, h2) {
  if (!h1 || !h2) return false;
  const d1 = getRegisteredDomain(h1);
  const d2 = getRegisteredDomain(h2);
  return d1 !== null && d1 === d2;
}
