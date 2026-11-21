"""A line's closing history test (`replay.history`).

Before a line closes, every candidate of its test (report.history.candidates: the sources with a passed research
run on it whose run carries economic evidence) is replayed over each segment of ledger.lines.history_segments: the veto segments (the calendar years before the
development period), the period again as the control, the two-year holdout after it as one segment, and the
forward segment after the holdout. Each segment replays the
candidate's latest passed research run by its identity (source, image, configuration, instrument rule),
only over another window, on one market day, from zero position and the same starting balance; it is a
history trial, sealed as a run like any other. Candidates go by their development-period Sharpe, highest
first; a segment that already has a history run is skipped, so an interrupted test resumes. A segment whose latest
history run is invalid (an environment or transient failure, or the strategy's own audit failure) is replayed
again, once per call and after every segment without a run; the new trial supersedes the invalid one, which
stays in the ledger. Replays are deterministic, so a failure of the strategy's own fails again.
"""

from __future__ import annotations

from datetime import timedelta

from ledger import db, lines, metrics, strategies, trials
from registration import inputs as registration_inputs, seams as registration_seams
from replay import entry, reproduce
from report import history as report_history, measures


def _sharpe(conn: db.LedgerConnection, trial_id: int) -> float | None:
    return measures.derive_measures(measures.run_facts(conn, trial_id))["sharpe_365"]["value"]


def run_history(ledger: db.LedgerProfile, market, at: str | None, line: str, limit: int | None = None) -> dict:
    """Run the segments of `line`'s closing history test that have no history run, then once more those whose
    latest history run is invalid, at most `limit` runs in all; returns what ran (`replaces`: the invalid history
    trial a rerun supersedes, else None), the segments left without a run (`left`) and with an invalid run not
    replayed this time (`invalid_left`), and the participants left out for want of economic evidence."""
    source = registration_seams.current.market(market)
    market_day = source.resolve_day(at)
    first_day, latest = source.days(market_day)
    after_last = latest + timedelta(days=1)
    with db.connect(ledger, "reader") as conn:
        record = lines.open_line(conn, line)
        candidates, without = report_history.candidates(conn, record["line_id"])
        plan = lines.history_plan(conn, record["line_id"], first_day, after_last, candidates)
        order = {trial_id: _sharpe(conn, trial_id) for trial_id in {item["trial_id"] for item in plan}}
    todo = [item for item in plan if item["window"] is not None
            and (item["done"] is None or item["status"] == "invalid")]
    todo.sort(key=lambda item: (item["done"] is not None, order[item["trial_id"]] is None,
                                -(order[item["trial_id"]] or 0), item["trial_id"]))
    ran = []
    for item in todo[:limit]:
        with db.connect(ledger, "reader") as conn:
            stored = metrics.load_run(conn, item["trial_id"])
            revision = strategies.candidate_by_sha(conn, item["source_sha256"])
        window = item["window"]
        recorded, runner_argv, flags = reproduce.stored_runner_argv(
            stored, window["input_start"], window["trade_start"], window["trade_end"])
        span = {"start": metrics.moment_ns(window["input_start"]),
                "trade_start": metrics.moment_ns(window["trade_start"]), "end": metrics.moment_ns(window["trade_end"])}
        # The segment changes only the window: the image must give the run's configuration otherwise unchanged.
        effective = (stored["capture"].get("input_coverage") or {}).get("effective_config")
        exported = None
        try:
            exported = registration_inputs.market_inputs(
                market, market_day, span, dict(recorded["selection"]), recorded.get("lifecycle_bundle"), True, ledger,
                **flags)
            sealed = entry.seal(ledger, revision, stored["trial"]["image_ref"], exported, runner_argv, None, None,
                                market=market, history=record["line_id"],
                                comparable_config=trials.comparable_config_sha256(effective))
        finally:
            registration_inputs.cleanup(exported)
        ran.append({"source_sha256": item["source_sha256"], "segment": item["label"], "run": item["trial_id"],
                    "history_trial_id": sealed["trial_id"], "status": sealed["status"], "replaces": item["done"]})
    rest = todo[len(ran):]
    return {"line": record["name"], "market_day": market_day, "ran": ran,
            "left": sum(item["done"] is None for item in rest),
            "invalid_left": sum(item["done"] is not None for item in rest),
            "participants": len({item["source_sha256"] for item in plan}), "without_economic_evidence": without,
            "segments_without_trading": sum(item["window"] is None for item in plan)}
