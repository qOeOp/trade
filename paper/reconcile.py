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

from engine.config import ACCOUNT_CONTRACT, instrument_id
from ledger import db, paper as records
from replay import reconcile as shared
from shared import paths
from shared.refusals import refuse


FORMAT = shared.FORMAT
MINUTE_NS = shared.MINUTE_NS
_utc = shared._utc


def window(lines: list[dict], seal: Mapping) -> tuple[int, int]:
    """[start, end) of the bars the run's runner received: from its input start (its warm-up's T) to the minute it
    stopped."""
    started = next((line for line in lines if line["kind"] == "started"), None)
    stopped = seal.get("stopped_ns")
    if not started or not isinstance(started.get("input_start_ns"), int) or not isinstance(stopped, int):
        raise refuse("PAPER_RECONCILE_EMPTY", "the run's capture has no input start or no stop time",
                     missing=("started", "stopped_ns"))
    start, end = started["input_start_ns"], stopped - stopped % MINUTE_NS
    if end <= start:
        raise refuse("PAPER_RECONCILE_EMPTY", f"the run stopped at {_utc(stopped)}, before its first bar closed",
                     missing=("bars",))
    return start, end


def run_record(lines: list[dict], settled: list[dict] | None, terms: Mapping | None = None,
               fees: Mapping | None = None) -> dict:
    """The journal as replay.reconcile.compare reads a run: with the funding `settled` (the seal's published
    settlements, else the journal's estimate)."""
    warmup: dict[str, dict[str, dict]] = {}
    for line in lines:
        if line["kind"] == "warmup":
            warmup.setdefault(line["instrument_id"], {})[line["period"]] = {
                key: line.get(key) for key in ("bars", "first_ts_event", "last_ts_event", "sha256")}
    settlements = records.settlements(lines) if settled is None else settled
    return {"bars": [line for line in lines if line["kind"] == "bar"], "warmup": warmup,
            "events": [line for line in lines if line["kind"] == "order"], "settlements": settlements,
            "equity": records.equity_path(lines, settlements)[0], "terms": dict(terms or {}), "fees": fees}


def compare(lines: list[dict], replay_events: list[dict] | None, archive: Mapping[str, list[list]], reports: Path | None,
            start: int, end: int, settled: list[dict] | None = None, **context) -> dict:
    """One run's journal against its replay (replay.reconcile.compare)."""
    return shared.compare(run_record(lines, settled, context.pop("terms", None), context.pop("fees", None)),
                          replay_events, archive, reports, start, end, **context)


def _journal(conn: db.LedgerConnection, paper_id: int) -> list[dict]:
    return records.sealed_journal(records.paper_files(conn, paper_id, "events/"))


def _archive(market: dict, at: str | None, symbols: list[str], start: int, end: int) -> tuple[str, dict[str, list]]:
    return shared.archive(market, at, symbols, start, end, "PAPER_RECONCILE_UNCOVERED")


def _context(market: dict, run_day: str, market_day: str, symbols: list[str], start: int,
             lines: list[dict]) -> tuple[dict, dict]:
    """(each contract's terms at the run's market day, compare()'s replay context: the terms and warm-up at the
    reconciliation's market day and the fees the replay assumes)."""
    from market import files, instrument
    opened = files.open_market(market, "reader")
    received = run_record(lines, [])["warmup"]
    replay_terms = {symbol: instrument.terms(opened, market_day, symbol) for symbol in symbols}
    return ({symbol: instrument.terms(opened, run_day, symbol) for symbol in symbols},
            {"replay_terms": replay_terms,
             "replay_fees": {"maker": instrument.ASSUMED["maker_fee"], "taker": instrument.ASSUMED["taker_fee"]},
             "archived_warmup": {symbol: shared.archive_warmup(market, market_day, symbol, start,
                                                               received.get(instrument_id(symbol), {}),
                                                               replay_terms[symbol]) for symbol in symbols}})


def reconcile(profile: db.LedgerProfile, market: dict, at: str | None, paper_id: int, output: Path,
              timeout: float | None = None) -> dict:
    """paper reconcile: replay a sealed paper run's interval on the archive and write reconcile.json."""
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
    market_day, archive = _archive(market, at, symbols, start, end)
    run_terms, context = _context(market, str(row["market_day"]), market_day, symbols, start, lines)
    output = paths.temporary_path(output)
    output.mkdir(mode=0o700, parents=True)
    replayed, events, reports = shared.replay(
        market, market_day, candidate["source"], candidate["entry_class"], row["image_ref"], symbols, start, end,
        # A run declared before its leverage was recorded ran at the default.
        row["config"].get("leverage", ACCOUNT_CONTRACT["default_leverage"]), ACCOUNT_CONTRACT["starting_balance_usdt"],
        output / "replay", f"trade-paper-reconcile-{runs.ledger_key(profile)}-{paper_id}", timeout)
    settled = records.settlements(lines, records.published_settlements(lines, seal.get("stopped_ns")))
    compared = compare(lines, events, archive, reports, start, end, settled, terms=run_terms,
                       # The account's one rate on each contract it ran.
                       fees={symbol: row["config"]["fees"] for symbol in symbols} if row["config"].get("fees") else None,
                       **context)
    result = {"format": FORMAT, "kind": "paper", "paper_id": paper_id, "candidate": row["config"]["candidate"],
              "source_sha256": row["source_sha256"], "image_ref": row["image_ref"], "market_day": market_day,
              "window": {"start": _utc(start), "end": _utc(end)}, "fees": row["config"].get("fees"),
              "replay": replayed, **compared}
    (output / "reconcile.json").write_text(json.dumps(result, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return {"path": str(output / "reconcile.json"), "summary": result["summary"], "replay": result["replay"]}
