from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlencode, urlsplit

import yt_dlp  # type: ignore[import-untyped]
from yt_dlp.networking.exceptions import (  # type: ignore[import-untyped]
    HTTPError,
    TransportError,
)
from yt_dlp.utils import (  # type: ignore[import-untyped]
    ContentTooShortError,
    DownloadError,
    ExtractorError,
    GeoRestrictedError,
    UnavailableVideoError,
)

from bilibili_note_mcp.adapters.bilibili_http import BILIBILI_BROWSER_USER_AGENT
from bilibili_note_mcp.adapters.egress import admitted_loopback_proxy
from bilibili_note_mcp.adapters.strict_json import StrictJsonError, decode_strict_json_object
from bilibili_note_mcp.application.resource_limits import MEDIA_DOWNLOAD_BYTES
from bilibili_note_mcp.domain.url_policy import InvalidBilibiliUrl, validate_bilibili_url

_INPUT_BYTES = 16 * 1024
_API_RESPONSE_BYTES = 2 * 1024 * 1024
_SCHEMA = "bilibili-note-ytdlp-worker/v4"
_MAX_ATTEMPTS = 4
_RETRY_DELAYS_SECONDS = (1.0, 2.0, 4.0)
_MAX_CHAIN_DEPTH = 8
_MAX_ATTEMPT_ELAPSED_MS = 360_000
_MEDIA_HOST_SUFFIXES = (".bilivideo.com", ".akamaized.net")

_FailureCause = Literal[
    "transient",
    "rate_limited",
    "access_denied",
    "source_unavailable",
    "media_too_large",
]
_FailureFamily = Literal[
    "media_limit",
    "http_rate_limit",
    "http_access",
    "http_transient",
    "http_permanent",
    "transport",
    "content_short",
    "access",
    "extractor",
    "unavailable",
    "invalid_metadata",
    "worker_request",
    "unknown",
]
_FailurePhase = Literal["before_bytes", "after_bytes"]
_OuterExceptionFamily = Literal[
    "http",
    "transport",
    "content_short",
    "extractor",
    "unavailable",
    "download",
    "builtin_timeout",
    "os_error",
    "other",
]


class _MediaBytesExceeded(Exception):
    pass


@dataclass(slots=True)
class _DownloadMetrics:
    attempts: int = 0
    retries: int = 0
    rate_limits: int = 0
    downloaded_bytes: int = 0
    _active_bytes: int = 0
    _attempt_downloaded_bytes: int = 0

    def begin_attempt(self) -> None:
        if self._active_bytes != 0:
            raise RuntimeError("previous download attempt is still active")
        self._attempt_downloaded_bytes = 0

    def progress_hook(self, status: dict[str, Any]) -> None:
        remaining = MEDIA_DOWNLOAD_BYTES - self.downloaded_bytes
        for name in ("total_bytes", "total_bytes_estimate"):
            projected = status.get(name)
            if projected is not None and (
                not isinstance(projected, int)
                or isinstance(projected, bool)
                or projected < 0
                or projected > remaining
            ):
                raise _MediaBytesExceeded
        observed = status.get("downloaded_bytes", 0)
        if not isinstance(observed, int) or isinstance(observed, bool) or observed < 0:
            raise _MediaBytesExceeded
        self._active_bytes = max(self._active_bytes, observed)
        if self.downloaded_bytes + self._active_bytes > MEDIA_DOWNLOAD_BYTES:
            raise _MediaBytesExceeded
        if status.get("status") == "finished":
            self.downloaded_bytes += self._active_bytes
            self._attempt_downloaded_bytes += self._active_bytes
            self._active_bytes = 0

    def finish_failed_attempt(self) -> None:
        self.downloaded_bytes += self._active_bytes
        self._attempt_downloaded_bytes += self._active_bytes
        self._active_bytes = 0

    @property
    def observed_bytes(self) -> int:
        return self.downloaded_bytes + self._active_bytes

    @property
    def attempt_observed_bytes(self) -> int:
        return self._attempt_downloaded_bytes + self._active_bytes


class _QuietLogger:
    def debug(self, message: str) -> None:
        return

    def warning(self, message: str) -> None:
        return

    def error(self, message: str) -> None:
        return


def _validated_cookie_file(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("cookie_file_invalid")
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError("cookie_file_invalid")
    return str(path)


def _validated_request(payload: object) -> tuple[str, Path, str | None, str | None]:
    if not isinstance(payload, dict) or set(payload) != {
        "schema",
        "canonical_url",
        "workspace",
        "proxy",
        "cookie_file",
    }:
        raise ValueError("worker_request_invalid")
    if payload["schema"] != _SCHEMA:
        raise ValueError("worker_request_invalid")
    canonical_url = payload["canonical_url"]
    workspace_value = payload["workspace"]
    if not isinstance(canonical_url, str) or not isinstance(workspace_value, str):
        raise ValueError("worker_request_invalid")
    try:
        validated = validate_bilibili_url(canonical_url)
    except InvalidBilibiliUrl as e:
        raise ValueError("worker_request_invalid") from e
    part = validated.requested_part or 1
    if canonical_url != validated.canonical_url(part):
        raise ValueError("worker_request_invalid")
    workspace = Path(workspace_value)
    if not workspace.is_absolute() or workspace.is_symlink() or not workspace.is_dir():
        raise ValueError("worker_workspace_invalid")
    proxy_value = payload["proxy"]
    if proxy_value is not None and not isinstance(proxy_value, str):
        raise ValueError("worker_proxy_invalid")
    proxy = admitted_loopback_proxy(proxy_value)
    cookie_file = _validated_cookie_file(payload["cookie_file"])
    return canonical_url, workspace, proxy, cookie_file


def _download_options(
    canonical_url: str,
    workspace: Path,
    proxy: str | None,
    cookie_file: str | None,
    metrics: _DownloadMetrics,
) -> dict[str, Any]:
    options: dict[str, Any] = {
        "outtmpl": str(workspace / "source.%(ext)s"),
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "logger": _QuietLogger(),
        "socket_timeout": 30,
        "retries": 0,
        "file_access_retries": 0,
        "extractor_retries": 0,
        "fragment_retries": 0,
        "max_filesize": MEDIA_DOWNLOAD_BYTES,
        "cachedir": False,
        "http_headers": {
            "Origin": "https://www.bilibili.com",
            "Referer": canonical_url,
            "User-Agent": BILIBILI_BROWSER_USER_AGENT,
        },
        "progress_hooks": [metrics.progress_hook],
    }
    if proxy is not None:
        options["proxy"] = proxy
    if cookie_file is not None:
        options["cookiefile"] = cookie_file
    return options


def _api_json(downloader: yt_dlp.YoutubeDL, url: str) -> dict[str, Any]:
    response = downloader.urlopen(url)
    try:
        payload = response.read(_API_RESPONSE_BYTES + 1)
    finally:
        response.close()
    if not payload or len(payload) > _API_RESPONSE_BYTES:
        raise ValueError("bilibili_api_response_invalid")
    try:
        value = decode_strict_json_object(payload)
    except (UnicodeDecodeError, StrictJsonError) as e:
        raise ValueError("bilibili_api_response_invalid") from e
    if not isinstance(value, dict):
        raise ValueError("bilibili_api_response_invalid")
    return value


def _positive_integer(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError("bilibili_api_response_invalid")
    return value


def _admitted_media_url(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("bilibili_media_url_invalid")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as e:
        raise ValueError("bilibili_media_url_invalid") from e
    host = (parts.hostname or "").lower()
    if (
        parts.scheme != "https"
        or port not in {None, 443}
        or parts.username is not None
        or parts.password is not None
        or not any(host.endswith(suffix) for suffix in _MEDIA_HOST_SUFFIXES)
    ):
        raise ValueError("bilibili_media_url_invalid")
    return value


def _resolve_public_media(downloader: yt_dlp.YoutubeDL, canonical_url: str) -> tuple[str, str, str]:
    validated = validate_bilibili_url(canonical_url)
    part_index = validated.requested_part or 1
    page_query = urlencode({"bvid": validated.video_id, "jsonp": "jsonp"})
    page_envelope = _api_json(
        downloader,
        f"https://api.bilibili.com/x/player/pagelist?{page_query}",
    )
    if type(page_envelope.get("code")) is not int or page_envelope["code"] != 0:
        raise ValueError("bilibili_page_list_rejected")
    pages = page_envelope.get("data")
    if not isinstance(pages, list):
        raise ValueError("bilibili_page_list_invalid")
    matches = [
        item
        for item in pages
        if isinstance(item, dict)
        and type(item.get("page")) is int
        and item.get("page") == part_index
    ]
    if len(matches) != 1:
        raise ValueError("bilibili_part_identity_invalid")
    cid = _positive_integer(matches[0].get("cid"))
    play_query = urlencode(
        {
            "bvid": validated.video_id,
            "cid": cid,
            "qn": 80,
            "fnval": 4048,
            "fnver": 0,
            "fourk": 1,
            "platform": "html5",
            "high_quality": 1,
        }
    )
    play_envelope = _api_json(
        downloader,
        f"https://api.bilibili.com/x/player/playurl?{play_query}",
    )
    if type(play_envelope.get("code")) is not int or play_envelope["code"] != 0:
        raise ValueError("bilibili_playurl_rejected")
    data = play_envelope.get("data")
    if not isinstance(data, dict):
        raise ValueError("bilibili_playurl_invalid")
    quality = _positive_integer(data.get("quality"))
    if quality < 64:
        raise ValueError("bilibili_hd_media_unavailable")
    streams = data.get("durl")
    if not isinstance(streams, list) or len(streams) != 1 or not isinstance(streams[0], dict):
        raise ValueError("bilibili_playurl_invalid")
    declared_size = _positive_integer(streams[0].get("size"))
    if declared_size > MEDIA_DOWNLOAD_BYTES:
        raise _MediaBytesExceeded
    media_url = _admitted_media_url(streams[0].get("url"))
    return media_url, f"api-{quality}", f"{validated.video_id}_p{part_index}"


@dataclass(frozen=True, slots=True)
class _FailureClassification:
    cause: _FailureCause
    failure_family: _FailureFamily
    chain_depth: int


@dataclass(frozen=True, slots=True)
class _FailureDiagnostics:
    cause: _FailureCause
    failure_family: _FailureFamily
    failure_phase: _FailurePhase
    attempt_downloaded_bytes: int
    outer_exception_family: _OuterExceptionFamily
    chain_depth: int
    attempt_elapsed_ms: int


def _nested_exceptions(error: BaseException) -> tuple[BaseException, ...]:
    nested: list[BaseException] = []
    if isinstance(error, DownloadError) and error.exc_info is not None:
        candidate = error.exc_info[1]
        if isinstance(candidate, BaseException):
            nested.append(candidate)
    candidate = getattr(error, "cause", None)
    if isinstance(candidate, BaseException):
        nested.append(candidate)
    if error.__cause__ is not None:
        nested.append(error.__cause__)
    if error.__context__ is not None:
        nested.append(error.__context__)
    unique: list[BaseException] = []
    seen: set[int] = set()
    for item in nested:
        if id(item) not in seen:
            seen.add(id(item))
            unique.append(item)
    return tuple(unique)


def _exception_chain(error: BaseException) -> tuple[tuple[BaseException, ...], int]:
    pending: list[tuple[BaseException, int]] = [(error, 1)]
    seen: set[int] = set()
    chain: list[BaseException] = []
    observed_depth = 0
    while pending:
        current, depth = pending.pop(0)
        if id(current) in seen or depth > _MAX_CHAIN_DEPTH:
            continue
        seen.add(id(current))
        chain.append(current)
        observed_depth = max(observed_depth, depth)
        if depth < _MAX_CHAIN_DEPTH:
            pending.extend((nested, depth + 1) for nested in _nested_exceptions(current))
    return tuple(chain), observed_depth


def _classify_failure(error: BaseException) -> _FailureClassification:
    chain, depth = _exception_chain(error)
    if any(isinstance(item, _MediaBytesExceeded) for item in chain):
        return _FailureClassification("media_too_large", "media_limit", depth)
    for item in chain:
        if not isinstance(item, HTTPError):
            continue
        if item.status == 429:
            return _FailureClassification("rate_limited", "http_rate_limit", depth)
        if item.status in {401, 403, 412, 451}:
            return _FailureClassification("access_denied", "http_access", depth)
        if item.status in {408, 425} or item.status >= 500:
            return _FailureClassification("transient", "http_transient", depth)
        return _FailureClassification("source_unavailable", "http_permanent", depth)
    if any(isinstance(item, TransportError) for item in chain):
        return _FailureClassification("transient", "transport", depth)
    if any(isinstance(item, ContentTooShortError) for item in chain):
        return _FailureClassification("transient", "content_short", depth)
    if any(isinstance(item, GeoRestrictedError) for item in chain):
        return _FailureClassification("access_denied", "access", depth)
    if any(isinstance(item, ExtractorError) for item in chain):
        return _FailureClassification("source_unavailable", "extractor", depth)
    if any(isinstance(item, UnavailableVideoError) for item in chain):
        return _FailureClassification("source_unavailable", "unavailable", depth)
    return _FailureClassification("source_unavailable", "unknown", depth)


def _outer_exception_family(error: BaseException) -> _OuterExceptionFamily:
    if isinstance(error, HTTPError):
        return "http"
    if isinstance(error, TransportError):
        return "transport"
    if isinstance(error, ContentTooShortError):
        return "content_short"
    if isinstance(error, UnavailableVideoError):
        return "unavailable"
    if isinstance(error, ExtractorError):
        return "extractor"
    if isinstance(error, DownloadError):
        return "download"
    if isinstance(error, TimeoutError):
        return "builtin_timeout"
    if isinstance(error, OSError):
        return "os_error"
    return "other"


def _failure_diagnostics(
    classification: _FailureClassification,
    metrics: _DownloadMetrics,
    *,
    error: BaseException,
    attempt_started: float,
) -> _FailureDiagnostics:
    elapsed_ms = round((time.monotonic() - attempt_started) * 1000)
    attempt_downloaded_bytes = metrics.attempt_observed_bytes
    return _FailureDiagnostics(
        cause=classification.cause,
        failure_family=classification.failure_family,
        failure_phase="after_bytes" if attempt_downloaded_bytes > 0 else "before_bytes",
        attempt_downloaded_bytes=attempt_downloaded_bytes,
        outer_exception_family=_outer_exception_family(error),
        chain_depth=classification.chain_depth,
        attempt_elapsed_ms=min(_MAX_ATTEMPT_ELAPSED_MS, max(0, elapsed_ms)),
    )


def _closed_diagnostics(
    family: _FailureFamily, *, attempt_downloaded_bytes: int = 0
) -> _FailureDiagnostics:
    return _FailureDiagnostics(
        cause="source_unavailable",
        failure_family=family,
        failure_phase="after_bytes" if attempt_downloaded_bytes > 0 else "before_bytes",
        attempt_downloaded_bytes=attempt_downloaded_bytes,
        outer_exception_family="other",
        chain_depth=0,
        attempt_elapsed_ms=0,
    )


def _cleanup_partial(workspace: Path) -> None:
    for path in workspace.glob("source.*"):
        if path.is_file() or path.is_symlink():
            path.unlink(missing_ok=True)


def _download(
    canonical_url: str,
    workspace: Path,
    proxy: str | None,
    cookie_file: str | None,
) -> tuple[dict[str, Any], _DownloadMetrics]:
    metrics = _DownloadMetrics()
    options = _download_options(canonical_url, workspace, proxy, cookie_file, metrics)
    for attempt in range(_MAX_ATTEMPTS):
        metrics.attempts += 1
        metrics.begin_attempt()
        attempt_started = time.monotonic()
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                media_url, format_id, upstream_id = _resolve_public_media(downloader, canonical_url)
                info = downloader.extract_info(media_url, download=True)
        except Exception as e:
            classification = _classify_failure(e)
            diagnostics = _failure_diagnostics(
                classification,
                metrics,
                error=e,
                attempt_started=attempt_started,
            )
            metrics.finish_failed_attempt()
            _cleanup_partial(workspace)
            if diagnostics.cause == "rate_limited":
                metrics.rate_limits += 1
            if diagnostics.cause in {"transient", "rate_limited"} and attempt + 1 < _MAX_ATTEMPTS:
                metrics.retries += 1
                time.sleep(_RETRY_DELAYS_SECONDS[attempt])
                continue
            raise _WorkerDownloadFailure(diagnostics, metrics) from e
        if not isinstance(info, dict):
            _cleanup_partial(workspace)
            raise _WorkerDownloadFailure(
                _closed_diagnostics(
                    "invalid_metadata",
                    attempt_downloaded_bytes=metrics.attempt_observed_bytes,
                ),
                metrics,
            )
        info["id"] = upstream_id
        info["format_id"] = format_id
        return info, metrics
    raise AssertionError("unreachable")


class _WorkerDownloadFailure(Exception):
    def __init__(self, diagnostics: _FailureDiagnostics, metrics: _DownloadMetrics) -> None:
        super().__init__(diagnostics.cause)
        self.diagnostics = diagnostics
        self.metrics = metrics


def _receipt(
    *,
    ok: bool,
    metrics: _DownloadMetrics,
    diagnostics: _FailureDiagnostics | None = None,
    info: dict[str, Any] | None = None,
) -> bytes:
    payload: dict[str, object] = {
        "schema": _SCHEMA,
        "ok": ok,
        "attempts": metrics.attempts,
        "retries": metrics.retries,
        "rate_limits": metrics.rate_limits,
        "downloaded_bytes": metrics.observed_bytes,
    }
    if ok:
        assert info is not None
        payload.update(
            {
                "id": str(info.get("id") or ""),
                "format_id": str(info.get("format_id") or "unknown"),
                "adapter_version": str(yt_dlp.version.__version__),
            }
        )
    else:
        failure = diagnostics or _closed_diagnostics("worker_request")
        payload.update(
            {
                "cause": failure.cause,
                "failure_family": failure.failure_family,
                "failure_phase": failure.failure_phase,
                "attempt_downloaded_bytes": failure.attempt_downloaded_bytes,
                "outer_exception_family": failure.outer_exception_family,
                "chain_depth": failure.chain_depth,
                "attempt_elapsed_ms": failure.attempt_elapsed_ms,
            }
        )
    return (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode()


def main() -> int:
    raw = sys.stdin.buffer.read(_INPUT_BYTES + 1)
    if not raw or len(raw) > _INPUT_BYTES:
        sys.stdout.buffer.write(_receipt(ok=False, metrics=_DownloadMetrics()))
        return 2
    try:
        request = decode_strict_json_object(raw)
        canonical_url, workspace, proxy, cookie_file = _validated_request(request)
        info, metrics = _download(canonical_url, workspace, proxy, cookie_file)
    except _WorkerDownloadFailure as e:
        sys.stdout.buffer.write(_receipt(ok=False, metrics=e.metrics, diagnostics=e.diagnostics))
        return 1
    except Exception:
        # Upstream text may contain URLs, titles, cookie paths, or request details. The worker
        # exposes one closed reason and lets the parent own the public failure taxonomy.
        sys.stdout.buffer.write(_receipt(ok=False, metrics=_DownloadMetrics()))
        return 1
    sys.stdout.buffer.write(_receipt(ok=True, metrics=metrics, info=info))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
