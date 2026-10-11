"""Shared refusal type and path checks for research records."""

import json
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _is_temporary_path(path: Path) -> bool:
    """Check both conventional and platform-selected temporary roots."""
    resolved = Path(path).expanduser().resolve()
    return any(resolved.is_relative_to(root) for root in (
        Path("/tmp").resolve(), Path(tempfile.gettempdir()).resolve(),
    ))


class RecordError(Exception):
    """A refusal plus the context needed to repair the attempted operation.

    `write_status` is `not_written` when this invocation wrote nothing, `unknown` when a write
    may have landed (rerun the same command: writes are idempotent by operation ID).
    """

    def __init__(self, message, *, code="RECORD_ERROR", path=None, expected=None,
                 next_actions=None, write_status="unknown"):
        super().__init__(message)
        self.code, self.path, self.expected = code, path, expected
        self.next_actions = list(next_actions or [])
        self.write_status = write_status

    def as_dict(self):
        return {"code": self.code, "message": str(self), "path": self.path, "expected": self.expected,
                "next_actions": self.next_actions, "write_status": self.write_status}


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RecordError(f"cannot read {path}: {exc}", code="PAYLOAD_UNREADABLE", path=str(path),
                          expected="readable UTF-8 JSON object", write_status="not_written") from exc
    if not isinstance(value, dict):
        raise RecordError(f"{path}: expected a JSON object", code="PAYLOAD_NOT_OBJECT", path=str(path),
                          expected="JSON object", write_status="not_written")
    return value
