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

    for attempt in range(retries + 1):
        try:
            request = _build_request(model, payload)
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read().decode("utf-8")
                return json.loads(body)
        except GeminiConfigurationError:
            raise
        except urllib.error.HTTPError as exc:
            last_status = exc.code or 502
            last_body = exc.read().decode("utf-8", errors="replace") or str(exc)
        except urllib.error.URLError as exc:
            last_status = 502
            last_body = str(exc.reason or exc)
        except TimeoutError:
            last_status = 504
            last_body = "Gemini request timed out"
        except json.JSONDecodeError:
            last_status = 502
            last_body = "Gemini returned invalid JSON"

        if attempt < retries:
            time.sleep(1.5)

    raise RuntimeError(json.dumps({"status": last_status, "message": last_body}, ensure_ascii=False))
