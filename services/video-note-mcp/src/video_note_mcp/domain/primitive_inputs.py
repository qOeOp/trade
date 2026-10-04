from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from .models import NaturalText, Quality, StrictModel, VideoNote


class DownloadInput(StrictModel):
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    media_id: str | None = Field(default=None, pattern=r"^media-[0-9a-f]{64}$")

    @model_validator(mode="after")
    def one_source(self) -> DownloadInput:
        if (self.url is None) == (self.media_id is None):
            raise ValueError("exactly_one_media_source_required")
        return self


class SegmentInput(StrictModel):
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=16384)


class ImportInput(StrictModel):
    kind: Literal["media", "transcript"]
    filename: str | None = Field(default=None, min_length=1, max_length=200)
    title: NaturalText | None = Field(default=None, min_length=1, max_length=500)
    media_id: str | None = Field(default=None, pattern=r"^media-[0-9a-f]{64}$")
    segments: tuple[SegmentInput, ...] | None = Field(default=None, min_length=1, max_length=4096)
    language: str = Field(default="und", min_length=1, max_length=32)
    quality: Quality = "fast"

    @model_validator(mode="after")
    def selected_kind(self) -> ImportInput:
        if self.kind == "media":
            if (
                self.filename is None
                or self.title is None
                or self.media_id is not None
                or self.segments is not None
                or self.quality != "fast"
                or self.language != "und"
            ):
                raise ValueError("media_import_fields_invalid")
        elif (
            self.media_id is None
            or self.segments is None
            or self.filename is not None
            or self.title is not None
        ):
            raise ValueError("transcript_import_fields_invalid")
        return self


class TranscribeInput(StrictModel):
    media_id: str = Field(pattern=r"^media-[0-9a-f]{64}$")
    quality: Quality = "standard"


class FramesInput(StrictModel):
    transcript_id: str | None = Field(default=None, pattern=r"^transcript-[0-9a-f]{64}$")
    evidence_id: str | None = Field(default=None, pattern=r"^frames-[0-9a-f]{64}$")

    @model_validator(mode="after")
    def one_source(self) -> FramesInput:
        if (self.transcript_id is None) == (self.evidence_id is None):
            raise ValueError("exactly_one_evidence_source_required")
        return self


class RenderInput(StrictModel):
    evidence_id: str = Field(pattern=r"^frames-[0-9a-f]{64}$")
    note: VideoNote
