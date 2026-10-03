from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from bilibili_note_mcp.adapters.media_acquisition import (
    media_worker_environment,
    probe_downloaded_media,
    run_media_worker,
    sha256_file,
)
from bilibili_note_mcp.adapters.source_acquisition import SourceAcquisition
from bilibili_note_mcp.adapters.strict_json import decode_strict_json_object
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import AcquiredSource, SourceMediaArtifact, TranscriptPort
from bilibili_note_mcp.application.progress import ProgressReporter
from bilibili_note_mcp.domain.generic_url import validate_generic_url
from bilibili_note_mcp.domain.models import SourceV1

_SCHEMA = "video-note-generic-worker/v1"


def require_progressive_container(path: Path) -> None:
    # A text playlist can reference local files even when FFmpeg network protocols are off.
    # Refuse it before invoking any decoder; this fallback admits MP4/WebM containers only.
    with path.open("rb") as stream:
        header = stream.read(16)
    if not (header[4:8] == b"ftyp" or header[:4] == b"\x1a\x45\xdf\xa3"):
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "generic_container_unsupported")


@dataclass(frozen=True)
class _PreparedMedia:
    url: str
    artifact: SourceMediaArtifact

    async def download(self, canonical_url: str, workspace: Path) -> SourceMediaArtifact:
        if canonical_url != self.url or self.artifact.media_path.parent != workspace:
            raise BilibiliNoteFailure("SOURCE_CHANGED", "generic_media_identity_changed")
        return self.artifact


class GenericSource:
    def __init__(self, transcript: TranscriptPort) -> None:
        self.transcript = transcript

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        parsed = validate_generic_url(url)
        canonical = parsed.canonical_url()
        code, raw = await run_media_worker(
            (sys.executable, "-m", "bilibili_note_mcp.adapters._generic_worker"),
            json.dumps({"schema": _SCHEMA, "url": canonical, "workspace": str(workspace)}).encode(),
            timeout_seconds=360,
            grace_seconds=2,
            env=media_worker_environment(),
        )
        try:
            data = decode_strict_json_object(raw)
            if (
                code != 0
                or data.get("schema") != _SCHEMA
                or data.get("ok") is not True
                or set(data) != {"schema", "ok", "url", "title", "author", "date"}
                or data["url"] != canonical
            ):
                raise ValueError("generic_receipt_invalid")
            path = workspace / "source.mp4"
            if path.is_symlink():
                raise ValueError("generic_media_invalid")
            require_progressive_container(path)
            duration, width, height = await probe_downloaded_media(path)
            date = None
            if data["date"] is not None:
                date = (
                    datetime.strptime(data["date"], "%Y%m%d")
                    .replace(tzinfo=UTC)
                    .isoformat()
                    .replace("+00:00", "Z")
                )
            source = SourceV1(
                platform="generic",
                requested_url=url,
                canonical_url=canonical,
                video_id=parsed.video_id,
                part_id=parsed.video_id,
                part_index=1,
                title=data["title"] or "未提供标题",
                author_name=data["author"],
                published_at=date,
                duration_ms=duration,
            )
        except (ValueError, TypeError, KeyError, OSError) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "generic_acquisition_failed") from e
        artifact = SourceMediaArtifact(
            media_path=path,
            media_sha256=await asyncio.to_thread(sha256_file, path),
            observed_duration_ms=duration,
            width=width,
            height=height,
            upstream_video_id=parsed.video_id,
            upstream_part_index=1,
            format_id="progressive-https",
            adapter_ref="yt-dlp/generic",
        )
        # No generic cache: a public URL can change bytes without changing its metadata.
        return await SourceAcquisition(
            self.transcript, _PreparedMedia(canonical, artifact)
        ).acquire(
            source,
            width,
            height,
            {"generic_url_id": parsed.video_id},
            workspace,
            progress,
        )
