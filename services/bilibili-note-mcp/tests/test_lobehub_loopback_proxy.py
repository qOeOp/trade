from __future__ import annotations

import codecs
import http.client
import importlib.util
import json
import socket
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType

import pytest


def _load_proxy() -> ModuleType:
    path = Path(__file__).parents[1] / "deploy" / "openclaw" / "lobehub_loopback_proxy.py"
    spec = importlib.util.spec_from_file_location("lobehub_loopback_proxy", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextmanager
def _running(server: ThreadingHTTPServer) -> Iterator[None]:
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.start()
    try:
        yield
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)
        assert not thread.is_alive()


def _wait_until(predicate: Callable[[], bool], *, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline
        time.sleep(0.005)


def _assert_exact_public_headers(
    headers: list[tuple[str, str]] | tuple[tuple[str, str], ...],
    expected_names: set[str],
) -> dict[str, str]:
    normalized = [(name.lower(), value) for name, value in headers]
    assert {name for name, _ in normalized} == expected_names
    for name, value in normalized:
        assert name not in {"server", "x-powered-by"}
        lowered_value = value.lower()
        assert "python/" not in lowered_value
        assert "basehttp/" not in lowered_value
        assert "bilibili-note-lobehub-proxy/" not in lowered_value
    return dict(normalized)


_RESPONSE_ID = "resp_test"
_ITEM_ID = "msg_test"
_MODEL = "openclaw/bilibili-note"
_LOBEHUB_MODEL = "openclaw"
_REQUEST_BODY = json.dumps(
    {
        "model": _MODEL,
        "stream": True,
        "input": [{"role": "user", "content": "Bilibili URL or research topic"}],
    },
    separators=(",", ":"),
).encode()
_NON_UTF8_REQUEST_BODIES = tuple(
    _REQUEST_BODY.decode().encode(encoding)
    for encoding in ("utf-16-le", "utf-16-be", "utf-16", "utf-32")
) + (codecs.BOM_UTF8 + _REQUEST_BODY,)
_INVALID_STRICT_REQUEST_BODIES = (
    b'{"model":"openclaw/bilibili-note","model":"openclaw/bilibili-note","stream":true}',
    b'{"model":"openclaw/ordinary-agent","model":"openclaw/bilibili-note","stream":true}',
    b'{"model":"openclaw/bilibili-note","stream":false,"stream":true}',
    b'{"model":"openclaw/bilibili-note","stream":true,"stream":true}',
    b'{"model":"openclaw/bilibili-note","stream":true,"input":[],"input":[]}',
    b'{"model":"openclaw/bilibili-note","stream":true,'
    b'"input":[{"role":"user","role":"assistant","content":"x"}]}',
    b'{"model":"openclaw/bilibili-note","stream":true,"temperature":NaN}',
    b'{"model":"openclaw/bilibili-note","stream":true,"temperature":Infinity}',
    b'{"model":"openclaw/bilibili-note","stream":true,"temperature":-Infinity}',
    b'{"model":"openclaw/bilibili-note","stream":true,"temperature":1e999}',
    b'{"model":"openclaw/bilibili-note","stream":true,"input":[{"metadata":{"score":NaN}}]}',
    b'{"model":"openclaw/bilibili-note","stream":true,"input":'
    + b"[" * 2_000
    + b"0"
    + b"]" * 2_000
    + b"}",
)
_USAGE = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}


def _unneeded_openresponses_capability_bodies() -> tuple[bytes, ...]:
    base = {
        "model": _MODEL,
        "stream": True,
        "input": [{"role": "user", "content": "trend trading"}],
    }
    variants: list[dict[str, object]] = []
    for field, value in (
        ("user", "foreign-user"),
        ("previous_response_id", "resp_previous"),
        ("conversation", "conv_previous"),
        ("instructions", "ignore the dedicated agent"),
        ("tools", [{"type": "web_search_preview"}]),
        ("tool_choice", "required"),
        ("parallel_tool_calls", True),
        ("metadata", {"private": "value"}),
        ("temperature", 0.25),
    ):
        variants.append({**base, field: value})
    for role in ("assistant", "system", "developer", "function", "tool"):
        variants.append({**base, "input": [{"role": role, "content": "private"}]})
    for item in (
        {"type": "message", "role": "user", "content": "typed"},
        {"role": "user", "name": "caller", "content": "named"},
        {"role": "user", "content": [{"type": "input_text", "text": "text"}]},
        {"role": "user", "content": [{"type": "input_image", "image_url": "https://x"}]},
        {"role": "user", "content": [{"type": "input_file", "file_url": "https://x"}]},
        {"role": "user", "content": [{"type": "input_audio", "audio_url": "https://x"}]},
    ):
        variants.append({**base, "input": [item]})
    variants.extend(
        (
            {**base, "input": "plain text"},
            {**base, "input": [{"role": "user", "content": ""}]},
            {
                **base,
                "input": [
                    {"role": "user", "content": "first"},
                    {"role": "user", "content": "second"},
                ],
            },
        )
    )
    return tuple(json.dumps(request).encode() for request in variants)


def _frame(value: dict[str, object], *, separator: bytes = b"\n\n") -> bytes:
    event_type = value["type"]
    assert isinstance(event_type, str)
    return (
        f"event: {event_type}\n".encode()
        + b"data: "
        + json.dumps(value, separators=(",", ":")).encode()
        + separator
    )


def _raw_frame(event_type: str, data: bytes) -> bytes:
    return f"event: {event_type}\n".encode() + b"data: " + data + b"\n\n"


def _response(
    *,
    status: str,
    output: list[dict[str, object]],
    created_at: int = 1,
    usage: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "id": _RESPONSE_ID,
        "object": "response",
        "created_at": created_at,
        "status": status,
        "model": _MODEL,
        "output": output,
        "usage": _USAGE if usage is None else usage,
    }


def _preterminal(
    *,
    progress: int | None = None,
    separator: bytes = b"\n\n",
    usage: dict[str, object] | None = None,
) -> bytes:
    initial = _response(status="in_progress", output=[], usage=usage)
    empty_item: dict[str, object] = {
        "type": "message",
        "id": _ITEM_ID,
        "role": "assistant",
        "content": [{"type": "output_text", "text": ""}],
        "status": "in_progress",
    }
    frames: list[dict[str, object]] = [
        {"type": "response.created", "response": initial},
        {"type": "response.in_progress", "response": initial},
        {"type": "response.output_item.added", "output_index": 0, "item": empty_item},
        {
            "type": "response.content_part.added",
            "item_id": _ITEM_ID,
            "output_index": 0,
            "content_index": 0,
            "part": {"type": "output_text", "text": ""},
        },
    ]
    if progress is not None:
        frames.append(
            {
                "type": "response.openclaw_tool_progress",
                "item_id": _ITEM_ID,
                "output_index": 0,
                "openclaw_tool_progress": {
                    "kind": "replaceable_stage",
                    "id": "mcp-progress",
                    "current": progress,
                    "total": 100,
                    "text": f"processing {progress}",
                },
            }
        )
    return b"".join(_frame(value, separator=separator) for value in frames)


def _success_terminal(
    *,
    separator: bytes = b"\n\n",
    note: str = "note",
    usage: dict[str, object] | None = None,
) -> bytes:
    completed_item: dict[str, object] = {
        "type": "message",
        "id": _ITEM_ID,
        "role": "assistant",
        "content": [{"type": "output_text", "text": note}],
        "phase": "final_answer",
        "status": "completed",
    }
    frames: tuple[dict[str, object], ...] = (
        {
            "type": "response.output_text.delta",
            "item_id": _ITEM_ID,
            "output_index": 0,
            "content_index": 0,
            "delta": note,
        },
        {
            "type": "response.output_text.done",
            "item_id": _ITEM_ID,
            "output_index": 0,
            "content_index": 0,
            "text": note,
        },
        {
            "type": "response.content_part.done",
            "item_id": _ITEM_ID,
            "output_index": 0,
            "content_index": 0,
            "part": {"type": "output_text", "text": note},
        },
        {
            "type": "response.output_item.done",
            "output_index": 0,
            "item": completed_item,
        },
        {
            "type": "response.completed",
            "response": _response(
                status="completed",
                output=[completed_item],
                created_at=2,
                usage=usage,
            ),
        },
    )
    return (
        b"".join(_frame(value, separator=separator) for value in frames)
        + b"data: [DONE]"
        + separator
    )


def _failed_terminal(
    *,
    separator: bytes = b"\n\n",
    usage: dict[str, object] | None = None,
) -> bytes:
    response = _response(status="failed", output=[], created_at=2, usage=usage)
    response["error"] = {"code": "api_error", "message": "failed"}
    return (
        _frame({"type": "response.failed", "response": response}, separator=separator)
        + b"data: [DONE]"
        + separator
    )


def _strict_json_invalid_sse_wires() -> tuple[bytes, ...]:
    excessive_nesting = _raw_frame(
        "response.created",
        b'{"type":"response.created","padding":' + b"[" * 2_000 + b"0" + b"]" * 2_000 + b"}",
    )
    duplicate_nested_model = _raw_frame(
        "response.created",
        (
            b'{"type":"response.created","response":{"id":"resp_test",'
            b'"object":"response","created_at":1,"status":"in_progress",'
            b'"model":"openclaw/bilibili-note","m\\u006fdel":"private-model",'
            b'"output":[],"usage":{"input_tokens":1,"output_tokens":1,'
            b'"total_tokens":2}}}'
        ),
    )
    duplicate_progress_text = _preterminal() + _raw_frame(
        "response.openclaw_tool_progress",
        (
            b'{"type":"response.openclaw_tool_progress","item_id":"msg_test",'
            b'"output_index":0,"openclaw_tool_progress":{"kind":"replaceable_stage",'
            b'"id":"mcp-progress","current":65,"total":100,"text":"safe",'
            b'"te\\u0078t":"private-progress"}}'
        ),
    )
    duplicate_terminal_delta = _preterminal() + _raw_frame(
        "response.output_text.delta",
        (
            b'{"type":"response.output_text.delta","item_id":"msg_test",'
            b'"output_index":0,"content_index":0,"delta":"safe",'
            b'"d\\u0065lta":"private-note"}'
        ),
    )
    completed_item: dict[str, object] = {
        "type": "message",
        "id": _ITEM_ID,
        "role": "assistant",
        "content": [{"type": "output_text", "text": "private-note"}],
        "phase": "final_answer",
        "status": "completed",
    }
    valid_terminal = _success_terminal(note="private-note")
    completed_offset = valid_terminal.rfind(b"event: response.completed\n")
    assert completed_offset >= 0
    completed_data = json.dumps(
        {
            "type": "response.completed",
            "response": _response(status="completed", output=[completed_item], created_at=2),
        },
        separators=(",", ":"),
    ).encode()
    completed_data = completed_data.replace(
        b'"model":"openclaw/bilibili-note"',
        b'"model":"openclaw/bilibili-note","m\\u006fdel":"private-model"',
        1,
    )
    duplicate_terminal_resource = (
        _preterminal()
        + valid_terminal[:completed_offset]
        + _raw_frame("response.completed", completed_data)
        + b"data: [DONE]\n\n"
    )
    nonfinite_created = tuple(
        _raw_frame(
            "response.created",
            (
                b'{"type":"response.created","response":{"id":"resp_test",'
                b'"object":"response","created_at":'
                + value
                + b',"status":"in_progress","model":"openclaw/bilibili-note",'
                b'"output":[],"usage":{"input_tokens":1,"output_tokens":1,'
                b'"total_tokens":2}}}'
            ),
        )
        for value in (b"NaN", b"Infinity", b"-Infinity", b"1e999")
    )
    return (
        excessive_nesting,
        duplicate_nested_model,
        duplicate_progress_text,
        duplicate_terminal_delta,
        duplicate_terminal_resource,
        *nonfinite_created,
    )


def test_strict_request_admission_normalizes_exact_lobehub_text_input() -> None:
    proxy = _load_proxy()
    body = json.dumps(
        {
            "model": _MODEL,
            "stream": True,
            "input": [{"role": "user", "content": "BV URL"}],
        }
    ).encode()

    admission = proxy.prepare_openresponses_request("/v1/responses", body)

    assert admission.admitted is True
    assert admission.body is not None
    assert json.loads(admission.body) == {
        "model": _MODEL,
        "stream": True,
        "input": [{"type": "message", "role": "user", "content": "BV URL"}],
    }


def test_strict_request_admission_projects_current_desktop_prompt_only() -> None:
    proxy = _load_proxy()
    body = json.dumps(
        {
            "model": _LOBEHUB_MODEL,
            "stream": True,
            "store": False,
            "temperature": 1,
            "top_p": 1,
            "input": [
                {"role": "system", "content": "host-owned system context"},
                {"role": "user", "content": "old user message"},
                {"role": "assistant", "content": "old assistant response"},
                {"role": "user", "content": "current BV URL"},
            ],
        }
    ).encode()

    admission = proxy.prepare_openresponses_request("/v1/responses", body)

    assert admission.admitted is True
    assert admission.body is not None
    assert json.loads(admission.body) == {
        "model": _MODEL,
        "stream": True,
        "input": [{"type": "message", "role": "user", "content": "current BV URL"}],
    }


def test_desktop_request_admission_rejects_noncanonical_or_capability_history() -> None:
    proxy = _load_proxy()
    base = {
        "model": _LOBEHUB_MODEL,
        "stream": True,
        "store": False,
        "temperature": 1,
        "top_p": 1,
        "input": [{"role": "user", "content": "current BV URL"}],
    }
    variants = (
        {**base, "model": _MODEL},
        {**base, "store": True},
        {**base, "temperature": 0},
        {**base, "temperature": 1.0},
        {**base, "top_p": 0},
        {**base, "top_p": 1.0},
        {**base, "metadata": {}},
        {**base, "input": [{"role": "assistant", "content": "not current user"}]},
        {
            **base,
            "input": [{"role": "tool", "content": "foreign tool result"}, *base["input"]],
        },
        {
            **base,
            "input": [
                {"role": "user", "content": "history", "name": "foreign"},
                *base["input"],
            ],
        },
        {
            **base,
            "input": [
                {"role": "user", "content": "history"}
                for _ in range(proxy.MAX_LOBEHUB_HISTORY_ITEMS + 1)
            ],
        },
    )

    for request in variants:
        admission = proxy.prepare_openresponses_request(
            "/v1/responses", json.dumps(request).encode()
        )
        assert admission.admitted is False
        assert admission.body is None


def test_strict_request_admission_preserves_only_unrelated_requests_exactly() -> None:
    proxy = _load_proxy()
    unrelated = proxy.prepare_openresponses_request("/v1/models", b"not-json")

    assert unrelated.admitted is True
    assert unrelated.body == b"not-json"


def test_openresponses_request_admission_requires_exact_dedicated_streaming_contract() -> None:
    proxy = _load_proxy()

    assert proxy.prepare_openresponses_request("/v1/models", None).admitted
    for body in (
        None,
        b"",
        b"not-json",
        b"[]",
        b"{}",
        b'{"model":null}',
        b'{"model":""}',
        b'{"model":"openclaw/ordinary-agent"}',
        json.dumps({"model": _MODEL}).encode(),
        json.dumps({"model": _MODEL, "stream": False}).encode(),
        json.dumps({"model": _MODEL, "stream": 1}).encode(),
        json.dumps({"model": _MODEL, "stream": "true"}).encode(),
        json.dumps({"model": _MODEL, "stream": True}).encode(),
        json.dumps({"model": _MODEL, "stream": True, "input": []}).encode(),
    ):
        assert not proxy.prepare_openresponses_request("/v1/responses", body).admitted


def test_openresponses_request_admission_rejects_every_unneeded_capability() -> None:
    proxy = _load_proxy()
    for body in _unneeded_openresponses_capability_bodies():
        admission = proxy.prepare_openresponses_request("/v1/responses", body)
        assert admission.admitted is False
        assert admission.body is None


def test_strict_request_admission_rejects_duplicates_and_nonfinite_at_any_depth() -> None:
    proxy = _load_proxy()

    for body in _INVALID_STRICT_REQUEST_BODIES:
        admission = proxy.prepare_openresponses_request("/v1/responses", body)
        assert admission.admitted is False
        assert admission.body is None


def test_strict_request_admission_rejects_non_utf8_and_utf8_bom() -> None:
    proxy = _load_proxy()

    for body in _NON_UTF8_REQUEST_BODIES:
        admission = proxy.prepare_openresponses_request("/v1/responses", body)
        assert admission.admitted is False
        assert admission.body is None


def test_sse_gate_rejects_wrong_response_model_without_terminal_commit() -> None:
    proxy = _load_proxy()
    wire = (_preterminal(progress=65) + _success_terminal(note="private note")).replace(
        _MODEL.encode(), b"openclaw/ordinary-agent"
    )
    gate = proxy._OpenResponsesSseGate()

    immediate, committed = gate.feed(wire)

    assert gate.invalid is True
    assert committed is None
    assert b"private note" not in b"".join(immediate)
    assert b"response.completed" not in b"".join(immediate)


def test_sse_gate_strict_json_rejects_duplicates_and_nonfinite_before_forwarding() -> None:
    proxy = _load_proxy()

    for wire in _strict_json_invalid_sse_wires():
        gate = proxy._OpenResponsesSseGate()
        immediate, committed = gate.feed(wire)
        forwarded = b"".join(immediate)

        assert gate.invalid is True
        assert committed is None
        assert b"private-model" not in forwarded
        assert b"private-progress" not in forwarded
        assert b"private-note" not in forwarded
        assert b"response.completed" not in forwarded
        assert b"[DONE]" not in forwarded


def test_sse_gate_requires_bounded_safe_integer_usage_before_any_terminal_commit() -> None:
    proxy = _load_proxy()
    invalid_values: tuple[object, ...] = (
        True,
        -1,
        1.5,
        proxy.MAX_SAFE_INTEGER + 1,
        2**63,
        10**100,
        float("inf"),
        float("-inf"),
        float("nan"),
    )
    for field in ("input_tokens", "output_tokens", "total_tokens"):
        for invalid_value in invalid_values:
            usage: dict[str, object] = dict(_USAGE)
            usage[field] = invalid_value
            wires = (
                _preterminal(usage=usage) + _success_terminal(),
                _preterminal(progress=89) + _success_terminal(usage=usage),
                _preterminal(progress=89) + _failed_terminal(usage=usage),
            )
            for wire in wires:
                gate = proxy._OpenResponsesSseGate()
                immediate, committed = gate.feed(wire)
                forwarded = b"".join(immediate)

                assert gate.invalid is True
                assert committed is None
                assert b'"text":"note"' not in forwarded
                assert b"response.completed" not in forwarded
                assert b"response.failed" not in forwarded
                assert b"[DONE]" not in forwarded


def test_sse_gate_accepts_number_max_safe_integer_usage_at_every_terminal_phase() -> None:
    proxy = _load_proxy()
    boundary_usage = {
        "input_tokens": proxy.MAX_SAFE_INTEGER,
        "output_tokens": proxy.MAX_SAFE_INTEGER,
        "total_tokens": proxy.MAX_SAFE_INTEGER,
    }
    wires = (
        _preterminal(usage=boundary_usage) + _success_terminal(usage=boundary_usage),
        _preterminal(usage=boundary_usage) + _failed_terminal(usage=boundary_usage),
    )

    for wire in wires:
        gate = proxy._OpenResponsesSseGate()
        immediate, committed = gate.feed(wire)

        assert gate.invalid is False
        assert immediate
        assert committed is not None
        assert committed.endswith(b"data: [DONE]\n\n")


def test_proxy_rejects_wrong_request_model_before_upstream() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    body = json.dumps({"model": "openclaw/ordinary-agent", "stream": True, "input": []}).encode()

    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=body,
                headers={"Authorization": "Bearer desktop-test"},
            )
            response = connection.getresponse()
            response_body = response.read()
        finally:
            connection.close()

    assert response.status == 400
    assert json.loads(response_body) == {"error": {"code": "request_contract_denied"}}
    assert upstream_requests == 0


def test_proxy_admits_only_standalone_lobehub_text_prompt_before_upstream() -> None:
    proxy = _load_proxy()
    upstream_bodies: list[bytes] = []

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            upstream_bodies.append(self.rfile.read(int(self.headers["Content-Length"])))
            wire = _preterminal(progress=65) + _success_terminal(note="private-note")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(wire)))
            self.end_headers()
            self.wfile.write(wire)

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    prompts = (
        "https://www.bilibili.com/video/BV1uHuQ6pEFr/",
        "搜索 Bilibili 上关于趋势交易、支撑阻力的内容",
    )
    requests = (
        {
            "model": _MODEL,
            "stream": True,
            "input": [{"role": "user", "content": prompts[0]}],
        },
        {
            "model": _LOBEHUB_MODEL,
            "stream": True,
            "store": False,
            "temperature": 1,
            "top_p": 1,
            "input": [
                {"role": "system", "content": "host context"},
                {"role": "user", "content": "old request"},
                {"role": "assistant", "content": "old response"},
                {"role": "user", "content": prompts[1]},
            ],
        },
    )

    def post(body: bytes) -> tuple[int, bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=body,
                headers={
                    "Authorization": "Bearer desktop-test",
                    "Origin": proxy.WEB_ORIGIN,
                },
            )
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    with _running(upstream), _running(bridge):
        for request in requests:
            status, response_body = post(json.dumps(request).encode())
            assert status == 200
            assert b"private-note" in response_body
        admitted_count = len(upstream_bodies)
        for body in _unneeded_openresponses_capability_bodies():
            status, response_body = post(body)
            assert status == 400
            assert json.loads(response_body) == {"error": {"code": "request_contract_denied"}}
            assert b"processing" not in response_body
            assert b"response.openclaw_tool_progress" not in response_body
            assert b"private-note" not in response_body
            assert b"response.completed" not in response_body
            assert b"[DONE]" not in response_body
        assert len(upstream_bodies) == admitted_count

    assert [json.loads(body) for body in upstream_bodies] == [
        {
            "model": _MODEL,
            "stream": True,
            "input": [{"type": "message", "role": "user", "content": prompt}],
        }
        for prompt in prompts
    ]


def test_proxy_rejects_openclaw_identity_overrides_before_upstream() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    override_headers = (
        "X-OpenClaw-Agent-Id",
        "X-OpenClaw-Agent",
        "X-OpenClaw-Model",
        "X-OpenClaw-Session-Key",
        "X-OpenClaw-User-Id",
        "X-OpenClaw-Message-Channel",
        "X-OpenClaw-Future-Override",
    )

    with _running(upstream), _running(bridge):
        for header in override_headers:
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={
                        "Authorization": "Bearer desktop-test",
                        header: "foreign-authority",
                    },
                )
                response = connection.getresponse()
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == 400
            assert json.loads(response_body) == {"error": {"code": "request_contract_denied"}}

    assert upstream_requests == 0


def test_proxy_forwards_only_closed_request_header_set() -> None:
    proxy = _load_proxy()
    observed_headers: dict[str, str] = {}

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal observed_headers
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            observed_headers = {name.lower(): value for name, value in self.headers.items()}
            wire = _preterminal() + _success_terminal()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(wire)))
            self.end_headers()
            self.wfile.write(wire)
            self.wfile.flush()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={
                    "Accept": "text/event-stream",
                    "Authorization": "Bearer desktop-test",
                    "Content-Type": "application/json",
                    "User-Agent": "private-client",
                    "X-Stainless-Runtime": "private-runtime",
                },
            )
            response = connection.getresponse()
            response_body = response.read()
        finally:
            connection.close()

    assert response.status == 200
    assert response_body == _preterminal() + _success_terminal()
    assert observed_headers["authorization"] == "Bearer desktop-test"
    assert observed_headers["content-type"] == "application/json"
    assert observed_headers["accept"] == "text/event-stream"
    assert observed_headers["accept-encoding"] == "identity"
    assert "user-agent" not in observed_headers
    assert not any(name.startswith("x-openclaw-") for name in observed_headers)
    assert not any(name.startswith("x-stainless-") for name in observed_headers)


def test_proxy_rejects_wrong_path_method_before_upstream() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        for method, path in (("GET", "/v1/responses"), ("POST", "/v1/models")):
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    method,
                    path,
                    headers={"Authorization": "Bearer desktop-test"},
                )
                response = connection.getresponse()
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == 405
            assert json.loads(response_body) == {"error": {"code": "method_denied"}}

    assert upstream_requests == 0


def test_proxy_rejects_non_streaming_request_variants_before_upstream() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    bodies = (
        {"model": _MODEL, "input": []},
        {"model": _MODEL, "stream": False, "input": []},
        {"model": _MODEL, "stream": None, "input": []},
        {"model": _MODEL, "stream": 1, "input": []},
        {"model": _MODEL, "stream": "true", "input": []},
    )

    with _running(upstream), _running(bridge):
        for body in bodies:
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=json.dumps(body).encode(),
                    headers={"Authorization": "Bearer desktop-test"},
                )
                response = connection.getresponse()
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == 400
            assert json.loads(response_body) == {"error": {"code": "request_contract_denied"}}

    assert upstream_requests == 0


def test_proxy_rejects_duplicate_and_nonfinite_json_before_upstream() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        for body in _INVALID_STRICT_REQUEST_BODIES + _NON_UTF8_REQUEST_BODIES:
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=body,
                    headers={"Authorization": "Bearer desktop-test"},
                )
                response = connection.getresponse()
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == 400
            assert json.loads(response_body) == {"error": {"code": "request_contract_denied"}}

    assert upstream_requests == 0


def test_proxy_rejects_non_sse_upstream_without_forwarding_private_bytes() -> None:
    proxy = _load_proxy()
    private_body = b'{"private":"upstream-secret"}'
    content_types: tuple[str | None, ...] = (
        "application/json",
        "text/plain",
        "text/event-streamish",
        None,
    )
    request_index = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal request_index
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            content_type = content_types[request_index]
            request_index += 1
            self.send_response(200)
            if content_type is not None:
                self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(private_body)))
            self.send_header("X-Upstream-Private", "upstream-secret")
            self.end_headers()
            try:
                self.wfile.write(private_body)
                self.wfile.flush()
            except BrokenPipeError, ConnectionResetError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        for _ in content_types:
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={"Authorization": "Bearer desktop-test"},
                )
                response = connection.getresponse()
                response_headers = dict(response.getheaders())
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == 502
            assert response_headers.get("Content-Type") == "application/json"
            assert "X-Upstream-Private" not in response_headers
            assert json.loads(response_body) == {"error": {"code": "upstream_contract_denied"}}
            assert b"upstream-secret" not in response_body

    assert request_index == len(content_types)


def test_proxy_rejects_every_non_200_sse_status_without_forwarding_upstream() -> None:
    proxy = _load_proxy()
    statuses = (101, 201, 204, 302, 400, 500)
    private_wire = _preterminal(progress=65) + _success_terminal(note="private-note")
    request_index = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal request_index
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            status = statuses[request_index]
            request_index += 1
            self.send_response(status)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("X-Upstream-Private", "private-header")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(private_wire)
                self.wfile.flush()
            except BrokenPipeError, ConnectionResetError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        for _ in statuses:
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={"Authorization": "Bearer desktop-test"},
                )
                response = connection.getresponse()
                response_headers = dict(response.getheaders())
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == 502
            assert response_headers.get("Content-Type") == "application/json"
            assert "X-Upstream-Private" not in response_headers
            assert json.loads(response_body) == {"error": {"code": "upstream_contract_denied"}}
            assert b"private-note" not in response_body
            assert b"response.completed" not in response_body
            assert b"[DONE]" not in response_body

    assert request_index == len(statuses)


def test_proxy_forwards_only_closed_response_header_set_for_200_sse() -> None:
    proxy = _load_proxy()
    wires = (
        b'event: response.created\ndata: {"type":"response.created","type":"duplicate"}\n\n',
        _preterminal() + _success_terminal(),
    )
    request_index = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal request_index
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            wire = wires[request_index]
            request_index += 1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Set-Cookie", "private=session")
            self.send_header("X-Upstream-Private", "machine-identity")
            self.send_header("Content-Length", str(len(wire)))
            self.end_headers()
            try:
                self.wfile.write(wire)
                self.wfile.flush()
            except BrokenPipeError, ConnectionResetError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        for index in range(len(wires)):
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={"Authorization": "Bearer desktop-test"},
                )
                response = connection.getresponse()
                raw_response_headers = response.getheaders()
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == (502 if index == 0 else 200)
            response_headers = _assert_exact_public_headers(
                raw_response_headers,
                (
                    {"connection", "content-length", "content-type"}
                    if index == 0
                    else {"cache-control", "connection", "content-type"}
                ),
            )
            assert response_headers["content-type"] == (
                "application/json" if index == 0 else "text/event-stream; charset=utf-8"
            )
            if index == 0:
                assert "cache-control" not in response_headers
            else:
                assert response_headers["cache-control"] == "no-cache"
            assert "set-cookie" not in response_headers
            assert "x-upstream-private" not in response_headers
            assert b"private=session" not in response_body
            assert b"machine-identity" not in response_body
            if index == 0:
                assert json.loads(response_body) == {"error": {"code": "upstream_contract_denied"}}
                assert b"response.completed" not in response_body
                assert b"[DONE]" not in response_body
            else:
                assert response_body == wires[index]

    assert request_index == len(wires)


def test_proxy_rejects_malformed_or_wrong_first_created_before_downstream_admission() -> None:
    proxy = _load_proxy()
    private_suffix = _preterminal(progress=65) + _success_terminal(note="private-note")
    wrong_model = _preterminal().replace(_MODEL.encode(), b"openclaw/private-model", 1)
    wires = (
        b"event: response.created\ndata: not-json\n\n" + private_suffix,
        _frame(
            {"type": "response.in_progress", "response": _response(status="in_progress", output=[])}
        ),
        wrong_model + private_suffix,
    )
    request_index = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal request_index
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            wire = wires[request_index]
            request_index += 1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "private-upstream-cache")
            self.send_header("X-Upstream-Private", "private-header")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(wire)
                self.wfile.flush()
            except BrokenPipeError, ConnectionResetError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        for _ in wires:
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={"Authorization": "Bearer initial-admission"},
                )
                response = connection.getresponse()
                raw_response_headers = response.getheaders()
                response_body = response.read()
            finally:
                connection.close()

            assert response.status == 502
            response_headers = _assert_exact_public_headers(
                raw_response_headers,
                {"connection", "content-length", "content-type"},
            )
            assert response_headers["content-type"] == "application/json"
            assert "cache-control" not in response_headers
            assert "x-upstream-private" not in response_headers
            assert json.loads(response_body) == {"error": {"code": "upstream_contract_denied"}}
            assert b"private" not in response_body
            assert b"response.openclaw_tool_progress" not in response_body
            assert b"response.completed" not in response_body
            assert b"[DONE]" not in response_body

    assert request_index == len(wires)


def test_proxy_rejects_ambiguous_malformed_or_oversized_upstream_content_length() -> None:
    proxy = _load_proxy()
    header_values: tuple[tuple[str, ...], ...] = (
        ("",),
        ("+1",),
        ("-1",),
        ("1_0",),
        ("\u00b2",),
        (str(proxy.MAX_SSE_LOGICAL_RESPONSE_BYTES + 1),),
        ("1" + "0" * 100,),
        ("1", "1"),
    )
    request_index = 0
    private_wire = _preterminal(progress=65) + _success_terminal(note="private-note")

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal request_index
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            values = header_values[request_index]
            request_index += 1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("X-Upstream-Private", "private-header")
            for value in values:
                self.send_header("Content-Length", value)
            self.end_headers()
            try:
                self.wfile.write(private_wire)
                self.wfile.flush()
            except BrokenPipeError, ConnectionResetError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        for _ in header_values:
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={"Authorization": "Bearer content-length"},
                )
                response = connection.getresponse()
                response_headers = {name.lower(): value for name, value in response.getheaders()}
                response_body = response.read()
            finally:
                connection.close()

            assert response.status == 502
            assert response_headers["content-type"] == "application/json"
            assert "x-upstream-private" not in response_headers
            assert json.loads(response_body) == {"error": {"code": "upstream_contract_denied"}}
            assert b"private-note" not in response_body
            assert b"response.openclaw_tool_progress" not in response_body
            assert b"response.completed" not in response_body
            assert b"[DONE]" not in response_body

    assert request_index == len(header_values)


def test_proxy_sse_strict_json_never_forwards_invalid_private_frames() -> None:
    proxy = _load_proxy()
    wires = _strict_json_invalid_sse_wires()
    request_index = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal request_index
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            wire = wires[request_index]
            request_index += 1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(wire)
                self.wfile.flush()
            except BrokenPipeError, ConnectionResetError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        initial_rejections = {0, 1, 5, 6, 7, 8}
        for index, _ in enumerate(wires):
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={"Authorization": "Bearer desktop-test"},
                )
                response = connection.getresponse()
                response_body = response.read()
            finally:
                connection.close()
            assert response.status == (502 if index in initial_rejections else 200)
            assert b"private-model" not in response_body
            assert b"private-progress" not in response_body
            assert b"private-note" not in response_body
            assert b"response.completed" not in response_body
            assert b"[DONE]" not in response_body

    assert request_index == len(wires)


def test_sse_gate_preserves_chunked_completed_and_failed_sequences_exactly() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=65)
    terminals = (
        _success_terminal(),
        _failed_terminal(),
    )
    for terminal in terminals:
        wire = progress + terminal
        gate = proxy._OpenResponsesSseGate()
        observed_immediate: list[bytes] = []
        observed_commit: bytes | None = None
        for offset in range(0, len(wire), 7):
            immediate, committed = gate.feed(wire[offset : offset + 7])
            observed_immediate.extend(immediate)
            if committed is not None:
                assert observed_commit is None
                observed_commit = committed
        assert b"".join(observed_immediate) == progress
        assert observed_commit == terminal
        assert gate.invalid is False


def test_sse_gate_accepts_every_split_of_mixed_newline_valid_sequence() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=65, separator=b"\r\n\r\n")
    terminal = _success_terminal(separator=b"\r\n\r\n")
    wire = progress + terminal

    for split in range(len(wire) + 1):
        gate = proxy._OpenResponsesSseGate()
        immediate: list[bytes] = []
        committed: bytes | None = None
        for chunk in (wire[:split], wire[split:]):
            ready, candidate = gate.feed(chunk)
            immediate.extend(ready)
            if candidate is not None:
                assert committed is None
                committed = candidate
        assert b"".join(immediate) == progress
        assert committed == terminal
        assert gate.invalid is False


def test_sse_gate_rejects_conflicting_duplicate_or_misordered_terminal_events() -> None:
    proxy = _load_proxy()

    def frame(event: str) -> bytes:
        return f'data: {{"type":"{event}"}}\n\n'.encode()

    done = b"data: [DONE]\n\n"
    sequences = (
        frame("response.completed") + frame("response.output_text.delta") + done,
        frame("response.failed") + frame("response.completed") + done,
        frame("response.completed") + frame("response.openclaw_tool_progress") + done,
        frame("response.completed") + frame("response.completed") + done,
        frame("response.output_text.delta") + frame("response.completed") + done,
    )

    for wire in sequences:
        gate = proxy._OpenResponsesSseGate()
        immediate, committed = gate.feed(_preterminal() + wire)
        assert b"".join(immediate) == _preterminal()
        assert committed is None
        assert gate.invalid is True


def test_sse_gate_rejects_completed_without_full_output_lifecycle_at_every_split() -> None:
    proxy = _load_proxy()
    for separator in (b"\n\n", b"\r\r", b"\r\n\r\n", b"\n\r\n"):
        wire = (
            _preterminal(separator=separator)
            + b"event: response.completed\ndata: "
            + b'{"type":"response.completed","response":{"output":[]}}'
            + separator
            + b"data: [DONE]"
            + separator
        )
        for split in range(len(wire) + 1):
            gate = proxy._OpenResponsesSseGate()
            immediate: list[bytes] = []
            committed: bytes | None = None
            for chunk in (wire[:split], wire[split:]):
                ready, candidate = gate.feed(chunk)
                immediate.extend(ready)
                committed = candidate if candidate is not None else committed
            assert b"".join(immediate) == _preterminal(separator=separator)
            assert committed is None
            assert gate.invalid is True


def test_sse_gate_ignores_same_chunk_physical_tail_after_logical_done() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=89)
    terminal = _success_terminal()
    logical = progress + terminal
    gate = proxy._OpenResponsesSseGate()

    immediate, committed = gate.feed(
        logical + b"physical-tail-exceeds-logical-cap",
        max_logical_bytes=len(logical),
    )

    assert b"".join(immediate) == progress
    assert committed == terminal
    assert gate.invalid is False


def test_sse_gate_admits_max_terminal_note_with_all_protocol_projections() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=89)
    terminal = _success_terminal(note="\x00" * proxy.TERMINAL_RESULT_MAX_BYTES)
    assert proxy.MAX_UPSTREAM_RESPONSE_BYTES < len(terminal)
    assert len(terminal) < proxy.MAX_SSE_LOGICAL_RESPONSE_BYTES
    assert max(map(len, terminal.split(b"\n\n"))) < proxy.MAX_SSE_FRAME_BYTES
    gate = proxy._OpenResponsesSseGate()

    immediate, committed = gate.feed(progress + terminal)

    assert b"".join(immediate) == progress
    assert committed == terminal
    assert gate.invalid is False


def test_sse_derived_logical_and_preterminal_caps_accept_bound_and_reject_cap_plus_one() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=89)
    terminal = _success_terminal(note="\x00" * proxy.TERMINAL_RESULT_MAX_BYTES)
    at_terminal_bound = proxy._OpenResponsesSseGate()
    immediate, committed = at_terminal_bound.feed(
        progress + terminal, max_logical_bytes=len(progress + terminal)
    )
    assert b"".join(immediate) == progress
    assert committed == terminal
    assert at_terminal_bound.invalid is False

    above_terminal_bound = proxy._OpenResponsesSseGate()
    immediate, committed = above_terminal_bound.feed(
        progress + terminal,
        max_logical_bytes=len(progress + terminal) - 1,
    )
    assert b"".join(immediate) == progress
    assert committed is None
    assert above_terminal_bound.invalid is True

    exact_progress = _preterminal(progress=89)
    proxy.MAX_SSE_PRETERMINAL_BYTES = len(exact_progress)
    exact_preterminal = proxy._OpenResponsesSseGate()
    immediate, committed = exact_preterminal.feed(exact_progress)
    assert b"".join(immediate) == exact_progress
    assert committed is None
    assert exact_preterminal.invalid is False

    above_preterminal = proxy._OpenResponsesSseGate()
    proxy.MAX_SSE_PRETERMINAL_BYTES = len(exact_progress) - 1
    immediate, committed = above_preterminal.feed(exact_progress)
    assert len(b"".join(immediate)) < len(exact_progress)
    assert committed is None
    assert above_preterminal.invalid is True


def test_sse_gate_rejects_decoded_terminal_cap_plus_one_before_wire_caps() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=89)
    note = "\x00" * (proxy.TERMINAL_RESULT_MAX_BYTES + 1)
    terminal = _success_terminal(note=note)
    assert len(terminal) < proxy.MAX_SSE_LOGICAL_RESPONSE_BYTES
    assert max(map(len, terminal.split(b"\n\n"))) < proxy.MAX_SSE_FRAME_BYTES

    gate = proxy._OpenResponsesSseGate()
    immediate, committed = gate.feed(progress + terminal)

    assert b"".join(immediate) == progress
    assert committed is None
    assert gate.invalid is True


def test_sse_gate_rejects_projection_divergence_and_identity_mismatch() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=89)
    mutations = (
        _success_terminal().replace(b'"text":"note"', b'"text":"different"', 1),
        _success_terminal().replace(_ITEM_ID.encode(), b"msg_foreign", 1),
    )

    for terminal in mutations:
        gate = proxy._OpenResponsesSseGate()
        immediate, committed = gate.feed(progress + terminal)
        assert b"".join(immediate) == progress
        assert committed is None
        assert gate.invalid is True


def test_sse_gate_rejects_boolean_output_and_content_indices() -> None:
    proxy = _load_proxy()
    valid = _preterminal(progress=89) + _success_terminal()
    mutations = (
        valid.replace(b'"output_index":0', b'"output_index":false', 1),
        valid.replace(b'"content_index":0', b'"content_index":false', 1),
    )

    for wire in mutations:
        gate = proxy._OpenResponsesSseGate()
        _, committed = gate.feed(wire)
        assert committed is None
        assert gate.invalid is True


def test_sse_gate_never_forwards_nonempty_or_unknown_preterminal_output() -> None:
    proxy = _load_proxy()
    payloads = (
        _preterminal().replace(b'"text":""', b'"text":"FORGED_NOTE"', 1),
        b": hidden-note\n\n",
    )

    for payload in payloads:
        gate = proxy._OpenResponsesSseGate()
        immediate, committed = gate.feed(payload)
        assert b"FORGED_NOTE" not in b"".join(immediate)
        assert b"hidden-note" not in b"".join(immediate)
        assert committed is None
        assert gate.invalid is True


def test_sse_gate_fails_closed_on_bounded_json_parser_errors() -> None:
    proxy = _load_proxy()
    payloads = (
        b"data: " + b"[" * 2_000 + b"]" * 2_000 + b"\n\n",
        b'data: {"type":' + b"9" * 10_000 + b"}\n\n",
    )
    for payload in payloads:
        gate = proxy._OpenResponsesSseGate()
        immediate, committed = gate.feed(payload)
        assert immediate == ()
        assert committed is None
        assert gate.invalid is True


def test_sse_boundary_free_one_byte_fragments_have_linear_search_work() -> None:
    proxy = _load_proxy()
    proxy.MAX_SSE_FRAME_BYTES = 4096
    original = proxy._SSE_FRAME_BOUNDARY

    class CountingBoundary:
        def __init__(self) -> None:
            self.scanned = 0

        def search(self, value: bytearray, pos: int = 0):
            self.scanned += len(value) - pos
            return original.search(value, pos)

    counter = CountingBoundary()
    proxy._SSE_FRAME_BOUNDARY = counter
    gate = proxy._OpenResponsesSseGate()
    for _ in range(proxy.MAX_SSE_FRAME_BYTES + 1):
        gate.feed(b"x")

    assert gate.invalid is True
    assert counter.scanned <= 5 * (proxy.MAX_SSE_FRAME_BYTES + 1)


def test_rejects_request_that_exceeds_cap_only_after_normalization() -> None:
    proxy = _load_proxy()
    upstream_requests: list[bytes] = []
    body = json.dumps(
        {
            "model": _MODEL,
            "stream": True,
            "input": [{"role": "user", "content": "x"}],
        },
        separators=(",", ":"),
    ).encode()
    admission = proxy.prepare_openresponses_request("/v1/responses", body)
    assert admission.admitted is True
    assert admission.body is not None and len(admission.body) > len(body)
    proxy.MAX_REQUEST_BYTES = len(body)

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            upstream_requests.append(self.rfile.read(int(self.headers["Content-Length"])))
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=body,
                headers={"Authorization": "Bearer desktop-test"},
            )
            response = connection.getresponse()
            response_body = response.read()
        finally:
            connection.close()

    assert response.status == 413
    assert json.loads(response_body) == {"error": {"code": "request_too_large"}}
    assert upstream_requests == []


def test_browser_boundary_rejects_missing_or_wrong_origin_path_and_size() -> None:
    proxy = _load_proxy()
    upstream_requests: list[str] = []

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            upstream_requests.append(self.path)
            self.send_response(204)
            self.end_headers()

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            upstream_requests.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(_preterminal() + _success_terminal())

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    def request(
        method: str,
        path: str,
        *,
        origin: str | None,
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        request_headers = dict(headers or {})
        if origin is not None:
            request_headers["Origin"] = origin
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def raw_request(
        target: str,
        *,
        method: str = "GET",
        origins: tuple[str, ...] = (proxy.WEB_ORIGIN,),
        extra_headers: tuple[str, ...] = (),
        body: bytes = b"",
    ) -> bytes:
        with socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1) as client:
            origin_headers = tuple(f"Origin: {origin}" for origin in origins)
            headers = "\r\n".join(("Host: 127.0.0.1", *origin_headers, *extra_headers))
            client.sendall(
                f"{method} {target} HTTP/1.1\r\n{headers}\r\nConnection: close\r\n\r\n".encode()
                + body
            )
            chunks: list[bytes] = []
            while chunk := client.recv(4096):
                chunks.append(chunk)
        return b"".join(chunks)

    with _running(upstream), _running(bridge):
        status, headers, body = request("OPTIONS", "/v1/responses", origin=proxy.WEB_ORIGIN)
        assert status == 204
        assert set(name.lower() for name in headers) == {
            "access-control-allow-credentials",
            "access-control-allow-headers",
            "access-control-allow-methods",
            "access-control-allow-origin",
            "access-control-allow-private-network",
            "access-control-max-age",
            "content-length",
            "vary",
        }
        assert headers["Access-Control-Allow-Origin"] == proxy.WEB_ORIGIN
        assert "Server" not in headers
        assert "Date" not in headers
        assert body == b""

        status, headers, body = request(
            "OPTIONS",
            "/v1/responses",
            origin=None,
            headers={
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type, authorization",
            },
        )
        assert status == 204
        assert set(name.lower() for name in headers) == {
            "access-control-allow-headers",
            "access-control-allow-methods",
            "access-control-max-age",
            "content-length",
        }
        assert "Access-Control-Allow-Origin" not in headers
        assert "Server" not in headers
        assert "Date" not in headers
        assert body == b""

        request_body = _REQUEST_BODY
        for method, path in (("GET", "/v1/models"), ("POST", "/v1/responses")):
            status, headers, body = request(
                method,
                path,
                origin=None,
                headers={"Authorization": "Bearer desktop-test"},
                body=request_body if method == "POST" else None,
            )
            if method == "POST":
                assert status == 200
                assert set(name.lower() for name in headers) == {
                    "connection",
                    "content-type",
                }
                assert body == _preterminal() + _success_terminal()
            else:
                assert status == 204
                assert set(name.lower() for name in headers) == {"connection"}
                assert body == b""
            assert "Server" not in headers
            assert "Date" not in headers
        assert upstream_requests == ["/v1/models", "/v1/responses"]
        upstream_requests.clear()

        for method, path in (("GET", "/v1/models"), ("POST", "/v1/responses")):
            status, headers, body = request(
                method,
                path,
                origin=proxy.WEB_ORIGIN,
                headers={"Authorization": "Bearer web-test"},
                body=request_body if method == "POST" else None,
            )
            assert status == (200 if method == "POST" else 204)
            assert set(name.lower() for name in headers) == {
                "access-control-allow-credentials",
                "access-control-allow-origin",
                "access-control-allow-private-network",
                "connection",
                "vary",
            } | ({"content-type"} if method == "POST" else set())
            assert "Server" not in headers
            assert "Date" not in headers
            assert headers["Access-Control-Allow-Origin"] == proxy.WEB_ORIGIN
            assert body == (_preterminal() + _success_terminal() if method == "POST" else b"")
        assert upstream_requests == ["/v1/models", "/v1/responses"]
        upstream_requests.clear()

        for origin in (
            "null",
            "https://example.com",
            "app://renderer",
            "app://renderer/",
            "app://renderer.evil",
        ):
            status, headers, body = request("GET", "/v1/models", origin=origin)
            assert status == 403
            assert set(name.lower() for name in headers) == {
                "connection",
                "content-length",
                "content-type",
            }
            assert "Server" not in headers
            assert "Date" not in headers
            assert json.loads(body) == {"error": {"code": "origin_denied"}}

        denied_paths = (
            "/not-v1",
            "/v1/../health",
            "/v1/%2e%2e/health",
            "/v1/responses?unexpected=1",
        )
        for method in ("GET", "OPTIONS"):
            for path in denied_paths:
                status, _, body = request(method, path, origin=proxy.WEB_ORIGIN)
                assert status == 404
                assert json.loads(body) == {"error": {"code": "path_denied"}}

        for target in ("//v1/models", "//v1/responses"):
            assert raw_request(target).startswith(b"HTTP/1.1 404 ")

        wrong_origin = "https://example.com"
        for origins in (
            (proxy.WEB_ORIGIN, wrong_origin),
            (wrong_origin, "app://renderer"),
            (proxy.WEB_ORIGIN, proxy.WEB_ORIGIN),
            (proxy.WEB_ORIGIN, "app://renderer"),
        ):
            assert raw_request("/v1/models", origins=origins).startswith(b"HTTP/1.1 403 ")

        invalid_desktop_preflights = (
            {},
            {"Access-Control-Request-Method": "GET"},
            {
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        for preflight_headers in invalid_desktop_preflights:
            status, _, body = request(
                "OPTIONS", "/v1/responses", origin=None, headers=preflight_headers
            )
            assert status == 403
            assert json.loads(body) == {"error": {"code": "origin_denied"}}

        invalid_authorizations = (
            None,
            "",
            "Basic test",
            "Bearer ",
            "Bearer  ",
            "Bearer one, Bearer two",
            "Bearer one two",
            "Bearer =",
        )
        for origin in (None, proxy.WEB_ORIGIN):
            for authorization in invalid_authorizations:
                request_headers = {} if authorization is None else {"Authorization": authorization}
                status, _, body = request(
                    "POST", "/v1/responses", origin=origin, headers=request_headers
                )
                assert status == 401
                assert json.loads(body) == {"error": {"code": "authorization_denied"}}

        for origins in ((), (proxy.WEB_ORIGIN,)):
            assert raw_request(
                "/v1/responses",
                method="POST",
                origins=origins,
                extra_headers=("Authorization: Bearer one", "Authorization: Bearer two"),
            ).startswith(b"HTTP/1.1 401 ")
        assert upstream_requests == []

        for lengths in (("0", "0"), ("0", "7"), ("7", "0")):
            duplicate_lengths = (
                "Authorization: Bearer web-test",
                *(f"Content-Length: {value}" for value in lengths),
            )
            assert raw_request(
                "/v1/responses",
                method="POST",
                extra_headers=duplicate_lengths,
            ).startswith(b"HTTP/1.1 400 ")

        request_length = str(len(request_body))
        assert len(request_length) >= 2
        malformed_lengths = (
            f"+{request_length}",
            f"{request_length[0]}_{request_length[1:]}",
        )
        for malformed_length in malformed_lengths:
            assert raw_request(
                "/v1/responses",
                method="POST",
                extra_headers=(
                    "Authorization: Bearer web-test",
                    "Content-Type: application/json",
                    f"Content-Length: {malformed_length}",
                ),
                body=request_body,
            ).startswith(b"HTTP/1.1 400 ")
        assert upstream_requests == []

        status, _, body = request(
            "POST",
            "/v1/responses",
            origin=proxy.WEB_ORIGIN,
            headers={
                "Authorization": "Bearer web-test",
                "Content-Length": str(proxy.MAX_REQUEST_BYTES + 1),
            },
        )
        assert status == 413
        assert json.loads(body) == {"error": {"code": "request_too_large"}}

        status, _, body = request(
            "POST",
            "/v1/responses",
            origin=proxy.WEB_ORIGIN,
            headers={
                "Authorization": "Bearer web-test",
                "Transfer-Encoding": "chunked",
            },
        )
        assert status == 400
        assert json.loads(body) == {"error": {"code": "transfer_encoding_denied"}}
        assert upstream_requests == []


def test_proxy_forces_identity_encoding_for_incremental_sse_bytes() -> None:
    proxy = _load_proxy()
    observed_encoding: list[str | None] = []

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            observed_encoding.append(self.headers.get("Accept-Encoding"))
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "GET",
                "/v1/models",
                headers={
                    "Authorization": "Bearer desktop-test",
                    "Accept-Encoding": "gzip",
                },
            )
            response = connection.getresponse()
            assert response.status == 204
            assert response.read() == b""
        finally:
            connection.close()

    assert observed_encoding == ["identity"]


def test_streams_first_sse_chunk_before_terminal_response() -> None:
    proxy = _load_proxy()
    first_sent = threading.Event()
    terminal_release = threading.Event()
    progress = _preterminal(progress=25)
    terminal = _success_terminal()

    class UpstreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(progress)
            self.wfile.flush()
            first_sent.set()
            terminal_release.wait(timeout=1.0)
            self.wfile.write(terminal)
            self.wfile.flush()
            self.close_connection = True

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=2)
        try:
            started = time.monotonic()
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={"Authorization": "Bearer desktop-test"},
            )
            response = connection.getresponse()
            assert response.status == 200
            assert first_sent.wait(timeout=0.2)
            observed_progress = bytearray()
            while len(observed_progress) < len(progress):
                observed_progress.extend(response.read1(len(progress) - len(observed_progress)))
            assert bytes(observed_progress) == progress
            assert time.monotonic() - started < 0.5
            terminal_release.set()
            assert response.read() == terminal
        finally:
            terminal_release.set()
            connection.close()


def test_sse_eof_or_malformed_frame_discards_buffered_terminal() -> None:
    proxy = _load_proxy()
    progress = _preterminal(progress=25)
    output = _frame(
        {
            "type": "response.output_text.delta",
            "item_id": _ITEM_ID,
            "output_index": 0,
            "content_index": 0,
            "delta": "note",
        }
    )
    completed = _frame({"type": "response.completed"})
    payloads = (
        progress + output + completed,
        progress + output + b"data: not-json\n\n" + completed + b"data: [DONE]\n\n",
    )
    request_index = 0

    class UpstreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal request_index
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            payload = payloads[request_index]
            request_index += 1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)
            self.wfile.flush()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    with _running(upstream), _running(bridge):
        observed: list[bytes] = []
        for token in ("eof", "malformed"):
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "POST",
                    "/v1/responses",
                    body=_REQUEST_BODY,
                    headers={"Authorization": f"Bearer {token}"},
                )
                response = connection.getresponse()
                assert response.status == 200
                observed.append(response.read())
            finally:
                connection.close()

    assert observed == [progress, progress]


def test_sse_early_terminal_then_cap_plus_one_never_reaches_downstream() -> None:
    proxy = _load_proxy()
    progress_sent = threading.Event()
    release_terminal = threading.Event()
    progress = _preterminal(progress=25)
    buffered_terminal = _success_terminal()[:200]
    proxy.MAX_UPSTREAM_RESPONSE_BYTES = len(progress) + len(buffered_terminal) + 4

    class UpstreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(progress)
            self.wfile.flush()
            progress_sent.set()
            release_terminal.wait(timeout=1)
            try:
                self.wfile.write(buffered_terminal + b"12345")
                self.wfile.flush()
            except OSError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={"Authorization": "Bearer cap"},
            )
            response = connection.getresponse()
            assert progress_sent.wait(timeout=0.2)
            observed_progress = bytearray()
            while len(observed_progress) < len(progress):
                observed_progress.extend(response.read1(len(progress) - len(observed_progress)))
            assert bytes(observed_progress) == progress
            release_terminal.set()
            assert response.read() == b""
        finally:
            release_terminal.set()
            connection.close()


def test_sse_early_terminal_then_deadline_never_reaches_downstream() -> None:
    proxy = _load_proxy()
    terminal_sent = threading.Event()
    progress = _preterminal(progress=25)
    buffered_terminal = _success_terminal()[:300]

    class UpstreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(progress + buffered_terminal)
            self.wfile.flush()
            terminal_sent.set()
            time.sleep(0.5)

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        upstream_response_timeout=0.15,
    )
    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={"Authorization": "Bearer deadline"},
            )
            response = connection.getresponse()
            assert terminal_sent.wait(timeout=0.2)
            assert response.read() == progress
        finally:
            connection.close()


def test_sse_done_commits_exact_bytes_without_waiting_for_physical_eof() -> None:
    proxy = _load_proxy()
    upstream_aborted = threading.Event()
    progress = _preterminal(progress=89, separator=b"\r\n\r\n")
    terminal = _success_terminal(separator=b"\r\n\r\n")

    class UpstreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(progress + terminal)
            self.wfile.flush()
            self.connection.settimeout(1)
            try:
                if self.connection.recv(1) == b"":
                    upstream_aborted.set()
            except OSError:
                upstream_aborted.set()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)
    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={"Authorization": "Bearer done"},
            )
            response = connection.getresponse()
            assert response.read() == progress + terminal
        finally:
            connection.close()
        assert upstream_aborted.wait(timeout=0.5)


def test_overlong_fragmented_sse_frame_aborts_and_releases_connection_permit() -> None:
    proxy = _load_proxy()
    proxy.MAX_SSE_FRAME_BYTES = 1024
    upstream_posts = 0
    upstream_gets = 0

    class UpstreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_posts
            upstream_posts += 1
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                for _ in range(proxy.MAX_SSE_FRAME_BYTES + 1):
                    self.wfile.write(b"x")
                self.wfile.flush()
            except OSError:
                pass

        def do_GET(self) -> None:  # noqa: N802
            nonlocal upstream_gets
            upstream_gets += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0), proxy.ProxyHandler, max_active_connections=1
    )
    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={"Authorization": "Bearer overlong"},
            )
            response = connection.getresponse()
            assert response.status == 502
            assert json.loads(response.read()) == {"error": {"code": "upstream_contract_denied"}}
        finally:
            connection.close()
        _wait_until(lambda: bridge.active_connections == 0)

        recovered = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            recovered.request("GET", "/v1/models", headers={"Authorization": "Bearer recovered"})
            assert recovered.getresponse().status == 204
        finally:
            recovered.close()

    assert upstream_posts == 1
    assert upstream_gets == 1


def test_boolean_sse_index_aborts_and_releases_connection_permit() -> None:
    proxy = _load_proxy()
    invalid = (_preterminal(progress=89) + _success_terminal()).replace(
        b'"content_index":0', b'"content_index":false', 1
    )
    upstream_posts = 0
    upstream_gets = 0

    class UpstreamHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_posts
            upstream_posts += 1
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(invalid)
            self.wfile.flush()

        def do_GET(self) -> None:  # noqa: N802
            nonlocal upstream_gets
            upstream_gets += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0), proxy.ProxyHandler, max_active_connections=1
    )
    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={"Authorization": "Bearer boolean-index"},
            )
            response = connection.getresponse()
            observed = response.read()
            assert b'"content_index":false' not in observed
            assert b'"text":"note"' not in observed
        finally:
            connection.close()
        _wait_until(lambda: bridge.active_connections == 0)

        recovered = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            recovered.request("GET", "/v1/models", headers={"Authorization": "Bearer recovered"})
            assert recovered.getresponse().status == 204
        finally:
            recovered.close()

    assert upstream_posts == 1
    assert upstream_gets == 1


def test_partial_headers_have_an_absolute_deadline_and_release_the_permit() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        max_active_connections=1,
        header_read_timeout=0.15,
    )

    with _running(upstream), _running(bridge):
        started = time.monotonic()
        with socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1) as client:
            client.settimeout(0.5)
            client.sendall(b"GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Slow: ")
            for byte in b"trickle":
                time.sleep(0.03)
                try:
                    client.sendall(bytes((byte,)))
                except OSError:
                    break
            try:
                assert client.recv(4096) == b""
            except ConnectionResetError:
                pass
        assert time.monotonic() - started < 0.5
        _wait_until(lambda: bridge.active_connections == 0)

        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request("GET", "/v1/models", headers={"Authorization": "Bearer recovered"})
            assert connection.getresponse().status == 204
        finally:
            connection.close()

    assert upstream_requests == 1


def test_partial_trickled_body_times_out_before_any_upstream_effect() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        body_read_timeout=0.15,
    )

    with _running(upstream), _running(bridge):
        with socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1) as client:
            client.settimeout(0.6)
            client.sendall(
                b"POST /v1/responses HTTP/1.1\r\n"
                b"Host: 127.0.0.1\r\n"
                b"Authorization: Bearer slow-body\r\n"
                b"Content-Length: 20\r\n\r\n"
            )
            stopped = threading.Event()

            def trickle() -> None:
                while not stopped.wait(0.03):
                    try:
                        client.sendall(b"x")
                    except OSError:
                        return

            sender = threading.Thread(target=trickle)
            sender.start()
            started = time.monotonic()
            chunks: list[bytes] = []
            try:
                while chunk := client.recv(4096):
                    chunks.append(chunk)
            except ConnectionResetError:
                pass
            finally:
                stopped.set()
                sender.join(timeout=1)
            response = b"".join(chunks)
            assert response == b"" or response.startswith(b"HTTP/1.1 408 ")
            assert time.monotonic() - started < 0.5
        _wait_until(lambda: bridge.active_connections == 0)

    assert upstream_requests == 0


def test_saturation_rejects_without_thread_or_upstream_and_capacity_recovers() -> None:
    proxy = _load_proxy()
    upstream_requests = 0

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1
            self.send_response(204)
            self.end_headers()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    cap = 2
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        max_active_connections=cap,
        header_read_timeout=0.5,
        saturation_write_timeout=0.1,
    )

    with _running(upstream), _running(bridge):
        holders = [
            socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1)
            for _ in range(cap)
        ]
        try:
            for holder in holders:
                holder.sendall(b"GET /v1/models HTTP/1.1\r\nX-Hold: ")
            _wait_until(lambda: bridge.active_connections == cap)

            started = time.monotonic()
            with socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1) as rejected:
                rejected.settimeout(0.3)
                rejected.sendall(
                    b"GET /v1/models HTTP/1.1\r\nAuthorization: Bearer rejected\r\n\r\n"
                )
                response = rejected.recv(4096)
            assert response.startswith(b"HTTP/1.1 503 ")
            assert b'"server_saturated"' in response
            response_head = response.partition(b"\r\n\r\n")[0]
            response_header_names = {
                line.partition(b":")[0].strip().lower() for line in response_head.split(b"\r\n")[1:]
            }
            assert response_header_names == {b"connection", b"content-length", b"content-type"}
            assert b"server:" not in response_head.lower()
            assert b"x-powered-by:" not in response_head.lower()
            assert b"python/" not in response_head.lower()
            assert time.monotonic() - started < 0.25
            assert bridge.peak_active_connections == cap
            assert sum(thread.is_alive() for thread in bridge._threads) <= cap
            assert upstream_requests == 0
        finally:
            for holder in holders:
                holder.close()

        _wait_until(lambda: bridge.active_connections == 0)
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        try:
            connection.request("GET", "/v1/models", headers={"Authorization": "Bearer recovered"})
            assert connection.getresponse().status == 204
        finally:
            connection.close()

    assert upstream_requests == 1


def test_upstream_trickle_cannot_extend_absolute_response_deadline() -> None:
    proxy = _load_proxy()
    synthetic_terminal = b'data: {"type":"response.completed"}\n\n'

    class TricklingUpstream(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            for _ in range(20):
                try:
                    self.wfile.write(b"x")
                    self.wfile.flush()
                except OSError:
                    return
                time.sleep(0.03)
            try:
                self.wfile.write(synthetic_terminal)
                self.wfile.flush()
            except OSError:
                pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), TricklingUpstream)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        upstream_response_timeout=0.15,
    )

    with _running(upstream), _running(bridge):
        connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
        started = time.monotonic()
        try:
            connection.request(
                "POST",
                "/v1/responses",
                body=_REQUEST_BODY,
                headers={"Authorization": "Bearer deadline"},
            )
            response = connection.getresponse()
            body = response.read()
        finally:
            connection.close()
        assert time.monotonic() - started < 0.45
        assert synthetic_terminal not in body
        _wait_until(lambda: bridge.active_connections == 0)


def test_upstream_response_cap_allows_exact_size_and_closes_on_cap_plus_one() -> None:
    proxy = _load_proxy()
    proxy.MAX_UPSTREAM_RESPONSE_BYTES = 64
    payloads = [b"a" * 64, b"b" * 65]
    request_index = 0

    class SizedUpstream(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            nonlocal request_index
            payload = payloads[request_index]
            request_index += 1
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)
            self.wfile.flush()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), SizedUpstream)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(("127.0.0.1", 0), proxy.ProxyHandler)

    with _running(upstream), _running(bridge):
        observed: list[bytes] = []
        for token in ("exact", "plus-one"):
            connection = http.client.HTTPConnection("127.0.0.1", bridge.server_port, timeout=1)
            try:
                connection.request(
                    "GET",
                    "/v1/models",
                    headers={"Authorization": f"Bearer {token}"},
                )
                response = connection.getresponse()
                assert response.status == 200
                observed.append(response.read())
            finally:
                connection.close()
        _wait_until(lambda: bridge.active_connections == 0)

    assert observed[0] == b"a" * 64
    assert len(observed[1]) <= 64


def test_downstream_eof_aborts_idle_upstream_and_releases_capacity() -> None:
    proxy = _load_proxy()
    upstream_headers_sent = threading.Event()
    upstream_eof_seen = threading.Event()
    progress = _preterminal(progress=89)
    buffered_terminal = _success_terminal()[:300]

    class IdleUpstream(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(progress + buffered_terminal)
            self.wfile.flush()
            upstream_headers_sent.set()
            self.connection.settimeout(1)
            try:
                if self.connection.recv(1) == b"":
                    upstream_eof_seen.set()
            except OSError:
                upstream_eof_seen.set()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), IdleUpstream)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        max_active_connections=1,
        upstream_response_timeout=1,
    )

    with _running(upstream), _running(bridge):
        client = socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1)
        client.sendall(
            b"POST /v1/responses HTTP/1.1\r\n"
            b"Host: 127.0.0.1\r\n"
            b"Authorization: Bearer disconnect\r\n"
            + f"Content-Length: {len(_REQUEST_BODY)}\r\n\r\n".encode()
            + _REQUEST_BODY
        )
        assert upstream_headers_sent.wait(timeout=0.5)
        observed = bytearray()
        client.settimeout(0.5)
        while progress not in observed:
            observed.extend(client.recv(4096))
        assert buffered_terminal not in observed
        client.close()
        assert upstream_eof_seen.wait(timeout=0.5)
        _wait_until(lambda: bridge.active_connections == 0)


def test_downstream_eof_before_upstream_headers_aborts_and_releases_capacity() -> None:
    proxy = _load_proxy()
    upstream_request_seen = threading.Event()
    upstream_abort_seen = threading.Event()

    class WithheldHeadersUpstream(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            upstream_request_seen.set()
            self.connection.settimeout(1)
            try:
                if self.connection.recv(1) == b"":
                    upstream_abort_seen.set()
            except OSError:
                upstream_abort_seen.set()

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), WithheldHeadersUpstream)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        max_active_connections=1,
        upstream_response_timeout=5,
    )

    with _running(upstream), _running(bridge):
        client = socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1)
        client.sendall(
            b"POST /v1/responses HTTP/1.1\r\n"
            b"Host: 127.0.0.1\r\n"
            b"Authorization: Bearer disconnect-before-headers\r\n"
            + f"Content-Length: {len(_REQUEST_BODY)}\r\n\r\n".encode()
            + _REQUEST_BODY
        )
        assert upstream_request_seen.wait(timeout=0.5)
        client.close()
        assert upstream_abort_seen.wait(timeout=0.5)
        _wait_until(lambda: bridge.active_connections == 0)


def test_downstream_eof_interrupts_in_progress_upstream_connect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxy = _load_proxy()
    connect_entered = threading.Event()
    release_connect = threading.Event()
    blocked_sockets: list[socket.socket] = []

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        max_active_connections=1,
        upstream_response_timeout=5,
    )
    original_connect = socket.socket.connect

    def blocked_connect(
        connection: socket.socket,
        address: tuple[str, int],
    ) -> None:
        if address == ("127.0.0.1", upstream.server_port):
            blocked_sockets.append(connection)
            connect_entered.set()
            release_connect.wait(timeout=1)
        original_connect(connection, address)

    monkeypatch.setattr(socket.socket, "connect", blocked_connect)
    with _running(upstream), _running(bridge):
        client = socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1)
        try:
            client.sendall(
                b"POST /v1/responses HTTP/1.1\r\n"
                b"Host: 127.0.0.1\r\n"
                b"Authorization: Bearer disconnect-during-connect\r\n"
                + f"Content-Length: {len(_REQUEST_BODY)}\r\n\r\n".encode()
                + _REQUEST_BODY
            )
            assert connect_entered.wait(timeout=0.5)
            client.close()
            _wait_until(lambda: blocked_sockets[0].fileno() == -1)
        finally:
            release_connect.set()
            client.close()
        _wait_until(lambda: bridge.active_connections == 0)


def test_downstream_eof_cannot_reopen_socket_during_request_issue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proxy = _load_proxy()
    request_entered = threading.Event()
    release_request = threading.Event()
    connections: list[http.client.HTTPConnection] = []
    upstream_requests = 0
    server_errors: list[tuple[object, object]] = []

    class UpstreamProbe(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            nonlocal upstream_requests
            upstream_requests += 1

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamProbe)
    proxy.UPSTREAM_PORT = upstream.server_port
    bridge = proxy.BoundedThreadingHTTPServer(
        ("127.0.0.1", 0),
        proxy.ProxyHandler,
        max_active_connections=1,
        upstream_response_timeout=5,
    )
    bridge.handle_error = lambda request, client_address: server_errors.append(
        (request, client_address)
    )
    original_request = http.client.HTTPConnection.request

    def blocked_request(
        connection: http.client.HTTPConnection,
        method: str,
        url: str,
        body: object = None,
        headers: dict[str, str] | None = None,
        *,
        encode_chunked: bool = False,
    ) -> None:
        connections.append(connection)
        request_entered.set()
        release_request.wait(timeout=1)
        original_request(
            connection,
            method,
            url,
            body=body,
            headers={} if headers is None else headers,
            encode_chunked=encode_chunked,
        )

    monkeypatch.setattr(http.client.HTTPConnection, "request", blocked_request)
    with _running(upstream), _running(bridge):
        client = socket.create_connection(("127.0.0.1", bridge.server_port), timeout=1)
        try:
            client.sendall(
                b"POST /v1/responses HTTP/1.1\r\n"
                b"Host: 127.0.0.1\r\n"
                b"Authorization: Bearer disconnect-during-request\r\n"
                + f"Content-Length: {len(_REQUEST_BODY)}\r\n\r\n".encode()
                + _REQUEST_BODY
            )
            assert request_entered.wait(timeout=0.5)
            client.close()
            _wait_until(
                lambda: connections[0].sock is not None and connections[0].sock.fileno() == -1
            )
        finally:
            release_request.set()
            client.close()
        _wait_until(lambda: bridge.active_connections == 0)

    assert upstream_requests == 0
    assert server_errors == []
