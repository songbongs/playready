import { createUserError } from "../security/inputValidator.js";

async function fetchGemini(env, config, payload) {
  if (!env.GEMINI_API_KEY) {
    throw createUserError("Gemini API 키가 설정되지 않았습니다.", 500, "MISSING_GEMINI_KEY");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || "Gemini request failed");
    error.status = response.status;
    error.raw = text;
    throw error;
  }

  return response.json();
}

function parseGeminiError(firstError) {
  const status = Number(firstError?.status || 0);
  const raw = String(firstError?.raw || firstError?.message || "");
  let parsedMessage = raw;

  try {
    const parsed = JSON.parse(raw);
    parsedMessage =
      parsed?.error?.message ||
      parsed?.message ||
      raw;
  } catch {
    parsedMessage = raw;
  }

  const message = String(parsedMessage || "");

  if (
    status === 413 ||
    /token limit|context length|request too large|input too large|too many tokens|too large/i.test(message)
  ) {
    return createUserError(
      "AI에 전달할 자료가 너무 많아 문서 생성에 실패했습니다. 입력 자료를 더 줄이거나 더 큰 입력을 지원하는 모델이 필요합니다.",
      413,
      "GEMINI_INPUT_TOO_LARGE"
    );
  }

  if (status === 400 && /api key not valid|invalid api key|authentication/i.test(message)) {
    return createUserError(
      "Gemini API 키가 올바르지 않습니다. Cloudflare secret에 등록한 키를 다시 확인해주세요.",
      401,
      "GEMINI_INVALID_KEY"
    );
  }

  if (status === 403 && /quota|rate limit|permission|billing/i.test(message)) {
    return createUserError(
      "Gemini 사용 한도 또는 권한 문제로 요청이 거부되었습니다. Google AI Studio 사용량과 프로젝트 설정을 확인해주세요.",
      403,
      "GEMINI_QUOTA_OR_PERMISSION"
    );
  }

  if (status === 404 && /model/i.test(message)) {
    return createUserError(
      "설정한 Gemini 모델 이름을 찾을 수 없습니다. Worker의 GEMINI_MODEL 설정을 확인해주세요.",
      404,
      "GEMINI_MODEL_NOT_FOUND"
    );
  }

  return createUserError(
    `AI 처리 중 오류가 발생했습니다. Gemini 응답: ${message.slice(0, 220)}`,
    status || 502,
    "GEMINI_FAILED"
  );
}

export async function generateWithRetry(env, config, payload) {
  try {
    return await fetchGemini(env, config, payload);
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      return await fetchGemini(env, config, payload);
    } catch (secondError) {
      throw parseGeminiError(secondError);
    }
  }
}
