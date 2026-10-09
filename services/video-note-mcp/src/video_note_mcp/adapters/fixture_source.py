from __future__ import annotations

import json
import shutil
from pathlib import Path

from video_note_mcp.adapters.subtitles import parse_webvtt
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.ports import TranscriptResult
from video_note_mcp.application.progress import (
    ProgressReporter,
    ProgressStageV1,
    progress_update,
)
from video_note_mcp.domain.artifacts import DownloadedSource
from video_note_mcp.domain.models import SourceV1
from video_note_mcp.domain.refs import raw_ref, source_snapshot_ref
from video_note_mcp.domain.url_policy import validate_bilibili_url


class FixtureSource:
    def __init__(self, root: Path) -> None:
        self._root = root

    async def download(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> DownloadedSource:
        try:
            validated = validate_bilibili_url(url)
            metadata = json.loads((self._root / "source.json").read_text(encoding="utf-8"))
            media_path = workspace / "source.mp4"
            shutil.copyfile(self._root / "media.mp4", media_path)
            part_index = int(metadata["part_index"])
            source = SourceV1.model_validate(
                {
                    **metadata,
                    "requested_url": validated.requested_url,
                    "canonical_url": validated.canonical_url(part_index),
                }
            )
            await progress.report(progress_update(ProgressStageV1.MEDIA_READY))
        except (OSError, ValueError, json.JSONDecodeError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "fixture_source_invalid") from e
        snapshot = {
            "source": source.model_dump(mode="json", by_alias=True),
            "media_ref": raw_ref(media_path.read_bytes()),
            "adapter": "fixture-source/v1",
        }
        return DownloadedSource(
            source=source,
            media_path=media_path,
            source_snapshot_ref=source_snapshot_ref(snapshot),
        )

    async def transcribe(
        self, media_path: Path, duration_ms: int, workspace: Path, progress: ProgressReporter
    ) -> TranscriptResult:
        text = (self._root / "subtitles.vtt").read_text(encoding="utf-8")
        return TranscriptResult("platform_subtitle", None, "zh-CN", parse_webvtt(text))
