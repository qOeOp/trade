"""The research records: goal, strategy revisions, evidence, trials, runs, freezes, confirmations.

Only two research records are registered: a candidate freeze (written once) and a confirmation
(preregistered plan, then verdict). Everything else is exploration, but every native replay writes
a trial row and every sealed run is stored whole. Verdicts are computed here from the goal and the
product readings; the Agent names only the failed part and a bounded note. Nothing is edited.
"""

from __future__ import annotations

import ast
from datetime import UTC, datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

from research.records import db
from research.records.common import ROOT, RecordError


GOAL_FIELDS = {"goal_id", "max_drawdown", "min_annual_return", "min_plan_win_rate", "drawdown_measure", "window",
               "known_exposure"}
DRAWDOWN_MEASURES = {"native MARK equity at available observation times": "native_mark_equity_5m",
                     "native_mark_equity_5m": "native_mark_equity_5m"}
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\Z")
BUNDLE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\Z")
FAILED_PARTS = ("gross_edge", "cost", "frequency", "tail", "integrity")
RESULTS = ("passed", "failed", "invalid")
NOTE_LIMIT = 2000
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_EVIDENCE_BYTES = 64 * 1024 * 1024
MEDIA_SUFFIXES = {".mp4", ".m4a", ".m4v", ".webm", ".mkv", ".mov", ".mp3", ".wav", ".aac", ".opus", ".flac"}
MIN_PLANS = 100
DRAWDOWN_MARGIN = Decimal(2) / Decimal(3)
CURRENT_CONTRACT = "r1-native-v5"


def _refuse(message, code="RECORD_REFUSED", **extra):
    return RecordError(message, code=code, write_status="not_written", **extra)


def _id(value, name, pattern=ID):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise _refuse(f"{name} must use letters, digits, dots, underscores or hyphens (got {value!r})")
    return value


def _note(value) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > NOTE_LIMIT:
        raise _refuse(f"the note must be nonempty text of at most {NOTE_LIMIT} characters")
    return value


def _utc(value, name) -> datetime:
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise _refuse(f"{name} is not an ISO time: {value!r}") from exc
    if moment.tzinfo is None:
        raise _refuse(f"{name} needs Z or an explicit UTC offset")
    return moment.astimezone(UTC).replace(tzinfo=None)


def _git(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *argv], cwd=ROOT, capture_output=True, text=True, check=False)


def reader_revision() -> str:
    head = _git("rev-parse", "HEAD")
    if head.returncode:
        raise _refuse("the records CLI must run from a Git checkout", "NOT_A_CHECKOUT")
    return head.stdout.strip()


def require_fresh() -> None:
    """Freeze and confirmation writes run only from code that contains origin/main."""
    fetched = _git("fetch", "--quiet", "origin", "main")
    if fetched.returncode:
        raise _refuse(f"cannot fetch origin/main: {fetched.stderr.strip()}", "STALE_CHECKOUT")
    if _git("merge-base", "--is-ancestor", "origin/main", "HEAD").returncode:
        raise _refuse("this checkout lacks commits on origin/main; update it, then rerun", "STALE_CHECKOUT",
                      next_actions=["git pull --ff-only (or rebase your branch), then rerun the same command."])


# Goal

def validate_goal(value: dict) -> dict:
    if not isinstance(value, dict) or set(value) != GOAL_FIELDS:
        raise _refuse(f"the goal file has exactly the keys {sorted(GOAL_FIELDS)}", "GOAL_INVALID")
    try:
        goal = {"goal_id": _id(value["goal_id"], "goal_id"),
                "max_drawdown": Decimal(str(value["max_drawdown"])),
                "min_annual_return": Decimal(str(value["min_annual_return"])),
                "min_plan_win_rate": Decimal(str(value["min_plan_win_rate"])),
                "drawdown_measure": DRAWDOWN_MEASURES[value["drawdown_measure"]],
                "window_start": _utc(value["window"]["start"], "window.start"),
                "window_end": _utc(value["window"]["end"], "window.end"),
                "known_exposure": _note(value["known_exposure"])}
    except (KeyError, TypeError, ArithmeticError) as exc:
        raise _refuse(f"the goal file is invalid: {exc!r}", "GOAL_INVALID") from exc
    if not (0 < goal["max_drawdown"] < 1 and goal["min_annual_return"] > 0 and 0 <= goal["min_plan_win_rate"] < 1
            and goal["window_start"] < goal["window_end"]):
        raise _refuse("goal targets or window out of range", "GOAL_INVALID")
    return goal


def insert_goal(profile: dict, goal: dict, conn=None) -> dict:
    op = db.op_id("goal", goal)

    def insert(conn):
        db.rows(conn, "INSERT INTO goal (singleton, goal_id, max_drawdown, min_annual_return, min_plan_win_rate, "
                      "drawdown_measure, window_start, window_end, known_exposure, op_id, created_at) "
                      "VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                (goal["goal_id"], goal["max_drawdown"], goal["min_annual_return"], goal["min_plan_win_rate"],
                 goal["drawdown_measure"], goal["window_start"], goal["window_end"], goal["known_exposure"], op))
        return {"goal": goal["goal_id"]}

    return db.write(profile, kind="goal", op=op, table="goal", insert=insert,
                    replay=lambda c, row: {"goal": row["goal_id"]}, conn=conn)


def read_goal(conn) -> dict:
    goal = db.one(conn, "SELECT * FROM goal")
    if goal is None:
        raise _refuse("this round has no goal", "NO_GOAL")
    return goal


# Strategy revisions

def check_source(raw: bytes, entry_class: str) -> None:
    """Parse without executing: UTF-8 Python with exactly one top-level entry class."""
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_SOURCE_BYTES:
        raise _refuse(f"strategy source must hold 1 to {MAX_SOURCE_BYTES} bytes")
    if not entry_class.isidentifier():
        raise _refuse("entry class must be a Python class name")
    try:
        tree = ast.parse(raw.decode("utf-8"), filename="<strategy>")
        compile(tree, "<strategy>", "exec")
    except (UnicodeDecodeError, SyntaxError, ValueError) as exc:
        raise _refuse(f"strategy source must be valid UTF-8 Python: {exc}") from exc
    if sum(isinstance(node, ast.ClassDef) and node.name == entry_class for node in tree.body) != 1:
        raise _refuse("the entry class must name exactly one top-level class in the source")


def _ref(value: str) -> tuple[str, int]:
    strategy_id, _, revision = value.partition("@")
    if not revision.isdigit() or int(revision) < 1:
        raise _refuse(f"a strategy revision is written ID@N (got {value!r})")
    return _id(strategy_id, "strategy_id"), int(revision)


def publish_strategy(profile: dict, *, source: bytes, strategy_id: str, entry_class: str, description: str,
                     parent: str | None, difference: str | None, op: str | None) -> dict:
    _id(strategy_id, "strategy_id")
    check_source(source, entry_class)
    description = _note(description)
    parent_ref = _ref(parent) if parent else None
    if (parent_ref is None) != (difference is None):
        raise _refuse("a parent revision and its difference go together")
    if difference is not None:
        _note(difference)
    sha = hashlib.sha256(source).hexdigest()
    op = op or db.op_id("strategy", {"id": strategy_id, "sha": sha, "class": entry_class, "parent": parent})

    def insert(conn):
        existing = db.one(conn, "SELECT strategy_id, revision FROM strategy_revision WHERE source_sha256 = %s", (sha,))
        if existing:
            raise _refuse(f"these exact bytes are already {existing['strategy_id']}@{existing['revision']}",
                          "SOURCE_EXISTS")
        found = db.rows(conn, "SELECT MAX(revision) FROM strategy_revision WHERE strategy_id = %s", (strategy_id,))
        revision = (found[0][0] if found and found[0][0] is not None else 0) + 1
        db.rows(conn, "INSERT INTO strategy_revision (strategy_id, revision, source, entry_class, runtime_contract, "
                      "description, parent_strategy_id, parent_revision, difference, op_id, created_at) "
                      "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                (strategy_id, revision, source, entry_class, CURRENT_CONTRACT, description,
                 parent_ref[0] if parent_ref else None, parent_ref[1] if parent_ref else None, difference, op))
        return {"strategy": f"{strategy_id}@{revision}", "source_sha256": sha}

    return db.write(profile, kind="strategy", op=op, table="strategy_revision", insert=insert,
                    replay=lambda conn, row: {"strategy": f"{row['strategy_id']}@{row['revision']}",
                                              "source_sha256": row["source_sha256"]})


def strategy(conn, ref: str) -> dict:
    strategy_id, revision = _ref(ref)
    row = db.one(conn, "SELECT * FROM strategy_revision WHERE strategy_id = %s AND revision = %s",
                 (strategy_id, revision))
    if row is None:
        raise _refuse(f"unknown strategy revision {ref}", "UNKNOWN_STRATEGY")
    if hashlib.sha256(row["source"]).hexdigest() != row["source_sha256"]:
        raise RecordError(f"stored source of {ref} differs from its hash", code="LEDGER_CORRUPT")
    return row


# Evidence

def add_evidence(profile: dict, bundle: str, paths: list[Path], op: str | None) -> dict:
    """Store a bundle's files (a directory is read recursively) as one insert-only evidence bundle."""
    _id(bundle, "bundle", BUNDLE)
    files = {}
    for given in paths:
        given = Path(given)
        if given.is_symlink():
            raise _refuse(f"evidence may not be a symlink: {given}")
        found = sorted(path for path in given.rglob("*")) if given.is_dir() else [given]
        for path in found:
            if path.is_symlink():
                raise _refuse(f"evidence may not be a symlink: {path}")
            if path.is_dir():
                continue
            name = path.relative_to(given).as_posix() if given.is_dir() else path.name
            if path.suffix.lower() in MEDIA_SUFFIXES:
                raise _refuse(f"{name}: media files are not kept; store the bundle's derived evidence only",
                              "MEDIA_NOT_KEPT")
            data = path.read_bytes()
            if not data:
                raise _refuse(f"{name}: empty evidence is refused", "EMPTY_EVIDENCE")
            if len(data) > MAX_EVIDENCE_BYTES:
                raise _refuse(f"{name}: larger than {MAX_EVIDENCE_BYTES} bytes")
            if name in files or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts:
                raise _refuse(f"duplicate or invalid evidence path {name}")
            files[name] = data
    if not files:
        raise _refuse("no evidence files given", "EMPTY_EVIDENCE")
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    op = op or db.op_id("evidence", {"bundle": bundle, "files": digests})

    def insert(conn):
        if db.one(conn, "SELECT bundle FROM evidence_bundle WHERE bundle = %s", (bundle,)):
            raise _refuse(f"bundle {bundle} already exists with other content; use a new bundle name",
                          "BUNDLE_EXISTS")
        db.rows(conn, "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, UTC_TIMESTAMP(6))",
                (bundle, op))
        with conn.cursor() as cursor:
            cursor.executemany("INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)",
                               [(bundle, name, data) for name, data in files.items()])
        return {"bundle": bundle, "files": digests}

    def replay(conn, row):
        stored = dict(db.rows(conn, "SELECT path, sha256 FROM evidence WHERE bundle = %s", (row["bundle"],)))
        return {"bundle": row["bundle"], "files": stored}

    return db.write(profile, kind="evidence", op=op, table="evidence_bundle", insert=insert, replay=replay)


def export_evidence(conn, bundle: str, destination: Path) -> dict:
    destination = Path(destination)
    if destination.exists():
        raise _refuse(f"destination exists: {destination}")
    found = db.rows(conn, "SELECT path, content, sha256 FROM evidence WHERE bundle = %s", (bundle,))
    if not found:
        raise _refuse(f"unknown evidence bundle {bundle}", "UNKNOWN_BUNDLE")
    for path, content, sha in found:
        if hashlib.sha256(content).hexdigest() != sha:
            raise RecordError(f"stored evidence {bundle}/{path} differs from its hash", code="LEDGER_CORRUPT")
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return {"bundle": bundle, "destination": str(destination), "files": {path: sha for path, _, sha in found}}


# Trials and runs

def report_trial(profile: dict, *, mode: str, source_sha256: str, image_ref: str, coins: list[str], start: str,
                 trade_start: str, end: str, op: str, conn=None) -> dict:
    def insert(conn):
        if mode == "sealed" and not db.one(conn, "SELECT strategy_id FROM strategy_revision WHERE source_sha256 = %s",
                                           (source_sha256,)):
            raise _refuse("a sealed replay needs a published strategy revision", "UNKNOWN_STRATEGY")
        db.rows(conn, "INSERT INTO trial (mode, strategy_source_sha256, image_ref, coins, input_start, trade_start, "
                      "trade_end, op_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                (mode, source_sha256, image_ref, json.dumps(list(coins)), _utc(start, "start"),
                 _utc(trade_start, "trade_start"), _utc(end, "end"), op))
        (trial_id,), = db.rows(conn, "SELECT LAST_INSERT_ID()")
        return {"trial_id": trial_id}

    return db.write(profile, kind="trial", op=op, table="trial", insert=insert,
                    replay=lambda c, row: {"trial_id": row["trial_id"]}, conn=conn)


def _ns(text: str) -> int:
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    delta = moment - datetime(1970, 1, 1, tzinfo=UTC)
    return (delta.days * 86_400 + delta.seconds) * 1_000_000_000 + delta.microseconds * 1000


def _tags(value: str) -> list:
    return [str(tag) for tag in (ast.literal_eval(value) if value else [])]


def ingest_run(profile: dict, *, trial_id: int, reports, problems: list[str], inspection: dict,
               image_revision: str | None, effective_config: dict, input_identity: dict, conn=None) -> dict:
    """Store one sealed run in one write: readings and report rows when it passed, else its reasons."""
    from research.records.analysis import readings
    status = "invalid" if problems else "passed"
    values = readings(reports) if status == "passed" else None
    limitations = values["limitations"] if values else list(problems)
    economics = (values or {}).get("economics") or {}
    plans = (values or {}).get("plans") or {}
    op = f"run:trial-{trial_id}"
    revision = reader_revision()

    def insert(conn):
        trial = db.one(conn, "SELECT mode FROM trial WHERE trial_id = %s", (trial_id,))
        if trial is None or trial["mode"] != "sealed":
            raise _refuse(f"trial {trial_id} is not a sealed replay on this round", "UNKNOWN_TRIAL")
        db.rows(conn, "INSERT INTO run (trial_id, status, failure_reasons, image_revision, runtime_inspection, "
                      "effective_config, input_identity, reader_revision, summary, audit, max_drawdown, plans_closed, "
                      "plans_won, plans_open, closed_positions, open_positions, realized_pnl_usdt, commissions_usdt, "
                      "funding_usdt, price_pnl_usdt, unrealized_usdt, reading_limitations, exposures, op_id, created_at) "
                      "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                      "%s, %s, UTC_TIMESTAMP(6))",
                (trial_id, status, json.dumps(problems) if problems else None, image_revision,
                 json.dumps(inspection), json.dumps(effective_config), json.dumps(input_identity), revision,
                 json.dumps(reports.summary) if reports.summary is not None else None,
                 json.dumps(reports.audit) if reports.audit is not None else None,
                 (values or {}).get("max_drawdown"), plans.get("closed"), plans.get("wins"), plans.get("open"),
                 economics.get("closed_trades"), economics.get("open_positions"),
                 *[(economics.get("closed") or {}).get(key) for key in
                   ("reported_realized_pnl_usdt", "fill_commissions_usdt", "reported_funding_usdt", "price_pnl_usdt")],
                 economics.get("unrealized_residual_usdt"), json.dumps(limitations),
                 reports.exposures if status == "passed" else None, op))
        (run_id,), = db.rows(conn, "SELECT LAST_INSERT_ID()")
        if status == "passed":
            _insert_reports(conn, run_id, reports)
        return {"run_id": run_id, "status": status}

    return db.write(profile, kind="run", op=op, table="run", insert=insert,
                    replay=lambda c, row: {"run_id": row["run_id"], "status": row["status"]}, conn=conn)


def _insert_reports(conn, run_id: int, reports) -> None:
    batches = {
        "INSERT INTO run_order (run_id, seq, raw, tags) VALUES (%s, %s, %s, %s)":
            [(run_id, index, json.dumps(row), json.dumps(_tags(row.get("tags", ""))))
             for index, row in enumerate(reports.orders)],
        "INSERT INTO run_fill (run_id, seq, raw, ts_event_ns) VALUES (%s, %s, %s, %s)":
            [(run_id, index, json.dumps(row), _ns(row["ts_event"])) for index, row in enumerate(reports.fills)],
        "INSERT INTO run_position (run_id, seq, raw) VALUES (%s, %s, %s)":
            [(run_id, index, json.dumps(row)) for index, row in enumerate(reports.positions)],
        "INSERT INTO run_account (run_id, seq, raw, ts_event_ns) VALUES (%s, %s, %s, %s)":
            [(run_id, index, json.dumps(row), _ns(row["ts_event"])) for index, row in enumerate(reports.account)],
        "INSERT INTO run_return (run_id, ts_event_ns, native_return) VALUES (%s, %s, %s)":
            [(run_id, ts, value) for ts, value in reports.returns],
        "INSERT INTO run_order_event (run_id, seq, raw) VALUES (%s, %s, %s)":
            [(run_id, index, json.dumps(row)) for index, row in enumerate(reports.order_events or [])],
    }
    with conn.cursor() as cursor:
        for statement, values in batches.items():
            for start in range(0, len(values), 2000):
                cursor.executemany(statement, values[start:start + 2000])


# Verdicts

def gates(goal: dict, run: dict, *, development: bool) -> dict:
    """Each goal gate against the run's product readings; a missing reading fails its gate."""
    budget = goal["max_drawdown"] * (DRAWDOWN_MARGIN if development else 1)
    minimum = goal["min_annual_return"]

    def check(value, passes):
        return {"value": value, "passed": value is not None and passes(value)}

    found = {
        "sample": check(run["plans_closed"], lambda v: v >= MIN_PLANS),
        "plan_win_rate": check(run["plan_win_rate"], lambda v: Decimal(str(v)) > goal["min_plan_win_rate"]),
        "max_drawdown": check(run["max_drawdown"], lambda v: Decimal(str(v)) <= budget),
        "annual_return": check(run["annual_return"], lambda v: Decimal(str(v)) >= minimum),
    }
    if development:
        found["return_drawdown"] = check(run["return_drawdown"], lambda v: Decimal(str(v)) >= minimum / budget)
    return found


def _result(run: dict, checks: dict, failed_part: str | None) -> str:
    result = "invalid" if run["status"] == "invalid" else "passed" if all(c["passed"] for c in checks.values()) else "failed"
    if (result == "failed") != (failed_part is not None):
        raise _refuse(f"the verdict is {result}: a failed part is required exactly when it fails "
                      f"({', '.join(FAILED_PARTS)})", "FAILED_PART",
                      expected={"result": result, "gates": checks})
    if failed_part is not None and failed_part not in FAILED_PARTS:
        raise _refuse(f"failed part must be one of {FAILED_PARTS}", "FAILED_PART")
    return result


def _run_with_trial(conn, run_id: int) -> dict:
    run = db.one(conn, "SELECT r.*, t.mode, t.strategy_source_sha256, t.image_ref, t.coins, t.input_start, "
                       "t.trade_start, t.trade_end FROM run r JOIN trial t ON t.trial_id = r.trial_id "
                       "WHERE r.run_id = %s", (run_id,))
    if run is None:
        raise _refuse(f"unknown run {run_id}", "UNKNOWN_RUN")
    return run


def _require_main_image(run: dict) -> None:
    from research.records.runtime import require_main_build
    inspection = json.loads(run["runtime_inspection"])
    require_main_build({"image_ref": run["image_ref"], "image_digest": run["image_ref"].rsplit("@", 1)[1],
                        "platform": inspection["platform"], "runtime_contract": inspection["runtime_contract"]},
                       inspection)


def freeze(profile: dict, *, run_id: int, source_bundle: str | None, failed_part: str | None, note: str,
           op: str | None, check_image=True, check_fresh=True) -> dict:
    note = _note(note)
    if check_fresh:
        require_fresh()
    revision = reader_revision()
    with db.session(profile) as conn:
        goal, run = read_goal(conn), _run_with_trial(conn, run_id)
        if run["mode"] != "sealed":
            raise _refuse(f"run {run_id} is not sealed")
        if (run["trade_start"], run["trade_end"]) != (goal["window_start"], goal["window_end"]):
            raise _refuse(f"run {run_id} trades {run['trade_start']}..{run['trade_end']}, not the goal window "
                          f"{goal['window_start']}..{goal['window_end']}", "WINDOW_MISMATCH")
        if check_image:
            _require_main_image(run)
        checks = gates(goal, run, development=True)
        result = _result(run, checks, failed_part)
        op = op or f"freeze:run-{run_id}"

        def insert(conn):
            if source_bundle is not None and not db.one(
                    conn, "SELECT path FROM evidence WHERE bundle = %s AND path = 'claims.json'", (source_bundle,)):
                raise _refuse(f"source bundle {source_bundle} holds no claims.json", "SOURCE_NOTE")
            (sources,), = db.rows(conn, "SELECT COUNT(DISTINCT t.strategy_source_sha256) FROM trial t JOIN goal g "
                                        "WHERE t.trade_start < g.window_end AND t.trade_end > g.window_start")
            db.rows(conn, "INSERT INTO freeze (run_id, source_bundle, distinct_sources, result, failed_part, note, "
                          "reader_revision, op_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                    (run_id, source_bundle, sources, result, failed_part, note, revision, op))
            (freeze_id,), = db.rows(conn, "SELECT LAST_INSERT_ID()")
            return {"freeze_id": freeze_id, "result": result, "distinct_sources": sources, "gates": checks}

        written = db.write(profile, kind="freeze", op=op, table="freeze", insert=insert,
                           replay=lambda conn, row: {"freeze_id": row["freeze_id"], "result": row["result"],
                                                     "distinct_sources": row["distinct_sources"]}, conn=conn)
        return _witnessed(profile, "freeze", written, written["freeze_id"], conn)


def confirm_plan(profile: dict, *, freeze_id: int, window_start: str, window_end: str, op: str | None,
                 check_fresh=True) -> dict:
    if check_fresh:
        require_fresh()
    start, end = _utc(window_start, "window start"), _utc(window_end, "window end")
    if start >= end:
        raise _refuse("the confirmation window must end after it starts")
    op = op or f"confirmation-plan:freeze-{freeze_id}"

    def insert(conn):
        frozen = db.one(conn, "SELECT result FROM freeze_latest WHERE freeze_id = %s", (freeze_id,))
        if frozen is None or frozen["result"] != "passed":
            raise _refuse(f"freeze {freeze_id} has not passed; only a passed freeze is confirmed", "FREEZE_NOT_PASSED")
        db.rows(conn, "INSERT INTO confirmation_plan (freeze_id, window_start, window_end, op_id, created_at) "
                      "VALUES (%s, %s, %s, %s, UTC_TIMESTAMP(6))", (freeze_id, start, end, op))
        (plan_id,), = db.rows(conn, "SELECT LAST_INSERT_ID()")
        (created,), = db.rows(conn, "SELECT created_at FROM confirmation_plan WHERE plan_id = %s", (plan_id,))
        if start <= created:
            raise _refuse(f"the window starts {start}, not after this registration ({created} UTC): only data that "
                          "does not exist yet confirms", "WINDOW_NOT_FUTURE")
        return {"plan_id": plan_id, "registered_at": created.isoformat() + "Z"}

    with db.session(profile) as conn:
        written = db.write(profile, kind="confirmation-plan", op=op, table="confirmation_plan", insert=insert,
                           replay=lambda c, row: {"plan_id": row["plan_id"],
                                                  "registered_at": row["created_at"].isoformat() + "Z"}, conn=conn)
        return _witnessed(profile, "confirmation_plan", written, written["plan_id"], conn)


def _witnessed(profile: dict, kind: str, written: dict, record_id: int, conn) -> dict:
    """Timestamp a new freeze or plan commit; a failure leaves the record written and says how to retry."""
    from research.records.witness import witness
    if written["replayed"]:
        return written
    try:
        return {**written, "witness": witness(profile, kind, record_id, written["commit"], conn=conn)}
    except RecordError as exc:
        return {**written, "witness": {"status": "failed", "error": str(exc),
                                       "next_action": "rerun `ledger witness --sync` until it succeeds"}}


def confirm_verdict(profile: dict, *, plan_id: int, run_id: int, failed_part: str | None, note: str,
                    op: str | None, check_image=True, check_fresh=True) -> dict:
    from research.records.witness import stamped_at
    note = _note(note)
    if check_fresh:
        require_fresh()
    revision = reader_revision()
    with db.session(profile) as conn:
        goal = read_goal(conn)
        plan = db.one(conn, "SELECT * FROM confirmation_plan WHERE plan_id = %s", (plan_id,))
        if plan is None:
            raise _refuse(f"unknown confirmation plan {plan_id}")
        frozen = _run_with_trial(conn, db.one(conn, "SELECT run_id FROM freeze WHERE freeze_id = %s",
                                              (plan["freeze_id"],))["run_id"])
        run = _run_with_trial(conn, run_id)
        (plan_commit,), = db.rows(conn, "SELECT to_commit FROM dolt_diff_confirmation_plan WHERE to_plan_id = %s "
                                        "AND diff_type = 'added'", (plan_id,))
        witnessed = stamped_at(conn, plan_commit)
        if run["mode"] != "sealed" or run["strategy_source_sha256"] != frozen["strategy_source_sha256"]:
            raise _refuse(f"run {run_id} is not a sealed run of the frozen source", "NOT_FROZEN_SOURCE")
        if run["trade_start"] < plan["window_start"] or run["trade_end"] > plan["window_end"]:
            raise _refuse(f"run {run_id} trades outside the preregistered window", "WINDOW_MISMATCH")
        same = ("symbols", "native_account")
        left, right = json.loads(run["effective_config"]), json.loads(frozen["effective_config"])
        if any(left.get(key) != right.get(key) for key in same):
            raise _refuse(f"run {run_id} changes {[k for k in same if left.get(k) != right.get(k)]} from the freeze",
                          "CONFIG_MISMATCH")
        if witnessed is None or witnessed >= plan["window_start"]:
            raise _refuse(f"plan {plan_id} (commit {plan_commit}) was not timestamped before its window started",
                          "NOT_WITNESSED_IN_TIME", expected={"witnessed_at": str(witnessed),
                                                             "window_start": str(plan["window_start"])})
        if check_image:
            _require_main_image(run)
        checks = gates(goal, run, development=False)
        result = _result(run, checks, failed_part)
        op = op or f"confirmation-verdict:plan-{plan_id}"

        def insert(conn):
            db.rows(conn, "INSERT INTO confirmation_verdict (plan_id, run_id, result, failed_part, note, reader_revision, "
                          "op_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                    (plan_id, run_id, result, failed_part, note, revision, op))
            (verdict_id,), = db.rows(conn, "SELECT LAST_INSERT_ID()")
            return {"verdict_id": verdict_id, "result": result, "gates": checks, "witnessed_at": str(witnessed)}

        return db.write(profile, kind="confirmation-verdict", op=op, table="confirmation_verdict", insert=insert,
                        replay=lambda c, row: {"verdict_id": row["verdict_id"], "result": row["result"]}, conn=conn)


def correct(profile: dict, *, freeze_id: int | None, verdict_id: int | None, result: str, failed_part: str | None,
            note: str, op: str | None) -> dict:
    note = _note(note)
    if (freeze_id is None) == (verdict_id is None):
        raise _refuse("a correction names exactly one freeze or one confirmation verdict")
    if result not in RESULTS or (result == "failed") != (failed_part is not None) or (
            failed_part is not None and failed_part not in FAILED_PARTS):
        raise _refuse("a correction's result is passed, failed (with a failed part) or invalid", "FAILED_PART")
    op = op or db.op_id("correction", {"freeze": freeze_id, "verdict": verdict_id, "result": result,
                                       "part": failed_part, "note": note})

    def insert(conn):
        db.rows(conn, "INSERT INTO correction (freeze_id, verdict_id, result, failed_part, note, op_id, created_at) "
                      "VALUES (%s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(6))",
                (freeze_id, verdict_id, result, failed_part, note, op))
        (correction_id,), = db.rows(conn, "SELECT LAST_INSERT_ID()")
        return {"correction_id": correction_id}

    return db.write(profile, kind="correction", op=op, table="correction", insert=insert,
                    replay=lambda conn, row: {"correction_id": row["correction_id"]})


# Reads

def round_status(profile: dict, at: str | None = None) -> dict:
    """The goal and the counts the stop rules need, in one read."""
    with db.reading(profile, at) as conn:
        goal = read_goal(conn)
        counts = db.one(conn, "SELECT (SELECT COUNT(*) FROM trial) AS trials, "
                              "(SELECT COUNT(DISTINCT strategy_source_sha256) FROM trial) AS distinct_sources, "
                              "(SELECT COUNT(*) FROM run) AS runs, (SELECT COUNT(*) FROM strategy_revision) AS revisions, "
                              "(SELECT COUNT(*) FROM confirmation_plan) AS confirmation_plans, "
                              "(SELECT COUNT(*) FROM confirmation_verdict) AS confirmation_verdicts")
        freezes = db.dicts(conn, "SELECT freeze_id, run_id, result, failed_part, created_at FROM freeze_latest "
                                 "ORDER BY freeze_id")
        last = freezes[-1]["created_at"] if freezes else None
        (since,), = db.rows(conn, "SELECT COUNT(DISTINCT strategy_source_sha256) FROM trial"
                                  + (" WHERE created_at > %s" if last else ""), (last,) if last else None)
    failed = [item for item in freezes if item["result"] == "failed"]
    return {
        "goal": {key: (str(value) if isinstance(value, (Decimal, datetime)) else value)
                 for key, value in goal.items() if key not in ("singleton", "op_id")},
        **counts,
        "freezes": [{**item, "created_at": item["created_at"].isoformat() + "Z"} for item in freezes],
        "failed_freezes": len(failed),
        "distinct_sources_since_last_freeze": since,
        "progress_check_due": (len(failed) > 0 and len(failed) % 3 == 0 and freezes[-1]["result"] == "failed")
                              or since > 20,
    }


def run_report(profile: dict, run_id: int, at: str | None = None) -> dict:
    from research.records.analysis import stored_closed_by_year
    with db.reading(profile, at) as conn:
        run = _run_with_trial(conn, run_id)
        cost = db.dicts(conn, "SELECT liquidity_side, fills, commissions_usdt, notional_usdt, fee_rate "
                              "FROM run_cost_basis WHERE run_id = %s", (run_id,))
        strategy_row = db.one(conn, "SELECT strategy_id, revision FROM strategy_revision WHERE source_sha256 = %s",
                              (run["strategy_source_sha256"],))
        goal = db.one(conn, "SELECT * FROM goal")
        by_year, by_year_limitations = (stored_closed_by_year(conn, run_id) if run["status"] == "passed"
                                        else (None, []))
    keys = ("run_id", "trial_id", "status", "image_revision", "runtime_contract", "nautilus_version",
            "final_equity_usdt", "annual_return", "max_drawdown", "return_drawdown", "plans_closed", "plans_won",
            "plans_open", "plan_win_rate", "closed_positions", "open_positions", "realized_pnl_usdt",
            "commissions_usdt", "funding_usdt", "price_pnl_usdt", "unrealized_usdt", "image_ref", "trade_start",
            "trade_end", "created_at")
    output = {key: _plain(run[key]) for key in keys}
    if goal is not None and run["status"] == "passed":
        development = (run["trade_start"], run["trade_end"]) == (goal["window_start"], goal["window_end"])
        output["gates"] = {"development_window": development, **gates(goal, run, development=development)}
    output.update(strategy=f"{strategy_row['strategy_id']}@{strategy_row['revision']}" if strategy_row else None,
                  coins=json.loads(run["coins"]), market=json.loads(run["input_identity"]),
                  failure_reasons=json.loads(run["failure_reasons"] or "null"),
                  closed_by_year=by_year,
                  reading_limitations=json.loads(run["reading_limitations"]) + by_year_limitations,
                  cost_basis={"native_account": json.loads(run["effective_config"]).get("native_account"),
                              "observed_fee_rates": [{k: _plain(v) for k, v in row.items()} for row in cost]})
    return output


def _plain(value):
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        return value.isoformat() + "Z"
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    return value

