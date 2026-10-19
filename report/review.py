"""The whole-ledger review (`report.review_all`): with the reader account at one exact version, rerun
the commit checks, read every business table's history for changed or removed rows, check that the
latest backup's head is still an ancestor of the research head, recompute what the stored cycles and
daily series determine against each passed run's sealed result, and check fingerprints, captures,
registration order, grid membership, witnesses and the one-to-one out-of-sample bindings. Every
difference is a finding; nothing is written and no write transaction is opened.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
import json
import math

from ledger import admin, db, execution, metrics, witness
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import register


# Finding codes and their meaning (findings are reported, never stored).
FINDINGS = {
    "COMMIT_TEST_FAILED": "A commit verification test (dolt_tests) fails at this version.",
    "ROW_CHANGED": "A row of an append-only table was modified or removed in the ledger history.",
    "HISTORY_REWRITTEN": "The latest backup's head commit is no ancestor of the research head: a commit was rewritten "
                         "(the writer account can amend its last commit).",
    "READING_MISMATCH": "A value the stored cycles or daily series determine differs from the run's sealed result.",
    "SEALED_RESULT_MISSING": "A passed run has no sealed result row.",
    "FINGERPRINT_MISSING": "A passed run has no semantic fingerprint, so it cannot be reproduced.",
    "CAPTURE_MISSING": "A run's trial has no original execution capture.",
    "CAPTURE_UNREADABLE": "A run's execution capture or start receipt does not verify.",
    "REGISTRATION_AFTER_TRIAL": "A registration attempt's registration was recorded no earlier than its trial.",
    "SOURCE_NOT_IN_GRID": "A registration attempt consumed a source outside the registration's locked grid.",
    "REGISTRATION_UNREADABLE": "A registration bundle of an attempt cannot be read.",
    "WITNESS_MISSING": "A validation registration commit has no verified timestamp token.",
    "WITNESS_LATE": "A validation registration's timestamp is not before its window start.",
    "VALIDATION_BINDING_INVALID": "A validation binding binds a trial that is not a validation trial, or a validation "
                                  "trial is bound other than once.",
}
UNCHECKED = ("ledger_head",)
EQUITY_TOLERANCE = metrics.EQUITY_TOLERANCE


def _finding(code: str, table: str | None, record_id, commit: str | None, detail: str) -> dict:
    return {"code": code, "table": table, "record_id": None if record_id is None else str(record_id), "commit": commit,
            "detail": detail}


def _tables(conn: db.LedgerConnection) -> list[str]:
    return sorted(name for name, kind in conn.rows("SHOW FULL TABLES")
                  if kind == "BASE TABLE" and not name.startswith("dolt_") and name not in UNCHECKED)


def _primary_key(conn: db.LedgerConnection, table: str) -> list[str]:
    return [name for (name,) in conn.rows(
        "SELECT column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = %s "
        "AND constraint_name = 'PRIMARY' ORDER BY ordinal_position", (table,))]


def _history(profile: db.LedgerProfile, head: str) -> tuple[dict, list[dict]]:
    """(the backup check, its findings): HISTORY_REWRITTEN when the latest backup's head commit is
    no ancestor of the research head."""
    backup = admin.backup_path(profile)
    if backup is None or not backup.is_dir():
        return {"backup": None if backup is None else str(backup), "head": None, "status": "no_backup"}, []
    backed = admin.backup_head(profile, backup)
    if backed is None:
        return {"backup": str(backup), "head": None, "status": "no_branch"}, [_finding(
            "HISTORY_REWRITTEN", None, None, None, f"the backup at {backup} has no {profile.research_branch} branch")]
    with db.connect(profile, "reader") as branch:
        (count,), = branch.rows("SELECT COUNT(*) FROM dolt_log WHERE commit_hash = %s", (backed,))
    if count:
        return {"backup": str(backup), "head": backed, "status": "ancestor", "research_head": head}, []
    return {"backup": str(backup), "head": backed, "status": "not_ancestor", "research_head": head}, [_finding(
        "HISTORY_REWRITTEN", None, None, backed, f"the backup head {backed} is no ancestor of the research head {head}")]


def _run_findings(conn: db.LedgerConnection, run: Mapping, commit: str) -> tuple[list[dict], bool]:
    """(findings, whether a capture was checked) of one run."""
    found, run_id = [], run["run_id"]
    try:
        capture = execution.read_capture(conn, run["trial_id"])
    except Refusal as exc:
        return [_finding("CAPTURE_UNREADABLE", "run", run_id, commit, f"{exc.code}: {exc.message}")], True
    if capture["status"] != "captured":
        found.append(_finding("CAPTURE_MISSING", "run", run_id, commit, capture.get("reason") or "missing"))
    if run["status"] != "passed":
        return found, True
    if run["fingerprints"] is None:
        found.append(_finding("FINGERPRINT_MISSING", "run", run_id, commit, "the passed run has no semantic fingerprint"))
    sealed_rows = conn.rows("SELECT report FROM run_sealed WHERE run_id = %s ORDER BY created_at DESC LIMIT 1", (run_id,))
    if not sealed_rows:
        found.append(_finding("SEALED_RESULT_MISSING", "run_sealed", run_id, commit, "no sealed result"))
        return found, True
    report = sealed_rows[0][0]
    report = report if isinstance(report, Mapping) else json.loads(report)
    (cycles,), = conn.rows("SELECT COUNT(*) FROM run_cycle WHERE run_id = %s", (run_id,))
    returns = conn.rows("SELECT native_return FROM run_return WHERE run_id = %s ORDER BY ts_event_ns", (run_id,))
    populations = report.get("populations") or {}
    activity = report.get("activity") or {}
    checks = [("populations.cycles", populations.get("cycles"), cycles),
              ("populations.days", populations.get("days"), len(returns))]
    if (activity.get("cycles_cover_fills@1") or {}).get("passed"):
        checks.append(("activity.cycles_cover_fills@1.count", activity["cycles_cover_fills@1"].get("count"), cycles))
    for name, stored, counted in checks:
        if stored is not None and stored != counted:
            found.append(_finding("READING_MISMATCH", "run_sealed", run_id, commit,
                                  f"{name} is {stored}, the stored rows give {counted}"))
    compounding = activity.get("returns_compound_to_equity@1") or {}
    coverage = capture.get("input_coverage") if isinstance(capture.get("input_coverage"), Mapping) else {}
    starting = ((coverage.get("effective_config") or {}).get("account") or {}).get("starting_balance_usdt")
    if compounding.get("passed") and compounding.get("compounded") is not None and starting is not None:
        recomputed = Decimal(str(starting)) * Decimal(repr(math.prod(1 + value for (value,) in returns)))
        if abs(recomputed - Decimal(compounding["compounded"])) > EQUITY_TOLERANCE:
            found.append(_finding("READING_MISMATCH", "run_return", run_id, commit,
                                  f"the daily series compounds to {recomputed:.2f}, the sealed result records "
                                  f"{compounding['compounded']}"))
    return found, True


def _registration_findings(conn: db.LedgerConnection, commit: str) -> tuple[list[dict], int]:
    found, checked = [], set()
    for bundle, source, trial_id, created, trial_created in conn.rows(
            "SELECT a.registration_bundle, a.source_sha256, a.trial_id, b.created_at, t.created_at FROM "
            "registration_attempt a JOIN evidence_bundle b ON b.bundle = a.registration_bundle JOIN trial t ON "
            "t.trial_id = a.trial_id ORDER BY a.trial_id"):
        checked.add(bundle)
        if not created < trial_created:
            found.append(_finding("REGISTRATION_AFTER_TRIAL", "registration_attempt", trial_id, commit,
                                  f"{bundle} was recorded at {created}, trial {trial_id} at {trial_created}"))
        try:
            body = register.load_plan(conn, bundle)[0]["body"]
        except Refusal as exc:
            found.append(_finding("REGISTRATION_UNREADABLE", "evidence", bundle, commit, f"{exc.code}: {exc.message}"))
            continue
        grid = set()
        for point in body.get("grid") or ():
            strategy_id, _, revision = str(point.get("candidate")).partition("@")
            row = conn.one("SELECT source_sha256 FROM candidate WHERE strategy_id = %s AND revision = %s",
                           (strategy_id, int(revision) if revision.isdigit() else -1))
            if row:
                grid.add(row["source_sha256"])
        if source not in grid:
            found.append(_finding("SOURCE_NOT_IN_GRID", "registration_attempt", trial_id, commit,
                                  f"trial {trial_id} consumed source {source} outside the grid of {bundle}"))
    return found, len(checked)


def _validation_findings(conn: db.LedgerConnection, commit: str) -> tuple[list[dict], int]:
    found = []
    registrations = conn.dicts("SELECT g.registration_id, g.window_start, d.to_commit FROM validation_registration g "
                               "LEFT JOIN dolt_diff_validation_registration d ON d.to_registration_id = g.registration_id "
                               "AND d.diff_type = 'added' ORDER BY g.registration_id")
    for row in registrations:
        try:
            stamped = witness.stamped_at(conn, row["to_commit"]) if row["to_commit"] else None
        except Refusal as exc:
            stamped = None
            detail = f"{exc.code}: {exc.message}"
        else:
            detail = "no timestamp token for the registration commit"
        if stamped is None:
            found.append(_finding("WITNESS_MISSING", "validation_registration", row["registration_id"], row["to_commit"],
                                  detail))
        elif not stamped.replace(tzinfo=None) < row["window_start"]:
            found.append(_finding("WITNESS_LATE", "validation_registration", row["registration_id"], row["to_commit"],
                                  f"stamped at {stamped}, the window starts {row['window_start']}"))
    for trial_id, purpose, bound in conn.rows(
            "SELECT t.trial_id, t.purpose, COUNT(b.registration_id) FROM trial t LEFT JOIN validation_binding b ON "
            "b.trial_id = t.trial_id WHERE t.purpose = 'validation' OR b.trial_id IS NOT NULL GROUP BY t.trial_id, "
            "t.purpose ORDER BY t.trial_id"):
        if purpose != "validation" or bound != 1:
            found.append(_finding("VALIDATION_BINDING_INVALID", "validation_binding", trial_id, commit,
                                  f"trial {trial_id} ({purpose}) is bound {bound} times"))
    return found, len(registrations)


def review_all(conn: db.LedgerConnection, at: str | None = None, tables: list[str] | None = None,
               run_ids: list | None = None) -> dict:
    """The whole review at one exact version with the reader account; every difference a finding."""
    admin.require_reader(conn)
    findings = []
    with db.read_as_of(conn.profile, at) as pinned:
        commit = db.head_commit(pinned)
        try:
            tests = pinned.rows("SELECT test_name, status, message FROM dolt_test_run('*')")
        except Refusal as exc:
            raise refuse("LEDGER_UNAVAILABLE", "dolt_tests cannot be run at this version; the review cannot start") from exc
        for name, status, message in tests:
            if str(status).upper() != "PASS":
                findings.append(_finding("COMMIT_TEST_FAILED", "dolt_tests", name, commit, str(message or status)))
        checked = list(tables) if tables is not None else _tables(pinned)
        for table in checked:
            if not db.IDENTIFIER.fullmatch(table):
                raise refuse("INVALID_NAME", f"{table!r} is not a ledger table name", missing=(table,))
            keys = _primary_key(pinned, table)
            columns = ", ".join(f"from_{key}" for key in keys) or "'?'"
            try:
                changed = pinned.rows(f"SELECT diff_type, to_commit, {columns} FROM `dolt_diff_{table}` WHERE diff_type "
                                      "<> 'added'")
            except Refusal as exc:
                raise refuse("LEDGER_UNAVAILABLE", f"dolt_diff_{table} cannot be read; the review cannot start") from exc
            for diff_type, to_commit, *key in changed:
                findings.append(_finding("ROW_CHANGED", table, "/".join(str(item) for item in key), to_commit,
                                         f"a {table} row was {diff_type}"))
        head = db.resolve_commit(pinned, conn.profile.research_branch)
        history, found = _history(conn.profile, head)
        findings += found
        wanted = None if run_ids is None else {int(item) for item in run_ids}
        runs = [row for row in pinned.dicts("SELECT run_id, trial_id, status, fingerprints FROM run ORDER BY run_id")
                if wanted is None or row["run_id"] in wanted]
        captures = 0
        for row in runs:
            if isinstance(row["fingerprints"], (str, bytes)):
                row["fingerprints"] = json.loads(row["fingerprints"])
            found, checked_capture = _run_findings(pinned, row, commit)
            findings += found
            captures += checked_capture
        found, registrations = _registration_findings(pinned, commit)
        findings += found
        found, validations = _validation_findings(pinned, commit)
        findings += found
    return {"at": at, "commit": commit, "tests_run": len(tests), "tables_checked": checked, "runs_checked": len(runs),
            "captures_checked": captures, "registrations_checked": registrations, "validations_checked": validations,
            "history": history, "ok": not findings, "findings": findings}
