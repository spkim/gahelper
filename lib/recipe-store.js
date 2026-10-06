// Schema A (Appendix R) — 번들된 레시피 레지스트리. 런타임 소스는 이 파일이다(JSON 사본 없음).
// goals[].site: 해당 goal을 수행할 목표 URL (선택).
// matchRecipes: goals[*].site hostname 기반 URL 매칭.

const R01 = {
  id: "R01", version: 1, type: "setup", tier: 1,
  name: "ChatGPT에 나에 대한 맞춤 지침 설정하기",
  prereq: ["ChatGPT 계정 로그인"],
  goals: [
    { id: "step_0", label: "ChatGPT 맞춤 지침(개인화) 설정 열어서 나에 대한 정보 입력하기", site: "https://chatgpt.com/" },
  ],
  manualCheck: "새 대화에서 맞춤 지침이 반영되는지",
};

const R02 = {
  id: "R02", version: 1, type: "setup", tier: 1,
  name: "Claude에 나의 선호 설정 입력하기",
  prereq: ["Claude 계정 로그인"],
  goals: [
    { id: "step_0", label: "Claude 설정에서 프로필의 개인 선호 사항 입력하기", site: "https://claude.ai/" },
  ],
  manualCheck: "설정 화면에 입력한 선호가 저장되어 있는지",
};

const R03 = {
  id: "R03", version: 1, type: "setup", tier: 1,
  name: "구글 캘린더 기본 알림 시간 바꾸기",
  prereq: ["구글 테스트 계정 로그인"],
  goals: [
    { id: "step_0", label: "구글 캘린더 일정의 기본 알림 시간을 30분 전으로 변경하기", site: "https://calendar.google.com/" },
  ],
  manualCheck: "새 일정을 만들 때 알림이 30분 전으로 잡히는지",
};

const R04 = {
  id: "R04", version: 1, type: "setup", tier: 2,
  name: "거래처 메일에 자동으로 라벨 붙이기",
  prereq: ["구글 테스트 계정 로그인", "라벨을 붙일 발신 주소 하나 정해두기"],
  goals: [
    { id: "step_0", label: "지메일에서 '거래처' 라벨 만들기", site: "https://mail.google.com/" },
    { id: "step_1", label: "지메일에서 특정 보낸사람의 메일에 '거래처' 라벨을 자동으로 붙이는 필터 만들기", site: "https://mail.google.com/" },
  ],
  manualCheck: "설정의 필터 목록에 새 필터가 있는지",
};

const R05 = {
  id: "R05", version: 1, type: "setup", tier: 2,
  name: "구글 드라이브 폴더를 동료와 편집자로 공유하기",
  prereq: ["구글 테스트 계정 로그인", "공유할 테스트 폴더 하나", "공유받을 두 번째 테스트 주소"],
  goals: [
    { id: "step_0", label: "구글 드라이브 폴더를 다른 사람에게 편집자 권한으로 공유하기", site: "https://drive.google.com/" },
  ],
  manualCheck: "두 번째 계정에서 폴더가 보이고 편집 가능한지",
};

const R06 = {
  id: "R06", version: 1, type: "setup", tier: 2,
  name: "Anthropic API 키 발급하기 (Setup Copilot 자체 온보딩)",
  prereq: ["Anthropic Console 테스트 계정"],
  goals: [
    { id: "step_0", label: "Anthropic 콘솔에서 새 API 키 만들기", site: "https://console.anthropic.com/" },
  ],
  manualCheck: "키 목록에 새 키가 있는지. 테스트 후 즉시 키 삭제",
  securityCheck: "네트워크 탭에서 LLM 요청 본문에 키 문자열(sk-ant-)이 없어야 함",
};

const R07 = {
  id: "R07", version: 1, type: "setup", tier: 3,
  name: "Claude에 구글 드라이브 연결하기",
  prereq: ["Claude 계정 로그인", "구글 테스트 계정"],
  goals: [
    { id: "step_0", label: "Claude 설정에서 구글 드라이브 커넥터 연결하기", site: "https://claude.ai/" },
  ],
  manualCheck: "Claude 대화에서 드라이브 파일 검색이 되는지. 테스트 후 연결 해제",
};

const R08 = {
  id: "R08", version: 1, type: "setup", tier: 3,
  name: "노션 통합 만들고 페이지에 연결하기",
  prereq: ["노션 테스트 워크스페이스", "연결할 테스트 페이지 하나"],
  goals: [
    { id: "step_0", label: "노션에서 새 내부 통합 만들기", site: "https://www.notion.so/my-integrations" },
    { id: "step_1", label: "노션 페이지에 방금 만든 통합 연결하기", site: "https://www.notion.so/" },
  ],
  manualCheck: "페이지 연결 목록에 통합이 보이는지. 테스트 후 통합 삭제",
  securityCheck: "네트워크 탭에서 LLM 요청 본문에 통합 시크릿(ntn_ 또는 secret_)이 없어야 함",
};

const R09 = {
  id: "R09", version: 1, type: "setup", tier: 3,
  name: "n8n에 지메일 연결하기",
  prereq: ["n8n Cloud 체험 계정 또는 로컬 n8n", "구글 테스트 계정"],
  goals: [
    { id: "step_0", label: "n8n에서 지메일 자격증명 새로 추가하고 구글 계정으로 연결하기", site: "https://app.n8n.cloud/" },
  ],
  manualCheck: "자격증명 목록에 지메일 항목이 연결됨 상태로 있는지",
};

const R10 = {
  id: "R10", version: 1, type: "setup", tier: 4,
  name: "n8n에 워크플로우 붙여넣고 테스트 실행하기",
  prereq: ["n8n Cloud 체험 계정 또는 로컬 n8n"],
  goals: [
    { id: "step_0", label: "n8n에서 새 빈 워크플로우 만들기", site: "https://app.n8n.cloud/" },
    {
      id: "step_1",
      label: "n8n 워크플로우 편집 화면에 복사한 노드를 붙여넣고 테스트 실행하기",
      site: "https://app.n8n.cloud/",
      payload: {
        kind: "clipboard",
        label: "테스트용 워크플로우 노드",
        content: "{\"nodes\":[{\"parameters\":{},\"name\":\"Start\",\"type\":\"n8n-nodes-base.manualTrigger\",\"typeVersion\":1,\"position\":[0,0]},{\"parameters\":{},\"name\":\"Done\",\"type\":\"n8n-nodes-base.noOp\",\"typeVersion\":1,\"position\":[240,0]}],\"connections\":{\"Start\":{\"main\":[[{\"node\":\"Done\",\"type\":\"main\",\"index\":0}]]}}}",
      },
    },
  ],
  manualCheck: "실행 기록에 성공한 실행이 1건 있는지",
};

const GENERIC_SETUP = {
  id: "generic-setup", version: 1, type: "setup",
  name: "일반 설정 안내",
  description: "사전 등록되지 않은 사이트의 설정을 현재 화면 관측으로 안내한다. fallback Recipe.",
  goals: [],
};

// generic-setup은 항상 마지막 — fallback이며 match 규칙이 없다.
const REGISTRY = [R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, GENERIC_SETUP].map(validateRecipe);

function validateRecipe(r) {
  if (!r || typeof r !== 'object') throw new Error('Recipe must be an object');
  if (!r.id || typeof r.id !== 'string') throw new Error('Recipe.id required');
  if (typeof r.version !== 'number') throw new Error('Recipe.version must be a number');
  if (r.type !== 'setup') throw new Error(`Recipe.type "${r.type}" not supported`);
  if (!Array.isArray(r.goals)) throw new Error('Recipe.goals must be an array');
  for (const [i, g] of r.goals.entries()) {
    if (!g.id || typeof g.id !== 'string') throw new Error(`Goal[${i}].id required`);
    if (!g.label || typeof g.label !== 'string') throw new Error(`Goal[${i}].label required`);
  }
  return r;
}

export function getRecipe(id) {
  return REGISTRY.find((r) => r.id === id) ?? null;
}

export function listRecipes() {
  return REGISTRY.slice();
}

// URL/host 기반 후보 Recipe 반환. generic-setup은 포함하지 않는다.
export function matchRecipes({ host, url } = {}) {
  const out = [];
  for (const r of REGISTRY) {
    if (!r.goals?.length) continue;
    const siteHosts = r.goals
      .filter((g) => g.site)
      .map((g) => { try { return new URL(g.site).hostname; } catch { return null; } })
      .filter(Boolean);
    const unique = [...new Set(siteHosts)];
    const hostMatch = host ? unique.some((h) => host === h || host.endsWith(`.${h}`)) : false;
    const urlMatch = url ? unique.some((h) => url.includes(h)) : false;
    if (hostMatch || urlMatch) out.push(r);
  }
  return out;
}
