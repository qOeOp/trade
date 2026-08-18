from __future__ import annotations

import asyncio
import hashlib
import re
import tempfile
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Never, cast

from bilibili_note_mcp.application.errors import BilibiliNoteFailure
from bilibili_note_mcp.application.owned_tasks import finish_owned_task
from bilibili_note_mcp.application.ports import (
    AcquiredSource,
    CandidateVerification,
    CandidateVerifierPort,
    DistillCandidate,
    DistillerPort,
    FrameAsset,
    MediaPort,
    SourcePort,
    StrategySummaryRendererPort,
)
from bilibili_note_mcp.application.progress import (
    NullProgressReporter,
    ProgressReporter,
    ProgressStageV1,
    ProgressUpdateV1,
    media_acquisition_heartbeat,
    progress_update,
    visual_analysis_heartbeat,
)
from bilibili_note_mcp.application.public_text import (
    model_public_rule_representation_is_valid,
    rendered_contains_private_audit_noise,
    rendered_public_text_is_valid,
    rendered_summary_structure_is_valid,
)
from bilibili_note_mcp.application.resource_limits import (
    DIRECT_TERMINAL_BYTES,
    FRAME_MAX_PIXELS,
    FRAME_MIN_SIDE,
    FRAME_PNG_BYTES,
    FRAME_PNG_TOTAL_BYTES,
    TRANSCRIPT_TOTAL_BYTES,
)
from bilibili_note_mcp.domain.models import (
    BilibiliResearchBriefV2,
    BoundBriefItemV2,
    CoverageV2,
    EvidenceSegmentV2,
    FailureCode,
    ProvenanceV2,
    PublicRuleV1,
    StrategySummaryV1,
    VisualInsightV2,
    summary_items_are_distinct,
)
from bilibili_note_mcp.domain.refs import brief_ref, profile_ref, raw_ref, transcript_ref
from bilibili_note_mcp.domain.strategy_summary import public_author_subject
from bilibili_note_mcp.domain.url_policy import InvalidBilibiliUrl, validate_bilibili_url

BINDER_MATERIAL_REF = raw_ref(Path(__file__).read_bytes())
_VISUAL_HEARTBEAT_SECONDS = 15
_MODEL_EVIDENCE_REF = re.compile(r"^E[0-9]{3}$")


@dataclass(frozen=True, slots=True)
class BundlePayload:
    brief_ref: str
    brief: BilibiliResearchBriefV2
    rendered_markdown: str
    summary: StrategySummaryV1


class _AcquisitionProgressReporter:
    def __init__(self, parent: ProgressReporter) -> None:
        self._parent = parent
        self.last_verified_progress = 5

    async def report(self, update: ProgressUpdateV1) -> None:
        if update.progress < self.last_verified_progress:
            return
        self.last_verified_progress = update.progress
        await self._parent.report(update)


def _raise(code: FailureCode, reason: str) -> Never:
    raise BilibiliNoteFailure(code, reason)


def _clean_text(value: str, *, limit: int) -> str:
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        _raise("DISTILLATION_FAILED", "model_text_empty")
    return cleaned[:limit]


def _selection_reason(
    reasons: Collection[str],
) -> Literal["deictic_cue", "visual_activity", "ordered_relation_cue", "coverage"]:
    if "ordered_relation_cue" in reasons:
        return "ordered_relation_cue"
    if "deictic_cue" in reasons:
        return "deictic_cue"
    if "visual_activity" in reasons:
        return "visual_activity"
    return "coverage"


class CreateBilibiliNote:
    def __init__(
        self,
        source: SourcePort,
        media: MediaPort,
        distiller: DistillerPort,
        verifier: CandidateVerifierPort,
        renderer: StrategySummaryRendererPort,
    ) -> None:
        self._source = source
        self._media = media
        self._distiller = distiller
        self._verifier = verifier
        self._renderer = renderer

    async def execute(self, url: str, progress: ProgressReporter | None = None) -> BundlePayload:
        reporter = progress or NullProgressReporter()
        try:
            validate_bilibili_url(url)
        except InvalidBilibiliUrl as e:
            raise BilibiliNoteFailure(cast(FailureCode, e.code), e.reason) from e
        await reporter.report(progress_update(ProgressStageV1.REQUEST_VALIDATED))
        with tempfile.TemporaryDirectory(prefix="bilibili-note-") as scratch:
            workspace = Path(scratch)
            acquired = await self._acquire_with_liveness(url, workspace, reporter)
            self._validate_transcript(acquired)
            await reporter.report(progress_update(ProgressStageV1.TRANSCRIPT_READY))
            frames = await self._media.extract_frames(acquired, workspace)
            self._validate_frames(frames)
            await reporter.report(progress_update(ProgressStageV1.HD_FRAMES_READY))
            candidate, verification = await self._analyze_with_liveness(acquired, frames, reporter)

            evidence = tuple(
                EvidenceSegmentV2(
                    evidence_id=f"E{index:03d}",
                    start_ms=item.start_ms,
                    end_ms=item.end_ms,
                    origin=acquired.transcript.method,
                )
                for index, item in enumerate(acquired.transcript.segments[:128], start=1)
            )
            evidence_by_id = {item.evidence_id: item for item in evidence}
            frame_by_id = {item.frame_id: item for item in frames}
            frame_groups: dict[str, tuple[str, ...]] = {}
            for frame in frames:
                frame_groups.setdefault(frame.group_id, ())
                frame_groups[frame.group_id] = (*frame_groups[frame.group_id], frame.frame_id)
            frame_group_items = tuple(frame_groups.items())
            if len(candidate.visuals) != len(frame_group_items):
                _raise("DISTILLATION_FAILED", "model_visual_groups_invalid")
            visual_insights: list[VisualInsightV2] = []
            public_records = [(rule, raw_refs) for rule, raw_refs in candidate.rules]
            rule_visual_refs: dict[int, list[str]] = {}
            visual_index = 0
            for item, (_group_id, host_frame_ids) in zip(
                candidate.visuals, frame_group_items, strict=True
            ):
                if item.disposition == "no_material_increment":
                    if item.rule_index is not None or item.evidence_basis is not None:
                        _raise("DISTILLATION_FAILED", "visual_disposition_invalid")
                    continue
                if (
                    not isinstance(item.rule_index, int)
                    or isinstance(item.rule_index, bool)
                    or not 0 <= item.rule_index < len(public_records)
                ):
                    _raise("DISTILLATION_FAILED", "visual_rule_index_invalid")
                bound_refs = set().union(
                    *(set(frame_by_id[ref].transcript_refs) for ref in host_frame_ids)
                )
                if len(bound_refs) != 1 or any(ref not in evidence_by_id for ref in bound_refs):
                    _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_transcript_binding_invalid")
                visual_index += 1
                visual_id = f"V{visual_index:02d}"
                existing, existing_refs = public_records[item.rule_index]
                public_records[item.rule_index] = (
                    existing,
                    tuple(
                        sorted(
                            set(existing_refs) | bound_refs,
                            key=lambda value: int(value[1:]),
                        )
                    ),
                )
                rule_visual_refs.setdefault(item.rule_index, []).append(visual_id)
                intervals = [evidence_by_id[ref] for ref in bound_refs]
                selected_frames = [frame_by_id[ref] for ref in host_frame_ids]
                interval = evidence_by_id[next(iter(bound_refs))]
                if any(
                    frame.timestamp_ms < interval.start_ms or frame.timestamp_ms > interval.end_ms
                    for frame in selected_frames
                ):
                    _raise("VISUAL_EVIDENCE_INCOMPLETE", "frame_transcript_binding_invalid")
                reasons = {frame.selection_reason for frame in selected_frames}
                reason = _selection_reason(reasons)
                if item.evidence_basis is None:
                    _raise("DISTILLATION_FAILED", "visual_evidence_basis_invalid")
                visual_insights.append(
                    VisualInsightV2(
                        visual_id=visual_id,
                        start_ms=min(value.start_ms for value in intervals),
                        end_ms=max(value.end_ms for value in intervals),
                        transcript_refs=tuple(sorted(bound_refs, key=lambda value: int(value[1:]))),
                        frame_timestamps_ms=tuple(
                            sorted(frame.timestamp_ms for frame in selected_frames)
                        ),
                        selection_reason=reason,
                        evidence_basis=item.evidence_basis,
                    )
                )

            all_records = tuple(public_records)
            if any(
                _MODEL_EVIDENCE_REF.fullmatch(reference) is None
                for _, raw_refs in all_records
                for reference in raw_refs
            ):
                _raise("DISTILLATION_FAILED", "model_evidence_ref_invalid")

            def map_refs(raw_refs: tuple[str, ...]) -> tuple[str, ...]:
                mapped: list[str] = []
                for reference in raw_refs:
                    if reference in evidence_by_id:
                        mapped.append(reference)
                    else:
                        _raise("DISTILLATION_FAILED", "model_evidence_ref_invalid")
                return tuple(
                    sorted(
                        set(mapped),
                        key=lambda value: (
                            0 if value.startswith("E") else 1,
                            int(value[1:]),
                        ),
                    )
                )

            bound_records: list[BoundBriefItemV2] = []
            for record_index, (rule, raw_refs) in enumerate(public_records):
                refs = list(map_refs(raw_refs))
                refs.extend(rule_visual_refs.get(record_index, ()))
                refs_tuple = tuple(
                    sorted(
                        set(refs),
                        key=lambda value: (0 if value.startswith("E") else 1, int(value[1:])),
                    )
                )
                bound_records.append(
                    BoundBriefItemV2(
                        text=rule.rule_body,
                        mode=(
                            "inferred"
                            if any(ref.startswith("V") for ref in refs_tuple)
                            else "explicit"
                        ),
                        evidence_refs=refs_tuple,
                    )
                )
            core = bound_records[0]
            key_points = tuple(bound_records[1:])
            categorized: dict[str, list[PublicRuleV1]] = {
                "core_strategy": [],
                "method": [],
                "risk_management": [],
            }
            for (rule, _raw_refs), verdict in zip(public_records, verification.rules, strict=True):
                categorized[verdict.classified_category].append(rule)
            summary = StrategySummaryV1(
                subject=public_author_subject(acquired.source.author_name),
                core_strategies=tuple(categorized["core_strategy"]),
                methods=tuple(categorized["method"]),
                risk_management=tuple(categorized["risk_management"]),
            )
            await reporter.report(progress_update(ProgressStageV1.ANALYSIS_READY))
            transcript_value = [
                {
                    "start_ms": item.start_ms,
                    "end_ms": item.end_ms,
                    "text": " ".join(item.text.split()),
                    "method": acquired.transcript.method,
                }
                for item in acquired.transcript.segments
            ]
            profile_manifest = {
                "schema": "bilibili-brief-distiller-profile/v3",
                "binder_material_ref": BINDER_MATERIAL_REF,
                "renderer_material_ref": self._renderer.material_ref,
                "distiller_material_refs": candidate.profile_material_refs,
                "vision_model": candidate.model_ref,
                "asr_provider": acquired.transcript.provider_ref,
                "limits": {"internal_frames": [2, 5], "public_images": 0},
            }
            brief = BilibiliResearchBriefV2(
                schema="bilibili-note.research-brief/v2",
                source=acquired.source,
                provenance=ProvenanceV2(
                    source_snapshot_ref=acquired.source_snapshot_ref,
                    transcript_ref=transcript_ref(transcript_value),
                    transcript_method=acquired.transcript.method,
                    transcript_provider_ref=acquired.transcript.provider_ref,
                    distiller_profile_ref=profile_ref(profile_manifest),
                    model_ref=candidate.model_ref,
                    acquired_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                ),
                coverage=CoverageV2(
                    spoken_content="complete",
                    visual_analysis="internal_transient",
                    analyzed_visual_frames=len(frames),
                    source_language=acquired.transcript.language,
                    brief_language="zh-CN",
                ),
                core_thesis=core,
                key_points=key_points,
                visual_insights=tuple(visual_insights),
                research_hypotheses=(),
                unknowns=(),
                evidence=evidence,
            )
            mapping = brief.model_dump(mode="json", by_alias=True)
            rendered = self._renderer.render(summary)
            if len(rendered.encode("utf-8")) > DIRECT_TERMINAL_BYTES:
                _raise("OUTPUT_INVALID", "terminal_bytes_exceeded")
            if rendered_contains_private_audit_noise(rendered):
                _raise("OUTPUT_INVALID", "private_audit_projection_forbidden")
            if not rendered_summary_structure_is_valid(rendered):
                _raise("OUTPUT_INVALID", "unverified_scope_invalid")
            if not rendered_public_text_is_valid(rendered):
                _raise("OUTPUT_INVALID", "rendered_public_text_invalid")
            payload = BundlePayload(
                brief_ref=brief_ref(mapping),
                brief=brief,
                rendered_markdown=rendered,
                summary=summary,
            )
            self._validate_output(payload)
            await reporter.report(progress_update(ProgressStageV1.NOTE_VALIDATED))
            return payload

    @staticmethod
    def _validate_candidate_text(candidate: DistillCandidate) -> None:
        if not 1 <= len(candidate.rules) <= 24:
            _raise("DISTILLATION_FAILED", "model_rule_counts_invalid")
        values = [rule.rule_body for rule, _ in candidate.rules]
        if any(not model_public_rule_representation_is_valid(value) for value in values):
            _raise("DISTILLATION_FAILED", "model_public_representation_invalid")
        if not summary_items_are_distinct(tuple(rule for rule, _ in candidate.rules)):
            _raise("DISTILLATION_FAILED", "model_public_items_not_unique")

    @staticmethod
    def _validate_candidate_visuals(
        candidate: DistillCandidate, frames: tuple[FrameAsset, ...]
    ) -> None:
        group_sizes = tuple(
            sum(frame.group_id == group_id for frame in frames)
            for group_id in dict.fromkeys(frame.group_id for frame in frames)
        )
        if len(candidate.visuals) != len(group_sizes):
            _raise("DISTILLATION_FAILED", "model_visual_groups_invalid")
        rule_count = len(candidate.rules)
        for visual in candidate.visuals:
            if visual.disposition == "no_material_increment":
                if visual.rule_index is not None or visual.evidence_basis is not None:
                    _raise("DISTILLATION_FAILED", "visual_disposition_invalid")
                continue
            if (
                not isinstance(visual.rule_index, int)
                or isinstance(visual.rule_index, bool)
                or not 0 <= visual.rule_index < rule_count
            ):
                _raise("DISTILLATION_FAILED", "visual_rule_index_invalid")
        for visual, group_size in zip(candidate.visuals, group_sizes, strict=True):
            if visual.disposition == "no_material_increment":
                continue
            if visual.evidence_basis == "static_frame" and group_size != 1:
                _raise("DISTILLATION_FAILED", "visual_evidence_basis_invalid")
            if visual.evidence_basis == "ordered_relation" and group_size != 3:
                _raise("DISTILLATION_FAILED", "visual_evidence_basis_invalid")
            if visual.evidence_basis not in ("static_frame", "ordered_relation"):
                _raise("DISTILLATION_FAILED", "visual_evidence_basis_invalid")

    @staticmethod
    def _validate_verification(
        candidate: DistillCandidate, verification: CandidateVerification
    ) -> None:
        candidate_rules = candidate.rules
        if len(verification.rules) != len(candidate_rules) or any(
            verdict.item_index != index for index, verdict in enumerate(verification.rules)
        ):
            _raise("DISTILLATION_FAILED", "verifier_response_invalid")
        if (
            verification.source_coverage != "accept"
            or verification.no_duplicate_or_remaining_mergeable_rule != "accept"
            or verification.priority_order_acceptable != "accept"
        ):
            _raise("DISTILLATION_FAILED", "candidate_semantics_rejected")
        for rule_verdict in verification.rules:
            if (
                rule_verdict.intelligible != "accept"
                or rule_verdict.source_resolvable != "accept"
                or rule_verdict.entailed_no_new_claim != "accept"
                or rule_verdict.polarity_preserved != "accept"
                or rule_verdict.material_conditions_preserved != "accept"
                or rule_verdict.reusable_abstraction_acceptable != "accept"
                or rule_verdict.simplified_chinese_language != "accept"
            ):
                _raise("DISTILLATION_FAILED", "candidate_semantics_rejected")
        category_counts = {
            category: sum(verdict.classified_category == category for verdict in verification.rules)
            for category in ("core_strategy", "method", "risk_management")
        }
        if (
            category_counts["core_strategy"] > 9
            or category_counts["method"] > 9
            or category_counts["risk_management"] > 6
        ):
            _raise("DISTILLATION_FAILED", "candidate_semantics_rejected")
        if len(verification.visuals) != len(candidate.visuals):
            _raise("DISTILLATION_FAILED", "verifier_response_invalid")
        for index, (candidate_visual, visual_verdict) in enumerate(
            zip(candidate.visuals, verification.visuals, strict=True)
        ):
            if (
                visual_verdict.group_index != index
                or visual_verdict.rule_index != candidate_visual.rule_index
            ):
                _raise("DISTILLATION_FAILED", "verifier_response_invalid")
            if candidate_visual.disposition == "supports_rule":
                if visual_verdict.materiality != "material":
                    _raise("DISTILLATION_FAILED", "verifier_response_invalid")
                if visual_verdict.independent_support == "reject":
                    _raise("VISUAL_EVIDENCE_INCOMPLETE", "visual_support_rejected")
                if visual_verdict.independent_support != "accept":
                    _raise("DISTILLATION_FAILED", "verifier_response_invalid")
                if candidate_visual.evidence_basis == "ordered_relation":
                    if (
                        visual_verdict.rule_relation != "ordered"
                        or visual_verdict.speech_authorized == "reject"
                        or visual_verdict.same_visual_context == "reject"
                        or visual_verdict.ordered_relation_support == "reject"
                    ):
                        _raise(
                            "VISUAL_EVIDENCE_INCOMPLETE",
                            "visual_ordered_relation_rejected",
                        )
                    if (
                        visual_verdict.speech_authorized != "accept"
                        or visual_verdict.same_visual_context != "accept"
                        or visual_verdict.ordered_relation_support != "accept"
                    ):
                        _raise("DISTILLATION_FAILED", "verifier_response_invalid")
                elif (
                    visual_verdict.rule_relation == "ordered"
                    or visual_verdict.speech_authorized != "not_applicable"
                    or visual_verdict.same_visual_context != "not_applicable"
                    or visual_verdict.ordered_relation_support != "not_applicable"
                ):
                    _raise(
                        "VISUAL_EVIDENCE_INCOMPLETE",
                        "visual_relation_basis_rejected",
                    )
            else:
                if (
                    visual_verdict.independent_support != "not_applicable"
                    or visual_verdict.rule_relation != "none"
                    or visual_verdict.speech_authorized != "not_applicable"
                    or visual_verdict.same_visual_context != "not_applicable"
                    or visual_verdict.ordered_relation_support != "not_applicable"
                ):
                    _raise("DISTILLATION_FAILED", "verifier_response_invalid")
                if visual_verdict.materiality == "material":
                    _raise("VISUAL_EVIDENCE_INCOMPLETE", "visual_material_omitted")

    async def _analyze_with_liveness(
        self,
        source: AcquiredSource,
        frames: tuple[FrameAsset, ...],
        reporter: ProgressReporter,
    ) -> tuple[DistillCandidate, CandidateVerification]:
        async def analyze() -> tuple[DistillCandidate, CandidateVerification]:
            candidate = await self._distiller.distill(source, frames)
            self._validate_candidate_text(candidate)
            self._validate_candidate_visuals(candidate, frames)
            verification = await self._verifier.verify(source, frames, candidate)
            self._validate_verification(candidate, verification)
            return candidate, verification

        task = asyncio.create_task(analyze())
        elapsed = 0
        sequence = 0
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=_VISUAL_HEARTBEAT_SECONDS)
                if done:
                    return await task
                elapsed += _VISUAL_HEARTBEAT_SECONDS
                sequence += 1
                await reporter.report(visual_analysis_heartbeat(elapsed, sequence))
        finally:

            async def cleanup() -> None:
                if not task.done() and task.cancelling() == 0:
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)

            coordinator = asyncio.create_task(cleanup())
            await finish_owned_task(coordinator)

    async def _acquire_with_liveness(
        self,
        url: str,
        workspace: Path,
        reporter: ProgressReporter,
    ) -> AcquiredSource:
        tracked = _AcquisitionProgressReporter(reporter)
        task = asyncio.create_task(self._source.acquire(url, workspace, tracked))
        elapsed = 0
        try:
            while True:
                done, _ = await asyncio.wait({task}, timeout=_VISUAL_HEARTBEAT_SECONDS)
                if done:
                    return await task
                elapsed += _VISUAL_HEARTBEAT_SECONDS
                await reporter.report(
                    media_acquisition_heartbeat(elapsed, tracked.last_verified_progress)
                )
        finally:

            async def cleanup() -> None:
                if not task.done() and task.cancelling() == 0:
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)

            coordinator = asyncio.create_task(cleanup())
            await finish_owned_task(coordinator)

    @staticmethod
    def _validate_transcript(source: AcquiredSource) -> None:
        transcript = source.transcript.segments
        duration_ms = source.source.duration_ms
        if not transcript or transcript[0].start_ms != 0 or transcript[-1].end_ms != duration_ms:
            _raise("TRANSCRIPT_INCOMPLETE", "transcript_coverage_incomplete")
        previous_end = 0
        transcript_bytes = 0
        for index, segment in enumerate(transcript, start=1):
            if (
                segment.evidence_id != f"E{index:03d}"
                or segment.start_ms != previous_end
                or segment.end_ms <= segment.start_ms
                or segment.end_ms > duration_ms
            ):
                _raise("TRANSCRIPT_INCOMPLETE", "transcript_timeline_invalid")
            previous_end = segment.end_ms
            transcript_bytes += len(segment.text.encode("utf-8"))
            if transcript_bytes > TRANSCRIPT_TOTAL_BYTES:
                _raise("TRANSCRIPT_INCOMPLETE", "transcript_bytes_exceeded")

    @staticmethod
    def _validate_frames(frames: tuple[FrameAsset, ...]) -> None:
        if not 2 <= len(frames) <= 5:
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
        if not 2 <= len(groups) <= 5:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "visual_group_count_invalid")
        if ordered_groups > 1:
            _raise("VISUAL_EVIDENCE_INCOMPLETE", "ordered_group_count_invalid")

    def _validate_output(self, payload: BundlePayload) -> None:
        mapping = payload.brief.model_dump(mode="json", by_alias=True)
        if payload.brief_ref != brief_ref(mapping):
            _raise("OUTPUT_INVALID", "brief_ref_invalid")
        if payload.rendered_markdown != self._renderer.render(payload.summary):
            _raise("OUTPUT_INVALID", "renderer_drift")
        if "![" in payload.rendered_markdown or "bilibili-note-assets" in payload.rendered_markdown:
            _raise("OUTPUT_INVALID", "public_image_projection_forbidden")
