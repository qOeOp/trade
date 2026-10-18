"""Research lines (`ledger.select_line`, `ledger.current_line`, `ledger.line_trials`).

A research line is the user's choice of start candidate, development window and pinned market
commit, stored append-only as the evidence bundle research-line-<n> holding research-line.json.
The latest line is the one with the largest n; a new choice is a new number, never an edit.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
import hashlib
import json
import re

from ledger import db, evidence, strategies
from ledger.errors import Refusal
from ledger.refusals import refuse


LINE = re.compile(r"research-line-([1-9][0-9]*)\Z")
FILE = "research-line.json"
FORMAT = "research-line-v1"
FIELDS = ("line_no", "market_database", "market_commit", "universe_rule", "window_start", "window_end", "start",
          "start_sha256", "note")


def _unavailable_market(market_database: str, market_at: str) -> dict:
    raise NotImplementedError("market.resolve_commit and market.freshness arrive with the market package; "
                              "pass market= until then")


def _read_line(conn: db.LedgerConnection, bundle: str, at: str | None) -> dict:
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


def _lines(conn: db.LedgerConnection, clause: str) -> list[tuple[int, str]]:
    names = conn.rows(f"SELECT bundle FROM evidence_bundle{clause} WHERE bundle LIKE 'research-line-%'")
    return sorted((int(match.group(1)), name) for (name,) in names if (match := LINE.fullmatch(name)))


def current_line(conn: db.LedgerConnection, at: str | None = None) -> dict | None:
    """The latest research line record at `at` (default: what the connection sees), or None."""
    _, clause = db.as_of(conn, at)
    numbered = _lines(conn, clause)
    if not numbered:
        return None
    return _read_line(conn, numbered[-1][1], at)


def select_line(conn: db.LedgerConnection, market_database: str, market_at: str, window_start: date,
                window_end: date, start: str, note: str | None = None, *,
                market: Callable[[str, str], dict] | None = None) -> dict:
    """Append the user's chosen line as research-line-<n+1>; the same choice again is a replay.

    `market(market_database, market_at)` returns {commit, universe_rule, latest_complete_day}
    (market.resolve_commit and market.freshness of the design, a later phase).
    """
    try:
        candidate = strategies.read_candidate(conn, start)
    except Refusal as exc:
        if exc.code == "UNKNOWN_CANDIDATE":
            raise refuse("START_NOT_FOUND", f"no candidate {start} to start the line from", missing=(start,)) from exc
        raise
    try:
        facts = (market or _unavailable_market)(market_database, market_at or "main")
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
    choice = {"market_database": market_database, "market_commit": facts["commit"],
              "universe_rule": facts["universe_rule"], "window_start": window_start.isoformat(),
              "window_end": window_end.isoformat(), "start": start, "start_sha256": candidate["source_sha256"],
              "note": note}
    latest = current_line(conn)
    if latest is not None and all(latest[key] == value for key, value in choice.items()):
        content_sha256 = hashlib.sha256(_encode({"format": FORMAT, "line_no": latest["line_no"], **choice})).hexdigest()
        return {"bundle": latest["bundle"], "line_no": latest["line_no"], "market_commit": latest["market_commit"],
                "universe_rule": latest["universe_rule"], "content_sha256": content_sha256,
                "op_id": db.derive_op_id("select_line", {"bundle": latest["bundle"], "content_sha256": content_sha256}),
                "created": False}
    line_no = (latest["line_no"] if latest else 0) + 1
    bundle = f"research-line-{line_no}"
    content = _encode({"format": FORMAT, "line_no": line_no, **choice})
    content_sha256 = hashlib.sha256(content).hexdigest()
    op = db.derive_op_id("select_line", {"bundle": bundle, "content_sha256": content_sha256})
    try:
        written = evidence.write_files(conn, "select_line", bundle, {FILE: content}, op)
    except Refusal as exc:
        if exc.code == "BUNDLE_EXISTS":
            raise refuse("LINE_CONFLICT", f"{bundle} already exists with other content", missing=(bundle,)) from exc
        raise
    return {"bundle": bundle, "line_no": line_no, "market_commit": facts["commit"],
            "universe_rule": facts["universe_rule"], "content_sha256": content_sha256, "op_id": written["op_id"],
            "created": not written["replayed"]}


def _encode(record: dict) -> bytes:
    return (json.dumps(record, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def line_trials(conn: db.LedgerConnection, line_bundle: str, since_commit: str | None = None,
                at: str | None = None) -> dict:
    """Research trials of a line (its market commit and development window), invalid and interrupted
    ones included; with `since_commit`, only those added after it."""
    commit, clause = db.as_of(conn, at)
    if (not isinstance(line_bundle, str) or not LINE.fullmatch(line_bundle)
            or not conn.rows(f"SELECT 1 FROM evidence_bundle{clause} WHERE bundle = %s", (line_bundle,))):
        raise refuse("LINE_UNKNOWN", f"no research line {line_bundle!r} at {commit}", missing=(str(line_bundle),))
    line = _read_line(conn, line_bundle, at)
    window = (datetime.combine(date.fromisoformat(line["window_start"]), time()),
              datetime.combine(date.fromisoformat(line["window_end"]), time()))
    found = [trial_id for (trial_id,) in conn.rows(
        f"SELECT trial_id FROM trial{clause} WHERE purpose = 'research' AND trade_start = %s AND trade_end = %s "
        "ORDER BY trial_id", window)]
    if since_commit is not None:
        since = db.resolve_commit(conn, since_commit)
        added = {trial_id for (trial_id,) in conn.rows(
            "SELECT to_trial_id FROM dolt_diff(%s, %s, 'trial') WHERE diff_type = 'added'",
            (since, commit if at is not None else "WORKING"))}
        found = [trial_id for trial_id in found if trial_id in added]
    trials = [trial_id for trial_id in found if _market_commit(conn, trial_id, at) == line["market_commit"]]
    return {"trials": trials, "count": len(trials)}


def _market_commit(conn: db.LedgerConnection, trial_id: int, at: str | None) -> str | None:
    """The market commit of a trial's input identity, from its execution start receipt."""
    try:
        receipt = evidence.load_bundle(conn, f"trial-{trial_id}-execution-start", at)
        manifest = json.loads(receipt["files"]["execution.json"].decode("utf-8"))
        return manifest["input_identity"]["market_commit"]
    except (Refusal, KeyError, ValueError, TypeError) as exc:
        if isinstance(exc, Refusal) and exc.code != "UNKNOWN_BUNDLE":
            raise
        return None
