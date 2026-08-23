import { chat } from "./providers.js";

export const FALLBACK_MESSAGE = "화면 구조가 예상과 다릅니다. 수동으로 진행해야 할 수 있습니다.";
const MAX_LEN = 400;

const SYSTEM = `당신은 설정 안내 도우미입니다. 아래 observed 에 실제로 존재하는 항목만 언급하세요.
observed 에 없는 메뉴, 버튼, 경로를 지어내면 안 됩니다.
필요한 요소가 observed 에 없으면 정확히 이렇게 답하세요:
"${FALLBACK_MESSAGE}"
2~3문장, 한국어, 다음 행동 하나만 제시하세요.`;

export async function explain(provider, step, observed, attempts) {
  if (!provider || !step) return FALLBACK_MESSAGE;
  const user = JSON.stringify({
    step: step.instruct,
    observed: observed ?? {},
    attempts: attempts ?? 0,
  });
  try {
    const text = await chat(provider, {
      system: SYSTEM,
      user,
      maxTokens: 256,
    });
    const clean = String(text ?? "").trim();
    if (!clean) return FALLBACK_MESSAGE;
    return clean.slice(0, MAX_LEN);
  } catch (err) {
    console.warn("[setup-copilot] recover 실패", err?.message ?? err);
    return FALLBACK_MESSAGE;
  }
}
