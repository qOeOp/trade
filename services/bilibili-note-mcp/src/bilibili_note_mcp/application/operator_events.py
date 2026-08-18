from __future__ import annotations

import contextvars
import hashlib
import json
import os
import secrets
import stat
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

OperatorEventName = Literal[
    "request_started",
    "request_completed",
    "request_failed",
    "request_cancelled",
    "media_completed",
    "media_failed",
    "search_completed",
    "search_failed",
    "asr_completed",
    "asr_failed",
    "candidate_completed",
    "candidate_failed",
    "candidate_cancelled",
    "batch_completed",
    "vision_started",
    "vision_completed",
    "vision_failed",
]

_FIELDS: dict[OperatorEventName, frozenset[str]] = {
    "request_started": frozenset({"tool"}),
    "request_completed": frozenset(),
    "request_failed": frozenset({"code", "reason"}),
    "request_cancelled": frozenset(),
    "media_completed": frozenset({"attempts", "retries", "rate_limits", "downloaded_bytes"}),
    "media_failed": frozenset(
        {
            "attempts",
            "retries",
            "rate_limits",
            "downloaded_bytes",
            "code",
            "reason",
            "failure_family",
            "failure_phase",
            "attempt_downloaded_bytes",
            "outer_exception_family",
            "chain_depth",
            "attempt_elapsed_ms",
        }
    ),
    "search_completed": frozenset({"candidates"}),
    "search_failed": frozenset({"code", "reason"}),
    "asr_completed": frozenset({"windows", "attempts", "retries", "rate_limits"}),
    "asr_failed": frozenset({"windows", "attempts", "retries", "rate_limits", "code", "reason"}),
    "candidate_completed": frozenset({"candidate_index", "stage", "progress"}),
    "candidate_failed": frozenset({"candidate_index", "stage", "progress", "code", "reason"}),
    "candidate_cancelled": frozenset({"candidate_index", "stage", "progress"}),
    "batch_completed": frozenset({"attempted", "succeeded", "failed", "cancelled", "max_active"}),
    "vision_started": frozenset({"groups", "frames"}),
    "vision_completed": frozenset({"groups", "frames"}),
    "vision_failed": frozenset({"groups", "frames", "code", "reason"}),
}
_RUN_ID_BYTES = 16
_MAX_LINE_BYTES = 2048
_SINK_ENV = "BILIBILI_NOTE_OPERATOR_EVENTS_PATH"
_MEDIA_OUTER_EXCEPTION_FAMILIES = frozenset(
    {
        "http",
        "transport",
        "content_short",
        "extractor",
        "unavailable",
        "download",
        "builtin_timeout",
        "os_error",
        "other",
    }
)


@dataclass(frozen=True, slots=True)
class _OperatorSink:
    enabled: bool
    path: Path | None


def _configured_sink() -> _OperatorSink:
    raw = os.environ.get(_SINK_ENV)
    if raw is None:
        return _OperatorSink(enabled=True, path=None)
    if not raw or "\x00" in raw:
        return _OperatorSink(enabled=False, path=None)
    path = Path(raw)
    try:
        parent_is_directory = path.parent.is_dir()
        target_is_admitted = not path.exists() or (path.is_file() and not path.is_symlink())
    except OSError:
        return _OperatorSink(enabled=False, path=None)
    if not path.is_absolute() or not path.name or not parent_is_directory or not target_is_admitted:
        return _OperatorSink(enabled=False, path=None)
    return _OperatorSink(enabled=True, path=path)


def _append_event(sink: _OperatorSink, line: bytes) -> None:
    if not sink.enabled:
        return
    if sink.path is None:
        os.write(2, line)
        return
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
    flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(sink.path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            return
        # O_APPEND binds offset selection and this already-bounded line in one kernel write.
        os.write(descriptor, line)
    finally:
        os.close(descriptor)


def _input_ref(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=lambda _: "<invalid>",
    ).encode("utf-8")
    return "input_" + hashlib.sha256(encoded).hexdigest()


def _field_is_safe(value: object) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    if isinstance(value, int):
        return 0 <= value <= 2**63 - 1
    return isinstance(value, str) and 0 < len(value) <= 64 and "\n" not in value


def _event_fields_are_consistent(event: OperatorEventName, fields: dict[str, object]) -> bool:
    if event == "media_failed":
        downloaded_bytes = fields["downloaded_bytes"]
        attempt_downloaded_bytes = fields["attempt_downloaded_bytes"]
        failure_phase = fields["failure_phase"]
        outer_exception_family = fields["outer_exception_family"]
        if (
            not isinstance(downloaded_bytes, int)
            or isinstance(downloaded_bytes, bool)
            or not isinstance(attempt_downloaded_bytes, int)
            or isinstance(attempt_downloaded_bytes, bool)
        ):
            return False
        return (
            attempt_downloaded_bytes <= downloaded_bytes
            and (failure_phase == "after_bytes") == (attempt_downloaded_bytes > 0)
            and outer_exception_family in _MEDIA_OUTER_EXCEPTION_FAMILIES
        )
    if event != "batch_completed":
        return True
    attempted = fields["attempted"]
    succeeded = fields["succeeded"]
    failed = fields["failed"]
    cancelled = fields["cancelled"]
    max_active = fields["max_active"]
    if (
        not isinstance(attempted, int)
        or isinstance(attempted, bool)
        or not isinstance(succeeded, int)
        or isinstance(succeeded, bool)
        or not isinstance(failed, int)
        or isinstance(failed, bool)
        or not isinstance(cancelled, int)
        or isinstance(cancelled, bool)
        or not isinstance(max_active, int)
        or isinstance(max_active, bool)
    ):
        return False
    return attempted == succeeded + failed + cancelled and max_active <= attempted


@dataclass(slots=True)
class OperatorRun:
    input_ref: str
    run_id: str = field(default_factory=lambda: secrets.token_hex(_RUN_ID_BYTES))
    started_at: float = field(default_factory=time.monotonic)
    _sink: _OperatorSink = field(default_factory=_configured_sink)
    _sequence: int = 0

    def emit(self, event: OperatorEventName, **fields: object) -> None:
        if (
            frozenset(fields) != _FIELDS[event]
            or not all(_field_is_safe(value) for value in fields.values())
            or not _event_fields_are_consistent(event, fields)
        ):
            raise ValueError("operator event fields are invalid")
        self._sequence += 1
        payload: dict[str, object] = {
            "schema": "bilibili-note-operator-event/v1",
            "event": event,
            "run_id": self.run_id,
            "input_ref": self.input_ref,
            "sequence": self._sequence,
            "elapsed_ms": round((time.monotonic() - self.started_at) * 1000),
            **fields,
        }
        line = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode()
        if len(line) > _MAX_LINE_BYTES:
            raise ValueError("operator event is too large")
        try:
            _append_event(self._sink, line)
        except OSError:
            # Operator observability is diagnostic and must not mutate the public tool result.
            return


_CURRENT_RUN: contextvars.ContextVar[OperatorRun | None] = contextvars.ContextVar(
    "bilibili_note_operator_run", default=None
)


@contextmanager
def operator_run(input_value: object) -> Iterator[OperatorRun]:
    run = OperatorRun(input_ref=_input_ref(input_value))
    token = _CURRENT_RUN.set(run)
    try:
        yield run
    finally:
        _CURRENT_RUN.reset(token)


def emit_operator_event(event: OperatorEventName, **fields: object) -> None:
    run = _CURRENT_RUN.get()
    if run is not None:
        try:
            run.emit(event, **fields)
        except ValueError:
            # A diagnostic projection cannot change the public request outcome.
            return
