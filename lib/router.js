// v2 §7.1 — 범위 판정 (LLM 지점 1).
// v1과 달리 "미수록 서비스"는 범위 밖이 아니다.
// scope:"settings" 면 미수록이어도 resolver 로 진행한다.
import { chat } from "./providers.js";

export const REFUSE_MESSAGE =
  "설정 변경을 돕는 도구입니다. 이 요청은 도와드릴 수 없습니다.\n예: \"티스토리 스킨 바꾸고 싶어\", \"유튜브 댓글 끄고 싶어\"";

function buildSystem(cachedGoals) {
  const goalBlock =
    cachedGoals.length
      ? `이 화면에서 이미 알려진 작업 목록:\n${cachedGoals.map((g) => `- ${g.id}: ${g.label}`).join("\n")}\n사용자 문장이 이 중 하나와 같은 작업이면 matchedGoalId 에 그 id 를 넣으세요.\n확실하지 않으면 null 로 두세요.`
      : "";

  return `당신은 요청 분류기입니다. 답변이나 안내를 생성하지 마세요.
사용자 문장이 "웹 서비스의 설정을 바꾸는 작업"인지 판정해 JSON만 출력합니다.

설정 작업인 예: 스킨/테마 변경, 공개 범위 변경, 알림 끄기, 도메인 연결,
  댓글 설정, 결제 수단 변경, 계정 삭제, 2단계 인증 켜기
설정 작업이 아닌 예: 글쓰기, 번역, 코드 작성, 잡담, 일반 지식 질문,
  콘텐츠 추천, 오류 원인 분석

${goalBlock}

goalText 는 사용자 의도를 한 문장으로 정규화한 것입니다. 서비스 이름이
문장에 있으면 유지하세요.

출력 형식:
{"scope":"settings"|"out_of_scope","goalText":string,"matchedGoalId":string|null}`;
}

// cachedGoals: { id: string, label: string }[] — 캐시에 있는 goal 목록 (힌트용).
export async function route(provider, userText, cachedGoals = []) {
  if (!provider || !userText?.trim()) return { kind: "refuse" };

  let parsed;
  try {
    parsed = await chat(provider, {
      system: buildSystem(cachedGoals),
      user: userText.trim(),
      json: true,
      maxTokens: 128,
    });
  } catch (err) {
    console.warn("[setup-copilot] router 실패", err?.message ?? err);
    return { kind: "refuse" };
  }

  if (!parsed || typeof parsed !== "object") return { kind: "refuse" };
  if (parsed.scope !== "settings") return { kind: "refuse" };

  const goalText = String(parsed.goalText ?? "").slice(0, 200).trim();
  if (!goalText) return { kind: "refuse" };

  // matchedGoalId 는 힌트. 목록에 없는 값이면 조용히 null.
  const matchedGoalId =
    cachedGoals.find((g) => g.id === parsed.matchedGoalId)?.id ?? null;

  return { kind: "proceed", goalText, matchedGoalId };
}
