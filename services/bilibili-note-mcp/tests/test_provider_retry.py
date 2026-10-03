import asyncio
from dataclasses import replace

import httpx
import pytest
from pydantic import BaseModel

from bilibili_note_mcp.adapters import distillers
from bilibili_note_mcp.adapters.distillers import _Provider, _retry_delay
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.progress import (
    AnalysisProgressReporter,
    provider_progress_scope,
    visual_analysis_heartbeat,
)
from bilibili_note_mcp.config import load_model_profile


class Reply(BaseModel):
    value: str


def profile():
    return replace(
        load_model_profile(),
        vision_model="test-model",
        api_key_env="RETRY_TEST_KEY",
        timeout_seconds=5,
    )


def success():
    return httpx.Response(
        200,
        json={
            "model": "test-model",
            "choices": [{"finish_reason": "stop", "message": {"content": '{"value":"ok"}'}}],
        },
    )


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503, 504])
async def test_transient_retry_identical_request_then_success(monkeypatch, status):
    monkeypatch.setenv("RETRY_TEST_KEY", "secret")
    requests, waits = [], []

    async def sleep(delay):
        waits.append(delay)

    def respond(request):
        requests.append(request.content)
        return (
            httpx.Response(status, headers={"Retry-After": "3"})
            if len(requests) == 1
            else success()
        )

    monkeypatch.setattr(distillers.asyncio, "sleep", sleep)
    result = await _Provider(profile(), httpx.MockTransport(respond)).request("test", [], Reply)
    assert result.value == "ok"
    assert len(requests) == 2 and requests[0] == requests[1]
    assert waits == [3]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 413])
async def test_permanent_http_never_retried(monkeypatch, status):
    monkeypatch.setenv("RETRY_TEST_KEY", "secret")
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(status, text="untrusted upstream body secret")

    with pytest.raises(BilibiliNoteFailure) as error:
        await _Provider(profile(), httpx.MockTransport(respond)).request("test", [], Reply)
    assert len(calls) == 1
    assert error.value.reason == f"provider_http_{status}"


async def test_network_failure_retries_without_replaying_caller(monkeypatch):
    monkeypatch.setenv("RETRY_TEST_KEY", "secret")
    calls = []

    async def sleep(delay):
        pass

    def respond(request):
        calls.append(request)
        if len(calls) < 3:
            raise httpx.ConnectError("private endpoint", request=request)
        return success()

    monkeypatch.setattr(distillers.asyncio, "sleep", sleep)
    result = await _Provider(profile(), httpx.MockTransport(respond)).request("test", [], Reply)
    assert result.value == "ok" and len(calls) == 3


async def test_cancel_during_backoff_never_attempts_again(monkeypatch):
    monkeypatch.setenv("RETRY_TEST_KEY", "secret")
    waiting = asyncio.Event()
    calls = []

    async def sleep(delay):
        waiting.set()
        await asyncio.Event().wait()

    def respond(request):
        calls.append(request)
        return httpx.Response(503)

    monkeypatch.setattr(distillers.asyncio, "sleep", sleep)
    task = asyncio.create_task(
        _Provider(profile(), httpx.MockTransport(respond)).request("test", [], Reply)
    )
    await asyncio.wait_for(waiting.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(calls) == 1


async def test_total_deadline_bounds_backoff(monkeypatch):
    monkeypatch.setenv("RETRY_TEST_KEY", "secret")
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(503)

    with pytest.raises(BilibiliNoteFailure) as error:
        await _Provider(
            replace(profile(), timeout_seconds=0.01), httpx.MockTransport(respond)
        ).request("test", [], Reply)
    assert error.value.reason == "provider_timeout" and len(calls) == 1


async def test_progress_is_request_local_and_monotonic(monkeypatch):
    monkeypatch.setenv("RETRY_TEST_KEY", "secret")

    class Reporter:
        def __init__(self):
            self.updates = []

        async def report(self, update):
            self.updates.append(update)

    reporter = Reporter()
    relay = AnalysisProgressReporter(reporter)
    await relay.report(visual_analysis_heartbeat(30, 2))
    calls = []

    async def sleep(delay):
        pass

    def respond(request):
        calls.append(request)
        return httpx.Response(503) if len(calls) == 1 else success()

    monkeypatch.setattr(distillers.asyncio, "sleep", sleep)
    with provider_progress_scope(relay):
        await _Provider(profile(), httpx.MockTransport(respond)).request("test", [], Reply)
    assert reporter.updates[-1].progress == 67
    assert "第2/3次" in reporter.updates[-1].message
    from bilibili_note_mcp.application.progress import report_provider_retry

    await report_provider_retry(2, 503, 2)
    assert len(reporter.updates) == 2


def test_retry_after_bounded_and_finite():
    assert _retry_delay("999999999999", 2) == 30
    assert _retry_delay("nan", 2) == 2
    assert _retry_delay("-1", 2) == 2
    assert _retry_delay("bad", 2) == 2


async def test_retry_receipt_survives_real_operator_validation(monkeypatch, tmp_path):
    import json

    from bilibili_note_mcp.application.operator_events import operator_run

    monkeypatch.setenv("RETRY_TEST_KEY", "secret")
    sink = tmp_path / "events.jsonl"
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", str(sink))
    calls = []

    async def sleep(delay):
        pass

    def respond(request):
        calls.append(request)
        return httpx.Response(503) if len(calls) == 1 else success()

    monkeypatch.setattr(distillers.asyncio, "sleep", sleep)
    with operator_run({"test": "retry"}):
        await _Provider(profile(), httpx.MockTransport(respond)).request("test", [], Reply)
    content = await asyncio.to_thread(sink.read_text)
    event = json.loads(content.splitlines()[0])
    assert event["event"] == "provider_retry"
    assert event["status"] == 503 and event["attempt"] == 2 and event["delay_ms"] == 2000
    assert "secret" not in content
