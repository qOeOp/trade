"""Shared local media inspection and bounded extractor-worker execution."""

from __future__ import annotations

import hashlib
import math
import os
from pathlib import Path

from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.resource_limits import (
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


async def probe_downloaded_media(path: Path) -> tuple[int, int, int]:
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
    if not 1 <= size <= MEDIA_DOWNLOAD_BYTES:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_size_invalid")
    return duration_ms, width, height


async def run_media_worker(
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
            stdout_limit_bytes=MEDIA_WORKER_RECEIPT_BYTES,
            stderr_limit_bytes=0,
            env=env,
        )
    except TimeoutError as e:
        raise BilibiliNoteFailure("DEADLINE_EXCEEDED", "media_download_timeout") from e
    except ProcessOutputLimitExceeded:
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_worker_receipt_invalid") from None
    return result.returncode, result.stdout


def media_worker_environment() -> dict[str, str]:
    allowed = ("PATH", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR")
    environment = {name: os.environ[name] for name in allowed if name in os.environ}
    environment["PYTHONIOENCODING"] = "utf-8"
    return environment


def media_candidates(workspace: Path) -> tuple[Path, ...]:
    return tuple(
        path
        for path in workspace.glob("source.*")
        if path.is_file() and not path.name.endswith((".part", ".ytdl"))
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
