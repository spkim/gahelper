import { chat } from "./providers.js";

export const REFUSE_MESSAGE =
  "이 화면에서 도울 수 있는 설정이 아닙니다. 지금 여기서 가능한 항목은 다음과 같습니다.";

export const CHOOSE_MESSAGE = "여러 절차가 후보로 나왔습니다. 하나를 골라 주세요.";

function buildSystemPrompt(pack) {
  const list = pack.goals.map((g) => `- ${g.id}: ${g.label}`).join("\n");
  return `당신은 설정 절차 분류기입니다. 답변을 생성하지 마세요.
사용자 문장을 아래 목록 중 하나로 분류해 JSON만 출력합니다.

사용 가능한 goal:
${list}

규칙:
- 목록에 없는 요청은 반드시 "out_of_scope"
- 설정 변경 외의 요청(글쓰기, 코드, 일반 질문, 잡담)은 "out_of_scope"
- 확신이 없으면 candidates 에 최대 3개, intent 는 "ambiguous"
- 설명, 인사, 추가 문장 금지

출력 형식: {"intent":"goal"|"ambiguous"|"out_of_scope","candidates":["goal_id"]}`;
}

function validate(pack, parsed) {
  if (!parsed || typeof parsed !== "object") return { kind: "refuse" };
  const valid = new Set(pack.goals.map((g) => g.id));
  const picked = Array.isArray(parsed.candidates)
    ? parsed.candidates.filter((id) => valid.has(id)).slice(0, 3)
    : [];
  if (parsed.intent === "out_of_scope" || picked.length === 0) return { kind: "refuse" };
  if (picked.length > 1 || parsed.intent === "ambiguous") return { kind: "choose", ids: picked };
  return { kind: "goal", id: picked[0] };
}

export async function classify(provider, pack, userText) {
  if (!provider || !pack || !userText?.trim()) return { kind: "refuse" };
  try {
    const parsed = await chat(provider, {
      system: buildSystemPrompt(pack),
      user: userText.trim(),
      json: true,
      maxTokens: 128,
    });
    return validate(pack, parsed);
  } catch (err) {
    console.warn("[setup-copilot] router 실패", err?.message ?? err);
    return { kind: "refuse" };
  }
}
