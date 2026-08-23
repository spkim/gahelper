const DEFAULT_MAX_TOKENS = 512;

export const KIND_LABELS = Object.freeze({
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  compatible: "OpenAI 호환",
});

export const DEFAULT_MODELS = Object.freeze({
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  compatible: "gpt-4o-mini",
});

class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ProviderError";
    this.status = status ?? null;
  }
}

function mapHttpError(status) {
  if (status === 401 || status === 403) return "API 키를 확인해 주세요.";
  if (status === 429) return "요청이 많습니다. 잠시 후 다시 시도하세요.";
  if (status >= 500) return "공급자 서비스에 일시적인 문제가 있습니다.";
  return "요청이 실패했습니다.";
}

function stripFences(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

async function callAnthropic(provider, { system, user, maxTokens }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new ProviderError(mapHttpError(res.status), res.status);
  const data = await res.json();
  return (data.content ?? []).map((c) => c.text ?? "").join("");
}

async function callOpenAILike(url, provider, { system, user, maxTokens }) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new ProviderError(mapHttpError(res.status), res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function callOpenAI(provider, opts) {
  return callOpenAILike("https://api.openai.com/v1/chat/completions", provider, opts);
}

function callCompatible(provider, opts) {
  if (!provider.baseUrl) throw new ProviderError("Base URL이 설정되지 않았습니다.");
  const base = provider.baseUrl.replace(/\/+$/, "");
  return callOpenAILike(`${base}/chat/completions`, provider, opts);
}

async function callGemini(provider, { system, user, maxTokens }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}` +
    `:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { role: "system", parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) throw new ProviderError(mapHttpError(res.status), res.status);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

const DISPATCH = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
  compatible: callCompatible,
};

export async function chat(provider, opts) {
  const call = DISPATCH[provider.kind];
  if (!call) throw new ProviderError(`지원하지 않는 공급자입니다: ${provider.kind}`);
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  let text;
  try {
    text = await call(provider, { system: opts.system, user: opts.user, maxTokens });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    console.error("[setup-copilot] chat failed", { kind: provider.kind });
    throw new ProviderError("연결에 실패했습니다.");
  }

  if (opts.json) {
    try {
      return JSON.parse(stripFences(text));
    } catch {
      throw new ProviderError("응답을 JSON으로 해석하지 못했습니다.");
    }
  }
  return text;
}

export async function testConnection(provider) {
  const reply = await chat(provider, {
    system: "You are a connectivity test. Reply with only the word: OK",
    user: "ping",
    maxTokens: 16,
  });
  return { ok: true, reply: (reply ?? "").trim().slice(0, 40) };
}

export { ProviderError };
