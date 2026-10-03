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
from bilibili_note_mcp.adapters.note_publisher import LocalNotePublisher
from bilibili_note_mcp.application import create_note as create_note_module
from bilibili_note_mcp.application.create_note import CreateBilibiliNote
from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import (
    AcquiredSource,
    FrameAsset,
    TranscriptResult,
    TranscriptSegment,
)
from bilibili_note_mcp.application.progress import media_acquisition_heartbeat
from bilibili_note_mcp.domain.models import SourceV1
from bilibili_note_mcp.fixture import FIXTURE_URL, generate_fixture


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

    # Cue jobs retain their frozen order even when decoding finishes out of order.
    assert tuple(frame.transcript_refs[0] for frame in frames[:3]) == ("E001", "E003", "E004")
    # Remaining budget reaches an uncovered section before repeating a cue window.
    assert frames[3].transcript_refs == ("E002",)
    assert [frame.frame_id for frame in frames] == [f"F{i:02d}" for i in range(1, 6)]
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


@pytest.mark.parametrize("frame_count", (0, 1, 49))
def test_application_rejects_visual_count_outside_two_to_forty_eight(frame_count: int) -> None:
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
        publisher=LocalNotePublisher(tmp_path / "notes"),
    )

    with pytest.raises(BilibiliNoteFailure) as failure:
        await use_case.execute(FIXTURE_URL)
    assert failure.value.code == "SOURCE_CHANGED"
    assert failure.value.reason == "media_duration_changed"


async def test_non_deictic_content_has_frames_across_early_middle_and_late_sections(
    tmp_path, draft
):
    source = AcquiredSource(
        source=draft.source,
        media_path=tmp_path / "unused.mp4",
        transcript=TranscriptResult(
            "platform_subtitle",
            None,
            "zh-CN",
            (TranscriptSegment("E001", 0, 4000, "水蒸气遇冷凝结。"),),
        ),
        source_snapshot_ref="fixture",
    )
    frames = await TracingDecodeMedia().extract_frames(source, tmp_path)
    assert len(frames) == 5
    assert min(f.timestamp_ms for f in frames) < 1000
    assert any(1600 <= f.timestamp_ms <= 2400 for f in frames)
    assert max(f.timestamp_ms for f in frames) > 3000
    assert all(f.transcript_refs == ("E001",) for f in frames)
    assert all(f.selection_reason == "coverage" for f in frames)


async def test_long_video_candidates_are_bounded_without_truncating_ending(tmp_path, draft):

    duration = 600_000
    source = AcquiredSource(
        draft.source.model_copy(update={"duration_ms": duration}),
        tmp_path / "source.mp4",
        TranscriptResult(
            "asr",
            "test",
            "zh",
            tuple(
                TranscriptSegment(f"E{i + 1:03d}", i * 6000, (i + 1) * 6000, "按顺序展示步骤。")
                for i in range(100)
            ),
            duration,
        ),
        "fixture",
    )
    frames = await TracingDecodeMedia().extract_frames(source, tmp_path)
    assert len(frames) == 48
    assert min(f.timestamp_ms for f in frames) < 15_000
    assert max(f.timestamp_ms for f in frames) > duration - 15_000
    timestamps = sorted(f.timestamp_ms for f in frames)
    assert max(b - a for a, b in zip(timestamps, timestamps[1:], strict=False)) <= 30_000


async def test_sentence_samples_capture_completed_steps_without_collapsing_coverage(
    tmp_path, draft
):
    segments = tuple(
        TranscriptSegment(f"E{i + 1:03}", i * 2000, (i + 1) * 2000, "依次加入材料。")
        for i in range(10)
    )
    source = AcquiredSource(
        draft.source.model_copy(update={"duration_ms": 20000}),
        tmp_path / "source.mp4",
        TranscriptResult("asr", "test", "zh", segments, 20000),
        "fixture",
    )
    frames = await TracingDecodeMedia().extract_frames(source, tmp_path)
    assert len(frames) == 5
    assert len({f.timestamp_ms for f in frames}) == 5
    for f in frames:
        s = next(s for s in segments if s.evidence_id == f.transcript_refs[0])
        assert s.end_ms - 200 <= f.timestamp_ms < s.end_ms
    assert min(f.timestamp_ms for f in frames) < 4000
    assert max(f.timestamp_ms for f in frames) > 16000


async def test_coarse_asr_windows_keep_temporal_samples(tmp_path, draft):
    segments = tuple(
        TranscriptSegment(f"E{i + 1:03}", i * 45000, (i + 1) * 45000, "介绍操作过程。")
        for i in range(5)
    )
    source = AcquiredSource(
        draft.source.model_copy(update={"duration_ms": 225000}),
        tmp_path / "source.mp4",
        TranscriptResult("asr", "test", "zh", segments, 225000),
        "fixture",
    )
    frames = await TracingDecodeMedia().extract_frames(source, tmp_path)
    assert len(frames) > len(segments)
    assert min(f.timestamp_ms for f in frames) < 15000
    assert max(f.timestamp_ms for f in frames) > 210000


async def test_webm_container_duration_supports_real_frame_decode(tmp_path, draft):
    from bilibili_note_mcp.adapters.subprocesses import run_captured

    path = tmp_path / "source.webm"
    result = await run_captured(
        "ffmpeg",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1280x720:rate=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000",
        "-t",
        "2",
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-c:a",
        "libopus",
        str(path),
        timeout_seconds=30,
        stdout_limit_bytes=1024,
        stderr_limit_bytes=4096,
    )
    assert result.returncode == 0
    source = AcquiredSource(
        draft.source.model_copy(update={"duration_ms": 2000}),
        path,
        TranscriptResult("platform_subtitle", None, "zh-CN", draft.transcript),
        "test",
    )
    media = FfmpegMedia()
    assert await media._probe(source) == (1280, 720)
    frame = await media._decode(path, 500, tmp_path, "webm-frame", 1280, 720)
    with Image.open(frame.path) as image:
        assert image.size == (1280, 720)
    changed = replace(source, source=source.source.model_copy(update={"duration_ms": 6000}))
    with pytest.raises(BilibiliNoteFailure, match="media_duration_changed"):
        await media._probe(changed)
