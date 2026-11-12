"""Live comparison (`live compare`): a Live run's evidence pack against a replay of its source on the archive
(replay.reconcile, the tool Paper and Live share; docs/plans/live-evidence-pack-20261110.zh.md).

The run is read from its private directory: the source and manifest it was prepared with (inputs/), its journal
(out/events.jsonl: the warm-up's T, the account observation it started from, its position events and each minute's
result) and its evidence pack (out/evidence/: the bars, warm-up bars and funding settlements its source received,
and the native reports of its last process). The replay runs that source on the run's image over the minutes the
source received, warmed at the same T, on the run's contract at its leverage, starting from the USDT wallet the
run started with. Nothing reaches a ledger: the comparison stays in a new temporary directory, and Live's execution
records never leave the private root (AGENTS.md).

Live's funding is the run's settlements at Binance's published rates, as a replay settles them; what Binance
actually charged is not in the evidence pack. Its equity path is that wallet plus each minute's result (native
realized and open profit) plus that funding.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
import gzip
import hashlib
import json
from pathlib import Path

from engine.live_errors import LiveRefusal
from ledger import paper as records
from live import state
from replay import reconcile as shared
from shared import paths
from shared.refusals import refuse


EVIDENCE = "evidence"
MARKET = "market.jsonl"
ORDER_EVENTS = "order_events.jsonl.gz"


def fail(code: str, message: str) -> LiveRefusal:
    return LiveRefusal(code, message)


def _lines(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    found = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            found.append(json.loads(raw))
        except ValueError:
            continue  # a torn last line of a stopped process
    return found


def _reports(evidence: Path) -> Path | None:
    """The newest native reports (reports-<ns>/): each process writes the whole run's cache."""
    found = [(int(path.name.split("-", 1)[1]), path) for path in evidence.glob("reports-*")
             if path.is_dir() and path.name.split("-", 1)[1].isdigit()]
    return max(found)[1] if found else None


def read_pack(directory: Path) -> dict:
    """{manifest, source, events (the journal), market (the evidence rows), reports (path or None), orders (native
    order events)} of one Live run."""
    inputs, out = directory / "inputs", directory / "out"
    try:
        manifest = json.loads((inputs / "manifest.json").read_text(encoding="utf-8"))
        source = (inputs / "strategy.py").read_bytes()
    except (OSError, ValueError) as exc:
        raise fail("LIVE_RECORD_UNAVAILABLE", "the run's inputs cannot be read") from exc
    if hashlib.sha256(source).hexdigest() != manifest["source"]["source_sha256"]:
        raise fail("LIVE_IDENTITY_CHANGED", "the captured source does not match the manifest")
    events = _lines(out / "events.jsonl")
    reports = _reports(out / EVIDENCE)
    if reports is not None and (reports / ORDER_EVENTS).is_file():
        orders = [json.loads(raw) for raw in gzip.open(reports / ORDER_EVENTS)]
    else:  # no process wrote its reports: the order events its source received
        orders = [row["native"] for row in events if row.get("event") == "order" and isinstance(row.get("native"), dict)]
    return {"manifest": manifest, "source": source, "events": events, "market": _lines(out / EVIDENCE / MARKET),
            "reports": reports, "orders": orders, "out": out}


def window(pack: Mapping) -> tuple[int, int]:
    """[start, end): from the warm-up's T to the close of the last one-minute bar the source received (none is
    recorded after a stop was asked for)."""
    warmed = next((row for row in pack["events"] if row.get("event") == "warmup" and isinstance(row.get("at_ns"), int)),
                  None)
    if warmed is None:
        raise refuse("LIVE_COMPARE_EMPTY", "the run's journal has no warm-up: its source never started",
                     missing=("warmup",))
    symbol = pack["manifest"]["symbols"][0]
    minute = f"{symbol}-PERP.BINANCE-{shared.MINUTE_BAR}"
    closes = [row["ts_event"] for row in pack["market"] if row.get("kind") == "bar" and row.get("bar_type") == minute]
    start = warmed["at_ns"]
    end = max(closes, default=start) + shared.MILLISECOND_NS
    if end <= start + shared.MINUTE_NS:
        raise refuse("LIVE_COMPARE_EMPTY", "the run's source received no whole minute", missing=("bars",))
    return start, end


def wallet(pack: Mapping) -> tuple[str, dict]:
    """(the USDT wallet of the account observation the run started from, that observation)."""
    started = next((row for row in pack["events"] if row.get("event") == "started" and row.get("observation")), None)
    try:
        snapshot = json.loads((pack["out"] / started["observation"]).read_text(encoding="utf-8"))  # type: ignore[index]
        value = Decimal(next(row["walletBalance"] for row in snapshot["account"]["assets"] if row["asset"] == "USDT"))
    except (TypeError, OSError, ValueError, KeyError, StopIteration) as exc:
        raise refuse("LIVE_COMPARE_EMPTY", "the run has no account observation it started from",
                     missing=("started",)) from exc
    return format(value.normalize(), "f"), snapshot


def _fees(snapshot: Mapping, symbol: str) -> dict | None:
    rates = ((snapshot.get("symbols") or {}).get(symbol) or {}).get("commission") or {}
    if "makerCommissionRate" not in rates or "takerCommissionRate" not in rates:
        return None
    return {"maker": rates["makerCommissionRate"], "taker": rates["takerCommissionRate"]}


def journal(pack: Mapping, start: int) -> list[dict]:
    """The pack as a Paper journal's lines, for ledger.paper's funding: the start, the one-minute bars and the
    position events, in the order they were written."""
    symbol = pack["manifest"]["symbols"][0]
    minute = f"{symbol}-PERP.BINANCE-{shared.MINUTE_BAR}"
    rows = [(row.get("wall_ns") or 0, {**row, "kind": "bar"}) for row in pack["market"]
            if row.get("kind") == "bar" and row.get("bar_type") == minute]
    rows += [(row.get("observed_ns") or 0, {**row["native"], "kind": "position"}) for row in pack["events"]
             if row.get("event") == "position" and isinstance(row.get("native"), dict)]
    return [{"kind": "started", "input_start_ns": start}] + [line for _, line in sorted(rows, key=lambda item: item[0])]


def run_record(pack: Mapping, balance: str, snapshot: Mapping, settled: list[dict]) -> dict:
    """The pack as replay.reconcile.compare reads a run."""
    symbol = pack["manifest"]["symbols"][0]
    funding = sorted((item["settlement_ns"], item["funding"]) for item in settled)
    equity, applied, paid = [], 0, Decimal(0)
    for row in sorted((row for row in pack["events"] if row.get("event") == "minute_result"
                       and isinstance(row.get("minute_ns"), int) and row.get("result") is not None),
                      key=lambda row: row["minute_ns"]):
        while applied < len(funding) and funding[applied][0] <= row["minute_ns"] + shared.MINUTE_NS:
            paid += funding[applied][1]
            applied += 1
        equity.append((row["minute_ns"], Decimal(balance) + Decimal(row["result"]) + paid))
    return {"bars": [row for row in pack["market"] if row.get("kind") == "bar"],
            "warmup": shared.received_warmup(row for row in pack["market"] if row.get("kind") == "historical_bar"),
            "events": pack["orders"], "settlements": settled, "equity": equity,
            "terms": dict((pack["manifest"].get("market") or {}).get("terms") or {}), "fees": _fees(snapshot, symbol)}


def compare(root: Path, run_id: str, market: dict, at: str | None, output: Path, timeout: float | None = None) -> dict:
    """live compare: replay a Live run's minutes on the archive and write reconcile.json."""
    from market import files, instrument
    pack = read_pack(state.directory(root, run_id))
    manifest = pack["manifest"]
    symbols = list(manifest["symbols"])
    start, end = window(pack)
    balance, snapshot = wallet(pack)
    market_day, archive = shared.archive(market, at, symbols, start, end, "LIVE_COMPARE_UNCOVERED")
    opened = files.open_market(market, "reader")
    replay_terms = {symbol: instrument.terms(opened, market_day, symbol) for symbol in symbols}
    lines = journal(pack, start)
    settled = records.settlements(lines, records.published_settlements(lines, end))
    run = run_record(pack, balance, snapshot, settled)
    archived = {symbol: shared.archive_warmup(market, market_day, symbol, start,
                                              run["warmup"].get(f"{symbol}-PERP.BINANCE", {}), replay_terms[symbol])
                for symbol in symbols}
    output = paths.temporary_path(output)
    output.mkdir(mode=0o700, parents=True)
    replayed, events, reports = shared.replay(
        market, market_day, pack["source"], manifest["source"]["entry_class"], manifest["runtime"]["image_ref"],
        symbols, start, end, manifest["config"]["leverage"], balance, output / "replay",
        f"trade-live-compare-{run_id}", timeout)
    compared = shared.compare(run, events, archive, reports, start, end, archived_warmup=archived,
                              replay_terms=replay_terms,
                              replay_fees={"maker": instrument.ASSUMED["maker_fee"],
                                           "taker": instrument.ASSUMED["taker_fee"]})
    result = {"format": shared.FORMAT, "kind": "live", "run_id": run_id, "candidate": manifest["candidate"],
              "source_sha256": manifest["source"]["source_sha256"], "image_ref": manifest["runtime"]["image_ref"],
              "market_day": market_day, "window": {"start": shared._utc(start), "end": shared._utc(end)},
              "starting_balance_usdt": balance, "replay": replayed, **compared}
    (output / "reconcile.json").write_text(json.dumps(result, indent=2, sort_keys=True, default=str), encoding="utf-8")
    return {"path": str(output / "reconcile.json"), "summary": result["summary"], "replay": result["replay"]}
