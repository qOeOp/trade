"""Research lines (`ledger.select_line`, `ledger.open_lines`, `ledger.open_line`, `ledger.read_line`,
`ledger.registration_line`, `ledger.line_trials`, `ledger.close_line`).

A research line is the user's choice of start candidate (a revision whose source review passed),
development window and pinned market commit, stored append-only as the evidence bundle
research-line-<UTC date>-<slug> holding research-line.json; the slug names the line's direction.
A new choice is a new line, never an edit.

A line is open from its selection until it is closed, and several lines may be open at once; two
open lines never share a market commit and window, so the trials of each stay apart. Closing a line
tags the research head (`line/<UTC date>-<slug>`) with the Agent's summary as the tag message: the
line's end and an index for later research. A tag on a commit or an ancestor of it closes the line
there. Only the product tags, as the service administrator (the writer account cannot tag); the
summary is an index, the evidence stays in the ledger.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
import hashlib
import json
import re

import pymysql

from ledger import db, evidence, execution, review_activity, strategies
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


def _tags(conn: db.LedgerConnection) -> dict[str, str]:
    """{line bundle: tagged commit} of every closing tag."""
    return {PREFIX + name[len(TAG_PREFIX):]: commit for name, commit in conn.rows(
        "SELECT tag_name, tag_hash FROM dolt_tags WHERE tag_name LIKE 'line/%'")}


def open_lines(conn: db.LedgerConnection, at: str | None = None) -> list[str]:
    """The research lines open at `at` (default: what the connection sees), oldest first: those whose
    closing tag, if any, is on neither that commit nor an ancestor of it."""
    commit, clause = db.as_of(conn, at)
    tags = _tags(conn)
    return [bundle for bundle in _lines(conn, clause)
            if bundle not in tags or not conn.rows("SELECT 1 FROM dolt_log(%s) WHERE commit_hash = %s LIMIT 1",
                                                   (commit, tags[bundle]))]


def open_line(conn: db.LedgerConnection, bundle: str | None = None, at: str | None = None) -> dict:
    """The record of the open line `bundle`, or without one of the only open line: LINE_UNKNOWN or
    LINE_ENDED for a named line that is no line or is closed; RESEARCH_LINE_REQUIRED when no line
    is open and LINE_AMBIGUOUS when several are."""
    opened = open_lines(conn, at)
    if bundle is None:
        if not opened:
            raise refuse("RESEARCH_LINE_REQUIRED", "the ledger has no open research line", missing=("research-line",))
        if len(opened) > 1:
            raise refuse("LINE_AMBIGUOUS", "several research lines are open: " + ", ".join(opened) + "; name one "
                         "with --line", missing=tuple(opened))
        bundle = opened[0]
    elif bundle not in opened:
        _, clause = db.as_of(conn, at)
        if bundle not in _lines(conn, clause):
            raise refuse("LINE_UNKNOWN", f"no research line {bundle!r}", missing=(str(bundle),))
        raise refuse("LINE_ENDED", f"{bundle} is closed ({tag_name(bundle)})", missing=(bundle,))
    return read_line(conn, bundle, at)


def list_lines(profile: db.LedgerProfile, at: str | None = None) -> dict:
    """All line declarations and their open/closed state at one pinned ledger commit; no market read."""
    with db.read_as_of(profile, at) as conn:
        opened = set(open_lines(conn))
        fields = ("bundle", "start", "window_start", "window_end", "market_commit", "created_at")
        items = []
        for bundle in line_bundles(conn):
            record = read_line(conn, bundle, None)
            items.append({**{key: record[key] for key in fields}, "closed": bundle not in opened})
        return {"ledger_commit": db.head_commit(conn), "lines": items}


def _keyed(conn: db.LedgerConnection, at: str | None) -> list[tuple]:
    """(created_at, bundle, market commit, window start, window end) of every line, oldest first; the
    window as the midnights a trial row holds."""
    _, clause = db.as_of(conn, at)
    found = []
    for bundle in _lines(conn, clause):
        line = read_line(conn, bundle, at)
        found.append((line["created_at"], bundle, line["market_commit"],
                      datetime.combine(date.fromisoformat(line["window_start"]), time()),
                      datetime.combine(date.fromisoformat(line["window_end"]), time())))
    return found


def _owner(keyed: list[tuple], market_commit, start: datetime, end: datetime, before) -> str | None:
    owner = None
    for created, bundle, commit, first, last in keyed:
        if created < before and (commit, first, last) == (market_commit, start, end):
            owner = bundle
    return owner


def registration_line(conn: db.LedgerConnection, market_commit: str | None, window, registered_at,
                      at: str | None = None) -> str | None:
    """The line a registration belongs to: the last line added before it (`registered_at`, its bundle's
    creation time) with its market commit and window ({trade_start, trade_end} ISO dates), or None."""
    try:
        start, end = (datetime.combine(date.fromisoformat(window[key]), time()) for key in ("trade_start", "trade_end"))
    except (KeyError, TypeError, ValueError):
        return None
    return _owner(_keyed(conn, at), market_commit, start, end, registered_at)


def select_line(conn: db.LedgerConnection, market_database: str, market_at: str, window_start: date,
                window_end: date, start: str, note: str | None = None, *, slug: str,
                market: Callable[[str, str], dict],
                reviews: Callable[[db.LedgerConnection], list[dict]],
                targets: tuple[float, float] | None = None) -> dict:
    """Append the user's chosen line as research-line-<UTC date>-<slug>; the same choice as an open
    line (whatever its slug) is a replay of that line. Another choice under a name already taken is
    LINE_CONFLICT: the Agent names the direction more precisely; one on the market commit and window
    of an open line is LINE_DATA_TAKEN, checked inside the write. `targets` (maximum drawdown,
    minimum annual return) are the user's for this line, written in the same commit; without them
    the line reads the ledger default.

    `market(market_database, market_at)` returns {commit, universe_rule, latest_complete_day}
    (market.resolve_commit and market.freshness of the design, a later phase). `reviews(conn)` is
    qualification.review_records: the start revision needs a passed source review of its source
    hash and none failed, read at the head this connection sees; a review that failed only on the
    activity of a precheck that did not trade is not counted once a later precheck traded and
    passed (`review_activity.resolved`).
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
    verdicts = {record["verdict"] for record in reviewed if not review_activity.resolved(conn, record, reviewed)}
    if "failed" in verdicts or "passed" not in verdicts:
        raise refuse("START_REVIEW_REQUIRED", f"{start} has {'a failed' if 'failed' in verdicts else 'no passed'} "
                                              "source review", missing=(start,))
    choice = {"market_database": market_database, "market_commit": facts["commit"],
              "universe_rule": facts["universe_rule"], "window_start": window_start.isoformat(),
              "window_end": window_end.isoformat(), "start": start, "start_sha256": candidate["source_sha256"],
              "note": note}
    latest = next((line for line in (read_line(conn, bundle, None) for bundle in open_lines(conn))
                   if all(line[key] == value for key, value in choice.items())), None)
    if latest is not None:
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
        for other in open_lines(c):
            held = read_line(c, other, None)
            if other != bundle and (held["market_commit"], held["window_start"], held["window_end"]) == (
                    choice["market_commit"], choice["window_start"], choice["window_end"]):
                raise refuse("LINE_DATA_TAKEN", f"the open line {other} already holds market commit "
                             f"{choice['market_commit']} and window {choice['window_start']}..{choice['window_end']}",
                             missing=(other,))
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


def _encode(record: dict) -> bytes:
    return (json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def line_trials(conn: db.LedgerConnection, line_bundle: str, since_commit: str | None = None,
                at: str | None = None) -> dict:
    """Research trials of a line, invalid and interrupted ones included: those whose registration
    belongs to the line (registration_line, read from the trial's own market commit and trading
    window, which binding made the registration's). With `since_commit`, only trials added after it.
    (The start receipt carries no window, so the trial row's is read.)"""
    commit, clause = db.as_of(conn, at)
    if (not isinstance(line_bundle, str) or not LINE.fullmatch(line_bundle)
            or not conn.rows(f"SELECT 1 FROM evidence_bundle{clause} WHERE bundle = %s", (line_bundle,))):
        raise refuse("LINE_UNKNOWN", f"no research line {line_bundle!r} at {commit}", missing=(str(line_bundle),))
    keyed = _keyed(conn, at)
    _, _, market_commit, first, last = next(item for item in keyed if item[1] == line_bundle)
    registered = dict(conn.rows(f"SELECT a.trial_id, b.created_at FROM registration_attempt{clause} AS a "
                                f"JOIN evidence_bundle{clause} AS b ON b.bundle = a.registration_bundle"))
    found = []
    for trial_id, start, end in conn.rows(f"SELECT trial_id, trade_start, trade_end FROM trial{clause} "
                                          "WHERE purpose = 'research' ORDER BY trial_id"):
        if (start, end) != (first, last) or _market_commit(conn, trial_id, clause) != market_commit:
            continue
        if trial_id not in registered:
            raise refuse("LEDGER_CORRUPT", f"research trial {trial_id} has no registration attempt",
                         missing=(f"trial {trial_id}",))
        if _owner(keyed, market_commit, start, end, registered[trial_id]) == line_bundle:
            found.append(trial_id)
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



# Closing lines

def tag_name(bundle: str) -> str:
    """The closing tag of a line: line/<UTC date>-<slug>."""
    return TAG_PREFIX + bundle[len(PREFIX):]


def close_line(profile: db.LedgerProfile, bundle: str, summary: bytes) -> dict:
    """End the line `bundle` by tagging the research head line/<date>-<slug> with the Agent's summary
    (UTF-8, at most SUMMARY_LIMIT bytes, stored without surrounding blank space) as the message, as the
    service administrator; the same summary again is a replay of the existing tag, another one
    LINE_CLOSED (a tag is never replaced)."""
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
        if bundle not in _lines(conn, ""):
            raise refuse("LINE_UNKNOWN", f"no research line {bundle!r}", missing=(str(bundle),))
        closing = {"tag": tag_name(bundle), "commit": db.head_commit(conn)}
        existing = conn.rows("SELECT tag_hash, message FROM dolt_tags WHERE tag_name = %s", (closing["tag"],))
    if existing:
        if existing[0][1] == text:
            return {"line": bundle, "tag": closing["tag"], "commit": existing[0][0], "replayed": True}
        raise refuse("LINE_CLOSED", f"{bundle} is already closed as {closing['tag']}", missing=(closing["tag"],))
    try:
        _, conn = admin._admin(profile)
    except pymysql.MySQLError as exc:
        raise refuse("LEDGER_UNAVAILABLE", "the service administrator could not connect to tag the line"
                     + (f": {exc.args[1]}" if isinstance(exc, db.NoAnswer) else "")) from exc
    try:
        with conn.cursor() as cursor:
            cursor.execute("CALL DOLT_TAG('-m', %s, %s, %s)", (text, closing["tag"], closing["commit"]))
    except pymysql.MySQLError as exc:
        raise db._sql_error(exc) from exc
    finally:
        conn.close()
    return {"line": bundle, **closing, "replayed": False}
