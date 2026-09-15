// v2 §7.2 — LLM 지점 2. 현재 화면 signature 로 절차를 실시간 생성.
// 호출은 화면 진입 시 1회. verify 폴링 루프는 모델을 호출하지 않는다.
import { chat } from "./providers.js";
import { compact } from "./signature.js";
import { guard } from "./guard.js";

const MAX_TOKENS = 2048;
const MAX_RETRIES = 1;

const SYSTEM = `당신은 설정 절차 작성기입니다.
아래 observed 는 사용자가 지금 보고 있는 설정 화면의 요소 목록입니다.

규칙:
- observed 에 실제로 존재하는 텍스트만 instruct, target, verify 에 사용하세요.
  observed 에 없는 메뉴, 버튼, 탭, 경로를 쓰면 응답 전체가 폐기됩니다.
- 화면 라벨은 반드시 따온표('...' 또는 "...")로 감싸세요.
- 각 step 에는 verify 가 반드시 있어야 합니다. verify 는 그 단계가
  끝났는지를 화면에서 확인할 수 있는 조건입니다.
- 목표까지 이 화면에서 갈 수 없으면 (다른 화면으로 이동해야 하면),
  이동을 위해 눌러야 하는 링크까지만 절차로 만드세요. 그 다음은
  화면이 바뀐 후 다시 판단합니다.
- 목표와 관련된 요소가 observed 에 전혀 없으면 {"goalLabel":"","steps":[]} 를 출력하세요.
  추측하지 마세요.
- 최대 6 step. 각 instruct 는 한 문장, 한국어.
- 설명이나 인사 없이 JSON만 출력하세요.

출력 형식:
{"goalLabel":string,"steps":[{"instruct":string,
  "target":Locator|null,"verify":Verify,"onFail":string|null}]}

Locator: {"by":"linkText"|"buttonText"|"labelText"|"textPresent"|"urlIncludes","text":string}
Verify: {"probe":Locator,"is":"found"|"notFound"|"checked"|"unchecked"|"textPresent","text"?:string}
        또는 {"is":"urlIncludes","text":string}`;

function buildUserMessage(goalText, signature) {
  return JSON.stringify({ goal: goalText, observed: compact(signature) });
}

function buildRetryMessage(goalText, signature, reasons) {
  const reasonList = reasons.slice(0, 10).join("\n- ");
  return JSON.stringify({
    goal: goalText,
    observed: compact(signature),
    previousAttemptFailed: true,
    reasons: `다음 규칙 위반으로 폐기됨:\n- ${reasonList}\n라벨은 따온표로 감싸고, observed 에 있는 텍스트만 사용하세요.`,
  });
}

// 반환: { procedure, origin: "live" } | { empty: true } | throws
export async function resolve(provider, goalText, signature) {
  let lastReasons = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const user = attempt === 0
      ? buildUserMessage(goalText, signature)
      : buildRetryMessage(goalText, signature, lastReasons);

    let parsed;
    try {
      parsed = await chat(provider, { system: SYSTEM, user, json: true, maxTokens: MAX_TOKENS });
    } catch (err) {
      // JSON 파싱 실패는 guard 불통과와 동일하게 처리 (§8).
      if (attempt < MAX_RETRIES) {
        lastReasons = ["json_parse_error"];
        continue;
      }
      throw err;
    }

    const proc = {
      goalLabel: String(parsed?.goalLabel ?? goalText),
      steps: Array.isArray(parsed?.steps) ? parsed.steps : [],
      origin: "live",
      confirmations: 0,
    };

    const result = guard(proc, signature);

    if (result.ok && result.empty) {
      return { empty: true };
    }

    if (result.ok) {
      return { procedure: proc };
    }

    lastReasons = result.reasons;
    console.warn("[setup-copilot] procedure-generator guard 불통과 (시도 %d/%d)", attempt + 1, MAX_RETRIES + 1, result.reasons);

    if (attempt === MAX_RETRIES) {
      // 두 번째도 실패 — blocked 로 강하.
      const err = new Error("guard_fail");
      err.reasons = result.reasons;
      throw err;
    }
  }
}
