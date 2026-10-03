from __future__ import annotations

import asyncio
import json
import math
import os
import ssl
import time
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.operator_events import emit_operator_event
from bilibili_note_mcp.application.progress import report_provider_retry
from bilibili_note_mcp.application.resource_limits import (
    VISION_CONTENT_BYTES,
    VISION_REQUEST_BYTES,
    VISION_RESPONSE_BYTES,
)
from bilibili_note_mcp.config import ModelProfile, load_model_profile

from .http_bodies import read_httpx_body
from .provider_envelopes import require_exact_model_envelope
from .strict_json import decode_strict_json_object

T = TypeVar("T", bound=BaseModel)


class JsonModelClient:
    def __init__(
        self, profile: ModelProfile | None = None, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._profile = profile or load_model_profile()
        self._transport = transport

    async def request(
        self,
        instruction: str,
        content: list[dict[str, object]],
        schema: type[T],
        *,
        output_schema: dict[str, object] | None = None,
    ) -> T:
        key = os.environ.get(self._profile.api_key_env)
        if not key:
            raise BilibiliNoteFailure("DISTILLATION_FAILED", "provider_key_missing")
        contract = output_schema if output_schema is not None else schema.model_json_schema()
        response_format: dict[str, object] = {"type": self._profile.response_format}
        if self._profile.response_format == "json_schema":
            response_format["json_schema"] = {
                "name": schema.__name__,
                "strict": True,
                "schema": contract,
            }
        body: dict[str, object] = {
            "model": self._profile.vision_model,
            "messages": [
                {
                    "role": "system",
                    "content": instruction + "\nJSON schema:\n" + json.dumps(contract),
                },
                {"role": "user", "content": content},
            ],
            "temperature": 0,
            "max_tokens": self._profile.max_output_tokens,
            "response_format": response_format,
        }
        if self._profile.provider == "deepseek":
            body["thinking"] = {"type": "enabled" if self._profile.enable_thinking else "disabled"}
        else:
            body["enable_thinking"] = self._profile.enable_thinking
            if self._profile.enable_thinking:
                body["thinking_budget"] = self._profile.thinking_budget
        encoded = json.dumps(body, ensure_ascii=False).encode()
        if len(encoded) > VISION_REQUEST_BYTES:
            raise BilibiliNoteFailure("DISTILLATION_FAILED", "vision_request_too_large")
        started = time.monotonic()
        try:
            async with asyncio.timeout(self._profile.timeout_seconds):
                raw = await self._post(encoded, key, schema.__name__)
            envelope = decode_strict_json_object(raw)
            require_exact_model_envelope(envelope, self._profile.vision_model)
            usage = envelope.get("usage")
            keys = ("prompt_tokens", "completion_tokens", "total_tokens")
            if isinstance(usage, dict) and all(
                isinstance(usage.get(k), int) and not isinstance(usage[k], bool) and usage[k] >= 0
                for k in keys
            ):
                emit_operator_event(
                    "provider_usage",
                    model=self._profile.vision_model,
                    stage=schema.__name__,
                    prompt_tokens=usage["prompt_tokens"],
                    completion_tokens=usage["completion_tokens"],
                    total_tokens=usage["total_tokens"],
                    request_ms=round((time.monotonic() - started) * 1000),
                )
            choice = envelope["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("incomplete response")
            value = choice["message"]["content"]
            if not isinstance(value, str) or len(value.encode()) > VISION_CONTENT_BYTES:
                raise ValueError("invalid content")
            decoded = decode_strict_json_object(value.encode())
            return schema.model_validate_json(json.dumps(decoded))
        except BilibiliNoteFailure:
            raise
        except (TimeoutError, httpx.TimeoutException) as e:
            raise BilibiliNoteFailure("DISTILLATION_FAILED", "provider_timeout") from e
        except (
            httpx.HTTPError,
            ssl.SSLError,
            ValueError,
            KeyError,
            IndexError,
            TypeError,
            ValidationError,
        ) as e:
            raise BilibiliNoteFailure("DISTILLATION_FAILED", "provider_response_invalid") from e

    async def _post(self, encoded: bytes, key: str, stage: str) -> bytes:
        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=min(90.0, self._profile.timeout_seconds),
            trust_env=False,
            follow_redirects=False,
        ) as client:
            for attempt in range(1, 4):
                status = 0
                delay = (2.0, 8.0, 0.0)[attempt - 1]
                try:
                    async with client.stream(
                        "POST",
                        self._profile.base_url.rstrip("/") + "/chat/completions",
                        headers={
                            "Authorization": f"Bearer {key}",
                            "Content-Type": "application/json",
                        },
                        content=encoded,
                    ) as response:
                        status = response.status_code
                        if status == 200:
                            return await read_httpx_body(
                                response,
                                limit_bytes=VISION_RESPONSE_BYTES,
                                code="DISTILLATION_FAILED",
                                reason="vision_response_too_large",
                            )
                        if status not in (408, 429, 500, 502, 503, 504) or attempt == 3:
                            raise BilibiliNoteFailure(
                                "RATE_LIMITED" if status == 429 else "DISTILLATION_FAILED",
                                f"provider_http_{status}",
                            )
                        delay = _retry_delay(response.headers.get("Retry-After"), delay)
                except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as e:
                    if attempt == 3:
                        raise BilibiliNoteFailure(
                            "DISTILLATION_FAILED", "provider_transport_retries_exhausted"
                        ) from e
                # The response is closed before waiting; cancellation never starts another attempt.
                emit_operator_event(
                    "provider_retry",
                    model=self._profile.vision_model,
                    stage=stage,
                    attempt=attempt + 1,
                    status=status,
                    delay_ms=round(delay * 1000),
                )
                await report_provider_retry(attempt + 1, status, delay)
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")


def _retry_delay(value: str | None, fallback: float) -> float:
    if not value:
        return fallback
    try:
        seconds = float(value)
    except ValueError:
        try:
            when = parsedate_to_datetime(value)
            if when.tzinfo is None:
                when = when.replace(tzinfo=UTC)
            seconds = (when - datetime.now(UTC)).total_seconds()
        except TypeError, ValueError, OverflowError:
            return fallback
    if not math.isfinite(seconds):
        return fallback
    return max(fallback, min(30.0, seconds))
