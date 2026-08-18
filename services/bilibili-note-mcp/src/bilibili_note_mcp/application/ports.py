from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from bilibili_note_mcp.domain.models import (
    PublicRuleV1,
    SearchCandidateV1,
    SourceV1,
    StrategySummaryV1,
    TranscriptMethod,
)

from .progress import ProgressReporter

MATERIAL_CONDITION_CLASSES: tuple[str, ...] = (
    "symbol or instrument",
    "timeframe",
    "market regime or context",
    "volatility",
    "liquidity",
    "trading session",
    "level",
    "threshold",
    "indicator",
    "confirmation",
    "exception",
    "invalidation",
)


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


@dataclass(frozen=True, slots=True)
class AcquiredSource:
    source: SourceV1
    media_path: Path
    transcript: TranscriptResult
    source_snapshot_ref: str


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
class CandidateVisual:
    disposition: Literal["supports_rule", "no_material_increment"]
    rule_index: int | None
    evidence_basis: Literal["static_frame", "ordered_relation"] | None


@dataclass(frozen=True, slots=True)
class DistillCandidate:
    core_strategies: tuple[tuple[PublicRuleV1, tuple[str, ...]], ...]
    methods: tuple[tuple[PublicRuleV1, tuple[str, ...]], ...]
    risk_management: tuple[tuple[PublicRuleV1, tuple[str, ...]], ...]
    visuals: tuple[CandidateVisual, ...]
    model_ref: str
    profile_material_refs: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CandidateRuleVerdict:
    item_index: int
    intelligible: Literal["accept", "reject"]
    source_resolvable: Literal["accept", "reject"]
    entailed_no_new_claim: Literal["accept", "reject"]
    polarity_preserved: Literal["accept", "reject"]
    material_conditions_preserved: Literal["accept", "reject"]
    reusable_abstraction_acceptable: Literal["accept", "reject"]
    simplified_chinese_language: Literal["accept", "reject"]
    classified_category: Literal["core_strategy", "method", "risk_management"]


@dataclass(frozen=True, slots=True)
class CandidateVisualVerdict:
    group_index: int
    rule_index: int | None
    materiality: Literal["material", "no_material"]
    independent_support: Literal["accept", "reject", "not_applicable"]
    rule_relation: Literal["none", "ordered"]
    speech_authorized: Literal["accept", "reject", "not_applicable"]
    same_visual_context: Literal["accept", "reject", "not_applicable"]
    ordered_relation_support: Literal["accept", "reject", "not_applicable"]


@dataclass(frozen=True, slots=True)
class CandidateVerification:
    source_coverage: Literal["accept", "reject"]
    no_duplicate_or_remaining_mergeable_rule: Literal["accept", "reject"]
    priority_order_acceptable: Literal["accept", "reject"]
    rules: tuple[CandidateRuleVerdict, ...]
    visuals: tuple[CandidateVisualVerdict, ...]


StrategyRuleCategory = Literal["core_strategy", "method", "risk_management"]


@dataclass(frozen=True, slots=True)
class StrategyCatalogItem:
    item_id: str
    category: StrategyRuleCategory
    rule: PublicRuleV1


@dataclass(frozen=True, slots=True)
class StrategySynthesisOutput:
    category: StrategyRuleCategory
    rule: PublicRuleV1
    support_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class StrategySynthesis:
    catalog_ref: str
    outputs: tuple[StrategySynthesisOutput, ...]
    episode_specific_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class StrategySynthesisOutputVerdict:
    output_index: int
    entailed_no_new_claim: Literal["accept", "reject"]
    polarity_preserved: Literal["accept", "reject"]
    material_conditions_preserved: Literal["accept", "reject"]
    reusable_abstraction_acceptable: Literal["accept", "reject"]
    simplified_chinese_language: Literal["accept", "reject"]


@dataclass(frozen=True, slots=True)
class StrategyEpisodeOmissionVerdict:
    item_id: str
    safe_to_omit: Literal["accept", "reject"]


@dataclass(frozen=True, slots=True)
class StrategySynthesisVerification:
    catalog_ref: str
    synthesis_ref: str
    outputs: tuple[StrategySynthesisOutputVerdict, ...]
    episode_specific: tuple[StrategyEpisodeOmissionVerdict, ...]
    complete_coverage: Literal["accept", "reject"]
    category_preservation: Literal["accept", "reject"]
    no_duplicate_or_remaining_mergeable_output: Literal["accept", "reject"]
    priority_order_acceptable: Literal["accept", "reject"]


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
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
    ) -> DistillCandidate: ...


class CandidateVerifierPort(Protocol):
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ) -> CandidateVerification: ...


class StrategySynthesizerPort(Protocol):
    async def synthesize(
        self,
        catalog: tuple[StrategyCatalogItem, ...],
        catalog_ref: str,
    ) -> StrategySynthesis: ...


class StrategySynthesisVerifierPort(Protocol):
    async def verify_synthesis(
        self,
        catalog: tuple[StrategyCatalogItem, ...],
        catalog_ref: str,
        synthesis: StrategySynthesis,
        synthesis_ref: str,
    ) -> StrategySynthesisVerification: ...


class StrategyAggregatorPort(Protocol):
    async def aggregate(
        self,
        subject: str,
        summaries: tuple[StrategySummaryV1, ...],
    ) -> StrategySummaryV1: ...


class StrategySummaryRendererPort(Protocol):
    @property
    def material_ref(self) -> str: ...

    def render(self, summary: StrategySummaryV1) -> str: ...
