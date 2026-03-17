from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any


class GeminiConfigurationError(RuntimeError):
    pass


def _resolve_fallback_model(primary_model: str) -> str:
    configured = os.getenv("GEMINI_FALLBACK_MODEL", "").strip()
    if configured:
        return configured

    if primary_model.strip() == "gemini-2.5-pro":
        return "gemini-2.5-flash"

    return ""


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


def _request_with_retry(model: str, payload: dict[str, Any]) -> dict[str, Any]:
    last_status = 502
    last_body = "Gemini request failed"
    retry_delays = [2, 5]
    request_timeout_seconds = 90

    for attempt in range(len(retry_delays) + 1):
        try:
            request = _build_request(model, payload)
            with urllib.request.urlopen(request, timeout=request_timeout_seconds) as response:
                body = response.read().decode("utf-8")
                return {
                    "ok": True,
                    "status": response.status,
                    "body": body,
                    "result": json.loads(body),
                    "model": model,
                }
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

    return {"ok": False, "status": last_status, "message": last_body, "model": model}


def _should_try_fallback(primary_model: str, status: int, message: str) -> bool:
    if primary_model.strip() != "gemini-2.5-pro":
        return False

    normalized = (message or "").lower()

    if status == 503:
        return True

    if status in {502, 504} and any(
        token in normalized
        for token in (
            "high demand",
            "temporar",
            "unavailable",
            "overloaded",
            "resource exhausted",
        )
    ):
        return True

    return False


def generate_with_retry(model: str, payload: dict[str, Any], retries: int = 1) -> dict[str, Any]:
    primary_attempt = _request_with_retry(model, payload)
    if primary_attempt["ok"]:
        return {
            "result": primary_attempt["result"],
            "modelInfo": {
                "requestedModel": model,
                "usedModel": primary_attempt["model"],
                "fallbackUsed": False,
            },
        }

    fallback_model = _resolve_fallback_model(model)
    if fallback_model and _should_try_fallback(
        model, int(primary_attempt["status"]), str(primary_attempt["message"])
    ):
        fallback_attempt = _request_with_retry(fallback_model, payload)
        if fallback_attempt["ok"]:
            return {
                "result": fallback_attempt["result"],
                "modelInfo": {
                    "requestedModel": model,
                    "usedModel": fallback_attempt["model"],
                    "fallbackUsed": True,
                },
            }

        raise RuntimeError(
            json.dumps(
                {
                    "status": fallback_attempt["status"],
                    "message": (
                        f"{model} failed with temporary overload and fallback "
                        f"{fallback_model} also failed: {fallback_attempt['message']}"
                    ),
                },
                ensure_ascii=False,
            )
        )

    raise RuntimeError(
        json.dumps(
            {"status": primary_attempt["status"], "message": primary_attempt["message"]},
            ensure_ascii=False,
        )
    )
