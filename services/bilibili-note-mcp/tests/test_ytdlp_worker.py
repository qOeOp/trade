from __future__ import annotations

import asyncio
import hashlib
import json
import os
import signal
import sys
from pathlib import Path
from typing import Any

import pytest
from yt_dlp.networking.exceptions import HTTPError, TransportError
from yt_dlp.utils import (
    ContentTooShortError,
    DownloadError,
    ExtractorError,
    GeoRestrictedError,
    UnavailableVideoError,
)

from bilibili_note_mcp.adapters import _ytdlp_worker as worker
from bilibili_note_mcp.adapters import bilibili_media_ytdlp as adapter_module
from bilibili_note_mcp.adapters.bilibili_media_ytdlp import (
    YtDlpBilibiliMedia,
    _run_worker,
    _worker_environment,
)
from bilibili_note_mcp.application.errors import BilibiliNoteFailure

CANONICAL_URL = "https://www.bilibili.com/video/BV1uHuQ6pEFr?p=1"
MEDIA_URL = "https://upos-sz-mirrorcosov.bilivideo.com/media/source.mp4?token=opaque"


def _resolved_public_media(*args: object) -> tuple[str, str, str]:
    del args
    return MEDIA_URL, "api-64", "BV1uHuQ6pEFr_p1"  # gitleaks:allow - public Bilibili id


class _ApiResponse:
    def __init__(self, value: object) -> None:
        self._payload = json.dumps(value, separators=(",", ":")).encode()
        self.closed = False

    def read(self, amount: int) -> bytes:
        return self._payload[:amount]

    def close(self) -> None:
        self.closed = True


def _blocking_process_command(ready: Path, late_write: Path) -> tuple[str, ...]:
    grandchild = (
        "import pathlib,signal,sys,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "time.sleep(2);pathlib.Path(sys.argv[1]).write_text('late')"
    )
    parent = (
        "import os,pathlib,signal,subprocess,sys,time;"
        "signal.signal(signal.SIGTERM,signal.SIG_IGN);"
        "child=subprocess.Popen([sys.executable,'-c',sys.argv[3],sys.argv[2]]);"
        "pathlib.Path(sys.argv[1]).write_text(f'{os.getpid()} {child.pid}');"
        "time.sleep(10)"
    )
    return (sys.executable, "-c", parent, str(ready), str(late_write), grandchild)


async def _wait_for_file(path: Path) -> None:
    for _ in range(100):
        if await asyncio.to_thread(path.is_file):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("worker did not start")


def _pid_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


async def test_worker_timeout_kills_and_reaps_process_group(tmp_path: Path) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"

    with pytest.raises(BilibiliNoteFailure) as failure:
        await _run_worker(
            _blocking_process_command(ready, late_write),
            b"request",
            timeout_seconds=1,
            grace_seconds=0.05,
        )

    assert failure.value.code == "DEADLINE_EXCEEDED"
    assert failure.value.reason == "media_download_timeout"
    parent_pid, child_pid = (int(value) for value in ready.read_text().split())
    await asyncio.sleep(0.55)
    assert not late_write.exists()
    assert not _pid_exists(parent_pid)
    assert not _pid_exists(child_pid)


async def test_worker_cancellation_kills_group_before_return(tmp_path: Path) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"
    task = asyncio.create_task(
        _run_worker(
            _blocking_process_command(ready, late_write),
            b"request",
            timeout_seconds=10,
            grace_seconds=0.05,
        )
    )
    await _wait_for_file(ready)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    parent_pid, child_pid = (int(value) for value in ready.read_text().split())
    await asyncio.sleep(0.55)
    assert not late_write.exists()
    assert not _pid_exists(parent_pid)
    assert not _pid_exists(child_pid)


async def test_worker_communication_failure_kills_group_before_return(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ready = tmp_path / "ready"
    late_write = tmp_path / "late"
    original_create = asyncio.create_subprocess_exec

    class BrokenCommunicationProcess:
        def __init__(self, process: asyncio.subprocess.Process) -> None:
            self._process = process

        @property
        def pid(self) -> int:
            return self._process.pid

        @property
        def returncode(self) -> int | None:
            return self._process.returncode

        @property
        def stdout(self):  # type: ignore[no-untyped-def]
            return self._process.stdout

        @property
        def stderr(self):  # type: ignore[no-untyped-def]
            return self._process.stderr

        @property
        def stdin(self):  # type: ignore[no-untyped-def]
            process = self._process

            class BrokenInput:
                def write(self, payload: bytes) -> None:
                    del payload

                async def drain(self) -> None:
                    await _wait_for_file(ready)
                    raise RuntimeError("synthetic input failure")

                def close(self) -> None:
                    assert process.stdin is not None
                    process.stdin.close()

            return BrokenInput()

        async def wait(self) -> int:
            return await self._process.wait()

    async def broken_create(*args: object, **kwargs: object) -> BrokenCommunicationProcess:
        process = await original_create(*args, **kwargs)
        return BrokenCommunicationProcess(process)

    monkeypatch.setattr(adapter_module.asyncio, "create_subprocess_exec", broken_create)

    with pytest.raises(RuntimeError, match="synthetic input failure"):
        await _run_worker(
            _blocking_process_command(ready, late_write),
            b"request",
            timeout_seconds=10,
            grace_seconds=0.05,
        )

    parent_pid, child_pid = (int(value) for value in ready.read_text().split())
    await asyncio.sleep(0.55)
    assert not late_write.exists()
    assert not _pid_exists(parent_pid)
    assert not _pid_exists(child_pid)


async def test_parent_keeps_media_validation_authority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    media = tmp_path / "source.mp4"
    media.write_bytes(b"complete media")
    receipt = (
        b'{"adapter_version":"2026.7.4","format_id":"80+30280",'
        b'"id":"BV1uHuQ6pEFr_p1","ok":true,'
        b'"schema":"bilibili-note-ytdlp-worker/v4",'
        b'"attempts":1,"retries":0,"rate_limits":0,"downloaded_bytes":14}\n'
    )

    async def fake_run_worker(*args: object, **kwargs: object) -> tuple[int, bytes]:
        return 0, receipt

    async def fake_probe(path: Path) -> tuple[int, int, int]:
        assert path == media
        return 481_000, 1920, 1080

    monkeypatch.setattr(adapter_module, "_run_worker", fake_run_worker)
    monkeypatch.setattr(adapter_module, "_probe", fake_probe)

    artifact = await YtDlpBilibiliMedia().download(CANONICAL_URL, tmp_path)

    assert artifact.upstream_video_id == "BV1uHuQ6pEFr"
    assert artifact.upstream_part_index == 1
    assert artifact.media_sha256 == hashlib.sha256(b"complete media").hexdigest()
    assert artifact.observed_duration_ms == 481_000
    assert artifact.width == 1920
    assert artifact.height == 1080
    assert artifact.adapter_ref == "yt-dlp/2026.7.4"


def test_worker_environment_does_not_inherit_provider_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SILICONFLOW_API_KEY", "must-not-cross-worker-boundary")
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", "/tmp/operator.jsonl")
    environment = _worker_environment()

    assert "SILICONFLOW_API_KEY" not in environment
    assert "BILIBILI_NOTE_OPERATOR_EVENTS_PATH" not in environment
    assert environment["PYTHONIOENCODING"] == "utf-8"


async def test_operator_sink_toggle_does_not_change_worker_command_env_or_outcome(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    receipt = (
        b'{"adapter_version":"2026.7.4","attempts":1,"downloaded_bytes":0,'
        b'"format_id":"80+30280","id":"BV1uHuQ6pEFr_p1","ok":true,'
        b'"rate_limits":0,"retries":0,"schema":"bilibili-note-ytdlp-worker/v4"}\n'
    )
    invocations: list[tuple[tuple[str, ...], bytes, dict[str, str] | None]] = []

    async def fake_run_worker(
        command: tuple[str, ...], payload: bytes, **kwargs: object
    ) -> tuple[int, bytes]:
        environment = kwargs.get("env")
        assert environment is None or isinstance(environment, dict)
        invocations.append((command, payload, environment))  # type: ignore[arg-type]
        return 0, receipt

    monkeypatch.setattr(adapter_module, "_run_worker", fake_run_worker)
    monkeypatch.delenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", raising=False)
    without_sink = await adapter_module._download(CANONICAL_URL, tmp_path, None)
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", str(tmp_path / "operator.jsonl"))
    with_sink = await adapter_module._download(CANONICAL_URL, tmp_path, None)

    assert without_sink == with_sink
    assert invocations[0] == invocations[1]
    assert invocations[0][0] == (
        sys.executable,
        "-m",
        "bilibili_note_mcp.adapters._ytdlp_worker",
    )
    assert "BILIBILI_NOTE_OPERATOR_EVENTS_PATH" not in (invocations[0][2] or {})


def test_media_proxy_can_explicitly_bypass_metadata_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BILIBILI_NOTE_EGRESS_PROXY", "http://127.0.0.1:1082")
    monkeypatch.setenv("BILIBILI_NOTE_MEDIA_PROXY", "")

    assert YtDlpBilibiliMedia()._proxy is None


def test_media_proxy_inherits_metadata_proxy_when_override_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BILIBILI_NOTE_EGRESS_PROXY", "http://127.0.0.1:1082")
    monkeypatch.delenv("BILIBILI_NOTE_MEDIA_PROXY", raising=False)

    assert YtDlpBilibiliMedia()._proxy == "http://127.0.0.1:1082"


def test_worker_delegates_bilibili_extraction_to_pinned_ytdlp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    events: list[str] = []

    class FakeDownloader:
        def __init__(self, options: dict[str, Any]) -> None:
            assert options["outtmpl"].startswith(str(tmp_path))

        def __enter__(self) -> FakeDownloader:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def extract_info(self, url: str, *, download: bool) -> dict[str, str]:
            events.append("extract")
            assert url == MEDIA_URL
            assert download is True
            return {"id": "generic", "format_id": "generic"}

    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", FakeDownloader)
    monkeypatch.setattr(worker, "_resolve_public_media", _resolved_public_media)

    info, metrics = worker._download(CANONICAL_URL, tmp_path, None, None)

    assert info["id"] == "BV1uHuQ6pEFr_p1"
    assert info["format_id"] == "api-64"
    assert metrics.attempts == 1
    assert events == ["extract"]


def test_worker_resolves_one_hd_public_api_stream_without_video_webpage() -> None:
    responses = [
        _ApiResponse({"code": 0, "data": [{"cid": 123, "page": 1}]}),
        _ApiResponse(
            {
                "code": 0,
                "data": {
                    "quality": 64,
                    "durl": [{"size": 37_768_451, "url": MEDIA_URL}],
                },
            }
        ),
    ]

    class FakeDownloader:
        def __init__(self) -> None:
            self.urls: list[str] = []

        def urlopen(self, url: str) -> _ApiResponse:
            self.urls.append(url)
            return responses[len(self.urls) - 1]

    downloader = FakeDownloader()

    resolved = worker._resolve_public_media(downloader, CANONICAL_URL)  # type: ignore[arg-type]

    assert resolved == (
        MEDIA_URL,
        "api-64",
        "BV1uHuQ6pEFr_p1",  # gitleaks:allow - public Bilibili id
    )
    assert downloader.urls[0].startswith("https://api.bilibili.com/x/player/pagelist?")
    assert downloader.urls[1].startswith("https://api.bilibili.com/x/player/playurl?")
    assert "www.bilibili.com/video" not in "\n".join(downloader.urls)
    assert all(response.closed for response in responses)


@pytest.mark.parametrize(
    ("quality", "media_url"),
    (
        (32, MEDIA_URL),
        (64, "https://127.0.0.1/private.mp4"),
        (64, "https://bilivideo.com.attacker.invalid/private.mp4"),
        (64, "http://upos-sz-mirrorcosov.bilivideo.com/private.mp4"),
    ),
)
def test_worker_rejects_non_hd_or_untrusted_api_stream(quality: int, media_url: str) -> None:
    responses = [
        _ApiResponse({"code": 0, "data": [{"cid": 123, "page": 1}]}),
        _ApiResponse(
            {
                "code": 0,
                "data": {
                    "quality": quality,
                    "durl": [{"size": 1024, "url": media_url}],
                },
            }
        ),
    ]

    class FakeDownloader:
        def urlopen(self, url: str) -> _ApiResponse:
            del url
            return responses.pop(0)

    with pytest.raises(ValueError):
        worker._resolve_public_media(FakeDownloader(), CANONICAL_URL)  # type: ignore[arg-type]


def test_worker_disables_all_ytdlp_retry_owners_and_pins_media_cap(tmp_path: Path) -> None:
    metrics = worker._DownloadMetrics()
    options = worker._download_options(CANONICAL_URL, tmp_path, None, None, metrics)

    assert options["retries"] == 0
    assert options["file_access_retries"] == 0
    assert options["extractor_retries"] == 0
    assert options["fragment_retries"] == 0
    assert options["max_filesize"] == worker.MEDIA_DOWNLOAD_BYTES
    assert options["progress_hooks"] == [metrics.progress_hook]
    assert options["http_headers"] == {
        "Origin": "https://www.bilibili.com",
        "Referer": CANONICAL_URL,
        "User-Agent": worker.BILIBILI_BROWSER_USER_AGENT,
    }


def test_worker_retry_taxonomy_uses_typed_causes_not_error_text() -> None:
    response = type("Response", (), {"status": 429, "reason": "slow", "close": lambda self: None})()
    typed_rate_limit = HTTPError(response)
    wrapped = DownloadError("unrelated", (type(typed_rate_limit), typed_rate_limit, None))

    assert worker._classify_failure(wrapped) == worker._FailureClassification(
        "rate_limited", "http_rate_limit", 2
    )
    assert worker._classify_failure(DownloadError("HTTP Error 429")) == (
        worker._FailureClassification("source_unavailable", "unknown", 1)
    )
    assert worker._classify_failure(TransportError("socket reset")).cause == "transient"
    assert worker._classify_failure(GeoRestrictedError("not here")).cause == "access_denied"


@pytest.mark.parametrize(
    ("status", "cause", "family"),
    (
        (429, "rate_limited", "http_rate_limit"),
        (403, "access_denied", "http_access"),
        (408, "transient", "http_transient"),
        (425, "transient", "http_transient"),
        (500, "transient", "http_transient"),
        (404, "source_unavailable", "http_permanent"),
    ),
)
def test_worker_classifies_exact_wrapped_http_status(status: int, cause: str, family: str) -> None:
    response = type(
        "Response", (), {"status": status, "reason": "opaque", "close": lambda self: None}
    )()
    nested = HTTPError(response)
    wrapped = DownloadError("untrusted text", (type(nested), nested, None))

    classification = worker._classify_failure(wrapped)

    assert classification.cause == cause
    assert classification.failure_family == family
    assert classification.chain_depth == 2


def test_transport_occurrence_wins_over_inner_builtin_timeout() -> None:
    builtin = TimeoutError("private timeout text")
    transport = TransportError(cause=builtin)
    wrapped = DownloadError("opaque", (type(transport), transport, None))

    classification = worker._classify_failure(wrapped)

    assert classification == worker._FailureClassification("transient", "transport", 3)


def test_outer_exception_family_uses_only_exact_typed_mapping() -> None:
    response = type(
        "Response", (), {"status": 503, "reason": "opaque", "close": lambda self: None}
    )()
    cases = (
        (HTTPError(response), "http"),
        (TransportError("opaque"), "transport"),
        (ContentTooShortError(1, 2), "content_short"),
        (ExtractorError("opaque"), "extractor"),
        (UnavailableVideoError("opaque"), "unavailable"),
        (DownloadError("opaque"), "download"),
        (TimeoutError("opaque"), "builtin_timeout"),
        (OSError("opaque"), "os_error"),
        (RuntimeError("opaque"), "other"),
    )

    for error, expected in cases:
        assert worker._outer_exception_family(error) == expected

    fake_http_error = type("HTTPError", (Exception,), {})
    assert worker._outer_exception_family(fake_http_error("opaque")) == "other"


def test_worker_chain_scan_is_cycle_safe_and_depth_bounded() -> None:
    first = RuntimeError("first")
    second = RuntimeError("second")
    first.__cause__ = second
    second.__cause__ = first
    cyclic = worker._classify_failure(first)

    chain = [RuntimeError(str(index)) for index in range(worker._MAX_CHAIN_DEPTH + 4)]
    for current, nested in zip(chain, chain[1:], strict=False):
        current.__cause__ = nested
    deep = worker._classify_failure(chain[0])

    assert cyclic == worker._FailureClassification("source_unavailable", "unknown", 2)
    assert deep.chain_depth == worker._MAX_CHAIN_DEPTH
    assert deep.failure_family == "unknown"


@pytest.mark.parametrize(
    ("failure", "family"),
    (
        (GeoRestrictedError("private geo"), "access"),
        (ExtractorError("private extractor", expected=True), "extractor"),
        (UnavailableVideoError("private unavailable"), "unavailable"),
        (TimeoutError("private builtin timeout"), "unknown"),
    ),
)
def test_permanent_and_bare_timeout_fail_after_one_attempt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    family: str,
) -> None:
    attempts = 0

    class FakeDownloader:
        def __init__(self, options: dict[str, Any]) -> None:
            del options

        def __enter__(self) -> FakeDownloader:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def extract_info(self, url: str, *, download: bool) -> dict[str, str]:
            nonlocal attempts
            del url, download
            attempts += 1
            raise failure

    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", FakeDownloader)
    monkeypatch.setattr(worker, "_resolve_public_media", _resolved_public_media)

    with pytest.raises(worker._WorkerDownloadFailure) as caught:
        worker._download(CANONICAL_URL, tmp_path, None, None)

    assert attempts == 1
    assert caught.value.metrics.attempts == 1
    assert caught.value.metrics.retries == 0
    assert caught.value.diagnostics.failure_family == family


def test_failure_receipt_contains_only_closed_diagnostics() -> None:
    private = "secret-title https://example.invalid/private"
    error = DownloadError(private)
    classification = worker._classify_failure(error)
    metrics = worker._DownloadMetrics(attempts=1)
    metrics.begin_attempt()
    diagnostics = worker._failure_diagnostics(
        classification,
        metrics,
        error=error,
        attempt_started=worker.time.monotonic(),
    )

    raw = worker._receipt(ok=False, metrics=metrics, diagnostics=diagnostics)
    payload = json.loads(raw)

    assert private not in raw.decode()
    assert set(payload) == {
        "schema",
        "ok",
        "attempts",
        "retries",
        "rate_limits",
        "downloaded_bytes",
        "cause",
        "failure_family",
        "failure_phase",
        "attempt_downloaded_bytes",
        "outer_exception_family",
        "chain_depth",
        "attempt_elapsed_ms",
    }
    assert payload["failure_family"] == "unknown"
    assert payload["failure_phase"] == "before_bytes"
    assert payload["attempt_downloaded_bytes"] == 0
    assert payload["outer_exception_family"] == "download"


def test_worker_is_the_single_bounded_retry_authority(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    attempts = 0
    sleeps: list[float] = []

    class FakeDownloader:
        def __init__(self, options: dict[str, Any]) -> None:
            assert options["retries"] == 0
            assert options["extractor_retries"] == 0
            assert options["fragment_retries"] == 0

        def __enter__(self) -> FakeDownloader:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def extract_info(self, url: str, *, download: bool) -> dict[str, str]:
            nonlocal attempts
            del url, download
            attempts += 1
            if attempts == 1:
                cause = TransportError(cause=TimeoutError("private builtin timeout"))
                raise DownloadError("opaque", (type(cause), cause, None))
            return {"id": "BV1uHuQ6pEFr_p1", "format_id": "80+30280"}

    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", FakeDownloader)
    monkeypatch.setattr(worker, "_resolve_public_media", _resolved_public_media)
    monkeypatch.setattr(worker.time, "sleep", sleeps.append)

    _, metrics = worker._download(CANONICAL_URL, tmp_path, None, None)

    assert attempts == 2
    assert sleeps == [1.0]
    assert metrics.attempts == 2
    assert metrics.retries == 1
    assert metrics.rate_limits == 0


def test_final_failure_phase_uses_only_final_attempt_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    attempts = 0

    class FakeDownloader:
        def __init__(self, options: dict[str, Any]) -> None:
            self._hook = options["progress_hooks"][0]

        def __enter__(self) -> FakeDownloader:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def extract_info(self, url: str, *, download: bool) -> dict[str, str]:
            nonlocal attempts
            del url, download
            attempts += 1
            if attempts == 1:
                self._hook({"status": "downloading", "downloaded_bytes": 7})
                raise TransportError("opaque")
            raise ExtractorError("opaque", expected=True)

    monkeypatch.setattr(worker.yt_dlp, "YoutubeDL", FakeDownloader)
    monkeypatch.setattr(worker, "_resolve_public_media", _resolved_public_media)
    monkeypatch.setattr(worker.time, "sleep", lambda _: None)

    with pytest.raises(worker._WorkerDownloadFailure) as caught:
        worker._download(CANONICAL_URL, tmp_path, None, None)

    assert caught.value.metrics.downloaded_bytes == 7
    assert caught.value.diagnostics.attempt_downloaded_bytes == 0
    assert caught.value.diagnostics.failure_phase == "before_bytes"
    assert caught.value.diagnostics.outer_exception_family == "extractor"


def test_worker_progress_prechecks_projected_and_observed_byte_caps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(worker, "MEDIA_DOWNLOAD_BYTES", 10)
    metrics = worker._DownloadMetrics()

    with pytest.raises(worker._MediaBytesExceeded):
        metrics.progress_hook({"status": "downloading", "total_bytes_estimate": 11})
    with pytest.raises(worker._MediaBytesExceeded):
        metrics.progress_hook({"status": "downloading", "downloaded_bytes": 11})


def test_parent_accepts_final_rate_limit_count_separate_from_retry_count() -> None:
    receipt = adapter_module._parse_worker_receipt(
        b'{"attempt_elapsed_ms":12,"attempts":4,"cause":"rate_limited",'
        b'"chain_depth":3,"downloaded_bytes":0,"failure_family":"http_rate_limit",'
        b'"failure_phase":"before_bytes","attempt_downloaded_bytes":0,'
        b'"outer_exception_family":"download",'
        b'"ok":false,"rate_limits":4,"retries":3,'
        b'"schema":"bilibili-note-ytdlp-worker/v4"}\n'
    )

    assert receipt.attempts == 4
    assert receipt.retries == 3
    assert receipt.rate_limits == 4
    assert receipt.cause == "rate_limited"
    assert receipt.failure_family == "http_rate_limit"
    assert receipt.failure_phase == "before_bytes"
    assert receipt.attempt_downloaded_bytes == 0
    assert receipt.outer_exception_family == "download"
    assert receipt.chain_depth == 3
    assert receipt.attempt_elapsed_ms == 12


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("failure_family", "private-upstream-text"),
        ("failure_phase", "after_bytes"),
        ("outer_exception_family", "private-upstream-text"),
        ("attempt_downloaded_bytes", 1),
        ("attempt_downloaded_bytes", worker.MEDIA_DOWNLOAD_BYTES + 1),
        ("cause", "transient"),
        ("chain_depth", 9),
        ("attempt_elapsed_ms", 360_001),
    ),
)
def test_parent_strictly_rejects_open_or_out_of_bound_failure_diagnostics(
    field: str, value: object
) -> None:
    payload: dict[str, object] = {
        "schema": "bilibili-note-ytdlp-worker/v4",
        "ok": False,
        "attempts": 1,
        "retries": 0,
        "rate_limits": 0,
        "downloaded_bytes": 0,
        "cause": "source_unavailable",
        "failure_family": "unknown",
        "failure_phase": "before_bytes",
        "attempt_downloaded_bytes": 0,
        "outer_exception_family": "download",
        "chain_depth": 1,
        "attempt_elapsed_ms": 1,
    }
    payload[field] = value

    with pytest.raises(BilibiliNoteFailure) as failure:
        adapter_module._parse_worker_receipt(
            (json.dumps(payload, separators=(",", ":")) + "\n").encode()
        )

    assert failure.value.reason == "media_worker_receipt_invalid"


def test_parent_accepts_prior_attempt_bytes_with_final_before_bytes() -> None:
    payload = {
        "schema": "bilibili-note-ytdlp-worker/v4",
        "ok": False,
        "attempts": 2,
        "retries": 1,
        "rate_limits": 0,
        "downloaded_bytes": 7,
        "cause": "source_unavailable",
        "failure_family": "extractor",
        "failure_phase": "before_bytes",
        "attempt_downloaded_bytes": 0,
        "outer_exception_family": "extractor",
        "chain_depth": 1,
        "attempt_elapsed_ms": 1,
    }

    receipt = adapter_module._parse_worker_receipt(
        (json.dumps(payload, separators=(",", ":")) + "\n").encode()
    )

    assert receipt.downloaded_bytes == 7
    assert receipt.attempt_downloaded_bytes == 0
    assert receipt.failure_phase == "before_bytes"


def test_parent_rejects_extra_failure_receipt_field() -> None:
    payload = {
        "schema": "bilibili-note-ytdlp-worker/v4",
        "ok": False,
        "attempts": 1,
        "retries": 0,
        "rate_limits": 0,
        "downloaded_bytes": 0,
        "cause": "source_unavailable",
        "failure_family": "extractor",
        "failure_phase": "before_bytes",
        "attempt_downloaded_bytes": 0,
        "outer_exception_family": "extractor",
        "chain_depth": 1,
        "attempt_elapsed_ms": 1,
        "private": "must-not-pass",
    }

    with pytest.raises(BilibiliNoteFailure) as failure:
        adapter_module._parse_worker_receipt(
            (json.dumps(payload, separators=(",", ":")) + "\n").encode()
        )

    assert failure.value.reason == "media_worker_receipt_invalid"


@pytest.mark.parametrize(
    "payload",
    (
        b'{"schema":"bilibili-note-ytdlp-worker/v4","ok":false,"attempts":1,"retries":0,'
        b'"rate_limits":0,"downloaded_bytes":0,"cause":"source_unavailable",'
        b'"cause":"extractor","failure_family":"extractor","failure_phase":"before_bytes",'
        b'"attempt_downloaded_bytes":0,"outer_exception_family":"extractor",'
        b'"chain_depth":1,"attempt_elapsed_ms":1}\n',
        b'{"schema":"bilibili-note-ytdlp-worker/v4","ok":false,"attempts":1,"retries":0,'
        b'"rate_limits":0,"downloaded_bytes":0,"cause":"source_unavailable",'
        b'"failure_family":NaN,"failure_phase":"before_bytes","attempt_downloaded_bytes":0,'
        b'"outer_exception_family":"extractor","chain_depth":1,"attempt_elapsed_ms":1}\n',
    ),
)
def test_parent_rejects_untrusted_worker_receipt(payload: bytes) -> None:
    with pytest.raises(BilibiliNoteFailure) as failure:
        adapter_module._parse_worker_receipt(payload)

    assert failure.value.reason == "media_worker_receipt_invalid"


async def test_media_failed_operator_event_includes_closed_worker_diagnostics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    receipt = (
        b'{"attempt_elapsed_ms":23,"attempts":1,"cause":"source_unavailable",'
        b'"chain_depth":2,"downloaded_bytes":7,"failure_family":"extractor",'
        b'"failure_phase":"after_bytes","attempt_downloaded_bytes":7,'
        b'"outer_exception_family":"extractor","ok":false,"rate_limits":0,"retries":0,'
        b'"schema":"bilibili-note-ytdlp-worker/v4"}\n'
    )
    events: list[tuple[str, dict[str, object]]] = []

    async def fake_run_worker(*args: object, **kwargs: object) -> tuple[int, bytes]:
        return 1, receipt

    monkeypatch.setattr(adapter_module, "_run_worker", fake_run_worker)
    monkeypatch.setattr(
        adapter_module,
        "emit_operator_event",
        lambda event, **fields: events.append((event, fields)),
    )

    with pytest.raises(BilibiliNoteFailure):
        await YtDlpBilibiliMedia().download(CANONICAL_URL, tmp_path)

    assert events == [
        (
            "media_failed",
            {
                "attempts": 1,
                "retries": 0,
                "rate_limits": 0,
                "downloaded_bytes": 7,
                "code": "SOURCE_UNAVAILABLE",
                "reason": "complete_media_download_failed",
                "failure_family": "extractor",
                "failure_phase": "after_bytes",
                "attempt_downloaded_bytes": 7,
                "outer_exception_family": "extractor",
                "chain_depth": 2,
                "attempt_elapsed_ms": 23,
            },
        )
    ]


@pytest.mark.parametrize("failure", (asyncio.CancelledError(), TimeoutError()))
async def test_parent_removes_worker_partial_files_when_worker_cannot_cleanup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: BaseException,
) -> None:
    partial = tmp_path / "source.mp4.part"

    async def fail_worker(*args: object, **kwargs: object) -> tuple[int, bytes]:
        partial.write_bytes(b"partial")
        raise failure

    monkeypatch.setattr(adapter_module, "_run_worker", fail_worker)

    with pytest.raises(type(failure)):
        await adapter_module._download(CANONICAL_URL, tmp_path, None)

    assert not partial.exists()


async def test_parent_removes_partial_files_when_worker_receipt_is_malformed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    partial = tmp_path / "source.mp4.part"

    async def malformed_worker(*args: object, **kwargs: object) -> tuple[int, bytes]:
        partial.write_bytes(b"partial")
        return 0, b"not-json"

    monkeypatch.setattr(adapter_module, "_run_worker", malformed_worker)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await adapter_module._download(CANONICAL_URL, tmp_path, None)

    assert failure.value.reason == "media_worker_receipt_invalid"
    assert not partial.exists()


def test_worker_request_rejects_noncanonical_or_symlink_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    link = tmp_path / "link"
    link.symlink_to(workspace, target_is_directory=True)
    base = {
        "schema": "bilibili-note-ytdlp-worker/v4",
        "canonical_url": CANONICAL_URL,
        "workspace": str(workspace),
        "proxy": None,
        "cookie_file": None,
    }

    assert worker._validated_request(base)[:2] == (CANONICAL_URL, workspace)
    with pytest.raises(ValueError, match="worker_request_invalid"):
        worker._validated_request({**base, "canonical_url": CANONICAL_URL.replace("?p=1", "")})
    with pytest.raises(ValueError, match="worker_workspace_invalid"):
        worker._validated_request({**base, "workspace": str(link)})


def test_termination_signal_is_posix_process_group_signal() -> None:
    assert signal.SIGTERM != signal.SIGKILL
