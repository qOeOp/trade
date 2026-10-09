from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .models import Quality, SourceV1, TranscriptMethod, VideoNote


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    evidence_id: str
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True, slots=True)
class TranscriptResult:
    method: TranscriptMethod
    provider_ref: str | None
    language: str
    segments: tuple[TranscriptSegment, ...]
    covered_duration_ms: int | None = None


@dataclass(frozen=True, slots=True)
class AudioReview:
    start_ms: int
    end_ms: int
    primary_text: str
    alternate_text: str
    provider_ref: str
    differs: bool


@dataclass(frozen=True, slots=True)
class DownloadedSource:
    source: SourceV1
    media_path: Path
    source_snapshot_ref: str


@dataclass(frozen=True, slots=True)
class AcquiredSource:
    source: SourceV1
    media_path: Path
    transcript: TranscriptResult
    source_snapshot_ref: str
    reviews: tuple[AudioReview, ...] = ()


@dataclass(frozen=True, slots=True)
class SourceMediaArtifact:
    media_path: Path
    media_sha256: str
    observed_duration_ms: int
    width: int
    height: int
    upstream_video_id: str
    upstream_part_index: int
    format_id: str
    adapter_ref: str


@dataclass(frozen=True, slots=True)
class FrameAsset:
    frame_id: str
    group_id: str
    timestamp_ms: int
    width: int
    height: int
    png_bytes: bytes
    asset_ref: str
    transcript_refs: tuple[str, ...]
    selection_reason: Literal["deictic_cue", "visual_activity", "ordered_relation_cue", "coverage"]


@dataclass(frozen=True, slots=True)
class NoteDraft:
    source: SourceV1
    note: VideoNote
    transcript: tuple[TranscriptSegment, ...]
    frames: tuple[FrameAsset, ...]
    quality: Quality = "fast"
    reviews: tuple[AudioReview, ...] = ()
    transcript_method: TranscriptMethod = "asr"


@dataclass(frozen=True, slots=True)
class PublishedNote:
    rendered_markdown: str
    note_path: str
    html_path: str
    images: tuple[str, ...]
