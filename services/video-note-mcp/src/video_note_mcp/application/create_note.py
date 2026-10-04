from __future__ import annotations

import asyncio
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Never

from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.owned_tasks import finish_owned_task
from video_note_mcp.application.ports import (
    AcquiredSource,
    DistillerPort,
    MediaPort,
    NoteDraft,
    PublishedNote,
    PublisherPort,
    SourcePort,
    TranscriptReviewPort,
)
from video_note_mcp.application.progress import (
    AnalysisProgressReporter,
    NullProgressReporter,
    ProgressReporter,
    ProgressStageV1,
    ProgressUpdateV1,
    media_acquisition_heartbeat,
    progress_update,
    provider_progress_scope,
    visual_analysis_heartbeat,
)
from video_note_mcp.domain.models import FailureCode, Quality, VideoNote
from video_note_mcp.domain.url_policy import InvalidBilibiliUrl
from video_note_mcp.domain.video_url import validate_video_url

from .note_validation import validate_frames, validate_note
from .transcript_validation import validate_transcript

_VISUAL_HEARTBEAT_SECONDS = 15


def _raise(code: FailureCode, reason: str) -> Never:
    raise BilibiliNoteFailure(code, reason)


class _AcquisitionProgressReporter:
    def __init__(self, parent: ProgressReporter) -> None:
        self._parent = parent
        self.last_verified_progress = 5

    async def report(self, update: ProgressUpdateV1) -> None:
        if update.progress >= self.last_verified_progress:
            self.last_verified_progress = update.progress
            await self._parent.report(update)


class CreateBilibiliNote:
    def __init__(
        self,
        source: SourcePort,
        media: MediaPort,
        distiller: DistillerPort,
        publisher: PublisherPort,
        reviewer: TranscriptReviewPort | None = None,
    ) -> None:
        self._reviewer = reviewer
        self._source, self._media = source, media
        self._distiller, self._publisher = distiller, publisher

    async def execute(
        self, url: str, progress: ProgressReporter | None = None, *, quality: Quality = "fast"
    ) -> PublishedNote:
        draft = await self.prepare(url, progress, quality=quality)
        await asyncio.sleep(0)
        # Synchronous, bounded publication: no cancellation point after atomic commit.
        return self._publisher.publish((draft,))

    async def prepare(
        self, url: str, progress: ProgressReporter | None = None, *, quality: Quality = "fast"
    ) -> NoteDraft:
        if quality not in ("fast", "standard", "precise"):
            raise ValueError("invalid quality")
        reporter = progress or NullProgressReporter()
        try:
            validate_video_url(url)
        except InvalidBilibiliUrl as e:
            raise BilibiliNoteFailure(e.code, e.reason) from e
        await reporter.report(progress_update(ProgressStageV1.REQUEST_VALIDATED))
        with tempfile.TemporaryDirectory(prefix="bilibili-note-") as scratch:
            source = await self._acquire_with_liveness(url, Path(scratch), reporter)
            validate_transcript(source)
            if quality != "fast":
                if self._reviewer is None:
                    _raise("TRANSCRIPT_UNAVAILABLE", "reviewer_not_configured")
                source = replace(
                    source, reviews=await self._reviewer.review(source, quality, Path(scratch))
                )
            await reporter.report(progress_update(ProgressStageV1.TRANSCRIPT_READY))
            frames = await self._media.extract_frames(source, Path(scratch))
            validate_frames(frames)
            await reporter.report(progress_update(ProgressStageV1.HD_FRAMES_READY))

            async def analyze() -> VideoNote:
                note = await self._distiller.distill(source, frames)
                validate_note(note, source, frames)
                return note

            analysis_progress = AnalysisProgressReporter(reporter)
            with provider_progress_scope(analysis_progress):
                task = asyncio.create_task(analyze())
            elapsed = 0
            try:
                while not task.done():
                    done, _ = await asyncio.wait({task}, timeout=15)
                    if not done:
                        elapsed += 15
                        await analysis_progress.report(
                            visual_analysis_heartbeat(elapsed, elapsed // 15)
                        )
                note = await task
            finally:

                async def cleanup() -> None:
                    if not task.done():
                        task.cancel()
                    await asyncio.gather(task, return_exceptions=True)

                await finish_owned_task(asyncio.create_task(cleanup()))
            await reporter.report(progress_update(ProgressStageV1.NOTE_VALIDATED))
            selected = {x.frame_id for c in note.chapters for x in c.screenshots}
            if len(selected) > 24:
                _raise("DISTILLATION_FAILED", "selected_frame_count_exceeded")
            return NoteDraft(
                source.source,
                note,
                source.transcript.segments,
                tuple(f for f in frames if f.frame_id in selected),
                quality,
                source.reviews,
            )

    async def _acquire_with_liveness(
        self,
        url: str,
        workspace: Path,
        reporter: ProgressReporter,
    ) -> AcquiredSource:
        tracked = _AcquisitionProgressReporter(reporter)
        task = asyncio.create_task(self._source.acquire(url, workspace, tracked))
        elapsed = 0
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=_VISUAL_HEARTBEAT_SECONDS)
                if done:
                    return await task
                elapsed += _VISUAL_HEARTBEAT_SECONDS
                await reporter.report(
                    media_acquisition_heartbeat(elapsed, tracked.last_verified_progress)
                )
        finally:

            async def cleanup() -> None:
                if not task.done() and task.cancelling() == 0:
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)

            coordinator = asyncio.create_task(cleanup())
            await finish_owned_task(coordinator)
