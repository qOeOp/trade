"""The whole-ledger review (`report.review_all`): with the reader account at one exact version, rerun
the commit checks and compare them byte for byte with the product's definitions, read every business
table's history for changed or removed rows (all but the user's deletion of a sealed paper run), check that the latest backup's head is still an
ancestor of the research head (without a backup, say that this was not checked), recompute what the
stored cycles and daily series determine against each passed run's sealed result, and check
fingerprints, captures, registration order, grid membership, witnesses and the one-to-one
out-of-sample bindings. Every difference is a finding; nothing is written and no write transaction
is opened. The market review (`report.market_review`) runs the same backup check on the market
database.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from decimal import Decimal

from report import profit
import json
import math
import re

from ledger import admin, db, execution, metrics, paper, witness
from ledger.errors import Refusal
from ledger.refusals import refuse
from registration import register, validation


# Finding codes and their meaning (findings are reported, never stored).
FINDINGS = {
    "COMMIT_TEST_FAILED": "A commit verification test (dolt_tests) fails at this version.",
    "COMMIT_TEST_ALTERED": "A commit verification test (dolt_tests) is missing, added or differs byte for byte from the "
                           "product's definition in ledger/schema.sql.",
    "ROW_CHANGED": "A row of an append-only table was modified or removed in the ledger history (other than by the "
                   "user's deletion of a sealed paper run, `paper delete`).",
    "HISTORY_REWRITTEN": "The latest backup's head commit is no ancestor of the research (or market) head: a commit "
                         "was rewritten (the writer or import account can amend its last commit).",
    "BACKUP_UNREADABLE": "The latest backup exists but its head commit cannot be read (restore failed, timed out or "
                         "returned no readable branch list); rewritten history was not checked.",
    "READING_MISMATCH": "A value the stored cycles or daily series determine (counts, compounding, the profit "
                        "bridge, plan tags, the whole-day series behind the monthly figures) differs from the run's "
                        "sealed result.",
    "SEALED_RESULT_MISSING": "A passed run has no sealed result row.",
    "CAPTURE_MISSING": "A run's trial has no original execution capture.",
    "CAPTURE_UNREADABLE": "A run's execution capture or start receipt does not verify.",
    "REGISTRATION_AFTER_TRIAL": "A registration attempt's registration was recorded no earlier than its trial.",
    "SOURCE_NOT_IN_GRID": "A registration attempt consumed a source outside the registration's locked grid.",
    "REGISTRATION_UNREADABLE": "A registration bundle of an attempt cannot be read.",
    "WITNESS_MISSING": "The original validation registration commit has no verified timestamp token.",
    "WITNESS_LATE": "The original validation registration's timestamp is not before its window start.",
    "VALIDATION_BINDING_INVALID": "A validation binding binds a trial that is not a validation trial, or a validation "
                                  "trial is bound other than once.",
}
UNCHECKED = ("ledger_head",)
PAPER_DELETE = re.compile(rf"{paper.DELETE_KIND}:(\d+)\Z")
COMMIT_HASH = re.compile(r"[0-9a-v]{32}\Z")
EQUITY_TOLERANCE = metrics.EQUITY_TOLERANCE
HISTORY_UNCHECKED = ("HISTORY_UNCHECKED: no readable backup, so whether a commit was rewritten (an amended last "
                     "commit) was not checked")
COMMIT_TESTS_INSERT = "INSERT INTO dolt_tests VALUES"
TEST_COLUMNS = ("test_name", "test_group", "test_query", "assertion_type", "assertion_comparator", "assertion_value")


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
        backed = admin.backup_head(profile, backup)
    except Refusal as exc:
        return ({"backup": str(backup), "head": None, "status": "unreadable"},
                [_finding("BACKUP_UNREADABLE", None, None, None, f"{exc.code}: {exc.message}")], [HISTORY_UNCHECKED])
    if backed is None:
        return {"backup": str(backup), "head": None, "status": "no_branch"}, [_finding(
            "HISTORY_REWRITTEN", None, None, None,
            f"the backup at {backup} has no {profile.research_branch} branch")], []
    if contains(backed):
        return {"backup": str(backup), "head": backed, "status": "ancestor", "research_head": head}, [], []
    return {"backup": str(backup), "head": backed, "status": "not_ancestor", "research_head": head}, [_finding(
        "HISTORY_REWRITTEN", None, None, backed,
        f"the backup head {backed} is no ancestor of the research head {head}")], []


def _in_branch(profile: db.LedgerProfile, commit: str) -> bool:
    with db.connect(profile, "reader") as branch:
        (count,), = branch.rows("SELECT COUNT(*) FROM dolt_log WHERE commit_hash = %s", (commit,))
    return bool(count)


def market_review(market: Mapping) -> dict:
    """market review: whether the latest backup's head commit of the market database is still an
    ancestor of its main head (the import account can amend its last commit, which would drop a
    pinned market commit from history), read with the reader account; findings only, as in the
    ledger review: HISTORY_REWRITTEN, BACKUP_UNREADABLE, and without a backup HISTORY_UNCHECKED."""
    from market import store
    profile = db.LedgerProfile.from_json(dict(market))
    with store.connect(dict(market), "reader") as conn:
        head = store.resolve_commit(conn, "main")

        def contains(commit: str) -> bool:
            return bool(conn.rows("SELECT COUNT(*) FROM dolt_log WHERE commit_hash = %s", (commit,))[0][0])

        history, findings, limitations = _history(profile, head, contains)
    return {"market": profile.name, "database": profile.database, "commit": head, "history": history,
            "ok": not findings, "findings": findings, "limitations": limitations}


def product_commit_tests() -> dict[str, tuple[str, ...]]:
    """The commit verification tests the product defines (the one INSERT INTO dolt_tests statement of
    ledger/schema.sql), by name: (test_name, test_group, test_query, assertion_type,
    assertion_comparator, assertion_value)."""
    statement = next(part for part in db._statements(db.SCHEMA.read_text(encoding="utf-8"))
                     if part.startswith(COMMIT_TESTS_INSERT))
    values = [item.replace("''", "'") for item in re.findall(r"'((?:[^']|'')*)'", statement[len(COMMIT_TESTS_INSERT):])]
    rows = [tuple(values[index:index + len(TEST_COLUMNS)]) for index in range(0, len(values), len(TEST_COLUMNS))]
    return {row[0]: row for row in rows}


def _commit_test_findings(conn: db.LedgerConnection, commit: str) -> list[dict]:
    """COMMIT_TEST_ALTERED for every dolt_tests row missing from, added to or differing (byte for byte)
    from the product's definitions."""
    expected = product_commit_tests()
    stored = {str(row[0]): tuple(str(item) if item is not None else None for item in row)
              for row in conn.rows(f"SELECT {', '.join(TEST_COLUMNS)} FROM dolt_tests ORDER BY test_name")}
    found = []
    for name in sorted(set(expected) | set(stored)):
        if name not in stored:
            detail = "the product's commit test is missing"
        elif name not in expected:
            detail = "a commit test the product does not define was added"
        elif [item.encode("utf-8") if item is not None else None for item in stored[name]] != [
                item.encode("utf-8") for item in expected[name]]:
            differs = [column for column, left, right in zip(TEST_COLUMNS, stored[name], expected[name], strict=True)
                       if left != right]
            detail = "the commit test differs from the product's definition in " + ", ".join(differs)
        else:
            continue
        found.append(_finding("COMMIT_TEST_ALTERED", "dolt_tests", name, commit, detail))
    return found


def _json_value(value):
    return value if isinstance(value, Mapping) or value is None else json.loads(value)


def _ns(moment) -> int:
    return metrics.utc_ns(moment.replace(tzinfo=None).isoformat() + "Z")


def _sealed_rows_findings(conn: db.LedgerConnection, trial_id: int, commit: str, report: Mapping,
                          starting, native_economics=None) -> list[dict]:
    """What the stored cycles and daily series determine against the sealed result: the counts, the
    compounding, the profit bridge, the plan tags and the whole-day (monthly) series."""
    found = []

    def mismatch(table: str, detail: str) -> None:
        found.append(_finding("READING_MISMATCH", table, trial_id, commit, detail))

    cycles = conn.dicts(f"SELECT ts_closed_ns, realized_pnl, commissions, funding, {metrics.PRICE_PNL}, "
                        "open_unrealized, plan_tag FROM run_cycle WHERE trial_id = %s ORDER BY seq", (trial_id,))
    returns = conn.rows("SELECT ts_event_ns, native_return FROM run_return WHERE trial_id = %s ORDER BY ts_event_ns",
                        (trial_id,))
    populations = report.get("populations") or {}
    activity = report.get("activity") or {}
    checks = [("populations.cycles", populations.get("cycles"), len(cycles)),
              ("populations.days", populations.get("days"), len(returns))]
    if (activity.get("cycles_cover_fills@1") or {}).get("passed"):
        checks.append(("activity.cycles_cover_fills@1.count", activity["cycles_cover_fills@1"].get("count"),
                       len(cycles)))
    for name, stored, counted in checks:
        if stored is not None and stored != counted:
            mismatch("run_sealed", f"{name} is {stored}, the stored rows give {counted}")
    compounding = activity.get("returns_compound_to_equity@1") or {}
    final = compounding.get("final_equity")
    if compounding.get("passed") and compounding.get("compounded") is not None and starting is not None:
        recomputed = Decimal(str(starting)) * Decimal(repr(math.prod(1 + value for _, value in returns)))
        if abs(recomputed - Decimal(compounding["compounded"])) > EQUITY_TOLERANCE:
            mismatch("run_return", f"the daily series compounds to {recomputed:.2f}, the sealed result records "
                                   f"{compounding['compounded']}")
    if compounding.get("passed") and final is not None and starting is not None:
        trial = conn.one("SELECT t.trade_start, t.trade_end FROM run r JOIN trial t ON t.trial_id = r.trial_id WHERE "
                         "r.trial_id = %s", (trial_id,))
        assert trial is not None  # run.trial_id is a foreign key to trial
        limitations: list[str] = []
        summary = {"period_start_utc": str(_ns(trial["trade_start"])), "period_end_utc": str(_ns(trial["trade_end"])),
                   "starting_balance_usdt": str(starting), "final_equity_usdt": str(final)}
        if metrics.daily_returns([(int(ts), float(value)) for ts, value in returns], summary, limitations) is None:
            mismatch("run_return", "the monthly figures have no whole daily series: " + "; ".join(limitations))
    if final is not None and starting is not None:
        bridge = profit.account_bridge(cycles, starting, final, native_economics)
        if bridge["reason"] and any(code in bridge["reason"] for code in
                                    ("MISMATCH", "BRIDGE_UNRECONCILED")):
            mismatch("run_cycle", bridge["reason"])
    if (report.get("plans_valid@1") or {}).get("passed"):
        untagged = sum(1 for cycle in cycles if cycle["plan_tag"] is None)
        if untagged:
            mismatch("run_cycle", f"the sealed plan contract holds, but {untagged} stored cycles carry no plan tag")
    return found


def _run_findings(conn: db.LedgerConnection, run: Mapping, commit: str) -> tuple[list[dict], bool]:
    """(findings, whether a capture was checked) of one run."""
    found, trial_id = [], run["trial_id"]
    try:
        capture = execution.read_capture(conn, run["trial_id"])
    except Refusal as exc:
        return [_finding("CAPTURE_UNREADABLE", "run", trial_id, commit, f"{exc.code}: {exc.message}")], True
    if capture["status"] != "captured":
        found.append(_finding("CAPTURE_MISSING", "run", trial_id, commit, capture.get("reason") or "missing"))
    if run["status"] != "passed":
        return found, True
    sealed = {revision: _json_value(report) for revision, report in conn.rows(
        "SELECT metrics_revision, report FROM run_sealed WHERE trial_id = %s", (trial_id,))}
    report = metrics.latest_sealed(conn, trial_id, sealed)
    if not report:
        found.append(_finding("SEALED_RESULT_MISSING", "run_sealed", trial_id, commit, "no sealed result"))
        return found, True
    coverage = capture.get("input_coverage")
    if not isinstance(coverage, Mapping):
        coverage = {}
    starting = ((coverage.get("effective_config") or {}).get("account") or {}).get("starting_balance_usdt")
    found += _sealed_rows_findings(conn, trial_id, commit, report, starting, profit.native_economics(capture))
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
    registrations = conn.dicts("SELECT g.registration_id, g.window_start, g.retry_of, d.to_commit "
                               "FROM validation_registration g "
                               "LEFT JOIN dolt_diff_validation_registration d ON d.to_registration_id = g.registration_id "
                               "AND d.diff_type = 'added' ORDER BY g.registration_id")
    commits = {row["registration_id"]: row["to_commit"] for row in registrations}
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
    for trial_id, purpose, bound in conn.rows(
            "SELECT t.trial_id, t.purpose, COUNT(b.registration_id) FROM trial t LEFT JOIN validation_binding b ON "
            "b.trial_id = t.trial_id WHERE t.purpose = 'validation' OR b.trial_id IS NOT NULL GROUP BY t.trial_id, "
            "t.purpose ORDER BY t.trial_id"):
        if purpose != "validation" or bound != 1:
            found.append(_finding("VALIDATION_BINDING_INVALID", "validation_binding", trial_id, commit,
                                  f"trial {trial_id} ({purpose}) is bound {bound} times"))
    return found, len(registrations)


def _paper_deletion(pinned: db.LedgerConnection, table: str, commit: str, key: list, deletions: dict) -> bool:
    """Whether a removed row is part of the user's deletion of a sealed paper run (`paper delete`): in a commit
    `paper_delete:<paper_id>`, that run's paper_run row, its capture bundle and its files, or a content no
    file names any more at that commit. `deletions` caches each commit's paper ID (None: no deletion)."""
    if commit not in deletions:
        found = pinned.rows("SELECT message FROM dolt_commits WHERE commit_hash = %s", (commit,))
        named = PAPER_DELETE.fullmatch(found[0][0]) if found else None
        deletions[commit] = named[1] if named else None
    paper_id = deletions[commit]
    if paper_id is None or not COMMIT_HASH.fullmatch(commit):
        return False
    if table == "paper_run":
        return str(key[0]) == paper_id
    if table in ("evidence_bundle", "evidence"):
        return key[0] == paper.bundle_name(int(paper_id))
    if table == "evidence_content":
        return not pinned.rows(f"SELECT 1 FROM evidence AS OF '{commit}' WHERE sha256 = %s LIMIT 1", (key[0],))
    return False


def review_all(conn: db.LedgerConnection, at: str | None = None, tables: list[str] | None = None,
               trial_ids: list | None = None) -> dict:
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
        findings += _commit_test_findings(pinned, commit)
        checked = list(tables) if tables is not None else _tables(pinned)
        deletions: dict[str, str | None] = {}
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
                if diff_type == "removed" and _paper_deletion(pinned, table, to_commit, key, deletions):
                    continue
                findings.append(_finding("ROW_CHANGED", table, "/".join(str(item) for item in key), to_commit,
                                         f"a {table} row was {diff_type}"))
        head = db.resolve_commit(pinned, conn.profile.research_branch)
        history, found, limitations = _history(conn.profile, head, lambda commit: _in_branch(conn.profile, commit))
        findings += found
        wanted = None if trial_ids is None else {int(item) for item in trial_ids}
        runs = [row for row in pinned.dicts("SELECT trial_id, status, fingerprints FROM run ORDER BY trial_id")
                if wanted is None or row["trial_id"] in wanted]
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
            "history": history, "ok": not findings, "findings": findings, "limitations": limitations}
