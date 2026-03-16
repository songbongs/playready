import { createUserError } from "./inputValidator.js";

export async function enforceRateLimit(request, env) {
  if (!env.RATE_LIMIT_KV) {
    return;
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `rate-limit:${ip}`;
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 5;

  const currentRaw = await env.RATE_LIMIT_KV.get(key);
  const current = currentRaw ? JSON.parse(currentRaw) : { count: 0, startedAt: now };
  const withinWindow = now - current.startedAt < windowMs;
  const next = withinWindow
    ? { count: current.count + 1, startedAt: current.startedAt }
    : { count: 1, startedAt: now };

  if (next.count > maxRequests) {
    throw createUserError("요청이 너무 많습니다. 1분 후 다시 시도해주세요.", 429, "RATE_LIMITED");
  }

  await env.RATE_LIMIT_KV.put(key, JSON.stringify(next), {
    expirationTtl: Math.ceil(windowMs / 1000)
  });
}
