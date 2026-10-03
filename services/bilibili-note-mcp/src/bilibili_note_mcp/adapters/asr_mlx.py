from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from pydantic import Field

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.owned_tasks import finish_owned_task
from bilibili_note_mcp.application.ports import TranscriptResult, TranscriptSegment
from bilibili_note_mcp.application.progress import ProgressReporter
from bilibili_note_mcp.application.resource_limits import (
    SUBPROCESS_STDERR_BYTES,
    TRANSCRIPT_TOTAL_BYTES,
)
from bilibili_note_mcp.domain.models import StrictModel

from .strict_json import decode_strict_json_object
from .subprocesses import ProcessOutputLimitExceeded, run_captured

MLX_IDENTITY = "mlx-whisper:0.4.3:large-v3:49e6aa286ad60c14352c404340ded53710378a11:sentences-v1"


class _Segment(StrictModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=16000)


class _Receipt(StrictModel):
    audio_duration_ms: int = Field(gt=0)
    language: str = Field(min_length=1, max_length=32)
    segments: tuple[_Segment, ...] = Field(min_length=1, max_length=4096)


class MlxAsr:
    def __init__(self, python: str | None = None) -> None:
        self._python = python or os.environ.get(
            "BILIBILI_NOTE_MLX_PYTHON",
            str(Path.home() / ".local/share/bilibili-note-mcp/mlx-venv/bin/python"),
        )
        self._gate = asyncio.Semaphore(1)

    async def transcribe(
        self, media_path: Path, duration_ms: int, workspace: Path, progress: ProgressReporter
    ) -> TranscriptResult:
        del progress
        async with self._gate:
            audio = workspace / "mlx-audio.wav"
            try:
                decoded = await run_captured(
                    "ffmpeg",
                    "-v",
                    "error",
                    "-nostdin",
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                    str(media_path),
                    "-vn",
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    str(audio),
                    timeout_seconds=120,
                    stdout_limit_bytes=1024,
                    stderr_limit_bytes=SUBPROCESS_STDERR_BYTES,
                )
                if decoded.returncode:
                    raise ValueError("audio decode failed")
                result = await run_captured(
                    self._python,
                    str(Path(__file__).with_name("_mlx_worker.py")),
                    str(audio),
                    timeout_seconds=900,
                    stdout_limit_bytes=TRANSCRIPT_TOTAL_BYTES,
                    stderr_limit_bytes=SUBPROCESS_STDERR_BYTES,
                )
                if result.returncode:
                    raise ValueError("MLX worker failed")
                receipt = _Receipt.model_validate_json(
                    json.dumps(decode_strict_json_object(result.stdout))
                )
                if abs(receipt.audio_duration_ms - duration_ms) > 2000:
                    raise ValueError("incomplete audio")
                segments = tuple(
                    TranscriptSegment(f"E{i:03d}", s.start_ms, min(s.end_ms, duration_ms), s.text)
                    for i, s in enumerate(receipt.segments, 1)
                )
                return TranscriptResult(
                    "asr", MLX_IDENTITY, receipt.language, segments, duration_ms
                )
            except (OSError, ValueError, TimeoutError, ProcessOutputLimitExceeded) as e:
                raise BilibiliNoteFailure("TRANSCRIPT_INCOMPLETE", "local_asr_failed") from e
            finally:
                await finish_owned_task(
                    asyncio.create_task(asyncio.to_thread(audio.unlink, missing_ok=True))
                )
