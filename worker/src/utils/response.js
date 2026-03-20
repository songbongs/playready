export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers
  });
}

export function errorResponse(message, status = 400, extra = {}) {
  return json(
    {
      ok: false,
      error: {
        message,
        ...extra
      }
    },
    { status }
  );
}

export function withCors(response, origin, allowedOrigin) {
  const headers = new Headers(response.headers);
  if (origin && origin === allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Playready-Session-Id");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function sseHeaders(origin, allowedOrigin) {
  const headers = new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  if (origin && origin === allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Playready-Session-Id");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return headers;
}
