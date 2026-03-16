import { getRuntimeConfig } from "./config/constants.js";
import { errorResponse, withCors } from "./utils/response.js";
import { readAndValidateJsonRequest } from "./services/security/inputValidator.js";
import { enforceRateLimit } from "./services/security/rateLimiter.js";
import { handleHealth } from "./routes/health.js";
import { handleGenerateJson, handleGenerateStream } from "./routes/generate.js";

function isOriginAllowed(origin, allowedOrigin) {
  return Boolean(origin) && origin === allowedOrigin;
}

export default {
  async fetch(request, env) {
    const config = getRuntimeConfig(env);
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      if (!isOriginAllowed(origin, config.allowedOrigin)) {
        return errorResponse("허용되지 않은 도메인입니다.", 403);
      }
      return withCors(new Response(null, { status: 204 }), origin, config.allowedOrigin);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return withCors(handleHealth(), origin, config.allowedOrigin);
    }

    if (!isOriginAllowed(origin, config.allowedOrigin)) {
      return withCors(errorResponse("허용되지 않은 도메인입니다.", 403), origin, config.allowedOrigin);
    }

    try {
      if (url.pathname === "/api/generate" && request.method === "POST") {
        await enforceRateLimit(request, env);
        const payload = await readAndValidateJsonRequest(request, config);
        return withCors(await handleGenerateJson(payload, env, config), origin, config.allowedOrigin);
      }

      if (url.pathname === "/api/generate/stream" && request.method === "POST") {
        await enforceRateLimit(request, env);
        const payload = await readAndValidateJsonRequest(request, config);
        return handleGenerateStream(payload, env, config, origin);
      }

      return withCors(errorResponse("요청한 주소를 찾을 수 없습니다.", 404), origin, config.allowedOrigin);
    } catch (error) {
      return withCors(
        errorResponse(error.message || "처리 중 오류가 발생했습니다.", error.status || 500, {
          code: error.code || "INTERNAL_ERROR"
        }),
        origin,
        config.allowedOrigin
      );
    }
  }
};
