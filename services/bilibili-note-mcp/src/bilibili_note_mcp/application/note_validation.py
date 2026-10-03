"""Pure validation of authored evidence and extracted original frames."""

from __future__ import annotations

import hashlib
from typing import Never

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.ports import AcquiredSource, FrameAsset
from bilibili_note_mcp.application.resource_limits import (
    FRAME_MAX_PIXELS,
    FRAME_MIN_SIDE,
    FRAME_PNG_BYTES,
    FRAME_PNG_TOTAL_BYTES,
)
from bilibili_note_mcp.domain.models import FailureCode, VideoNote


def _raise(code: FailureCode, reason: str) -> Never:
    raise BilibiliNoteFailure(code, reason)


def validate_note(
    note: VideoNote,
    source: AcquiredSource,
    frames: tuple[FrameAsset, ...],
    *,
    omit_invalid_screenshots: bool = False,
) -> VideoNote:
    evidence = {s.evidence_id: s for s in source.transcript.segments}
    frame_map = {f.frame_id: f for f in frames}
    texts = [*note.overview, *note.takeaways, *(p for c in note.chapters for p in c.points)]
    if sum(len(t.text.encode()) for t in texts) > 120000:
        _raise("OUTPUT_INVALID", "note_text_too_large")
    for p in texts:
        if (
            len(set(p.evidence_refs)) != len(p.evidence_refs)
            or not set(p.evidence_refs) <= evidence.keys()
        ):
            _raise("DISTILLATION_FAILED", "note_evidence_invalid")
    previous = -1
    used: set[str] = set()
    chapters = []
    for c in note.chapters:
        refs = {e for p in c.points for e in p.evidence_refs}
        start = min(evidence[e].start_ms for e in refs)
        end = max(evidence[e].end_ms for e in refs)
        if start < previous:
            _raise("DISTILLATION_FAILED", "chapter_order_invalid")
        previous = start
        screenshots = []
        for image in c.screenshots:
            f = frame_map.get(image.frame_id)
            if (
                f is None
                or f.frame_id in used
                or not start <= f.timestamp_ms <= end
                or not f.transcript_refs
                or not set(f.transcript_refs) <= evidence.keys()
                or not min(evidence[e].start_ms for e in f.transcript_refs)
                <= f.timestamp_ms
                <= max(evidence[e].end_ms for e in f.transcript_refs)
            ):
                if omit_invalid_screenshots:
                    continue
                _raise("VISUAL_EVIDENCE_INCOMPLETE", "chapter_frame_binding_invalid")
            used.add(f.frame_id)
            screenshots.append(image)
        chapters.append(c.model_copy(update={"screenshots": tuple(screenshots)}))
    return note.model_copy(update={"chapters": tuple(chapters)})


def validate_frames(frames: tuple[FrameAsset, ...]) -> None:
    if not 2 <= len(frames) <= 48:
        _raise("VISUAL_EVIDENCE_INCOMPLETE", "visual_count_invalid")
    seen: set[str] = set()
    group_order: list[str] = []
    previous_group: str | None = None
    aggregate_bytes = 0
    groups: dict[str, list[FrameAsset]] = {}
    for index, frame in enumerate(frames, start=1):
        if frame.frame_id != f"F{index:02d}":
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_identity_invalid")
        if min(frame.width, frame.height) < FRAME_MIN_SIDE:
            _raise("HD_SOURCE_UNAVAILABLE", "source_below_hd_floor")
        if frame.width * frame.height > FRAME_MAX_PIXELS:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_dimensions_invalid")
        if frame.group_id != previous_group:
            if frame.group_id in group_order:
                _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_group_order_invalid")
            group_order.append(frame.group_id)
            previous_group = frame.group_id
        if frame.group_id != f"G{group_order.index(frame.group_id) + 1:02d}":
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_group_identity_invalid")
        if len(frame.png_bytes) > FRAME_PNG_BYTES:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_png_bytes_exceeded")
        aggregate_bytes += len(frame.png_bytes)
        if aggregate_bytes > FRAME_PNG_TOTAL_BYTES:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_png_total_bytes_exceeded")
        if not frame.png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "asset_not_png")
        if (
            hashlib.sha256(frame.png_bytes).hexdigest() != frame.asset_ref
            or frame.asset_ref in seen
        ):
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "asset_digest_invalid")
        seen.add(frame.asset_ref)
        groups.setdefault(frame.group_id, []).append(frame)
    ordered_groups = 0
    for group_frames in groups.values():
        if len(group_frames) not in (1, 3):
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_group_size_invalid")
        if len(group_frames) == 3:
            ordered_groups += 1
        if tuple(frame.timestamp_ms for frame in group_frames) != tuple(
            sorted({frame.timestamp_ms for frame in group_frames})
        ):
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_group_timeline_invalid")
        if len({(frame.width, frame.height) for frame in group_frames}) != 1:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_group_dimensions_invalid")
        if len({frame.transcript_refs for frame in group_frames}) != 1:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_group_binding_invalid")
        if len({frame.selection_reason for frame in group_frames}) != 1:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_group_reason_invalid")
        if len(group_frames) == 3 and any(
            frame.selection_reason != "ordered_relation_cue" for frame in group_frames
        ):
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "ordered_group_cue_invalid")
    if not 2 <= len(groups) <= 48:
        _raise("VISUAL_EVIDENCE_INCOMPLETE", "visual_group_count_invalid")
    if ordered_groups > 1:
        _raise("VISUAL_EVIDENCE_INCOMPLETE", "ordered_group_count_invalid")
