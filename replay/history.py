"""A line's closing history test (`replay.history`).

Before a line closes, every candidate with a passed research run on it (ledger.lines.history_participants)
is replayed over each segment of ledger.lines.history_segments: the veto segments (the calendar years before the
development period), the period again as the control, the two-year holdout after it as one segment, and the
forward segment after the holdout. Each segment replays the
candidate's latest passed research run by its identity (source, image, configuration, instrument rule),
only over another window, on one market day, from zero position and the same starting balance; it is a
history trial, sealed as a run like any other. Candidates go by their development-period Sharpe, highest
first; a segment that already has a history run is skipped, so an interrupted test resumes.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import timedelta

from ledger import db, lines, metrics, strategies, trials
from shared.refusals import refuse
from registration import inputs as registration_inputs, seams as registration_seams
from replay import entry, reproduce
from report import measures


def _sharpe(conn: db.LedgerConnection, trial_id: int) -> float | None:
    return measures.derive_measures(measures.run_facts(conn, trial_id))["sharpe_365"]["value"]


def _same_configuration(found: Mapping, recorded: Mapping) -> bool:
    """The effective configurations agree outside the window and instruments a segment changes."""
    return all(found.get(key) == recorded.get(key) for key in set(found) | set(recorded)
               if key not in trials.CONFIG_SET_ASIDE)


def run_history(ledger: db.LedgerProfile, market, at: str | None, line: str, limit: int | None = None) -> dict:
    """Run the segments of `line`'s closing history test that have no history run, at most `limit` of them;
    returns what ran and what is left."""
    source = registration_seams.current.market(market)
    market_day = source.resolve_day(at)
    first_day, latest = source.days(market_day)
    after_last = latest + timedelta(days=1)
    with db.connect(ledger, "reader") as conn:
        record = lines.open_line(conn, line)
        plan = lines.history_plan(conn, record["line_id"], first_day, after_last)
        order = {trial_id: _sharpe(conn, trial_id) for trial_id in {item["trial_id"] for item in plan}}
    todo = [item for item in plan if item["window"] is not None and item["done"] is None]
    todo.sort(key=lambda item: (order[item["trial_id"]] is None, -(order[item["trial_id"]] or 0), item["trial_id"]))
    ran = []
    for item in todo[:limit]:
        with db.connect(ledger, "reader") as conn:
            stored = metrics.load_run(conn, item["trial_id"])
            revision = strategies.candidate_by_sha(conn, item["source_sha256"])
        window = item["window"]
        recorded, runner_argv, (quotes, trades, metric_rows) = reproduce.runner_inputs(
            stored, window["input_start"], window["trade_start"], window["trade_end"])
        span = {"start": metrics.moment_ns(window["input_start"]),
                "trade_start": metrics.moment_ns(window["trade_start"]), "end": metrics.moment_ns(window["trade_end"])}
        identity = entry._resolve(stored["trial"]["image_ref"])
        exported = None
        try:
            exported = registration_inputs.market_inputs(
                market, market_day, span, dict(recorded["selection"]), recorded.get("lifecycle_bundle"), True, ledger,
                include_quotes=quotes, include_trades=trades, include_metrics=metric_rows)
            inspection = registration_seams.current.inspect_runtime(identity, runner_argv, exported)
            effective = (stored["capture"].get("input_coverage") or {}).get("effective_config")
            if not _same_configuration(trials.config_key(inspection.get("effective_config")),
                                       trials.config_key(effective)):
                raise refuse("REPRODUCTION_CONFIG_DIFFERS", f"the effective configuration of run {item['trial_id']} "
                                                            f"differs on segment {item['label']}",
                             missing=("effective_config",))
            sealed = entry.seal(ledger, revision, identity["image_ref"], exported, runner_argv, None, None,
                                market=market, history=record["line_id"])
        finally:
            entry._cleanup(exported)
        ran.append({"source_sha256": item["source_sha256"], "segment": item["label"], "run": item["trial_id"],
                    "history_trial_id": sealed["trial_id"], "status": sealed["status"]})
    return {"line": record["name"], "market_day": market_day, "ran": ran,
            "left": max(len(todo) - len(ran), 0),
            "participants": len({item["source_sha256"] for item in plan}),
            "segments_without_trading": sum(item["window"] is None for item in plan)}
