"""The closing history test read back (`report.history`).

Every number comes from the sealed history runs (`line history`) and is derived on read; nothing is
stored. A row is a participant of a line's test, a cell one of its history runs: a calendar year before
the development period, the period again (the control, which must reproduce the research run), or the
forward segment after it. Whether a candidate meets the user's targets is read over the whole years
outside the period (plan P6): every year's mark drawdown at most the target, and the median annual
return at least the target; a segment shorter than SHORT_DAYS is shown but counted in no summary.
"""

from __future__ import annotations

from datetime import date, datetime, time
import statistics

from ledger import db, execution, lines
from ledger import targets as line_targets
from registration import reproduction
from report import measures


SHORT_DAYS = 90  # about three months
MEASURES = ("annual_return", "mark_max_drawdown", "sharpe_365", "cycles", "plan_win_rate")


def _kind(row: dict, dev_start: datetime, dev_end: datetime) -> str:
    """veto, control, holdout or forward (ledger.lines.history_segments)."""
    if row["trade_start"] >= datetime.combine(lines.holdout_end(dev_end.date()), time()):
        return "forward"
    if row["trade_start"] >= dev_end:
        return "holdout"
    if row["trade_start"] >= dev_start and row["trade_end"] == dev_end:
        return "control"
    return "veto"


def _whole_year(row: dict) -> bool:
    start = row["trade_start"]
    return (start == datetime(start.year, 1, 1)
            and row["trade_end"] == datetime(start.year + 1, 1, 1))


def _cell(conn: db.LedgerConnection, row: dict, kind: str) -> dict:
    cell = {"trial_id": row["trial_id"], "kind": kind, "label": str(row["trade_start"].year) if kind == "veto"
            else kind, "trade_start": row["trade_start"].isoformat(), "trade_end": row["trade_end"].isoformat(),
            "status": row["status"], "whole_year": kind == "veto" and _whole_year(row),
            "short": (row["trade_end"] - row["trade_start"]).days < SHORT_DAYS}
    if row["status"] == "passed":
        derived = measures.derive_measures(measures.run_facts(conn, row["trial_id"]),
                                           market={"error": "MARKET_RETURNS_UNAVAILABLE: not read for history"})
        cell["measures"] = {key: derived[key]["value"] for key in MEASURES}
    return cell


def _summary(cells: list[dict], targets: dict | None) -> dict:
    years = [cell for cell in cells if cell["whole_year"] and "measures" in cell]
    annual = [cell["measures"]["annual_return"] for cell in years if cell["measures"]["annual_return"] is not None]
    drawdown = [cell["measures"]["mark_max_drawdown"] for cell in years
                if cell["measures"]["mark_max_drawdown"] is not None]
    found = {"whole_years": len(years), "profitable_years": sum(value > 0 for value in annual),
             "median_annual_return": statistics.median(annual) if annual else None,
             "worst_annual_return": min(annual) if annual else None,
             "worst_mark_max_drawdown": max(drawdown) if drawdown else None}
    if targets is None or not years or len(annual) < len(years) or len(drawdown) < len(years):
        found["years_meeting_targets"] = found["meets_targets"] = None
        return found
    found["years_meeting_targets"] = sum(
        cell["measures"]["annual_return"] >= targets["annual_return"]
        and cell["measures"]["mark_max_drawdown"] <= targets["max_drawdown"] for cell in years)
    found["meets_targets"] = (max(drawdown) <= targets["max_drawdown"]
                              and statistics.median(annual) >= targets["annual_return"])
    return found


def _control_reproduces(conn: db.LedgerConnection, control: dict | None, run_id: int) -> bool | None:
    """The control's whole fingerprint equals the research run's (both on the run's image); None without a
    control run."""
    if control is None:
        return None
    mine = reproduction.fingerprint_hash(execution.read_capture(conn, control["trial_id"]))
    theirs = reproduction.fingerprint_hash(execution.read_capture(conn, run_id))
    return mine is not None and mine == theirs


def line_history(conn: db.LedgerConnection, line: str | int) -> dict:
    """One line's closing history test: its participants (history_participants) with their history cells and
    summaries, ordered by development-period Sharpe; the line's targets in force and its research trial count."""
    record = lines.read_line(conn, line)
    dev_start = datetime.combine(date.fromisoformat(record["dev_start"]), time())
    dev_end = datetime.combine(date.fromisoformat(record["dev_end"]), time())
    targets = line_targets.targets_for(conn, record["line_id"])
    found = lines.history_trials(conn, record["line_id"])
    rows = []
    for participant in lines.history_participants(conn, record["line_id"]):
        own = [row for row in found if row["source_sha256"] == participant["source_sha256"]]
        cells = [_cell(conn, row, _kind(row, dev_start, dev_end)) for row in own]
        control = next((row for row in own if _kind(row, dev_start, dev_end) == "control"), None)
        researched = conn.one("SELECT trial_id, trade_start, trade_end FROM trial WHERE trial_id = %s",
                              (participant["trial_id"],))
        assert researched is not None  # a participant is a run's trial
        development = _cell(conn, {**researched, "status": "passed"}, "development")
        reproduces = _control_reproduces(conn, control, participant["trial_id"])
        rows.append({"source_sha256": participant["source_sha256"], "run": participant["trial_id"],
                     "development": development, "cells": cells, "control_reproduces": reproduces,
                     "summary": _summary(cells, targets) if reproduces is not False else None})
    rows.sort(key=lambda row: (row["development"]["measures"]["sharpe_365"] is None,
                               -(row["development"]["measures"]["sharpe_365"] or 0), row["run"]))
    research = conn.one("SELECT COUNT(*) AS n FROM trial WHERE purpose = 'research' AND line_id = %s",
                        (record["line_id"],))
    return {"line": record["name"], "closed": record["closed"], "dev_start": record["dev_start"],
            "dev_end": record["dev_end"], "targets": targets, "participants": len(rows),
            "research_trials": research["n"] if research else 0, "rows": rows}


def research_history(ledger, at: str | None = None, line: str | None = None) -> dict:
    """`research history`: the closing history test of `line`, or of every line with history trials."""
    with db.read_as_of(db.profile(ledger), at) as conn:
        commit = db.head_commit(conn)
        if line is not None:
            found = [line_history(conn, line)]
        else:
            named = [name for (name,) in conn.rows(
                "SELECT DISTINCT l.name FROM research_line l JOIN trial t ON t.line_id = l.line_id "
                "WHERE t.purpose = 'history' ORDER BY l.name")]
            found = [line_history(conn, name) for name in named]
    return {"ledger_commit": commit, "short_days": SHORT_DAYS, "lines": found}
