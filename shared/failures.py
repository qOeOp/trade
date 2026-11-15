"""The strategy's runtime failure receipts as Paper and Live read them (`FAILURES`, `failure_records`).

The runner (engine.strategy.write_failures) rewrites `<output>/runtime_failures.jsonl` whole, by rename, when a
record is new and when its count reaches a power of two: one line per distinct exception with its count and first
traceback.
"""

from __future__ import annotations

import json


FAILURES = "runtime_failures.jsonl"


def failure_records(data: bytes | None) -> list[dict]:
    """The records of a runtime_failures.jsonl. A line cut by a capture's tail or by a write in progress is left
    out."""
    found = []
    for raw in (data or b"").splitlines():
        try:
            value = json.loads(raw)
        except ValueError:
            continue
        if isinstance(value, dict) and isinstance(value.get("count"), int):
            found.append(value)
    return found
