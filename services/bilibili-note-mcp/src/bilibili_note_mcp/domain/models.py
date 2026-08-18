from __future__ import annotations

import re
import unicodedata
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

EvidenceMode = Literal["explicit", "inferred"]
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

_EVIDENCE_REF = re.compile(r"^(?:E[0-9]{3}|V[0-9]{2})$")


def normalized_summary_item(value: PublicRuleV1) -> str:
    """Canonical exact comparison for public strategy items."""
    return " ".join(unicodedata.normalize("NFKC", value.rule_body).casefold().split())


def summary_items_duplicate(left: PublicRuleV1, right: PublicRuleV1) -> bool:
    """Return true only for the one host-safe normalized exact equivalence."""
    return normalized_summary_item(left) == normalized_summary_item(right)


def summary_items_are_distinct(items: tuple[PublicRuleV1, ...]) -> bool:
    return all(
        not summary_items_duplicate(items[left], items[right])
        for left in range(len(items))
        for right in range(left + 1, len(items))
    )


def _natural_text(value: str) -> str:
    if value != value.strip():
        raise ValueError("text must not have surrounding whitespace")
    if any(unicodedata.category(character) == "Cc" for character in value):
        raise ValueError("text must not contain control characters")
    return value


NaturalText = Annotated[str, AfterValidator(_natural_text)]


def _ref_key(value: str) -> tuple[int, int]:
    if _EVIDENCE_REF.fullmatch(value) is None:
        raise ValueError("invalid evidence reference")
    return (0 if value.startswith("E") else 1, int(value[1:]))


def validate_refs(refs: tuple[str, ...], *, allow_empty: bool = False) -> tuple[str, ...]:
    if not refs and not allow_empty:
        raise ValueError("evidence references are required")
    if len(refs) != len(set(refs)) or tuple(sorted(refs, key=_ref_key)) != refs:
        raise ValueError("evidence references must be unique and canonical")
    for reference in refs:
        _ref_key(reference)
    return refs


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, populate_by_name=True)


class PublicRuleV1(StrictModel):
    """Provider-authored rule body carried without host inference or rewriting."""

    rule_body: NaturalText = Field(min_length=1, max_length=1200)


class CreateNoteInputV1(StrictModel):
    url: str = Field(min_length=1, max_length=2048)


class SearchAndCreateInputV1(StrictModel):
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


class ProvenanceV2(StrictModel):
    source_snapshot_ref: str = Field(pattern=r"^bs_[0-9a-f]{64}$")
    transcript_ref: str = Field(pattern=r"^bt_[0-9a-f]{64}$")
    transcript_method: TranscriptMethod
    transcript_provider_ref: str | None = Field(default=None, max_length=300)
    distiller_profile_ref: str = Field(pattern=r"^bp_[0-9a-f]{64}$")
    model_ref: str = Field(min_length=1, max_length=300)
    acquired_at: str = Field(min_length=20, max_length=40)

    @model_validator(mode="after")
    def provider_matches_method(self) -> ProvenanceV2:
        if (self.transcript_method == "asr") != (self.transcript_provider_ref is not None):
            raise ValueError("transcript provider must match transcript method")
        return self


class CoverageV2(StrictModel):
    spoken_content: Literal["complete"]
    visual_analysis: Literal["internal_transient"]
    analyzed_visual_frames: int = Field(ge=2, le=5)
    source_language: str = Field(min_length=2, max_length=50)
    brief_language: Literal["zh-CN"]


class EvidenceSegmentV2(StrictModel):
    evidence_id: str = Field(pattern=r"^E[0-9]{3}$")
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    origin: TranscriptMethod

    @model_validator(mode="after")
    def interval_is_positive(self) -> EvidenceSegmentV2:
        if self.end_ms <= self.start_ms:
            raise ValueError("evidence interval must be positive")
        return self


class BoundBriefItemV2(StrictModel):
    text: NaturalText = Field(min_length=1, max_length=1200)
    mode: EvidenceMode
    evidence_refs: tuple[str, ...] = Field(min_length=1, max_length=24)

    @model_validator(mode="after")
    def refs_are_canonical(self) -> BoundBriefItemV2:
        validate_refs(self.evidence_refs)
        return self


class VisualInsightV2(StrictModel):
    visual_id: str = Field(pattern=r"^V[0-9]{2}$")
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)
    transcript_refs: tuple[str, ...] = Field(min_length=1, max_length=8)
    frame_timestamps_ms: tuple[int, ...] = Field(min_length=1, max_length=3)
    selection_reason: Literal["deictic_cue", "visual_activity", "ordered_relation_cue", "coverage"]
    evidence_basis: Literal["static_frame", "ordered_relation"]

    @model_validator(mode="after")
    def validate_moment(self) -> VisualInsightV2:
        if self.end_ms <= self.start_ms:
            raise ValueError("visual interval must be positive")
        if tuple(sorted(set(self.frame_timestamps_ms))) != self.frame_timestamps_ms:
            raise ValueError("frame timestamps must be unique and ordered")
        expected_count = 3 if self.evidence_basis == "ordered_relation" else 1
        if len(self.frame_timestamps_ms) != expected_count:
            raise ValueError("visual evidence basis does not match frame count")
        if any(value < self.start_ms or value > self.end_ms for value in self.frame_timestamps_ms):
            raise ValueError("frame timestamp is outside visual interval")
        if any(not value.startswith("E") for value in self.transcript_refs):
            raise ValueError("visual insight must bind transcript evidence")
        validate_refs(self.transcript_refs)
        return self


class ResearchHypothesisV2(StrictModel):
    hypothesis_id: str = Field(pattern=r"^H[0-9]{2}$")
    claim: NaturalText = Field(min_length=1, max_length=1200)
    validation_question: NaturalText = Field(min_length=1, max_length=800)
    falsifier: NaturalText = Field(min_length=1, max_length=800)
    evidence_refs: tuple[str, ...] = Field(min_length=1, max_length=24)

    @model_validator(mode="after")
    def refs_are_canonical(self) -> ResearchHypothesisV2:
        validate_refs(self.evidence_refs)
        return self


class BilibiliResearchBriefV2(StrictModel):
    schema_id: Literal["bilibili-note.research-brief/v2"] = Field(alias="schema")
    source: SourceV1
    provenance: ProvenanceV2
    coverage: CoverageV2
    core_thesis: BoundBriefItemV2
    key_points: tuple[BoundBriefItemV2, ...] = Field(min_length=1, max_length=23)
    visual_insights: tuple[VisualInsightV2, ...] = Field(max_length=5)
    research_hypotheses: tuple[ResearchHypothesisV2, ...] = Field(max_length=6)
    unknowns: tuple[NaturalText, ...] = Field(max_length=16)
    evidence: tuple[EvidenceSegmentV2, ...] = Field(min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_graph(self) -> BilibiliResearchBriefV2:
        if [item.evidence_id for item in self.evidence] != [
            f"E{index:03d}" for index in range(1, len(self.evidence) + 1)
        ]:
            raise ValueError("evidence IDs must be contiguous")
        if [item.visual_id for item in self.visual_insights] != [
            f"V{index:02d}" for index in range(1, len(self.visual_insights) + 1)
        ]:
            raise ValueError("visual IDs must be contiguous")
        if [item.hypothesis_id for item in self.research_hypotheses] != [
            f"H{index:02d}" for index in range(1, len(self.research_hypotheses) + 1)
        ]:
            raise ValueError("hypothesis IDs must be contiguous")
        if list(self.evidence) != sorted(
            self.evidence, key=lambda item: (item.start_ms, item.end_ms, item.evidence_id)
        ):
            raise ValueError("evidence must be time ordered")
        if any(item.end_ms > self.source.duration_ms for item in self.evidence):
            raise ValueError("evidence exceeds source duration")
        if any(item.end_ms > self.source.duration_ms for item in self.visual_insights):
            raise ValueError("visual insight exceeds source duration")
        allowed = {item.evidence_id for item in self.evidence} | {
            item.visual_id for item in self.visual_insights
        }
        records = [self.core_thesis, *self.key_points]
        for record in records:
            if not set(record.evidence_refs) <= allowed:
                raise ValueError("brief item has dangling evidence reference")
            if record.mode == "explicit" and not any(
                reference.startswith("E") for reference in record.evidence_refs
            ):
                raise ValueError("explicit item needs transcript evidence")
        for visual in self.visual_insights:
            if not set(visual.transcript_refs) <= allowed:
                raise ValueError("visual insight has dangling transcript reference")
        for hypothesis in self.research_hypotheses:
            if not set(hypothesis.evidence_refs) <= allowed:
                raise ValueError("hypothesis has dangling evidence reference")
        if sum(len(item.text) for item in records) > 28_800:
            raise ValueError("brief exceeds total text bound")
        return self


class StrategySummaryV1(StrictModel):
    """Pure public-note material; evidence bindings stay in the private brief."""

    subject: NaturalText = Field(min_length=1, max_length=200)
    core_strategies: tuple[PublicRuleV1, ...] = Field(max_length=9)
    methods: tuple[PublicRuleV1, ...] = Field(max_length=9)
    risk_management: tuple[PublicRuleV1, ...] = Field(max_length=6)

    @model_validator(mode="after")
    def items_are_unique(self) -> StrategySummaryV1:
        items = (*self.core_strategies, *self.methods, *self.risk_management)
        if not items:
            raise ValueError("strategy summary must contain at least one item")
        if not summary_items_are_distinct(items):
            raise ValueError("strategy summary items must be unique")
        return self


class PublicBilibiliNoteResultV3(StrictModel):
    """Research-agent-facing projection; internal trace data never crosses this boundary."""

    schema_id: Literal["bilibili-note.result/v3"] = Field(alias="schema")
    rendered_markdown: str = Field(min_length=1, max_length=65_536)


class PublicBilibiliSearchResultV1(StrictModel):
    """Search-facing projection containing one deterministic strategy aggregation."""

    schema_id: Literal["bilibili-note.search-result/v1"] = Field(alias="schema")
    rendered_markdown: str = Field(min_length=1, max_length=262_144)


class ErrorV1(StrictModel):
    schema_id: Literal["bilibili-note.error/v1"] = Field(alias="schema")
    maturity: Literal["current_poc"]
    code: FailureCode
    reason: str = Field(pattern=r"^[a-z0-9_]{1,80}$")


SuccessOrErrorV3 = PublicBilibiliNoteResultV3 | ErrorV1
