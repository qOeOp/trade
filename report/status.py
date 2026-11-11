"""Research facts and the research state (`report.research_status`, `report.research_state`).

Counts are read from the ledger at an exact version, never from what an Agent remembers; the state
puts the current judgments beside read-time facts and the trials no review has covered yet. Nothing
carries a stop flag, target, score, ranking or eligibility mark; nothing is written. A run whose
stored records do not verify counts as diagnostic only, with its reason; it does not stop a count.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import date, datetime, time
import hashlib
import json
import math
import statistics

import numpy as np

from ledger import db, evidence, execution, judgments, lines, metrics, problems, witness
from ledger import targets as line_targets
from shared.errors import Refusal
from registration import availability, comparability, precheck, register, reproduction
from report import candidates as report_candidates, comparison, measures, seams
from runtime import image


SINGLE_KINDS = ("recommendation", "priority")
MANY_KINDS = ("interpretation", "search_exposure")
# The comparison table's measures (the single-run report's), and those where less is better.
TABLE_MEASURES = ("annual_return", "mark_max_drawdown", "sharpe_365", "plan_win_rate")
LOWER_IS_BETTER = ("mark_max_drawdown",)
IDENTITY_COLUMNS = ("trial_id, purpose, source_sha256, runtime_contract, execution, comparable_config_sha256, "
                    f"export_sha256, input_start, trade_start, trade_end, {db.IMAGE_DIGEST}")


def _key(row: Mapping) -> str:
    """The hash of a trial's comparable identity (registration.comparable_identity)."""
    identity = {key: None if value is None else str(value)
                for key, value in comparability.comparable_identity(row).items()}
    return hashlib.sha256(db.canonical_json(identity).encode("utf-8")).hexdigest()


def _identities(conn: db.LedgerConnection, wanted: Iterable[int] | None = None) -> dict[int, dict | None]:
    """The execution identity of every trial, by trial ID: its runtime contract, execution and image digest,
    and `keys`: the hash of what registration.check_comparable compares (the trial row's comparable
    identity) and those of the trial's exact reproductions, looked for only among `wanted` trials when
    given (a caller that reads no other trial's keys). Runs compare only under one key."""
    rows = conn.dicts(f"SELECT {IDENTITY_COLUMNS} FROM trial ORDER BY trial_id")
    identities: dict[int, dict | None] = {
        row["trial_id"]: {"runtime_contract": row["runtime_contract"], "execution": row["execution"],
                          "image_digest": row["image_digest"], "keys": [_key(row)]} for row in rows}
    kept = None if wanted is None else set(wanted)
    by_source: dict[str, list[int]] = {}
    for row in rows:
        if row["purpose"] in ("research", "validation") and (kept is None or row["trial_id"] in kept):
            by_source.setdefault(row["source_sha256"], []).append(row["trial_id"])
    matches = reproduction.matcher(conn)
    for row in rows:
        if row["purpose"] != "explore":
            continue
        for original in by_source.get(row["source_sha256"], ()):
            identity, reproducing = identities[original], identities[row["trial_id"]]
            if identity is not None and reproducing is not None and matches(row["trial_id"], original):
                identity["keys"].append(reproducing["keys"][0])
    return identities


def line_identity(conn: db.LedgerConnection, line: str | int, identities: Mapping[int, dict | None]) -> dict | None:
    """The execution identity of a research line: that of its latest research trial (ledger.line_trials),
    None before the first. A contract or execution change ends a line; within one, a rebuilt image
    replaces the identity (research-round's changes.md)."""
    own = [identities.get(trial_id) for trial_id in lines.line_trials(conn, line)["trials"]]
    own = [identity for identity in own if identity is not None]
    return own[-1] if own else None


def _same(identity: Mapping | None, other: Mapping | None) -> bool:
    return identity is not None and other is not None and bool(set(identity["keys"]) & set(other["keys"]))


def failure_stages(data: bytes) -> set[str] | None:
    """The stages of runtime failure receipt bytes; None when a line is no structured receipt."""
    stages = set()
    for line in data.decode("utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except ValueError:
            return None
        if not isinstance(item, dict) or not isinstance(item.get("stage"), str):
            return None
        stages.add(item["stage"])
    return stages


def stopped_before_strategy(capture: Mapping | None, failures: bytes | None) -> bool:
    """Whether a sealed capture (execution.read_capture's `stages`, `outcome` and `statuses`) shows the runner
    stopped before any strategy result existed: the replay completed on the host, the native runner exited
    nonzero without writing its summary, and every runtime failure it recorded (if any) is of a stage before
    the strategy trades (binding, load, inputs: problems.PRE_STRATEGY_STAGES)."""
    if not isinstance(capture, Mapping):
        return False
    statuses = capture.get("statuses")
    if not isinstance(statuses, Mapping):
        statuses = {}
    recorded = capture.get("stages")
    native = recorded.get("native") if isinstance(recorded, Mapping) else None
    exited = (isinstance(native, Mapping) and native.get("state") == "exited" and isinstance(native.get("exit_code"), int)
              and native["exit_code"] != 0)
    if (not exited or (capture.get("outcome") or {}).get("kind") != "completed"
            or statuses.get(problems.SUMMARY) in ("captured", "hashed")):
        return False
    stages = failure_stages(failures) if failures else set()
    return stages is not None and stages <= problems.PRE_STRATEGY_STAGES


def _stopped(conn: db.LedgerConnection) -> set[int]:
    """The trials stopped_before_strategy holds, from the trial_capture and trial_file rows and only the runtime
    failure receipts of the captures that can qualify, each hash checked; an unreadable receipt counts the trial."""
    found: dict[int, dict] = {}
    for row in conn.dicts("SELECT c.trial_id, c.native_state, c.native_exit_code, c.outcome_kind, s.status AS summary, "
                          "f.status AS failures FROM trial_capture c LEFT JOIN trial_file s ON s.trial_id = c.trial_id "
                          "AND s.path = %s LEFT JOIN trial_file f ON f.trial_id = c.trial_id AND f.path = %s "
                          "WHERE c.outcome_kind = 'completed' AND c.native_state = 'exited' AND c.native_exit_code <> 0",
                          (problems.SUMMARY, execution.RUNTIME_ERRORS)):
        found[row["trial_id"]] = row
    receipts: dict[int, bytes | None] = {}
    named = [f"trial-{trial_id}-capture" for trial_id, row in found.items() if row["failures"] == "captured"]
    for at in range(0, len(named), execution.BATCH):
        chunk = tuple(named[at:at + execution.BATCH])
        for bundle, content, stored in conn.rows(f"SELECT e.bundle, c.content, e.sha256 FROM {evidence.FILES_FROM} "
                                                 f"WHERE e.bundle IN ({', '.join(['%s'] * len(chunk))}) AND e.path = %s",
                                                 (*chunk, execution.RUNTIME_ERRORS)):
            content = bytes(content)
            receipts[int(bundle.split("-")[1])] = content if hashlib.sha256(content).hexdigest() == stored else None
    stopped = set()
    for trial_id, row in found.items():
        capture = {"stages": {"native": {"state": row["native_state"], "exit_code": row["native_exit_code"]}},
                   "outcome": {"kind": row["outcome_kind"]}, "statuses": {problems.SUMMARY: row["summary"]}}
        failures = None
        if row["failures"] == "captured":
            failures = receipts.get(trial_id)
            if failures is None:
                continue  # unreadable receipts: the trial counts
        if stopped_before_strategy(capture, failures):
            stopped.add(trial_id)
    return stopped


def counted_trials(conn: db.LedgerConnection) -> dict:
    """The trials that count as tests of a strategy, and the ones that do not (user decision
    2026-10-20): a reproduction (an explore trial replaying an earlier trial that has a run, with the
    same source, image digest, windows, instruments, export content and comparable configuration, or one
    reproduction.matches)
    and a trial the product stopped before the strategy ran (stopped_before_strategy). Derived from the
    stored trial, instrument and capture rows; nothing is marked. Each counted trial carries its
    `instruments` (a list of instrument IDs)."""
    trials = conn.dicts(f"SELECT t.trial_id, t.purpose, t.source_sha256, {db.TRIAL_IMAGE_DIGEST}, t.export_sha256, "
                        "t.comparable_config_sha256, t.input_start, t.trade_start, t.trade_end, r.status FROM trial t LEFT JOIN run r "
                        "ON r.trial_id = t.trial_id ORDER BY t.trial_id")
    instruments: dict[int, list[str]] = {}
    for trial_id, symbol in conn.rows("SELECT trial_id, instrument_id FROM trial_instrument "
                                      "ORDER BY trial_id, instrument_id"):
        instruments.setdefault(trial_id, []).append(symbol)
    stopped_ids = _stopped(conn)
    matches = reproduction.matcher(conn)
    # Earlier trials by identity, filled in trial-ID order, so each trial looks only at its own bucket.
    with_run: set[tuple] = set()
    by_source: dict[tuple, list[int]] = {}
    reproductions, stopped, counted = [], [], []
    for trial in trials:
        trial_id = trial["trial_id"]
        trial["instruments"] = instruments.get(trial_id, [])
        identity = (trial["source_sha256"], trial["image_digest"], tuple(trial["instruments"]), trial["input_start"],
                    trial["trade_start"], trial["trade_end"])
        source = (identity[0], *identity[2:])
        # CF-09: an explore that changes only the configuration (--leverage, --starting-balance) is a new test.
        exact = (*identity, trial["export_sha256"], trial["comparable_config_sha256"])
        reproduced = trial["purpose"] == "explore" and (
            exact in with_run
            or any(matches(trial_id, earlier) for earlier in by_source.get(source, ())))
        by_source.setdefault(source, []).append(trial_id)
        if trial["status"] is not None:
            with_run.add(exact)
        if reproduced:
            reproductions.append(trial_id)
        elif trial_id in stopped_ids:
            stopped.append(trial_id)
        else:
            counted.append(trial)
    return {"counted": counted, "reproductions": reproductions, "stopped_before_strategy": stopped}


def research_status(ledger, at: str | None = None, line: str | None = None) -> dict:
    """Research fact counts at a ledger version: trials, versions, registration attempts by outcome and
    out-of-sample registrations; only counts, versions and the checker identity. `trials` and
    `multiple_testing` leave out reproductions and trials stopped before the strategy ran, listed in
    `excluded_trials`. `comparison` is the comparison table and `multiple_testing` the
    multiple-testing reading of the line named `line` (default: the only open line; both null when no
    line or several lines are open). The research attempts and their outcomes are those of `lines`: the
    line named, else the open lines (L11: a closed line is read when named); a run is assessed for economic
    evidence only when one of them, or the multiple-testing reading, needs it."""
    checker = availability.check_identity()
    with db.read_as_of(db.profile(ledger), at) as conn:
        commit = db.head_commit(conn)
        records = precheck.review_records(conn)
        found = counted_trials(conn)
        excluded = {"reproductions": found["reproductions"],
                    "stopped_before_strategy": found["stopped_before_strategy"]}
        opened = lines.open_lines(conn)
        scope = [lines.read_line(conn, line)["name"]] if line is not None else opened
        attempts = conn.dicts("SELECT t.research_registration_id, t.trial_id, r.status FROM trial t JOIN research_line l "
                              "ON l.line_id = t.line_id LEFT JOIN run r ON r.trial_id = t.trial_id WHERE "
                              "t.research_registration_id IS NOT NULL AND l.name IN (" + ",".join(["%s"] * len(scope))
                              + ") ORDER BY t.trial_id", tuple(scope)) if scope else []
        assessed: dict[int, dict] = {}

        def assess(trial_ids: list[int]) -> dict[int, dict]:
            """Each passed run's economic-evidence assessment, each run loaded and assessed once."""
            todo = [trial_id for trial_id in trial_ids if trial_id not in assessed]
            loaded = metrics.load_runs(conn, todo, series=False, listing=True) if todo else {}
            for trial_id in todo:
                assessed[trial_id] = report_candidates.assess_listed(conn, trial_id, checker, records, loaded[trial_id])
            return {trial_id: assessed[trial_id] for trial_id in trial_ids}

        counted = {"unfinished": 0, "invalid": 0, "passed": 0, "valid": 0, "diagnostic": 0}
        unverified = []
        passed = assess([row["trial_id"] for row in attempts if row["status"] not in (None, "invalid")])
        for row in attempts:
            if row["status"] is None:
                counted["unfinished"] += 1
            elif row["status"] == "invalid":
                counted["invalid"] += 1
            else:
                counted["passed"] += 1
                reading = passed[row["trial_id"]]
                if reading.get("unverified_records"):
                    unverified.append({"trial_id": row["trial_id"], "reason": reading["reasons"][0]})
                counted["valid" if reading["economic_evidence_available"] else "diagnostic"] += 1

        def available(trial_ids: list[int]) -> set[int]:
            return {trial_id for trial_id, reading in assess(trial_ids).items()
                    if reading["economic_evidence_available"]}
        registrations = [registration_id for (registration_id,) in conn.rows(
            "SELECT registration_id FROM validation_registration ORDER BY registration_id")]
        (bound,), = conn.rows("SELECT COUNT(*) FROM trial WHERE validation_registration_id IS NOT NULL")
        unwitnessed = sum(_stamp(conn, registration_id) is None for registration_id in registrations)
        line = line or (opened[0] if len(opened) == 1 else None)
        testing = multiple_testing(conn, line, found["counted"], available) if line is not None else None
        table = comparison_table(conn, line, checker, records, testing) if line is not None else None
    return {"ledger_commit": commit, "trials": len(found["counted"]), "multiple_testing": testing,
            "excluded_trials": excluded, "lines": scope,
            "research_attempts": len(attempts), "audit_passed_research_runs": counted["passed"],
            "valid_research_runs": counted["valid"], "diagnostic_only_research_runs": counted["diagnostic"],
            "invalid_research_runs": counted["invalid"], "unfinished_research_attempts": counted["unfinished"],
            "validation": {"registered": len(registrations), "bound": bound, "unbound": len(registrations) - bound,
                           "unwitnessed": unwitnessed},
            "unverified_runs": unverified, "availability_checker": checker,
            "product_commit": checker["product_commit"], "comparison": table}


# The multiple-testing reading

def _contracts(value) -> set[str]:
    """The instrument IDs of a counted trial (counted_trials' `instruments`)."""
    return {item for item in value if isinstance(item, str)} if isinstance(value, (list, tuple)) else set()


def _window(line: Mapping) -> tuple[datetime, datetime]:
    """A line's development window [dev_start, dev_end) as trial-row trading-window datetimes."""
    return (datetime.combine(date.fromisoformat(line["dev_start"]), time()),
            datetime.combine(date.fromisoformat(line["dev_end"]), time()))


def overlapping_trials(trials: Iterable[Mapping], instruments: set[str], start: datetime, end: datetime) -> list:
    """The trials that traded one of `instruments` in a trading window overlapping [start, end): of
    every purpose, market commit and line, since each looked at the same contract and period."""
    return [trial for trial in trials if trial["trade_start"] < end and start < trial["trade_end"]
            and _contracts(trial["instruments"]) & instruments]


CANCELLATION = 1e-4  # a centred sum of squares under this share of its raw sum has lost over 4 digits
BLOCK = 256  # series whose pairs one set of matrix products reads (memory grows with it times the series)


def mean_correlation(series: Sequence[Mapping[int, float]]) -> float | None:
    """The mean Pearson correlation of every pair of daily return series, each pair over the days both
    hold; a pair with fewer than two common days, or constant on them, is left out. None without a pair.
    Each pair's common-day sums come from matrix products over BLOCK series at a time; a pair where
    centring cancels nearly all of a side's sum of squares (a side close to constant) is centred again
    on its own common-day means."""
    days = sorted(set().union(*series))
    column = {day: index for index, day in enumerate(days)}
    values = np.zeros((len(series), len(days)))
    held = np.zeros((len(series), len(days)))
    for row, found in enumerate(series):
        columns = [column[day] for day in found]
        values[row, columns] = list(found.values())
        held[row, columns] = 1.0
    squared = values * values
    correlations: list[np.ndarray] = []
    for start in range(0, len(series), BLOCK):
        rows = slice(start, start + BLOCK)
        count = held[rows] @ held.T
        later = (np.arange(len(series))[None, :] > np.arange(start, start + count.shape[0])[:, None]) & (count >= 2)
        first, second = np.nonzero(later)
        count = count[later]
        x, y = (values[rows] @ held.T)[later], (held[rows] @ values.T)[later]  # each side summed over the common days
        xx, yy = (squared[rows] @ held.T)[later], (held[rows] @ squared.T)[later]
        sxy = (values[rows] @ values.T)[later] - x * y / count
        sxx, syy = xx - x * x / count, yy - y * y / count
        for at in np.flatnonzero((sxx <= CANCELLATION * xx) | (syy <= CANCELLATION * yy)):
            common = (held[start + first[at]] * held[second[at]]).astype(bool)
            a = np.where(common, values[start + first[at]], 0.0)
            b = np.where(common, values[second[at]], 0.0)
            a, b = np.where(common, a - a.sum() / count[at], 0.0), np.where(common, b - b.sum() / count[at], 0.0)
            sxy[at], sxx[at], syy[at] = (a * b).sum(), (a * a).sum(), (b * b).sum()
        kept = (sxx > 0) & (syy > 0)
        correlations.append(sxy[kept] / np.sqrt(sxx[kept] * syy[kept]))
    pairs = np.concatenate(correlations).tolist() if correlations else []
    return statistics.fmean(pairs) if pairs else None


def effective_trials(correlation: float | None, trials: int) -> float | None:
    """Bailey & López de Prado (2014, eq. 9)'s number of independent trials among `trials` correlated
    ones of mean correlation ρ: ρ + (1 − ρ)·trials. A negative mean is taken as zero (independent
    trials), so the number never exceeds `trials`. None without a correlation."""
    if correlation is None or trials < 1:
        return None
    rho = min(max(correlation, 0.0), 1.0)
    return rho + (1 - rho) * trials


def _overlapping_line(conn: db.LedgerConnection, line: str | int, counted: Iterable[Mapping]) -> tuple | None:
    """A line's record, the instruments of its research trials and the counted trials that traded one
    of them in a window overlapping its development window; None before its first research trial."""
    record = lines.read_line(conn, line)
    own = lines.line_trials(conn, record["line_id"])["trials"]
    if not own:
        return None
    instruments = {symbol for (symbol,) in conn.rows(
        "SELECT DISTINCT instrument_id FROM trial_instrument WHERE trial_id IN (" + ",".join(["%s"] * len(own)) + ")",
        tuple(own))}
    start, end = _window(record)
    return record, instruments, overlapping_trials(counted, instruments, start, end)


def trial_counts(conn: db.LedgerConnection, line: str | int, counted: Iterable[Mapping]) -> dict | None:
    """The counts of multiple_testing alone, which need no return series: `research_trials` and
    `all_purpose_trials`. Null before the line's first research trial."""
    overlap = _overlapping_line(conn, line, counted)
    if overlap is None:
        return None
    found = overlap[2]
    return {"research_trials": sum(trial["purpose"] == "research" for trial in found), "all_purpose_trials": len(found)}


def multiple_testing(conn: db.LedgerConnection, line: str | int, counted: Iterable[Mapping],
                     available: Callable[[list[int]], set[int]]) -> dict | None:
    """The trials behind a line's runs: the counted trials (counted_trials) that traded one of the
    instruments of the line's research trials in a trading window overlapping the line's development
    window, across market commits and lines (`research_trials`; `all_purpose_trials` adds precheck,
    explore and validation trials). From the trade-window daily returns of the overlapping research
    runs with economic evidence (`available`) whose returns vary (`runs_with_returns`): the mean
    pairwise correlation over common days (`mean_correlation`), the independent trials it leaves of
    research_trials (`effective_trials`) and the sample variance of their daily Sharpe ratios
    (`daily_sharpe_variance`), so the counts and the variance come from one population.

    Every stored series is UTC daily, so each run's Sharpe is the report's sharpe_365 over its own
    trade-window days divided by sqrt(365): a per-day Sharpe whatever the window's length, which
    enters a deflated Sharpe only through the tested run's own day count. Null before the line's
    first research trial; nothing is stored."""
    overlap = _overlapping_line(conn, line, counted)
    if overlap is None:
        return None
    record, instruments, found = overlap
    research = [trial for trial in found if trial["purpose"] == "research"]
    evidenced = available([trial["trial_id"] for trial in research if trial["status"] not in (None, "invalid")])
    bounds = {trial["trial_id"]: (metrics.moment_ns(trial["trade_start"]), metrics.moment_ns(trial["trade_end"]))
              for trial in research if trial["trial_id"] in evidenced}
    series: dict[int, dict[int, float]] = {trial_id: {} for trial_id in bounds}
    if bounds:
        for trial_id, ts, value in conn.rows("SELECT trial_id, ts_event_ns, native_return FROM run_return WHERE "
                                             "trial_id IN (" + ",".join(["%s"] * len(bounds)) + ")", tuple(bounds)):
            if bounds[trial_id][0] <= int(ts) < bounds[trial_id][1]:
                series[trial_id][int(ts)] = float(value)
    daily: dict[int, float] = {}
    for trial_id, days in sorted(series.items()):
        sharpe = measures.sharpe_365([days[day] for day in sorted(days)])
        if sharpe is not None:
            daily[trial_id] = sharpe / math.sqrt(365)
    correlation = mean_correlation([series[trial_id] for trial_id in daily])
    return {"line": record["name"], "dev_start": record["dev_start"], "dev_end": record["dev_end"],
            "instruments": sorted(instruments), "research_trials": len(research), "all_purpose_trials": len(found),
            "runs_with_returns": len(daily), "mean_correlation": correlation,
            "effective_trials": effective_trials(correlation, len(research)),
            "daily_sharpe_variance": statistics.variance(daily.values()) if len(daily) > 1 else None}


def _stamp(conn: db.LedgerConnection, registration_id: int):
    """The verified witness of a validation registration, None without one or with a token that does not verify."""
    try:
        return witness.registration_stamp(conn, registration_id)
    except Refusal:
        return None


# The comparison table

def _headline(facts: Mapping, names) -> dict:
    """The named measures of one run (its measures.run_facts) as its single-run report gives them
    (report.derive_measures)."""
    derived = measures.derive_measures(facts, market={"error": "MARKET_RETURNS_UNAVAILABLE: not read for the state"})
    return {name: derived[name] for name in names}


def _passed_research_runs(conn: db.LedgerConnection, checker: Mapping, records: list,
                          window: tuple[datetime, datetime] | None = None, universe_rule: object = None,
                          line_ids: Sequence[int] | None = None) -> tuple[list[dict], list[dict]]:
    """(with, without) economic evidence: every passed research run in trial order, as {candidate, trial_id,
    trade_start, trade_end, universe_rule} (`without` adds the reasons). With `window`, only runs of that trading
    window and `universe_rule`: a line's comparison table. With `line_ids`, only the runs of those lines. The one
    population the comparison table and `research runs` read."""
    found, excluded, rows = [], [], []
    on = "" if line_ids is None else f" AND t.line_id IN ({', '.join(['%s'] * len(line_ids))})"
    if line_ids is not None and not line_ids:
        return [], []
    for row in conn.dicts("SELECT r.trial_id, t.trade_start, t.trade_end, t.universe_rule, c.strategy_id, c.revision "
                          "FROM run r "
                          "JOIN trial t ON t.trial_id = r.trial_id JOIN candidate c ON c.source_sha256 = "
                          f"t.source_sha256 WHERE t.purpose = 'research' AND r.status = 'passed'{on} ORDER BY r.trial_id",
                          tuple(line_ids or ())):
        if window is None or ((row["trade_start"], row["trade_end"]) == window and row["universe_rule"] == universe_rule):
            rows.append(row)
    loaded = metrics.load_runs(conn, [row["trial_id"] for row in rows], series=False, listing=True)
    for row in rows:
        assessed = report_candidates.assess_listed(conn, row["trial_id"], checker, records, loaded[row["trial_id"]])
        item = {"candidate": f"{row['strategy_id']}@{row['revision']}", "trial_id": row["trial_id"],
                "trade_start": row["trade_start"], "trade_end": row["trade_end"], "universe_rule": row["universe_rule"]}
        if assessed["economic_evidence_available"]:
            found.append(item)
        else:
            excluded.append({**item, "reasons": assessed["reasons"]})
    return found, excluded


def _dominates(better: Mapping, worse: Mapping) -> bool:
    """Whether `better` is at least as good on all four measures and better on one; None never compares."""
    pairs = []
    for name in TABLE_MEASURES:
        mine, theirs = better[name]["value"], worse[name]["value"]
        if mine is None or theirs is None:
            return False
        pairs.append((-mine, -theirs) if name in LOWER_IS_BETTER else (mine, theirs))
    return all(mine >= theirs for mine, theirs in pairs) and any(mine > theirs for mine, theirs in pairs)


def deflated_range(facts: Mapping, testing: Mapping | None) -> dict | None:
    """One run's deflated Sharpe (measures.deflated_sharpe) over its trading-window daily returns, at each
    end of the line's multiple-testing reading: `effective_trials` and `all_purpose_trials`, both with its
    `daily_sharpe_variance`; an end is None when it cannot be computed. None without a reading."""
    if testing is None:
        return None
    returns = [value for ts, value, _ in facts["returns"] if facts["trade_start_ns"] <= ts < facts["trade_end_ns"]]
    return {name: measures.deflated_sharpe(returns, testing[name], testing["daily_sharpe_variance"])
            for name in ("effective_trials", "all_purpose_trials")}


def comparison_table(conn: db.LedgerConnection, line: str | int, checker: Mapping, records: list,
                     testing: Mapping | None = None) -> dict:
    """Every passed research run with economic evidence whose trading window is the line's development
    window and whose universe rule is the line's (older candidates and other lines included), with
    its execution identity (_identities), the four measures of its report and whether another run of
    the same identity dominates it on them. `non_dominated` is null for a run missing a measure or
    without a readable identity. `execution_identity` is the line's (line_identity) and `candidates`
    the candidates with a run of it among the line's own trials (line_trials), and the line's start
    with a run of it, which a recommendation must name; other lines' runs stay in `runs`. Passed runs
    of that window without economic evidence are listed apart with their reasons and no measures. With the
    line's multiple-testing reading (`testing`), each run carries its deflated Sharpe range (deflated_range),
    else null. Nothing is ranked, scored or stored."""
    record = lines.read_line(conn, line)  # LINE_UNKNOWN for a bad name
    window = _window(record)
    identities = _identities(conn)
    current = line_identity(conn, record["line_id"], identities)
    own = set(lines.line_trials(conn, record["line_id"])["trials"])
    passed, without = _passed_research_runs(conn, checker, records, window, record["universe_rule"])
    read = {trial_id: (_headline(facts, TABLE_MEASURES), deflated_range(facts, testing))
            for trial_id, facts in measures.runs_facts(conn, [row["trial_id"] for row in passed])}
    found = [{"candidate": row["candidate"], "trial_id": row["trial_id"],
              "execution_identity": identities.get(row["trial_id"]),
              "measures": read[row["trial_id"]][0], "deflated_sharpe": read[row["trial_id"]][1]} for row in passed]
    excluded = [{"candidate": row["candidate"], "trial_id": row["trial_id"],
                 "execution_identity": identities.get(row["trial_id"]), "reasons": row["reasons"]} for row in without]
    for item in found:
        complete = all(item["measures"][name]["value"] is not None for name in TABLE_MEASURES)
        item["dominated_by"] = [other["trial_id"] for other in found if other is not item
                                and _same(other["execution_identity"], item["execution_identity"])
                                and _dominates(other["measures"], item["measures"])]
        item["non_dominated"] = (not item["dominated_by"]) if complete and item["execution_identity"] else None
    return {"line": record["name"], "dev_start": record["dev_start"], "dev_end": record["dev_end"],
            "universe_rule": record["universe_rule"], "execution_identity": current,
            "measures": list(TABLE_MEASURES), "lower_is_better": list(LOWER_IS_BETTER), "runs": found,
            "candidates": sorted({item["candidate"] for item in found if _same(item["execution_identity"], current)
                                  and (item["trial_id"] in own or item["candidate"] == record["start"])}),
            "without_economic_evidence": excluded}


# Every run by one measure (`research runs`)

RUN_MEASURES = ("annual_return", "mark_max_drawdown", "sharpe_365", "sharpe_lo", "plan_win_rate", "cycles",
                "daily_turnover")


def _day(moment: datetime) -> str:
    return moment.date().isoformat() if moment.time() == time() else moment.isoformat()


def _identity_groups(found: list[dict], identities: Mapping[int, dict | None]) -> dict[int, int | None]:
    """A group number for each run, from 1 in trial order: runs share a group when their identities share a key
    (_same, joined transitively); None for a run without a readable identity."""
    parent: dict[int, int] = {}

    def root(trial_id: int) -> int:
        while parent[trial_id] != trial_id:
            trial_id = parent[trial_id]
        return trial_id

    first_with: dict[str, int] = {}
    for row in found:
        identity = identities.get(row["trial_id"])
        if identity is None:
            continue
        parent[row["trial_id"]] = row["trial_id"]
        for key in identity["keys"]:
            if key in first_with:
                one, other = root(first_with[key]), root(row["trial_id"])
                parent[max(one, other)] = min(one, other)
            else:
                first_with[key] = row["trial_id"]
    numbers: dict[int, int] = {}
    return {row["trial_id"]: (numbers.setdefault(root(row["trial_id"]), len(numbers) + 1)
                              if row["trial_id"] in parent else None) for row in found}


def research_runs(ledger, at: str | None = None, line: str | None = None, by: str | None = None,
                  limit: int | None = None) -> dict:
    """Every passed research run with economic evidence of the open lines (L11) or, with `line`, that line's
    comparison table (the same population, _passed_research_runs), each with RUN_MEASURES as its single-run report derives
    them, the lines it belongs to (ledger.line_trials) and an execution-identity group. Ordered by trial ID, or by
    the one measure `by` (one of RUN_MEASURES) names: drawdown ascending, the others descending, nulls last,
    ties by trial ID. A listing by one measure, not the comparison table, a recommendation or a score: runs of
    different groups differ in window, instruments, configuration or image, and the first value is the best of
    `runs_listed` runs, which no ledger-wide multiple-testing reading adjusts. `limit` keeps the first runs;
    `groups` and `lines` cover the runs kept, each line with its targets in force as stated, never compared
    with the runs. Nothing is stored."""
    checker = availability.check_identity()
    with db.read_as_of(db.profile(ledger), at) as conn:
        commit = db.head_commit(conn)
        records = precheck.review_records(conn)
        if line is not None:
            record = lines.read_line(conn, line)  # LINE_UNKNOWN for a bad name
            found, without = _passed_research_runs(conn, checker, records, _window(record), record["universe_rule"])
        else:  # L11: the open lines' runs
            opened = [item["line_id"] for item in lines.lines(conn, open_only=True)]
            found, without = _passed_research_runs(conn, checker, records, line_ids=opened)
        identities = _identities(conn, {row["trial_id"] for row in found})
        groups = _identity_groups(found, identities)
        line_ids = {item["name"]: item["line_id"] for item in lines.lines(conn)}
        owners: dict[int, list[str]] = {}  # the line a research run was bound on (ledger.line_trials)
        for trial_id, name in conn.rows("SELECT t.trial_id, l.name FROM trial t JOIN research_line l ON l.line_id = "
                                        "t.line_id WHERE t.purpose = 'research'"):
            owners.setdefault(trial_id, []).append(name)
        listed = []
        derived: dict[int, dict] = {}  # each run's RUN_MEASURES only, so its series go with its chunk
        for trial_id, facts in measures.runs_facts(conn, [row["trial_id"] for row in found]):
            measured = measures.derive_measures(facts, market={"error": "MARKET_RETURNS_UNAVAILABLE: not read for a "
                                                                        "listing"})
            derived[trial_id] = {key: measured[key] for key in RUN_MEASURES}
        for row in found:
            measured = derived[row["trial_id"]]
            item = {"candidate": row["candidate"], "trial_id": row["trial_id"], "group": groups[row["trial_id"]],
                    "lines": owners.get(row["trial_id"], []),
                    "measures": {key: measured[key]["value"] for key in RUN_MEASURES}}
            missing = {key: measured[key]["null_reason"] for key in RUN_MEASURES if measured[key]["value"] is None}
            if missing:
                item["null_reasons"] = missing
            listed.append((item, row))
        if by is not None:
            sign = 1 if by == "mark_max_drawdown" else -1
            listed.sort(key=lambda pair: (pair[0]["measures"][by] is None, sign * (pair[0]["measures"][by] or 0),
                                          pair[0]["trial_id"]))
        kept = listed if limit is None else listed[:limit]
        described: dict[int, dict] = {}
        for item, row in kept:
            identity = identities.get(row["trial_id"])
            if identity is not None and item["group"] not in described:
                described[item["group"]] = {
                    "group": item["group"], "runtime_contract": identity["runtime_contract"],
                    "execution": identity["execution"], "image_digest": identity["image_digest"],
                    "window_start": _day(row["trade_start"]), "window_end": _day(row["trade_end"]),
                    "universe_rule": row["universe_rule"]}
        named = sorted({name for item, _ in kept for name in item["lines"]} | ({line} if line is not None else set()))
        stated = []
        for name in named:
            found_targets = line_targets.targets_for(conn, line_ids[name])
            stated.append({"line": name, "targets": None if found_targets is None else
                           {key: found_targets[key] for key in ("max_drawdown", "annual_return", "source")}})
    return {"ledger_commit": commit, "line": line, "by": by, "runs_listed": len(listed),
            "without_economic_evidence": len(without), "groups": [described[number] for number in sorted(described)],
            "lines": stated, "runs": [item for item, _ in kept]}


def compared_candidates(profile, line: str, at: str) -> list[str]:
    """The `candidates` of the line's comparison table at `at` (what a recommendation must name)."""
    checker = availability.check_identity()
    with db.read_as_of(db.profile(profile), at) as conn:
        return comparison_table(conn, line, checker, precheck.review_records(conn))["candidates"]


# The research state

def _judgment_history(conn: db.LedgerConnection, line_id: int, include: bool, before: int | None) -> dict:
    """Original judgments, including replaced ones; bounded pages without recomputing old facts."""
    (total, replaced), = conn.rows(
        "SELECT COUNT(*), SUM(CASE WHEN n.judgment_id IS NOT NULL THEN 1 ELSE 0 END) "
        "FROM judgment j LEFT JOIN judgment n ON n.supersedes = j.judgment_id WHERE j.line_id = %s", (line_id,))
    result = {"total": int(total), "superseded": int(replaced or 0), "entries": [], "next_before": None}
    if not include:
        return result
    rows = conn.dicts("SELECT j.judgment_id, j.kind, j.based_on_commit, j.body, j.created_at, j.supersedes, "
                      "n.judgment_id AS superseded_by FROM judgment j LEFT JOIN judgment n "
                      "ON n.supersedes = j.judgment_id WHERE j.line_id = %s "
                      "AND (%s IS NULL OR j.judgment_id < %s) ORDER BY j.judgment_id DESC LIMIT 21",
                      (line_id, before, before))
    page = rows[:20]
    if page:
        ids = [row["judgment_id"] for row in page]
        subjects: dict[int, list[dict]] = {}
        for subject in conn.dicts(f"SELECT {SUBJECT_COLUMNS} FROM {SUBJECTS} WHERE s.judgment_id IN ("
                                  + ",".join(["%s"] * len(ids)) + ") ORDER BY s.judgment_id, s.seq", tuple(ids)):
            subjects.setdefault(subject.pop("judgment_id"), []).append(subject)
        for row in page:
            row["subjects"] = subjects.get(row["judgment_id"], [])
    return {**result, "entries": page, "next_before": page[-1]["judgment_id"] if len(rows) > 20 else None}


# A judgment's subjects with the candidate's name; research_registration_id names a registration.
SUBJECT_COLUMNS = "s.judgment_id, s.seq, s.role, c.strategy_id, c.revision, s.trial_id, s.research_registration_id"
SUBJECTS = "judgment_subject s LEFT JOIN candidate c ON c.source_sha256 = s.source_sha256"


def _judgments(conn: db.LedgerConnection, line_id: int) -> dict[str, list[dict]]:
    found: dict[str, list[dict]] = {kind: [] for kind in (*SINGLE_KINDS, *MANY_KINDS)}
    rows = conn.dicts("SELECT judgment_id, kind, based_on_commit, body, created_at FROM judgment j WHERE "
                      "line_id = %s AND NOT EXISTS (SELECT 1 FROM judgment n WHERE n.supersedes = j.judgment_id) "
                      "ORDER BY judgment_id", (line_id,))
    subjects: dict[int, list[dict]] = {}
    for row in conn.dicts(f"SELECT {SUBJECT_COLUMNS} FROM {SUBJECTS} JOIN judgment j ON j.judgment_id = s.judgment_id "
                          "WHERE j.line_id = %s ORDER BY s.judgment_id, s.seq", (line_id,)):
        subjects.setdefault(row.pop("judgment_id"), []).append(row)
    for row in rows:
        found[row["kind"]].append({**row, "subjects": subjects.get(row["judgment_id"], [])})
    for kind in SINGLE_KINDS:
        found[kind] = found[kind][-1:]
    return found


def _subject_facts(conn: db.LedgerConnection, subject: Mapping, checker: Mapping, records: list) -> dict:
    if subject.get("strategy_id") is not None:
        row = conn.one("SELECT c.strategy_id, c.revision, c.source_sha256, c.parent_source_sha256, "
                       f"CONCAT(p.strategy_id, '@', p.revision) AS parent, c.difference FROM {report_candidates.CANDIDATES} "
                       "WHERE c.strategy_id = %s AND c.revision = %s", (subject["strategy_id"], subject["revision"]))
        return {"candidate": row}
    if subject.get("trial_id") is not None:
        trial = conn.one("SELECT t.trial_id, t.purpose, t.source_sha256, r.status FROM trial t LEFT JOIN run r "
                         "ON r.trial_id = t.trial_id WHERE t.trial_id = %s", (subject["trial_id"],))
        if trial is None or trial["status"] is None:
            return {"trial": trial, "availability": None, "headline": None}
        value = report_candidates.assess_listed(conn, trial["trial_id"], checker, records)
        headline = None
        if trial["status"] == "passed" and value["economic_evidence_available"]:
            headline = _headline(measures.run_facts(conn, trial["trial_id"]), measures.HEADLINE)
        return {"trial": trial, "availability": value, "headline": headline}
    return {"registration_id": subject.get("research_registration_id")}


def _unsupported_contract(conn: db.LedgerConnection, record: Mapping, judged: Mapping) -> list[dict]:
    """A gate when the candidates the line continues from were published for a runtime contract this
    product has no image layout for: the recommended, parent and control candidates of the current
    recommendation and priority, else the line's start. Precheck and sealing hold a run to its
    candidate's contract and a registration to its control's, so the line cannot be replayed or
    compared on the current runtime, unless its candidate's run was reproduced under a contract it runs."""
    named = sorted({(subject["strategy_id"], subject["revision"]) for kind in SINGLE_KINDS for item in judged[kind]
                    for subject in item["subjects"] if subject["role"] in judgments.CANDIDATE_ROLES})
    if not named:
        strategy_id, _, revision = record["start"].rpartition("@")
        named = [(strategy_id, int(revision))]
    rows = conn.rows("SELECT strategy_id, revision, runtime_contract, source_sha256 FROM candidate WHERE "
                     + " OR ".join(["(strategy_id = %s AND revision = %s)"] * len(named)),
                     tuple(value for pair in named for value in pair))
    old = sorted((contract, f"{strategy_id}@{revision}") for strategy_id, revision, contract, source in rows
                 if contract not in image.LAYOUTS and not _moved(conn, source))
    if not old:
        return []
    contracts, supported = ", ".join(sorted({contract for contract, _ in old})), ", ".join(sorted(image.LAYOUTS))
    return [{"code": "RUNTIME_UNSUPPORTED",
             "message": f"the line's candidates and their runs are on {contracts}, which this product cannot replay "
                        f"(it runs {supported}); move its runs with `replay reproduce --image`, and when that is refused the line can "
                        f"only be closed and research restarted on {supported}",
             "missing": [name for _, name in old]}]


def _moved(conn: db.LedgerConnection, source: str) -> bool:
    """Whether a passed research run of the source was reproduced (reproduction.matches) by an explore trial under
    a contract this product runs. A reproduction on the run's own image or another old one proves nothing about
    the current runtime."""
    passed = [trial_id for (trial_id,) in conn.rows(
        "SELECT r.trial_id FROM run r JOIN trial t ON t.trial_id = r.trial_id WHERE r.status = 'passed' "
        "AND t.source_sha256 = %s ORDER BY r.trial_id", (source,))]
    explores = [trial_id for trial_id, contract in conn.rows(
        "SELECT trial_id, runtime_contract FROM trial WHERE purpose = 'explore' AND source_sha256 = %s "
        "ORDER BY trial_id", (source,)) if contract in image.LAYOUTS] if passed else []
    return any(reproduction.matches(conn, later, original) for original in passed for later in explores)


def _behind(conn: db.LedgerConnection, trials: list[int], current_image: str | None) -> list[int] | None:
    """The line's passed runs that have not reached the current image (own, or by a reproduction)."""
    if current_image is None:
        return None
    stale: dict[int, str] = {}  # passed run on another image: its source
    for at in range(0, len(trials), execution.BATCH):
        chunk = tuple(trials[at:at + execution.BATCH])
        stale.update((row["trial_id"], row["source_sha256"]) for row in conn.dicts(
            f"SELECT r.trial_id, t.source_sha256, {db.TRIAL_IMAGE_DIGEST} FROM run r JOIN trial t ON t.trial_id = r.trial_id "
            f"WHERE r.status = 'passed' AND r.trial_id IN ({', '.join(['%s'] * len(chunk))})", chunk)
            if row["image_digest"] != current_image)
    sources = sorted(set(stale.values()))
    explores: list[tuple[int, str]] = []  # (trial, source) of the explores on the current image that can reproduce one
    for at in range(0, len(sources), execution.BATCH):
        named = sources[at:at + execution.BATCH]
        explores += conn.rows("SELECT trial_id, source_sha256 FROM trial WHERE purpose = 'explore' AND "
                              f"SUBSTRING_INDEX(image_ref, '@', -1) = %s AND source_sha256 IN ({', '.join(['%s'] * len(named))})",
                              (current_image, *named))
    return [trial_id for trial_id in trials if trial_id in stale
            and not any(source == stale[trial_id] and later > trial_id and reproduction.matches(conn, later, trial_id)
                        for later, source in explores)]


def _unresolved_market(record: Mapping) -> list[dict]:
    """A gate when the active market holds no version of the line's pinned market commit: the line's next
    registration is refused MARKET_COMMIT_UNRESOLVED and its runs cannot be replayed until that version is
    back in it. Nothing when the market cannot be read."""
    found = seams.current.market_day(record["market_day"])
    if found is None or found["commit"] is not None:
        return []
    return [{"code": "MARKET_COMMIT_UNRESOLVED",
             "message": f"the line's market commit {record['market_day']} is no day the active market "
                        f"{found['database']} holds, so the line cannot register or replay until the market reaches it",
             "missing": [record["market_day"]]}]


def _facts(profile, commit: str) -> dict:
    return {"candidates": report_candidates.candidates(profile, commit)["candidates"],
            "counts": research_status(profile, commit)}


def _undistinguished_runs(profile, commit: str, trials: Sequence[tuple[int, int]], checker: Mapping, reviews: list) -> dict:
    """The line's latest research runs (trial, registration ID; oldest first) read back from the newest for a due line
    change (research-round): `trials` leave candidate and control undistinguished, `uncompared` have no
    comparison and so neither count nor clear, `distinguished` is the run that ended the reading. It also ends
    when either list reaches `review_every`, so one read compares a bounded number of runs. A report, not a gate:
    the ledger holds neither the user's choices of line nor which runs only scale, which the Agent discounts. A
    comparison the research refuses leaves its run uncompared; an unreachable service (comparison.ENVIRONMENT)
    refuses the read, which would otherwise fill `uncompared` with runs it never read."""
    found: dict = {"trials": [], "uncompared": [], "distinguished": None}
    for trial_id, registration_id in reversed(trials):
        try:
            crossing = comparison.crossing(profile, registration_id, trial_id, commit, checker=checker, reviews=reviews)
        except Refusal as exc:
            failure = comparison.environment_failure(exc)
            if failure is not None:
                raise failure from exc
            crossing = None
        if crossing is False:
            found["distinguished"] = trial_id
            break
        found["trials" if crossing else "uncompared"].append(trial_id)
        if register.REVIEW_EVERY in (len(found["trials"]), len(found["uncompared"])):
            break
    return {**found, "trials": found["trials"][::-1], "uncompared": found["uncompared"][::-1]}


@seams.reading_once
def research_state(conn: db.LedgerConnection, line: str | None = None, at: str | None = None, *,
                   history: bool = False, history_before: int | None = None, full: bool = False,
                   current_image: str | None = None) -> dict:
    """The research line's whole record (`line`: ledger.read_line's line_id, name, start, development window,
    market commit, universe rule and closing), its execution identity (`execution_identity`, line_identity), the user's targets in force for it (`targets`: the line's own, else the ledger default, else
    null), the open lines (`open_lines`: name, start, development window and market commit of each), its current judgments with read-time facts, the fixed review cadence (`review_every`),
    the line's latest runs read for a due change of approach (`undistinguished_runs`, _undistinguished_runs),
    the trials of the line's execution identity since the last recommendation (`unreviewed_trials`), the trial count of
    the line (every identity: the search on the same data) and the gates the next registration would meet
    (with RUNTIME_UNSUPPORTED when the line's candidates are on a contract the product no longer runs, and
    MARKET_COMMIT_UNRESOLVED when the active market holds no version of the line's market commit). The
    line is the one named `line`, else the only open line; with no open line `line` is null with
    `line select` as the next step (gate RESEARCH_LINE_REQUIRED), with several the gate is LINE_AMBIGUOUS
    and the next step names one with --line.

    By default interpretations and search exposures are those after the current recommendation, with the
    count of earlier ones in `earlier`, and `facts` (candidate list, research status) is left out; `full`
    gives every current judgment and the facts. `current_image` is the main image's digest reference, as given;
    `runs_behind_image` lists the line's passed runs that have not reached it (null without it)."""
    checker = availability.check_identity()
    with db.read_as_of(conn.profile, at) as pinned:
        commit = db.head_commit(pinned)
        records = precheck.review_records(pinned)
        opened = lines.lines(pinned, open_only=True)
        open_lines = [{key: item[key] for key in ("name", "start", "dev_start", "dev_end", "market_day")}
                      for item in opened]
        line = line or (opened[0]["name"] if len(opened) == 1 else None)
        if line is None:  # no open line, or several: the facts the user chooses from, and the one next step
            if opened:
                needed = [{"code": "LINE_AMBIGUOUS", "message": "several research lines are open; name one with "
                           "--line", "missing": [item["name"] for item in opened]}]
                step = "Name the line to read with `research state --line` (one of open_lines)."
            else:
                needed = [{"code": "RESEARCH_LINE_REQUIRED", "message": "the ledger has no open research line",
                           "missing": ["research-line"]}]
                step = "Select the user's research line with `line select`."
            return {"ledger_commit": commit, "gates": needed, "undistinguished_runs": None, "line": None, "execution_identity": None, "targets": line_targets.targets_for(pinned, None),
                    "open_lines": open_lines, **{kind: None for kind in SINGLE_KINDS},
                    "review_every": register.REVIEW_EVERY,
                    "interpretations": [], "search_exposures": [], "unreviewed_trials": [], "trials_on_line": 0,
                    "current_image": current_image, "runs_behind_image": None,
                    "judgment_history": {"total": 0, "superseded": 0, "entries": [], "next_before": None},
                    "earlier": None,
                    "facts": _facts(conn.profile, commit) if full else None,
                    "next_actions": [step]}
        record = lines.read_line(pinned, line)  # LINE_UNKNOWN for a line that does not exist
        line_id = record["line_id"]
        on_line = lines.line_trials(pinned, line_id)
        in_force = line_targets.targets_for(pinned, line_id)
        judged = _judgments(pinned, line_id)
        original = _judgment_history(pinned, line_id, history or history_before is not None, history_before)
        recommendation = judged["recommendation"][-1] if judged["recommendation"] else None
        identities = _identities(pinned, on_line["trials"])
        current = line_identity(pinned, line_id, identities)
        unreviewed = [trial_id for trial_id in (
            lines.line_trials(pinned, line_id, since_commit=recommendation["based_on_commit"])["trials"]
            if recommendation else on_line["trials"]) if _same(identities.get(trial_id), current)]
        earlier = None
        if not full and recommendation is not None:
            earlier = {}
            for kind, name in (("interpretation", "interpretations"), ("search_exposure", "search_exposures")):
                kept = [item for item in judged[kind] if item["judgment_id"] > recommendation["judgment_id"]]
                earlier[name], judged[kind] = len(judged[kind]) - len(kept), kept
        for kind in judged:
            for item in judged[kind]:
                item["facts"] = [_subject_facts(pinned, subject, checker, records) for subject in item["subjects"]]
        try:
            register.require_line_records(pinned, line_id)
            gates: list[dict] = []
        except Refusal as exc:
            gates = [{"code": exc.code, "message": exc.message, "missing": list(exc.missing)}]
        gates += _unsupported_contract(pinned, record, judged)
        gates += _unresolved_market(record)
        behind = _behind(pinned, on_line["trials"], current_image and current_image.rsplit("@", 1)[-1])
        registered = dict(pinned.rows("SELECT trial_id, research_registration_id FROM trial WHERE line_id = %s "
                                      "AND research_registration_id IS NOT NULL", (line_id,)))
    undistinguished = _undistinguished_runs(conn.profile, commit, [(trial_id, registered[trial_id]) for trial_id in on_line["trials"]],
                                            checker, records)
    # gates first: a consumer that cuts a long answer (the IDE Agent's tools keep the first 20,000 characters) still reads them
    return {"ledger_commit": commit, "gates": gates, "undistinguished_runs": undistinguished, "line": record, "execution_identity": current, "targets": in_force, "open_lines": open_lines,
            **{kind: (judged[kind][-1] if judged[kind] else None) for kind in SINGLE_KINDS},
            "review_every": register.REVIEW_EVERY, "interpretations": judged["interpretation"], "search_exposures": judged["search_exposure"],
            "unreviewed_trials": unreviewed, "trials_on_line": on_line["count"], "current_image": current_image, "runs_behind_image": behind,
            "judgment_history": original, "earlier": earlier,
            "facts": _facts(conn.profile, commit) if full else None}
