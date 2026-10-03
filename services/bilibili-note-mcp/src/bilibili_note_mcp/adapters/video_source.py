from __future__ import annotations

from pathlib import Path

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import AcquiredSource, SourcePort
from bilibili_note_mcp.application.progress import ProgressReporter
from bilibili_note_mcp.domain.generic_url import ValidatedGenericUrl
from bilibili_note_mcp.domain.video_url import validate_video_url
from bilibili_note_mcp.domain.youtube_url import ValidatedYoutubeUrl


class VideoSource:
    def __init__(
        self, bilibili: SourcePort, youtube: SourcePort, generic: SourcePort | None = None
    ) -> None:
        self.bilibili, self.youtube = bilibili, youtube
        self.generic = generic

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        parsed = validate_video_url(url)
        if isinstance(parsed, ValidatedGenericUrl):
            if self.generic is None:
                raise BilibiliNoteFailure("UNSUPPORTED_URL", "generic_source_unavailable")
            return await self.generic.acquire(url, workspace, progress)
        target = self.youtube if isinstance(parsed, ValidatedYoutubeUrl) else self.bilibili
        return await target.acquire(url, workspace, progress)
