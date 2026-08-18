from __future__ import annotations

from types import SimpleNamespace

import pytest

from bilibili_note_mcp.adapters import (
    asr_siliconflow,
    bilibili_media_ytdlp,
    egress,
    media_ffmpeg,
)
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.config import ModelProfile


class _HttpxResponse:
    def __init__(self, body: bytes) -> None:
        self.headers = egress.httpx.Headers({"Content-Length": str(len(body))})
        self._body = body
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def aiter_bytes(self):  # type: ignore[no-untyped-def]
        async def _stream() -> None:
            yield self._body

        return _stream()


class _HttpxStream:
    def __init__(self, payload: bytes) -> None:
        self._response = _HttpxResponse(payload)

    async def __aenter__(self) -> _HttpxResponse:
        return self._response

    async def __aexit__(self, *args: object) -> None:
        return None


class _HttpxClient:
    def __init__(self, payload: bytes, calls: list[str]) -> None:
        self._payload = payload
        self._calls = calls

    async def __aenter__(self) -> _HttpxClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    def stream(self, method: str, url: str, **kwargs: object) -> _HttpxStream:  # type: ignore[no-untyped-def]
        del kwargs
        assert method == "GET"
        assert url.startswith("https://api.bilibili.com/")
        self._calls.append(url)
        return _HttpxStream(self._payload)

    async def aclose(self) -> None:
        return None


class _AsrResponse:
    status_code = 200
    headers: dict[str, str] = {}

    def __init__(self, body: bytes) -> None:
        self._body = body

    def raise_for_status(self) -> None:
        return None


class _AsrStream:
    def __init__(self, body: bytes) -> None:
        self._body = body
        self._response = _AsrResponse(body)

    async def __aenter__(self) -> _AsrResponse:
        return self._response

    async def __aexit__(self, *args: object) -> None:
        return None


class _AsrClient:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def stream(self, *args: object, **kwargs: object) -> _AsrStream:  # type: ignore[no-untyped-def]
        del args, kwargs
        return _AsrStream(self._body)

    async def aclose(self) -> None:
        return None


@pytest.mark.parametrize(
    "payload",
    (
        b'{"code":0,"\\u0063ode":1,"data":{"duration":10}}',
        b'{"code":NaN,"data":{"duration":10}}',
    ),
)
async def test_safe_http_client_rejects_duplicate_json_key(
    payload: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    def client_factory(*args: object, **kwargs: object) -> _HttpxClient:
        del args, kwargs
        return _HttpxClient(payload, calls)

    monkeypatch.setattr(egress.httpx, "AsyncClient", client_factory)
    monkeypatch.setenv("BILIBILI_NOTE_EGRESS_PROXY", "http://127.0.0.1:1082")

    with pytest.raises(BilibiliNoteFailure) as failure:
        await egress.SafeHttpClient().get_json("https://api.bilibili.com/x/web-interface/view")

    assert failure.value.code == "SOURCE_UNAVAILABLE"
    assert failure.value.reason == "metadata_json_invalid"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "payload",
    (
        b'{"text":"A","text":"B"}',
        b'{"text":NaN}',
    ),
)
async def test_asr_rejects_duplicate_or_nonfinite_text_in_provider_json(
    payload: bytes, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TEST_SILICONFLOW_KEY", "secret")
    media_path = tmp_path / "audio.mp3"
    media_path.write_bytes(b"audio")

    async def fake_body(*args: object, **kwargs: object) -> bytes:  # type: ignore[no-untyped-def]
        del args, kwargs
        return payload

    monkeypatch.setattr(asr_siliconflow, "read_httpx_body", fake_body)

    async def no_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(asr_siliconflow.asyncio, "sleep", no_sleep)

    profile = ModelProfile(
        provider="siliconflow",
        base_url="https://example.invalid/v1",
        vision_model="test-vision",
        asr_model="test-asr",
        api_key_env="TEST_SILICONFLOW_KEY",
        timeout_seconds=1,
        max_output_tokens=100,
    )
    metrics = asr_siliconflow._AsrMetrics()
    client = asr_siliconflow.SiliconFlowAsr(profile=profile, transport=_AsrClient(payload))

    with pytest.raises(BilibiliNoteFailure) as failure:
        await client._transcribe_file_with_client(media_path, _AsrClient(payload), metrics)

    assert failure.value.code == "TRANSCRIPT_UNAVAILABLE"
    assert failure.value.reason == "asr_response_invalid"
    assert metrics.attempts == 4
    assert metrics.retries == 3


@pytest.mark.parametrize(
    "payload",
    (
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080}],"streams":[{"codec_type":"audio","width":1,"height":1}],"format":{}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080,"duration":NaN}],"format":{"size":"0"}}',
        b'{"streams":[{"codec_type":"video","width":"1920","height":1080,"duration":"1"}]}',
        b'{"streams":[{"codec_type":"video","width":1920.0,"height":1080,"duration":"1"}]}',
        b'{"streams":[{"codec_type":"video","width":true,"height":1080,"duration":"1"}]}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":"1080","duration":"1"}]}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080.0,"duration":"1"}]}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":false,"duration":"1"}]}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080,"duration":true}]}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080,"duration":1}]}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080,"duration":1.0}]}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080,"duration":"1e999"}]}',
    ),
)
async def test_ffprobe_probe_rejects_untrusted_receipt(
    payload: bytes, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_run(*args: object, **kwargs: object) -> tuple[int, bytes, bytes]:  # type: ignore[no-untyped-def]
        del args, kwargs
        return 0, payload, b""

    monkeypatch.setattr(media_ffmpeg, "_run", fake_run)
    source = SimpleNamespace(
        media_path=tmp_path / "source.mp4",
        source=SimpleNamespace(duration_ms=1000),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await media_ffmpeg.FfmpegMedia()._probe(source)

    assert failure.value.code == "SOURCE_UNAVAILABLE"
    assert failure.value.reason == "media_dimensions_invalid"


@pytest.mark.parametrize(
    "payload",
    (
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080}],"\\u0073treams":[{"codec_type":"audio"}],"format":{"size":"1","duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":NaN}}',
        b'{"streams":[{"codec_type":"video","width":"1920","height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920.0,"height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":true,"height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":"1080"},{"codec_type":"audio"}],"format":{"size":"1","duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080.0},{"codec_type":"audio"}],"format":{"size":"1","duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":false},{"codec_type":"audio"}],"format":{"size":"1","duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":true,"duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":1,"duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":1.0,"duration":"1"}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":true}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":1}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":1.0}}',
        b'{"streams":[{"codec_type":"video","width":1920,"height":1080},{"codec_type":"audio"}],"format":{"size":"1","duration":"1e999"}}',
    ),
)
async def test_download_probe_rejects_untrusted_receipt(
    payload: bytes, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_run(*args: object, **kwargs: object) -> SimpleNamespace:
        del args, kwargs
        return SimpleNamespace(returncode=0, stdout=payload, stderr=b"")

    monkeypatch.setattr(bilibili_media_ytdlp, "run_captured", fake_run)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await bilibili_media_ytdlp._probe(tmp_path / "source.mp4")

    assert failure.value.code == "SOURCE_UNAVAILABLE"
    assert failure.value.reason == "downloaded_media_invalid"
