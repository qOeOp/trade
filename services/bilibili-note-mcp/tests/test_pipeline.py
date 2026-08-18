from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import Literal

import pytest
from PIL import Image, ImageDraw

from bilibili_note_mcp.adapters.distillers import (
    DeterministicCandidateVerifier,
    DeterministicDistiller,
)
from bilibili_note_mcp.adapters.fixture_source import FixtureSource
from bilibili_note_mcp.adapters.media_ffmpeg import (
    FfmpegMedia,
    _Decoded,
    _integer_visual_distance,
    _select_ordered_visual_moment,
    _select_visual_medoid,
    _visual_profile,
    ordered_relation_intent,
    visual_intent_score,
)
from bilibili_note_mcp.application import create_note as create_note_module
from bilibili_note_mcp.application.create_note import CreateBilibiliNote
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import (
    AcquiredSource,
    CandidateVerification,
    CandidateVisual,
    DistillCandidate,
    FrameAsset,
    TranscriptResult,
    TranscriptSegment,
)
from bilibili_note_mcp.application.progress import media_acquisition_heartbeat
from bilibili_note_mcp.application.public_text import contains_private_audit_noise
from bilibili_note_mcp.domain.models import PublicRuleV1, SourceV1
from bilibili_note_mcp.domain.refs import brief_ref
from bilibili_note_mcp.fixture import FIXTURE_URL, generate_fixture
from bilibili_note_mcp.presentation.markdown import MarkdownRenderer, markdown_literal


def _rule(body: str) -> PublicRuleV1:
    return PublicRuleV1(rule_body=body)


def _frame(
    index: int,
    *,
    group_id: str,
    width: int = 1280,
    height: int = 720,
    png_bytes: bytes | None = None,
    timestamp_ms: int | None = None,
    selection_reason: Literal[
        "deictic_cue", "visual_activity", "ordered_relation_cue", "coverage"
    ] = "coverage",
    transcript_refs: tuple[str, ...] = ("E001",),
) -> FrameAsset:
    payload = png_bytes or b"\x89PNG\r\n\x1a\nfixture" + bytes((index,))
    return FrameAsset(
        frame_id=f"F{index:02d}",
        group_id=group_id,
        timestamp_ms=index * 1000 if timestamp_ms is None else timestamp_ms,
        width=width,
        height=height,
        png_bytes=payload,
        asset_ref=hashlib.sha256(payload).hexdigest(),
        transcript_refs=transcript_refs,
        selection_reason=selection_reason,
    )


class PercentageVisualDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(
            candidate,
            rules=(
                *candidate.rules[:2],
                (
                    _rule("61.8% 回调位与 4 小时上升趋势线重合时，才形成结构共振。"),
                    candidate.rules[2][1],
                ),
                *candidate.rules[3:],
            ),
        )


class InvalidMaterialVisualDistiller:
    def __init__(self, rule_index: object = None) -> None:
        self._rule_index = rule_index

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(
            candidate,
            visuals=(
                replace(candidate.visuals[0], rule_index=self._rule_index),  # type: ignore[arg-type]
                *candidate.visuals[1:],
            ),
        )


class DuplicateVisualOwnerDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        text, refs = candidate.rules[0]
        return replace(candidate, rules=((text, (*refs, "G01")), *candidate.rules[1:]))


class MissingVisualDispositionDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(candidate, visuals=candidate.visuals[:-1])


class NonMaterialFrameCitationDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        next(item for item in candidate.visuals if item.disposition == "no_material_increment")
        text, refs = candidate.rules[2]
        return replace(
            candidate,
            rules=(*candidate.rules[:2], (text, (*refs, "G02")), *candidate.rules[3:]),
        )


class RawFrameCitationDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        text, refs = candidate.rules[2]
        return replace(
            candidate,
            rules=(*candidate.rules[:2], (text, (*refs, frames[0].frame_id)), *candidate.rules[3:]),
        )


class TwoMaterialGroupsDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        assert len(candidate.visuals) >= 2
        return replace(
            candidate,
            rules=(
                *candidate.rules[:4],
                (_rule("另一项结构条件用于确认参与位置。"), candidate.rules[2][1]),
                *candidate.rules[5:],
            ),
            visuals=(
                candidate.visuals[0],
                replace(
                    candidate.visuals[1],
                    disposition="supports_rule",
                    rule_index=4,
                    evidence_basis="static_frame",
                ),
                *candidate.visuals[2:],
            ),
        )


class TwoMaterialGroupsWithSharedMethodDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(
            candidate,
            visuals=(
                candidate.visuals[0],
                replace(
                    candidate.visuals[1],
                    disposition="supports_rule",
                    rule_index=2,
                    evidence_basis="static_frame",
                ),
                *candidate.visuals[2:],
            ),
        )


class DuplicateMethodsWithSecondVisualOwnerDistiller:
    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        text, refs = candidate.rules[2]
        return replace(
            candidate,
            rules=(*candidate.rules[:3], (text, refs), *candidate.rules[4:]),
            visuals=(
                replace(candidate.visuals[0], rule_index=3),
                *candidate.visuals[1:],
            ),
        )


class RecordingVerifier:
    def __init__(self) -> None:
        self.calls = 0

    async def verify(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        candidate: DistillCandidate,
    ) -> CandidateVerification:
        self.calls += 1
        return await DeterministicCandidateVerifier().verify(source, frames, candidate)


class GlobalRuleVisualDistiller:
    def __init__(self, rule_index: int) -> None:
        self._rule_index = rule_index

    async def distill(
        self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
    ) -> DistillCandidate:
        candidate = await DeterministicDistiller().distill(source, frames)
        return replace(
            candidate,
            visuals=(
                replace(
                    candidate.visuals[0],
                    disposition="supports_rule",
                    rule_index=self._rule_index,
                    evidence_basis="static_frame",
                ),
                *candidate.visuals[1:],
            ),
        )


class RecordingSelectionMedia(FfmpegMedia):
    def __init__(self) -> None:
        super().__init__()
        self.selected_evidence: list[str] = []
        self._serial = 0

    async def _probe(self, source: AcquiredSource) -> tuple[int, int]:
        return (1280, 720)

    def _image(self, workspace: Path, timestamp_ms: int) -> _Decoded:
        self._serial += 1
        path = workspace / f"recorded-{self._serial}.png"
        Image.new("RGB", (1280, 720), (self._serial, 0, 0)).save(path, format="PNG")
        return _Decoded(timestamp_ms=timestamp_ms, path=path)

    async def _decode_window(
        self,
        source: AcquiredSource,
        segment: TranscriptSegment,
        workspace: Path,
        width: int,
        height: int,
        *,
        retain_ordered: bool,
    ) -> tuple[_Decoded, ...]:
        self.selected_evidence.append(segment.evidence_id)
        if retain_ordered:
            return tuple(
                self._image(workspace, segment.start_ms + offset) for offset in (100, 200, 300)
            )
        return (self._image(workspace, segment.start_ms + 100),)

    async def _decode(
        self,
        media_path: Path,
        timestamp_ms: int,
        workspace: Path,
        stem: str,
        width: int,
        height: int,
    ) -> _Decoded:
        return self._image(workspace, timestamp_ms)


class TracingDecodeMedia(FfmpegMedia):
    def __init__(self, *, fail_first: bool = False) -> None:
        super().__init__()
        self.active_decodes = 0
        self.max_active_decodes = 0
        self.started_timestamps: list[int] = []
        self.completed_timestamps: list[int] = []
        self._lock = asyncio.Lock()
        self._serial = 0
        self._fail_next = fail_first

    async def _probe(self, source: AcquiredSource) -> tuple[int, int]:
        return (1280, 720)

    async def _decode(
        self,
        media_path: Path,
        timestamp_ms: int,
        workspace: Path,
        stem: str,
        width: int,
        height: int,
    ) -> _Decoded:
        async with self._decode_gate:
            async with self._lock:
                self._serial += 1
                serial = self._serial
                self.active_decodes += 1
                if self.active_decodes > self.max_active_decodes:
                    self.max_active_decodes = self.active_decodes
                self.started_timestamps.append(timestamp_ms)
            try:
                if stem.startswith("coverage"):
                    await asyncio.sleep(0.0)
                else:
                    await asyncio.sleep(0.05)
                if self._fail_next:
                    self._fail_next = False
                    raise BilibiliNoteFailure("VISUAL_EVIDENCE_INCOMPLETE", "frame_decode_failed")
                output = workspace / f"trace-{serial}.png"
                Image.new("RGB", (1280, 720), (serial, 0, 0)).save(output, format="PNG")
                async with self._lock:
                    self.completed_timestamps.append(timestamp_ms)
                return _Decoded(timestamp_ms=timestamp_ms, path=output)
            finally:
                async with self._lock:
                    self.active_decodes -= 1


async def test_fixture_produces_text_only_multimodal_brief(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    payload = await CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    ).execute(FIXTURE_URL)

    assert payload.brief.schema_id == "bilibili-note.research-brief/v2"
    assert payload.brief_ref == brief_ref(payload.brief.model_dump(mode="json", by_alias=True))
    assert payload.brief.coverage.visual_analysis == "internal_transient"
    assert payload.brief.coverage.analyzed_visual_frames >= 2
    assert payload.brief.visual_insights[0].transcript_refs
    assert payload.brief.visual_insights[0].frame_timestamps_ms
    dumped = payload.brief.model_dump(mode="json", by_alias=True)
    assert "assets" not in dumped
    assert "excerpt" not in json.dumps(dumped)
    assert "png" not in json.dumps(dumped).casefold()
    assert "![" not in payload.rendered_markdown
    assert "价格与关键线的相对位置用于确认结构" in payload.rendered_markdown
    assert "画面显示" not in payload.rendered_markdown
    for noise in ("E001", "V01", "证据时间轴", "Provenance", "brief_ref", "画面补足的信息"):
        assert noise not in payload.rendered_markdown
    assert not contains_private_audit_noise(payload.rendered_markdown)


async def test_extract_frames_reassembles_jobs_by_frozen_ordinal_when_completion_inverts(
    tmp_path: Path,
) -> None:
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="并发解码顺序稳定性测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=4000,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(
                TranscriptSegment("E001", 0, 1000, "看这里，这里有变化"),
                TranscriptSegment("E002", 1000, 2000, "这个页面前后变化了"),
                TranscriptSegment("E003", 2000, 3000, "请看这个图表"),
                TranscriptSegment("E004", 3000, 4000, "看这里"),
            ),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )
    media = TracingDecodeMedia()

    frames = await media.extract_frames(source, tmp_path)

    ranked = sorted(
        (segment for segment in source.transcript.segments if visual_intent_score(segment.text)),
        key=lambda item: (-visual_intent_score(item.text), item.start_ms),
    )
    selected = ranked[:3]
    coverage_segments = []
    for ratio in (1 / 3, 2 / 3):
        timestamp = min(
            source.source.duration_ms - 1,
            max(0, int(source.source.duration_ms * ratio)),
        )
        coverage_segments.append(
            min(
                source.transcript.segments,
                key=lambda item: (
                    0
                    if item.start_ms <= timestamp <= item.end_ms
                    else min(abs(timestamp - item.start_ms), abs(timestamp - item.end_ms))
                ),
            )
        )

    expected_transcript_refs = tuple(item.evidence_id for item in (*selected, *coverage_segments))
    assert tuple(frame.transcript_refs[0] for frame in frames) == expected_transcript_refs
    assert media.max_active_decodes > 1
    assert media.max_active_decodes <= 3


async def test_extract_frames_cancels_and_joins_all_jobs_on_one_decode_failure(
    tmp_path: Path,
) -> None:
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="失败取消并发覆盖测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=4000,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(
                TranscriptSegment("E001", 0, 1000, "看这里，这里有变化"),
                TranscriptSegment("E002", 1000, 2000, "这个页面前后变化了"),
                TranscriptSegment("E003", 2000, 3000, "请看这个图表"),
            ),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )
    media = TracingDecodeMedia(fail_first=True)

    with pytest.raises(BilibiliNoteFailure) as failure:
        await media.extract_frames(source, tmp_path)
    assert failure.value.reason == "frame_decode_failed"
    assert media.active_decodes == 0
    assert media.max_active_decodes <= 3


async def test_decode_window_cancels_and_joins_blocked_probe_siblings(
    tmp_path: Path,
) -> None:
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="内部探针取消测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=4000,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(TranscriptSegment("E001", 0, 4000, "看这里的前后变化"),),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )

    class BlockingProbeMedia(FfmpegMedia):
        def __init__(self) -> None:
            super().__init__()
            self.all_started = asyncio.Event()
            self.never_release = asyncio.Event()
            self.started = 0
            self.active = 0
            self.cancelled = 0
            self.late_writes = 0

        async def _decode(
            self,
            media_path: Path,
            timestamp_ms: int,
            workspace: Path,
            stem: str,
            width: int,
            height: int,
        ) -> _Decoded:
            del media_path, workspace, width, height
            self.started += 1
            self.active += 1
            if self.started == 5:
                self.all_started.set()
            try:
                await self.all_started.wait()
                if stem.endswith("-0"):
                    raise BilibiliNoteFailure("VISUAL_EVIDENCE_INCOMPLETE", "frame_decode_failed")
                await self.never_release.wait()
                self.late_writes += 1
                raise AssertionError("blocked sibling escaped cancellation")
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
            finally:
                self.active -= 1

    media = BlockingProbeMedia()
    with pytest.raises(BilibiliNoteFailure) as failure:
        await media._decode_window(
            source,
            source.transcript.segments[0],
            tmp_path,
            1280,
            720,
            retain_ordered=True,
        )

    assert failure.value.reason == "frame_decode_failed"
    assert media.started == 5
    assert media.cancelled == 4
    assert media.active == 0
    await asyncio.sleep(0)
    assert media.late_writes == 0


async def test_decode_window_repeated_cancellation_waits_for_every_decode_cleanup(
    tmp_path: Path,
) -> None:
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="重复取消测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=4000,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(TranscriptSegment("E001", 0, 4000, "看这里的前后变化"),),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )

    class SlowCleanupMedia(FfmpegMedia):
        def __init__(self) -> None:
            super().__init__()
            self.all_started = asyncio.Event()
            self.cleanup_started = asyncio.Event()
            self.allow_cleanup = asyncio.Event()
            self.started = 0
            self.cleaning = 0
            self.terminal = 0

        async def _decode(
            self,
            media_path: Path,
            timestamp_ms: int,
            workspace: Path,
            stem: str,
            width: int,
            height: int,
        ) -> _Decoded:
            del media_path, timestamp_ms, workspace, stem, width, height
            self.started += 1
            if self.started == 5:
                self.all_started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cleaning += 1
                if self.cleaning == 5:
                    self.cleanup_started.set()
                await self.allow_cleanup.wait()
                self.terminal += 1
                raise

    media = SlowCleanupMedia()
    task = asyncio.create_task(
        media._decode_window(
            source,
            source.transcript.segments[0],
            tmp_path,
            1280,
            720,
            retain_ordered=True,
        )
    )
    await asyncio.wait_for(media.all_started.wait(), timeout=1)
    task.cancel("first")
    await asyncio.wait_for(media.cleanup_started.wait(), timeout=1)
    task.cancel("second")
    await asyncio.sleep(0)
    assert not task.done()
    assert media.terminal == 0

    media.allow_cleanup.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert media.terminal == 5


async def test_visual_analysis_repeated_cancellation_waits_for_model_cleanup(
    tmp_path: Path,
) -> None:
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="视觉取消测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=4000,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(TranscriptSegment("E001", 0, 4000, "看这里的趋势线"),),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )

    class SlowCleanupDistiller:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.cleanup_started = asyncio.Event()
            self.allow_cleanup = asyncio.Event()
            self.cleanup_terminal = asyncio.Event()

        async def distill(
            self, source: AcquiredSource, frames: tuple[FrameAsset, ...]
        ) -> DistillCandidate:
            del source, frames
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

    distiller = SlowCleanupDistiller()
    use_case = CreateBilibiliNote(
        source=FixtureSource(tmp_path),
        media=FfmpegMedia(),
        distiller=distiller,
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )
    task = asyncio.create_task(
        use_case._analyze_with_liveness(
            source,
            (_frame(1, group_id="G01"), _frame(2, group_id="G02")),
            create_note_module.NullProgressReporter(),
        )
    )
    await asyncio.wait_for(distiller.started.wait(), timeout=1)
    task.cancel("first")
    await asyncio.wait_for(distiller.cleanup_started.wait(), timeout=1)
    task.cancel("second")
    await asyncio.sleep(0)
    assert not task.done()
    assert not distiller.cleanup_terminal.is_set()

    distiller.allow_cleanup.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert distiller.cleanup_terminal.is_set()


async def test_visual_completeness_is_checked_before_markdown_escaping(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    payload = await CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=PercentageVisualDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    ).execute(FIXTURE_URL)

    assert "61.8%" in payload.rendered_markdown
    assert any("61.8%" in item.rule_body for item in payload.summary.methods)
    assert "百分之六十一点八回调线" not in payload.rendered_markdown
    assert "画面显示" not in payload.rendered_markdown


@pytest.mark.parametrize(
    ("distiller", "expected"),
    [
        (TwoMaterialGroupsDistiller(), (("V01",), ("V02",))),
        (TwoMaterialGroupsWithSharedMethodDistiller(), (("V01", "V02"),)),
    ],
)
async def test_material_visuals_append_or_merge_into_one_atomic_public_method(
    tmp_path: Path,
    distiller: object,
    expected: tuple[tuple[str, ...], ...],
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    payload = await CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=distiller,  # type: ignore[arg-type]
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    ).execute(FIXTURE_URL)

    method_records = [
        item
        for item in payload.brief.key_points
        if item.text in {rule.rule_body for rule in payload.summary.methods}
    ]
    observed = tuple(
        tuple(ref for ref in item.evidence_refs if ref.startswith("V"))
        for item in method_records
        if any(ref.startswith("V") for ref in item.evidence_refs)
    )
    assert observed == expected
    assert [item.visual_id for item in payload.brief.visual_insights] == ["V01", "V02"]
    visual_methods = tuple(
        item.text
        for item in method_records
        if any(ref.startswith("V") for ref in item.evidence_refs)
    )
    assert all(payload.rendered_markdown.count(method) == 1 for method in visual_methods)


@pytest.mark.parametrize(
    ("rule_index", "category", "body"),
    (
        (0, "core", "市场主要趋势决定交易方向偏好。"),
        (2, "method", "价格与关键线的相对位置用于确认结构。"),
        (5, "risk", "单笔仓位与风险敞口必须预先设定上限。"),
    ),
)
async def test_material_visual_binds_one_global_rule_in_any_public_category(
    tmp_path: Path, rule_index: int, category: str, body: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    payload = await CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=GlobalRuleVisualDistiller(rule_index),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    ).execute(FIXTURE_URL)

    records = (payload.brief.core_thesis, *payload.brief.key_points)
    target = next(item for item in records if item.text == body)
    assert target.evidence_refs[-1] == "V01"
    assert sum("V01" in item.evidence_refs for item in records) == 1
    summary_bodies = {
        "core": tuple(item.rule_body for item in payload.summary.core_strategies),
        "method": tuple(item.rule_body for item in payload.summary.methods),
        "risk": tuple(item.rule_body for item in payload.summary.risk_management),
    }
    assert body in summary_bodies[category]
    assert payload.rendered_markdown.count(body) == 1


async def test_same_category_duplicate_is_rejected_before_verification(
    tmp_path: Path,
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    verifier = RecordingVerifier()
    use_case = CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=DuplicateMethodsWithSecondVisualOwnerDistiller(),
        verifier=verifier,
        renderer=MarkdownRenderer(),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await use_case.execute(FIXTURE_URL)
    assert failure.value.reason == "model_public_items_not_unique"
    assert verifier.calls == 0


@pytest.mark.parametrize("rule_index", (None, -1, 6, True))
async def test_material_visual_group_requires_one_existing_public_rule_index(
    tmp_path: Path, rule_index: object
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    use_case = CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=InvalidMaterialVisualDistiller(rule_index),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await use_case.execute(FIXTURE_URL)
    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == "visual_rule_index_invalid"


@pytest.mark.parametrize(
    ("distiller", "reason"),
    [
        (DuplicateVisualOwnerDistiller(), "model_evidence_ref_invalid"),
        (MissingVisualDispositionDistiller(), "model_visual_groups_invalid"),
        (NonMaterialFrameCitationDistiller(), "model_evidence_ref_invalid"),
        (RawFrameCitationDistiller(), "model_evidence_ref_invalid"),
    ],
)
async def test_host_proves_total_visual_disposition_and_unique_owner(
    tmp_path: Path, distiller: object, reason: str
) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    use_case = CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=distiller,  # type: ignore[arg-type]
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await use_case.execute(FIXTURE_URL)

    assert failure.value.code == "DISTILLATION_FAILED"
    assert failure.value.reason == reason


async def test_direct_projection_escapes_untrusted_source_title_markdown(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    source_path = fixture / "source.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    source["author_name"] = "趋势策略 [立即授权](//evil.example) https://evil.example"
    source_path.write_text(json.dumps(source), encoding="utf-8")

    payload = await CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    ).execute(FIXTURE_URL)

    assert "[立即授权](//evil.example)" not in payload.rendered_markdown
    assert payload.rendered_markdown.startswith("# 视频：交易思想与策略总结\n")
    assert "evil.example" not in payload.rendered_markdown


def test_markdown_keeps_strategy_notation_readable() -> None:
    assert markdown_literal("MA20/MA40, 61.8%") == "MA20/MA40, 61.8%"


def test_public_projection_noise_gate_rejects_private_ids_and_digests() -> None:
    assert contains_private_audit_noise("## 证据时间轴\nE001 00:00-00:45")
    assert contains_private_audit_noise("brief_ref: bb_" + "a" * 64)
    assert contains_private_audit_noise("画面绑定 V01 与 F01")
    assert contains_private_audit_noise("证据 E-001")
    assert contains_private_audit_noise("画面绑定 V-01 与 F-01")
    assert not contains_private_audit_noise("ETH 在 4 小时图上测试前高阻力。")


def test_media_acquisition_heartbeat_keeps_last_verified_percent() -> None:
    source_heartbeat = media_acquisition_heartbeat(45)
    transcript_heartbeat = media_acquisition_heartbeat(60, 37)

    assert source_heartbeat.progress == 5
    assert source_heartbeat.total == 100
    assert "45 秒" in source_heartbeat.message
    assert transcript_heartbeat.progress == 37
    assert transcript_heartbeat.stage == "transcription_active"
    assert "60 秒" in transcript_heartbeat.message


def test_visual_intent_is_generic_and_deictic_cues_dominate() -> None:
    assert visual_intent_score("大家好欢迎关注") == 0
    assert visual_intent_score("趋势支撑阻力 K线 61.8% 成交量") == 0
    assert visual_intent_score("看这里，从这个高点到这个低点画一条线") > visual_intent_score(
        "趋势和支撑很重要"
    )
    assert visual_intent_score("look at this chart support line") > 0
    assert visual_intent_score("现在把鼠标滑动到这里再放大") > 0
    assert visual_intent_score("这个页面前后变化了") > 0
    assert visual_intent_score("放大收益预期，缩小风险暴露") == 0


@pytest.mark.parametrize(
    "text",
    (
        "从这个高点到这个低点画一条线",
        "刚才在阻力上方，现在回到阻力下方",
        "把鼠标移动到这里",
        "before the break, now the cursor moves here",
    ),
)
def test_ordered_relation_intent_is_generic(text: str) -> None:
    assert ordered_relation_intent(text)


@pytest.mark.parametrize(
    "text",
    ("趋势支撑阻力 K线 61.8%", "放大收益预期，缩小风险暴露", "BTC 采用日线周期"),
)
def test_domain_terms_do_not_create_ordered_relation_intent(text: str) -> None:
    assert not ordered_relation_intent(text)


async def test_zero_score_segments_never_displace_generic_screen_cues(
    tmp_path: Path,
) -> None:
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="通用视觉选择测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=4000,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(
                TranscriptSegment("E001", 0, 1000, "这个页面前后变化了"),
                TranscriptSegment("E002", 1000, 2000, "趋势支撑阻力 K线 61.8% 成交量"),
                TranscriptSegment("E003", 2000, 3000, "看这里的趋势线"),
                TranscriptSegment("E004", 3000, 4000, "从这个高点到这个低点"),
            ),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )
    media = RecordingSelectionMedia()

    frames = await media.extract_frames(source, tmp_path)

    assert media.selected_evidence == ["E003", "E004", "E001"]
    assert tuple(dict.fromkeys(frame.group_id for frame in frames)) == (
        "G01",
        "G02",
        "G03",
    )
    assert [
        sum(frame.group_id == group for frame in frames) for group in ("G01", "G02", "G03")
    ] == [1, 3, 1]
    assert [frame.selection_reason for frame in frames] == [
        "deictic_cue",
        "ordered_relation_cue",
        "ordered_relation_cue",
        "ordered_relation_cue",
        "visual_activity",
    ]


@pytest.mark.parametrize(
    "domain_texts",
    (
        (
            "这个页面前后变化了，价格结构随之更新",
            "趋势支撑阻力 K线 61.8% 成交量",
            "看这里的价格结构",
            "从这个高点到这个低点",
        ),
        (
            "这个页面前后变化了，函数调用随之更新",
            "Python 函数接口类型注解异步返回值",
            "看这里的函数调用",
            "从这个入参到这个返回值",
        ),
        (
            "这个页面前后变化了，表格列随之更新",
            "数据透视表单元格公式汇总筛选",
            "看这里的表格列",
            "从这个单元格到这个汇总行",
        ),
    ),
)
async def test_visual_selector_is_domain_invariant_for_the_same_generic_cue_structure(
    tmp_path: Path,
    domain_texts: tuple[str, str, str, str],
) -> None:
    workspace = tmp_path
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="跨领域视觉选择测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=4000,
        ),
        media_path=workspace / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=tuple(
                TranscriptSegment(f"E{index:03d}", (index - 1) * 1000, index * 1000, text)
                for index, text in enumerate(domain_texts, start=1)
            ),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )
    media = RecordingSelectionMedia()

    await media.extract_frames(source, workspace)

    assert media.selected_evidence == ["E003", "E004", "E001"]


def test_frame_pixel_ceiling_passes_at_bound_and_fails_at_bound_plus_one() -> None:
    CreateBilibiliNote._validate_frames(
        (_frame(1, group_id="G01", width=1920, height=1080), _frame(2, group_id="G02"))
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_frames(
            (_frame(1, group_id="G01", width=1921, height=1080), _frame(2, group_id="G02"))
        )

    assert failure.value.reason == "frame_dimensions_invalid"


def test_frame_and_aggregate_bytes_are_independently_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(create_note_module, "FRAME_PNG_BYTES", 16)
    monkeypatch.setattr(create_note_module, "FRAME_PNG_TOTAL_BYTES", 24)
    minimal = b"\x89PNG\r\n\x1a\n"
    at_bound = b"\x89PNG\r\n\x1a\n" + b"x" * 8
    CreateBilibiliNote._validate_frames(
        (
            _frame(1, group_id="G01", png_bytes=at_bound),
            _frame(2, group_id="G02", png_bytes=minimal),
        )
    )

    with pytest.raises(BilibiliNoteFailure) as individual:
        CreateBilibiliNote._validate_frames(
            (
                _frame(1, group_id="G01", png_bytes=at_bound + b"x"),
                _frame(2, group_id="G02", png_bytes=minimal),
            )
        )
    assert individual.value.reason == "frame_png_bytes_exceeded"

    with pytest.raises(BilibiliNoteFailure) as aggregate:
        CreateBilibiliNote._validate_frames(
            (
                _frame(1, group_id="G01", png_bytes=at_bound),
                _frame(2, group_id="G02", png_bytes=minimal + b"x"),
            )
        )
    assert aggregate.value.reason == "frame_png_total_bytes_exceeded"


def test_application_rejects_two_member_visual_group() -> None:
    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_frames(
            (
                _frame(1, group_id="G01"),
                _frame(2, group_id="G01"),
            )
        )

    assert failure.value.reason == "frame_group_size_invalid"


def _ordered_and_singleton_frames() -> tuple[FrameAsset, ...]:
    return (
        _frame(
            1,
            group_id="G01",
            timestamp_ms=1000,
            selection_reason="ordered_relation_cue",
        ),
        _frame(
            2,
            group_id="G01",
            timestamp_ms=2000,
            selection_reason="ordered_relation_cue",
        ),
        _frame(
            3,
            group_id="G01",
            timestamp_ms=3000,
            selection_reason="ordered_relation_cue",
        ),
        _frame(4, group_id="G02", timestamp_ms=4000),
    )


def test_application_accepts_one_host_marked_ordered_group() -> None:
    CreateBilibiliNote._validate_frames(_ordered_and_singleton_frames())


@pytest.mark.parametrize("reason", ("deictic_cue", "visual_activity", "coverage"))
def test_application_rejects_unmarked_three_frame_group(
    reason: Literal["deictic_cue", "visual_activity", "coverage"],
) -> None:
    frames = tuple(
        replace(frame, selection_reason=reason) if frame.group_id == "G01" else frame
        for frame in _ordered_and_singleton_frames()
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_frames(frames)

    assert failure.value.reason == "ordered_group_cue_invalid"


def test_application_rejects_unordered_three_frame_timeline() -> None:
    frames = _ordered_and_singleton_frames()
    malformed = (frames[0], replace(frames[1], timestamp_ms=1000), *frames[2:])

    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_frames(malformed)

    assert failure.value.reason == "frame_group_timeline_invalid"


def test_candidate_evidence_basis_must_match_host_group_shape() -> None:
    ordered_frames = _ordered_and_singleton_frames()
    static_frames = (_frame(1, group_id="G01"), _frame(2, group_id="G02"))
    candidate = DistillCandidate(
        rules=(
            (_rule("顺势交易。"), ("E001",)),
            (_rule("等待确认。"), ("E001",)),
            (_rule("失效后退出。"), ("E001",)),
        ),
        visuals=(
            CandidateVisual("supports_rule", 0, "ordered_relation"),
            CandidateVisual("no_material_increment", None, None),
        ),
        model_ref="fixture",
        profile_material_refs=(),
    )

    with pytest.raises(BilibiliNoteFailure) as static_on_ordered:
        CreateBilibiliNote._validate_candidate_visuals(
            replace(
                candidate,
                visuals=(
                    replace(candidate.visuals[0], evidence_basis="static_frame"),
                    *candidate.visuals[1:],
                ),
            ),
            ordered_frames,
        )
    with pytest.raises(BilibiliNoteFailure) as ordered_on_static:
        CreateBilibiliNote._validate_candidate_visuals(
            replace(
                candidate,
                visuals=(
                    candidate.visuals[0],
                    *candidate.visuals[1:],
                ),
            ),
            static_frames,
        )

    assert static_on_ordered.value.reason == "visual_evidence_basis_invalid"
    assert ordered_on_static.value.reason == "visual_evidence_basis_invalid"


@pytest.mark.parametrize(
    "mutation",
    ("speech", "context", "relation"),
)
async def test_ordered_relation_requires_all_independent_verifier_guards(
    mutation: str,
) -> None:
    candidate = DistillCandidate(
        rules=(
            (_rule("价格从阻力上方回到下方后转为空头偏好。"), ("E001",)),
            (_rule("等待有序变化确认。"), ("E001",)),
            (_rule("在关键位置观察价格反应。"), ("E001",)),
            (_rule("结合结构信号确认方向。"), ("E001",)),
            (_rule("不明确时保持观望。"), ("E001",)),
            (_rule("结构失效后退出。"), ("E001",)),
        ),
        visuals=(CandidateVisual("supports_rule", 0, "ordered_relation"),),
        model_ref="fixture",
        profile_material_refs=(),
    )
    verification = await DeterministicCandidateVerifier().verify(
        None,
        (),
        candidate,  # type: ignore[arg-type]
    )
    first = verification.visuals[0]
    if mutation == "speech":
        first = replace(first, speech_authorized="reject")
    elif mutation == "context":
        first = replace(first, same_visual_context="reject")
    else:
        first = replace(first, ordered_relation_support="reject")
    rejected = replace(verification, visuals=(first,))

    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_verification(candidate, rejected)

    assert failure.value.reason == "visual_ordered_relation_rejected"


async def test_static_basis_rejects_verifier_detected_ordered_rule() -> None:
    candidate = DistillCandidate(
        rules=(
            (_rule("价格前后变化形成方向偏好。"), ("E001",)),
            (_rule("等待确认。"), ("E001",)),
            (_rule("在关键位置观察价格反应。"), ("E001",)),
            (_rule("结合结构信号确认方向。"), ("E001",)),
            (_rule("不明确时保持观望。"), ("E001",)),
            (_rule("失效后退出。"), ("E001",)),
        ),
        visuals=(CandidateVisual("supports_rule", 0, "static_frame"),),
        model_ref="fixture",
        profile_material_refs=(),
    )
    verification = await DeterministicCandidateVerifier().verify(
        None,
        (),
        candidate,  # type: ignore[arg-type]
    )
    incompatible = replace(
        verification.visuals[0],
        rule_relation="ordered",
        speech_authorized="accept",
        same_visual_context="accept",
        ordered_relation_support="accept",
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_verification(
            candidate, replace(verification, visuals=(incompatible,))
        )

    assert failure.value.reason == "visual_relation_basis_rejected"


@pytest.mark.parametrize("frame_count", (0, 1, 6))
def test_application_rejects_visual_count_outside_two_to_five(frame_count: int) -> None:
    frames = tuple(_frame(index, group_id=f"G{index:02d}") for index in range(1, frame_count + 1))

    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_frames(frames)

    assert failure.value.reason == "visual_count_invalid"


def _medoid_candidates(tmp_path: Path, labels: str) -> tuple[_Decoded, ...]:
    colors = {"A": "black", "B": "white"}
    candidates: list[_Decoded] = []
    for index, label in enumerate(labels):
        path = tmp_path / f"{index}-{label}.png"
        Image.new("RGB", (320, 180), colors[label]).save(path, format="PNG")
        candidates.append(_Decoded(timestamp_ms=index * 1000, path=path))
    return tuple(candidates)


@pytest.mark.parametrize(
    ("labels", "expected_index"),
    (("ABBBB", 2), ("AAABB", 2)),
)
def test_visual_medoid_uses_majority_scene_and_midpoint_tie_break(
    tmp_path: Path, labels: str, expected_index: int
) -> None:
    candidates = _medoid_candidates(tmp_path, labels)

    selected = _select_visual_medoid(candidates, midpoint_ms=2000)

    assert selected == candidates[expected_index]


def test_integer_visual_distance_preserves_local_change_and_is_symmetric(
    tmp_path: Path,
) -> None:
    unchanged = tmp_path / "unchanged.png"
    changed = tmp_path / "changed.png"
    Image.new("RGB", (320, 180), "black").save(unchanged, format="PNG")
    changed_image = Image.new("RGB", (320, 180), "black")
    ImageDraw.Draw(changed_image).rectangle((120, 60, 159, 89), fill="white")
    changed_image.save(changed, format="PNG")
    left = _visual_profile(unchanged)
    right = _visual_profile(changed)

    forward = _integer_visual_distance(left, right)

    assert isinstance(forward, int)
    assert forward == (5 + 84) * 40 * 30 * 255
    assert forward == _integer_visual_distance(right, left)


def test_visual_medoid_does_not_pair_frames_across_scene_cut(tmp_path: Path) -> None:
    candidates: list[_Decoded] = []
    for index, color in enumerate(("blue", "blue", "red", "red", "red")):
        path = tmp_path / f"scene-{index}.png"
        image = Image.new("RGB", (320, 180), color)
        if index >= 2:
            ImageDraw.Draw(image).rectangle((20 * index, 20, 20 * index + 5, 25), fill="white")
        image.save(path, format="PNG")
        candidates.append(_Decoded(timestamp_ms=index * 1000, path=path))

    selected = _select_visual_medoid(tuple(candidates), midpoint_ms=2000)

    assert selected in candidates[2:]


def test_ordered_moment_medoid_authority_excludes_endpoints(tmp_path: Path) -> None:
    values = (0, 0, 100, 200, 0)
    candidates: list[_Decoded] = []
    for index, value in enumerate(values):
        path = tmp_path / f"interior-{index}.png"
        Image.new("L", (320, 180), value).save(path, format="PNG")
        candidates.append(_Decoded(timestamp_ms=index * 1000, path=path))

    selected = _select_ordered_visual_moment(tuple(candidates))

    assert selected == (candidates[0], candidates[2], candidates[4])


def test_ordered_interior_medoid_tie_uses_time_authority(tmp_path: Path) -> None:
    timestamps = (0, 100, 900, 950, 1000)
    candidates: list[_Decoded] = []
    for index, timestamp in enumerate(timestamps):
        path = tmp_path / f"time-tie-{index}.png"
        Image.new("L", (320, 180), 50).save(path, format="PNG")
        candidates.append(_Decoded(timestamp_ms=timestamp, path=path))

    selected = _select_ordered_visual_moment(tuple(candidates))

    assert selected == (candidates[0], candidates[1], candidates[4])


@pytest.mark.parametrize(
    ("collision", "expected_count"),
    (("none", 3), ("timestamp", 1)),
)
async def test_ordered_window_atomically_degrades_collisions_to_singleton(
    tmp_path: Path, collision: str, expected_count: int
) -> None:
    duration_ms = 1000 if collision == "timestamp" else 5000
    segment = TranscriptSegment("E001", 0, duration_ms, "从这里到那里")
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="有序视觉窗测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=duration_ms,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(segment,),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )

    class ControlledProbeMedia(FfmpegMedia):
        async def _decode(
            self,
            media_path: Path,
            timestamp_ms: int,
            workspace: Path,
            stem: str,
            width: int,
            height: int,
        ) -> _Decoded:
            del media_path, width, height
            index = int(stem.rsplit("-", 1)[1])
            value = 20 + index * 30
            path = workspace / f"controlled-{index}.png"
            Image.new("L", (320, 180), value).save(path, format="PNG")
            return _Decoded(timestamp_ms=timestamp_ms, path=path)

    frames = await ControlledProbeMedia()._decode_window(
        source,
        segment,
        tmp_path,
        1280,
        720,
        retain_ordered=True,
    )

    assert len(frames) == expected_count


async def test_asset_collision_atomically_degrades_ordered_group_during_bounded_read(
    tmp_path: Path,
) -> None:
    segment = TranscriptSegment("E001", 0, 5000, "从这里到那里")
    source = AcquiredSource(
        source=SourceV1(
            platform="bilibili",
            requested_url=FIXTURE_URL,
            canonical_url=FIXTURE_URL,
            video_id="BV1bK411W797",
            part_id="1",
            part_index=1,
            title="有序视觉摘要碰撞测试",
            author_name="测试作者",
            published_at="2026-08-16T00:00:00Z",
            duration_ms=5000,
        ),
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            method="platform_subtitle",
            provider_ref=None,
            language="zh-CN",
            segments=(segment,),
        ),
        source_snapshot_ref="bs_" + "a" * 64,
    )

    class DuplicateEndpointMedia(RecordingSelectionMedia):
        async def _decode_window(
            self,
            source: AcquiredSource,
            segment: TranscriptSegment,
            workspace: Path,
            width: int,
            height: int,
            *,
            retain_ordered: bool,
        ) -> tuple[_Decoded, ...]:
            del source, width, height
            assert retain_ordered
            self.selected_evidence.append(segment.evidence_id)
            paths = tuple(workspace / f"duplicate-endpoint-{index}.png" for index in range(3))
            for index, path in enumerate(paths):
                value = 0 if index in (0, 2) else 100
                Image.new("L", (1280, 720), value).save(path, format="PNG")
            return tuple(
                _Decoded(timestamp_ms=(index + 1) * 1000, path=path)
                for index, path in enumerate(paths)
            )

    frames = await DuplicateEndpointMedia().extract_frames(source, tmp_path)

    groups = tuple(dict.fromkeys(frame.group_id for frame in frames))
    assert len(frames) == 3
    assert len(groups) == 3
    assert all(sum(frame.group_id == group for frame in frames) == 1 for group in groups)


def test_direct_candidate_rejects_normalized_duplicate_public_items() -> None:
    candidate = DistillCandidate(
        rules=(
            (_rule("BTC 趋势过滤。"), ("E001",)),
            (_rule("btc   趋势过滤。"), ("E001",)),
            (_rule("结构失效时停止沿用原方向。"), ("E001",)),
        ),
        visuals=(),
        model_ref="fixture",
        profile_material_refs=(),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        CreateBilibiliNote._validate_candidate_text(candidate)

    assert failure.value.reason == "model_public_items_not_unique"


async def test_decoded_duration_must_match_source_identity(tmp_path: Path) -> None:
    fixture = generate_fixture(tmp_path / "fixture")
    source_path = fixture / "source.json"
    source = json.loads(source_path.read_text(encoding="utf-8"))
    source["duration_ms"] = 9000
    source_path.write_text(json.dumps(source), encoding="utf-8")
    (fixture / "subtitles.vtt").write_text(
        "WEBVTT\n\n00:00:00.000 --> 00:00:09.000\ncontinuous but mismatched\n",
        encoding="utf-8",
    )
    use_case = CreateBilibiliNote(
        source=FixtureSource(fixture),
        media=FfmpegMedia(),
        distiller=DeterministicDistiller(),
        verifier=DeterministicCandidateVerifier(),
        renderer=MarkdownRenderer(),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await use_case.execute(FIXTURE_URL)
    assert failure.value.code == "SOURCE_CHANGED"
    assert failure.value.reason == "media_duration_changed"
