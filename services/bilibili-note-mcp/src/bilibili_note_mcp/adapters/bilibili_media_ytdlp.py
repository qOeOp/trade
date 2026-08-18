from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from bilibili_note_mcp.adapters.egress import admitted_loopback_proxy
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.operator_events import emit_operator_event
from bilibili_note_mcp.application.ports import SourceMediaArtifact
from bilibili_note_mcp.application.resource_limits import (
    MEDIA_DOWNLOAD_BYTES,
    MEDIA_SOURCE_MAX_PIXELS,
    MEDIA_SOURCE_MAX_SIDE,
    MEDIA_WORKER_RECEIPT_BYTES,
    SUBPROCESS_STDERR_BYTES,
    SUBPROCESS_STDOUT_BYTES,
)

from .strict_json import (
    StrictJsonError,
    decode_strict_json_object,
    parse_finite_decimal_string,
    parse_unsigned_integer_string,
)
from .subprocesses import ProcessOutputLimitExceeded, run_captured

_UPSTREAM_ID = re.compile(r"^(BV[0-9A-Za-z]{10})(?:_p([1-9][0-9]*))?$")
_MAX_MEDIA_BYTES = MEDIA_DOWNLOAD_BYTES
_WORKER_SCHEMA = "bilibili-note-ytdlp-worker/v4"
_WORKER_OUTPUT_BYTES = MEDIA_WORKER_RECEIPT_BYTES
_DOWNLOAD_TIMEOUT_SECONDS = 360.0
_TERMINATE_GRACE_SECONDS = 2.0
_MAX_CHAIN_DEPTH = 8
_MAX_ATTEMPT_ELAPSED_MS = 360_000
_FAILURE_FAMILIES = {
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
}
_OUTER_EXCEPTION_FAMILIES = {
    "http",
    "transport",
    "content_short",
    "extractor",
    "unavailable",
    "download",
    "builtin_timeout",
    "os_error",
    "other",
}
_FAMILY_CAUSE = {
    "media_limit": "media_too_large",
    "http_rate_limit": "rate_limited",
    "http_access": "access_denied",
    "http_transient": "transient",
    "http_permanent": "source_unavailable",
    "transport": "transient",
    "content_short": "transient",
    "access": "access_denied",
    "extractor": "source_unavailable",
    "unavailable": "source_unavailable",
    "invalid_metadata": "source_unavailable",
    "worker_request": "source_unavailable",
    "unknown": "source_unavailable",
}


def _cookie_file() -> str | None:
    raw = os.environ.get("BILIBILI_NOTE_COOKIE_FILE")
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise BilibiliNoteFailure("ACCESS_DENIED", "bilibili_cookie_file_invalid")
    return str(path)


async def _probe(path: Path) -> tuple[int, int, int]:
    command = (
        "ffprobe",
        "-protocol_whitelist",
        "file,pipe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,size",
        "-show_entries",
        "stream=codec_type,width,height",
        "-of",
        "json",
        str(path),
    )
    try:
        result = await run_captured(
            *command,
            timeout_seconds=30,
            stdout_limit_bytes=SUBPROCESS_STDOUT_BYTES,
            stderr_limit_bytes=SUBPROCESS_STDERR_BYTES,
        )
    except TimeoutError as e:
        raise BilibiliNoteFailure("DEADLINE_EXCEEDED", "media_probe_timeout") from e
    except ProcessOutputLimitExceeded as e:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_probe_output_exceeded") from e
    if result.returncode != 0:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "downloaded_media_invalid")
    try:
        payload = decode_strict_json_object(result.stdout)
        size = parse_unsigned_integer_string(payload["format"]["size"])
        duration_ms = round(parse_finite_decimal_string(payload["format"]["duration"]) * 1000)
        video = next(item for item in payload["streams"] if item.get("codec_type") == "video")
        has_audio = any(item.get("codec_type") == "audio" for item in payload["streams"])
        width, height = video["width"], video["height"]
    except (
        KeyError,
        StopIteration,
        TypeError,
        ValueError,
        OverflowError,
        StrictJsonError,
    ) as e:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "downloaded_media_invalid") from e
    if (
        not isinstance(width, int)
        or isinstance(width, bool)
        or not isinstance(height, int)
        or isinstance(height, bool)
    ):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "downloaded_media_invalid")
    if not has_audio or not math.isfinite(duration_ms) or duration_ms <= 0:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "downloaded_media_invalid")
    if (
        width <= 0
        or height <= 0
        or max(width, height) > MEDIA_SOURCE_MAX_SIDE
        or width * height > MEDIA_SOURCE_MAX_PIXELS
    ):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "downloaded_media_invalid")
    if not 1 <= size <= _MAX_MEDIA_BYTES:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_size_invalid")
    return duration_ms, width, height


async def _run_worker(
    command: tuple[str, ...],
    payload: bytes,
    *,
    timeout_seconds: float,
    grace_seconds: float,
    env: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    try:
        result = await run_captured(
            *command,
            input_bytes=payload,
            timeout_seconds=timeout_seconds,
            grace_seconds=grace_seconds,
            stdout_limit_bytes=_WORKER_OUTPUT_BYTES,
            stderr_limit_bytes=0,
            env=env,
        )
    except TimeoutError as e:
        raise BilibiliNoteFailure("DEADLINE_EXCEEDED", "media_download_timeout") from e
    except ProcessOutputLimitExceeded:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid") from None
    return result.returncode, result.stdout


@dataclass(frozen=True, slots=True)
class _WorkerReceipt:
    ok: bool
    cause: str | None
    upstream_id: str | None
    format_id: str | None
    adapter_version: str | None
    attempts: int
    retries: int
    rate_limits: int
    downloaded_bytes: int
    failure_family: str | None
    failure_phase: str | None
    attempt_downloaded_bytes: int | None
    outer_exception_family: str | None
    chain_depth: int | None
    attempt_elapsed_ms: int | None


def _nonnegative_integer(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None


def _parse_worker_receipt(raw: bytes) -> _WorkerReceipt:
    try:
        receipt = decode_strict_json_object(raw)
    except (UnicodeDecodeError, StrictJsonError) as e:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid") from e
    if not isinstance(receipt, dict) or receipt.get("schema") != _WORKER_SCHEMA:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid")
    metrics = tuple(
        _nonnegative_integer(receipt.get(name))
        for name in ("attempts", "retries", "rate_limits", "downloaded_bytes")
    )
    if any(value is None for value in metrics):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid")
    attempts, retries, rate_limits, downloaded_bytes = metrics
    assert attempts is not None
    assert retries is not None
    assert rate_limits is not None
    assert downloaded_bytes is not None
    if (
        attempts > 4
        or retries > 3
        or rate_limits > attempts
        or downloaded_bytes > _MAX_MEDIA_BYTES
        or (attempts == 0 and retries != 0)
        or (attempts > 0 and retries >= attempts)
    ):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid")
    ok = receipt.get("ok")
    if ok is True:
        expected = {
            "schema",
            "ok",
            "id",
            "format_id",
            "adapter_version",
            "attempts",
            "retries",
            "rate_limits",
            "downloaded_bytes",
        }
        if set(receipt) != expected or attempts < 1 or retries >= attempts:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid")
        values = tuple(receipt.get(name) for name in ("id", "format_id", "adapter_version"))
        if not all(isinstance(value, str) and value for value in values):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid")
        return _WorkerReceipt(
            True,
            None,
            str(values[0]),
            str(values[1]),
            str(values[2]),
            attempts,
            retries,
            rate_limits,
            downloaded_bytes,
            None,
            None,
            None,
            None,
            None,
            None,
        )
    expected = {
        "schema",
        "ok",
        "cause",
        "attempts",
        "retries",
        "rate_limits",
        "downloaded_bytes",
        "failure_family",
        "failure_phase",
        "attempt_downloaded_bytes",
        "outer_exception_family",
        "chain_depth",
        "attempt_elapsed_ms",
    }
    cause = receipt.get("cause")
    failure_family = receipt.get("failure_family")
    failure_phase = receipt.get("failure_phase")
    attempt_downloaded_bytes = _nonnegative_integer(receipt.get("attempt_downloaded_bytes"))
    outer_exception_family = receipt.get("outer_exception_family")
    chain_depth = _nonnegative_integer(receipt.get("chain_depth"))
    attempt_elapsed_ms = _nonnegative_integer(receipt.get("attempt_elapsed_ms"))
    if (
        ok is not False
        or set(receipt) != expected
        or cause
        not in {
            "transient",
            "rate_limited",
            "access_denied",
            "source_unavailable",
            "media_too_large",
        }
        or failure_family not in _FAILURE_FAMILIES
        or _FAMILY_CAUSE.get(str(failure_family)) != cause
        or failure_phase not in {"before_bytes", "after_bytes"}
        or attempt_downloaded_bytes is None
        or attempt_downloaded_bytes > _MAX_MEDIA_BYTES
        or attempt_downloaded_bytes > downloaded_bytes
        or (failure_phase == "after_bytes") != (attempt_downloaded_bytes > 0)
        or outer_exception_family not in _OUTER_EXCEPTION_FAMILIES
        or chain_depth is None
        or chain_depth > _MAX_CHAIN_DEPTH
        or attempt_elapsed_ms is None
        or attempt_elapsed_ms > _MAX_ATTEMPT_ELAPSED_MS
        or (
            failure_family == "worker_request"
            and (
                attempts != 0
                or chain_depth != 0
                or attempt_downloaded_bytes != 0
                or outer_exception_family != "other"
            )
        )
        or (
            failure_family == "invalid_metadata"
            and (attempts < 1 or chain_depth != 0 or outer_exception_family != "other")
        )
        or (
            failure_family not in {"worker_request", "invalid_metadata"}
            and (attempts < 1 or chain_depth < 1)
        )
    ):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid")
    return _WorkerReceipt(
        False,
        str(cause),
        None,
        None,
        None,
        attempts,
        retries,
        rate_limits,
        downloaded_bytes,
        str(failure_family),
        str(failure_phase),
        attempt_downloaded_bytes,
        str(outer_exception_family),
        chain_depth,
        attempt_elapsed_ms,
    )


def _worker_environment() -> dict[str, str]:
    allowed = ("PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR")
    environment = {name: os.environ[name] for name in allowed if name in os.environ}
    environment["PYTHONIOENCODING"] = "utf-8"
    return environment


async def _download(canonical_url: str, workspace: Path, proxy: str | None) -> _WorkerReceipt:
    request = {
        "schema": _WORKER_SCHEMA,
        "canonical_url": canonical_url,
        "workspace": str(workspace),
        "proxy": proxy,
        "cookie_file": _cookie_file(),
    }
    payload = json.dumps(request, sort_keys=True, separators=(",", ":")).encode()
    try:
        returncode, stdout = await _run_worker(
            (sys.executable, "-m", "bilibili_note_mcp.adapters._ytdlp_worker"),
            payload,
            timeout_seconds=_DOWNLOAD_TIMEOUT_SECONDS,
            grace_seconds=_TERMINATE_GRACE_SECONDS,
            env=_worker_environment(),
        )
        receipt = _parse_worker_receipt(stdout)
        if (returncode == 0) != receipt.ok:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid")
        return receipt
    except BaseException:
        # The parent owns cleanup when timeout/cancellation/output-cap prevents the worker's
        # exception path from running its own partial-file cleanup, and when a malformed
        # receipt cannot prove that cleanup happened.
        _cleanup_worker_artifacts(workspace)
        raise


def _cleanup_worker_artifacts(workspace: Path) -> None:
    for path in workspace.glob("source.*"):
        if path.is_file() or path.is_symlink():
            path.unlink(missing_ok=True)


def _worker_failure(receipt: _WorkerReceipt) -> BilibiliNoteFailure:
    if receipt.cause == "rate_limited":
        return BilibiliNoteFailure("RATE_LIMITED", "source_rate_limited")
    if receipt.cause == "access_denied":
        return BilibiliNoteFailure("ACCESS_DENIED", "source_access_denied")
    if receipt.cause == "media_too_large":
        return BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_size_invalid")
    return BilibiliNoteFailure("SOURCE_UNAVAILABLE", "complete_media_download_failed")


def _media_candidates(workspace: Path) -> tuple[Path, ...]:
    return tuple(
        path
        for path in workspace.glob("source.*")
        if path.is_file() and not path.name.endswith((".part", ".ytdl"))
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class YtDlpBilibiliMedia:
    """Acquire a complete HD Bilibili part; previews are rejected after probing bytes."""

    def __init__(self, proxy_url: str | None = None) -> None:
        configured_proxy = proxy_url
        if configured_proxy is None:
            configured_proxy = os.environ.get(
                "BILIBILI_NOTE_MEDIA_PROXY",
                os.environ.get("BILIBILI_NOTE_EGRESS_PROXY"),
            )
        self._proxy = admitted_loopback_proxy(configured_proxy)

    async def download(self, canonical_url: str, workspace: Path) -> SourceMediaArtifact:
        info: _WorkerReceipt | None = None
        try:
            info = await _download(canonical_url, workspace, self._proxy)
            if not info.ok:
                raise _worker_failure(info)
            candidates = await asyncio.to_thread(_media_candidates, workspace)
            if len(candidates) != 1:
                raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "downloaded_media_ambiguous")
            media_path = candidates[0]
            duration_ms, width, height = await _probe(media_path)
            upstream_id = info.upstream_id or ""
            match = _UPSTREAM_ID.fullmatch(upstream_id)
            if match is None:
                raise BilibiliNoteFailure("SOURCE_CHANGED", "media_video_identity_invalid")
            digest = await asyncio.to_thread(_sha256_file, media_path)
        except BilibiliNoteFailure as e:
            if info is not None and not info.ok:
                failure_family = info.failure_family
                failure_phase = info.failure_phase
                chain_depth = info.chain_depth
                attempt_elapsed_ms = info.attempt_elapsed_ms
                attempt_downloaded_bytes = info.attempt_downloaded_bytes
                outer_exception_family = info.outer_exception_family
            else:
                failure_family = "host_validation"
                failure_phase = (
                    "after_bytes"
                    if info is not None and info.downloaded_bytes > 0
                    else "before_bytes"
                )
                chain_depth = 0
                attempt_elapsed_ms = 0
                attempt_downloaded_bytes = info.downloaded_bytes if info is not None else 0
                outer_exception_family = "other"
            assert failure_family is not None
            assert failure_phase is not None
            assert chain_depth is not None
            assert attempt_elapsed_ms is not None
            assert attempt_downloaded_bytes is not None
            assert outer_exception_family is not None
            emit_operator_event(
                "media_failed",
                attempts=info.attempts if info is not None else 0,
                retries=info.retries if info is not None else 0,
                rate_limits=info.rate_limits if info is not None else 0,
                downloaded_bytes=info.downloaded_bytes if info is not None else 0,
                code=e.code,
                reason=e.reason,
                failure_family=failure_family,
                failure_phase=failure_phase,
                attempt_downloaded_bytes=attempt_downloaded_bytes,
                outer_exception_family=outer_exception_family,
                chain_depth=chain_depth,
                attempt_elapsed_ms=attempt_elapsed_ms,
            )
            raise
        emit_operator_event(
            "media_completed",
            attempts=info.attempts,
            retries=info.retries,
            rate_limits=info.rate_limits,
            downloaded_bytes=info.downloaded_bytes,
        )
        return SourceMediaArtifact(
            media_path=media_path,
            media_sha256=digest,
            observed_duration_ms=duration_ms,
            width=width,
            height=height,
            upstream_video_id=match.group(1),
            upstream_part_index=int(match.group(2) or 1),
            format_id=info.format_id or "unknown",
            adapter_ref=f"yt-dlp/{info.adapter_version}",
        )
