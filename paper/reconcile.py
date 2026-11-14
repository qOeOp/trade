"""Paper reconciliation (`paper reconcile`): a sealed paper run against a replay of its source on the archive
(replay.reconcile, the tool Paper and Live share).

The replay takes everything from the run's declaration and capture (its source, image, contracts, leverage, the
contract's starting balance and the interval its runner received bars for, warmed at its start as the run was) and
only the market day from the caller; it is no trial and writes nothing to the ledger (user decision 2026-10-26). Its
reports and the comparison, reconcile.json, stay in a new temporary directory (docs/plans/paper-trading-design.zh.md
§5, step 7).
"""

from __future__ import annotations

from collections.abc import Mapping
import json
from pathlib import Path

from engine.config import ACCOUNT_CONTRACT, utc_text
from ledger import db, paper as records
from replay import reconcile as shared
from shared.refusals import refuse


def window(lines: list[dict], seal: Mapping) -> tuple[int, int]:
    """[start, end) of the bars the run's runner received: from its input start (its warm-up's T) to the minute it
    stopped."""
    started = next((line for line in lines if line["kind"] == "started"), None)
    stopped = seal.get("stopped_ns")
    if not started or not isinstance(started.get("input_start_ns"), int) or not isinstance(stopped, int):
        raise refuse("PAPER_RECONCILE_EMPTY", "the run's capture has no input start or no stop time",
                     missing=("started", "stopped_ns"))
    start, end = started["input_start_ns"], stopped - stopped % shared.MINUTE_NS
    if end <= start:
        raise refuse("PAPER_RECONCILE_EMPTY", f"the run stopped at {utc_text(stopped)}, before its first bar closed",
                     missing=("bars",))
    return start, end


def run_record(lines: list[dict], settled: list[dict], terms: Mapping | None = None,
               fees: Mapping | None = None) -> dict:
    """The journal as replay.reconcile.compare reads a run, with the funding `settled`."""
    warmup: dict[str, dict[str, dict]] = {}
    for line in lines:
        if line["kind"] == "warmup":
            warmup.setdefault(line["instrument_id"], {})[line["period"]] = {
                key: line.get(key) for key in ("bars", "first_ts_event", "last_ts_event", "sha256")}
    return {"bars": [line for line in lines if line["kind"] == "bar"], "warmup": warmup,
            "events": [line for line in lines if line["kind"] == "order"], "settlements": settled,
            "equity": records.equity_path(lines, settled)[0], "terms": dict(terms or {}), "fees": fees}


def _journal(conn: db.LedgerConnection, paper_id: int) -> list[dict]:
    return records.sealed_journal(records.paper_files(conn, paper_id, "events/"))


def reconcile(profile: db.LedgerProfile, market: dict, at: str | None, paper_id: int, output: Path,
              timeout: float | None = None) -> dict:
    """paper reconcile: replay a sealed paper run's interval on the archive and write reconcile.json."""
    from market import files, instrument
    from paper import runs
    with db.connect(profile, "reader") as conn:
        row = records.read_paper_run(conn, paper_id)
        seal = records.seal_of(conn, paper_id)
        if seal is None:
            raise refuse("PAPER_RUN_ACTIVE", f"paper run {paper_id} is not sealed", missing=(str(paper_id),))
        candidate = records.read_source(conn, row["source_sha256"])
        lines = _journal(conn, paper_id)
    start, end = window(lines, seal)
    symbols = list(row["symbols"])
    market_day, archived = shared.archive(market, at, symbols, start, end, "PAPER_RECONCILE_UNCOVERED")
    opened = files.open_market(market, "reader")
    run = run_record(lines, records.settlements(lines, records.published_settlements(lines, seal.get("stopped_ns"))),
                     # Each contract's terms at the run's market day, and the account's one rate on each.
                     {symbol: instrument.terms(opened, str(row["market_day"]), symbol) for symbol in symbols},
                     {symbol: row["config"]["fees"] for symbol in symbols} if row["config"].get("fees") else None)
    output, replayed, compared = shared.reconcile(
        run, market, market_day, archived, candidate["source"], candidate["entry_class"], row["image_ref"], symbols,
        start, end,
        # A run declared before its leverage was recorded ran at the default.
        row["config"].get("leverage", ACCOUNT_CONTRACT["default_leverage"]), ACCOUNT_CONTRACT["starting_balance_usdt"],
        output, f"trade-paper-reconcile-{runs.ledger_key(profile)}-{paper_id}", timeout)
    result = {"format": shared.FORMAT, "kind": "paper", "paper_id": paper_id, "candidate": row["config"]["candidate"],
              "source_sha256": row["source_sha256"], "image_ref": row["image_ref"], "market_day": market_day,
              "window": {"start": utc_text(start), "end": utc_text(end)}, "fees": row["config"].get("fees"),
              "replay": replayed, **compared}
    (output / "reconcile.json").write_text(json.dumps(result, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return {"path": str(output / "reconcile.json"), "summary": result["summary"], "replay": result["replay"]}
