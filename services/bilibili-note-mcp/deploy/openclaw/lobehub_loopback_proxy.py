from __future__ import annotations

import http.client
import io
import json
import math
import re
import select
import socket
import sys
import threading
import time
from collections.abc import Buffer
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from bilibili_note_mcp.adapters.http_bodies import (
    ContentLengthError,
    parse_content_length_values,
)

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 18892
UPSTREAM_HOST = "127.0.0.1"
UPSTREAM_PORT = 18893
EXPECTED_OPENRESPONSES_MODEL = "openclaw/bilibili-note"
LOBEHUB_OPENRESPONSES_MODEL = "openclaw"
EXACT_OPENRESPONSES_REQUEST_FIELDS = frozenset({"model", "stream", "input"})
EXACT_LOBEHUB_OPENRESPONSES_REQUEST_FIELDS = frozenset(
    {"model", "stream", "input", "store", "temperature", "top_p"}
)
EXACT_LOBEHUB_MESSAGE_FIELDS = frozenset({"role", "content"})
LOBEHUB_TEXT_HISTORY_ROLES = frozenset({"assistant", "developer", "system", "user"})
MAX_LOBEHUB_HISTORY_ITEMS = 32
WEB_ORIGIN = "https://app.lobehub.com"
ALLOWED_PATHS = frozenset({"/v1/models", "/v1/responses"})
ALLOWED_RAW_TARGETS = frozenset(path.encode("ascii") for path in ALLOWED_PATHS)
EXPECTED_METHODS = {"/v1/models": "GET", "/v1/responses": "POST"}
MAX_REQUEST_BYTES = 1_048_576
MAX_UPSTREAM_RESPONSE_BYTES = 1_048_576
TERMINAL_RESULT_MAX_BYTES = 262_144
MAX_JSON_ESCAPED_TERMINAL_BYTES = 6 * TERMINAL_RESULT_MAX_BYTES
MAX_SSE_FRAME_OVERHEAD_BYTES = 8_192
MAX_SSE_PRETERMINAL_BYTES = 262_144
MAX_SSE_TERMINAL_PROJECTIONS = 5
MAX_SSE_DONE_BYTES = 64
MAX_JSON_NESTING_DEPTH = 128
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_SSE_FRAME_BYTES = MAX_JSON_ESCAPED_TERMINAL_BYTES + MAX_SSE_FRAME_OVERHEAD_BYTES
MAX_SSE_LOGICAL_RESPONSE_BYTES = (
    MAX_SSE_PRETERMINAL_BYTES
    + MAX_SSE_TERMINAL_PROJECTIONS * MAX_SSE_FRAME_BYTES
    + MAX_SSE_DONE_BYTES
)
MAX_ACTIVE_CONNECTIONS = 8
HEADER_READ_TIMEOUT_SECONDS = 5.0
BODY_READ_TIMEOUT_SECONDS = 15.0
RESPONSE_WRITE_TIMEOUT_SECONDS = 5.0
SATURATION_WRITE_TIMEOUT_SECONDS = 0.25
UPSTREAM_RESPONSE_TIMEOUT_SECONDS = 930.0
JSON_PARSE_ERRORS = (ValueError, UnicodeDecodeError, RecursionError)
PROXY_STREAM_ERRORS = (BrokenPipeError, ConnectionError, TimeoutError, OSError)
INITIAL_SSE_ADMISSION_ERRORS = PROXY_STREAM_ERRORS + (http.client.HTTPException, AttributeError)
BEARER_TOKEN = re.compile(r"[A-Za-z0-9._~+/\-]+=*")
FORBIDDEN_OPENCLAW_REQUEST_HEADER_PREFIX = "x-openclaw-"
SAFE_BROWSER_REQUEST_HEADERS = frozenset(
    {
        "authorization",
        "content-type",
        "x-stainless-arch",
        "x-stainless-lang",
        "x-stainless-os",
        "x-stainless-package-version",
        "x-stainless-retry-count",
        "x-stainless-runtime",
        "x-stainless-runtime-version",
    }
)
SAFE_UPSTREAM_REQUEST_HEADERS = frozenset({"accept", "authorization", "content-type"})
SAFE_UPSTREAM_RESPONSE_HEADERS = frozenset({"cache-control", "content-type"})
CORS_RESPONSE_HEADERS = frozenset(
    {
        "access-control-allow-origin",
        "access-control-allow-credentials",
        "access-control-allow-private-network",
        "vary",
    }
)
DOWNSTREAM_RESPONSE_HEADER_POLICIES = {
    "malformed_http_error": frozenset({"connection", "content-length", "content-type"}),
    "local_json_error": frozenset(
        {"connection", "content-length", "content-type"} | CORS_RESPONSE_HEADERS
    ),
    "preflight": frozenset(
        {
            "access-control-allow-headers",
            "access-control-allow-methods",
            "access-control-max-age",
            "content-length",
        }
        | CORS_RESPONSE_HEADERS
    ),
    "proxied": frozenset({"connection"} | SAFE_UPSTREAM_RESPONSE_HEADERS | CORS_RESPONSE_HEADERS),
}
SATURATION_RESPONSE_HEADERS = (
    ("Content-Type", "application/json"),
    ("Connection", "close"),
)
SAFE_OPENRESPONSES_EVENTS = frozenset(
    {
        "response.created",
        "response.in_progress",
        "response.output_item.added",
        "response.content_part.added",
        "response.openclaw_tool_progress",
    }
)
TERMINAL_OPENRESPONSES_EVENTS = frozenset({"response.completed", "response.failed"})
OUTPUT_OPENRESPONSES_EVENTS = frozenset(
    {
        "response.output_text.delta",
        "response.output_text.done",
        "response.content_part.done",
        "response.output_item.done",
    }
)
_SSE_FRAME_BOUNDARY = re.compile(rb"(?>\r\n|\r|\n)(?>\r\n|\r|\n)")
ServerRequest = socket.socket | tuple[bytes, socket.socket]


class _DeadlineSocketReader(io.RawIOBase):
    """Socket reader whose deadline cannot be extended by trickled bytes."""

    def __init__(self, connection: socket.socket, deadline: float) -> None:
        super().__init__()
        self._connection = connection
        self._deadline = deadline

    def readable(self) -> bool:
        return True

    def set_deadline(self, deadline: float) -> None:
        self._deadline = deadline

    def readinto(self, buffer: Any) -> int:
        remaining = self._deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("loopback request read deadline exceeded")
        self._connection.settimeout(remaining)
        return self._connection.recv_into(buffer)


class _BoundedSocketWriter(io.BufferedIOBase):
    """Unbuffered send-all writer with a finite slow-client bound per write."""

    def __init__(self, connection: socket.socket, timeout: float) -> None:
        super().__init__()
        self._connection = connection
        self._timeout = timeout

    def writable(self) -> bool:
        return True

    def write(self, buffer: Buffer) -> int:
        if self.closed:
            raise ValueError("write to closed loopback connection")
        data = memoryview(buffer).cast("B")
        self._connection.settimeout(self._timeout)
        self._connection.sendall(data)
        return len(data)


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    """Fixed-capacity loopback HTTP server with fail-fast admission."""

    daemon_threads = False
    block_on_close = True
    request_queue_size = MAX_ACTIVE_CONNECTIONS

    def __init__(
        self,
        server_address: tuple[str, int],
        request_handler_class: type[BaseHTTPRequestHandler],
        *,
        max_active_connections: int = MAX_ACTIVE_CONNECTIONS,
        header_read_timeout: float = HEADER_READ_TIMEOUT_SECONDS,
        body_read_timeout: float = BODY_READ_TIMEOUT_SECONDS,
        response_write_timeout: float = RESPONSE_WRITE_TIMEOUT_SECONDS,
        saturation_write_timeout: float = SATURATION_WRITE_TIMEOUT_SECONDS,
        upstream_response_timeout: float = UPSTREAM_RESPONSE_TIMEOUT_SECONDS,
    ) -> None:
        if max_active_connections < 1:
            raise ValueError("max_active_connections must be positive")
        for name, value in (
            ("header_read_timeout", header_read_timeout),
            ("body_read_timeout", body_read_timeout),
            ("response_write_timeout", response_write_timeout),
            ("saturation_write_timeout", saturation_write_timeout),
            ("upstream_response_timeout", upstream_response_timeout),
        ):
            if value <= 0:
                raise ValueError(f"{name} must be positive")
        self.max_active_connections = max_active_connections
        self.header_read_timeout = header_read_timeout
        self.body_read_timeout = body_read_timeout
        self.response_write_timeout = response_write_timeout
        self.saturation_write_timeout = saturation_write_timeout
        self.upstream_response_timeout = upstream_response_timeout
        self.request_queue_size = max_active_connections
        self._connection_permits = threading.BoundedSemaphore(max_active_connections)
        self._state_lock = threading.Lock()
        self._accepted_at: dict[int, float] = {}
        self._active_connections = 0
        self._peak_active_connections = 0
        super().__init__(server_address, request_handler_class)

    @property
    def active_connections(self) -> int:
        with self._state_lock:
            return self._active_connections

    @property
    def peak_active_connections(self) -> int:
        with self._state_lock:
            return self._peak_active_connections

    def get_request(self) -> tuple[socket.socket, tuple[str, int]]:
        request, client_address = super().get_request()
        accepted_at = time.monotonic()
        request.settimeout(self.header_read_timeout)
        with self._state_lock:
            self._accepted_at[id(request)] = accepted_at
        return request, client_address

    def take_accepted_at(self, request: socket.socket) -> float:
        with self._state_lock:
            return self._accepted_at.pop(id(request), time.monotonic())

    def _discard_accepted_at(self, request: socket.socket) -> None:
        with self._state_lock:
            self._accepted_at.pop(id(request), None)

    def _release_connection(self) -> None:
        with self._state_lock:
            self._active_connections -= 1
        self._connection_permits.release()

    def _reject_saturated(self, request: socket.socket) -> None:
        payload = b'{"error":{"code":"server_saturated"}}'
        headers = (*SATURATION_RESPONSE_HEADERS, ("Content-Length", str(len(payload))))
        response = b"HTTP/1.1 503 Service Unavailable\r\n" + b"".join(
            f"{name}: {value}\r\n".encode("ascii") for name, value in headers
        )
        response += b"\r\n" + payload
        try:
            request.settimeout(self.saturation_write_timeout)
            request.sendall(response)
        except PROXY_STREAM_ERRORS:
            pass

    def process_request(self, request: ServerRequest, client_address: tuple[str, int]) -> None:
        assert isinstance(request, socket.socket)
        if not self._connection_permits.acquire(blocking=False):
            self._discard_accepted_at(request)
            self._reject_saturated(request)
            self.shutdown_request(request)
            return
        with self._state_lock:
            self._active_connections += 1
            self._peak_active_connections = max(
                self._peak_active_connections, self._active_connections
            )
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._discard_accepted_at(request)
            self._release_connection()
            self.shutdown_request(request)
            raise

    def process_request_thread(
        self, request: ServerRequest, client_address: tuple[str, int]
    ) -> None:
        try:
            assert isinstance(request, socket.socket)
            super().process_request_thread(request, client_address)
        finally:
            if isinstance(request, socket.socket):
                self._discard_accepted_at(request)
            self._release_connection()


class OpenResponsesRequestAdmission:
    __slots__ = ("body", "admitted")

    def __init__(self, *, body: bytes | None, admitted: bool) -> None:
        self.body = body
        self.admitted = admitted


def _unique_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON object key")
        value[key] = item
    return value


def _finite_json_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("non-finite JSON number")
    return parsed


def _reject_json_constant(value: str) -> Any:
    raise ValueError(f"non-finite JSON constant: {value}")


def _json_nesting_within_limit(value: bytes) -> bool:
    depth = 0
    in_string = False
    escaped = False
    for byte in value:
        if in_string:
            if escaped:
                escaped = False
            elif byte == 0x5C:
                escaped = True
            elif byte == 0x22:
                in_string = False
            continue
        if byte == 0x22:
            in_string = True
        elif byte in (0x5B, 0x7B):
            depth += 1
            if depth > MAX_JSON_NESTING_DEPTH:
                return False
        elif byte in (0x5D, 0x7D):
            depth -= 1
    return True


def _decode_strict_json_object(value: bytes) -> dict[str, Any] | None:
    """Decode one finite JSON object with unique decoded keys at every depth."""
    if not _json_nesting_within_limit(value):
        return None
    try:
        text = value.decode("utf-8", errors="strict")
        decoded = json.loads(
            text,
            object_pairs_hook=_unique_json_object,
            parse_constant=_reject_json_constant,
            parse_float=_finite_json_float,
        )
    except JSON_PARSE_ERRORS:
        return None
    return decoded if isinstance(decoded, dict) else None


def _standalone_prompt(request: dict[str, Any]) -> str | None:
    fields = set(request)
    input_value = request.get("input")
    if fields == EXACT_OPENRESPONSES_REQUEST_FIELDS:
        if request.get("model") != EXPECTED_OPENRESPONSES_MODEL:
            return None
        maximum_items = 1
        allowed_roles = frozenset({"user"})
    elif fields == EXACT_LOBEHUB_OPENRESPONSES_REQUEST_FIELDS:
        if not (
            request.get("model") == LOBEHUB_OPENRESPONSES_MODEL
            and request.get("store") is False
            and type(request.get("temperature")) is int
            and request.get("temperature") == 1
            and type(request.get("top_p")) is int
            and request.get("top_p") == 1
        ):
            return None
        maximum_items = MAX_LOBEHUB_HISTORY_ITEMS
        allowed_roles = LOBEHUB_TEXT_HISTORY_ROLES
    else:
        return None
    if not (
        request.get("stream") is True
        and isinstance(input_value, list)
        and 1 <= len(input_value) <= maximum_items
    ):
        return None
    for message in input_value:
        if not (
            isinstance(message, dict)
            and set(message) == EXACT_LOBEHUB_MESSAGE_FIELDS
            and message.get("role") in allowed_roles
            and isinstance(message.get("content"), str)
        ):
            return None
    current = input_value[-1]
    prompt = current.get("content")
    if current.get("role") != "user" or not isinstance(prompt, str) or not prompt.strip():
        return None
    return prompt


def prepare_openresponses_request(path: str, body: bytes | None) -> OpenResponsesRequestAdmission:
    """Admit only one standalone LobeHub text prompt for the dedicated agent."""
    if path != "/v1/responses":
        return OpenResponsesRequestAdmission(body=body, admitted=True)
    if not body:
        return OpenResponsesRequestAdmission(body=None, admitted=False)
    request = _decode_strict_json_object(body)
    if request is None:
        return OpenResponsesRequestAdmission(body=None, admitted=False)
    prompt = _standalone_prompt(request)
    if prompt is None:
        return OpenResponsesRequestAdmission(body=None, admitted=False)
    normalized_request = {
        "model": EXPECTED_OPENRESPONSES_MODEL,
        "stream": True,
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": prompt,
            }
        ],
    }
    try:
        normalized = json.dumps(
            normalized_request,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
    except (ValueError, UnicodeEncodeError, RecursionError):
        return OpenResponsesRequestAdmission(body=None, admitted=False)
    return OpenResponsesRequestAdmission(body=normalized, admitted=True)


class _OpenResponsesSseGate:
    """Validate the pinned OpenResponses grammar and atomically commit terminal bytes."""

    def __init__(self) -> None:
        self._pending = bytearray()
        self._terminal = bytearray()
        self._search_from = 0
        self._logical_bytes = 0
        self._preterminal_bytes = 0
        self._state = "created_pending"
        self._done = False
        self._invalid = False
        self._initial_response: dict[str, Any] | None = None
        self._response_id: str | None = None
        self._model: str | None = None
        self._item_id: str | None = None
        self._delta_parts: list[str] = []
        self._note_bytes = 0
        self._note_text: str | None = None
        self._completed_item: dict[str, Any] | None = None

    @staticmethod
    def _decode_frame(payload: bytes) -> tuple[str, dict[str, Any] | None] | None:
        normalized = payload.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        lines = normalized.split(b"\n")
        meaningful = [line for line in lines if line]
        event_values: list[bytes] = []
        data_values: list[bytes] = []
        for line in meaningful:
            field, separator, value = line.partition(b":")
            if not separator or field not in {b"event", b"data"}:
                return None
            if value.startswith(b" "):
                value = value[1:]
            if field == b"event":
                event_values.append(value)
            else:
                data_values.append(value)
        if len(data_values) != 1:
            return None
        data = data_values[0]
        if data == b"[DONE]":
            return ("done", None) if not event_values else None
        if len(event_values) != 1:
            return None
        decoded = _decode_strict_json_object(data)
        if decoded is None or not isinstance(decoded.get("type"), str):
            return None
        data_type = decoded["type"]
        try:
            event_type = event_values[0].decode("ascii")
        except UnicodeDecodeError:
            return None
        if event_type != data_type:
            return None
        return data_type, decoded

    @staticmethod
    def _exact_keys(value: object, expected: set[str]) -> bool:
        return isinstance(value, dict) and set(value) == expected

    @staticmethod
    def _bounded_string(value: object, *, maximum_bytes: int = 512) -> bool:
        if not isinstance(value, str) or not value:
            return False
        try:
            return len(value.encode("utf-8")) <= maximum_bytes
        except UnicodeEncodeError:
            return False

    @staticmethod
    def _nonnegative_number(value: object) -> bool:
        return (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            and value >= 0
        )

    @staticmethod
    def _zero_index(value: object) -> bool:
        return type(value) is int and value == 0

    @classmethod
    def _valid_usage(cls, value: object) -> bool:
        if not cls._exact_keys(value, {"input_tokens", "output_tokens", "total_tokens"}):
            return False
        assert isinstance(value, dict)
        return all(type(item) is int and 0 <= item <= MAX_SAFE_INTEGER for item in value.values())

    def _valid_response_resource(
        self,
        value: object,
        *,
        status: str,
        output: object,
        failed: bool = False,
    ) -> bool:
        expected = {"id", "object", "created_at", "status", "model", "output", "usage"}
        if failed:
            expected.add("error")
        if not self._exact_keys(value, expected):
            return False
        assert isinstance(value, dict)
        if (
            value.get("id") != self._response_id
            or value.get("object") != "response"
            or value.get("status") != status
            or value.get("model") != self._model
            or value.get("output") != output
            or not isinstance(value.get("created_at"), int)
            or isinstance(value.get("created_at"), bool)
            or value["created_at"] < 0
            or not self._valid_usage(value.get("usage"))
        ):
            return False
        if not failed:
            return True
        error = value.get("error")
        if not self._exact_keys(error, {"code", "message"}):
            return False
        assert isinstance(error, dict)
        return all(
            self._bounded_string(error.get(key), maximum_bytes=1024) for key in ("code", "message")
        )

    @staticmethod
    def _empty_output_part(value: object) -> bool:
        return value == {"type": "output_text", "text": ""}

    def _accept_preterminal(self, frame_type: str, event: dict[str, Any]) -> bool:
        if frame_type in {"response.created", "response.in_progress"}:
            expected_state = (
                "created_pending" if frame_type == "response.created" else "in_progress_pending"
            )
            if self._state != expected_state or not self._exact_keys(event, {"type", "response"}):
                return False
            response = event.get("response")
            if not self._exact_keys(
                response,
                {"id", "object", "created_at", "status", "model", "output", "usage"},
            ):
                return False
            assert isinstance(response, dict)
            if frame_type == "response.created":
                response_id = response.get("id")
                model = response.get("model")
                if not self._bounded_string(response_id) or model != EXPECTED_OPENRESPONSES_MODEL:
                    return False
                self._response_id = response_id
                self._model = model
                if not self._valid_response_resource(response, status="in_progress", output=[]):
                    return False
                self._initial_response = response
                self._state = "in_progress_pending"
                return True
            if response != self._initial_response:
                return False
            self._state = "item_pending"
            return True

        if frame_type == "response.output_item.added":
            if self._state != "item_pending" or not self._exact_keys(
                event, {"type", "output_index", "item"}
            ):
                return False
            item = event.get("item")
            if not self._exact_keys(item, {"type", "id", "role", "content", "status"}):
                return False
            assert isinstance(item, dict)
            content = item.get("content")
            if (
                not self._zero_index(event.get("output_index"))
                or item.get("type") != "message"
                or item.get("role") != "assistant"
                or item.get("status") != "in_progress"
                or not isinstance(content, list)
                or len(content) != 1
                or not self._empty_output_part(content[0])
                or not self._bounded_string(item.get("id"))
            ):
                return False
            self._item_id = item["id"]
            self._state = "content_pending"
            return True

        if frame_type == "response.content_part.added":
            if self._state != "content_pending" or not self._exact_keys(
                event,
                {"type", "item_id", "output_index", "content_index", "part"},
            ):
                return False
            if (
                event.get("item_id") != self._item_id
                or not self._zero_index(event.get("output_index"))
                or not self._zero_index(event.get("content_index"))
                or not self._empty_output_part(event.get("part"))
            ):
                return False
            self._state = "ready"
            return True

        if frame_type == "response.openclaw_tool_progress":
            if self._state != "ready" or not self._exact_keys(
                event, {"type", "item_id", "output_index", "openclaw_tool_progress"}
            ):
                return False
            progress = event.get("openclaw_tool_progress")
            if not self._exact_keys(progress, {"kind", "id", "current", "total", "text"}):
                return False
            assert isinstance(progress, dict)
            current = progress.get("current")
            total = progress.get("total")
            text = progress.get("text")
            if not (
                self._nonnegative_number(current)
                and self._nonnegative_number(total)
                and isinstance(text, str)
            ):
                return False
            assert isinstance(current, (int, float))
            assert isinstance(total, (int, float))
            return (
                event.get("item_id") == self._item_id
                and self._zero_index(event.get("output_index"))
                and progress.get("kind") == "replaceable_stage"
                and progress.get("id") == "mcp-progress"
                and total > 0
                and current < total
                and self._bounded_string(text, maximum_bytes=2048)
                and text == text.strip()
                and "\n" not in text
                and "\r" not in text
            )
        return False

    def _accept_terminal_event(
        self, frame_type: str, event: dict[str, Any] | None, frame: bytes
    ) -> bytes | None:
        if frame_type == "done" and self._state in {"completed", "failed"}:
            self._terminal.extend(frame)
            self._done = True
            committed = bytes(self._terminal)
            self._terminal.clear()
            self._pending.clear()
            return committed

        if event is None:
            self._invalid = True
            self._terminal.clear()
            return None

        if frame_type == "response.output_text.delta" and self._state in {"ready", "deltas"}:
            if not self._exact_keys(
                event,
                {"type", "item_id", "output_index", "content_index", "delta"},
            ):
                self._invalid = True
                return None
            delta = event.get("delta")
            if (
                event.get("item_id") != self._item_id
                or not self._zero_index(event.get("output_index"))
                or not self._zero_index(event.get("content_index"))
                or not isinstance(delta, str)
                or not delta
            ):
                self._invalid = True
                return None
            try:
                self._note_bytes += len(delta.encode("utf-8"))
            except UnicodeEncodeError:
                self._invalid = True
                return None
            if self._note_bytes > TERMINAL_RESULT_MAX_BYTES:
                self._invalid = True
                return None
            self._delta_parts.append(delta)
            self._state = "deltas"
        elif frame_type == "response.output_text.done" and self._state == "deltas":
            if not self._exact_keys(
                event, {"type", "item_id", "output_index", "content_index", "text"}
            ):
                self._invalid = True
                return None
            note = "".join(self._delta_parts)
            if (
                event.get("item_id") != self._item_id
                or not self._zero_index(event.get("output_index"))
                or not self._zero_index(event.get("content_index"))
                or event.get("text") != note
            ):
                self._invalid = True
                return None
            self._note_text = note
            self._state = "text_done"
        elif frame_type == "response.content_part.done" and self._state == "text_done":
            if not self._exact_keys(
                event,
                {"type", "item_id", "output_index", "content_index", "part"},
            ) or (
                event.get("item_id") != self._item_id
                or not self._zero_index(event.get("output_index"))
                or not self._zero_index(event.get("content_index"))
                or event.get("part") != {"type": "output_text", "text": self._note_text}
            ):
                self._invalid = True
                return None
            self._state = "content_done"
        elif frame_type == "response.output_item.done" and self._state == "content_done":
            if not self._exact_keys(event, {"type", "output_index", "item"}):
                self._invalid = True
                return None
            item = event.get("item")
            if not self._exact_keys(item, {"type", "id", "role", "content", "phase", "status"}):
                self._invalid = True
                return None
            assert isinstance(item, dict)
            if (
                not self._zero_index(event.get("output_index"))
                or item.get("type") != "message"
                or item.get("id") != self._item_id
                or item.get("role") != "assistant"
                or item.get("content") != [{"type": "output_text", "text": self._note_text}]
                or item.get("phase") != "final_answer"
                or item.get("status") != "completed"
            ):
                self._invalid = True
                return None
            self._completed_item = item
            self._state = "item_done"
        elif frame_type == "response.completed" and self._state == "item_done":
            if not self._exact_keys(
                event, {"type", "response"}
            ) or not self._valid_response_resource(
                event.get("response"),
                status="completed",
                output=[self._completed_item],
            ):
                self._invalid = True
                return None
            self._state = "completed"
        elif frame_type == "response.failed" and self._state == "ready":
            if not self._exact_keys(
                event, {"type", "response"}
            ) or not self._valid_response_resource(
                event.get("response"), status="failed", output=[], failed=True
            ):
                self._invalid = True
                return None
            self._state = "failed"
        else:
            self._invalid = True
            self._terminal.clear()
            return None
        self._terminal.extend(frame)
        return None

    def feed(
        self,
        chunk: bytes,
        *,
        max_logical_bytes: int = MAX_SSE_LOGICAL_RESPONSE_BYTES,
        stop_after_initial: bool = False,
    ) -> tuple[tuple[bytes, ...], bytes | None]:
        if self._done or self._invalid:
            return (), None
        self._pending.extend(chunk)
        immediate: list[bytes] = []
        consumed = 0
        stopped_after_initial = False
        while boundary := _SSE_FRAME_BOUNDARY.search(self._pending, self._search_from):
            if boundary.end() == len(self._pending) and self._pending.endswith(b"\r"):
                break
            payload = bytes(self._pending[consumed : boundary.start()])
            frame = bytes(self._pending[consumed : boundary.end()])
            consumed = boundary.end()
            self._search_from = consumed
            if len(frame) > MAX_SSE_FRAME_BYTES:
                self._invalid = True
                self._terminal.clear()
                break
            self._logical_bytes += len(frame)
            if self._logical_bytes > max_logical_bytes:
                self._invalid = True
                self._terminal.clear()
                break
            decoded = self._decode_frame(payload)
            if decoded is None:
                self._invalid = True
                self._terminal.clear()
                break
            frame_type, event = decoded
            if frame_type in SAFE_OPENRESPONSES_EVENTS:
                if event is None or not self._accept_preterminal(frame_type, event):
                    self._invalid = True
                    self._terminal.clear()
                    break
                self._preterminal_bytes += len(frame)
                if self._preterminal_bytes > MAX_SSE_PRETERMINAL_BYTES:
                    self._invalid = True
                    self._terminal.clear()
                    break
                immediate.append(frame)
                if stop_after_initial and self.initial_admitted:
                    stopped_after_initial = True
                    break
                continue
            if frame_type not in OUTPUT_OPENRESPONSES_EVENTS | TERMINAL_OPENRESPONSES_EVENTS | {
                "done"
            }:
                self._invalid = True
                self._terminal.clear()
                break
            committed = self._accept_terminal_event(frame_type, event, frame)
            if self._invalid:
                break
            if committed is not None:
                return tuple(immediate), committed
        if consumed:
            del self._pending[:consumed]
        self._search_from = 0 if stopped_after_initial else max(0, len(self._pending) - 4)
        if self._invalid:
            self._terminal.clear()
            self._pending.clear()
            return tuple(immediate), None
        if (
            len(self._pending) > MAX_SSE_FRAME_BYTES
            or self._logical_bytes + len(self._pending) > max_logical_bytes
        ):
            self._invalid = True
            self._terminal.clear()
            self._pending.clear()
        return tuple(immediate), None

    def finish(self) -> None:
        if not self._done:
            self._invalid = True
            self._terminal.clear()
            self._pending.clear()

    @property
    def invalid(self) -> bool:
        return self._invalid

    @property
    def initial_admitted(self) -> bool:
        return self._initial_response is not None


class ProxyHandler(BaseHTTPRequestHandler):
    raw_requestline: bytes
    protocol_version = "HTTP/1.1"

    def _start_response(self, status: int, response_class: str) -> None:
        self._downstream_response_header_policy = DOWNSTREAM_RESPONSE_HEADER_POLICIES[
            response_class
        ]
        self.send_response(status)

    def send_response(self, code: int, message: str | None = None) -> None:
        """Emit only the status line; never disclose the Python/BaseHTTP identity.

        ``BaseHTTPRequestHandler`` automatically adds ``Server`` (including the
        Python version) and ``Date``. Neither is part of this loopback consumer
        contract. Date is intentionally omitted too, so every response class has
        a finite, host-owned header set below.
        """

        if not hasattr(self, "_downstream_response_header_policy"):
            # Parser-generated errors occur before a route can select a response class.
            self._downstream_response_header_policy = DOWNSTREAM_RESPONSE_HEADER_POLICIES[
                "malformed_http_error"
            ]
        self.log_request(code)
        self.send_response_only(code, message)

    def send_header(self, keyword: str, value: str) -> None:
        policy: frozenset[str] = getattr(self, "_downstream_response_header_policy", frozenset())
        if keyword.lower() not in policy:
            raise RuntimeError(f"downstream response header denied: {keyword}")
        super().send_header(keyword, value)

    @property
    def bounded_server(self) -> BoundedThreadingHTTPServer:
        assert isinstance(self.server, BoundedThreadingHTTPServer)
        return self.server

    def setup(self) -> None:
        self.connection = self.request
        accepted_at = self.bounded_server.take_accepted_at(self.connection)
        self._accepted_at = accepted_at
        reader = _DeadlineSocketReader(
            self.connection,
            accepted_at + self.bounded_server.header_read_timeout,
        )
        self._deadline_reader = reader
        self.rfile = io.BufferedReader(reader)
        self.wfile = _BoundedSocketWriter(
            self.connection, self.bounded_server.response_write_timeout
        )

    def parse_request(self) -> bool:
        parsed = super().parse_request()
        if parsed:
            self._deadline_reader.set_deadline(
                time.monotonic() + self.bounded_server.body_read_timeout
            )
            self.close_connection = True
        return parsed

    def log_message(self, format: str, *args: object) -> None:
        print(format % args, file=sys.stderr, flush=True)

    def _request_source_allowed(self) -> bool:
        origins = self.headers.get_all("Origin", [])
        if origins:
            return origins == [WEB_ORIGIN]
        if self.command == "OPTIONS":
            requested_methods = self.headers.get_all("Access-Control-Request-Method", [])
            requested_headers = self.headers.get_all("Access-Control-Request-Headers", [])
            if (
                requested_methods != [EXPECTED_METHODS.get(self.path)]
                or len(requested_headers) != 1
            ):
                return False
            header_names = {
                name.strip().lower() for name in requested_headers[0].split(",") if name.strip()
            }
            return "authorization" in header_names and header_names <= SAFE_BROWSER_REQUEST_HEADERS
        return True

    def _authorization_allowed(self) -> bool:
        authorizations = self.headers.get_all("Authorization", [])
        if len(authorizations) != 1:
            return False
        scheme, separator, token = authorizations[0].partition(" ")
        return scheme == "Bearer" and separator == " " and BEARER_TOKEN.fullmatch(token) is not None

    def _request_headers_allowed(self) -> bool:
        return all(
            not name.lower().startswith(FORBIDDEN_OPENCLAW_REQUEST_HEADER_PREFIX)
            for name in self.headers
        )

    def _path_allowed(self) -> bool:
        request_line = self.raw_requestline.removesuffix(b"\r\n")
        parts = request_line.split(b" ")
        if len(parts) != 3:
            return False
        raw_method, raw_target, raw_version = parts
        return (
            raw_method == self.command.encode("ascii")
            and raw_version.startswith(b"HTTP/")
            and raw_target in ALLOWED_RAW_TARGETS
            and raw_target == self.path.encode("ascii")
        )

    def _method_allowed(self) -> bool:
        return self.command == EXPECTED_METHODS.get(self.path)

    def _send_cors(self) -> None:
        origins = self.headers.get_all("Origin", [])
        if origins != [WEB_ORIGIN]:
            return
        self.send_header("Access-Control-Allow-Origin", origins[0])
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")

    def _send_json_error(self, status: int, code: str) -> None:
        payload = json.dumps({"error": {"code": code}}, separators=(",", ":")).encode()
        self._start_response(status, "local_json_error")
        self._send_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(payload)
        except PROXY_STREAM_ERRORS:
            pass
        finally:
            self.close_connection = True

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._request_source_allowed():
            self._send_json_error(403, "origin_denied")
            return
        if not self._path_allowed():
            self._send_json_error(404, "path_denied")
            return
        self._start_response(204, "preflight")
        self._send_cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "authorization,content-type,x-stainless-arch,x-stainless-lang,x-stainless-os,"
            "x-stainless-package-version,x-stainless-retry-count,x-stainless-runtime,"
            "x-stainless-runtime-version",
        )
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()
        self.close_connection = True

    def do_GET(self) -> None:  # noqa: N802
        self._proxy()

    def do_POST(self) -> None:  # noqa: N802
        self._proxy()

    def _proxy(self) -> None:
        if not self._request_source_allowed():
            self._send_json_error(403, "origin_denied")
            return
        if not self._path_allowed():
            self._send_json_error(404, "path_denied")
            return
        if not self._method_allowed():
            self._send_json_error(405, "method_denied")
            return
        if not self._request_headers_allowed():
            self._send_json_error(400, "request_contract_denied")
            return
        if not self._authorization_allowed():
            self._send_json_error(401, "authorization_denied")
            return
        if "transfer-encoding" in self.headers:
            self._send_json_error(400, "transfer_encoding_denied")
            return
        content_lengths = self.headers.get_all("Content-Length", [])
        try:
            declared_request_length = parse_content_length_values(
                content_lengths,
                limit_bytes=MAX_REQUEST_BYTES,
            )
        except ContentLengthError as e:
            status = 413 if e.kind == "overflow" else 400
            code = {
                "duplicate": "duplicate_content_length",
                "invalid": "invalid_content_length",
                "overflow": "request_too_large",
            }[e.kind]
            self._send_json_error(status, code)
            return
        content_length = declared_request_length or 0
        try:
            body = self.rfile.read(content_length) if content_length else None
        except PROXY_STREAM_ERRORS:
            self._send_json_error(408, "request_body_timeout")
            return
        if body is not None and len(body) != content_length:
            self._send_json_error(400, "incomplete_request_body")
            return
        admission = prepare_openresponses_request(self.path, body)
        if not admission.admitted:
            self._send_json_error(400, "request_contract_denied")
            return
        body = admission.body
        if body is not None and len(body) > MAX_REQUEST_BYTES:
            self._send_json_error(413, "request_too_large")
            return
        forwarded_headers = {
            name: value
            for name, value in self.headers.items()
            if name.lower() in SAFE_UPSTREAM_REQUEST_HEADERS
        }
        forwarded_headers["Accept-Encoding"] = "identity"
        if body is not None:
            forwarded_headers["Content-Length"] = str(len(body))
        response_deadline = self._accepted_at + self.bounded_server.upstream_response_timeout
        remaining = response_deadline - time.monotonic()
        if remaining <= 0:
            self.close_connection = True
            return
        upstream = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=remaining)
        response: http.client.HTTPResponse | None = None
        upstream_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        upstream_socket.settimeout(remaining)
        # One pre-created socket is the complete connect/request/response authority.
        # HTTPConnection must never reopen after the watcher or timer closes it.
        upstream.sock = upstream_socket
        upstream.auto_open = False
        abort_lock = threading.Lock()
        abort_requested = threading.Event()
        downstream_stopped = threading.Event()

        def abort_upstream() -> None:
            with abort_lock:
                abort_requested.set()
                try:
                    upstream_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                try:
                    upstream_socket.close()
                except OSError:
                    pass

        deadline_timer = threading.Timer(max(0.0, remaining), abort_upstream)
        deadline_timer.name = "lobehub-upstream-response-deadline"
        downstream_watcher: threading.Thread | None = None

        def watch_downstream() -> None:
            try:
                readable, _, _ = select.select([self.connection], [], [])
                if readable and not downstream_stopped.is_set():
                    # The admitted request body is already complete. EOF or any unexpected
                    # additional client bytes end this one-request connection fail-closed.
                    self.connection.recv(1)
                    abort_upstream()
            except OSError:
                if not downstream_stopped.is_set():
                    abort_upstream()

        try:
            deadline_timer.start()
            downstream_watcher = threading.Thread(
                target=watch_downstream,
                name="lobehub-downstream-eof-watcher",
            )
            downstream_watcher.start()
            if abort_requested.is_set():
                return
            upstream_socket.connect((UPSTREAM_HOST, UPSTREAM_PORT))
            if abort_requested.is_set():
                return
            upstream.request(self.command, self.path, body=body, headers=forwarded_headers)
            response = upstream.getresponse()
            with abort_lock:
                if abort_requested.is_set():
                    response.close()
                    return

            is_openresponses = self.path == "/v1/responses"
            if is_openresponses and response.status != 200:
                abort_upstream()
                self._send_json_error(502, "upstream_contract_denied")
                return
            content_type = response.getheader("Content-Type", "").partition(";")[0].strip().lower()
            if is_openresponses and content_type != "text/event-stream":
                abort_upstream()
                self._send_json_error(502, "upstream_contract_denied")
                return

            is_openresponses_sse = is_openresponses
            upstream_content_lengths = [
                value for name, value in response.getheaders() if name.lower() == "content-length"
            ]
            try:
                parse_content_length_values(
                    upstream_content_lengths,
                    limit_bytes=(
                        MAX_SSE_LOGICAL_RESPONSE_BYTES
                        if is_openresponses_sse
                        else MAX_UPSTREAM_RESPONSE_BYTES
                    ),
                )
            except ContentLengthError:
                abort_upstream()
                self._send_json_error(502, "upstream_contract_denied")
                return

            sse_gate = _OpenResponsesSseGate() if is_openresponses_sse else None
            admitted_sse_bytes: list[bytes] = []
            if sse_gate is not None:
                while not sse_gate.initial_admitted:
                    try:
                        chunk = response.read1(65_536)
                    except INITIAL_SSE_ADMISSION_ERRORS:
                        abort_upstream()
                        self._send_json_error(502, "upstream_contract_denied")
                        return
                    if not chunk:
                        sse_gate.finish()
                        break
                    immediate, committed = sse_gate.feed(
                        chunk,
                        max_logical_bytes=MAX_SSE_LOGICAL_RESPONSE_BYTES,
                        stop_after_initial=True,
                    )
                    admitted_sse_bytes.extend(immediate)
                    assert committed is None
                    if sse_gate.invalid:
                        break
                if not sse_gate.initial_admitted or sse_gate.invalid:
                    abort_upstream()
                    self._send_json_error(502, "upstream_contract_denied")
                    return
            self._start_response(response.status, "proxied")
            self._send_cors()
            for name, value in response.getheaders():
                if name.lower() in SAFE_UPSTREAM_RESPONSE_HEADERS:
                    self.send_header(name, value)
            self.send_header("Connection", "close")
            self.end_headers()
            response_bytes = 0
            for frame in admitted_sse_bytes:
                self.wfile.write(frame)
                self.wfile.flush()
            if sse_gate is not None:
                immediate, committed = sse_gate.feed(
                    b"",
                    max_logical_bytes=MAX_SSE_LOGICAL_RESPONSE_BYTES,
                )
                for frame in immediate:
                    self.wfile.write(frame)
                    self.wfile.flush()
                if committed is not None:
                    self.wfile.write(committed)
                    self.wfile.flush()
                    abort_upstream()
                    return
                if sse_gate.invalid:
                    abort_upstream()
                    return
            while chunk := response.read1(
                65_536
                if sse_gate is not None
                else min(65_536, MAX_UPSTREAM_RESPONSE_BYTES - response_bytes + 1)
            ):
                if sse_gate is None:
                    response_bytes += len(chunk)
                    if response_bytes > MAX_UPSTREAM_RESPONSE_BYTES:
                        abort_upstream()
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    continue
                immediate, committed = sse_gate.feed(
                    chunk, max_logical_bytes=MAX_SSE_LOGICAL_RESPONSE_BYTES
                )
                for frame in immediate:
                    self.wfile.write(frame)
                    self.wfile.flush()
                if committed is not None:
                    self.wfile.write(committed)
                    self.wfile.flush()
                    abort_upstream()
                    break
                if sse_gate.invalid:
                    abort_upstream()
                    break
            if sse_gate is not None:
                sse_gate.finish()
        except PROXY_STREAM_ERRORS + (http.client.HTTPException,):
            self.close_connection = True
        finally:
            deadline_timer.cancel()
            deadline_timer.join()
            downstream_stopped.set()
            try:
                self.connection.shutdown(socket.SHUT_RD)
            except OSError:
                pass
            if downstream_watcher is not None:
                downstream_watcher.join()
            abort_upstream()
            if response is not None:
                response.close()
            upstream.close()
            self.close_connection = True


def main() -> None:
    server = BoundedThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), ProxyHandler)
    print(
        f"listening=http://{LISTEN_HOST}:{LISTEN_PORT} upstream={UPSTREAM_PORT}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
