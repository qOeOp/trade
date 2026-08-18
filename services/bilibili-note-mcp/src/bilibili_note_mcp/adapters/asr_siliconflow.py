from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

import httpx

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.operator_events import emit_operator_event
from bilibili_note_mcp.application.owned_tasks import finish_owned_task
from bilibili_note_mcp.application.ports import TranscriptResult, TranscriptSegment
from bilibili_note_mcp.application.progress import ProgressReporter, transcription_progress
from bilibili_note_mcp.application.resource_limits import (
    ASR_RESPONSE_BYTES,
    ASR_WINDOW_TEXT_BYTES,
    SUBPROCESS_STDERR_BYTES,
    SUBPROCESS_STDOUT_BYTES,
    TRANSCRIPT_TOTAL_BYTES,
)
from bilibili_note_mcp.config import ModelProfile, load_model_profile
from bilibili_note_mcp.domain.models import TRANSCRIPT_WINDOW_MS

from .http_bodies import read_httpx_body
from .strict_json import decode_strict_json_object
from .subprocesses import ProcessOutputLimitExceeded, run_captured

# The provider returns text only. Host-owned 45 second windows bound speech-to-screen
# alignment while three-way concurrency keeps the user-facing wait bounded.
_CHUNK_MS = TRANSCRIPT_WINDOW_MS
_MAX_CONCURRENCY = 3
_MAX_ATTEMPTS = 4
_RETRY_DELAYS_SECONDS = (0.5, 1.5, 4.0)


class _RetryableRateLimit(Exception):
    def __init__(self, delay_seconds: float) -> None:
        self.delay_seconds = delay_seconds


@dataclass(slots=True)
class _AsrMetrics:
    attempts: int = 0
    retries: int = 0
    rate_limits: int = 0


def _retry_after_seconds(response: httpx.Response, attempt: int) -> float:
    fallback = _RETRY_DELAYS_SECONDS[min(attempt, len(_RETRY_DELAYS_SECONDS) - 1)]
    value = response.headers.get("Retry-After", "").strip()
    try:
        parsed = float(value)
    except ValueError:
        return fallback
    return min(8.0, max(fallback, parsed))


async def _extract_audio(
    media_path: Path, output: Path, *, start_ms: int, duration_ms: int
) -> None:
    command = (
        "ffmpeg",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-v",
        "error",
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-i",
        str(media_path),
        "-t",
        f"{duration_ms / 1000:.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "64k",
        "-y",
        str(output),
    )
    try:
        result = await run_captured(
            *command,
            timeout_seconds=90,
            stdout_limit_bytes=SUBPROCESS_STDOUT_BYTES,
            stderr_limit_bytes=SUBPROCESS_STDERR_BYTES,
        )
    except TimeoutError as e:
        raise BilibiliNoteFailure("DEADLINE_EXCEEDED", "audio_extract_timeout") from e
    except ProcessOutputLimitExceeded as e:
        raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "audio_extract_output_exceeded") from e
    output_exists = await asyncio.to_thread(output.is_file)
    if result.returncode != 0 or result.stdout or not output_exists:
        raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "audio_extract_failed")


class SiliconFlowAsr:
    def __init__(
        self,
        profile: ModelProfile | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._profile = profile or load_model_profile()
        self._transport = transport
        self._provider_permits = asyncio.BoundedSemaphore(_MAX_CONCURRENCY)

    async def transcribe(
        self,
        media_path: Path,
        duration_ms: int,
        workspace: Path,
        progress: ProgressReporter,
    ) -> TranscriptResult:
        api_key = os.environ.get(self._profile.api_key_env, "")
        if not api_key:
            raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "asr_credential_unavailable")
        windows = list(enumerate(range(0, duration_ms, _CHUNK_MS), start=1))
        semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
        progress_lock = asyncio.Lock()
        completed = 0
        metrics = _AsrMetrics()

        client = self._new_client()
        tasks: tuple[asyncio.Task[TranscriptSegment], ...] = ()
        group: asyncio.Task[tuple[TranscriptSegment, ...]] | None = None
        failure: BilibiliNoteFailure | None = None
        try:

            async def transcribe_window(index: int, start_ms: int) -> TranscriptSegment:
                nonlocal completed
                end_ms = min(start_ms + _CHUNK_MS, duration_ms)
                audio_path = workspace / f"audio-{index:03d}.mp3"
                async with semaphore:
                    await _extract_audio(
                        media_path,
                        audio_path,
                        start_ms=start_ms,
                        duration_ms=end_ms - start_ms,
                    )
                    text = await self._transcribe_file_with_client(audio_path, client, metrics)
                async with progress_lock:
                    completed += 1
                    await progress.report(transcription_progress(completed, len(windows)))
                return TranscriptSegment(
                    evidence_id=f"E{index:03d}",
                    start_ms=start_ms,
                    end_ms=end_ms,
                    text=text,
                )

            tasks = tuple(
                asyncio.create_task(transcribe_window(index, start_ms))
                for index, start_ms in windows
            )

            async def join_windows() -> tuple[TranscriptSegment, ...]:
                return tuple(await asyncio.gather(*tasks))

            group = asyncio.create_task(join_windows())
            segments = await asyncio.shield(group)
            if (
                sum(len(segment.text.encode("utf-8")) for segment in segments)
                > TRANSCRIPT_TOTAL_BYTES
            ):
                raise BilibiliNoteFailure("TRANSCRIPT_INCOMPLETE", "transcript_bytes_exceeded")
        except BilibiliNoteFailure as e:
            failure = e
        finally:

            async def cleanup() -> None:
                await self._cancel_and_join_windows(tasks)
                if group is not None:
                    await asyncio.gather(group, return_exceptions=True)
                await client.aclose()

            coordinator = asyncio.create_task(cleanup())
            await finish_owned_task(coordinator)
        if failure is not None:
            emit_operator_event(
                "asr_failed",
                windows=len(windows),
                attempts=metrics.attempts,
                retries=metrics.retries,
                rate_limits=metrics.rate_limits,
                code=failure.code,
                reason=failure.reason,
            )
            raise failure
        emit_operator_event(
            "asr_completed",
            windows=len(windows),
            attempts=metrics.attempts,
            retries=metrics.retries,
            rate_limits=metrics.rate_limits,
        )
        return TranscriptResult(
            method="asr",
            provider_ref=f"siliconflow:{self._profile.asr_model}",
            language="zh-CN",
            segments=tuple(segments),
        )

    def _new_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=self._transport,
            timeout=self._profile.timeout_seconds,
            trust_env=False,
        )

    async def _transcribe_file(self, audio_path: Path) -> str:
        metrics = _AsrMetrics()
        client = self._new_client()
        try:
            return await self._transcribe_file_with_client(audio_path, client, metrics)
        finally:
            coordinator = asyncio.create_task(client.aclose())
            await finish_owned_task(coordinator)

    @staticmethod
    async def _cancel_and_join_windows(
        tasks: tuple[asyncio.Task[TranscriptSegment], ...],
    ) -> None:
        for task in tasks:
            if not task.done() and task.cancelling() == 0:
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _transcribe_file_with_client(
        self,
        audio_path: Path,
        client: httpx.AsyncClient,
        metrics: _AsrMetrics,
    ) -> str:
        for attempt in range(_MAX_ATTEMPTS):
            retry_delay = _RETRY_DELAYS_SECONDS[min(attempt, len(_RETRY_DELAYS_SECONDS) - 1)]
            try:
                async with self._provider_permits:
                    metrics.attempts += 1
                    with audio_path.open("rb") as audio:
                        response_context = client.stream(
                            "POST",
                            self._profile.base_url.rstrip("/") + "/audio/transcriptions",
                            headers={
                                "Authorization": (f"Bearer {os.environ[self._profile.api_key_env]}")
                            },
                            data={"model": self._profile.asr_model},
                            files={"file": (audio_path.name, audio, "audio/mpeg")},
                        )
                        async with response_context as response:
                            if response.status_code == 429:
                                metrics.rate_limits += 1
                                if attempt + 1 == _MAX_ATTEMPTS:
                                    raise BilibiliNoteFailure("RATE_LIMITED", "asr_rate_limited")
                                raise _RetryableRateLimit(_retry_after_seconds(response, attempt))
                            response.raise_for_status()
                            body = await read_httpx_body(
                                response,
                                limit_bytes=ASR_RESPONSE_BYTES,
                                code="TRANSCRIPT_UNAVAILABLE",
                                reason="asr_response_bytes_exceeded",
                            )
                value = decode_strict_json_object(body)
                raw_text = value["text"]
                if not isinstance(raw_text, str):
                    raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "asr_response_invalid")
                text = " ".join(raw_text.split()).strip()
                if not text:
                    raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "asr_text_empty")
                if len(text.encode("utf-8")) > ASR_WINDOW_TEXT_BYTES:
                    raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "asr_text_bytes_exceeded")
                return text
            except _RetryableRateLimit as e:
                retry_delay = e.delay_seconds
            except BilibiliNoteFailure:
                raise
            except httpx.HTTPStatusError as e:
                if e.response.status_code < 500 or attempt + 1 == _MAX_ATTEMPTS:
                    raise BilibiliNoteFailure(
                        "TRANSCRIPT_UNAVAILABLE", "asr_response_invalid"
                    ) from e
            except (httpx.TransportError, KeyError, TypeError, ValueError) as e:
                if attempt + 1 == _MAX_ATTEMPTS:
                    raise BilibiliNoteFailure(
                        "TRANSCRIPT_UNAVAILABLE", "asr_response_invalid"
                    ) from e
            except OSError as e:
                raise BilibiliNoteFailure("TRANSCRIPT_UNAVAILABLE", "asr_response_invalid") from e
            metrics.retries += 1
            await asyncio.sleep(retry_delay)
        raise AssertionError("unreachable")
