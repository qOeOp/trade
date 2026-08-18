from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal

from bilibili_note_mcp.application.operator_events import emit_operator_event
from bilibili_note_mcp.application.public_text import (
    rendered_contains_private_audit_noise,
    rendered_public_text_is_valid,
    rendered_summary_structure_is_valid,
)
from bilibili_note_mcp.application.resource_limits import SEARCH_TERMINAL_BYTES
from bilibili_note_mcp.domain.models import (
    FailureCode,
    SearchCandidateV1,
    StrategySummaryV1,
)
from bilibili_note_mcp.domain.strategy_summary import public_author_subject, public_search_subject

from .create_note import CreateBilibiliNote
from .errors import BilibiliNoteFailure
from .owned_tasks import finish_owned_task
from .ports import SearchPort, StrategyAggregatorPort, StrategySummaryRendererPort
from .progress import (
    NullProgressReporter,
    ProgressReporter,
    ProgressStageV1,
    ProgressUpdateV1,
    batch_progress,
    search_progress,
)

_MAX_SEARCH_CANDIDATES = 9
_MAX_CONCURRENT_NOTES = 2
_CandidateOutcome = Literal["succeeded", "failed", "cancelled"]


@dataclass(frozen=True, slots=True)
class ParsedSearchItem:
    candidate: SearchCandidateV1
    summary: StrategySummaryV1 | None
    error_code: FailureCode | None
    error_reason: str | None


@dataclass(frozen=True, slots=True)
class SearchBatchPayload:
    query: str
    items: tuple[ParsedSearchItem, ...]
    summary: StrategySummaryV1
    rendered_markdown: str


class _BatchProgressCoordinator:
    def __init__(self, parent: ProgressReporter, *, total: int) -> None:
        self._parent = parent
        self._total = total
        self._candidate_progress = [0] * total
        self._terminal = [False] * total
        self._last_progress = 10
        self._lock = asyncio.Lock()
        self._active = 0
        self.max_active = 0
        self._launched: set[int] = set()
        self._outcomes: dict[int, _CandidateOutcome] = {}

    @property
    def total(self) -> int:
        return self._total

    def launched(self, index: int) -> None:
        if index in self._launched:
            raise RuntimeError("candidate task was launched more than once")
        self._launched.add(index)

    def started(self) -> None:
        self._active += 1
        self.max_active = max(self.max_active, self._active)

    def stopped(self) -> None:
        self._active -= 1
        if self._active < 0:
            raise RuntimeError("batch progress active count is invalid")

    async def report(
        self,
        *,
        index: int,
        update: ProgressUpdateV1,
    ) -> int:
        async with self._lock:
            self._candidate_progress[index] = max(self._candidate_progress[index], update.progress)
            progress = self._mapped_progress()
            await self._parent.report(
                batch_progress(
                    f"正在解析候选 {index + 1}/{self._total}；{update.message}",
                    progress,
                )
            )
            return progress

    def record_outcome(self, *, index: int, outcome: _CandidateOutcome) -> bool:
        if index not in self._launched:
            raise RuntimeError("candidate outcome has no launched task")
        previous = self._outcomes.get(index)
        if previous is not None:
            if previous != outcome:
                raise RuntimeError("candidate task has conflicting outcomes")
            return False
        self._outcomes[index] = outcome
        return True

    def record_outcome_if_absent(self, *, index: int, outcome: _CandidateOutcome) -> bool:
        if index not in self._launched:
            raise RuntimeError("candidate outcome has no launched task")
        if index in self._outcomes:
            return False
        self._outcomes[index] = outcome
        return True

    def outcome_counts(self) -> tuple[int, int, int, int]:
        attempted = len(self._launched)
        succeeded = sum(outcome == "succeeded" for outcome in self._outcomes.values())
        failed = sum(outcome == "failed" for outcome in self._outcomes.values())
        cancelled = sum(outcome == "cancelled" for outcome in self._outcomes.values())
        return attempted, succeeded, failed, cancelled

    async def processed(
        self,
        *,
        index: int,
        outcome: Literal["succeeded", "failed"],
        message: str,
    ) -> int:
        self.record_outcome(index=index, outcome=outcome)
        async with self._lock:
            self._candidate_progress[index] = 100
            self._terminal[index] = True
            progress = self._mapped_progress()
            await self._parent.report(batch_progress(message, progress))
            return progress

    async def status(self, message: str) -> None:
        async with self._lock:
            await self._parent.report(batch_progress(message, self._last_progress))

    def _mapped_progress(self) -> int:
        frontier = 0
        while frontier < self._total and self._terminal[frontier]:
            frontier += 1
        verified_units = frontier * 100
        if frontier < self._total:
            verified_units += self._candidate_progress[frontier]
        mapped = 10 + round(80 * verified_units / (100 * self._total))
        self._last_progress = max(self._last_progress, min(88, mapped))
        return self._last_progress


class _ItemProgressReporter:
    def __init__(
        self,
        coordinator: _BatchProgressCoordinator,
        *,
        index: int,
    ) -> None:
        self._coordinator = coordinator
        self._index = index
        self.last_stage: ProgressStageV1 | None = None
        self.last_progress = 10

    async def report(self, update: ProgressUpdateV1) -> None:
        self.last_stage = update.stage
        self.last_progress = await self._coordinator.report(
            index=self._index,
            update=update,
        )


def _candidate_probe(
    *,
    event: Literal["candidate_completed", "candidate_failed", "candidate_cancelled"],
    candidate_index: int,
    reporter: _ItemProgressReporter,
    error: BilibiliNoteFailure | None = None,
) -> None:
    payload: dict[str, object] = {
        "candidate_index": candidate_index,
        "stage": reporter.last_stage.value if reporter.last_stage is not None else "not_started",
        "progress": reporter.last_progress,
    }
    if error is not None:
        payload.update({"code": error.code, "reason": error.reason})
    emit_operator_event(event, **payload)


def _batch_probe(
    *,
    coordinator: _BatchProgressCoordinator,
) -> None:
    attempted, succeeded, failed, cancelled = coordinator.outcome_counts()
    payload = {
        "attempted": attempted,
        "succeeded": succeeded,
        "failed": failed,
        "cancelled": cancelled,
        "max_active": coordinator.max_active,
    }
    emit_operator_event("batch_completed", **payload)


def _summary_subject(query: str, summaries: tuple[StrategySummaryV1, ...]) -> str:
    subjects = {summary.subject for summary in summaries}
    if len(subjects) == 1:
        return public_author_subject(subjects.pop())
    return public_search_subject(query)


class SearchAndCreateBilibiliNotes:
    def __init__(
        self,
        search: SearchPort,
        create_note: CreateBilibiliNote,
        aggregator: StrategyAggregatorPort,
        renderer: StrategySummaryRendererPort,
    ) -> None:
        self._search = search
        self._create_note = create_note
        self._aggregator = aggregator
        self._renderer = renderer

    async def _parse_candidate(
        self,
        *,
        candidate: SearchCandidateV1,
        index: int,
        coordinator: _BatchProgressCoordinator,
    ) -> ParsedSearchItem:
        item_progress = _ItemProgressReporter(
            coordinator,
            index=index,
        )
        coordinator.started()
        try:
            try:
                payload = await self._create_note.execute(candidate.canonical_url, item_progress)
            except BilibiliNoteFailure as e:
                _candidate_probe(
                    event="candidate_failed",
                    candidate_index=index + 1,
                    reporter=item_progress,
                    error=e,
                )
                item = ParsedSearchItem(
                    candidate=candidate,
                    summary=None,
                    error_code=e.code,
                    error_reason=e.reason,
                )
                status = "失败，继续后续视频"
                outcome: Literal["succeeded", "failed"] = "failed"
            else:
                _candidate_probe(
                    event="candidate_completed",
                    candidate_index=index + 1,
                    reporter=item_progress,
                )
                item = ParsedSearchItem(
                    candidate=candidate,
                    summary=payload.summary,
                    error_code=None,
                    error_reason=None,
                )
                status = "完成"
                outcome = "succeeded"
            item_progress.last_progress = await coordinator.processed(
                index=index,
                outcome=outcome,
                message=f"候选 {index + 1}/{coordinator.total} 解析{status}",
            )
            return item
        except asyncio.CancelledError:
            if coordinator.record_outcome_if_absent(index=index, outcome="cancelled"):
                _candidate_probe(
                    event="candidate_cancelled",
                    candidate_index=index + 1,
                    reporter=item_progress,
                )
            raise
        except BaseException:
            if coordinator.record_outcome_if_absent(index=index, outcome="failed"):
                _candidate_probe(
                    event="candidate_failed",
                    candidate_index=index + 1,
                    reporter=item_progress,
                    error=BilibiliNoteFailure("INTERNAL", "unexpected_candidate_failure"),
                )
            raise
        finally:
            coordinator.stopped()

    @staticmethod
    async def _cancel_and_join(
        tasks: dict[asyncio.Task[ParsedSearchItem], int],
        coordinator: _BatchProgressCoordinator,
    ) -> None:
        for task in tasks:
            if not task.done() and task.cancelling() == 0:
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for index in tasks.values():
            if coordinator.record_outcome_if_absent(index=index, outcome="cancelled"):
                emit_operator_event(
                    "candidate_cancelled",
                    candidate_index=index + 1,
                    stage="not_started",
                    progress=10,
                )

    @staticmethod
    def _authority_index(
        items: dict[int, ParsedSearchItem],
        *,
        target: int,
    ) -> int | None:
        succeeded = 0
        for index in range(len(items)):
            item = items.get(index)
            if item is None:
                return None
            if item.summary is not None:
                succeeded += 1
            if succeeded == target:
                return index
        return None

    async def _run_rolling(
        self,
        candidates: tuple[SearchCandidateV1, ...],
        *,
        target: int,
        coordinator: _BatchProgressCoordinator,
    ) -> tuple[ParsedSearchItem, ...]:
        active: dict[asyncio.Task[ParsedSearchItem], int] = {}
        items: dict[int, ParsedSearchItem] = {}
        next_index = 0

        def start_pending() -> None:
            nonlocal next_index
            succeeded = sum(item.summary is not None for item in items.values())
            while (
                len(active) < _MAX_CONCURRENT_NOTES
                and next_index < len(candidates)
                and succeeded < target
            ):
                index = next_index
                task = asyncio.create_task(
                    self._parse_candidate(
                        candidate=candidates[index],
                        index=index,
                        coordinator=coordinator,
                    )
                )
                coordinator.launched(index)
                active[task] = index
                next_index += 1

        start_pending()
        try:
            while active:
                done, _ = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)
                completed = tuple(sorted((active.pop(task), task) for task in done))
                try:
                    for index, task in completed:
                        items[index] = task.result()
                except BaseException:
                    await asyncio.gather(*(task for _, task in completed), return_exceptions=True)
                    raise

                authority_index = self._authority_index(items, target=target)
                if authority_index is not None:
                    return tuple(items[index] for index in range(authority_index + 1))
                start_pending()
            return tuple(items[index] for index in sorted(items))
        finally:
            cleanup = asyncio.create_task(self._cancel_and_join(active, coordinator))
            await finish_owned_task(cleanup)

    async def execute(
        self,
        query: str,
        max_videos: int,
        progress: ProgressReporter | None = None,
    ) -> SearchBatchPayload:
        if not 1 <= max_videos <= 3:
            raise ValueError("max_videos is invalid")
        reporter = progress or NullProgressReporter()
        await reporter.report(search_progress("检索主题已验证，正在搜索 Bilibili", 5))
        candidate_limit = min(_MAX_SEARCH_CANDIDATES, max_videos + 6)
        try:
            candidates = (await self._search.search(query, candidate_limit))[:candidate_limit]
        except BilibiliNoteFailure as e:
            emit_operator_event("search_failed", code=e.code, reason=e.reason)
            raise
        if not candidates:
            emit_operator_event(
                "search_failed", code="SEARCH_EMPTY", reason="search_no_usable_results"
            )
            raise BilibiliNoteFailure("SEARCH_EMPTY", "search_no_usable_results")
        emit_operator_event("search_completed", candidates=len(candidates))
        await reporter.report(
            search_progress(
                f"已找到 {len(candidates)} 个候选视频，目标完成 {max_videos} 个，准备有界解析",
                10,
            )
        )
        coordinator = _BatchProgressCoordinator(reporter, total=len(candidates))
        try:
            frozen_items = await self._run_rolling(
                candidates,
                target=max_videos,
                coordinator=coordinator,
            )
        except BaseException:
            _batch_probe(coordinator=coordinator)
            raise
        succeeded = sum(item.summary is not None for item in frozen_items)
        _batch_probe(coordinator=coordinator)
        if succeeded >= max_videos:
            await coordinator.status(f"已完成目标 {max_videos} 个视频，停止额外候选解析")
        summaries = tuple(item.summary for item in frozen_items if item.summary is not None)
        if succeeded != max_videos:
            raise BilibiliNoteFailure("SEARCH_TARGET_UNMET", "search_success_target_unmet")
        subject = _summary_subject(query, summaries)
        summary = await self._aggregator.aggregate(subject, summaries)
        rendered = self._renderer.render(summary)
        if len(rendered.encode("utf-8")) > SEARCH_TERMINAL_BYTES:
            raise BilibiliNoteFailure("OUTPUT_INVALID", "terminal_bytes_exceeded")
        if rendered_contains_private_audit_noise(rendered):
            raise BilibiliNoteFailure("OUTPUT_INVALID", "private_audit_projection_forbidden")
        if not rendered_summary_structure_is_valid(rendered):
            raise BilibiliNoteFailure("OUTPUT_INVALID", "unverified_scope_invalid")
        if not rendered_public_text_is_valid(rendered):
            raise BilibiliNoteFailure("OUTPUT_INVALID", "rendered_public_text_invalid")
        await reporter.report(
            batch_progress("统一交易策略总结已校验，正在封装返回", 89, ready=True)
        )
        return SearchBatchPayload(
            query=query,
            items=frozen_items,
            summary=summary,
            rendered_markdown=rendered,
        )
