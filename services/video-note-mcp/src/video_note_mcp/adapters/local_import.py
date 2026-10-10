"""Import only regular media from a host-selected inbox; never accept tool-supplied paths."""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path

from video_note_mcp.adapters.generic_source import require_progressive_container
from video_note_mcp.adapters.media_acquisition import copy_bounded_media, probe_downloaded_media
from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.owned_tasks import finish_owned_task
from video_note_mcp.application.resource_limits import (
    MEDIA_SOURCE_MAX_PIXELS,
    MEDIA_SOURCE_MAX_SIDE,
)
from video_note_mcp.domain.artifacts import DownloadedSource
from video_note_mcp.domain.models import SourceV1
from video_note_mcp.domain.refs import source_snapshot_ref


class LocalImport:
    async def load(self, filename: str, title: str, workspace: Path) -> DownloadedSource:
        path, digest = await finish_owned_task(
            asyncio.create_task(asyncio.to_thread(self._copy, filename, workspace))
        )
        duration, width, height = await probe_downloaded_media(path)
        if (
            min(width, height) < 720
            or width * height > MEDIA_SOURCE_MAX_PIXELS
            or max(width, height) > MEDIA_SOURCE_MAX_SIDE
        ):
            raise BilibiliNoteFailure("HD_SOURCE_UNAVAILABLE", "source_below_hd_floor")
        identity = "local-" + digest
        url = "local:sha256:" + digest
        source = SourceV1(
            platform="local",
            requested_url=url,
            canonical_url=url,
            video_id=identity,
            part_id=identity,
            part_index=1,
            title=title,
            author_name=None,
            published_at=None,
            duration_ms=duration,
        )
        return DownloadedSource(
            source,
            path,
            source_snapshot_ref({"source": source.model_dump(mode="json"), "media_sha256": digest}),
        )

    def _copy(self, filename: str, workspace: Path) -> tuple[Path, str]:
        configured = os.environ.get("BILIBILI_NOTE_IMPORT_DIR")
        if not configured:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "import_directory_not_configured")
        root = Path(configured).expanduser()
        if (
            not root.is_absolute()
            or root.is_symlink()
            or not root.is_dir()
            or not re.fullmatch(r"[\w .-]{1,180}\.(?:mp4|webm)", filename)
            or filename in {".", ".."}
        ):
            raise BilibiliNoteFailure("INVALID_URL", "import_filename_invalid")
        path = workspace / "source.mp4"
        try:
            digest = copy_bounded_media(root / filename, path)
        except OSError as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "import_file_unavailable") from e
        require_progressive_container(path)
        return path, digest
