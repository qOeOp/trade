from __future__ import annotations

import json
import shutil
from pathlib import Path

from bilibili_note_mcp.adapters.subtitles import parse_webvtt
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import AcquiredSource, TranscriptResult
from bilibili_note_mcp.application.progress import (
    ProgressReporter,
    ProgressStageV1,
    progress_update,
)
from bilibili_note_mcp.domain.models import SourceV1
from bilibili_note_mcp.domain.refs import raw_ref, source_snapshot_ref
from bilibili_note_mcp.domain.url_policy import validate_bilibili_url


class FixtureSource:
    def __init__(self, root: Path) -> None:
        self._root = root

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        try:
            validated = validate_bilibili_url(url)
            metadata = json.loads((self._root / "source.json").read_text(encoding="utf-8"))
            media_path = workspace / "source.mp4"
            shutil.copyfile(self._root / "media.mp4", media_path)
            transcript_text = (self._root / "subtitles.vtt").read_text(encoding="utf-8")
            part_index = int(metadata["part_index"])
            source = SourceV1.model_validate(
                {
                    **metadata,
                    "requested_url": validated.requested_url,
                    "canonical_url": validated.canonical_url(part_index),
                }
            )
            await progress.report(progress_update(ProgressStageV1.MEDIA_READY))
            transcript = TranscriptResult(
                method="platform_subtitle",
                provider_ref=None,
                language="zh-CN",
                segments=parse_webvtt(transcript_text),
            )
        except (OSError, ValueError, json.JSONDecodeError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "fixture_source_invalid") from e
        snapshot = {
            "source": source.model_dump(mode="json", by_alias=True),
            "media_ref": raw_ref(media_path.read_bytes()),
            "transcript_ref": raw_ref(transcript_text.encode()),
            "adapter": "fixture-source/v1",
        }
        return AcquiredSource(
            source=source,
            media_path=media_path,
            transcript=transcript,
            source_snapshot_ref=source_snapshot_ref(snapshot),
        )
