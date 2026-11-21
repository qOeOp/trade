"""Paper comparison (`paper compare`): a sealed paper run against a replay of its source on the archive
(replay.comparison, the tool Paper and Live share).

The replay takes everything from the run's declaration and capture (its source, image, contracts, leverage, the
contract's starting balance and the interval its runner received bars for, warmed at its start as the run was) and
only the market day from the caller; it is no trial and writes nothing to the ledger (user decision 2026-10-26). Its
reports and comparison.json stay in a new temporary directory (docs/plans/paper-trading-design.zh.md
§5, step 7).
"""

from __future__ import annotations

from collections.abc import Mapping
import itertools
import json
from pathlib import Path

from engine.config import ACCOUNT_CONTRACT, symbol_of, utc_text
from ledger import db, paper as records
from replay import comparison as shared
from shared import paths
from shared.refusals import refuse


def window(lines: list[dict], seal: Mapping) -> tuple[int, int]:
    """[start, end) of the bars the run's runner received: from its input start (its warm-up's T) to the minute it
    stopped."""
    started = next((line for line in lines if line["kind"] == "started"), None)
    stopped = seal.get("stopped_ns")
    if not started or not isinstance(started.get("input_start_ns"), int) or not isinstance(stopped, int):
        raise refuse("PAPER_COMPARE_EMPTY", "the run's capture has no input start or no stop time",
                     missing=("started", "stopped_ns"))
    start, end = started["input_start_ns"], stopped - stopped % shared.MINUTE_NS
    if end <= start:
        raise refuse("PAPER_COMPARE_EMPTY", f"the run stopped at {utc_text(stopped)}, before its first bar closed",
                     missing=("bars",))
    return start, end


def recovery_declared(lines: list[dict]) -> bool | None:
    """Whether the run's source declares the recovery protocol, as its runner judged it and journalled it on the
    `started` line (engine.paper_session.declares_recovery); None before that line or when the line has no verdict."""
    started = next((line for line in lines if line["kind"] == "started"), None)
    found = None if started is None else started.get("recovery_declared")
    return found if isinstance(found, bool) else None


def held_since(lines: list[dict]) -> int | None:
    """When the run was first held (engine.paper_session, held): the wall time of its first `resumed` for a source
    without the recovery protocol (the runner's verdict on the `started` line, recovery_declared), and for one with it
    the first `resumed` the runner followed at once with a PAPER_RECOVERY_UNAVAILABLE `refusal` and then went on (a
    later `bar`): a recovery that crossed a funding settlement (Session.hold). A refused recovery stops without a bar.
    Derived from the journal; a run with no verdict is not taken as held."""
    declared = recovery_declared(lines)
    if declared is None:
        return None
    for index, line in enumerate(lines):
        if line["kind"] != "resumed":
            continue
        if declared is False:
            return line["wall_ns"]
        following = lines[index + 1:]
        if (following and following[0]["kind"] == "refusal" and following[0].get("code") == "PAPER_RECOVERY_UNAVAILABLE"
                and any(item["kind"] == "bar" for item in itertools.takewhile(
                    lambda item: item["kind"] != "resumed", following))):
            return line["wall_ns"]
    return None


def _held_resumes(lines: list[dict], held: int) -> list[tuple[int, int, int]]:
    """(index, pause, resume) of every `resumed` from `held` on: its pause is the first `stop_requested` since the run
    last started or resumed, else the last line before the `resumed` (a crash)."""
    found = []
    for index, line in enumerate(lines):
        if line["kind"] != "resumed" or not isinstance(line.get("wall_ns"), int) or line["wall_ns"] < held:
            continue
        before = list(itertools.takewhile(lambda item: item["kind"] not in ("started", "resumed"),
                                          reversed(lines[:index])))[::-1]
        stopped = [item["wall_ns"] for item in before if isinstance(item.get("wall_ns"), int)]
        found.append((index, next((item["wall_ns"] for item in before if item["kind"] == "stop_requested"),
                                  stopped[-1] if stopped else line["wall_ns"]), line["wall_ns"]))
    return found


def interruptions(lines: list[dict], held: int) -> dict[str, list[tuple[int, int]]]:
    """Per contract, the [from, to) of each interruption a held run resumed from (_held_resumes): from its pause to the
    first live bar of that contract after the `resumed` (none: to the run's end). The bars that closed in it are the
    hold's to miss, not a live gap. Derived, never stored."""
    found: dict[str, list[tuple[int, int]]] = {}
    symbols = {symbol_of(line["instrument_id"]) for line in lines if line["kind"] == "bar"}
    for index, pause, _ in _held_resumes(lines, held):
        first: dict[str, int] = {}
        for item in lines[index + 1:]:
            if item["kind"] == "bar":
                first.setdefault(symbol_of(item["instrument_id"]), item["ts_event"])
        for symbol in symbols:
            found.setdefault(symbol, []).append((pause, first.get(symbol, 2**63)))
    return found


def run_record(lines: list[dict], settled: list[dict], terms: Mapping | None = None,
               fees: Mapping | None = None, held: int | None = None) -> dict:
    """The journal as replay.comparison.compare reads a run, with the funding `settled`, when it was `held`, the
    interruptions it was held over and when it was paused."""
    warmup: dict[str, dict[str, dict]] = {}
    for line in lines:
        if line["kind"] == "warmup":
            warmup.setdefault(line["instrument_id"], {})[line["period"]] = {
                key: line.get(key) for key in ("bars", "first_ts_event", "last_ts_event", "sha256")}
    return {"bars": [line for line in lines if line["kind"] == "bar"], "warmup": warmup,
            "kline_events": [line for line in lines if line["kind"] == "kline_event"],
            "kline_sockets": [line for line in lines if line["kind"] == "kline_socket"],
            "side_starts": [line["wall_ns"] for line in lines if line["kind"] in ("started", "resumed")
                            and isinstance(line.get("wall_ns"), int)],
            "metrics": [line for line in lines if line["kind"] in ("metrics", "metrics_unsubscribed")],
            "events": [line for line in lines if line["kind"] == "order"], "settlements": settled,
            "equity": records.equity_path(lines, settled)[0],
            "taken": {line["minute_ns"]: line["wall_ns"] for line in lines
                      if line["kind"] == "snapshot" and isinstance(line.get("minute_ns"), int)
                      and isinstance(line.get("wall_ns"), int)},
            "terms": dict(terms or {}), "fees": fees, "held": held,
            "interrupted": interruptions(lines, held) if held is not None else {},
            # The [pause, resume] of each held interruption (_held_resumes), for the minutes it was down in.
            "paused": [(pause, resume) for _, pause, resume in _held_resumes(lines, held)] if held is not None else []}


def _journal(conn: db.LedgerConnection, paper_id: int) -> list[dict]:
    return records.sealed_journal(records.paper_files(conn, paper_id, "events/"))


def compare(profile: db.LedgerProfile, market: dict, at: str | None, paper_id: int, output: Path,
            timeout: float | None = None, preliminary: bool = False) -> dict:
    """paper compare: replay a sealed paper run's interval on the archive and write comparison.json. `preliminary`:
    on the market with the minutes it does not hold yet read from Binance's public REST (replay.preliminary), in
    `output`/market; the result says so (`data_source` rest, `preliminary`)."""
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
    opened = files.open_market(market, "reader")
    run = run_record(lines, records.settlements(lines, records.published_settlements(lines, seal.get("stopped_ns"))),
                     # Each contract's terms at the run's market day, and the account's one rate on each.
                     {symbol: instrument.terms(opened, str(row["market_day"]), symbol) for symbol in symbols},
                     {symbol: row["config"]["fees"] for symbol in symbols} if row["config"].get("fees") else None,
                     held_since(lines))
    fetched = None
    if preliminary:
        from replay import preliminary as rest
        output = paths.temporary_path(output)
        output.mkdir(mode=0o700, parents=True)
        market, fetched = rest.overlay(market, symbols, shared.history_start(start, run["warmup"]), end,
                                       bool(run["metrics"]), output / "market")
        at = None
    market_day, archived = shared.archive(market, at, symbols, start, end, "COMPARE_UNCOVERED")
    output, replayed, compared = shared.replay_and_compare(
        run, market, market_day, archived, candidate["source"], candidate["entry_class"], row["image_ref"], symbols,
        start, end,
        row["config"]["leverage"], ACCOUNT_CONTRACT["starting_balance_usdt"],
        output, f"trade-paper-compare-{runs.ledger_key(profile)}-{paper_id}", timeout, existing=preliminary)
    result = {"format": shared.FORMAT, "kind": "paper", "paper_id": paper_id, "candidate": row["config"]["candidate"],
              "source_sha256": row["source_sha256"], "image_ref": row["image_ref"], "market_day": market_day,
              "window": {"start": utc_text(start), "end": utc_text(end)}, "fees": row["config"].get("fees"),
              "data_source": "rest" if preliminary else "archive", "preliminary": fetched,
              "replay": replayed, **compared}
    (output / "comparison.json").write_text(json.dumps(result, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return {"path": str(output / "comparison.json"), "data_source": result["data_source"], "summary": result["summary"],
            "replay": result["replay"]}
