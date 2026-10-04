from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass

import pytest
from conftest import make_draft
from pydantic import ValidationError

from video_note_mcp.application.errors import BilibiliNoteFailure
from video_note_mcp.application.operator_events import emit_operator_event, operator_run
from video_note_mcp.application.ports import PublishedNote
from video_note_mcp.application.progress import (
    ProgressReporter,
    ProgressStageV1,
    ProgressUpdateV1,
)
from video_note_mcp.application.search_notes import (
    SearchAndCreateBilibiliNotes,
    _batch_probe,
    _BatchProgressCoordinator,
)
from video_note_mcp.domain.models import SearchCandidateV1


class RecordingPublisher:
    def __init__(self):
        self.calls = []

    def publish(self, drafts):
        self.calls.append(drafts)
        return PublishedNote(
            "\n".join("NOTE:" + d.source.title for d in drafts),
            "/unused/note.md",
            "/unused/note.html",
            (),
        )


def _controlled_payload(label):
    return make_draft(title=label)


class FakeCreate:
    def __init__(self, failures=None):
        self.failures = failures or {}
        self.calls = []

    async def prepare(self, url, progress=None, *, quality="fast"):
        self.calls.append(url)
        if progress is not None:
            await progress.report(
                ProgressUpdateV1(ProgressStageV1.MEDIA_READY, 25, 100, "fixture ready")
            )
        if url in self.failures:
            raise self.failures[url]
        return _controlled_payload(url)


def _use_case(search, create):
    return SearchAndCreateBilibiliNotes(search, create, RecordingPublisher())


@dataclass
class FakeSearch:
    candidates: tuple[SearchCandidateV1, ...]
    observed_limit: int | None = None

    async def search(self, query: str, limit: int) -> tuple[SearchCandidateV1, ...]:
        self.observed_limit = limit
        return self.candidates


class ControlledCreate:
    def __init__(
        self,
        *,
        failures: dict[str, BilibiliNoteFailure] | None = None,
        unexpected: set[str] | None = None,
    ) -> None:
        self.failures = failures or {}
        self.unexpected = unexpected or set()
        self.calls: list[str] = []
        self.cancelled: list[str] = []
        self.active = 0
        self.max_active = 0
        self.started: dict[str, asyncio.Event] = {}
        self.releases: dict[str, asyncio.Event] = {}

    def started_event(self, url: str) -> asyncio.Event:
        return self.started.setdefault(url, asyncio.Event())

    def release(self, url: str) -> None:
        self.releases.setdefault(url, asyncio.Event()).set()

    async def prepare(
        self, url: str, progress: ProgressReporter | None = None, *, quality="fast"
    ) -> object:
        self.calls.append(url)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.started_event(url).set()
        if progress is not None:
            await progress.report(
                ProgressUpdateV1(ProgressStageV1.MEDIA_READY, 25, 100, f"started {url}")
            )
        try:
            await self.releases.setdefault(url, asyncio.Event()).wait()
            if progress is not None:
                await progress.report(
                    ProgressUpdateV1(ProgressStageV1.NOTE_VALIDATED, 89, 100, f"done {url}")
                )
            if url in self.unexpected:
                raise RuntimeError("unexpected controlled failure")
            if failure := self.failures.get(url):
                raise failure
            return _controlled_payload(url.split("/video/", 1)[-1])
        except asyncio.CancelledError:
            self.cancelled.append(url)
            raise
        finally:
            self.active -= 1


class EffectfulControlledCreate(ControlledCreate):
    def __init__(self, *, effect_url: str) -> None:
        super().__init__()
        self._effect_url = effect_url

    async def prepare(
        self, url: str, progress: ProgressReporter | None = None, *, quality="fast"
    ) -> object:
        if url == self._effect_url:
            emit_operator_event(
                "media_completed",
                attempts=1,
                retries=0,
                rate_limits=0,
                downloaded_bytes=1024,
            )
            emit_operator_event("asr_completed", windows=1, attempts=1, retries=0, rate_limits=0)
            emit_operator_event("vision_started", groups=1, frames=1)
            emit_operator_event("vision_completed", groups=1, frames=1)
        return await super().prepare(url, progress)


class SlowCancellationCreate(ControlledCreate):
    def __init__(self) -> None:
        super().__init__()
        self.cleanup_started = asyncio.Event()
        self.allow_cleanup = asyncio.Event()
        self.cleanup_count = 0
        self.cleanup_terminal = 0

    async def prepare(
        self, url: str, progress: ProgressReporter | None = None, *, quality="fast"
    ) -> object:
        try:
            return await super().prepare(url, progress)
        except asyncio.CancelledError:
            self.cleanup_count += 1
            if self.cleanup_count == 2:
                self.cleanup_started.set()
            await self.allow_cleanup.wait()
            self.cleanup_terminal += 1
            raise


class CaptureProgress:
    def __init__(self) -> None:
        self.values: list[int] = []
        self.messages: list[str] = []

    async def report(self, update: ProgressUpdateV1) -> None:
        self.values.append(update.progress)
        self.messages.append(update.message)


def _candidate(index: int) -> SearchCandidateV1:
    video_id = (
        "BV1uHuQ6pEFr",
        "BV1j6um69EJn",
        "BV1bK411W797",
        "BV1pgXPB2Em4",
        "BV1M6Ti6TEvg",
    )[index - 1]
    return SearchCandidateV1(
        video_id=video_id,
        title=f"候选 {index}",
        canonical_url=f"https://www.bilibili.com/video/{video_id}?p=1",
    )


async def test_progress_never_exposes_untrusted_video_title() -> None:
    private_title = "趋势策略 S01:C01 " + "很长的视频标题" * 20
    candidate = _candidate(1).model_copy(update={"title": private_title})
    progress = CaptureProgress()

    await _use_case(FakeSearch((candidate,)), FakeCreate()).execute("趋势交易", 1, progress)

    item_messages = [message for message in progress.messages if "正在解析候选 1/1" in message]
    assert item_messages
    assert all(private_title not in message for message in progress.messages)
    assert all("S01:C01" not in message for message in progress.messages)
    assert all(len(message) < 100 for message in item_messages)


async def test_batch_fails_when_every_candidate_fails() -> None:
    candidates = (_candidate(1), _candidate(2))
    first = BilibiliNoteFailure("SOURCE_UNAVAILABLE", "first_failed")
    second = BilibiliNoteFailure("PART_REQUIRED", "second_failed")
    create = FakeCreate(
        {
            candidates[0].canonical_url: first,
            candidates[1].canonical_url: second,
        }
    )
    use_case = _use_case(FakeSearch(candidates), create)
    progress = CaptureProgress()

    with pytest.raises(BilibiliNoteFailure) as caught:
        await use_case.execute("趋势交易", 2, progress)

    assert caught.value.code == "SEARCH_TARGET_UNMET"
    assert caught.value.reason == "search_success_target_unmet"
    assert create.calls == [item.canonical_url for item in candidates]
    assert max(progress.values) == 88


async def test_batch_fails_closed_when_one_of_two_successes_is_missing(
    capsys: pytest.CaptureFixture[str],
) -> None:
    candidates = (_candidate(1), _candidate(2))
    failure = BilibiliNoteFailure("SOURCE_UNAVAILABLE", "second_failed")
    create = FakeCreate({candidates[1].canonical_url: failure})
    progress = CaptureProgress()

    with pytest.raises(BilibiliNoteFailure) as caught:
        await _use_case(FakeSearch(candidates), create).execute("趋势交易", 2, progress)

    assert caught.value.code == "SEARCH_TARGET_UNMET"
    assert caught.value.reason == "search_success_target_unmet"
    assert max(progress.values) == 88
    assert 89 not in progress.values
    assert 90 not in progress.values
    assert capsys.readouterr().err == ""


async def test_batch_cancellation_never_continues_to_a_later_candidate() -> None:
    candidates = (_candidate(1), _candidate(2), _candidate(3))
    create = ControlledCreate()
    use_case = _use_case(FakeSearch(candidates), create)

    task = asyncio.create_task(use_case.execute("趋势交易", 2))
    await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
    await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert create.calls == [item.canonical_url for item in candidates[:2]]
    assert set(create.cancelled) == {item.canonical_url for item in candidates[:2]}
    assert create.active == 0
    assert candidates[2].canonical_url not in create.calls


async def test_repeated_batch_cancellation_waits_for_all_candidate_cleanup() -> None:
    candidates = (_candidate(1), _candidate(2), _candidate(3))
    create = SlowCancellationCreate()
    task = asyncio.create_task(_use_case(FakeSearch(candidates), create).execute("趋势交易", 2))
    await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
    await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)

    task.cancel("first")
    await asyncio.wait_for(create.cleanup_started.wait(), timeout=1)
    task.cancel("second")
    await asyncio.sleep(0)
    assert not task.done()
    assert create.cleanup_terminal == 0

    create.allow_cleanup.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert create.cleanup_terminal == 2
    assert create.active == 0
    assert create.calls == [item.canonical_url for item in candidates[:2]]


async def test_external_cancellation_emits_conserved_batch_accounting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    candidates = (_candidate(1), _candidate(2), _candidate(3))
    create = ControlledCreate()
    monkeypatch.setattr("video_note_mcp.application.operator_events.os.write", write)
    with operator_run({"tool": "search", "arguments": {"query": "趋势"}}):
        task = asyncio.create_task(_use_case(FakeSearch(candidates), create).execute("趋势", 2))
        await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
        await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert [record["event"] for record in records] == [
        "search_completed",
        "candidate_cancelled",
        "candidate_cancelled",
        "batch_completed",
    ]
    assert {
        key: records[-1][key]
        for key in ("event", "attempted", "succeeded", "failed", "cancelled", "max_active")
    } == {
        "event": "batch_completed",
        "attempted": 2,
        "succeeded": 0,
        "failed": 0,
        "cancelled": 2,
        "max_active": 2,
    }


async def test_batch_rolling_window_refills_without_waiting_for_slow_sibling(
    capsys: pytest.CaptureFixture[str],
) -> None:
    candidates = (_candidate(1), _candidate(2), _candidate(3))
    failure = BilibiliNoteFailure("SOURCE_UNAVAILABLE", "controlled_failure")
    create = ControlledCreate(failures={candidates[1].canonical_url: failure})
    progress = CaptureProgress()
    use_case = _use_case(FakeSearch(candidates), create)

    task = asyncio.create_task(use_case.execute("趋势交易", 2, progress))
    await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
    await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)
    assert create.max_active == 2
    assert candidates[2].canonical_url not in create.calls

    create.release(candidates[1].canonical_url)
    await asyncio.wait_for(create.started_event(candidates[2].canonical_url).wait(), timeout=1)
    assert create.active == 2
    assert max(progress.values) == 17
    create.release(candidates[2].canonical_url)
    await asyncio.sleep(0)
    assert not task.done()
    create.release(candidates[0].canonical_url)
    result = await task

    assert candidates[0].video_id in result.rendered_markdown
    assert candidates[1].video_id not in result.rendered_markdown
    assert candidates[2].video_id in result.rendered_markdown
    assert progress.values == sorted(progress.values)
    assert progress.values[:2] == [5, 10]
    assert progress.values[-1] <= 88
    assert create.max_active == 2
    assert capsys.readouterr().err == ""


async def test_result_authority_cancels_and_joins_unneeded_higher_candidate() -> None:
    candidates = tuple(_candidate(index) for index in range(1, 5))
    failure = BilibiliNoteFailure("SOURCE_UNAVAILABLE", "controlled_failure")
    create = ControlledCreate(failures={candidates[1].canonical_url: failure})
    use_case = _use_case(FakeSearch(candidates), create)

    task = asyncio.create_task(use_case.execute("趋势交易", 2))
    await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
    await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)
    create.release(candidates[0].canonical_url)
    create.release(candidates[1].canonical_url)
    await asyncio.wait_for(create.started_event(candidates[2].canonical_url).wait(), timeout=1)
    await asyncio.wait_for(create.started_event(candidates[3].canonical_url).wait(), timeout=1)

    create.release(candidates[2].canonical_url)
    result = await task

    assert candidates[0].video_id in result.rendered_markdown
    assert candidates[2].video_id in result.rendered_markdown
    assert create.cancelled == [candidates[3].canonical_url]
    assert create.active == 0
    assert create.max_active == 2


async def test_speculative_effectful_candidate_is_counted_when_target_prefix_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    candidates = (_candidate(1), _candidate(2), _candidate(3))
    create = EffectfulControlledCreate(effect_url=candidates[2].canonical_url)
    monkeypatch.setattr("video_note_mcp.application.operator_events.os.write", write)
    with operator_run({"tool": "search", "arguments": {"query": "趋势"}}):
        task = asyncio.create_task(_use_case(FakeSearch(candidates), create).execute("趋势", 2))
        await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
        await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)
        create.release(candidates[1].canonical_url)
        await asyncio.wait_for(create.started_event(candidates[2].canonical_url).wait(), timeout=1)
        create.release(candidates[0].canonical_url)
        result = await task

    assert result.rendered_markdown.count("NOTE:") == 2
    assert create.cancelled == [candidates[2].canonical_url]
    events = [record["event"] for record in records]
    assert events == [
        "search_completed",
        "candidate_completed",
        "media_completed",
        "asr_completed",
        "vision_started",
        "vision_completed",
        "candidate_completed",
        "candidate_cancelled",
        "batch_completed",
    ]
    assert records[-1]["attempted"] == 3
    assert records[-1]["succeeded"] == 2
    assert records[-1]["failed"] == 0
    assert records[-1]["cancelled"] == 1
    assert records[-1]["max_active"] == 2
    assert records[-2]["candidate_index"] == 3
    assert records[-2]["stage"] == ProgressStageV1.MEDIA_READY.value
    assert all(record["run_id"] == records[0]["run_id"] for record in records)
    assert all(record["input_ref"] == records[0]["input_ref"] for record in records)


def test_batch_accounting_is_conserved_when_no_candidate_was_launched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    monkeypatch.setattr("video_note_mcp.application.operator_events.os.write", write)
    coordinator = _BatchProgressCoordinator(CaptureProgress(), total=1)
    with operator_run({"tool": "search", "arguments": {"query": "趋势"}}):
        _batch_probe(coordinator=coordinator)

    assert records[0]["attempted"] == 0
    assert records[0]["succeeded"] == 0
    assert records[0]["failed"] == 0
    assert records[0]["cancelled"] == 0


async def test_completion_order_cannot_change_public_markdown() -> None:
    candidates = (_candidate(1), _candidate(2))

    async def rendered(release_order: tuple[int, int]) -> str:
        create = ControlledCreate()
        task = asyncio.create_task(_use_case(FakeSearch(candidates), create).execute("趋势交易", 2))
        for candidate in candidates:
            await asyncio.wait_for(create.started_event(candidate.canonical_url).wait(), timeout=1)
        for index in release_order:
            create.release(candidates[index].canonical_url)
            await asyncio.sleep(0)
        return (await task).rendered_markdown

    assert await rendered((0, 1)) == await rendered((1, 0))


async def test_batch_stops_without_starting_a_candidate_beyond_the_success_target() -> None:
    candidates = (_candidate(1), _candidate(2), _candidate(3))
    create = ControlledCreate()
    use_case = _use_case(FakeSearch(candidates), create)

    task = asyncio.create_task(use_case.execute("趋势交易", 2))
    await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
    await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)
    create.release(candidates[1].canonical_url)
    create.release(candidates[0].canonical_url)
    result = await task

    assert result.rendered_markdown.count("NOTE:") == 2
    assert create.calls == [item.canonical_url for item in candidates[:2]]
    assert candidates[2].canonical_url not in create.calls


async def test_unexpected_candidate_failure_cancels_and_awaits_sibling() -> None:
    candidates = (_candidate(1), _candidate(2), _candidate(3))
    create = ControlledCreate(unexpected={candidates[1].canonical_url})
    use_case = _use_case(FakeSearch(candidates), create)

    task = asyncio.create_task(use_case.execute("趋势交易", 2))
    await asyncio.wait_for(create.started_event(candidates[0].canonical_url).wait(), timeout=1)
    await asyncio.wait_for(create.started_event(candidates[1].canonical_url).wait(), timeout=1)
    create.release(candidates[1].canonical_url)
    with pytest.raises(RuntimeError, match="unexpected controlled failure"):
        await task

    assert create.cancelled == [candidates[0].canonical_url]
    assert create.active == 0
    assert candidates[2].canonical_url not in create.calls


async def test_batch_rejects_empty_search_port_result() -> None:
    use_case = _use_case(FakeSearch(()), FakeCreate())

    with pytest.raises(BilibiliNoteFailure) as caught:
        await use_case.execute("趋势交易", 2)

    assert caught.value.code == "SEARCH_EMPTY"


def test_search_candidate_rejects_mismatched_canonical_url() -> None:
    with pytest.raises(ValidationError):
        SearchCandidateV1(
            video_id="BV1uHuQ6pEFr",
            title="候选",
            canonical_url="https://www.bilibili.com/video/BV1j6um69EJn?p=1",
        )


async def test_failed_exact_count_has_no_candidate_publication():
    candidates = (_candidate(1), _candidate(2))
    create = FakeCreate(
        {candidates[1].canonical_url: BilibiliNoteFailure("SOURCE_UNAVAILABLE", "unavailable")}
    )
    publisher = RecordingPublisher()
    app = SearchAndCreateBilibiliNotes(FakeSearch(candidates), create, publisher)
    with pytest.raises(BilibiliNoteFailure, match="search_success_target_unmet"):
        await app.execute("纸飞机折叠", 2)
    assert publisher.calls == []


async def test_exact_success_publishes_collection_once_in_source_order():
    candidates = (_candidate(1), _candidate(2), _candidate(3))
    create = FakeCreate(
        {candidates[1].canonical_url: BilibiliNoteFailure("SOURCE_UNAVAILABLE", "unavailable")}
    )
    publisher = RecordingPublisher()
    app = SearchAndCreateBilibiliNotes(FakeSearch(candidates), create, publisher)
    await app.execute("纸飞机折叠", 2)
    assert len(publisher.calls) == 1
    assert [d.source.title for d in publisher.calls[0]] == [
        candidates[0].canonical_url,
        candidates[2].canonical_url,
    ]
