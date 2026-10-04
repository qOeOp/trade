from __future__ import annotations

import asyncio
import io
import json
import ssl
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from PIL import Image

from video_note_mcp.adapters import asr_siliconflow, model_client
from video_note_mcp.adapters.asr_siliconflow import SiliconFlowAsr
from video_note_mcp.adapters.direct_notes import DirectDistiller
from video_note_mcp.adapters.model_client import JsonModelClient
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.ports import (
    AcquiredSource,
    TranscriptResult,
)
from video_note_mcp.application.progress import NullProgressReporter
from video_note_mcp.config import ModelProfile
from video_note_mcp.domain.models import VideoNote


def _profile() -> ModelProfile:
    return ModelProfile(
        provider="siliconflow",
        base_url="https://example.invalid/v1",
        vision_model="test-vision",
        asr_model="test-asr",
        api_key_env="TEST_SILICONFLOW_KEY",
        timeout_seconds=1,
        max_output_tokens=100,
    )


@pytest.fixture
def asr_audio(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"audio")

    async def extract(source, target, **_kwargs):
        assert source == audio
        target.write_bytes(b"audio")

    monkeypatch.setattr(asr_siliconflow, "_extract_audio", extract)
    return audio


def _strict_provider_payload(
    *, model: str, content: dict[str, object], variant: str, nested_key: str
) -> bytes:

    def envelope(content_text: str) -> bytes:
        encoded = json.dumps(content_text, ensure_ascii=False)
        return f'{{"model":"{model}","choices":[{{"message":{{"content":{encoded}}}}}]}}'.encode()

    content_json = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    encoded_content = json.dumps(content_json, ensure_ascii=False)
    choices = f'"choices":[{{"message":{{"content":{encoded_content}}}}}]'
    if variant == "duplicate_model":
        return f'{{"model":"foreign","\\u006dodel":"{model}",{choices}}}'.encode()
    if variant == "duplicate_content":
        return (
            f'{{"model":"{model}",'
            f'"choices":[{{"message":{{"content":"{{}}","\\u0063ontent":{encoded_content}}}}}]}}'
        ).encode()
    if variant == "duplicate_nested":
        duplicate = f'"{nested_key}":"conflict","\\u{ord(nested_key[0]):04x}{nested_key[1:]}":'
        content_json = content_json.replace(f'"{nested_key}":', duplicate, 1)
        encoded_content = json.dumps(content_json, ensure_ascii=False)
        return (
            f'{{"model":"{model}","choices":[{{"message":{{"content":{encoded_content}}}}}]}}'
        ).encode()
    if variant == "nan":
        return f'{{"model":"{model}","usage":{{"total":NaN}},{choices}}}'.encode()
    if variant == "infinity":
        return f'{{"model":"{model}","usage":{{"total":Infinity}},{choices}}}'.encode()
    if variant == "negative_infinity":
        return f'{{"model":"{model}","usage":{{"total":-Infinity}},{choices}}}'.encode()
    if variant == "float_overflow":
        return f'{{"model":"{model}","usage":{{"total":1e400}},{choices}}}'.encode()
    if variant == "content_nan":
        return envelope('{"probe":NaN}')
    if variant == "content_infinity":
        return envelope('{"probe":Infinity}')
    if variant == "content_negative_infinity":
        return envelope('{"probe":-Infinity}')
    if variant == "content_float_overflow":
        return envelope('{"probe":1e400}')
    if variant == "root_array":
        return b"[]"
    if variant == "content_array":
        return envelope("[]")
    if variant == "malformed":
        return b'{"model":'
    if variant == "content_malformed":
        return envelope("{")
    raise AssertionError(f"unknown variant: {variant}")


async def test_distiller_maps_low_level_tls_failure_to_stable_domain_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        raise ssl.SSLError("record layer failure")

    with pytest.raises(BilibiliNoteFailure) as failure:
        await JsonModelClient(profile=_profile(), transport=httpx.MockTransport(respond)).request(
            "Return a note.", [], VideoNote
        )
    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == "provider_response_invalid"


async def test_asr_uses_host_owned_45_second_alignment_windows(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    extracted_suffixes: list[str] = []

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        extracted_suffixes.append(output.suffix)
        await asyncio.to_thread(output.write_bytes, f"{start_ms}:{duration_ms}".encode())

    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"text": f"第{calls}段转写"})

    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    result = await SiliconFlowAsr(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).transcribe(tmp_path / "source.mp4", 91000, tmp_path, NullProgressReporter())
    assert [(item.start_ms, item.end_ms) for item in result.segments] == [
        (0, 45000),
        (45000, 90000),
        (90000, 91000),
    ]
    assert calls == 3
    assert extracted_suffixes == [".mp3", ".mp3", ".mp3"]


async def test_asr_provider_capacity_is_shared_across_parallel_candidates(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    entered_three = asyncio.Event()
    release = asyncio.Event()
    active = 0
    peak = 0
    calls = 0

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        await asyncio.to_thread(output.write_bytes, f"{start_ms}:{duration_ms}".encode())

    async def respond(request: httpx.Request) -> httpx.Response:
        nonlocal active, peak, calls
        del request
        calls += 1
        active += 1
        peak = max(peak, active)
        if active == 3:
            entered_three.set()
        try:
            await release.wait()
            return httpx.Response(200, json={"text": f"窗口 {calls}"})
        finally:
            active -= 1

    first_workspace = tmp_path / "first"
    second_workspace = tmp_path / "second"
    first_workspace.mkdir()
    second_workspace.mkdir()
    asr = SiliconFlowAsr(profile=_profile(), transport=httpx.MockTransport(respond))
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    tasks = (
        asyncio.create_task(
            asr.transcribe(tmp_path / "first.mp4", 135000, first_workspace, NullProgressReporter())
        ),
        asyncio.create_task(
            asr.transcribe(
                tmp_path / "second.mp4", 135000, second_workspace, NullProgressReporter()
            )
        ),
    )
    await asyncio.wait_for(entered_three.wait(), timeout=1)
    await asyncio.sleep(0)
    assert active == 3
    release.set()
    results = await asyncio.gather(*tasks)
    assert [len(result.segments) for result in results] == [3, 3]
    assert calls == 6
    assert peak == 3


async def test_asr_retries_one_transient_invalid_response(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, asr_audio: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(200, content=b"not-json")
        return httpx.Response(200, json={"text": "恢复后的转写"})

    async def no_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(asr_siliconflow.asyncio, "sleep", no_sleep)
    result = await SiliconFlowAsr(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).transcribe(asr_audio, 1000, tmp_path, NullProgressReporter())
    assert result.segments[0].text == "恢复后的转写"
    assert calls == 2


@pytest.mark.parametrize(
    ("status", "payload", "expected_code"),
    [
        (400, {"message": "bad request"}, "TRANSCRIPT_UNAVAILABLE"),
        (200, {"text": ""}, "TRANSCRIPT_UNAVAILABLE"),
        (200, {"text": 123}, "TRANSCRIPT_UNAVAILABLE"),
    ],
)
async def test_asr_does_not_retry_permanent_provider_outcomes(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    asr_audio: Path,
    status: int,
    payload: dict[str, object],
    expected_code: str,
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, json=payload)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowAsr(profile=_profile(), transport=httpx.MockTransport(respond)).transcribe(
            asr_audio, 1000, tmp_path, NullProgressReporter()
        )
    assert failure.value.code == expected_code
    assert calls == 1


async def test_asr_retries_rate_limit_and_honors_bounded_recovery(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, asr_audio: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    calls = 0
    observed_delays: list[float] = []

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 3:
            return httpx.Response(429, headers={"Retry-After": "1"}, json={"message": "slow"})
        return httpx.Response(200, json={"text": "限流后恢复"})

    async def fake_sleep(delay: float) -> None:
        observed_delays.append(delay)

    monkeypatch.setattr(asr_siliconflow.asyncio, "sleep", fake_sleep)
    result = await SiliconFlowAsr(
        profile=_profile(), transport=httpx.MockTransport(respond)
    ).transcribe(asr_audio, 1000, tmp_path, NullProgressReporter())
    assert result.segments[0].text == "限流后恢复"
    assert calls == 3
    assert observed_delays == [1.0, 1.5]


class _ChunkedBytes(httpx.AsyncByteStream):
    def __init__(self, *chunks: bytes) -> None:
        self._chunks = chunks

    async def __aiter__(self):
        for chunk in self._chunks:
            yield chunk


@pytest.mark.parametrize("declared", [True, False])
async def test_asr_response_body_is_bounded_before_json_parse(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, asr_audio: Path, declared: bool
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(asr_siliconflow, "ASR_RESPONSE_BYTES", 16)

    def respond(request: httpx.Request) -> httpx.Response:
        payload = b'{"text":"' + b"x" * 20 + b'"}'
        if declared:
            return httpx.Response(200, content=payload)
        return httpx.Response(
            200,
            headers={"Transfer-Encoding": "chunked"},
            stream=_ChunkedBytes(payload[:10], payload[10:]),
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowAsr(profile=_profile(), transport=httpx.MockTransport(respond)).transcribe(
            asr_audio, 1000, tmp_path, NullProgressReporter()
        )
    assert failure.value.reason == "asr_response_bytes_exceeded"


async def test_asr_normalized_window_text_is_bounded(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, asr_audio: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(asr_siliconflow, "ASR_WINDOW_TEXT_BYTES", 6)
    with pytest.raises(BilibiliNoteFailure) as failure:
        await SiliconFlowAsr(
            profile=_profile(),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"text": "价格支撑"})
            ),
        ).transcribe(asr_audio, 1000, tmp_path, NullProgressReporter())
    assert failure.value.reason == "asr_text_bytes_exceeded"


async def test_asr_reuses_one_client_for_all_windows_and_closes_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        await asyncio.to_thread(output.write_bytes, f"{start_ms}:{duration_ms}".encode())

    requests = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(200, json={"text": f"窗口 {requests}"})

    class TrackingClient(httpx.AsyncClient):
        close_calls = 0

        async def aclose(self) -> None:
            self.close_calls += 1
            await super().aclose()

    client = TrackingClient(transport=httpx.MockTransport(respond), trust_env=False)
    asr = SiliconFlowAsr(profile=_profile())
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    monkeypatch.setattr(asr, "_new_client", lambda: client)
    result = await asr.transcribe(tmp_path / "source.mp4", 91000, tmp_path, NullProgressReporter())
    assert len(result.segments) == 3
    assert requests == 3
    assert client.close_calls == 1
    assert client.is_closed


async def test_asr_repeated_cancellation_waits_for_exactly_one_client_close(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    request_started = asyncio.Event()
    close_started = asyncio.Event()
    allow_close = asyncio.Event()

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        del start_ms, duration_ms
        await asyncio.to_thread(output.write_bytes, b"audio")

    async def respond(request: httpx.Request) -> httpx.Response:
        del request
        request_started.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    class SlowCloseClient(httpx.AsyncClient):
        close_calls = 0

        async def aclose(self) -> None:
            self.close_calls += 1
            close_started.set()
            await allow_close.wait()
            await super().aclose()

    client = SlowCloseClient(transport=httpx.MockTransport(respond), trust_env=False)
    asr = SiliconFlowAsr(profile=_profile())
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    monkeypatch.setattr(asr, "_new_client", lambda: client)
    task = asyncio.create_task(
        asr.transcribe(tmp_path / "source.mp4", 45000, tmp_path, NullProgressReporter())
    )
    await asyncio.wait_for(request_started.wait(), timeout=1)
    task.cancel()
    await asyncio.wait_for(close_started.wait(), timeout=1)
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    allow_close.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert client.close_calls == 1
    assert client.is_closed


async def test_asr_failure_event_is_emitted_only_after_client_close(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")

    async def fake_extract(
        _media_path: Path, output: Path, *, start_ms: int, duration_ms: int
    ) -> None:
        del start_ms, duration_ms
        await asyncio.to_thread(output.write_bytes, b"audio")

    class TrackingClient(httpx.AsyncClient):
        close_calls = 0

        async def aclose(self) -> None:
            self.close_calls += 1
            await super().aclose()

    client = TrackingClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(400, json={})), trust_env=False
    )
    observed: list[str] = []

    def capture(event: str, **fields: object) -> None:
        del fields
        assert client.close_calls == 1
        observed.append(event)

    asr = SiliconFlowAsr(profile=_profile())
    monkeypatch.setattr(asr_siliconflow, "_extract_audio", fake_extract)
    monkeypatch.setattr(asr, "_new_client", lambda: client)
    monkeypatch.setattr(asr_siliconflow, "emit_operator_event", capture)
    with pytest.raises(BilibiliNoteFailure):
        await asr.transcribe(tmp_path / "source.mp4", 45000, tmp_path, NullProgressReporter())
    assert observed == ["asr_failed"]


async def test_vision_request_is_bounded_before_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(model_client, "VISION_REQUEST_BYTES", 1)
    called = False

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await JsonModelClient(profile=_profile(), transport=httpx.MockTransport(respond)).request(
            "Return a note.", [], VideoNote
        )
    assert failure.value.reason == "vision_request_too_large"
    assert called is False


@pytest.mark.parametrize("declared", [True, False])
async def test_vision_response_is_bounded_before_json_parse(
    monkeypatch: pytest.MonkeyPatch, declared: bool
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    monkeypatch.setattr(model_client, "VISION_RESPONSE_BYTES", 16)

    def respond(request: httpx.Request) -> httpx.Response:
        payload = b"x" * 17
        if declared:
            return httpx.Response(200, content=payload)
        return httpx.Response(
            200,
            headers={"Transfer-Encoding": "chunked"},
            stream=_ChunkedBytes(payload[:8], payload[8:]),
        )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await JsonModelClient(profile=_profile(), transport=httpx.MockTransport(respond)).request(
            "Return a note.", [], VideoNote
        )
    assert failure.value.reason == "vision_response_too_large"


@pytest.mark.parametrize("strict_thinking", [False, True])
async def test_provider_receives_full_evidence_and_accepts_exact_contract(
    monkeypatch, draft, strict_thinking
):
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    source = AcquiredSource(
        draft.source,
        Path("unused.mp4"),
        TranscriptResult("platform_subtitle", None, "zh-CN", draft.transcript),
        "bs_" + "a" * 64,
    )
    value = draft.note
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [
                    {"finish_reason": "stop", "message": {"content": value.model_dump_json()}}
                ],
            },
        )

    adapter = DirectDistiller(
        profile=replace(
            _profile(),
            enable_thinking=strict_thinking,
            thinking_budget=1024,
            response_format="json_schema" if strict_thinking else "json_object",
        ),
        transport=httpx.MockTransport(respond),
    )
    originals = tuple(f.png_bytes for f in draft.frames)
    result = await adapter.distill(source, draft.frames)
    assert result == value
    assert len(requests) == 1
    content = requests[0]["messages"][1]["content"]
    text = json.loads(content[0]["text"])
    assert text["transcript"] == [
        {"evidence_id": s.evidence_id, "start_ms": s.start_ms, "end_ms": s.end_ms, "text": s.text}
        for s in draft.transcript
    ]
    assert sum(x["type"] == "image_url" for x in content) == 1
    for item in content:
        if item["type"] == "image_url":
            import base64

            prefix, payload = item["image_url"]["url"].split(",", 1)
            assert prefix == "data:image/jpeg;base64"
            with Image.open(io.BytesIO(base64.b64decode(payload))) as decoded:
                assert decoded.size == (2880, 572)
                assert decoded.format == "JPEG"
    assert tuple(f.png_bytes for f in draft.frames) == originals
    assert all(f.png_bytes.startswith(b"\x89PNG") for f in draft.frames)
    assert requests[0]["enable_thinking"] is strict_thinking
    if strict_thinking:
        assert requests[0]["thinking_budget"] == 1024
        format_ = requests[0]["response_format"]
        assert format_["type"] == "json_schema"
        assert format_["json_schema"]["strict"] is True
        expected = type(value).model_json_schema()
        expected["$defs"]["NoteChapter"]["properties"]["screenshots"]["maxItems"] = 2
        assert format_["json_schema"]["schema"] == expected
    else:
        assert "thinking_budget" not in requests[0]
        assert requests[0]["response_format"] == {"type": "json_object"}
    assert requests[0]["temperature"] == 0
    assert "secret" not in json.dumps(requests)


@pytest.mark.parametrize(
    "variant",
    [
        "duplicate_model",
        "duplicate_content",
        "duplicate_nested",
        "nan",
        "infinity",
        "negative_infinity",
        "float_overflow",
        "content_nan",
        "content_infinity",
        "content_negative_infinity",
        "content_float_overflow",
        "root_array",
        "content_array",
        "malformed",
        "content_malformed",
    ],
)
async def test_provider_roles_reject_ambiguous_json(monkeypatch, variant, draft):
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    value = draft.note
    raw = _strict_provider_payload(
        model="test-vision",
        content=value.model_dump(mode="json"),
        variant=variant,
        nested_key="text",
    )
    raw = raw.replace(b'"message":', b'"finish_reason":"stop","message":')
    adapter = JsonModelClient(
        profile=_profile(),
        transport=httpx.MockTransport(lambda r: httpx.Response(200, content=raw)),
    )
    with pytest.raises(BilibiliNoteFailure, match="provider_response_invalid"):
        await adapter.request("Return a note.", [], VideoNote)


@pytest.mark.parametrize(
    "mutation",
    [
        "model_missing",
        "model_null",
        "model_changed",
        "unfinished",
        "missing_content",
        "extra_field",
        "coercible_type",
    ],
)
async def test_provider_rejects_wrong_identity_incomplete_or_open_contract(
    monkeypatch, mutation, draft
):
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    value = draft.note.model_dump(mode="json")
    if mutation == "extra_field":
        value["path"] = "/tmp/model-owned"
    if mutation == "coercible_type":
        value["overview"][0]["text"] = 42
    envelope = {
        "model": "test-vision",
        "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(value)}}],
    }
    if mutation == "model_missing":
        del envelope["model"]
    if mutation == "model_null":
        envelope["model"] = None
    if mutation == "model_changed":
        envelope["model"] = "other"
    if mutation == "unfinished":
        envelope["choices"][0]["finish_reason"] = "length"
    if mutation == "missing_content":
        envelope["choices"][0]["message"] = {}
    adapter = JsonModelClient(
        profile=_profile(),
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=envelope)),
    )
    with pytest.raises(BilibiliNoteFailure, match="provider_response_invalid"):
        await adapter.request("Return a note.", [], VideoNote)


@pytest.mark.parametrize("reported", [True, False])
async def test_provider_usage_is_reported_not_estimated(monkeypatch, draft, reported):
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "private-test-key")
    events = []
    monkeypatch.setattr(
        model_client, "emit_operator_event", lambda event, **fields: events.append((event, fields))
    )

    def respond(request):
        envelope = {
            "model": "test-vision",
            "choices": [
                {"finish_reason": "stop", "message": {"content": draft.note.model_dump_json()}}
            ],
        }
        if reported:
            envelope["usage"] = {"prompt_tokens": 123, "completion_tokens": 45, "total_tokens": 168}
        return httpx.Response(200, json=envelope)

    await JsonModelClient(_profile(), httpx.MockTransport(respond)).request(
        "Return a note.", [], VideoNote
    )
    if reported:
        assert len(events) == 1
        assert events[0][1]["total_tokens"] == 168
        assert events[0][1]["stage"] == "VideoNote"
        assert "private-test-key" not in str(events)
    else:
        assert not events


async def test_provider_rate_limit_retries_bounded_then_is_explicit(monkeypatch):
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "private-test-key")
    calls = 0

    async def no_wait(delay):
        pass

    monkeypatch.setattr(model_client.asyncio, "sleep", no_wait)

    def respond(request):
        nonlocal calls
        calls += 1
        return httpx.Response(429, json={"code": 50602})

    with pytest.raises(BilibiliNoteFailure) as e:
        await JsonModelClient(_profile(), httpx.MockTransport(respond)).request(
            "Return a note.", [], VideoNote
        )
    assert e.value.code == "RATE_LIMITED"
    assert calls == 3
    assert e.value.reason == "provider_http_429"


@pytest.mark.parametrize("status", [200, 400])
async def test_strict_mode_still_rejects_bad_output_without_fallback(monkeypatch, status):
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(
            status,
            json={
                "model": "test-vision",
                "choices": [
                    {"finish_reason": "stop", "message": {"content": '{"unexpected":true}'}}
                ],
            },
        )

    with pytest.raises(BilibiliNoteFailure):
        await JsonModelClient(
            replace(_profile(), response_format="json_schema", enable_thinking=True),
            httpx.MockTransport(respond),
        ).request("Return a note.", [], VideoNote)
    assert len(calls) == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("enable_thinking", "false"),
        ("thinking_budget", True),
        ("thinking_budget", 0),
        ("thinking_budget", 32769),
        ("response_format", "unknown"),
    ],
)
def test_model_profile_rejects_invalid_reasoning_controls(monkeypatch, tmp_path, field, value):
    from importlib.resources import files

    from video_note_mcp import config

    current = files("video_note_mcp").joinpath("profiles/v1/siliconflow.json")
    raw = json.loads(current.read_text())
    raw[field] = value
    target = tmp_path / "profiles/v1/siliconflow.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps(raw))
    monkeypatch.setattr(config, "files", lambda _: tmp_path)
    with pytest.raises(ValueError):
        config.load_model_profile("siliconflow")
