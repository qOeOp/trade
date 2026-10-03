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
    platform: Literal["bilibili", "youtube"] = "bilibili"
    quality: Quality = "standard"
    query: NaturalText = Field(min_length=2, max_length=200)
    max_videos: int = Field(default=2, ge=1, le=3)


class SearchCandidateV1(StrictModel):
    video_id: str = Field(pattern=r"^(?:BV[0-9A-Za-z]{10}|[A-Za-z0-9_-]{11})$")
    title: NaturalText = Field(min_length=1, max_length=500)
    canonical_url: str = Field(min_length=1, max_length=2048)
    author_name: NaturalText | None = Field(default=None, min_length=1, max_length=200)
    published_at: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def identity_matches_url(self) -> SearchCandidateV1:
        expected = (
            f"https://www.bilibili.com/video/{self.video_id}?p=1"
            if len(self.video_id) == 12
            else f"https://www.youtube.com/watch?v={self.video_id}"
        )
        if self.canonical_url != expected:
            raise ValueError("search candidate identity does not match canonical URL")
        return self


class SourceV1(StrictModel):
    platform: Literal["bilibili", "youtube", "generic"]
    requested_url: str
    canonical_url: str
    video_id: str = Field(pattern=r"^(?:BV[0-9A-Za-z]{10}|[A-Za-z0-9_-]{11}|web-[0-9a-f]{64})$")
    part_id: str = Field(min_length=1, max_length=100)
    part_index: int = Field(ge=1)
    title: NaturalText = Field(min_length=1, max_length=500)
    author_name: NaturalText | None = Field(min_length=1, max_length=200)
    published_at: str | None = Field(min_length=20, max_length=40)
    duration_ms: int = Field(gt=0, le=MAX_SOURCE_DURATION_MS)

    @model_validator(mode="after")
    def platform_identity(self) -> SourceV1:
        from .generic_url import validate_generic_url
        from .url_policy import ValidatedBilibiliUrl, validate_bilibili_url
        from .youtube_url import ValidatedYoutubeUrl, validate_youtube_url

        if self.platform == "generic":
            generic = validate_generic_url(self.requested_url)
            if (
                self.part_index != 1
                or self.part_id != self.video_id
                or self.video_id != generic.video_id
                or self.canonical_url != generic.canonical_url()
            ):
                raise ValueError("generic_source_identity_invalid")
            return self
        if self.author_name is None or self.published_at is None:
            raise ValueError("platform_metadata_required")
        value: ValidatedBilibiliUrl | ValidatedYoutubeUrl
        if self.platform == "youtube":
            value = validate_youtube_url(self.requested_url)
            expected = value.canonical_url()
            if self.part_index != 1 or self.part_id != self.video_id:
                raise ValueError("youtube_part_identity_invalid")
        else:
            value = validate_bilibili_url(self.requested_url)
            expected = value.canonical_url(self.part_index)
        if value.video_id != self.video_id or expected != self.canonical_url:
            raise ValueError("source_identity_invalid")
        return self


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
