from __future__ import annotations

from pathlib import Path
from typing import Protocol

from video_note_mcp.domain.artifacts import (
    AcquiredSource as AcquiredSource,
)
from video_note_mcp.domain.artifacts import AudioReview
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
    SearchCandidateV1,
    VideoNote,
)

from .progress import ProgressReporter


class TranscriptReviewPort(Protocol):
    async def review(
        self, source: AcquiredSource, quality: Quality, workspace: Path
    ) -> tuple[AudioReview, ...]: ...


class SourcePort(Protocol):
    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource: ...


class SourceMediaPort(Protocol):
    async def download(
        self,
        canonical_url: str,
        workspace: Path,
    ) -> SourceMediaArtifact: ...


class SearchPort(Protocol):
    async def search(self, query: str, limit: int) -> tuple[SearchCandidateV1, ...]: ...


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
