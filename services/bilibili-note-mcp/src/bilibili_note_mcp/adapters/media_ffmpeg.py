from __future__ import annotations

import asyncio
import hashlib
import math
import re
from collections.abc import Awaitable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from PIL import Image

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.owned_tasks import finish_owned_task
from bilibili_note_mcp.application.ports import AcquiredSource, FrameAsset, TranscriptSegment
from bilibili_note_mcp.application.resource_limits import (
    FRAME_MAX_PIXELS,
    FRAME_MIN_SIDE,
    FRAME_PNG_BYTES,
    FRAME_PNG_TOTAL_BYTES,
    MEDIA_SOURCE_MAX_PIXELS,
    MEDIA_SOURCE_MAX_SIDE,
    SUBPROCESS_STDERR_BYTES,
    SUBPROCESS_STDOUT_BYTES,
)

from .strict_json import StrictJsonError, decode_strict_json_object, parse_finite_decimal_string
from .subprocesses import ProcessOutputLimitExceeded, run_captured

_DEICTIC = re.compile(
    r"看(?:这里|这边|这个|一下|图|屏幕)|注意(?:这里|这边|这个)|从.{0,12}到.{0,12}|"
    r"你会看到|可以看到|画(?:一条|出来|线)|指(?:这里|这个)|鼠标|"
    r"look at|see here|on (?:the )?screen",
    re.IGNORECASE,
)
_SCREEN_INTERACTION = re.compile(
    r"(?:屏幕|页面|窗口|界面|鼠标|光标).{0,12}"
    r"(?:展示|切换|移动|放大|缩小|拖动|滑动|点击|框选|打开)|"
    r"(?:展示|切换|移动|放大|缩小|拖动|滑动|点击|框选|打开).{0,12}"
    r"(?:屏幕|页面|窗口|界面|鼠标|光标)|"
    r"(?:screen|page|window|mouse|cursor).{0,24}"
    r"(?:show|switch|move|zoom|scroll|drag|click)|"
    r"(?:show|switch|move|zoom|scroll|drag|click).{0,24}"
    r"(?:screen|page|window|mouse|cursor)",
    re.IGNORECASE,
)
_VISUAL_CHANGE = re.compile(
    r"这里.{0,12}(?:出现|消失|变化)|(?:屏幕|页面|窗口|界面|画面)"
    r".{0,12}(?:出现|消失|前后变化)|(?:刚才|之前).{0,12}现在",
)
_ORDERED_RELATION = re.compile(
    r"从.{0,12}到.{0,12}|(?:刚才|之前|此前).{0,16}(?:现在|当前|此刻)|"
    r"(?:前后|先后).{0,12}(?:变化|移动|切换|出现|消失)|"
    r"(?:鼠标|光标).{0,12}(?:移动|拖动|滑动|划到)|"
    r"(?:before|previously).{0,24}(?:now|after)|from .{0,24} to .{0,24}|"
    r"(?:mouse|cursor).{0,24}(?:move|drag|slide|scroll)",
    re.IGNORECASE,
)
_MAX_CONCURRENT_DECODES = 3
_PROFILE_WIDTH = 320
_PROFILE_HEIGHT = 180
_TILE_WIDTH = 40
_TILE_HEIGHT = 30
_GLOBAL_DISTANCE_WEIGHT = 5
_LOCAL_DISTANCE_WEIGHT = 84
_SelectionReason = Literal["deictic_cue", "visual_activity", "ordered_relation_cue", "coverage"]


async def _run(*command: str) -> tuple[int, bytes, bytes]:
    try:
        result = await run_captured(
            *command,
            timeout_seconds=60,
            stdout_limit_bytes=SUBPROCESS_STDOUT_BYTES,
            stderr_limit_bytes=SUBPROCESS_STDERR_BYTES,
        )
    except TimeoutError as e:
        raise BilibiliNoteFailure("DEADLINE_EXCEEDED", "media_subprocess_timeout") from e
    except ProcessOutputLimitExceeded as e:
        raise BilibiliNoteFailure("INTERNAL", "media_subprocess_output_exceeded") from e
    return result.returncode, result.stdout, result.stderr


def visual_intent_score(text: str) -> int:
    """Generic speech-to-screen intent heuristic; never promoted to output evidence."""
    deictic = len(_DEICTIC.findall(text))
    interaction = len(_SCREEN_INTERACTION.findall(text))
    change = len(_VISUAL_CHANGE.findall(text))
    return deictic * 6 + interaction * 3 + change * 3


def ordered_relation_intent(text: str) -> bool:
    """Detect generic speech intent that may require ordered observations; never prove motion."""
    return _ORDERED_RELATION.search(text) is not None


def _selection_reason(text: str) -> _SelectionReason:
    """Bind the reason to the cue class that actually matched, not a score threshold."""
    return "deictic_cue" if _DEICTIC.search(text) is not None else "visual_activity"


@dataclass(frozen=True, slots=True)
class _Decoded:
    timestamp_ms: int
    path: Path


def _visual_profile(path: Path) -> bytes:
    with Image.open(path) as image:
        return (
            image.convert("L")
            .resize(
                (_PROFILE_WIDTH, _PROFILE_HEIGHT),
                Image.Resampling.BICUBIC,
            )
            .tobytes()
        )


def _integer_visual_distance(left: bytes, right: bytes) -> int:
    """Integer global-plus-local pixel distance for deterministic medoid selection."""
    if len(left) != _PROFILE_WIDTH * _PROFILE_HEIGHT or len(right) != len(left):
        raise ValueError("visual profile dimensions are invalid")
    tile_columns = _PROFILE_WIDTH // _TILE_WIDTH
    tile_sums = [0] * (tile_columns * (_PROFILE_HEIGHT // _TILE_HEIGHT))
    global_sum = 0
    for offset, (left_value, right_value) in enumerate(zip(left, right, strict=True)):
        difference = abs(left_value - right_value)
        global_sum += difference
        x = offset % _PROFILE_WIDTH
        y = offset // _PROFILE_WIDTH
        tile_sums[(y // _TILE_HEIGHT) * tile_columns + x // _TILE_WIDTH] += difference
    return _GLOBAL_DISTANCE_WEIGHT * global_sum + _LOCAL_DISTANCE_WEIGHT * max(tile_sums)


def _select_visual_medoid(candidates: tuple[_Decoded, ...], *, midpoint_ms: int) -> _Decoded:
    """Choose the central nearest medoid among exactly five ordered probes."""
    if len(candidates) != 5:
        raise ValueError("visual medoid requires exactly five probes")
    profiles = tuple(_visual_profile(candidate.path) for candidate in candidates)
    totals = [0] * len(candidates)
    for left_index in range(len(candidates)):
        for right_index in range(left_index + 1, len(candidates)):
            distance = _integer_visual_distance(profiles[left_index], profiles[right_index])
            totals[left_index] += distance
            totals[right_index] += distance
    selected_index = min(
        range(len(candidates)),
        key=lambda index: (
            totals[index],
            abs(candidates[index].timestamp_ms - midpoint_ms),
            candidates[index].timestamp_ms,
            index,
        ),
    )
    return candidates[selected_index]


def _select_ordered_visual_moment(candidates: tuple[_Decoded, ...]) -> tuple[_Decoded, ...]:
    """Select earliest, interior medoid and latest from the existing five probes."""
    if len(candidates) != 5:
        raise ValueError("ordered visual moment requires exactly five probes")
    interior = candidates[1:4]
    profiles = tuple(_visual_profile(candidate.path) for candidate in interior)
    totals = [0] * len(interior)
    for left_index in range(len(interior)):
        for right_index in range(left_index + 1, len(interior)):
            distance = _integer_visual_distance(profiles[left_index], profiles[right_index])
            totals[left_index] += distance
            totals[right_index] += distance
    midpoint_ms = (candidates[0].timestamp_ms + candidates[4].timestamp_ms) // 2
    selected_index = min(
        range(len(interior)),
        key=lambda index: (
            totals[index],
            abs(interior[index].timestamp_ms - midpoint_ms),
            interior[index].timestamp_ms,
            index,
        ),
    )
    return (candidates[0], interior[selected_index], candidates[4])


@dataclass(frozen=True, slots=True)
class _SelectedGroup:
    decoded: tuple[_Decoded, ...]
    segment: TranscriptSegment
    reason: _SelectionReason


@dataclass(frozen=True, slots=True)
class _DecodeJob:
    ordinal: int
    segment: TranscriptSegment
    reason: _SelectionReason
    retain_ordered: bool
    decoded: Awaitable[tuple[_Decoded, ...] | _Decoded]


class FfmpegMedia:
    def __init__(self) -> None:
        self._decode_gate = asyncio.Semaphore(_MAX_CONCURRENT_DECODES)

    async def extract_frames(
        self, source: AcquiredSource, workspace: Path
    ) -> tuple[FrameAsset, ...]:
        width, height = await self._probe(source)
        ranked = sorted(
            (
                segment
                for segment in source.transcript.segments
                if visual_intent_score(segment.text)
            ),
            key=lambda item: (-visual_intent_score(item.text), item.start_ms),
        )
        selected_segments = ranked[:3]
        decode_jobs: list[_DecodeJob] = []
        ordinal = 0
        ordered_budget_available = True
        requested_frames = 0

        for segment in selected_segments:
            retain_ordered = ordered_budget_available and ordered_relation_intent(segment.text)
            if retain_ordered:
                ordered_budget_available = False
            requested_frames += 3 if retain_ordered else 1
            ordinal += 1
            decode_jobs.append(
                _DecodeJob(
                    ordinal=ordinal,
                    segment=segment,
                    reason=_selection_reason(segment.text),
                    retain_ordered=retain_ordered,
                    decoded=self._decode_window(
                        source,
                        segment,
                        workspace,
                        width,
                        height,
                        retain_ordered=retain_ordered,
                    ),
                )
            )

        # Two broad anchors protect non-deictic videos from a cue-only blind spot.
        for ratio in (1 / 3, 2 / 3):
            if requested_frames >= 5:
                break
            timestamp = min(
                source.source.duration_ms - 1,
                max(0, int(source.source.duration_ms * ratio)),
            )
            segment = min(
                source.transcript.segments,
                key=lambda item: (
                    0
                    if item.start_ms <= timestamp <= item.end_ms
                    else min(abs(timestamp - item.start_ms), abs(timestamp - item.end_ms))
                ),
            )
            ordinal += 1
            requested_frames += 1
            decode_jobs.append(
                _DecodeJob(
                    ordinal=ordinal,
                    segment=segment,
                    reason="coverage",
                    retain_ordered=False,
                    decoded=self._decode(
                        source.media_path,
                        timestamp,
                        workspace,
                        f"coverage-{ordinal}",
                        width,
                        height,
                    ),
                )
            )

        async def _decode_job(job: _DecodeJob) -> tuple[int, _SelectedGroup]:
            decoded_result = await job.decoded
            decoded_frames = (
                (decoded_result,) if isinstance(decoded_result, _Decoded) else decoded_result
            )
            reason: _SelectionReason = (
                "ordered_relation_cue"
                if job.retain_ordered and len(decoded_frames) == 3
                else job.reason
            )
            return job.ordinal, _SelectedGroup(decoded_frames, job.segment, reason)

        tasks = tuple(asyncio.create_task(_decode_job(job)) for job in decode_jobs)
        group = asyncio.gather(*tasks)
        try:
            decoded_groups = await asyncio.shield(group)
        finally:

            async def cleanup() -> None:
                for task in tasks:
                    if not task.done() and task.cancelling() == 0:
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                await asyncio.gather(group, return_exceptions=True)

            coordinator = asyncio.create_task(cleanup())
            await finish_owned_task(coordinator)
        selected_groups = [
            selected_group for _, selected_group in sorted(decoded_groups, key=lambda item: item[0])
        ]

        frames: list[FrameAsset] = []
        seen_digests: set[str] = set()
        aggregate_bytes = 0
        for selected in selected_groups:
            accepted: list[tuple[_Decoded, bytes, int, int, str]] = []
            for decoded_frame in selected.decoded:
                size = await asyncio.to_thread(decoded_frame.path.stat)
                if size.st_size > FRAME_PNG_BYTES:
                    raise BilibiliNoteFailure(
                        "VISUAL_EVIDENCE_INCOMPLETE", "frame_png_bytes_exceeded"
                    )
                png = await asyncio.to_thread(decoded_frame.path.read_bytes)
                if len(png) > FRAME_PNG_BYTES:
                    raise BilibiliNoteFailure(
                        "VISUAL_EVIDENCE_INCOMPLETE", "frame_png_bytes_exceeded"
                    )
                with Image.open(decoded_frame.path) as image:
                    frame_width, frame_height = image.size
                    image.verify()
                if (
                    min(frame_width, frame_height) < FRAME_MIN_SIDE
                    or frame_width * frame_height > FRAME_MAX_PIXELS
                ):
                    raise BilibiliNoteFailure(
                        "VISUAL_EVIDENCE_INCOMPLETE", "frame_dimensions_invalid"
                    )
                digest = hashlib.sha256(png).hexdigest()
                accepted.append((decoded_frame, png, frame_width, frame_height, digest))
            if len({item[4] for item in accepted}) != len(accepted) or any(
                item[4] in seen_digests for item in accepted
            ):
                if len(accepted) == 3 and accepted[1][4] not in seen_digests:
                    accepted = [accepted[1]]
                else:
                    accepted = []
            if len(accepted) not in (1, 3):
                continue
            seen_digests.update(item[4] for item in accepted)
            group_id = f"G{len({frame.group_id for frame in frames}) + 1:02d}"
            for decoded_frame, png, frame_width, frame_height, digest in accepted:
                aggregate_bytes += len(png)
                if aggregate_bytes > FRAME_PNG_TOTAL_BYTES:
                    raise BilibiliNoteFailure(
                        "VISUAL_EVIDENCE_INCOMPLETE", "frame_png_total_bytes_exceeded"
                    )
                frames.append(
                    FrameAsset(
                        frame_id=f"F{len(frames) + 1:02d}",
                        group_id=group_id,
                        timestamp_ms=decoded_frame.timestamp_ms,
                        width=frame_width,
                        height=frame_height,
                        png_bytes=png,
                        asset_ref=digest,
                        transcript_refs=(selected.segment.evidence_id,),
                        selection_reason=selected.reason,
                    )
                )
        group_count = len({frame.group_id for frame in frames})
        if not 2 <= len(frames) <= 5 or not 2 <= group_count <= 5:
            raise BilibiliNoteFailure("VISUAL_EVIDENCE_INCOMPLETE", "visual_count_invalid")
        return tuple(frames)

    async def _probe(self, source: AcquiredSource) -> tuple[int, int]:
        code, stdout, _ = await _run(
            "ffprobe",
            "-protocol_whitelist",
            "file,pipe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration",
            "-of",
            "json",
            str(source.media_path),
        )
        if code != 0:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "ffprobe_rejected_media")
        try:
            stream = decode_strict_json_object(stdout)["streams"][0]
            width, height = stream["width"], stream["height"]
            observed_duration_ms = round(parse_finite_decimal_string(stream["duration"]) * 1000)
        except (
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            OverflowError,
            StrictJsonError,
        ) as e:
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_dimensions_invalid") from e
        if (
            not isinstance(width, int)
            or isinstance(width, bool)
            or not isinstance(height, int)
            or isinstance(height, bool)
        ):
            raise BilibiliNoteFailure("SOURCE_UNAVAILABLE", "media_dimensions_invalid")
        if (
            width * height < 1280 * 720
            or width * height > MEDIA_SOURCE_MAX_PIXELS
            or max(width, height) > MEDIA_SOURCE_MAX_SIDE
            or min(width, height) < 720
        ):
            raise BilibiliNoteFailure("HD_SOURCE_UNAVAILABLE", "source_below_hd_floor")
        if (
            not math.isfinite(observed_duration_ms)
            or observed_duration_ms <= 0
            or abs(observed_duration_ms - source.source.duration_ms) > 1500
        ):
            raise BilibiliNoteFailure("SOURCE_CHANGED", "media_duration_changed")
        return width, height

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
        span = segment.end_ms - segment.start_ms
        timestamps = tuple(
            min(
                max(0, source.source.duration_ms - 1000),
                segment.start_ms + int(span * ratio),
            )
            for ratio in (0.12, 0.32, 0.5, 0.68, 0.88)
        )
        tasks = tuple(
            asyncio.create_task(
                self._decode(
                    source.media_path,
                    timestamp,
                    workspace,
                    f"probe-{segment.evidence_id}-{index}",
                    width,
                    height,
                )
            )
            for index, timestamp in enumerate(timestamps)
        )
        group = asyncio.gather(*tasks)
        try:
            candidates = tuple(await asyncio.shield(group))
        finally:

            async def cleanup() -> None:
                for task in tasks:
                    if not task.done() and task.cancelling() == 0:
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                await asyncio.gather(group, return_exceptions=True)

            coordinator = asyncio.create_task(cleanup())
            await finish_owned_task(coordinator)
        medoid = _select_visual_medoid(
            candidates,
            midpoint_ms=(segment.start_ms + segment.end_ms) // 2,
        )
        if not retain_ordered:
            return (medoid,)
        selected = _select_ordered_visual_moment(candidates)
        timestamps = tuple(item.timestamp_ms for item in selected)
        if len(set(timestamps)) != 3 or timestamps != tuple(sorted(timestamps)):
            return (medoid,)
        return selected

    async def _decode(
        self,
        media_path: Path,
        timestamp_ms: int,
        workspace: Path,
        stem: str,
        width: int,
        height: int,
    ) -> _Decoded:
        output = workspace / f"{stem}-{timestamp_ms}.png"
        async with self._decode_gate:
            code, _, _ = await _run(
                "ffmpeg",
                "-nostdin",
                "-protocol_whitelist",
                "file,pipe",
                "-v",
                "error",
                "-ss",
                f"{timestamp_ms / 1000:.3f}",
                "-i",
                str(media_path),
                "-frames:v",
                "1",
                "-vf",
                (
                    "scale="
                    + (
                        "'min(iw,1920)':'min(ih,1080)'"
                        if width >= height
                        else "'min(iw,1080)':'min(ih,1920)'"
                    )
                    + ":force_original_aspect_ratio=decrease:force_divisible_by=2"
                ),
                "-c:v",
                "png",
                "-y",
                str(output),
            )
        if code != 0 or not output.is_file():
            raise BilibiliNoteFailure("VISUAL_EVIDENCE_INCOMPLETE", "frame_decode_failed")
        return _Decoded(timestamp_ms=timestamp_ms, path=output)
