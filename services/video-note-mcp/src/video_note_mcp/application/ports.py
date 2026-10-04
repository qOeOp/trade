from __future__ import annotations

from pathlib import Path
from typing import Protocol

from video_note_mcp.domain.artifacts import (
    AcquiredSource as AcquiredSource,
)
from video_note_mcp.domain.artifacts import AudioReview, DownloadedSource
from video_note_mcp.domain.artifacts import (
    FrameAsset as FrameAsset,
)
from video_note_mcp.domain.artifacts import (
    NoteDraft as NoteDraft,
)
from video_note_mcp.domain.artifacts import (
    PublishedNote as PublishedNote,
)
from video_note_mcp.domain.artifacts import (
    SourceMediaArtifact as SourceMediaArtifact,
)
from video_note_mcp.domain.artifacts import (
    TranscriptResult as TranscriptResult,
)
from video_note_mcp.domain.artifacts import (
    TranscriptSegment as TranscriptSegment,
)
from video_note_mcp.domain.models import (
    Quality,
    VideoNote,
)

from .progress import ProgressReporter


class TranscriptReviewPort(Protocol):
    async def review(
        self, source: AcquiredSource, quality: Quality, workspace: Path
    ) -> tuple[AudioReview, ...]: ...


class SourcePort(Protocol):
    async def download(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> DownloadedSource: ...


class SourceMediaPort(Protocol):
    async def download(
        self,
        canonical_url: str,
        workspace: Path,
    ) -> SourceMediaArtifact: ...


class TranscriptPort(Protocol):
    async def transcribe(
        self,
        media_path: Path,
        duration_ms: int,
        workspace: Path,
        progress: ProgressReporter,
    ) -> TranscriptResult: ...


class MediaPort(Protocol):
    async def extract_frames(
        self, source: AcquiredSource, workspace: Path
    ) -> tuple[FrameAsset, ...]: ...


class DistillerPort(Protocol):
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> VideoNote: ...


class PublisherPort(Protocol):
    def publish(self, drafts: tuple[NoteDraft, ...]) -> PublishedNote: ...


class ArtifactPort(Protocol):
    def save_media(self, source: DownloadedSource) -> str: ...
    def load_media(self, identity: str) -> DownloadedSource: ...
    def save_transcript(self, media_id: str, source: AcquiredSource, quality: Quality) -> str: ...
    def load_transcript(self, identity: str) -> tuple[AcquiredSource, Quality]: ...
    def save_frames(self, transcript_id: str, frames: tuple[FrameAsset, ...]) -> str: ...
    def load_frames(
        self, identity: str
    ) -> tuple[AcquiredSource, Quality, tuple[FrameAsset, ...]]: ...
    def frame_paths(self, identity: str) -> tuple[str, ...]: ...


class ImportPort(Protocol):
    async def load(self, filename: str, title: str, workspace: Path) -> DownloadedSource: ...
