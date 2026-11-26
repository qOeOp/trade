"""The shared policy for a failed review whose precheck did not show the source's activity.

Callers supply only validated reviews within their source identity and visibility scope.
This derives a read-time decision from immutable reviews and sealed capture counts.
"""

from __future__ import annotations

from collections.abc import Callable

from ledger import db, execution


SOURCE_ITEMS = ("api", "causal", "readiness")


def _status(record: dict, item: str):
    value = record.get(item)
    return value.get("status") if isinstance(value, dict) else None


def resolved(conn: db.LedgerConnection, record: dict, reviewed: list[dict], *,
             eligible_trial: Callable[[int], bool] | None = None) -> bool:
    """True for a failed review that says only that its precheck did not show the source's activity: api, causal
    and readiness passed, and activity either unresolved (an order path the change adds or alters never ran) or
    failed on a precheck that sealed no fill and no position; and a later precheck of the same source sealed fills
    cleanly (precheck_rows: completed, native/audit/fingerprint exited 0, audit passed, no runtime failure), satisfies
    `eligible_trial` when given, and has a passed review and no failed one (`reviewed`: the product reviews of the
    source). Activity depends on the run; the other items are properties of the source and still refuse."""
    if record["verdict"] != "failed" or any(_status(record, item) != "passed" for item in SOURCE_ITEMS):
        return False
    activity = _status(record, "activity")
    if activity == "failed":
        rows = execution.precheck_rows(conn, record["trial_id"])
        if rows is None or rows.get("fills") != 0 or rows.get("positions") != 0:
            return False
    elif activity != "unresolved":
        return False
    later: dict[int, set[str]] = {}
    for other in reviewed:
        if other["trial_id"] > record["trial_id"]:
            later.setdefault(other["trial_id"], set()).add(other["verdict"])
    return any(found == {"passed"} and (eligible_trial is None or eligible_trial(trial_id))
               and (execution.precheck_rows(conn, trial_id) or {}).get("fills", 0) > 0
               for trial_id, found in later.items())
