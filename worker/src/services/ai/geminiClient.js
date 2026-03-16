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
    throw error;
  }

  return response.json();
}

export async function generateWithRetry(env, config, payload) {
  try {
    return await fetchGemini(env, config, payload);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      return await fetchGemini(env, config, payload);
    } catch {
      throw createUserError("AI 처리 중 오류가 발생했습니다.", 502, "GEMINI_FAILED");
    }
  }
}
