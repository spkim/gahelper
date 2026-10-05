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
- observed 에 실제로 존재하는 텍스트만 instruct, target, verify, usedLabels 에 사용하세요.
  observed 에 없는 메뉴, 버튼, 탭, 경로를 쓰면 응답 전체가 폐기됩니다.
- usedLabels 에는 observed 에 있는 텍스트만, observed 에 나온 형태 그대로 넣으세요.
  instruct 에서 화면 라벨을 언급했다면 반드시 usedLabels 에도 넣으세요.
  사용자가 입력할 값이나 일반 명사는 넣지 마세요.
  화면 라벨이 없는 step 은 usedLabels 를 빈 배열로 두세요.
- 읽기 편하도록 instruct 안의 화면 라벨은 따옴표로 감싸세요. (표기 관례)
- 각 step 에는 verify 가 반드시 있어야 합니다. verify 는 그 단계가
  끝났는지를 화면에서 확인할 수 있는 조건입니다.
- verify.probe 는 target 과 다른 요소를 가리켜야 합니다.
  target 을 클릭하거나 입력한 결과로 새로 나타나는 제목·섹션·버튼·메시지를 확인하세요.
- target 이 linkText 인 step 의 verify 는 {"is":"urlIncludes","text":"..."} 를 사용하세요.
  found / notFound 는 URL 이 그대로인 화면 내 상태 변경에만 사용하세요.
  같은 텍스트를 target 과 verify 에 동시에 쓰지 마세요.
- 목표까지 이 화면에서 갈 수 없으면 (다른 화면으로 이동해야 하면),
  이동을 위해 눌러야 하는 링크까지만 절차로 만드세요. 그 다음은
  화면이 바뀐 후 다시 판단합니다.
- 목표와 관련된 요소가 observed 에 전혀 없으면 {"goalLabel":"","steps":[]} 를 출력하세요.
  추측하지 마세요.
- 최대 6 step. 각 instruct 는 한 문장, 한국어.
- 설명이나 인사 없이 JSON만 출력하세요.

출력 형식:
{"goalLabel":string,"steps":[{"instruct":string,"usedLabels":string[],
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

// 반환: { procedure, attempts } | { empty: true, attempts } | throws (err.attempts 포함)
// attempts: 시도마다 { reasons } 한 개. 통과한 시도의 reasons 는 빈 배열이다.
// reasons 는 guard 가 낸 원문 문자열이며(화면 텍스트를 포함할 수 있다) 저장·표시 전에
// evallog 의 이유 코드 추출을 거쳐야 한다. 최종 실패 시 err.reasons 는 기존대로 유지한다.
export async function resolve(provider, goalText, signature) {
  let lastReasons = [];
  const attempts = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const user = attempt === 0
      ? buildUserMessage(goalText, signature)
      : buildRetryMessage(goalText, signature, lastReasons);

    let parsed;
    try {
      parsed = await chat(provider, { system: SYSTEM, user, json: true, maxTokens: MAX_TOKENS });
    } catch (err) {
      // JSON 파싱 실패는 guard 불통과와 동일하게 처리 (§8).
      attempts.push({ reasons: ["json_parse_error"] });
      if (attempt < MAX_RETRIES) {
        lastReasons = ["json_parse_error"];
        continue;
      }
      if (err && typeof err === "object") err.attempts = attempts;
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
      attempts.push({ reasons: [] });
      return { empty: true, attempts };
    }

    if (result.ok) {
      if (result.warnings?.length) {
        console.info("[setup-copilot] procedure-generator 경고:", result.warnings);
      }
      attempts.push({ reasons: [] });
      return { procedure: proc, attempts };
    }

    attempts.push({ reasons: [...result.reasons] });
    lastReasons = result.reasons;
    console.warn("[setup-copilot] procedure-generator guard 불통과 (시도 %d/%d)", attempt + 1, MAX_RETRIES + 1, result.reasons);

    if (attempt === MAX_RETRIES) {
      // 두 번째도 실패 — blocked 로 강하.
      const err = new Error("guard_fail");
      err.reasons = result.reasons;
      err.attempts = attempts;
      throw err;
    }
  }
}
