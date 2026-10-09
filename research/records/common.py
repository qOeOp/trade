"""Shared file, Git and schema checks for research records."""

import json
import subprocess
from pathlib import Path

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[2]
RECORDS = Path(__file__).resolve().parent


class RecordError(Exception):
    pass


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RecordError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise RecordError(f"{path}: expected a JSON object")
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
