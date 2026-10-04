from __future__ import annotations

from typing import Literal

from pydantic import Field

from .artifacts import AudioReview, TranscriptResult
from .models import Quality, SourceV1, StrictModel


class FrameResult(StrictModel):
    frame_id: str = Field(pattern=r"^F[0-9]{2}$")
    group_id: str = Field(pattern=r"^G[0-9]{2}$")
    timestamp_ms: int = Field(ge=0)
    width: int = Field(ge=720)
    height: int = Field(ge=720)
    asset_ref: str = Field(pattern=r"^[0-9a-f]{64}$")
    transcript_refs: tuple[str, ...] = Field(min_length=1, max_length=4096)
    selection_reason: Literal["deictic_cue", "visual_activity", "ordered_relation_cue", "coverage"]
    path: str


class ArtifactResultV1(StrictModel):
    schema_id: Literal["video-note.artifact-result/v1"] = Field(alias="schema")
    source: SourceV1
    media_path: str | None = None
    media_id: str | None = Field(default=None, pattern=r"^media-[0-9a-f]{64}$")
    transcript_id: str | None = Field(default=None, pattern=r"^transcript-[0-9a-f]{64}$")
    evidence_id: str | None = Field(default=None, pattern=r"^frames-[0-9a-f]{64}$")
    quality: Quality | None = None
    transcript: TranscriptResult | None = None
    reviews: tuple[AudioReview, ...] = Field(default=(), max_length=4096)
    frames: tuple[FrameResult, ...] = Field(default=(), max_length=48)
