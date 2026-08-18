from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from bilibili_note_mcp.application import operator_events


def _capture(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []

    def write(fd: int, payload: bytes) -> int:
        assert fd == 2
        records.append(json.loads(payload))
        return len(payload)

    monkeypatch.setattr(operator_events.os, "write", write)
    return records


def test_operator_events_are_closed_bounded_and_fresh_per_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", raising=False)
    records = _capture(monkeypatch)
    identity = {"tool": "bilibili_note.create", "arguments": {"url": "canonical"}}

    with operator_events.operator_run(identity) as first:
        first.emit("request_started", tool="bilibili_note.create")
        first.emit("media_completed", attempts=2, retries=1, rate_limits=0, downloaded_bytes=9)
        first.emit("request_completed")
    with operator_events.operator_run(identity) as second:
        second.emit("request_started", tool="bilibili_note.create")
        second.emit("request_completed")

    assert len({str(record["run_id"]) for record in records}) == 2
    assert len({str(record["input_ref"]) for record in records}) == 1
    assert [record["sequence"] for record in records[:3]] == [1, 2, 3]
    assert [record["sequence"] for record in records[3:]] == [1, 2]
    assert all(record["schema"] == "bilibili-note-operator-event/v1" for record in records)
    assert all(len(json.dumps(record).encode()) < 2048 for record in records)


def test_operator_event_rejects_open_or_private_fields() -> None:
    run = operator_events.OperatorRun(input_ref="input_" + "a" * 64)

    with pytest.raises(ValueError, match="fields are invalid"):
        run.emit("request_completed", transcript="private")
    with pytest.raises(ValueError, match="fields are invalid"):
        run.emit("candidate_failed", candidate_index=1, stage="x", progress=1)
    with pytest.raises(ValueError, match="fields are invalid"):
        run.emit(
            "batch_completed",
            attempted=3,
            succeeded=2,
            failed=0,
            cancelled=0,
            max_active=2,
        )
    with pytest.raises(ValueError, match="fields are invalid"):
        run.emit(
            "media_failed",
            attempts=1,
            retries=0,
            rate_limits=0,
            downloaded_bytes=7,
            code="SOURCE_UNAVAILABLE",
            reason="complete_media_download_failed",
            failure_family="extractor",
            failure_phase="after_bytes",
            attempt_downloaded_bytes=0,
            outer_exception_family="private-upstream-text",
            chain_depth=1,
            attempt_elapsed_ms=1,
        )


def test_no_request_scope_means_no_operator_write(monkeypatch: pytest.MonkeyPatch) -> None:
    called = False

    def write(fd: int, payload: bytes) -> int:
        nonlocal called
        del fd, payload
        called = True
        return 0

    monkeypatch.setattr(operator_events.os, "write", write)
    operator_events.emit_operator_event("request_completed")

    assert called is False


def test_absent_sink_env_keeps_single_fd2_write(monkeypatch: pytest.MonkeyPatch) -> None:
    writes: list[tuple[int, bytes]] = []
    monkeypatch.delenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", raising=False)
    monkeypatch.setattr(
        operator_events.os,
        "write",
        lambda fd, payload: writes.append((fd, payload)) or len(payload),
    )

    with operator_events.operator_run({"tool": "fixture"}) as run:
        run.emit("request_completed")

    assert len(writes) == 1
    assert writes[0][0] == 2
    assert writes[0][1].endswith(b"\n")


def test_absolute_sink_appends_exact_lines_across_sequential_scopes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sink = tmp_path / "operator.jsonl"
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", str(sink))
    identity = {"tool": "fixture", "arguments": {"url": "canonical"}}

    with operator_events.operator_run(identity) as first:
        first.emit("request_started", tool="fixture")
        first.emit("request_completed")
    with operator_events.operator_run(identity) as second:
        second.emit("request_started", tool="fixture")
        second.emit("request_completed")

    raw_lines = sink.read_bytes().splitlines(keepends=True)
    records = [json.loads(line) for line in raw_lines]
    assert len(raw_lines) == 4
    assert all(line.endswith(b"\n") and line.count(b"\n") == 1 for line in raw_lines)
    assert [record["sequence"] for record in records] == [1, 2, 1, 2]
    assert len({record["run_id"] for record in records}) == 2
    assert len({record["input_ref"] for record in records}) == 1
    assert all("path" not in record for record in records)


@pytest.mark.parametrize("configured", ("", "relative/events.jsonl", "missing/events.jsonl"))
def test_malformed_or_unadmitted_sink_path_drops_diagnostics_safely(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    configured: str,
) -> None:
    value = configured
    if configured.startswith("missing/"):
        value = str(tmp_path / configured)
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", value)
    writes: list[bytes] = []
    monkeypatch.setattr(
        operator_events.os,
        "write",
        lambda fd, payload: writes.append(payload) or len(payload),
    )

    with operator_events.operator_run({"tool": "fixture"}) as run:
        run.emit("request_completed")

    assert writes == []
    assert not (tmp_path / "missing" / "events.jsonl").exists()


def test_nonregular_or_unwritable_sink_fails_diagnostics_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "operator.jsonl"
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", str(target))
    original_open = operator_events.os.open

    def denied_open(path: object, flags: int, mode: int) -> int:
        del path, flags, mode
        raise PermissionError("synthetic denied sink")

    monkeypatch.setattr(operator_events.os, "open", denied_open)
    with operator_events.operator_run({"tool": "fixture"}) as run:
        run.emit("request_completed")
    assert not target.exists()

    monkeypatch.setattr(operator_events.os, "open", original_open)
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", str(tmp_path))
    with operator_events.operator_run({"tool": "fixture"}) as run:
        run.emit("request_completed")


def test_concurrent_append_keeps_every_jsonl_record_intact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sink = tmp_path / "operator.jsonl"
    monkeypatch.setenv("BILIBILI_NOTE_OPERATOR_EVENTS_PATH", str(sink))

    def emit(index: int) -> None:
        run = operator_events.OperatorRun(input_ref="input_" + f"{index:064x}")
        run.emit("request_completed")

    with ThreadPoolExecutor(max_workers=8) as pool:
        tuple(pool.map(emit, range(64)))

    raw_lines = sink.read_bytes().splitlines(keepends=True)
    records = [json.loads(line) for line in raw_lines]
    assert len(records) == 64
    assert all(line.endswith(b"\n") and line.count(b"\n") == 1 for line in raw_lines)
    assert len({record["run_id"] for record in records}) == 64
