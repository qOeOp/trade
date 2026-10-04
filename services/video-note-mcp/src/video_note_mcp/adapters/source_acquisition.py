from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from video_note_mcp.adapters.source_cache import SourceCache
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.owned_tasks import finish_owned_task
from video_note_mcp.application.ports import AcquiredSource, SourceMediaPort, TranscriptPort
from video_note_mcp.application.progress import (
    ProgressReporter,
    ProgressStageV1,
    progress_update,
)
from video_note_mcp.application.resource_limits import (
    MEDIA_SOURCE_MAX_PIXELS,
    MEDIA_SOURCE_MAX_SIDE,
)
from video_note_mcp.domain.models import SourceV1
from video_note_mcp.domain.refs import source_snapshot_ref


class SourceAcquisition:
    def __init__(
        self, transcript: TranscriptPort, media: SourceMediaPort, cache: SourceCache | None = None
    ) -> None:
        self.transcript, self.media, self.cache = transcript, media, cache
        self.cache_gate = asyncio.Lock()

    async def acquire(
        self,
        source: SourceV1,
        width: int,
        height: int,
        metadata_identity: dict[str, Any],
        workspace: Path,
        progress: ProgressReporter,
    ) -> AcquiredSource:
        if self.cache is not None:
            cached = await finish_owned_task(
                asyncio.create_task(asyncio.to_thread(self.cache.load, source))
            )
            if cached is not None:
                await progress.report(progress_update(ProgressStageV1.MEDIA_READY))
                return cached
        media = await self.media.download(source.canonical_url, workspace)
        if (
            media.upstream_video_id != source.video_id
            or media.upstream_part_index != source.part_index
        ):
            raise BilibiliNoteFailure("SOURCE_CHANGED", "media_video_identity_changed")
        if (
            media.width * media.height < 1280 * 720
            or media.width * media.height > MEDIA_SOURCE_MAX_PIXELS
            or max(media.width, media.height) > MEDIA_SOURCE_MAX_SIDE
            or min(media.width, media.height) < 720
        ):
            raise BilibiliNoteFailure("HD_SOURCE_UNAVAILABLE", "source_below_hd_floor")
        duration_delta = media.observed_duration_ms - source.duration_ms
        if duration_delta < -2000:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_access_restricted_preview")
        if abs(duration_delta) > 2000:
            raise BilibiliNoteFailure("SOURCE_CHANGED", "media_duration_changed")
        await progress.report(progress_update(ProgressStageV1.MEDIA_READY))
        transcript = await self.transcript.transcribe(
            media.media_path, source.duration_ms, workspace, progress
        )
        snapshot = {
            "source": source.model_dump(mode="json", by_alias=True),
            **metadata_identity,
            "declared_dimensions": [width, height],
            "observed_dimensions": [media.width, media.height],
            "observed_duration_ms": media.observed_duration_ms,
            "media_sha256": media.media_sha256,
            "format_id": media.format_id,
            "adapter": media.adapter_ref,
        }
        result = AcquiredSource(
            source=source,
            media_path=media.media_path,
            transcript=transcript,
            source_snapshot_ref=source_snapshot_ref(snapshot),
        )

        if self.cache is not None:
            async with self.cache_gate:
                try:
                    await finish_owned_task(
                        asyncio.create_task(asyncio.to_thread(self.cache.save, result))
                    )
                except OSError:
                    pass  # Optional cache writes cannot turn acquired evidence into a failure.
        return result
