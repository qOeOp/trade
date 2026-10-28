"""Research lines (`ledger.select_line`, `ledger.current_line`, `ledger.read_line`, `ledger.line_trials`,
`ledger.close_line`).

A research line is the user's choice of start candidate (a revision whose source review passed),
development window and pinned market commit, stored append-only as the evidence bundle
research-line-<UTC date>-<slug> holding research-line.json; the slug names the line's direction.
The latest line is the one the ledger received last; a new choice is a new line, never an edit.

A line ends when the next one is selected. Closing it tags the commit before the next line's
(`line/<UTC date>-<slug>`) with the Agent's summary as the tag message: a read-only snapshot of
the line's end and an index for later research. Only the product tags, as the service
administrator (the writer account cannot tag); the summary is an index, the evidence stays in
the ledger.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
import hashlib
import json
import re

import pymysql

from ledger import db, evidence, execution, strategies
from ledger import targets as line_targets
from ledger.errors import Refusal
from ledger.refusals import refuse


PREFIX = "research-line-"
LINE = re.compile(r"research-line-([0-9]{8})-([a-z0-9]+(?:-[a-z0-9]+)*)\Z")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SLUG_LIMIT = 48
FILE = "research-line.json"
FORMAT = "research-line-v2"
FIELDS = ("market_database", "market_commit", "universe_rule", "window_start", "window_end", "start", "start_sha256",
          "note")
TAG_PREFIX = "line/"
SUMMARY_LIMIT = 32 * 1024  # bytes of a line summary; an index, not a report
# The source review items that are properties of the source (registration.precheck.ITEMS less activity).
SOURCE_ITEMS = ("api", "causal", "readiness")


def read_line(conn: db.LedgerConnection, bundle: str, at: str | None) -> dict:
    """The stored record of research line `bundle` with its bundle name, creation time and commit."""
    try:
        loaded = evidence.load_bundle(conn, bundle, at)
    except Refusal as exc:
        if exc.code == "LEDGER_CORRUPT":
            raise refuse("LINE_CORRUPT", f"{bundle}/{FILE} differs from its stored hash", missing=(bundle,)) from exc
        raise
    data = loaded["files"].get(FILE)
    if data is None:
        raise refuse("LINE_CORRUPT", f"{bundle} holds no {FILE}", missing=(f"{bundle}/{FILE}",))
    try:
        record = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        record = None
    if not isinstance(record, dict) or record.get("format") != FORMAT:
        raise refuse("LINE_FORMAT_UNSUPPORTED", f"{bundle}/{FILE} is not a {FORMAT} record", expected=FORMAT)
    return {"bundle": bundle, **{key: record.get(key) for key in FIELDS}, "created_at": loaded["created_at"],
            "ledger_commit": loaded["commit"]}


def _lines(conn: db.LedgerConnection, clause: str) -> list[str]:
    """Every research line bundle, oldest first by server time (one line per write, so no ties)."""
    rows = conn.rows(f"SELECT bundle, created_at FROM evidence_bundle{clause} WHERE bundle LIKE 'research-line-%'")
    return [name for created, name in sorted((created, name) for name, created in rows if LINE.fullmatch(name))]


def line_bundles(conn: db.LedgerConnection) -> list[str]:
    """Every research line bundle the connection sees, oldest first."""
    return _lines(conn, "")


def current_line(conn: db.LedgerConnection, at: str | None = None) -> dict | None:
    """The latest research line record at `at` (default: what the connection sees), or None."""
    _, clause = db.as_of(conn, at)
    named = _lines(conn, clause)
    if not named:
        return None
    return read_line(conn, named[-1], at)


def select_line(conn: db.LedgerConnection, market_database: str, market_at: str, window_start: date,
                window_end: date, start: str, note: str | None = None, *, slug: str,
                market: Callable[[str, str], dict],
                reviews: Callable[[db.LedgerConnection], list[dict]],
                targets: tuple[float, float] | None = None) -> dict:
    """Append the user's chosen line as research-line-<UTC date>-<slug>; the same choice again
    (whatever its slug) is a replay of the current line. Another choice under a name already taken
    is LINE_CONFLICT: the Agent names the direction more precisely. `targets` (maximum drawdown,
    minimum annual return) are the user's for this line, written in the same commit; without them
    the line reads the ledger default.

    `market(market_database, market_at)` returns {commit, universe_rule, latest_complete_day}
    (market.resolve_commit and market.freshness of the design, a later phase). `reviews(conn)` is
    qualification.review_records: the start revision needs a passed source review of its source
    hash and none failed, read at the head this connection sees; a review that failed only on the
    activity of a precheck that did not trade is not counted once a later precheck traded and
    passed (`_untraded_review`).
    """
    if targets is not None:
        line_targets.check(*targets)
        if not line_targets.held(conn):
            raise refuse("LEDGER_UPGRADE_REQUIRED", f"the ledger has no {line_targets.TABLE} table",
                         missing=(line_targets.TABLE,))
    if not isinstance(slug, str) or len(slug) > SLUG_LIMIT or not SLUG.fullmatch(slug):
        raise refuse("LINE_SLUG_INVALID", f"invalid line slug {slug!r}",
                     expected=f"lowercase ASCII words joined by hyphens, at most {SLUG_LIMIT} characters")
    try:
        candidate = strategies.read_candidate(conn, start)
    except Refusal as exc:
        if exc.code == "UNKNOWN_CANDIDATE":
            raise refuse("START_NOT_FOUND", f"no candidate {start} to start the line from", missing=(start,)) from exc
        raise
    try:
        facts = market(market_database, market_at or "main")
    except Refusal as exc:
        raise refuse("MARKET_COMMIT_UNRESOLVED", f"market reference {market_at!r} did not resolve ({exc.code})",
                     missing=(str(market_at),)) from exc
    if not facts.get("commit") or not facts.get("universe_rule"):
        raise refuse("MARKET_COMMIT_UNRESOLVED", f"market reference {market_at!r} has no commit with a universe rule",
                     missing=(str(market_at),))
    if not isinstance(window_start, date) or not isinstance(window_end, date) or window_start >= window_end:
        raise refuse("WINDOW_INVALID", "the development window must start before it ends",
                     expected="window_start < window_end")
    latest_day = facts.get("latest_complete_day")
    if latest_day is None or window_end > latest_day + timedelta(days=1):
        raise refuse("WINDOW_OUT_OF_COVERAGE", f"the window ends after {latest_day} plus one day",
                     expected=f"window_end <= {latest_day + timedelta(days=1) if latest_day else 'covered data'}")
    reviewed = [item["record"] for item in reviews(conn)
                if item["ignored"] is None and item["record"]["source_sha256"] == candidate["source_sha256"]]
    verdicts = {record["verdict"] for record in reviewed if not _untraded_review(conn, record, reviewed)}
    if "failed" in verdicts or "passed" not in verdicts:
        raise refuse("START_REVIEW_REQUIRED", f"{start} has {'a failed' if 'failed' in verdicts else 'no passed'} "
                                              "source review", missing=(start,))
    choice = {"market_database": market_database, "market_commit": facts["commit"],
              "universe_rule": facts["universe_rule"], "window_start": window_start.isoformat(),
              "window_end": window_end.isoformat(), "start": start, "start_sha256": candidate["source_sha256"],
              "note": note}
    latest = current_line(conn)
    if latest is not None and all(latest[key] == value for key, value in choice.items()):
        content_sha256 = hashlib.sha256(_encode({"format": FORMAT, **choice})).hexdigest()
        return {"bundle": latest["bundle"], "market_commit": latest["market_commit"],
                "universe_rule": latest["universe_rule"], "content_sha256": content_sha256,
                "op_id": db.derive_op_id("select_line", {"bundle": latest["bundle"], "content_sha256": content_sha256}),
                "created": False,
                "targets": line_targets.set_targets(conn, latest["bundle"], *targets) if targets is not None
                else line_targets.targets_for(conn, latest["bundle"])}
    (today,), = conn.rows("SELECT DATE(UTC_TIMESTAMP())")
    bundle = f"{PREFIX}{today.strftime('%Y%m%d')}-{slug}"
    content = _encode({"format": FORMAT, **choice})
    content_sha256 = hashlib.sha256(content).hexdigest()
    op = db.derive_op_id("select_line", {"bundle": bundle, "content_sha256": content_sha256})

    def insert(c, operation):
        written = evidence.write_files(c, bundle, {FILE: content}, operation)
        if targets is not None:
            line_targets.set_targets(c, bundle, *targets)
        return written

    try:
        written = db.write(conn, "select_line", {"bundle": bundle, "content_sha256": content_sha256},
                           "evidence_bundle", insert, op_id=op)
    except Refusal as exc:
        if exc.code == "BUNDLE_EXISTS":
            raise refuse("LINE_CONFLICT", f"{bundle} already exists with another choice; name this direction "
                                          "with another slug", missing=(bundle,)) from exc
        raise
    return {"bundle": bundle, "market_commit": facts["commit"],
            "universe_rule": facts["universe_rule"], "content_sha256": content_sha256, "op_id": written["op_id"],
            "created": not written["replayed"], "targets": line_targets.targets_for(conn, bundle)}


def _status(record: dict, item: str):
    value = record.get(item)
    return value.get("status") if isinstance(value, dict) else None


def _untraded_review(conn: db.LedgerConnection, record: dict, reviewed: list[dict]) -> bool:
    """True for a failed review that says only that its precheck did not trade: api, causal and
    readiness passed, activity failed or unresolved, the precheck sealed no fill and no position, and
    a later precheck of the same source sealed fills and has a passed review and no failed one
    (`reviewed`: the product reviews of the source). Activity depends on the run; the other items
    are properties of the source and still refuse."""
    if (record["verdict"] != "failed" or any(_status(record, item) != "passed" for item in SOURCE_ITEMS)
            or _status(record, "activity") not in ("failed", "unresolved")):
        return False
    rows = execution.precheck_rows(conn, record["trial_id"])
    if rows is None or rows.get("fills") != 0 or rows.get("positions") != 0:
        return False
    later: dict[int, set[str]] = {}
    for other in reviewed:
        if other["trial_id"] > record["trial_id"]:
            later.setdefault(other["trial_id"], set()).add(other["verdict"])
    return any(found == {"passed"} and (execution.precheck_rows(conn, trial_id) or {}).get("fills", 0) > 0
               for trial_id, found in later.items())


def _encode(record: dict) -> bytes:
    return (json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def line_trials(conn: db.LedgerConnection, line_bundle: str, since_commit: str | None = None,
                at: str | None = None) -> dict:
    """Research trials of a line, invalid and interrupted ones included: the market commit of each
    start receipt and the trial's trading window must equal the line's. With `since_commit`, only
    trials added after it. (The start receipt carries no window, so the trial row's is read.)"""
    commit, clause = db.as_of(conn, at)
    if (not isinstance(line_bundle, str) or not LINE.fullmatch(line_bundle)
            or not conn.rows(f"SELECT 1 FROM evidence_bundle{clause} WHERE bundle = %s", (line_bundle,))):
        raise refuse("LINE_UNKNOWN", f"no research line {line_bundle!r} at {commit}", missing=(str(line_bundle),))
    line = read_line(conn, line_bundle, at)
    window = (datetime.combine(date.fromisoformat(line["window_start"]), time()),
              datetime.combine(date.fromisoformat(line["window_end"]), time()))
    found = [trial_id for trial_id, start, end in conn.rows(
        f"SELECT trial_id, trade_start, trade_end FROM trial{clause} WHERE purpose = 'research' ORDER BY trial_id")
        if _market_commit(conn, trial_id, clause) == line["market_commit"] and (start, end) == window]
    if since_commit is not None:
        since = db.resolve_commit(conn, since_commit)
        added = {trial_id for (trial_id,) in conn.rows(
            "SELECT to_trial_id FROM dolt_diff(%s, %s, 'trial') WHERE diff_type = 'added'",
            (since, commit if at is not None else "WORKING"))}
        found = [trial_id for trial_id in found if trial_id in added]
    return {"trials": found, "count": len(found)}


def _market_commit(conn: db.LedgerConnection, trial_id: int, clause: str) -> str:
    """The market commit of a research trial's input identity, read from execution.json of its start
    receipt (written in the trial's own commit, so a missing or unreadable one is ledger damage)."""
    bundle = f"trial-{trial_id}-execution-start"
    found = conn.rows(f"SELECT c.content, e.sha256 FROM {evidence.files_from(clause)} WHERE e.bundle = %s "
                      "AND e.path = %s",
                      (bundle, execution.MANIFEST))
    try:
        (content, stored), = found
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise ValueError("hash mismatch")
        market_commit = json.loads(content.decode("utf-8"))["input_identity"]["market_commit"]
        if not isinstance(market_commit, str):
            raise TypeError("market commit is not text")
        return market_commit
    except (ValueError, KeyError, TypeError) as exc:
        raise refuse("LEDGER_CORRUPT", f"research trial {trial_id} has no readable start receipt",
                     missing=(f"{bundle}/{execution.MANIFEST}",)) from exc



# Closing ended lines

def tag_name(bundle: str) -> str:
    """The closing tag of a line: line/<UTC date>-<slug>."""
    return TAG_PREFIX + bundle[len(PREFIX):]


def unclosed_lines(conn: db.LedgerConnection) -> list[dict]:
    """The ended lines (every line but the latest) without their closing tag, oldest first, each
    with its closing commit ({line, tag, commit, ended_by})."""
    tags = {name for (name,) in conn.rows("SELECT tag_name FROM dolt_tags WHERE tag_name LIKE 'line/%'")}
    return [{"line": bundle, **closing_commit(conn, bundle)} for bundle in _lines(conn, "")[:-1]
            if tag_name(bundle) not in tags]


def closing_commit(conn: db.LedgerConnection, bundle: str) -> dict:
    """{tag, commit, ended_by} of an ended line: the parent of the commit that added the next line
    (the research branch is linear). LINE_UNKNOWN for no line, LINE_OPEN for the current one."""
    named = _lines(conn, "")
    if bundle not in named:
        raise refuse("LINE_UNKNOWN", f"no research line {bundle!r}", missing=(str(bundle),))
    position = named.index(bundle)
    if position == len(named) - 1:
        raise refuse("LINE_OPEN", f"{bundle} is the current line; it ends when the next line is selected",
                     missing=(bundle,))
    successor = named[position + 1]
    (added,), = conn.rows("SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s AND "
                          "diff_type = 'added'", (successor,))
    parents = conn.rows("SELECT parent_hash FROM dolt_commit_ancestors WHERE commit_hash = %s", (added,))
    if len(parents) != 1:
        raise refuse("LEDGER_CORRUPT", f"the commit adding {successor} has {len(parents)} parents", missing=(added,))
    return {"tag": tag_name(bundle), "commit": parents[0][0], "ended_by": successor}


def close_line(profile: db.LedgerProfile, bundle: str, summary: bytes) -> dict:
    """Tag an ended line's last commit line/<date>-<slug> with the Agent's summary (UTF-8, at most
    SUMMARY_LIMIT bytes, stored without surrounding blank space) as the message, as the service
    administrator; the same summary again is a replay, another one LINE_CLOSED (a tag is never
    replaced)."""
    from ledger import admin
    try:
        text = summary.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise refuse("LINE_SUMMARY_INVALID", "the summary is not UTF-8", expected="UTF-8 text") from exc
    text = text.strip()  # Dolt stores a tag message without its trailing newline, as git does
    if not text or len(summary) > SUMMARY_LIMIT:
        raise refuse("LINE_SUMMARY_INVALID", "the summary is empty or too long",
                     expected=f"1 to {SUMMARY_LIMIT} bytes of UTF-8 text")
    with db.connect(profile, "reader") as conn:
        closing = closing_commit(conn, bundle)
        existing = conn.rows("SELECT tag_hash, message FROM dolt_tags WHERE tag_name = %s", (closing["tag"],))
    if existing:
        if tuple(existing[0]) == (closing["commit"], text):
            return {"line": bundle, **closing, "replayed": True}
        raise refuse("LINE_CLOSED", f"{bundle} is already closed as {closing['tag']}", missing=(closing["tag"],))
    try:
        _, conn = admin._admin(profile)
    except pymysql.MySQLError as exc:
        raise refuse("LEDGER_UNAVAILABLE", "the service administrator could not connect to tag the line") from exc
    try:
        with conn.cursor() as cursor:
            cursor.execute("CALL DOLT_TAG('-m', %s, %s, %s)", (text, closing["tag"], closing["commit"]))
    except pymysql.MySQLError as exc:
        raise db._sql_error(exc) from exc
    finally:
        conn.close()
    return {"line": bundle, **closing, "replayed": False}
