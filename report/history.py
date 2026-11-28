"""The closing history test read back (`report.history`).

Every number comes from the sealed history runs (`line history`) and is derived on read; nothing is
stored. A row is a participant of a line's test, a cell one of its history runs: a veto segment (a year of four
quarters counted back from the development period's start, ledger.lines.history_segments), the period again (the control, which must reproduce the research run), the
two-year holdout after it, or the forward segment after the holdout. Whether a candidate meets the user's two
targets is judged on the veto years and on the holdout apart, and it meets them when both pass
(line-close-history-test-20261110.zh.md 3.7, user 2026-11-11): every whole veto year's mark drawdown at most the
target and the median annual return of those with SHORT_DAYS or more at least the target (a whole year the warm-up
leaves shorter is read on its drawdown alone, #3823); the holdout's drawdown at most the target and its annual return
at least the target. A line whose test has no whole veto year is judged on the holdout alone. A part year (cut by the
market's first day, _whole_year), another segment shorter than SHORT_DAYS and a cut holdout are shown but read in no
summary: a holdout is cut (`cut`) when it ends before the planned holdout's end or, sooner, the day after
the market's latest complete day (market_days; 20261122-20, user 2026-11-22: a `line history` run on an
earlier market day replayed part of the holdout and that part alone decided). A segment `line history` replayed again after an invalid run has one cell, its latest
run; the earlier trials are named in the cell's `superseded`.

A verdict needs every reading it is defined on (20261114-12, user 2026-11-15): a whole veto year whose run is
invalid or missing, or lacks one of the two readings, a part veto year without a passed run (20261120-01, user
2026-11-21: an audit failure in it is not left out), a control without a run, or a holdout without a countable
reading leaves the combined verdict undecided (None), and the summary's `missing` names each. A veto year the test
plans (ledger.lines.history_plan on the market's days, market_days: a segment with something left to trade) but
has not replayed yet is missing too (Gemini audit 2026-11-22: `line history --limit` or a failure leaves planned
segments without a trial, and the years present alone decided); a segment with nothing to trade is no reading. A
control that does not reproduce the research run voids the row: it has no summary. A validation registration takes
only a candidate whose verdict is decided and true (require_unfalsified, 20261120-05, user 2026-11-21).

A line's participants (ledger.lines.history_participants) are its sources with a passed research run. The test
replays and judges those whose run carries economic evidence now, the judgment `research status` reads
(report.candidates.assess_runs: a failed source review or a run without real activity takes a source out); the
others are named in `without_economic_evidence` with their reasons and no reading (20261114-13, user 2026-11-15).
The evidence is judged on read, so a source whose review fails after the test loses its row.

Picking a candidate by these readings is a choice among the line's candidates, so each holdout carries its
deflated Sharpe (measures.deflated_sharpe, the one formula `research status` also uses) with the participant count
as the number of trials and the variance of the participants' per-day holdout Sharpe ratios (3.7). Beside it,
`holdout_prior_trials` counts the searches that already looked at the holdout (roundtable 2026-11-12, 20261112-17):
counted trials (status.counted_trials) of any purpose and line on the line's instruments whose trading window overlaps
the holdout (status.overlapping_trials), leaving out the line's own history trials. Lines opened in one quarter share
a holdout, so another line's explore or closing replays count here; searches outside this ledger do not show. Each
holdout also carries its deflated Sharpe with those prior trials added to the participants as the number of trials
(`deflated_sharpe_with_prior_trials`, same variance; Claude under the user's delegation, 20261121-23).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
import math
import statistics

from collections.abc import Iterable, Mapping

from ledger import db, execution, lines, metrics
from ledger import targets as line_targets
from registration import availability, precheck, reproduction, seams as registration_seams
from report import candidates as report_candidates, measures, status
from shared.errors import Refusal
from shared.refusals import refuse


SHORT_DAYS = 90  # about three months
CAPTURES_CHUNK = 20  # runs whose captured bytes a reading holds at once
MEASURES = ("annual_return", "mark_max_drawdown", "sharpe_365", "cycles", "plan_win_rate")


def market_days(market) -> tuple[date, date]:
    """(the market's first day, the day after its latest complete day) at its newest day: the days
    ledger.lines.history_plan plans a closing history test on (`line close` requires its segments)."""
    source = registration_seams.current.market(market)
    first_day, latest = source.days(source.resolve_day(None))
    return first_day, latest + timedelta(days=1)


def _kind(row: dict, dev_start: datetime, dev_end: datetime, held: datetime) -> str:
    """veto, control, holdout or forward (ledger.lines.history_segments; `held` is the holdout's end)."""
    if row["trade_start"] >= held:
        return "forward"
    if row["trade_start"] >= dev_end:
        return "holdout"
    if row["trade_start"] >= dev_start and row["trade_end"] == dev_end:
        return "control"
    return "veto"


def _veto_year(row: dict) -> str:
    """A veto segment's year, the label of ledger.lines.history_segments: the month a year before its end."""
    return f"{lines.veto_year_start(row['trade_end'].date()):%Y-%m}"


def _whole_year(row: dict) -> bool:
    """A veto segment the market's first day did not cut (its input starts by the year's start), so one cut only by the
    warm-up is whole (#3760, #3823: else the holdout alone passed a candidate that lost its sole veto year)."""
    return row["input_start"] <= datetime.combine(lines.veto_year_start(row["trade_end"].date()), time())


def _latest(rows: list[dict], kind) -> list[dict]:
    """Each segment's latest history trial with a run (`rows` in trial order; a segment by its kind and, for a veto
    segment, its year), else its latest trial: a rerun of an invalid segment (`line history`) supersedes it. Each
    carries `superseded`, the segment's other history trials, which stay in the ledger."""
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        found = kind(row)
        groups.setdefault((found, _veto_year(row) if found == "veto" else None), []).append(row)
    chosen = []
    for group in groups.values():
        pick = ([row for row in group if row["status"] is not None] or group)[-1]
        chosen.append({**pick, "superseded": [row["trial_id"] for row in group if row is not pick]})
    return sorted(chosen, key=lambda row: row["trial_id"])


def _readings(conn: db.LedgerConnection, trial_ids: Iterable[int], holdouts: set[int]
              ) -> tuple[dict[int, dict], dict[int, list[float]], dict[int, str | None]]:
    """(MEASURES of each passed run, the trade-window daily returns of each of the `holdouts` among them, each run's
    fingerprint hash), by trial. Every captured byte is read and hash checked; a run load_run refuses raises its
    refusal."""
    ids = sorted(set(trial_ids))
    read, returns, prints = {}, {}, {}
    for at in range(0, len(ids), CAPTURES_CHUNK):
        for trial_id, loaded in metrics.load_runs(conn, ids[at:at + CAPTURES_CHUNK]).items():
            if isinstance(loaded, Refusal):
                raise loaded
            facts = measures.facts_of(loaded)
            derived = measures.derive_measures(facts, wanted=MEASURES)
            read[trial_id] = {key: derived[key]["value"] for key in MEASURES}
            prints[trial_id] = reproduction.fingerprint_hash(facts["capture"])
            if trial_id in holdouts:
                returns[trial_id] = [value for ts, value, _ in facts["returns"]
                                     if facts["trade_start_ns"] <= ts < facts["trade_end_ns"]]
    return read, returns, prints


def _fingerprints(conn: db.LedgerConnection, trial_ids: list[int]) -> dict[int, str | None]:
    """Each trial's fingerprint hash, every captured byte read and hash checked; a refused capture raises."""
    prints = {}
    for at in range(0, len(trial_ids), CAPTURES_CHUNK):
        for trial_id, capture in execution.read_captures(conn, trial_ids[at:at + CAPTURES_CHUNK]).items():
            if isinstance(capture, Refusal):
                raise capture
            prints[trial_id] = reproduction.fingerprint_hash(capture)
    return prints


def _cell(row: dict, kind: str, readings: Mapping[int, dict], holdout_until: datetime | None = None) -> dict:
    """One history run's cell with its `readings` (_readings) when it passed. A holdout is `cut` when it ends before
    `holdout_until` (the planned holdout's end, or the market's end when sooner)."""
    cell = {"trial_id": row["trial_id"], "kind": kind, "label": _veto_year(row) if kind == "veto" else kind, "trade_start": row["trade_start"].isoformat(), "trade_end": row["trade_end"].isoformat(),
            "status": row["status"], "whole_year": kind == "veto" and _whole_year(row),
            "short": (row["trade_end"] - row["trade_start"]).days < SHORT_DAYS,
            "cut": kind == "holdout" and holdout_until is not None and row["trade_end"] < holdout_until}
    if row["status"] == "passed":
        cell["measures"] = readings[row["trial_id"]]
    return cell


def _discount(rows: list[dict], returns: dict[int, list[float]], prior: int | None) -> dict:
    """The holdout deflated Sharpe of each row (in its summary's holdout) at the participant count, and
    (`deflated_sharpe_with_prior_trials`) at the participant count plus the `prior` trials that already looked at the
    holdout (None when not read), both with the sample variance of the participants' per-day holdout Sharpe ratios;
    the line's `discount` says the counts and the variance."""
    holdout = {row["run"]: next((cell["trial_id"] for cell in row["cells"] if _countable(cell)
                                 and cell["trial_id"] in returns), None) for row in rows}
    daily = [sharpe / math.sqrt(365) for trial in holdout.values() if trial is not None
             for sharpe in [measures.sharpe_365(returns[trial])] if sharpe is not None]
    variance = statistics.variance(daily) if len(daily) > 1 else None
    for row in rows:
        if row["summary"] is not None:
            trial = holdout[row["run"]]
            holdout_ = row["summary"]["holdout"]
            holdout_["deflated_sharpe"] = (
                measures.deflated_sharpe(returns[trial], len(rows), variance) if trial is not None else None)
            holdout_["deflated_sharpe_with_prior_trials"] = (
                measures.deflated_sharpe(returns[trial], len(rows) + prior, variance)
                if trial is not None and prior is not None else None)
    return {"trials": len(rows), "trials_with_prior": None if prior is None else len(rows) + prior,
            "holdouts_with_returns": len(daily), "daily_sharpe_variance": variance}


def _passes(measures: dict, targets: dict, short: bool = False) -> bool:
    return (short or measures["annual_return"] >= targets["annual_return"]) and measures["mark_max_drawdown"] <= targets["max_drawdown"]


def _read(measures: dict | None, short: bool = False) -> bool:
    """Whether a segment has the readings the targets are judged on; a `short` veto year, its passed run (_veto)."""
    return measures is not None and (short or None not in (measures["annual_return"], measures["mark_max_drawdown"]))


def _veto(cells: list[dict], targets: dict | None, planned: Iterable[str]) -> tuple[dict, list[str]]:
    """The whole veto years' counts, readings and verdict, and the years the verdict lacks (`veto YEAR`): the
    `planned` years (history_plan's veto segments with something to trade) without a history trial, whole years
    without a passed run or without one of the two readings, and part years without a passed run (an audit failure
    such as UNPROTECTED_POSITION, 20261120-01). A passed part year stays out of the readings: it is not a year.
    `whole_years` counts every whole veto year replayed, read or not; a year takes its first run with readings, so a
    trial left without a run does not hide its rerun. A `short` whole year is read on its drawdown alone, and in nothing
    without one, as a part year (#3823)."""
    years: dict[str, dict] = {}
    part: dict[str, bool] = {}
    for cell in cells:
        if cell["kind"] == "veto" and cell["whole_year"] and years.get(cell["label"], {}).get("measures") is None:
            years[cell["label"]] = cell
        elif cell["kind"] == "veto" and not cell["whole_year"]:
            part[cell["label"]] = part.get(cell["label"], False) or cell["status"] == "passed"
    read = [cell for cell in years.values()
            if cell.get("measures") is not None and not (cell["short"] and cell["measures"]["mark_max_drawdown"] is None)]
    annual = [cell["measures"]["annual_return"] for cell in read
              if not cell["short"] and cell["measures"]["annual_return"] is not None]
    drawdown = [cell["measures"]["mark_max_drawdown"] for cell in read if cell["measures"]["mark_max_drawdown"] is not None]
    replayed = {cell["label"] for cell in cells if cell["kind"] == "veto"}
    missing = sorted([*(f"veto {year}" for year, cell in years.items() if not _read(cell.get("measures"), cell["short"])),
                      *(f"veto {year}" for year, passed in part.items() if not passed),
                      *(f"veto {year}" for year in set(planned) - replayed)])
    found = {"whole_years": len(years), "profitable_years": sum(value > 0 for value in annual),
             "median_annual_return": statistics.median(annual) if annual else None,
             "worst_annual_return": min(annual) if annual else None,
             "worst_mark_max_drawdown": max(drawdown) if drawdown else None}
    if targets is None or not years or missing:
        found["years_meeting_targets"] = found["meets_targets"] = None
        return found, missing
    found["years_meeting_targets"] = sum(_passes(cell["measures"], targets, cell["short"]) for cell in read)
    found["meets_targets"] = (all(value <= targets["max_drawdown"] for value in drawdown)
                              and (not annual or statistics.median(annual) >= targets["annual_return"]))
    return found, missing


def _countable(cell: dict) -> bool:
    """A holdout cell a summary reads: SHORT_DAYS or more and not cut (_cell)."""
    return cell["kind"] == "holdout" and not cell["short"] and not cell.get("cut", False)


def _holdout(cells: list[dict], targets: dict | None) -> tuple[dict, list[str]]:
    """The holdout's readings and verdict, and `holdout` when the verdict lacks them: no passed holdout run of
    SHORT_DAYS or more that is not cut (_countable), or one without one of the two readings."""
    measures = next((cell["measures"] for cell in cells if _countable(cell) and "measures" in cell), None)
    found = {"annual_return": measures["annual_return"] if measures else None,
             "mark_max_drawdown": measures["mark_max_drawdown"] if measures else None}
    found["meets_targets"] = (_passes(measures, targets)
                              if measures is not None and _read(measures) and targets is not None else None)
    return found, [] if _read(measures) else ["holdout"]


def _summary(cells: list[dict], targets: dict | None, control: bool, planned: Iterable[str]) -> dict:
    """The veto and holdout verdicts and the combined one (`planned`: the veto years the test plans, _veto).
    `missing` names what the combined verdict lacks, in the order veto years, `control` (no control run: `control`
    False), `holdout`, and `targets` for a line without any; with anything missing it is undecided (meets_targets
    and judged_on None). Otherwise `judged_on` names what it read: both, or the holdout alone when the test has no
    whole veto year."""
    (veto, years), (holdout, held) = _veto(cells, targets, planned), _holdout(cells, targets)
    missing = [*years, *([] if control else ["control"]), *held, *(["targets"] if targets is None else [])]
    if missing:
        meets, judged = None, None
    elif veto["whole_years"] == 0:
        meets, judged = holdout["meets_targets"], "holdout"
    else:
        meets, judged = veto["meets_targets"] and holdout["meets_targets"], "veto and holdout"
    return {"veto": veto, "holdout": holdout, "meets_targets": meets, "judged_on": judged, "missing": missing}


def _control_reproduces(prints: Mapping[int, str | None], control: dict | None, run_id: int) -> bool | None:
    """The control's whole fingerprint equals the research run's (both on the run's image), from their hashes; None
    without a control run (no control trial, or one an interrupted test left without a run: #3761)."""
    if control is None or control["status"] is None:
        return None
    mine = prints[control["trial_id"]]
    return mine is not None and mine == prints[run_id]


def _prior_trials(conn: db.LedgerConnection, line_id: int, dev_end: datetime, end: datetime, own: set[int],
                  counted: list[dict]) -> dict | None:
    """`holdout_prior_trials`: the counted trials on the line's instruments (status.line_instruments) whose trading
    window overlaps [dev_end, end), the holdout, the line's own history trials (`own`) left out, by line (null for a
    trial on none) and purpose; None before the line's first research trial."""
    instruments = status.line_instruments(conn, line_id)
    if instruments is None:
        return None
    found = [trial["trial_id"] for trial in status.overlapping_trials(counted, instruments, dev_end, end)
             if trial["trial_id"] not in own]
    groups: dict[tuple, int] = {}
    for name, purpose in conn.rows_in("SELECT l.name, t.purpose FROM trial t LEFT JOIN research_line l "
                                      "ON l.line_id = t.line_id WHERE t.trial_id IN ()", found):
        groups[(name, purpose)] = groups.get((name, purpose), 0) + 1
    return {"trials": len(found), "instruments": sorted(instruments),
            "by_line": [{"line": name, "purpose": purpose, "trials": n} for (name, purpose), n in
                        sorted(groups.items(), key=lambda item: (item[0][0] is None, item[0]))]}


def candidates(conn: db.LedgerConnection, line_id: int, checker: Mapping | None = None,
               records: list | None = None) -> tuple[list[dict], list[dict]]:
    """A line's history participants (lines.history_participants) by the economic evidence of the research run each
    is replayed from, judged now as `research status` judges it (report.candidates.assess_runs): those with it, the
    candidates the test replays and judges, and those without, as {source_sha256, candidate (ID@N), run, reasons}.
    `checker` (availability.check_identity) and `records` (precheck.review_records) are what a caller reading
    several lines reads once."""
    participants = lines.history_participants(conn, line_id)
    assessed = report_candidates.assess_runs(
        conn, [item["trial_id"] for item in participants],
        availability.check_identity() if checker is None else checker,
        precheck.review_records(conn) if records is None else records)
    names = {sha: f"{strategy}@{revision}" for sha, strategy, revision in conn.rows(
        "SELECT source_sha256, strategy_id, revision FROM candidate")}
    kept, without = [], []
    for item in participants:
        value = assessed[item["trial_id"]]
        if value["economic_evidence_available"]:
            kept.append({**item, "candidate": names.get(item["source_sha256"])})
        else:
            without.append({"source_sha256": item["source_sha256"], "candidate": names.get(item["source_sha256"]),
                            "run": item["trial_id"], "reasons": value["reasons"]})
    return kept, without


def qualified(conn: db.LedgerConnection, line_id: int) -> list[dict]:
    """The candidates alone (candidates): the participants `line history` replays and `line close` requires."""
    return candidates(conn, line_id)[0]


def line_history(conn: db.LedgerConnection, line: str | int, counted: list[dict] | None, checker: Mapping,
                 records: list, days: tuple[date, date]) -> dict:
    """One line's closing history test: its candidates (candidates) with their history cells and summaries,
    ordered by development-period Sharpe, and the participants without economic evidence; the line's targets in
    force, its research trial count and the earlier searches of its holdout among `counted`
    (status.counted_trials' counted trials; None: not read, `holdout_prior_trials` None). `days` (market_days) are
    the market days the test is planned on."""
    record = lines.read_line(conn, line)
    dev_start, dev_end = lines.dev_window(record)
    held = datetime.combine(lines.holdout_end(dev_end.date()), time())
    holdout_until = min(held, datetime.combine(days[1], time()))
    targets = line_targets.targets_for(conn, record["line_id"])
    found = lines.history_trials(conn, record["line_id"])
    rows: list[dict] = []
    kept, without = candidates(conn, record["line_id"], checker, records)
    planned: dict[str, list[str]] = {}
    for item in lines.history_plan(conn, record["line_id"], *days, kept):
        if item["kind"] == "veto" and item["window"] is not None:
            planned.setdefault(item["source_sha256"], []).append(item["label"])

    def kind(row: dict) -> str:
        return _kind(row, dev_start, dev_end, held)

    segments = {participant["source_sha256"]: _latest(
        [row for row in found if row["source_sha256"] == participant["source_sha256"]], kind) for participant in kept}
    controls = {sha: next((row for row in own if kind(row) == "control"), None) for sha, own in segments.items()}
    researched = {row["trial_id"]: {**row, "status": "passed"} for row in conn.rows_in(
        "SELECT trial_id, trade_start, trade_end FROM trial WHERE trial_id IN ()",
        [participant["trial_id"] for participant in kept], dicts=True)}
    passed = [row for own in segments.values() for row in own if row["status"] == "passed"]
    readings, returns, prints = _readings(conn, [*researched, *(row["trial_id"] for row in passed)],
                                          {row["trial_id"] for row in passed if kind(row) == "holdout"})
    prints.update(_fingerprints(conn, [control["trial_id"] for control in controls.values()
                                       if control is not None and control["status"] is not None
                                       and control["trial_id"] not in prints]))
    for participant in kept:
        own, control = segments[participant["source_sha256"]], controls[participant["source_sha256"]]
        cells = [{**_cell(row, kind(row), readings, holdout_until), "superseded": row["superseded"]} for row in own]
        development = _cell(researched[participant["trial_id"]], "development", readings)
        reproduces = _control_reproduces(prints, control, participant["trial_id"])
        rows.append({"source_sha256": participant["source_sha256"], "candidate": participant["candidate"],
                     "run": participant["trial_id"],
                     "development": development, "cells": cells, "control_reproduces": reproduces,
                     "summary": None if reproduces is False else _summary(
                         cells, targets, reproduces is True, planned.get(participant["source_sha256"], ()))})
    rows.sort(key=lambda row: (row["development"]["measures"]["sharpe_365"] is None,
                               -(row["development"]["measures"]["sharpe_365"] or 0), row["run"]))
    prior = None if counted is None else _prior_trials(
        conn, record["line_id"], dev_end, held, {row["trial_id"] for row in found}, counted)
    discount = _discount(rows, returns, None if prior is None else prior["trials"])
    research = conn.one("SELECT COUNT(*) AS n FROM trial WHERE purpose = 'research' AND line_id = %s",
                        (record["line_id"],))
    return {"line": record["name"], "closed": record["closed"], "dev_start": record["dev_start"],
            "dev_end": record["dev_end"], "targets": targets, "participants": len(rows),
            "research_trials": research["n"] if research else 0, "discount": discount,
            "holdout_prior_trials": prior,
            "rows": rows, "without_economic_evidence": without}


def verdict(source_sha256: str, tested: list[dict]) -> dict:
    """The closing history test's verdict on one source from the readings (line_history) of the lines that tested it
    (`tested`): {line, judged_on} of a line that judged it meeting the targets, else a refusal. CANDIDATE_FALSIFIED
    when a line judged it not meeting them (meets_targets false); HISTORY_UNDECIDED when no line decided it, its
    `missing` naming per line what the verdict lacks: the summary's `missing`, `control` for a control that does not
    reproduce the research run (no summary), `economic evidence` for a source the test no longer judges; or
    `line history` when no line has a history trial of it."""
    undecided: list[str] = []
    passed = None
    for found in tested:
        row = next((row for row in found["rows"] if row["source_sha256"] == source_sha256), None)
        if row is None:
            undecided.append(f"{found['line']}: economic evidence")
        elif row["summary"] is None:
            undecided.append(f"{found['line']}: control")
        elif row["summary"]["meets_targets"] is False:
            raise refuse("CANDIDATE_FALSIFIED", f"{row['candidate']} does not meet the targets of {found['line']} in "
                                                f"its closing history test (judged on the {row['summary']['judged_on']})",
                         missing=(found["line"],))
        elif row["summary"]["meets_targets"] is None:
            undecided += [f"{found['line']}: {item}" for item in row["summary"]["missing"]]
        elif passed is None:
            passed = {"line": found["line"], "judged_on": row["summary"]["judged_on"]}
    if passed is None:
        missing = tuple(undecided) or ("line history",)
        raise refuse("HISTORY_UNDECIDED", "the closing history test has not decided this candidate: "
                                          + "; ".join(missing), missing=missing)
    return passed


def require_unfalsified(conn: db.LedgerConnection, source_sha256: str, market) -> dict:
    """verdict() over every line with a history trial of this source, read on `conn` with the test planned on
    `market`'s days (market_days, read only when such a line exists): a validation registration takes only a
    candidate that its line's closing history test decided and did not falsify (20261120-05, user 2026-11-21)."""
    named = [line_id for (line_id,) in conn.rows(
        "SELECT DISTINCT line_id FROM trial WHERE purpose = 'history' AND source_sha256 = %s ORDER BY line_id",
        (source_sha256,))]
    tested = []
    if named:
        checker, records, days = availability.check_identity(), precheck.review_records(conn), market_days(market)
        tested = [line_history(conn, line_id, None, checker, records, days) for line_id in named]
    return verdict(source_sha256, tested)


def research_history(ledger, market, at: str | None = None, line: str | None = None) -> dict:
    """`research history`: the closing history test of `line`, or of every line with history trials, planned on
    `market`'s days (market_days, read only when there is a line to read)."""
    with db.read_as_of(db.profile(ledger), at) as conn:
        commit = db.head_commit(conn)
        counted = status.counted_trials(conn)["counted"]
        checker, records = availability.check_identity(), precheck.review_records(conn)
        named: list[str] = [line] if line is not None else [name for (name,) in conn.rows(
            "SELECT DISTINCT l.name FROM research_line l JOIN trial t ON t.line_id = l.line_id "
            "WHERE t.purpose = 'history' ORDER BY l.name")]
        found = []
        if named:
            days = market_days(market)
            found = [line_history(conn, name, counted, checker, records, days) for name in named]
    return {"ledger_commit": commit, "short_days": SHORT_DAYS, "lines": found}
