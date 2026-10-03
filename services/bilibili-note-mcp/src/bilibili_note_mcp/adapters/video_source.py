from __future__ import annotations

from pathlib import Path

from bilibili_note_mcp.application.ports import AcquiredSource, SourcePort
from bilibili_note_mcp.application.progress import ProgressReporter
from bilibili_note_mcp.domain.video_url import validate_video_url
from bilibili_note_mcp.domain.youtube_url import ValidatedYoutubeUrl


class VideoSource:
    def __init__(self, bilibili: SourcePort, youtube: SourcePort) -> None:
        self.bilibili, self.youtube = bilibili, youtube

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        target = (
            self.youtube
            if isinstance(validate_video_url(url), ValidatedYoutubeUrl)
            else self.bilibili
        )
        return await target.acquire(url, workspace, progress)
