from __future__ import annotations

import asyncio
import hashlib
import io
import json
import sys
from dataclasses import replace
from pathlib import Path
from typing import Literal, cast

import httpx
import pytest
from mcp import Client, ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.types import TextContent
from PIL import Image

from bilibili_note_mcp import __main__ as cli_module
from bilibili_note_mcp import mcp_server as mcp_server_module
from bilibili_note_mcp.adapters.bilibili_source import BilibiliSource
from bilibili_note_mcp.adapters.distillers import (
    DeterministicCandidateVerifier,
    DeterministicDistiller,
    SiliconFlowCandidateVerifier,
    SiliconFlowDistiller,
)
from bilibili_note_mcp.adapters.fixture_search import FixtureSearch
from bilibili_note_mcp.adapters.fixture_source import FixtureSource
from bilibili_note_mcp.adapters.media_ffmpeg import FfmpegMedia
from bilibili_note_mcp.adapters.strategy_aggregation import (
    DeterministicStrategyAggregator,
    DeterministicStrategySynthesisVerifier,
    DeterministicStrategySynthesizer,
    SiliconFlowStrategySynthesisVerifier,
    SiliconFlowStrategySynthesizer,
)
from bilibili_note_mcp.application import create_note as create_note_module
from bilibili_note_mcp.application.create_note import CreateBilibiliNote
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import (
    AcquiredSource,
    CandidateVisual,
    DistillCandidate,
    FrameAsset,
    SearchPort,
    StrategyCatalogItem,
    StrategySynthesis,
    StrategySynthesisVerification,
)
from bilibili_note_mcp.application.progress import ProgressReporter, transcription_progress
from bilibili_note_mcp.application.search_notes import SearchAndCreateBilibiliNotes
from bilibili_note_mcp.application.strategy_aggregation import (
    VerifiedStrategySynthesisAggregator,
)
from bilibili_note_mcp.config import ModelProfile
from bilibili_note_mcp.domain.models import PublicRuleV1, SearchCandidateV1, StrategySummaryV1
from bilibili_note_mcp.fixture import FIXTURE_URL, generate_fixture
from bilibili_note_mcp.mcp_server import SEARCH_TOOL_NAME, TOOL_NAME, build_server
from bilibili_note_mcp.presentation.markdown import MarkdownRenderer


def _rule(body: str) -> PublicRuleV1:
    return PublicRuleV1(rule_body=body)


class DuplicateVisualDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(candidate, visuals=(*candidate.visuals, candidate.visuals[0]))


class PublicTextLeakDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        first_rule, first_refs = candidate.core_strategies[0]
        return replace(
            candidate,
            core_strategies=(
                (_rule(first_rule.rule_body + " data:image/png;base64,QUFBQUFB"), first_refs),
            ),
        )


class PublicTradeDirectiveDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        refs = candidate.core_strategies[0][1]
        return replace(
            candidate,
            core_strategies=((_rule("交易规则：立即买入比特币并设置止损。"), refs),),
            methods=((_rule("做多比特币并把止损设在前低下方。"), refs),),
            risk_management=((_rule("跌破前低后立即止损。"), refs),),
        )


class PublicAttributionDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.core_strategies[0]
        return replace(
            candidate,
            core_strategies=((_rule("主播表示这里直接做多比特币。"), refs),),
        )


class PrivateRuleLeakDistiller:
    def __init__(self, leaked_rule: str) -> None:
        self._leaked_rule = leaked_rule

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.core_strategies[0]
        return replace(
            candidate,
            core_strategies=((_rule(self._leaked_rule), refs),),
        )


class ResidualModalDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.core_strategies[0]
        return replace(
            candidate,
            core_strategies=((_rule("支撑阻力位应视为价格博弈的区域。"), refs),),
        )


class TechnicalComparisonDistiller:
    def __init__(
        self,
        comparison: str = "当 EMA5 < EMA20 > EMA60 时，保持观望并等待结构确认。",
    ) -> None:
        self._comparison = comparison

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.core_strategies[0]
        return replace(
            candidate,
            core_strategies=((_rule(self._comparison), refs),),
        )


class PrivateCatalogLeakAggregator:
    def __init__(self, leaked_rule: str) -> None:
        self._leaked_rule = leaked_rule

    async def aggregate(
        self, subject: str, summaries: tuple[StrategySummaryV1, ...]
    ) -> StrategySummaryV1:
        del summaries
        return StrategySummaryV1(
            subject=subject,
            core_strategies=(_rule(self._leaked_rule),),
            methods=(_rule("等待关键位置确认后参与。"),),
            risk_management=(_rule("失效后退出并控制风险。"),),
        )


class OrderedSpeechMismatchDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        del source, frames
        return DistillCandidate(
            core_strategies=((_rule("主要趋势决定方向偏好。"), ("E001",)),),
            methods=((_rule("从起点到终点的变化用于确认参与条件。"), ("E001",)),),
            risk_management=((_rule("结构失效后退出并控制风险。"), ("E003",)),),
            visuals=(
                CandidateVisual(
                    disposition="supports_rule",
                    rule_index=1,
                    evidence_basis="ordered_relation",
                ),
                CandidateVisual(
                    disposition="no_material_increment",
                    rule_index=None,
                    evidence_basis=None,
                ),
            ),
            model_ref="fixture:model",
            profile_material_refs=(),
        )


def _provider_profile() -> ModelProfile:
    return ModelProfile(
        provider="siliconflow",
        base_url="https://example.invalid/v1",
        vision_model="test-vision",
        asr_model="test-asr",
        api_key_env="TEST_MCP_PROVIDER_KEY",
        timeout_seconds=1,
        max_output_tokens=100,
    )


class ClosedEvidenceMaturityDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.methods[0]
        return replace(
            candidate,
            methods=(
                (
                    _rule(
                        "根据品种属性调整指标参数，例如在黄金交易中，"
                        "MA40与MA20的参数组合被验证为具有较强共性。"
                    ),
                    refs,
                ),
            ),
        )


class ResidualEvidenceMaturityDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.methods[0]
        return replace(candidate, methods=((_rule("回测结果表明该方法稳定。"), refs),))


class NeutralizationCollisionDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        refs = candidate.methods[0][1]
        return replace(
            candidate,
            methods=(
                (_rule("参数组合被验证为具有共性。"), refs),
                (_rule("参数组合具有共性这一假设仍待独立验证。"), refs),
            ),
        )


class ResidualEvidenceMaturityRenderer:
    @property
    def material_ref(self) -> str:
        return MarkdownRenderer().material_ref

    def render(self, summary: StrategySummaryV1) -> str:
        return (
            "# 交易思想与策略总结\n\n"
            "## 核心策略\n\n- 回测结果表明该方法稳定。\n\n"
            "## 具体方法\n\n- 等待价格确认。\n\n"
            "## 风险管理\n\n- 参数仍待独立验证。\n"
        )


class VisualModalityDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(
            candidate,
            methods=(
                (
                    _rule("方法上：画面显示价格处于压力线下方。"),
                    candidate.methods[0][1],
                ),
            ),
        )


class RejectingCandidateVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        return replace(
            verification,
            rules=(
                replace(verification.rules[0], intelligible="reject"),
                *verification.rules[1:],
            ),
        )


class RejectingVisualVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        return replace(
            verification,
            visuals=(
                replace(verification.visuals[0], independent_support="reject"),
                *verification.visuals[1:],
            ),
        )


class RejectingSourceCoverageVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        return replace(verification, source_coverage="reject")


class DirectSemanticCounterexampleDistiller:
    def __init__(
        self,
        mutation: Literal[
            "paraphrased_duplicate",
            "reversed_priority",
            "polarity_inversion",
            "dropped_material_conditions",
        ],
    ) -> None:
        self._mutation = mutation

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        if self._mutation == "paraphrased_duplicate":
            _, refs = candidate.methods[0]
            return replace(
                candidate,
                methods=(
                    *candidate.methods,
                    (_rule("用价格相对关键线的位置来判断当前结构。"), refs),
                ),
            )
        if self._mutation == "reversed_priority":
            return replace(
                candidate,
                core_strategies=tuple(reversed(candidate.core_strategies)),
            )
        _, refs = candidate.methods[0]
        if self._mutation == "polarity_inversion":
            return replace(
                candidate,
                methods=((_rule("价格与关键线的相对位置不得用于确认结构。"), refs),),
            )
        return replace(
            candidate,
            methods=((_rule("价格变化后参与。"), refs), *candidate.methods[1:]),
        )


class RejectingDirectSemanticVerifier:
    def __init__(
        self,
        mutation: Literal[
            "paraphrased_duplicate",
            "reversed_priority",
            "polarity_inversion",
            "dropped_material_conditions",
        ],
    ) -> None:
        self._mutation = mutation

    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        if self._mutation == "paraphrased_duplicate":
            return replace(verification, no_duplicate_or_remaining_mergeable_rule="reject")
        if self._mutation == "reversed_priority":
            return replace(verification, priority_order_acceptable="reject")
        target_index = len(candidate.core_strategies)
        target = verification.rules[target_index]
        rejected = (
            replace(target, polarity_preserved="reject")
            if self._mutation == "polarity_inversion"
            else replace(target, material_conditions_preserved="reject")
        )
        return replace(
            verification,
            rules=(
                *verification.rules[:target_index],
                rejected,
                *verification.rules[target_index + 1 :],
            ),
        )


_MATERIAL_CONDITION_COUNTEREXAMPLES: dict[str, str] = {
    "symbol or instrument": "仅在4小时趋势向上时参与。",
    "timeframe": "仅在BTC趋势向上时参与。",
    "market regime or context": "沿当前方向参与。",
    "volatility": "等待突破。",
    "liquidity": "跟随突破。",
    "trading session": "等待突破。",
    "level": "价格回踩后参与。",
    "threshold": "价格上涨后参与。",
    "indicator": "趋势向上时寻找机会。",
    "confirmation": "价格触及后参与。",
    "exception": "突破后参与。",
    "invalidation": "价格回落时退出。",
}


class MaterialConditionCounterexampleDistiller:
    def __init__(self, condition_class: str) -> None:
        self._condition_class = condition_class

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.methods[0]
        return replace(
            candidate,
            methods=((_rule(_MATERIAL_CONDITION_COUNTEREXAMPLES[self._condition_class]), refs),),
        )


class RejectingDirectMaterialConditionVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        target_index = len(candidate.core_strategies)
        return replace(
            verification,
            rules=(
                *verification.rules[:target_index],
                replace(
                    verification.rules[target_index],
                    material_conditions_preserved="reject",
                ),
                *verification.rules[target_index + 1 :],
            ),
        )


class MixedEnglishCounterexampleDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        _, refs = candidate.core_strategies[0]
        return replace(
            candidate,
            core_strategies=(
                (_rule("核心原则：Follow the market trend and wait for confirmation."), refs),
            ),
        )


class RejectingDirectLanguageVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        return replace(
            verification,
            rules=(
                replace(verification.rules[0], simplified_chinese_language="reject"),
                *verification.rules[1:],
            ),
        )


class RejectingSearchSemanticVerifier(DeterministicStrategySynthesisVerifier):
    def __init__(self, verdict: Literal["material", "language"]) -> None:
        self._verdict = verdict

    async def verify_synthesis(
        self,
        catalog: tuple[StrategyCatalogItem, ...],
        catalog_ref: str,
        synthesis: StrategySynthesis,
        synthesis_ref: str,
    ) -> StrategySynthesisVerification:
        verification = await super().verify_synthesis(
            catalog, catalog_ref, synthesis, synthesis_ref
        )
        first = verification.outputs[0]
        rejected = (
            replace(first, material_conditions_preserved="reject")
            if self._verdict == "material"
            else replace(first, simplified_chinese_language="reject")
        )
        return replace(verification, outputs=(rejected, *verification.outputs[1:]))


class RejectingCategoryVerifier:
    def __init__(
        self,
        item_index: int = 0,
        classified_category: Literal["core_strategy", "method", "risk_management"] = "method",
    ) -> None:
        self._item_index = item_index
        self._classified_category = classified_category

    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        return replace(
            verification,
            rules=(
                *verification.rules[: self._item_index],
                replace(
                    verification.rules[self._item_index],
                    classified_category=self._classified_category,
                ),
                *verification.rules[self._item_index + 1 :],
            ),
        )


class DetectingOmittedVisualMaterialVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        assert candidate.visuals[1].disposition == "no_material_increment"
        return replace(
            verification,
            visuals=(
                verification.visuals[0],
                replace(verification.visuals[1], materiality="material"),
                *verification.visuals[2:],
            ),
        )


class ReorderedCandidateVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        return replace(
            verification,
            rules=(replace(verification.rules[0], item_index=1), *verification.rules[1:]),
        )


class SlowCandidateVerifier:
    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        await asyncio.sleep(0.055)
        return await DeterministicCandidateVerifier().verify(source, frames, candidate)


class CountingDistiller:
    def __init__(self) -> None:
        self.calls = 0

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        self.calls += 1
        return await DeterministicDistiller().distill(source, frames)


class TooManyRulesDistiller:
    def __init__(self, category: Literal["core", "method", "risk"]) -> None:
        self._category = category

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        limits = {"core": 10, "method": 10, "risk": 7}
        attribute = {
            "core": "core_strategies",
            "method": "methods",
            "risk": "risk_management",
        }[self._category]
        existing = getattr(candidate, attribute)
        refs = existing[0][1]
        expanded = tuple(
            (_rule(f"超额规则 {self._category} {index}。"), refs)
            for index in range(limits[self._category])
        )
        return replace(candidate, **{attribute: expanded})


class CountingCandidateVerifier:
    def __init__(self, *, reject: bool = False) -> None:
        self.calls = 0
        self._reject = reject

    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ):
        self.calls += 1
        verification = await DeterministicCandidateVerifier().verify(source, frames, candidate)
        if not self._reject:
            return verification
        return replace(
            verification,
            rules=(
                replace(verification.rules[0], source_resolvable="reject"),
                *verification.rules[1:],
            ),
        )


def _png(color: str) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (1280, 720), color).save(output, format="PNG")
    return output.getvalue()


class ThreeEvidenceMedia:
    async def extract_frames(
        self, source: AcquiredSource, workspace: Path
    ) -> tuple[FrameAsset, ...]:
        values = []
        for index, (timestamp, evidence_id, color) in enumerate(
            ((1000, "E001", "red"), (3000, "E002", "green")),
            start=1,
        ):
            png = _png(color)
            values.append(
                FrameAsset(
                    frame_id=f"F{index:02d}",
                    group_id=f"G{index:02d}",
                    timestamp_ms=timestamp,
                    width=1280,
                    height=720,
                    png_bytes=png,
                    asset_ref=hashlib.sha256(png).hexdigest(),
                    transcript_refs=(evidence_id,),
                    selection_reason="deictic_cue",
                )
            )
        return tuple(values)


class OrderedSpeechMismatchMedia:
    async def extract_frames(
        self, source: AcquiredSource, workspace: Path
    ) -> tuple[FrameAsset, ...]:
        del source, workspace
        values = []
        for index, (group_id, timestamp, evidence_id, reason, color) in enumerate(
            (
                ("G01", 2200, "E002", "ordered_relation_cue", "red"),
                ("G01", 3000, "E002", "ordered_relation_cue", "green"),
                ("G01", 3800, "E002", "ordered_relation_cue", "blue"),
                ("G02", 5000, "E003", "coverage", "yellow"),
            ),
            start=1,
        ):
            png = _png(color)
            values.append(
                FrameAsset(
                    frame_id=f"F{index:02d}",
                    group_id=group_id,
                    timestamp_ms=timestamp,
                    width=1280,
                    height=720,
                    png_bytes=png,
                    asset_ref=hashlib.sha256(png).hexdigest(),
                    transcript_refs=(evidence_id,),
                    selection_reason=cast(
                        Literal[
                            "deictic_cue",
                            "visual_activity",
                            "ordered_relation_cue",
                            "coverage",
                        ],
                        reason,
                    ),
                )
            )
        return tuple(values)


class DelayedTranscriptSource:
    def __init__(self, fixture: Path) -> None:
        self._delegate = FixtureSource(fixture)

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        acquired = await self._delegate.acquire(url, workspace, progress)
        await progress.report(transcription_progress(1, 2))
        await asyncio.sleep(0.035)
        return acquired


class BlockingSource:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        self.started.set()
        try:
            await asyncio.Event().wait()
        finally:
            self.cancelled.set()
        raise AssertionError("unreachable")


class SlowCleanupSource:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cleanup_started = asyncio.Event()
        self.allow_cleanup = asyncio.Event()
        self.cleanup_terminal = asyncio.Event()

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        del url, workspace, progress
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cleanup_started.set()
            try:
                await self.allow_cleanup.wait()
            finally:
                self.cleanup_terminal.set()
            raise


class BoundaryFailureSource:
    def __init__(self, reason: str) -> None:
        self.reason = reason
        self.calls = 0

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        del url, workspace, progress
        self.calls += 1
        raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", self.reason)


class NeverMedia:
    def __init__(self) -> None:
        self.calls = 0

    async def extract_frames(
        self, source: AcquiredSource, workspace: Path
    ) -> tuple[FrameAsset, ...]:
        del source, workspace
        self.calls += 1
        raise AssertionError("media must not run after source-boundary rejection")


class CoerciveMetadataHttp:
    async def get_json(self, url: str, *, headers: object = None) -> dict[str, object]:
        del url, headers
        return {
            "code": False,
            "data": {
                "bvid": "BV1bK411W797",
                "title": 123,
                "pubdate": "1786320000",
                "owner": {"name": 456},
                "pages": [
                    {
                        "cid": "40765885910",
                        "page": True,
                        "duration": "6",
                        "dimension": {"width": "1920", "height": "1080"},
                    }
                ],
            },
        }


class NeverSourceDownload:
    def __init__(self) -> None:
        self.calls = 0

    async def download(self, canonical_url: str, workspace: Path) -> object:
        del canonical_url, workspace
        self.calls += 1
        raise AssertionError("source media must not run after metadata rejection")


class NeverTranscript:
    def __init__(self) -> None:
        self.calls = 0

    async def transcribe(self, *args: object, **kwargs: object) -> object:
        del args, kwargs
        self.calls += 1
        raise AssertionError("ASR must not run after metadata rejection")


class AuthorOverrideSource:
    def __init__(self, fixture: Path, author_name: str) -> None:
        self._delegate = FixtureSource(fixture)
        self._author_name = author_name

    async def acquire(
        self, url: str, workspace: Path, progress: ProgressReporter
    ) -> AcquiredSource:
        acquired = await self._delegate.acquire(url, workspace, progress)
        return replace(
            acquired,
            source=acquired.source.model_copy(update={"author_name": self._author_name}),
        )


class TwoCandidateSearch:
    def __init__(self) -> None:
        self.candidates = (
            SearchCandidateV1(
                video_id="BV1bK411W797",
                title="候选 1",
                canonical_url=FIXTURE_URL,
            ),
            SearchCandidateV1(
                video_id="BV1uHuQ6pEFr",
                title="候选 2",
                canonical_url="https://www.bilibili.com/video/BV1uHuQ6pEFr?p=1",
            ),
        )

    async def search(self, query: str, limit: int) -> tuple[SearchCandidateV1, ...]:
        return self.candidates


class PrivateTitleSearch:
    async def search(self, query: str, limit: int) -> tuple[SearchCandidateV1, ...]:
        del query, limit
        return (
            SearchCandidateV1(
                video_id="BV1bK411W797",
                title="趋势策略 S01:C01",
                canonical_url=FIXTURE_URL,
            ),
        )


class DifferingSubjectCreate:
    def __init__(self, candidates: tuple[SearchCandidateV1, ...]) -> None:
        self._subject_by_url = {
            candidate.canonical_url: f"作者{index}"
            for index, candidate in enumerate(candidates, start=1)
        }

    async def execute(self, url: str, progress: ProgressReporter | None = None) -> object:
        if progress is not None:
            await progress.report(transcription_progress(1, 1))
        return type(
            "Payload",
            (),
            {
                "summary": StrategySummaryV1(
                    subject=self._subject_by_url[url],
                    core_strategies=(_rule("主要趋势决定方向偏好。"),),
                    methods=(_rule("等待关键位置确认后参与。"),),
                    risk_management=(_rule("结构失效后退出并控制风险。"),),
                )
            },
        )()


class OneSuccessCreate:
    def __init__(self, delegate: CreateBilibiliNote) -> None:
        self._delegate = delegate

    async def execute(self, url: str, progress: ProgressReporter | None = None) -> object:
        if url != FIXTURE_URL:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "fixture_candidate_failed")
        return await self._delegate.execute(url, progress)


class FrameOnlyVisualDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(
            candidate,
            methods=(
                (_rule("两个独立视觉时刻共同支持同一结构确认条件。"), candidate.methods[0][1]),
            ),
            visuals=(
                CandidateVisual(
                    disposition="supports_rule",
                    rule_index=2,
                    evidence_basis="static_frame",
                ),
                CandidateVisual(
                    disposition="supports_rule",
                    rule_index=2,
                    evidence_basis="static_frame",
                ),
            ),
        )


class LongOpposingRulesDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        refs = candidate.methods[0][1]
        return replace(
            candidate,
            methods=(
                (_rule("价格跌破关键前低时必须立即止损并且不得继续持有该仓位。"), refs),
                (_rule("价格跌破关键前低时不必立即止损并且仍可继续持有该仓位。"), refs),
            ),
            visuals=tuple(
                replace(
                    item,
                    rule_index=(2 if item.disposition == "supports_rule" else None),
                )
                for item in candidate.visuals
            ),
        )


def _use_case(
    fixture: Path,
    distiller: object | None = None,
    verifier: object | None = None,
) -> CreateBilibiliNote:
    return CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=distiller or DeterministicDistiller(),  # type: ignore[arg-type]
        verifier=verifier or DeterministicCandidateVerifier(),  # type: ignore[arg-type]
        renderer=MarkdownRenderer(),
    )


def _server(use_case: CreateBilibiliNote):
    return build_server(
        use_case,
        SearchAndCreateBilibiliNotes(
            search=FixtureSearch(),
            create_note=use_case,
            aggregator=DeterministicStrategyAggregator(),
            renderer=MarkdownRenderer(),
        ),
    )


@pytest.mark.parametrize("category", ["core", "method", "risk"])
async def test_direct_candidate_rule_counts_remain_single_source_bounded(
    tmp_path: Path,
    category: Literal["core", "method", "risk"],
) -> None:
    fixture = generate_fixture(tmp_path / category)
    verifier = CountingCandidateVerifier()

    with pytest.raises(BilibiliNoteFailure) as failure:
        await _use_case(
            fixture,
            distiller=TooManyRulesDistiller(category),
            verifier=verifier,
        ).execute(FIXTURE_URL)

    assert failure.value.reason == "model_rule_counts_invalid"
    assert verifier.calls == 0


async def test_client_receives_one_text_block_and_no_images(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    server = _server(_use_case(fixture))
    async with Client(server) as client:
        listed = await client.list_tools()
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert [tool.name for tool in listed.tools] == [
        "bilibili_note.create",
        "bilibili_note.search_and_create",
    ]
    assert [
        branch["properties"]["schema"]["const"] for branch in listed.tools[0].output_schema["oneOf"]
    ] == ["bilibili-note.result/v3", "bilibili-note.error/v1"]
    assert result.is_error is False
    assert result.structured_content == {
        "schema": "bilibili-note.result/v3",
        "rendered_markdown": result.content[0].text,
    }
    assert len(result.content) == 1
    assert isinstance(result.content[0], TextContent)
    for noise in ("E001", "V01", "证据时间轴", "Provenance", "brief_ref", "画面补足的信息"):
        assert noise not in result.content[0].text
    assert result.content[0].annotations.audience == ["user"]


async def test_operator_request_scope_starts_only_after_valid_arguments(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    monkeypatch.setattr("bilibili_note_mcp.application.operator_events.os.write", write)
    async with Client(_server(_use_case(fixture))) as client:
        invalid = await client.call_tool(TOOL_NAME, {})
        assert records == []
        valid = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert invalid.is_error is True
    assert valid.is_error is False
    assert [record["event"] for record in records] == [
        "request_started",
        "request_completed",
    ]
    assert len({record["run_id"] for record in records}) == 1
    assert len({record["input_ref"] for record in records}) == 1


async def test_progress_reports_real_monotonic_artifacts(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[tuple[float, str | None]] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        assert total == 100
        observed.append((progress, message))

    async with Client(_server(_use_case(fixture))) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture)

    assert result.is_error is False
    assert [item[0] for item in observed] == [5, 25, 50, 65, 75, 89]
    assert observed[-1][1] == "文字 brief 与证据合同已校验，正在封装返回"


async def test_success_invokes_exactly_one_author_and_one_verifier(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    distiller = CountingDistiller()
    verifier = CountingCandidateVerifier()

    async with Client(
        _server(_use_case(fixture, distiller=distiller, verifier=verifier))
    ) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is False
    assert distiller.calls == 1
    assert verifier.calls == 1


def test_live_runtime_uses_source_aware_semantic_model_verifier() -> None:
    use_case = cli_module._use_case(None, deterministic=False)

    assert isinstance(use_case._distiller, SiliconFlowDistiller)
    assert isinstance(use_case._verifier, SiliconFlowCandidateVerifier)


async def test_verifier_rejection_is_not_retried_or_reauthored(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    distiller = CountingDistiller()
    verifier = CountingCandidateVerifier(reject=True)

    async with Client(
        _server(_use_case(fixture, distiller=distiller, verifier=verifier))
    ) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is True
    assert result.structured_content["reason"] == "candidate_semantics_rejected"
    assert distiller.calls == 1
    assert verifier.calls == 1


@pytest.mark.parametrize(
    ("verifier", "reason"),
    (
        (RejectingCandidateVerifier(), "candidate_semantics_rejected"),
        (RejectingVisualVerifier(), "visual_support_rejected"),
        (RejectingSourceCoverageVerifier(), "candidate_semantics_rejected"),
        (RejectingCategoryVerifier(0, "method"), "candidate_semantics_rejected"),
        (RejectingCategoryVerifier(0, "risk_management"), "candidate_semantics_rejected"),
        (RejectingCategoryVerifier(2, "core_strategy"), "candidate_semantics_rejected"),
        (RejectingCategoryVerifier(2, "risk_management"), "candidate_semantics_rejected"),
        (RejectingCategoryVerifier(5, "core_strategy"), "candidate_semantics_rejected"),
        (RejectingCategoryVerifier(5, "method"), "candidate_semantics_rejected"),
        (DetectingOmittedVisualMaterialVerifier(), "visual_material_omitted"),
        (ReorderedCandidateVerifier(), "verifier_response_invalid"),
    ),
)
async def test_verifier_rejection_never_crosses_analysis_or_terminal_progress(
    tmp_path: Path,
    verifier: object,
    reason: str,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        assert total == 100
        observed.append(progress)

    async with Client(_server(_use_case(fixture, verifier=verifier))) as client:
        result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content["reason"] == reason
    assert observed == [5, 25, 50, 65]
    assert 75 not in observed and 89 not in observed and 100 not in observed


@pytest.mark.parametrize(
    "mutation",
    (
        "paraphrased_duplicate",
        "reversed_priority",
        "polarity_inversion",
        "dropped_material_conditions",
    ),
)
async def test_direct_semantic_counterexamples_never_publish_note_or_terminal_progress(
    tmp_path: Path,
    mutation: Literal[
        "paraphrased_duplicate",
        "reversed_priority",
        "polarity_inversion",
        "dropped_material_conditions",
    ],
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del message
        assert total == 100
        observed.append(progress)

    async with Client(
        _server(
            _use_case(
                fixture,
                distiller=DirectSemanticCounterexampleDistiller(mutation),
                verifier=RejectingDirectSemanticVerifier(mutation),
            )
        )
    ) as client:
        result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content["reason"] == "candidate_semantics_rejected"
    assert observed == [5, 25, 50, 65]
    assert 75 not in observed and 89 not in observed and 100 not in observed
    assert "## 核心策略" not in result.content[0].text
    assert len(result.content) == 1


@pytest.mark.parametrize("condition_class", tuple(_MATERIAL_CONDITION_COUNTEREXAMPLES))
async def test_every_material_condition_counterexample_stops_direct_and_search_before_note(
    tmp_path: Path,
    condition_class: str,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(
        fixture,
        distiller=MaterialConditionCounterexampleDistiller(condition_class),
        verifier=RejectingDirectMaterialConditionVerifier(),
    )
    search = SearchAndCreateBilibiliNotes(
        search=FixtureSearch(),
        create_note=_use_case(fixture),
        aggregator=VerifiedStrategySynthesisAggregator(
            DeterministicStrategySynthesizer(),
            RejectingSearchSemanticVerifier("material"),
        ),
        renderer=MarkdownRenderer(),
    )
    observed_direct: list[float] = []
    observed_search: list[float] = []

    async def capture_direct(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed_direct.append(progress)

    async def capture_search(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed_search.append(progress)

    async with Client(build_server(direct, search)) as client:
        direct_result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture_direct,
        )
        search_result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": condition_class, "max_videos": 1},
            progress_callback=capture_search,
        )

    assert direct_result.is_error is True
    assert direct_result.structured_content["reason"] == "candidate_semantics_rejected"
    assert observed_direct == [5, 25, 50, 65]
    assert search_result.is_error is True
    assert search_result.structured_content["reason"] == "strategy_aggregation_semantics_rejected"
    assert 89 not in observed_search and 100 not in observed_search
    for result in (direct_result, search_result):
        assert "## 核心策略" not in result.content[0].text
        assert len(result.content) == 1


async def test_mixed_english_prose_stops_direct_and_search_before_note(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(
        fixture,
        distiller=MixedEnglishCounterexampleDistiller(),
        verifier=RejectingDirectLanguageVerifier(),
    )
    search = SearchAndCreateBilibiliNotes(
        search=FixtureSearch(),
        create_note=_use_case(fixture),
        aggregator=VerifiedStrategySynthesisAggregator(
            DeterministicStrategySynthesizer(),
            RejectingSearchSemanticVerifier("language"),
        ),
        renderer=MarkdownRenderer(),
    )
    observed_direct: list[float] = []
    observed_search: list[float] = []

    async def capture_direct(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed_direct.append(progress)

    async def capture_search(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed_search.append(progress)

    async with Client(build_server(direct, search)) as client:
        direct_result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture_direct,
        )
        search_result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture_search,
        )

    assert direct_result.is_error is True
    assert direct_result.structured_content["reason"] == "candidate_semantics_rejected"
    assert observed_direct == [5, 25, 50, 65]
    assert search_result.is_error is True
    assert search_result.structured_content["reason"] == "strategy_aggregation_semantics_rejected"
    assert 89 not in observed_search and 100 not in observed_search
    for result in (direct_result, search_result):
        assert "Follow the market" not in result.content[0].text
        assert "## 核心策略" not in result.content[0].text


async def test_slow_verifier_keeps_liveness_capped_below_analysis_ready(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[float] = []
    monkeypatch.setattr(create_note_module, "_VISUAL_HEARTBEAT_SECONDS", 0.01)

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        assert total == 100
        observed.append(progress)

    async with Client(_server(_use_case(fixture, verifier=SlowCandidateVerifier()))) as client:
        result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture,
        )

    assert result.is_error is False
    heartbeat = [value for value in observed if 65 < value < 75]
    assert heartbeat
    assert heartbeat == sorted(heartbeat)
    assert max(heartbeat) <= 74
    assert observed[-2:] == [75, 89]


async def test_mcp_client_cancellation_reaches_active_source_before_return() -> None:
    source = BlockingSource()
    use_case = CreateBilibiliNote(
        source=source,
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )

    async with Client(_server(use_case)) as client:
        call = asyncio.create_task(client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}))
        await asyncio.wait_for(source.started.wait(), timeout=1)
        call.cancel()
        result = await call
        await asyncio.wait_for(source.cancelled.wait(), timeout=1)

    assert result.is_error is True
    assert result.structured_content["code"] == "CANCELLED"
    assert result.structured_content["reason"] == "request_cancelled"


async def test_repeated_mcp_cancellation_waits_for_cleanup_and_emits_one_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    source = SlowCleanupSource()
    use_case = CreateBilibiliNote(
        source=source,
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )
    monkeypatch.setattr("bilibili_note_mcp.application.operator_events.os.write", write)

    async with Client(_server(use_case)) as client:
        call = asyncio.create_task(client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}))
        await asyncio.wait_for(source.started.wait(), timeout=1)
        call.cancel("first")
        await asyncio.wait_for(source.cleanup_started.wait(), timeout=1)
        call.cancel("second")
        await asyncio.sleep(0)
        assert not call.done()
        assert not source.cleanup_terminal.is_set()
        source.allow_cleanup.set()
        result = await call

    assert source.cleanup_terminal.is_set()
    assert result.is_error is True
    assert result.structured_content["code"] == "CANCELLED"
    assert [record["event"] for record in records] == ["request_started", "request_cancelled"]


async def test_search_tool_returns_one_pure_strategy_summary(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        assert total == 100
        observed.append(progress)

    async with Client(_server(_use_case(fixture))) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture,
        )

    assert result.is_error is False
    assert result.structured_content == {
        "schema": "bilibili-note.search-result/v1",
        "rendered_markdown": result.content[0].text,
    }
    assert "## 核心策略" in result.content[0].text
    assert "## 具体方法" in result.content[0].text
    assert "## 风险管理" in result.content[0].text
    assert "## 候选视频" not in result.content[0].text
    assert FIXTURE_URL not in result.content[0].text
    assert "## 解析结果" not in result.content[0].text
    assert observed[:2] == [5, 10]
    assert observed == sorted(observed)
    assert observed[-1] == 89
    assert 90 not in observed
    assert 100 not in observed


async def test_search_tool_never_returns_100_or_note_for_one_of_two_successes(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture)
    create = OneSuccessCreate(direct)
    search = SearchAndCreateBilibiliNotes(
        search=cast(SearchPort, TwoCandidateSearch()),
        create_note=cast(CreateBilibiliNote, create),
        aggregator=DeterministicStrategyAggregator(),
        renderer=MarkdownRenderer(),
    )
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        observed.append(progress)

    async with Client(build_server(direct, search)) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 2},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content["code"] == "SEARCH_TARGET_UNMET"
    assert result.structured_content["reason"] == "search_success_target_unmet"
    assert 90 not in observed
    assert 100 not in observed


async def test_delayed_transcription_heartbeat_never_regresses_direct_or_search(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    monkeypatch.setattr(create_note_module, "_VISUAL_HEARTBEAT_SECONDS", 0.01)
    use_case = CreateBilibiliNote(
        source=DelayedTranscriptSource(fixture),
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )
    observed_direct: list[float] = []
    observed_search: list[float] = []

    async def direct_capture(progress: float, total: float | None, message: str | None) -> None:
        observed_direct.append(progress)

    async def search_capture(progress: float, total: float | None, message: str | None) -> None:
        observed_search.append(progress)

    async with Client(_server(use_case)) as client:
        direct = await client.call_tool(
            TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=direct_capture
        )
        searched = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=search_capture,
        )

    assert direct.is_error is False
    assert searched.is_error is False
    assert observed_direct == sorted(observed_direct)
    assert observed_search == sorted(observed_search)
    assert 37 in observed_direct
    assert 5 not in observed_direct[observed_direct.index(25) + 1 :]


async def test_search_mcp_progress_never_exposes_untrusted_candidate_title(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture)
    search = SearchAndCreateBilibiliNotes(
        search=cast(SearchPort, PrivateTitleSearch()),
        create_note=direct,
        aggregator=DeterministicStrategyAggregator(),
        renderer=MarkdownRenderer(),
    )
    messages: list[str] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del progress, total
        if message is not None:
            messages.append(message)

    async with Client(build_server(direct, search)) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture,
        )

    assert result.is_error is False
    assert any("正在解析候选 1/1" in message for message in messages)
    assert all("趋势策略 S01:C01" not in message for message in messages)
    assert all("S01:C01" not in message for message in messages)


@pytest.mark.parametrize(
    "author_name",
    (
        "E001",
        "E\u034f001",
        "E\ufe0f001",
        "趋势 E 0&Tab;0 1",
        "E\u16800\u16800\u16801",
        "趋势 E&NewLine;0&#10;0&#13;1",
    ),
)
async def test_direct_author_name_that_collides_with_private_id_uses_host_subject(
    tmp_path: Path, author_name: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = CreateBilibiliNote(
        source=AuthorOverrideSource(fixture, author_name),
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )

    async with Client(_server(direct)) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is False
    assert result.content[0].text.startswith("# 视频：交易思想与策略总结\n")
    assert author_name not in result.content[0].text


@pytest.mark.parametrize(
    ("author_name", "expected_subject"),
    (
        ("Follow the market trend and wait for confirmation", "视频"),
        ("Follow The Market Trend", "视频"),
        ("罗尼 Follow the market trend", "视频"),
        ("price", "视频"),
        ("Rony Trading", "Rony Trading"),
        ("BTC + EMA20", "BTC + EMA20"),
        ("TradingView", "TradingView"),
        ("iPhone", "iPhone"),
    ),
)
async def test_direct_public_subject_language_policy_has_mcp_parity(
    tmp_path: Path, author_name: str, expected_subject: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = CreateBilibiliNote(
        source=AuthorOverrideSource(fixture, author_name),
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )

    async with Client(_server(direct)) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is False
    assert result.content[0].text.startswith(f"# {expected_subject}：交易思想与策略总结\n")


@pytest.mark.parametrize(
    "query",
    (
        "F-01 交易策略",
        "F\u034f-01 交易策略",
        "F\ufe0f-01 交易策略",
        "趋势 E 0&Tab;0 1",
        "趋势 S\u16800\u16801\u1680:\u1680C\u16800\u16801",
        "趋势 E&NewLine;0&#10;0&#13;1",
    ),
)
async def test_search_query_that_collides_with_private_id_uses_host_subject(
    tmp_path: Path, query: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture)
    candidate_source = TwoCandidateSearch()
    search = SearchAndCreateBilibiliNotes(
        search=cast(SearchPort, candidate_source),
        create_note=cast(CreateBilibiliNote, DifferingSubjectCreate(candidate_source.candidates)),
        aggregator=DeterministicStrategyAggregator(),
        renderer=MarkdownRenderer(),
    )

    async with Client(build_server(direct, search)) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": query, "max_videos": 2},
        )

    assert result.is_error is False
    assert result.content[0].text.startswith("# 视频：交易思想与策略总结\n")
    assert query not in result.content[0].text


@pytest.mark.parametrize(
    ("query", "expected_subject"),
    (
        ("Follow the market trend and wait for confirmation", "视频"),
        ("Follow The Market Trend", "视频"),
        ("Best Strategy", "视频"),
        ("趋势交易 and wait for confirmation", "视频"),
        ("price", "视频"),
        ("Rony Trading", "视频"),
        ("BTC + EMA20", "视频"),
        ("BTC 趋势交易", "BTC 趋势交易"),
    ),
)
async def test_search_raw_query_uses_same_public_subject_language_policy(
    tmp_path: Path, query: str, expected_subject: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture)
    candidate_source = TwoCandidateSearch()
    search = SearchAndCreateBilibiliNotes(
        search=cast(SearchPort, candidate_source),
        create_note=cast(CreateBilibiliNote, DifferingSubjectCreate(candidate_source.candidates)),
        aggregator=DeterministicStrategyAggregator(),
        renderer=MarkdownRenderer(),
    )

    async with Client(build_server(direct, search)) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": query, "max_videos": 2},
        )

    assert result.is_error is False
    assert result.content[0].text.startswith(f"# {expected_subject}：交易思想与策略总结\n")


async def test_duplicate_visual_frame_binding_fails_closed(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        observed.append(progress)

    async with Client(_server(_use_case(fixture, DuplicateVisualDistiller()))) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture)

    assert result.is_error is True
    assert result.structured_content["reason"] == "model_visual_groups_invalid"
    assert observed == [5, 25, 50, 65]
    assert len(result.content) == 1


async def test_media_like_provider_text_fails_before_analysis_ready(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        observed.append(progress)

    async with Client(_server(_use_case(fixture, PublicTextLeakDistiller()))) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture)

    assert result.is_error is True
    assert result.structured_content["reason"] == "model_public_representation_invalid"
    assert observed == [5, 25, 50, 65]
    assert len(result.content) == 1


async def test_trade_rule_bodies_are_preserved_behind_host_frame_for_direct_and_search(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        observed.append(progress)

    async with Client(_server(_use_case(fixture, PublicTradeDirectiveDistiller()))) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture)
        searched = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
        )

    assert result.is_error is False
    assert observed == [5, 25, 50, 65, 75, 89]
    assert len(result.content) == 1
    assert searched.is_error is False
    assert result.content[0].text == searched.content[0].text
    for output in (result.content[0].text, searched.content[0].text):
        for body in (
            "交易规则：立即买入比特币并设置止损。",
            "做多比特币并把止损设在前低下方。",
            "跌破前低后立即止损。",
        ):
            assert output.count(body) == 1
            assert f"- 规则描述：{body}" in output


async def test_source_attribution_prefix_fails_closed_at_public_mcp(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")

    async with Client(
        _server(
            _use_case(
                fixture,
                PublicAttributionDistiller(),
                RejectingCandidateVerifier(),
            )
        )
    ) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is True
    assert result.structured_content["reason"] == "candidate_semantics_rejected"


async def test_unverified_document_scope_governs_model_maturity_language(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")

    async with Client(_server(_use_case(fixture, ClosedEvidenceMaturityDistiller()))) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is False
    assert result.content[0].text.count("## ") == 3
    assert "来源视频" not in result.content[0].text
    assert "以下内容仅为未验证的交易观点摘要，须另行研究验证。" in result.content[0].text
    assert "MA40与MA20的参数组合被验证为具有较强共性" in result.content[0].text


async def test_unknown_model_maturity_language_is_scoped_without_a_phrase_list(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    async with Client(_server(_use_case(fixture, ResidualEvidenceMaturityDistiller()))) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is False
    assert "回测结果表明该方法稳定" in result.content[0].text
    assert result.content[0].text.index("仅为未验证") < result.content[0].text.index("回测结果")


async def test_renderer_without_host_scope_fails_with_output_error(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    use_case = CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=ResidualEvidenceMaturityRenderer(),
    )

    async with Client(_server(use_case)) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is True
    assert result.structured_content["code"] == "OUTPUT_INVALID"
    assert result.structured_content["reason"] == "unverified_scope_invalid"


async def test_distinct_maturity_phrases_remain_distinct_under_document_scope(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")

    async with Client(_server(_use_case(fixture, NeutralizationCollisionDistiller()))) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})

    assert result.is_error is False
    assert "参数组合被验证为具有共性" in result.content[0].text
    assert "参数组合具有共性这一假设仍待独立验证" in result.content[0].text


async def test_visual_modality_prefix_is_removed_for_direct_and_search_mcp(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")

    async with Client(
        _server(
            _use_case(
                fixture,
                VisualModalityDistiller(),
                RejectingCandidateVerifier(),
            )
        )
    ) as client:
        direct = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})
        searched = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
        )

    assert direct.is_error is True
    assert direct.structured_content["reason"] == "candidate_semantics_rejected"
    assert searched.is_error is True
    assert searched.structured_content["reason"] == "search_success_target_unmet"


async def test_residual_modal_is_preserved_for_direct_and_search_mcp(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")

    async with Client(_server(_use_case(fixture, ResidualModalDistiller()))) as client:
        direct = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})
        searched = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
        )

    for result in (direct, searched):
        assert result.is_error is False
        assert result.content[0].text.count("支撑阻力位应视为价格博弈的区域。") == 1
        assert "- 规则描述：支撑阻力位应视为价格博弈的区域。" in result.content[0].text
        assert result.content[0].text == result.structured_content["rendered_markdown"]


@pytest.mark.parametrize(
    "comparison",
    (
        "当 EMA5 < EMA20 > EMA60 时，保持观望并等待结构确认。",
        "当 0 < time > 1 时，等待结构确认。",
    ),
)
async def test_technical_comparison_is_preserved_for_direct_and_search_mcp(
    tmp_path: Path, comparison: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")

    async with Client(
        _server(_use_case(fixture, TechnicalComparisonDistiller(comparison)))
    ) as client:
        direct = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})
        searched = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
        )

    for result in (direct, searched):
        assert result.is_error is False
        assert comparison.replace("<", r"\<").replace(">", r"\>") in result.content[0].text
        assert result.content[0].text == result.structured_content["rendered_markdown"]


@pytest.mark.parametrize(
    "leaked_rule",
    (
        pytest.param(
            "当EMA5<EMA20>EMA60时，保持观望并等待结构确认。",
            id="compact-comparison-tag-shaped",
        ),
        pytest.param("核心结论 x<basefont>y 仍需确认。", id="html-legacy-basefont"),
        pytest.param("核心结论 x<applet>y 仍需确认。", id="html-legacy-applet"),
        pytest.param("核心结论 x<listing>y 仍需确认。", id="html-legacy-listing"),
        pytest.param("核心结论 x<b>y 仍需确认。", id="html-unclosed"),
        pytest.param("核心结论 x<br>y 仍需确认。", id="html-void-br"),
        pytest.param("核心结论 x<input>y 仍需确认。", id="html-void-input"),
        pytest.param("核心结论 x<svg>y 仍需确认。", id="svg-unclosed"),
        pytest.param("核心结论 x<math>y 仍需确认。", id="mathml-unclosed"),
        pytest.param("核心结论 x<unknown>y 仍需确认。", id="unknown-bare"),
        pytest.param("核心结论 x</unknown>y 仍需确认。", id="unknown-closing"),
        pytest.param(
            "核心结论 x<future-widget mode='trend'>y 仍需确认。",
            id="unknown-attributed",
        ),
        pytest.param("核心结论 x<future-widget/>y 仍需确认。", id="unknown-void"),
        pytest.param("核心结论 x＜ｆｕｔｕｒｅ－ｗｉｄｇｅｔ＞y 仍需确认。", id="unknown-nfkc"),
        pytest.param(r"核心结论 x\<future-widget\>y 仍需确认。", id="unknown-markdown"),
        pytest.param("核心结论 x&lt;future-widget&gt;y 仍需确认。", id="unknown-entity"),
        pytest.param("核心结论 x&lt;time&gt;y 仍需确认。", id="html-entity"),
        pytest.param("核心结论 x&#60;svg&#62;y 仍需确认。", id="svg-entity"),
        pytest.param("核心结论 x&#x3c;mrow&#x3e;y 仍需确认。", id="mathml-entity"),
    ),
)
async def test_tag_shaped_representation_never_reaches_direct_or_search_mcp(
    tmp_path: Path, leaked_rule: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture, PrivateRuleLeakDistiller(leaked_rule))
    search = SearchAndCreateBilibiliNotes(
        search=FixtureSearch(),
        create_note=_use_case(fixture),
        aggregator=PrivateCatalogLeakAggregator(leaked_rule),
        renderer=MarkdownRenderer(),
    )
    direct_progress: list[float] = []
    search_progress: list[float] = []

    async def capture_direct(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        direct_progress.append(progress)

    async def capture_search(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        search_progress.append(progress)

    async with Client(build_server(direct, search)) as client:
        direct_result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture_direct,
        )
        search_result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture_search,
        )

    assert direct_result.is_error is True
    assert direct_result.structured_content["reason"] == "model_public_representation_invalid"
    assert search_result.is_error is True
    assert search_result.structured_content["reason"] == "rendered_public_text_invalid"
    assert 89 not in direct_progress
    assert 89 not in search_progress
    for result in (direct_result, search_result):
        assert leaked_rule not in result.content[0].text


@pytest.mark.parametrize("reason", ("metadata_json_invalid", "asr_response_invalid"))
async def test_untrusted_source_json_failure_stops_direct_and_search_mcp(
    reason: str,
) -> None:
    source = BoundaryFailureSource(reason)
    media = NeverMedia()
    distiller = CountingDistiller()
    verifier = CountingCandidateVerifier()
    direct = CreateBilibiliNote(
        source=source,
        media=media,
        distiller=distiller,
        verifier=verifier,
        renderer=MarkdownRenderer(),
    )
    direct_progress: list[float] = []
    search_progress: list[float] = []

    async def capture_direct(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        direct_progress.append(progress)

    async def capture_search(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        search_progress.append(progress)

    async with Client(_server(direct)) as client:
        direct_result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture_direct,
        )
        search_result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture_search,
        )

    assert direct_result.is_error is True
    assert direct_result.structured_content["reason"] == reason
    assert search_result.is_error is True
    assert search_result.structured_content["reason"] == "search_success_target_unmet"
    assert source.calls == 2
    assert media.calls == 0
    assert distiller.calls == 0
    assert verifier.calls == 0
    assert 75 not in direct_progress and 89 not in direct_progress
    assert 75 not in search_progress and 89 not in search_progress
    assert all(
        "## 核心策略" not in item.text
        for result in (direct_result, search_result)
        for item in result.content
        if isinstance(item, TextContent)
    )


async def test_coercible_metadata_stops_real_source_before_direct_and_search_effects() -> None:
    source_media = NeverSourceDownload()
    transcript = NeverTranscript()
    source = BilibiliSource(  # type: ignore[arg-type]
        transcript=transcript,
        media=source_media,
        http=CoerciveMetadataHttp(),
    )
    frame_media = NeverMedia()
    distiller = CountingDistiller()
    verifier = CountingCandidateVerifier()
    direct = CreateBilibiliNote(
        source=source,
        media=frame_media,
        distiller=distiller,
        verifier=verifier,
        renderer=MarkdownRenderer(),
    )
    observed: dict[str, list[float]] = {"direct": [], "search": []}

    async def capture_direct(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed["direct"].append(progress)

    async def capture_search(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed["search"].append(progress)

    async with Client(_server(direct)) as client:
        direct_result = await client.call_tool(
            TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture_direct
        )
        search_result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture_search,
        )

    assert direct_result.is_error is True
    assert direct_result.structured_content["reason"] == "source_metadata_invalid"
    assert search_result.is_error is True
    assert search_result.structured_content["reason"] == "search_success_target_unmet"
    assert source_media.calls == 0
    assert transcript.calls == 0
    assert frame_media.calls == 0
    assert distiller.calls == 0
    assert verifier.calls == 0
    assert all(
        25 not in values and 75 not in values and 89 not in values for values in observed.values()
    )
    assert all(
        "## 核心策略" not in item.text
        for result in (direct_result, search_result)
        for item in result.content
        if isinstance(item, TextContent)
    )


@pytest.mark.parametrize(
    "leaked_rule",
    (
        r"S01\\:C01：仅沿主要趋势方向寻找机会。",
        "s01:c01：仅沿主要趋势方向寻找机会。",
        "S01:\u200bC01：仅沿主要趋势方向寻找机会。",
        "S01&colon;C01：仅沿主要趋势方向寻找机会。",
        "S 0 1 : C 0 1：仅沿主要趋势方向寻找机会。",
        "S 0 1 : M 0 1：等待结构确认后再参与。",
        "S 0 1 : R 0 1：结构失效后停止沿用。",
        "依据 e001 等待确认。",
        "依据 E\u200b001 等待确认。",
        "依据 E\u034f001 等待确认。",
        "依据 Ｅ００１ 等待确认。",
        "依据 E 0 0 1、V 0 1、F - 0 1 与 H 0 1 等待确认。",
        "依据 E&Tab;0&Tab;0&Tab;1、V&#9;0&#9;1、F\u1680-\u16800\u16801 与 H&Tab;0&Tab;1 等待确认。",
        (
            "依据 E&NewLine;0&#10;0&#13;1、V&#x0a;0&NewLine;1、"
            "F&#x0d;-&#10;0&#13;1 与 H&NewLine;0&NewLine;1 等待确认。"
        ),
        "来源 BB_" + "A" * 64 + "。",
        "来源 b b _ " + " ".join("a" * 64) + "。",
        "来源 b&Tab;p&Tab;_&Tab;" + "&Tab;".join("a" * 64) + "。",
        "来源 b&NewLine;s&#10;_&#13;" + "&NewLine;".join("a" * 64) + "。",
        "依据 sac_" + "a" * 64 + " 综合判断。",
        "依据 s a s _ " + " ".join("a" * 64) + " 综合判断。",
        "依据 sac\ufe0f_" + "a" * 64 + " 综合判断。",
        "Model: test-model，价格突破后等待确认。",
        "Model\u034f: test-model，价格突破后等待确认。",
        "## Provenance 价格突破后等待确认。",
    ),
)
async def test_private_catalog_identity_never_reaches_search_mcp(
    tmp_path: Path, leaked_rule: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture)
    search = SearchAndCreateBilibiliNotes(
        search=FixtureSearch(),
        create_note=direct,
        aggregator=PrivateCatalogLeakAggregator(leaked_rule),
        renderer=MarkdownRenderer(),
    )
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed.append(progress)

    async with Client(build_server(direct, search)) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content["code"] == "OUTPUT_INVALID"
    assert result.structured_content["reason"] == "private_audit_projection_forbidden"
    assert 89 not in observed
    assert all("S01" not in item.text for item in result.content if isinstance(item, TextContent))


async def test_browser_visible_media_entity_never_reaches_search_mcp(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture)
    leaked_rule = (
        "当图示 &excl;&lbrack;趋势&rbrack;&lpar;data&colon;image/png;"
        "base64&comma;QUJD&rpar; 出现突破时等待确认。"
    )
    search = SearchAndCreateBilibiliNotes(
        search=FixtureSearch(),
        create_note=direct,
        aggregator=PrivateCatalogLeakAggregator(leaked_rule),
        renderer=MarkdownRenderer(),
    )
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed.append(progress)

    async with Client(build_server(direct, search)) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content["code"] == "OUTPUT_INVALID"
    assert result.structured_content["reason"] == "rendered_public_text_invalid"
    assert 89 not in observed
    assert leaked_rule not in result.content[0].text


@pytest.mark.parametrize(
    "leaked_rule",
    (
        "依据 e001 等待确认。",
        "依据 E\u200b001 等待确认。",
        "依据 E\u034f001 等待确认。",
        "依据 Ｅ００１ 等待确认。",
        "依据 E 0 0 1、V 0 1、F - 0 1 与 H 0 1 等待确认。",
        "依据 E&Tab;0&Tab;0&Tab;1、V&#9;0&#9;1、F\u1680-\u16800\u16801 与 H&Tab;0&Tab;1 等待确认。",
        (
            "依据 E&NewLine;0&#10;0&#13;1、V&#x0a;0&NewLine;1、"
            "F&#x0d;-&#10;0&#13;1 与 H&NewLine;0&NewLine;1 等待确认。"
        ),
        "来源 BB_" + "A" * 64 + "。",
        "来源 b t _ " + " ".join("a" * 64) + "。",
        "来源 s&Tab;a&Tab;s&Tab;_&Tab;" + "&Tab;".join("a" * 64) + "。",
        "来源 s&NewLine;a&#10;c&#13;_&NewLine;" + "&#10;".join("a" * 64) + "。",
        "S01&colon;C01：仅沿主要趋势方向寻找机会。",
        "S\ufe0f01&colon;C01：仅沿主要趋势方向寻找机会。",
        "S 0 1 : C 0 1：仅沿主要趋势方向寻找机会。",
        "S 0 1 : M 0 1：等待结构确认后再参与。",
        "S 0 1 : R 0 1：结构失效后停止沿用。",
        "依据 sac_" + "a" * 64 + " 综合判断。",
        "依据 s a c _ " + " ".join("a" * 64) + " 综合判断。",
        "依据 sac\u034f_" + "a" * 64 + " 综合判断。",
        "Model: test-model，价格突破后等待确认。",
        "Model\ufe0f: test-model，价格突破后等待确认。",
        "## Provenance 价格突破后等待确认。",
        (
            "当图示 &excl;&lbrack;趋势&rbrack;&lpar;data&colon;image/png;"
            "base64&comma;QUJD&rpar; 出现突破时等待确认。"
        ),
    ),
)
async def test_private_identity_never_reaches_direct_mcp(tmp_path: Path, leaked_rule: str) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    direct = _use_case(fixture, PrivateRuleLeakDistiller(leaked_rule))
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed.append(progress)

    async with Client(_server(direct)) as client:
        result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content == {
        "schema": "bilibili-note.error/v1",
        "maturity": "current_poc",
        "code": "DISTILLATION_FAILED",
        "reason": "model_public_representation_invalid",
    }
    assert 89 not in observed
    assert leaked_rule not in result.content[0].text


async def test_ordered_visual_cannot_borrow_authorizing_speech_from_another_segment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    monkeypatch.setenv("TEST_MCP_PROVIDER_KEY", "secret")
    observed_visuals: list[dict[str, object]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        prompt = body["messages"][1]["content"][0]["text"]
        untrusted = json.loads(prompt.split("\nUntrusted source and candidate:\n", 1)[1])
        observed_visuals.extend(untrusted["visuals"])
        verdict = {
            "source_coverage": "accept",
            "no_duplicate_or_remaining_mergeable_rule": "accept",
            "priority_order_acceptable": "accept",
            "rules": [
                {
                    "item_index": 0,
                    "intelligible": "accept",
                    "source_resolvable": "accept",
                    "entailed_no_new_claim": "accept",
                    "polarity_preserved": "accept",
                    "material_conditions_preserved": "accept",
                    "reusable_abstraction_acceptable": "accept",
                    "simplified_chinese_language": "accept",
                    "classified_category": "core_strategy",
                },
                {
                    "item_index": 1,
                    "intelligible": "accept",
                    "source_resolvable": "accept",
                    "entailed_no_new_claim": "accept",
                    "polarity_preserved": "accept",
                    "material_conditions_preserved": "accept",
                    "reusable_abstraction_acceptable": "accept",
                    "simplified_chinese_language": "accept",
                    "classified_category": "method",
                },
                {
                    "item_index": 2,
                    "intelligible": "accept",
                    "source_resolvable": "accept",
                    "entailed_no_new_claim": "accept",
                    "polarity_preserved": "accept",
                    "material_conditions_preserved": "accept",
                    "reusable_abstraction_acceptable": "accept",
                    "simplified_chinese_language": "accept",
                    "classified_category": "risk_management",
                },
            ],
            "visuals": [
                {
                    "group_index": 0,
                    "rule_index": 1,
                    "materiality": "material",
                    "independent_support": "accept",
                    "rule_relation": "ordered",
                    "speech_authorized": "reject",
                    "same_visual_context": "accept",
                    "ordered_relation_support": "accept",
                },
                {
                    "group_index": 1,
                    "rule_index": None,
                    "materiality": "no_material",
                    "independent_support": "not_applicable",
                    "rule_relation": "none",
                    "speech_authorized": "not_applicable",
                    "same_visual_context": "not_applicable",
                    "ordered_relation_support": "not_applicable",
                },
            ],
        }
        return httpx.Response(
            200,
            json={
                "model": "test-vision",
                "choices": [{"message": {"content": json.dumps(verdict)}}],
            },
        )

    direct = CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=OrderedSpeechMismatchMedia(),
        distiller=OrderedSpeechMismatchDistiller(),
        verifier=SiliconFlowCandidateVerifier(_provider_profile(), httpx.MockTransport(respond)),
        renderer=MarkdownRenderer(),
    )
    observed_progress: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed_progress.append(progress)

    async with Client(_server(direct)) as client:
        result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture,
        )

    assert observed_visuals[0]["transcript_refs"] == ["E002"]
    assert result.is_error is True
    assert result.structured_content["code"] == "VISUAL_EVIDENCE_INCOMPLETE"
    assert result.structured_content["reason"] == "visual_ordered_relation_rejected"
    assert 89 not in observed_progress
    assert all(
        "## 核心策略" not in item.text for item in result.content if isinstance(item, TextContent)
    )


@pytest.mark.parametrize("envelope_mode", ("missing", "duplicate"))
async def test_invalid_model_identity_never_reaches_direct_mcp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, envelope_mode: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    monkeypatch.setenv("TEST_MCP_PROVIDER_KEY", "secret")

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        visual_count = body["response_format"]["json_schema"]["schema"]["properties"]["visuals"][
            "minItems"
        ]
        candidate = {
            "core_strategies": [{"rule_body": "主要趋势决定方向偏好", "evidence_refs": ["E001"]}],
            "methods": [{"rule_body": "方向不明确时保持观望", "evidence_refs": ["E001"]}],
            "risk_management": [{"rule_body": "价格跌破失效位置后退出", "evidence_refs": ["E001"]}],
            "visuals": [
                {
                    "disposition": "no_material_increment",
                    "rule_index": None,
                    "evidence_basis": None,
                }
                for _index in range(visual_count)
            ],
        }
        if envelope_mode == "missing":
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": json.dumps(candidate)}}]},
            )
        content = json.dumps(json.dumps(candidate, ensure_ascii=False), ensure_ascii=False)
        return httpx.Response(
            200,
            content=(
                '{"model":"foreign","\\u006dodel":"test-vision",'
                f'"choices":[{{"message":{{"content":{content}}}}}]}}'
            ).encode(),
        )

    direct = _use_case(
        fixture,
        SiliconFlowDistiller(_provider_profile(), httpx.MockTransport(respond)),
    )
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed.append(progress)

    async with Client(_server(direct)) as client:
        result = await client.call_tool(
            TOOL_NAME,
            {"url": FIXTURE_URL},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content["code"] == "DISTILLATION_FAILED"
    assert result.structured_content["reason"] == "model_identity_changed"
    assert 75 not in observed and 89 not in observed
    assert all(
        "## 核心策略" not in item.text for item in result.content if isinstance(item, TextContent)
    )


@pytest.mark.parametrize("envelope_mode", ("missing", "duplicate"))
async def test_invalid_model_identity_never_reaches_search_mcp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, envelope_mode: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    monkeypatch.setenv("TEST_MCP_PROVIDER_KEY", "secret")
    direct = _use_case(fixture)

    def respond(_request: httpx.Request) -> httpx.Response:
        if envelope_mode == "missing":
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": json.dumps({})}}]},
            )
        return httpx.Response(
            200,
            content=(
                b'{"model":"foreign","\\u006dodel":"test-vision",'
                b'"choices":[{"message":{"content":"{}"}}]}'
            ),
        )

    transport = httpx.MockTransport(respond)
    aggregator = VerifiedStrategySynthesisAggregator(
        SiliconFlowStrategySynthesizer(_provider_profile(), transport),
        SiliconFlowStrategySynthesisVerifier(_provider_profile(), transport),
    )
    search = SearchAndCreateBilibiliNotes(
        search=FixtureSearch(),
        create_note=direct,
        aggregator=aggregator,
        renderer=MarkdownRenderer(),
    )
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        del total, message
        observed.append(progress)

    async with Client(build_server(direct, search)) as client:
        result = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "趋势交易", "max_videos": 1},
            progress_callback=capture,
        )

    assert result.is_error is True
    assert result.structured_content["code"] == "DISTILLATION_FAILED"
    assert result.structured_content["reason"] == "strategy_aggregation_response_invalid"
    assert 89 not in observed
    assert all(
        "## 核心策略" not in item.text for item in result.content if isinstance(item, TextContent)
    )


async def test_multiple_singleton_groups_can_support_one_public_method(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    use_case = CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=ThreeEvidenceMedia(),
        distiller=FrameOnlyVisualDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )
    observed: list[float] = []

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        observed.append(progress)

    payload = await use_case.execute(FIXTURE_URL)
    assert [item.frame_timestamps_ms for item in payload.brief.visual_insights] == [
        (1000,),
        (3000,),
    ]
    assert [item.transcript_refs for item in payload.brief.visual_insights] == [
        ("E001",),
        ("E002",),
    ]
    bound_method = next(
        item
        for item in payload.brief.key_points
        if item.text == "两个独立视觉时刻共同支持同一结构确认条件。"
    )
    assert bound_method.evidence_refs[-2:] == ("V01", "V02")

    async with Client(_server(use_case)) as client:
        result = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture)

    assert result.is_error is False
    assert "两个独立视觉时刻共同支持同一结构确认条件" in result.content[0].text
    assert "画面补足" not in result.content[0].text
    assert observed == [5, 25, 50, 65, 75, 89]
    assert len(result.content) == 1


async def test_long_opposing_rules_survive_direct_and_search_without_semantic_dedup(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    async with Client(_server(_use_case(fixture, LongOpposingRulesDistiller()))) as client:
        direct = await client.call_tool(TOOL_NAME, {"url": FIXTURE_URL})
        searched = await client.call_tool(
            SEARCH_TOOL_NAME,
            {"query": "止损纪律", "max_videos": 1},
        )

    required = (
        "价格跌破关键前低时必须立即止损并且不得继续持有该仓位。",
        "价格跌破关键前低时不必立即止损并且仍可继续持有该仓位。",
    )
    for result in (direct, searched):
        assert result.is_error is False
        assert all(result.content[0].text.count(item) == 1 for item in required)


async def test_cancellation_after_89_never_returns_terminal_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    entered = asyncio.Event()
    blocker = asyncio.Event()
    observed: list[float] = []

    async def blocked_checkpoint() -> None:
        entered.set()
        await blocker.wait()

    async def capture(progress: float, total: float | None, message: str | None) -> None:
        observed.append(progress)

    monkeypatch.setattr(mcp_server_module, "_terminal_cancellation_checkpoint", blocked_checkpoint)
    async with Client(_server(_use_case(fixture))) as client:
        call = asyncio.create_task(
            client.call_tool(TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture)
        )
        await asyncio.wait_for(entered.wait(), timeout=5)
        call.cancel()
        result = await call

    assert observed[-1] == 89
    assert 90 not in observed
    assert 100 not in observed
    assert result.is_error is True
    assert result.structured_content["code"] == "CANCELLED"
    assert result.structured_content["reason"] == "request_cancelled"


async def test_process_stdio_is_standalone_and_gap_fails_before_transcript_ready(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    parameters = StdioServerParameters(
        command=sys.executable,
        args=["-m", "bilibili_note_mcp", "--fixture-root", str(fixture), "--deterministic"],
        cwd=Path.cwd(),
    )
    async with stdio_client(parameters) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            listed = await session.list_tools()
            success = await session.call_tool(TOOL_NAME, {"url": FIXTURE_URL})
            searched = await session.call_tool(
                SEARCH_TOOL_NAME, {"query": "趋势交易", "max_videos": 1}
            )
            (fixture / "subtitles.vtt").write_text(
                "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nfirst\n\n"
                "00:00:03.000 --> 00:00:06.000\nsecond\n",
                encoding="utf-8",
            )
            observed: list[float] = []

            async def capture(progress: float, total: float | None, message: str | None) -> None:
                observed.append(progress)

            gap = await session.call_tool(
                TOOL_NAME, {"url": FIXTURE_URL}, progress_callback=capture
            )

    assert success.is_error is False
    assert len(success.content) == 1
    assert [tool.name for tool in listed.tools] == [TOOL_NAME, SEARCH_TOOL_NAME]
    assert searched.is_error is False
    assert searched.structured_content["schema"] == "bilibili-note.search-result/v1"
    assert gap.is_error is True
    assert gap.structured_content["code"] == "TRANSCRIPT_INCOMPLETE"
    assert observed == [5, 25]


async def test_public_cli_rejects_deterministic_mode_without_fixture_before_serve(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    async def forbidden_serve(fixture_root: Path | None, deterministic: bool) -> int:
        nonlocal called
        del fixture_root, deterministic
        called = True
        return 0

    monkeypatch.setattr(sys, "argv", ["bilibili-note-mcp", "--deterministic"])
    monkeypatch.setattr(cli_module, "_serve", forbidden_serve)

    with pytest.raises(SystemExit) as exit_status:
        await cli_module._async_main()

    assert exit_status.value.code == 2
    assert called is False
