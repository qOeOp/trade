"""Research lines (`ledger.select_line`, `ledger.open_lines`, `ledger.open_line`, `ledger.read_line`,
`ledger.line_trials`, `ledger.close_line`).

A research line is the user's choice of start candidate (a revision whose source review passed) and
pinned market commit, one research_line row named by a slug for the line's direction. Its development
period is the product's rule, not a choice (`development_period`): the last four complete calendar
quarters before the day the line opens that the market covers, so lines opened in one quarter share it.
A new choice is a new line, never an edit.

A line is open from its selection until its line_close row, and several lines may be open at once, on the
same market commit and window too: every research trial names its line, so the trials of each stay apart.
Closing a line records the Agent's summary: the line's end and an index for later research.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
import re

from ledger import db, review_activity, strategies
from ledger import targets as line_targets
from shared.errors import Refusal
from shared.refusals import refuse


SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SLUG_LIMIT = 48
SUMMARY_LIMIT = 32 * 1024  # bytes of a line summary; an index, not a report
LINE_COLUMNS = ("l.line_id, l.name, l.start_source_sha256, c.strategy_id, c.revision, l.market_commit, "
                "l.universe_rule, l.dev_start, l.dev_end, l.created_at, x.summary AS closed_summary, "
                "x.created_at AS closed_at")
LINES = ("research_line l JOIN candidate c ON c.source_sha256 = l.start_source_sha256 "
         "LEFT JOIN line_close x ON x.line_id = l.line_id")


def _record(row: dict) -> dict:
    return {"line_id": row["line_id"], "name": row["name"], "start": f"{row['strategy_id']}@{row['revision']}",
            "start_sha256": row["start_source_sha256"], "market_commit": row["market_commit"],
            "universe_rule": row["universe_rule"], "dev_start": row["dev_start"].isoformat(),
            "dev_end": row["dev_end"].isoformat(), "created_at": row["created_at"],
            "closed": row["closed_at"] is not None, "closed_at": row["closed_at"], "summary": row["closed_summary"]}


def lines(conn: db.LedgerConnection, *, open_only: bool = False) -> list[dict]:
    """Every research line the connection sees (or only the open ones), oldest first."""
    where = " WHERE x.line_id IS NULL" if open_only else ""
    return [_record(row) for row in conn.dicts(f"SELECT {LINE_COLUMNS} FROM {LINES}{where} ORDER BY l.line_id")]


def read_line(conn: db.LedgerConnection, line: str | int) -> dict:
    """The research line named `line` (its name, or its line_id), open or closed; LINE_UNKNOWN otherwise."""
    column = "l.line_id" if isinstance(line, int) else "l.name"
    found = conn.dicts(f"SELECT {LINE_COLUMNS} FROM {LINES} WHERE {column} = %s", (line,))
    if not found:
        raise refuse("LINE_UNKNOWN", f"no research line {line!r}", missing=(str(line),))
    return _record(found[0])


def open_lines(conn: db.LedgerConnection) -> list[str]:
    """The names of the research lines open on what the connection sees, oldest first."""
    return [line["name"] for line in lines(conn, open_only=True)]


def open_line(conn: db.LedgerConnection, line: str | int | None = None) -> dict:
    """The record of the open line `line`, or without one of the only open line: LINE_UNKNOWN or
    LINE_ENDED for a named line that is no line or is closed; RESEARCH_LINE_REQUIRED when no line
    is open and LINE_AMBIGUOUS when several are."""
    if line is None:
        opened = lines(conn, open_only=True)
        if not opened:
            raise refuse("RESEARCH_LINE_REQUIRED", "the ledger has no open research line", missing=("research-line",))
        if len(opened) > 1:
            names = [item["name"] for item in opened]
            raise refuse("LINE_AMBIGUOUS", "several research lines are open: " + ", ".join(names) + "; name one "
                         "with --line", missing=tuple(names))
        return opened[0]
    record = read_line(conn, line)
    if record["closed"]:
        raise refuse("LINE_ENDED", f"{record['name']} is closed", missing=(record["name"],))
    return record


LISTED = ("line_id", "name", "start", "dev_start", "dev_end", "market_commit", "created_at", "closed")


def list_lines(profile: db.LedgerProfile, at: str | None = None, *, every: bool = False) -> dict:
    """The open line declarations (L11), or with `every` the closed ones too, and their open/closed state at one
    pinned ledger commit; no market read."""
    with db.read_as_of(profile, at) as conn:
        return {"ledger_commit": db.head_commit(conn),
                "lines": [{**{key: line[key] for key in LISTED},
                           "targets": line_targets.targets_for(conn, line["line_id"])}
                          for line in lines(conn, open_only=not every)]}


QUARTER_STARTS = (1, 4, 7, 10)


def development_period(today: date, latest_complete_day: date) -> tuple[date, date]:
    """[first day, day after the last) of the last four complete calendar quarters that end before `today` and
    within `latest_complete_day` (line-close-history-test-20261110.zh.md 3.1)."""
    last = min(today - timedelta(days=1), latest_complete_day)
    after = last + timedelta(days=1)
    end = after if after.day == 1 and after.month in QUARTER_STARTS else date(last.year, 3 * ((last.month - 1) // 3) + 1, 1)
    return date(end.year - 1, end.month, 1), end


def _ns(day: date) -> int:
    return int(datetime.combine(day, time(), UTC).timestamp()) * 10**9


def check_replay_window(conn: db.LedgerConnection, line: str | None, trade_start_ns: int, end_ns: int,
                        latest_complete_day: date, today: date | None = None) -> None:
    """Where an explore or precheck replay may trade (line-close-history-test-20261110.zh.md 3.2, B5): with `line`,
    inside that open line's development period; without one (only a start candidate's precheck), inside the period
    a line opened today would get and before the forward segment of every open line, which begins at its period's
    end. History outside development periods is replayed only when a line closes. WINDOW_OUTSIDE_DEVELOPMENT
    otherwise; LINE_UNKNOWN or LINE_ENDED for a named line that is no open line."""
    if line is not None:
        record = open_line(conn, line)
        first, end = date.fromisoformat(record["dev_start"]), date.fromisoformat(record["dev_end"])
        allowed = f"line {record['name']}'s development period"
    else:
        if today is None:
            (today,), = conn.rows("SELECT DATE(UTC_TIMESTAMP())")
        first, end = development_period(today, latest_complete_day)
        allowed = "the development period a line opened today would get"
        forward = [item for item in lines(conn, open_only=True) if date.fromisoformat(item["dev_end"]) < end]
        if forward:
            earliest = min(forward, key=lambda item: item["dev_end"])
            end = date.fromisoformat(earliest["dev_end"])
            allowed += f", before the forward segment of the open line {earliest['name']}"
    if not _ns(first) <= trade_start_ns < end_ns <= _ns(end):
        raise refuse("WINDOW_OUTSIDE_DEVELOPMENT", f"the trading window must lie inside {allowed}: from {first} to "
                                                   f"{end} (exclusive)", expected=f"{first} <= trade window <= {end}")


def select_line(conn: db.LedgerConnection, market_at: str, start: str, *, slug: str, market: Callable[[str], dict],
                reviews: Callable[[db.LedgerConnection, str], list[dict]],
                targets: tuple[float, float] | None = None, today: date | None = None) -> dict:
    """Append the user's chosen line named `slug`; the same choice as an open line under that name is a replay.
    Another choice under a name already taken is LINE_CONFLICT: the Agent names the direction more precisely.
    `targets` (maximum drawdown, minimum annual return) are the user's for this line, written in the same commit;
    without them the line reads the ledger default.

    `market(market_at)` returns {commit, universe_rule, latest_complete_day} (the market's resolve_commit and
    freshness); the development period follows from that day and `today` (default the ledger server's UTC date). `reviews(conn, source_sha256)` is registration.review_records: the start revision needs a passed
    source review of its source hash and none failed, read at the head this connection sees; a review that failed
    only on the activity of a precheck that did not trade is not counted once a later precheck traded and passed
    (`review_activity.resolved`).
    """
    if targets is not None:
        line_targets.check(*targets)
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
        facts = market(market_at or "main")
    except Refusal as exc:
        raise refuse("MARKET_COMMIT_UNRESOLVED", f"market reference {market_at!r} did not resolve ({exc.code})",
                     missing=(str(market_at),)) from exc
    if not facts.get("commit") or not facts.get("universe_rule"):
        raise refuse("MARKET_COMMIT_UNRESOLVED", f"market reference {market_at!r} has no commit with a universe rule",
                     missing=(str(market_at),))
    latest_day = facts.get("latest_complete_day")
    if latest_day is None:
        raise refuse("MARKET_COMMIT_UNRESOLVED", f"market reference {market_at!r} has no complete day",
                     missing=(str(market_at),))
    if today is None:
        (today,), = conn.rows("SELECT DATE(UTC_TIMESTAMP())")
    window_start, window_end = development_period(today, latest_day)
    reviewed = reviews(conn, candidate["source_sha256"])
    verdicts = {record["verdict"] for record in reviewed if not review_activity.resolved(conn, record, reviewed)}
    if "failed" in verdicts or "passed" not in verdicts:
        raise refuse("START_REVIEW_REQUIRED", f"{start} has {'a failed' if 'failed' in verdicts else 'no passed'} "
                                              "source review", missing=(start,))
    choice = {"name": slug, "start_source_sha256": candidate["source_sha256"], "market_commit": facts["commit"],
              "universe_rule": facts["universe_rule"], "dev_start": window_start.isoformat(),
              "dev_end": window_end.isoformat()}

    def insert(c, operation):
        if c.rows("SELECT 1 FROM research_line WHERE name = %s", (slug,)):
            raise refuse("LINE_CONFLICT", f"a line named {slug} already exists with another choice; name this "
                                          "direction with another slug", missing=(slug,))
        c.rows("INSERT INTO research_line (name, start_source_sha256, market_commit, universe_rule, dev_start, dev_end, "
               "op_id) VALUES (%s, %s, %s, %s, %s, %s, %s)", (*choice.values(), operation))
        (line_id,), = c.rows("SELECT LAST_INSERT_ID()")
        if targets is not None:
            line_targets.set_targets(c, line_id, *targets)
        return {"line_id": line_id}

    def replay(c, row):
        record = read_line(c, row["line_id"])
        if targets is not None and not record["closed"]:
            line_targets.set_targets(c, row["line_id"], *targets)
        return {"line_id": row["line_id"]}

    written = db.write(conn, "select_line", choice, "research_line", insert, replay)
    line = read_line(conn, written["record"]["line_id"])
    return {"line": line["name"], "line_id": line["line_id"], "market_commit": line["market_commit"],
            "universe_rule": line["universe_rule"], "op_id": written["op_id"], "created": not written["replayed"],
            "targets": line_targets.targets_for(conn, line["line_id"])}


def line_trials(conn: db.LedgerConnection, line: str | int, since_commit: str | None = None) -> dict:
    """Research trials of a line, invalid and interrupted ones included. With `since_commit`, only trials added
    after it."""
    record = read_line(conn, line)
    found = [trial_id for (trial_id,) in conn.rows("SELECT trial_id FROM trial WHERE purpose = 'research' AND "
                                                   "line_id = %s ORDER BY trial_id", (record["line_id"],))]
    if since_commit is not None:
        since = db.resolve_commit(conn, since_commit)
        added = {trial_id for (trial_id,) in conn.rows(
            "SELECT to_trial_id FROM dolt_diff(%s, %s, 'trial') WHERE diff_type = 'added'", (since, "WORKING"))}
        found = [trial_id for trial_id in found if trial_id in added]
    return {"trials": found, "count": len(found)}


# The closing history test

def history_segments(dev_start: date, dev_end: date, first_day: date, after_last: date) -> list[dict]:
    """The trade segments of a line's closing history test: each calendar year before the development
    period, from the market's `first_day` and cut at the period's start; the period itself again, as the
    control; and the forward segment from the period's end to `after_last` (the day after the market's
    latest complete day), when it is not empty. Each is {kind (year | control | forward), label, start, end},
    end exclusive."""
    segments = []
    for year in range(first_day.year, dev_start.year + 1):
        start, end = max(date(year, 1, 1), first_day), min(date(year + 1, 1, 1), dev_start)
        if start < end:
            segments.append({"kind": "year", "label": str(year), "start": start, "end": end})
    segments.append({"kind": "control", "label": "development", "start": dev_start, "end": dev_end})
    if dev_end < after_last:
        segments.append({"kind": "forward", "label": "forward", "start": dev_end, "end": after_last})
    return segments


def history_participants(conn: db.LedgerConnection, line_id: int) -> list[dict]:
    """The candidates of a line's closing history test: every source with a passed research run on the line
    written before the line's first history trial (all of them while it has none), each with its latest such
    run, oldest source first."""
    return conn.dicts(
        "SELECT t.source_sha256, MAX(t.trial_id) AS trial_id FROM trial t JOIN run r ON r.trial_id = t.trial_id "
        "WHERE t.purpose = 'research' AND t.line_id = %s AND r.status = 'passed' AND t.trial_id < COALESCE("
        "(SELECT MIN(h.trial_id) FROM trial h WHERE h.purpose = 'history' AND h.line_id = %s), t.trial_id + 1) "
        "GROUP BY t.source_sha256 ORDER BY MIN(t.trial_id)", (line_id, line_id))


def require_not_closing(conn: db.LedgerConnection, line_id: int, why: str = "it has a history trial") -> None:
    """LINE_ENDED once the line's closing has begun: its first history trial fixed the candidates of its closing
    history test, so it takes no new research registration (the user's option B, 2026-11-11) and no research run
    of a grid point registered before (the user, 2026-11-11). `why` ends the message."""
    if conn.rows("SELECT 1 FROM trial WHERE purpose = 'history' AND line_id = %s LIMIT 1", (line_id,)):
        name = read_line(conn, line_id)["name"]
        raise refuse("LINE_ENDED", f"the closing of {name} has begun: {why}", missing=(name,))


class HistoryBinder:
    """The binder ledger.open_trial calls for a history trial: the line must still be open (LINE_ENDED)."""

    def __init__(self, line_id: int):
        self.line_id = line_id
        self.registration = {"history_line_id": line_id}

    def __call__(self, conn: db.LedgerConnection, row) -> dict:
        record = read_line(conn, self.line_id)
        if record["closed"]:
            raise refuse("LINE_ENDED", f"{record['name']} is closed", missing=(record["name"],))
        return {"line_id": self.line_id}


def history_trials(conn: db.LedgerConnection, line_id: int) -> list[dict]:
    """The line's history trials with their run's status (None while it has no run), in trial order."""
    return conn.dicts("SELECT t.trial_id, t.source_sha256, t.trade_start, t.trade_end, r.status FROM trial t "
                      "LEFT JOIN run r ON r.trial_id = t.trial_id WHERE t.purpose = 'history' AND t.line_id = %s "
                      "ORDER BY t.trial_id", (line_id,))


def history_plan(conn: db.LedgerConnection, line_id: int, first_day: date, after_last: date) -> list[dict]:
    """Every pair of participant and segment of the line's closing history test (history_participants,
    history_segments), participant by participant: the segment with the participant's `source_sha256`, its
    research run `trial_id`, `window` (input_start, trade_start, trade_end: the run's warm-up before a trade
    start no earlier than the segment's or than the market's first day plus that warm-up; None when nothing of
    the segment is left to trade) and `done` (the history trial with a run that covers it, or None). A forward
    segment is covered by any history run trading from the period's end: its end moves with the market."""
    record = read_line(conn, line_id)
    dev_start, dev_end = date.fromisoformat(record["dev_start"]), date.fromisoformat(record["dev_end"])
    segments = history_segments(dev_start, dev_end, first_day, after_last)
    ran = [row for row in history_trials(conn, line_id) if row["status"] is not None]
    plan = []
    for participant in history_participants(conn, line_id):
        trial = conn.one("SELECT input_start, trade_start FROM trial WHERE trial_id = %s", (participant["trial_id"],))
        assert trial is not None  # a participant is a run's trial
        warmup = trial["trade_start"] - trial["input_start"]
        earliest = datetime.combine(first_day, time()) + warmup
        own = [row for row in ran if row["source_sha256"] == participant["source_sha256"]]
        for segment in segments:
            start = max(datetime.combine(segment["start"], time()), earliest)
            end = datetime.combine(segment["end"], time())
            window = ({"input_start": start - warmup, "trade_start": start, "trade_end": end} if start < end
                      else None)
            if segment["kind"] == "forward":
                done = next((row["trial_id"] for row in own if row["trade_start"] >= datetime.combine(dev_end, time())),
                            None)
            else:
                done = next((row["trial_id"] for row in own if window is not None
                             and (row["trade_start"], row["trade_end"]) == (start, end)), None)
            plan.append({**segment, "source_sha256": participant["source_sha256"],
                         "trial_id": participant["trial_id"], "window": window, "done": done})
    return plan


# Closing lines

def close_line(profile: db.LedgerProfile, line: str, summary: bytes, market_days: tuple[date, date]) -> dict:
    """End the line `line` with the Agent's summary (UTF-8, at most SUMMARY_LIMIT bytes, stored without
    surrounding blank space); the same summary again is a replay, another one LINE_CLOSED (a closing is never
    replaced). HISTORY_INCOMPLETE until every segment of its closing history test (history_plan, with
    `market_days`: the market's first day and the day after its latest complete day) has a history run."""
    try:
        text = summary.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise refuse("LINE_SUMMARY_INVALID", "the summary is not UTF-8", expected="UTF-8 text") from exc
    text = text.strip()
    if not text or len(summary) > SUMMARY_LIMIT:
        raise refuse("LINE_SUMMARY_INVALID", "the summary is empty or too long",
                     expected=f"1 to {SUMMARY_LIMIT} bytes of UTF-8 text")
    with db.connect(profile, "writer") as conn:
        record = read_line(conn, line)
        if record["closed"]:
            if record["summary"] == text:
                return {"line": record["name"], "line_id": record["line_id"], "closed_at": record["closed_at"],
                        "replayed": True}
            raise refuse("LINE_CLOSED", f"{record['name']} is already closed", missing=(record["name"],))
        left = [item for item in history_plan(conn, record["line_id"], *market_days)
                if item["window"] is not None and item["done"] is None]
        if left:
            raise refuse("HISTORY_INCOMPLETE", f"{len(left)} segments of the closing history test of {record['name']} "
                                               "have no history run; run `line history` first",
                         missing=tuple(f"{item['source_sha256'][:12]}:{item['label']}" for item in left[:20]))

        def insert(c, op):
            c.rows("INSERT INTO line_close (line_id, summary, op_id) VALUES (%s, %s, %s)",
                   (record["line_id"], text, op))
            return {"line_id": record["line_id"]}

        written = db.write(conn, "close_line", {"line_id": record["line_id"], "summary": text}, "line_close", insert)
        closed = read_line(conn, record["line_id"])
    return {"line": closed["name"], "line_id": closed["line_id"], "closed_at": closed["closed_at"],
            "ledger_commit": written["commit"], "replayed": written["replayed"]}
