"""The ledger review (`report.review_all`): with the reader account at one exact version, check the
commitment layer of the commits after `since` (every commit without it): that `since` is still in the
head's history, that no commitment row was changed or removed, that every added row matches its foreign
keys (the writer can turn foreign key checks off), that every change of a reading
is a reseal commit and nothing else, and that every witness stamps the commit that added its validation
registration on this branch. It also checks that the latest backup's head is still an ancestor of the
research head (without a backup, says that this was not checked), recomputes what the stored cycles
and daily series determine against each new passed run's reading, and checks captures, registration
order and the validation witnesses' times. Every difference is a finding; nothing is written and no
write transaction is opened.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
import json

from ledger import admin, db, execution, metrics, witness
from report import measures, profit
from shared.errors import Refusal
from shared.refusals import refuse
from registration import validation


# Finding codes and their meaning (findings are reported, never stored).
FINDINGS = {
    "ROW_CHANGED": "A row of a commitment table was modified or removed in the ledger history.",
    "HISTORY_REWRITTEN": "The latest backup's head commit, or the commit the review continues from, is no ancestor of "
                         "the research head: a commit was rewritten (the writer account can amend its last commit).",
    "BACKUP_UNREADABLE": "The latest backup exists but its head commit cannot be read (restore failed, timed out or "
                         "returned no readable branch list); rewritten history was not checked.",
    "CONSTRAINT_VIOLATED": "A row matches no row of a table its foreign key names (the writer can turn foreign key "
                           "checks off in its session).",
    "READING_REPLACED_OUTSIDE_RESEAL": "A run_reading row was changed or removed by a commit that is not a reseal "
                                       "of that reading, or a reseal commit also wrote a commitment row.",
    "WITNESS_UNBOUND": "A witness token stamps a commit that did not add its validation registration, or a commit "
                       "outside the branch's history.",
    "READING_MISMATCH": "A value the stored cycles or daily series determine (the profit bridge, plan tags, the "
                        "whole-day series behind the monthly figures) differs from the run's reading.",
    "SEALED_RESULT_MISSING": "A passed run has no reading row.",
    "CAPTURE_MISSING": "A run's trial has no original execution capture.",
    "CAPTURE_UNREADABLE": "A run's execution capture or start receipt does not verify.",
    "REGISTRATION_AFTER_TRIAL": "A research trial's registration was recorded no earlier than the trial, or was "
                                "added in the trial's own commit.",
    "WITNESS_MISSING": "The original validation registration commit has no verified timestamp token.",
    "WITNESS_LATE": "The original validation registration's timestamp is not before its window start.",
}
# Not commitments: the write coordination row and the one replaceable reading per run (checked apart).
UNCHECKED = ("ledger_head", "run_reading")
READINGS = "run_reading"
RESEAL = "reseal"  # the write kind of a reseal (db.write commits it as `reseal:<op_id>`)
HISTORY_UNCHECKED = ("HISTORY_UNCHECKED: no readable backup, so whether a commit was rewritten (an amended last "
                     "commit) was not checked")


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


def _history(profile: db.LedgerProfile, head: str,
             contains: Callable[[str], bool]) -> tuple[dict, list[dict], list[str]]:
    """(the backup check, its findings, its limitations): HISTORY_REWRITTEN when the latest backup's
    head commit is no ancestor of the head (`contains`: the commit is in the head's history),
    BACKUP_UNREADABLE when the backup's head cannot be read, and without a backup the limitation that
    rewritten history was not checked."""
    backup = admin.backup_path(profile)
    if backup is None or not backup.is_dir():
        return ({"backup": None if backup is None else str(backup), "head": None, "status": "no_backup"}, [],
                [HISTORY_UNCHECKED])
    try:
        backed = admin.backup_head(backup)
    except Refusal as exc:
        return ({"backup": str(backup), "head": None, "status": "unreadable"},
                [_finding("BACKUP_UNREADABLE", None, None, None, f"{exc.code}: {exc.message}")], [HISTORY_UNCHECKED])
    if backed is None:
        return {"backup": str(backup), "head": None, "status": "no_branch"}, [_finding(
            "HISTORY_REWRITTEN", None, None, None,
            f"the backup at {backup} has no {db.BRANCH} branch")], []
    if contains(backed):
        return {"backup": str(backup), "head": backed, "status": "ancestor", "research_head": head}, [], []
    return {"backup": str(backup), "head": backed, "status": "not_ancestor", "research_head": head}, [_finding(
        "HISTORY_REWRITTEN", None, None, backed,
        f"the backup head {backed} is no ancestor of the research head {head}")], []


def _in_branch(profile: db.LedgerProfile, commit: str) -> bool:
    with db.connect(profile, "reader") as branch:
        (count,), = branch.rows("SELECT COUNT(*) FROM dolt_log WHERE commit_hash = %s", (commit,))
    return bool(count)


def _ns(moment) -> int:
    return metrics.utc_ns(moment.replace(tzinfo=None).isoformat() + "Z")


def _sealed_rows_findings(conn: db.LedgerConnection, trial_id: int, commit: str, report: Mapping,
                          trial: Mapping, native_economics=None) -> list[dict]:
    """What the stored cycles and daily series determine against the reading: the whole-day series behind the
    monthly figures, the profit bridge and the plan tags."""
    found = []

    def mismatch(table: str, detail: str) -> None:
        found.append(_finding("READING_MISMATCH", table, trial_id, commit, detail))

    cycles = conn.dicts(f"SELECT ts_closed_ns, realized_pnl, commissions, funding, {metrics.PRICE_PNL}, "
                        "open_unrealized, plan_tag FROM run_cycle WHERE trial_id = %s ORDER BY seq", (trial_id,))
    returns = [(int(ts), float(value)) for ts, value in conn.rows(
        "SELECT ts_event_ns, native_return FROM run_return WHERE trial_id = %s ORDER BY ts_event_ns", (trial_id,))]
    starting = trial["starting_balance"]
    final = measures.final_equity(starting, returns)
    activity = report.get("activity") or {}
    if (activity.get("returns_compound_to_equity") or {}).get("passed") and final is not None:
        limitations: list[str] = []
        summary = {"period_start_utc": str(_ns(trial["trade_start"])), "period_end_utc": str(_ns(trial["trade_end"])),
                   "starting_balance_usdt": str(starting), "final_equity_usdt": str(final)}
        if metrics.daily_returns(returns, summary, limitations) is None:
            mismatch("run_return", "the monthly figures have no whole daily series: " + "; ".join(limitations))
    if final is not None:
        bridge = profit.account_bridge(cycles, starting, final, native_economics)
        if bridge["reason"] and any(code in bridge["reason"] for code in ("MISMATCH", "BRIDGE_UNRECONCILED")):
            mismatch("run_cycle", bridge["reason"])
    if measures.plans_hold(report) is None:
        untagged = sum(1 for cycle in cycles if cycle["plan_tag"] is None)
        if untagged:
            mismatch("run_cycle", f"the sealed plan contract holds, but {untagged} stored cycles carry no plan tag")
    return found


def _run_findings(conn: db.LedgerConnection, run: Mapping, commit: str) -> list[dict]:
    found, trial_id = [], run["trial_id"]
    try:
        capture = execution.read_capture(conn, trial_id)
    except Refusal as exc:
        return [_finding("CAPTURE_UNREADABLE", "run", trial_id, commit, f"{exc.code}: {exc.message}")]
    if capture["status"] != "captured":
        found.append(_finding("CAPTURE_MISSING", "run", trial_id, commit, capture.get("reason") or "missing"))
    if run["status"] != "passed":
        return found
    reading = conn.one("SELECT report FROM run_reading WHERE trial_id = %s", (trial_id,))
    if reading is None:
        found.append(_finding("SEALED_RESULT_MISSING", READINGS, trial_id, commit, "no reading"))
        return found
    report = reading["report"] if isinstance(reading["report"], Mapping) else json.loads(reading["report"])
    trial = conn.one("SELECT starting_balance, trade_start, trade_end FROM trial WHERE trial_id = %s", (trial_id,))
    assert trial is not None  # run.trial_id is a foreign key to trial
    found += _sealed_rows_findings(conn, trial_id, commit, report, trial, profit.native_economics(capture))
    return found


def _registration_findings(conn: db.LedgerConnection, commit: str, new: str, since: tuple) -> tuple[list[dict], int]:
    """REGISTRATION_AFTER_TRIAL for a research trial whose registration was not committed before it: recorded
    later, or added in the trial's own commit (the writer can write both before one commit)."""
    found = []
    rows = conn.rows("SELECT r.registration_id, t.trial_id, r.created_at, t.created_at, a.to_commit, "
                     "(SELECT g.to_commit FROM dolt_diff_research_registration g WHERE g.diff_type = 'added' AND "
                     "g.to_registration_id = r.registration_id LIMIT 1) FROM trial t JOIN research_registration r ON "
                     "r.registration_id = t.research_registration_id JOIN dolt_diff_trial a ON a.to_trial_id = "
                     f"t.trial_id AND a.diff_type = 'added'{new.replace('to_commit', 'a.to_commit')} ORDER BY t.trial_id",
                     since)
    for registration_id, trial_id, created, trial_created, trial_commit, registration_commit in rows:
        if not created < trial_created:
            found.append(_finding("REGISTRATION_AFTER_TRIAL", "trial", trial_id, commit,
                                  f"research registration {registration_id} was recorded at {created}, trial "
                                  f"{trial_id} at {trial_created}"))
        elif registration_commit == trial_commit:
            found.append(_finding("REGISTRATION_AFTER_TRIAL", "trial", trial_id, trial_commit,
                                  f"research registration {registration_id} and trial {trial_id} were added in the "
                                  f"same commit {trial_commit}"))
    return found, len({row[0] for row in rows})


def _validation_findings(conn: db.LedgerConnection, commit: str) -> tuple[list[dict], int]:
    """WITNESS_UNBOUND for a token on a commit that did not add its registration or is off this branch;
    WITNESS_MISSING and WITNESS_LATE for each registration's original."""
    found = []
    for commit_hash, registration_id, added, on_branch in conn.rows(
            "SELECT w.commit_hash, w.registration_id, (SELECT COUNT(*) FROM dolt_diff_validation_registration d WHERE "
            "d.to_commit = w.commit_hash AND d.diff_type = 'added' AND d.to_registration_id = w.registration_id), "
            "(SELECT COUNT(*) FROM dolt_log l WHERE l.commit_hash = w.commit_hash) FROM witness w "
            "ORDER BY w.registration_id"):
        if not added or not on_branch:
            found.append(_finding("WITNESS_UNBOUND", "witness", commit_hash, commit_hash,
                                  f"the token of registration {registration_id} stamps {commit_hash}, which "
                                  + ("is not in the branch's history" if not on_branch else "did not add it")))
    registrations = conn.dicts("SELECT g.registration_id, g.window_start, g.retry_of, w.commit_hash "
                               "FROM validation_registration g LEFT JOIN witness w ON w.registration_id = "
                               "g.registration_id ORDER BY g.registration_id")
    commits = {row["registration_id"]: row["commit_hash"] for row in registrations}
    for row in registrations:
        origin = validation.original_registration(conn, row)
        origin_commit = commits[origin["registration_id"]]
        identity = f"original registration {origin['registration_id']}"
        try:
            stamped = witness.stamped_at(conn, origin_commit) if origin_commit else None
        except Refusal as exc:
            stamped = None
            detail = f"{exc.code}: {exc.message}"
        else:
            detail = "no timestamp token for the registration commit"
        if stamped is None:
            found.append(_finding("WITNESS_MISSING", "validation_registration", row["registration_id"], origin_commit,
                                  f"{identity}: {detail}"))
        elif not stamped.replace(tzinfo=None) < origin["window_start"]:
            found.append(_finding("WITNESS_LATE", "validation_registration", row["registration_id"], origin_commit,
                                  f"{identity}: stamped at {stamped}, the window starts {origin['window_start']}"))
    return found, len(registrations)


def _since(conn: db.LedgerConnection, since: str | None, commit: str) -> tuple[str | None, list[dict]]:
    """(the commit the review continues from, its finding): None, with HISTORY_REWRITTEN, when `since` is no
    longer in the head's history, so the whole history is checked again."""
    if since is None:
        return None, []
    try:
        resolved = db.resolve_commit(conn, since)
    except Refusal as exc:
        if exc.code != "UNKNOWN_REF":
            raise
        resolved = None
    if resolved is not None and conn.rows("SELECT 1 FROM dolt_log WHERE commit_hash = %s LIMIT 1", (resolved,)):
        return resolved, []
    return None, [_finding("HISTORY_REWRITTEN", None, None, since,
                           f"the reviewed commit {since} is no ancestor of {commit}; the whole history is checked")]


def _row_findings(conn: db.LedgerConnection, tables: list[str], new: str, since: tuple) -> list[dict]:
    found = []
    for table in tables:
        keys = _primary_key(conn, table)
        columns = ", ".join(f"from_{key}" for key in keys) or "'?'"
        try:
            changed = conn.rows(f"SELECT diff_type, to_commit, {columns} FROM `dolt_diff_{table}` WHERE diff_type "
                                f"<> 'added'{new}", since)
        except Refusal as exc:
            raise refuse("LEDGER_UNAVAILABLE", f"dolt_diff_{table} cannot be read; the review cannot start") from exc
        for diff_type, to_commit, *key in changed:
            found.append(_finding("ROW_CHANGED", table, "/".join(str(item) for item in key), to_commit,
                                  f"a {table} row was {diff_type}"))
    return found


def _reading_findings(conn: db.LedgerConnection, new: str, since: tuple) -> list[dict]:
    """READING_REPLACED_OUTSIDE_RESEAL for a changed or removed reading whose commit is not `reseal:<its op_id>`, or
    whose commit also changed a commitment table."""
    found = []
    for diff_type, to_commit, trial_id, op_id, message in conn.rows(
            f"SELECT d.diff_type, d.to_commit, d.from_trial_id, d.to_op_id, l.message FROM dolt_diff_{READINGS} d "
            f"LEFT JOIN dolt_log l ON l.commit_hash = d.to_commit WHERE d.diff_type <> 'added'{new.replace('to_commit', 'd.to_commit')}",
            since):
        others = [name for (name,) in conn.rows("SELECT table_name FROM dolt_diff WHERE commit_hash = %s AND "
                                                "table_name NOT IN (%s, 'ledger_head')", (to_commit, READINGS))]
        if diff_type != "modified" or op_id is None or message != f"{RESEAL}:{op_id}" or others:
            found.append(_finding("READING_REPLACED_OUTSIDE_RESEAL", READINGS, trial_id, to_commit,
                                  f"the reading of run {trial_id} was {diff_type} by a commit with message "
                                  f"{message!r}" + (f" that also changed {', '.join(sorted(others))}" if others else "")))
    return found


def _constraint_findings(conn: db.LedgerConnection, new: str, args: tuple) -> list[dict]:
    """A finding for each foreign key that a row the commits after the last review added or changed matches no row
    of: the writer can turn foreign key checks off in its session. (DOLT_VERIFY_CONSTRAINTS needs write permission on
    the branch, which the reader lacks; deleted parent rows are ROW_CHANGED findings already.)"""
    keys: dict[tuple[str, str, str], list[tuple[str, str]]] = {}
    for table, name, parent, column, referenced in conn.rows(
            "SELECT table_name, constraint_name, referenced_table_name, column_name, referenced_column_name FROM "
            "information_schema.key_column_usage WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL "
            "ORDER BY table_name, constraint_name, ordinal_position"):
        keys.setdefault((table, name, parent), []).append((column, referenced))
    found = []
    for (table, name, parent), pairs in keys.items():
        named = " AND ".join(f"d.`to_{column}` IS NOT NULL" for column, _ in pairs)
        match = " AND ".join(f"p.`{referenced}` = d.`to_{column}`" for column, referenced in pairs)
        dangling = conn.rows(f"SELECT d.to_commit FROM `dolt_diff_{table}` d WHERE d.diff_type <> 'removed' AND {named} "
                             f"AND NOT EXISTS (SELECT 1 FROM `{parent}` p WHERE {match})"
                             f"{new.replace('to_commit', 'd.to_commit')} LIMIT 1", args)
        if dangling:
            found.append(_finding("CONSTRAINT_VIOLATED", table, None, dangling[0][0],
                                  f"a row of {table} matches no {parent} row of its foreign key {name}"))
    return found


def review_all(conn: db.LedgerConnection, at: str | None = None, since: str | None = None,
               trial_ids: list | None = None) -> dict:
    """The review at one exact version with the reader account, of the commits after `since` (the commit an
    earlier review checked; every commit without it); every difference a finding."""
    admin.require_reader(conn)
    findings: list[dict] = []
    limitations: list[str] = []
    with db.read_as_of(conn.profile, at) as pinned:
        commit = db.head_commit(pinned)
        start, found = _since(pinned, since, commit)
        findings += found
        # The commits after `start`: those its own history does not hold.
        new, args = ((" AND to_commit NOT IN (SELECT commit_hash FROM dolt_log(%s))", (start,)) if start
                     else ("", ()))
        checked = _tables(pinned)
        findings += _row_findings(pinned, checked, new, args)
        findings += _reading_findings(pinned, new, args)
        findings += _constraint_findings(pinned, new, args)
        head = db.resolve_commit(pinned, db.BRANCH)
        history, found, unread = _history(conn.profile, head, lambda commit: _in_branch(conn.profile, commit))
        findings += found
        limitations += unread
        wanted = None if trial_ids is None else {int(item) for item in trial_ids}
        changed = ("SELECT to_trial_id FROM dolt_diff_run WHERE diff_type = 'added'" + new
                   + f" UNION SELECT to_trial_id FROM dolt_diff_{READINGS} WHERE diff_type <> 'removed'" + new)
        runs = [row for row in pinned.dicts(f"SELECT trial_id, status FROM run WHERE trial_id IN ({changed}) "
                                            "ORDER BY trial_id", args + args)
                if wanted is None or row["trial_id"] in wanted]
        for row in runs:
            findings += _run_findings(pinned, row, commit)
        found, registrations = _registration_findings(pinned, commit, new, args)
        findings += found
        found, validations = _validation_findings(pinned, commit)
        findings += found
    return {"at": at, "since": start, "commit": commit, "tables_checked": checked, "runs_checked": len(runs),
            "captures_checked": len(runs), "registrations_checked": registrations, "validations_checked": validations,
            "history": history, "ok": not findings, "findings": findings, "limitations": limitations}
