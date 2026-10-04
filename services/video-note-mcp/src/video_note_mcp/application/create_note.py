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
    ArtifactPort,
    DistillerPort,
    ImportPort,
    MediaPort,
    NoteDraft,
    PublishedNote,
    PublisherPort,
    SourcePort,
    TranscriptPort,
    TranscriptResult,
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
from video_note_mcp.domain.artifacts import DownloadedSource
from video_note_mcp.domain.models import FailureCode, Quality, VideoNote
from video_note_mcp.domain.url_policy import InvalidBilibiliUrl
from video_note_mcp.domain.video_url import validate_video_url

from .note_validation import validate_frame_bindings, validate_frames, validate_note
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
        *,
        transcript: TranscriptPort,
        artifacts: ArtifactPort,
        importer: ImportPort,
    ) -> None:
        self.artifacts, self._transcript, self._importer = artifacts, transcript, importer
        self._reviewer = reviewer
        self._source, self._media = source, media
        self._distiller, self._publisher = distiller, publisher

    async def download(self, url: str, progress: ProgressReporter | None = None) -> str:
        reporter = progress or NullProgressReporter()
        try:
            validate_video_url(url)
        except InvalidBilibiliUrl as e:
            raise BilibiliNoteFailure(e.code, e.reason) from e
        await reporter.report(progress_update(ProgressStageV1.REQUEST_VALIDATED))
        with tempfile.TemporaryDirectory(prefix="video-note-download-") as scratch:
            source = await self._acquire_with_liveness(url, Path(scratch), reporter)
            return await finish_owned_task(
                asyncio.create_task(asyncio.to_thread(self.artifacts.save_media, source))
            )

    async def import_media(self, filename: str, title: str) -> str:
        with tempfile.TemporaryDirectory(prefix="video-note-import-") as scratch:
            source = await self._importer.load(filename, title, Path(scratch))
            return await finish_owned_task(
                asyncio.create_task(asyncio.to_thread(self.artifacts.save_media, source))
            )

    async def transcribe(
        self,
        media_id: str,
        progress: ProgressReporter | None = None,
        *,
        quality: Quality = "fast",
        imported: TranscriptResult | None = None,
    ) -> str:
        if quality not in ("fast", "standard", "precise"):
            raise ValueError("invalid quality")
        reporter = progress or NullProgressReporter()
        media = await finish_owned_task(
            asyncio.create_task(asyncio.to_thread(self.artifacts.load_media, media_id))
        )
        with tempfile.TemporaryDirectory(prefix="video-note-transcribe-") as scratch:
            workspace = Path(scratch)
            transcript = imported or await self._transcript.transcribe(
                media.media_path, media.source.duration_ms, workspace, reporter
            )
            source = AcquiredSource(
                media.source, media.media_path, transcript, media.source_snapshot_ref
            )
            validate_transcript(source)
            # Save the complete raw transcript before optional audio review.
            transcript_id = await finish_owned_task(
                asyncio.create_task(
                    asyncio.to_thread(self.artifacts.save_transcript, media_id, source, "fast")
                )
            )
            try:
                if quality != "fast":
                    if self._reviewer is None:
                        _raise("TRANSCRIPT_UNAVAILABLE", "reviewer_not_configured")
                    source = replace(
                        source, reviews=await self._reviewer.review(source, quality, workspace)
                    )
                    transcript_id = await finish_owned_task(
                        asyncio.create_task(
                            asyncio.to_thread(
                                self.artifacts.save_transcript, media_id, source, quality
                            )
                        )
                    )
            except Exception as e:
                failure = (
                    e
                    if isinstance(e, BilibiliNoteFailure)
                    else BilibiliNoteFailure("INTERNAL", "unexpected_internal_failure")
                )
                failure.recovery.update(media_id=media_id, transcript_id=transcript_id)
                if failure is e:
                    raise
                raise failure from e
        await reporter.report(progress_update(ProgressStageV1.TRANSCRIPT_READY))
        return transcript_id

    async def frames(self, transcript_id: str, progress: ProgressReporter | None = None) -> str:
        source, _ = await finish_owned_task(
            asyncio.create_task(asyncio.to_thread(self.artifacts.load_transcript, transcript_id))
        )
        with tempfile.TemporaryDirectory(prefix="video-note-frames-") as scratch:
            frames = await self._media.extract_frames(source, Path(scratch))
            validate_frames(frames)
            validate_frame_bindings(source, frames)
            identity = await finish_owned_task(
                asyncio.create_task(
                    asyncio.to_thread(self.artifacts.save_frames, transcript_id, frames)
                )
            )
        await (progress or NullProgressReporter()).report(
            progress_update(ProgressStageV1.HD_FRAMES_READY)
        )
        return identity

    async def author(self, evidence_id: str, reporter: ProgressReporter) -> VideoNote:
        source, _, frames = await finish_owned_task(
            asyncio.create_task(asyncio.to_thread(self.artifacts.load_frames, evidence_id))
        )

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
        return note

    def render(self, evidence_id: str, note: VideoNote) -> PublishedNote:
        source, quality, frames = self.artifacts.load_frames(evidence_id)
        validate_note(note, source, frames)
        selected = {x.frame_id for c in note.chapters for x in c.screenshots}
        if len(selected) > 24:
            _raise("DISTILLATION_FAILED", "selected_frame_count_exceeded")
        draft = NoteDraft(
            source.source,
            note,
            source.transcript.segments,
            tuple(f for f in frames if f.frame_id in selected),
            quality,
            source.reviews,
            source.transcript.method,
        )
        # No cancellation checkpoint after atomic publication.
        return self._publisher.publish((draft,))

    async def execute(
        self, url: str, progress: ProgressReporter | None = None, *, quality: Quality = "fast"
    ) -> PublishedNote:
        reporter = progress or NullProgressReporter()
        recovery: dict[str, str] = {}
        try:
            recovery["media_id"] = await self.download(url, reporter)
            recovery["transcript_id"] = await self.transcribe(
                recovery["media_id"], reporter, quality=quality
            )
            recovery["evidence_id"] = await self.frames(recovery["transcript_id"], reporter)
            note = await self.author(recovery["evidence_id"], reporter)
            await reporter.report(progress_update(ProgressStageV1.NOTE_VALIDATED))
            await asyncio.sleep(0)
            return self.render(recovery["evidence_id"], note)
        except Exception as e:
            failure = (
                e
                if isinstance(e, BilibiliNoteFailure)
                else BilibiliNoteFailure("INTERNAL", "unexpected_internal_failure")
            )
            failure.recovery = {**recovery, **failure.recovery}
            if failure is e:
                raise
            raise failure from e

    async def _acquire_with_liveness(
        self,
        url: str,
        workspace: Path,
        reporter: ProgressReporter,
    ) -> DownloadedSource:
        tracked = _AcquisitionProgressReporter(reporter)
        task = asyncio.create_task(self._source.download(url, workspace, tracked))
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
