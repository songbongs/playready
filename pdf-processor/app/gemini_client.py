from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any


class GeminiConfigurationError(RuntimeError):
    pass


def _build_request(model: str, payload: dict[str, Any]) -> urllib.request.Request:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise GeminiConfigurationError("missing gemini api key")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )

    return urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )


def generate_with_retry(model: str, payload: dict[str, Any], retries: int = 1) -> dict[str, Any]:
    last_status = 502
    last_body = "Gemini request failed"
    # Keep one Render request short enough to avoid upstream 524 timeouts.
    retry_delays = [2, 5]
    request_timeout_seconds = 90

    for attempt in range(len(retry_delays) + 1):
        try:
            request = _build_request(model, payload)
            with urllib.request.urlopen(request, timeout=request_timeout_seconds) as response:
                body = response.read().decode("utf-8")
                return json.loads(body)
        except GeminiConfigurationError:
            raise
        except urllib.error.HTTPError as exc:
            last_status = exc.code or 502
            raw_body = exc.read().decode("utf-8", errors="replace").strip()
            if raw_body:
                last_body = raw_body
            elif last_status == 502:
                last_body = "Gemini upstream returned 502 Bad Gateway"
            else:
                last_body = str(exc)
        except urllib.error.URLError as exc:
            last_status = 502
            reason = str(exc.reason or exc).strip()
            last_body = reason or "Gemini upstream network error"
        except TimeoutError:
            last_status = 504
            last_body = "Gemini request timed out"
        except json.JSONDecodeError:
            last_status = 502
            last_body = "Gemini returned invalid JSON"

        should_retry = attempt < len(retry_delays) and (
            last_status == 503 or last_status >= 500
        )
        if should_retry:
            time.sleep(retry_delays[attempt])
        else:
            break

    raise RuntimeError(json.dumps({"status": last_status, "message": last_body}, ensure_ascii=False))
