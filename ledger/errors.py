"""The one refusal type every ledger function raises (`ledger.refusal`).

A refusal says which code was refused, what is missing, the expected shape, whether this call
wrote anything, and the commands that supply what is missing. It never carries SQL, service
paths, credentials or a way around a check, and it is never stored. This module depends on
nothing else; the commands come from `ledger.refusals`, passed in by the raiser.
"""

from __future__ import annotations

import re
from typing import Literal


CODE = re.compile(r"[A-Z][A-Z0-9_]*\Z")
WRITE_STATUSES = ("not_written", "unknown")


class Refusal(Exception):
    """A coded refusal; `as_dict()` is what a command prints before it exits nonzero."""

    def __init__(self, code: str, message: str, *, missing: tuple[str, ...] = (),
                 write_status: Literal["not_written", "unknown"] = "unknown", operation_id: str | None = None,
                 expected: str | None = None, next_actions: tuple[str, ...] = ()):
        if not isinstance(code, str) or not CODE.fullmatch(code):
            raise ValueError(f"refusal code must be UPPER_SNAKE_CASE, got {code!r}")
        if write_status not in WRITE_STATUSES:
            raise ValueError(f"write_status must be one of {WRITE_STATUSES}, got {write_status!r}")
        if write_status == "unknown" and not operation_id:
            raise ValueError("a refusal whose write may have landed needs the operation_id to retry with")
        super().__init__(message)
        self._code, self._message = code, str(message)
        self._missing = tuple(str(item) for item in missing)
        self._write_status, self._operation_id = write_status, operation_id
        self._expected = expected
        self._next_actions = tuple(next_actions)

    code = property(lambda self: self._code)
    message = property(lambda self: self._message)
    missing = property(lambda self: self._missing)
    write_status = property(lambda self: self._write_status)
    operation_id = property(lambda self: self._operation_id)
    expected = property(lambda self: self._expected)
    next_actions = property(lambda self: self._next_actions)

    def as_dict(self) -> dict:
        return {"code": self._code, "message": self._message, "missing": list(self._missing),
                "expected": self._expected, "write_status": self._write_status,
                "operation_id": self._operation_id}

    def __str__(self) -> str:
        return f"{self._code}: {self._message}"


def refusal(code: str, message: str, missing: tuple[str, ...] = (),
            write_status: Literal["not_written", "unknown"] = "unknown", operation_id: str | None = None,
            expected: str | None = None, next_actions: tuple[str, ...] = ()) -> Refusal:
    """Build (not raise) a refusal; malformed arguments are programming errors (ValueError)."""
    return Refusal(code, message, missing=missing, write_status=write_status, operation_id=operation_id,
                   expected=expected, next_actions=next_actions)
