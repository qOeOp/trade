"""Shared file, Git and schema checks for research records."""

import json
import subprocess
import tempfile
from pathlib import Path

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[2]
RECORDS = Path(__file__).resolve().parent


def _is_temporary_path(path: Path) -> bool:
    """Check both conventional and platform-selected temporary roots."""
    resolved = Path(path).expanduser().resolve()
    return any(resolved.is_relative_to(root) for root in (
        Path("/tmp").resolve(), Path(tempfile.gettempdir()).resolve(),
    ))


class RecordError(Exception):
    """A refusal plus the context needed to repair the attempted operation.

    Keep the exception text compatible with existing callers. Publication
    status defaults to unknown: a transport error must not invite a second
    write before its operation receipt has been checked.
    """

    def __init__(self, message, *, code="RECORD_ERROR", path=None, expected=None,
                 next_actions=None, write_status="unknown"):
        super().__init__(message)
        self.code, self.path, self.expected = code, path, expected
        self.next_actions = list(next_actions or [])
        self.write_status = write_status

    def as_dict(self, *, contract_version=None):
        return {"code": self.code, "message": str(self), "path": self.path,
                "expected": self.expected,
                "next_actions": self.next_actions, "write_status": self.write_status,
                **({"contract_version": contract_version} if contract_version is not None else {})}


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RecordError(f"cannot read {path}: {exc}", code="PAYLOAD_UNREADABLE",
                          path=str(path), expected="readable UTF-8 JSON object",
                          next_actions=["Check the supplied file and its encoding; preserve the original evidence rather than inventing replacement values."],
                          write_status="not_written") from exc
    if not isinstance(value, dict):
        raise RecordError(f"{path}: expected a JSON object", code="PAYLOAD_NOT_OBJECT",
                          path=str(path), expected="JSON object", write_status="not_written")
    return value


def _validator(kind: str) -> Draft202012Validator:
    schema = _read_json(RECORDS / "schemas" / f"{kind}.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def _check_commit(ref: str) -> str:
    result = subprocess.run(
        ["git", "cat-file", "-t", ref],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return (
        "present"
        if result.returncode == 0 and result.stdout.strip() == "commit"
        else "unavailable"
    )
