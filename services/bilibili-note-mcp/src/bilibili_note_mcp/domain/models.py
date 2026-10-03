from __future__ import annotations

import unicodedata
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

TranscriptMethod = Literal["platform_subtitle", "asr"]
FailureCode = Literal[
    "INVALID_URL",
    "UNSUPPORTED_URL",
    "PART_REQUIRED",
    "SOURCE_UNAVAILABLE",
    "ACCESS_DENIED",
    "RATE_LIMITED",
    "SOURCE_CHANGED",
    "TRANSCRIPT_UNAVAILABLE",
    "TRANSCRIPT_INCOMPLETE",
    "HD_SOURCE_UNAVAILABLE",
    "DISTILLATION_FAILED",
    "VISUAL_EVIDENCE_INCOMPLETE",
    "OUTPUT_INVALID",
    "CANCELLED",
    "DEADLINE_EXCEEDED",
    "SEARCH_EMPTY",
    "SEARCH_TARGET_UNMET",
    "INTERNAL",
]
TRANSCRIPT_WINDOW_MS = 45_000
MAX_TRANSCRIPT_SEGMENTS = 128
MAX_SOURCE_DURATION_MS = TRANSCRIPT_WINDOW_MS * MAX_TRANSCRIPT_SEGMENTS


def _natural_text(value: str) -> str:
    if value != value.strip() or any(unicodedata.category(c) == "Cc" for c in value):
        raise ValueError("text must be trimmed single-line prose")
    return value


NaturalText = Annotated[str, AfterValidator(_natural_text)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, populate_by_name=True)


Quality = Literal["fast", "standard", "precise"]


class CreateNoteInputV1(StrictModel):
    quality: Quality = "standard"
    url: str = Field(min_length=1, max_length=2048)


class SearchAndCreateInputV1(StrictModel):
    quality: Quality = "standard"
    query: NaturalText = Field(min_length=2, max_length=200)
    max_videos: int = Field(default=2, ge=1, le=3)


class SearchCandidateV1(StrictModel):
    video_id: str = Field(pattern=r"^BV[0-9A-Za-z]{10}$")
    title: NaturalText = Field(min_length=1, max_length=500)
    canonical_url: str = Field(min_length=47, max_length=47)
    author_name: NaturalText | None = Field(default=None, min_length=1, max_length=200)
    published_at: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def identity_matches_url(self) -> SearchCandidateV1:
        expected = f"https://www.bilibili.com/video/{self.video_id}?p=1"
        if self.canonical_url != expected:
            raise ValueError("search candidate identity does not match canonical URL")
        return self


class SourceV1(StrictModel):
    platform: Literal["bilibili"]
    requested_url: str
    canonical_url: str
    video_id: str = Field(pattern=r"^BV[0-9A-Za-z]{10}$")
    part_id: str = Field(min_length=1, max_length=100)
    part_index: int = Field(ge=1)
    title: NaturalText = Field(min_length=1, max_length=500)
    author_name: NaturalText = Field(min_length=1, max_length=200)
    published_at: str = Field(min_length=20, max_length=40)
    duration_ms: int = Field(gt=0, le=MAX_SOURCE_DURATION_MS)


class GroundedText(StrictModel):
    text: NaturalText = Field(min_length=1, max_length=3000)
    evidence_refs: tuple[str, ...] = Field(min_length=1, max_length=128)


class ScreenshotSelection(StrictModel):
    frame_id: str = Field(pattern=r"^F[0-9]{2}$")


class NoteChapter(StrictModel):
    title: NaturalText = Field(min_length=1, max_length=160)
    points: tuple[GroundedText, ...] = Field(min_length=1, max_length=16)
    screenshots: tuple[ScreenshotSelection, ...] = Field(max_length=5)


class VideoNote(StrictModel):
    overview: tuple[GroundedText, ...] = Field(min_length=1, max_length=4)
    chapters: tuple[NoteChapter, ...] = Field(min_length=1, max_length=16)
    takeaways: tuple[GroundedText, ...] = Field(max_length=12)


class PublicBilibiliNoteResultV4(StrictModel):
    schema_id: Literal["bilibili-note.result/v4"] = Field(alias="schema")
    rendered_markdown: str = Field(min_length=1, max_length=262144)
    note_path: str
    html_path: str
    images: tuple[str, ...]


class PublicBilibiliSearchResultV2(StrictModel):
    schema_id: Literal["bilibili-note.search-result/v2"] = Field(alias="schema")
    rendered_markdown: str = Field(min_length=1, max_length=786432)
    note_path: str
    html_path: str
    images: tuple[str, ...]


class ErrorV1(StrictModel):
    schema_id: Literal["bilibili-note.error/v1"] = Field(alias="schema")
    maturity: Literal["current_poc"]
    code: FailureCode
    reason: str = Field(pattern=r"^[a-z0-9_]{1,80}$")
