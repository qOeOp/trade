"""Live comparison (`live compare`): a Live run's evidence pack against a replay of its source on the archive
(replay.reconcile, the tool Paper and Live share; docs/plans/live-evidence-pack-20261110.zh.md).

The run is read from its private directory: the source and manifest it was prepared with (inputs/), its journal
(out/events.jsonl: the warm-up's T, the account observation it started from, its position events and each minute's
result) and its evidence pack (out/evidence/: the bars, warm-up bars and funding settlements its source received,
and the native reports of its last process). The replay runs that source on the run's image over the minutes the
source received, warmed at the same T, on the run's contract at its leverage, starting from the USDT wallet the
run started with. Nothing reaches a ledger: the comparison stays in a new temporary directory, and Live's execution
records never leave the private root (AGENTS.md).

A run that restarts trades in segments: each trading start (a process that warmed its source; one that held an
inherited position did not) rebuilds the source from its own T. A segment is compared on its own: its warm-up's T,
the wallet it started from, the evidence and journal lines of its process and the orders it initialized. Its result is
the native cache's since that process began (the cache outlives processes), and `measures` sums the comparison in a
time window for the weekly report (docs/plans/live-continuous-operation-design-20261110.zh.md §3.6). A comparison may
end before the run's evidence does (`until`, --to): a running run's evidence reaches this minute while the market's
archive reaches only its last whole day (docs/plans/live-continuous-step7b-daily-compare-20261113.zh.md).

Live's funding is the run's settlements at Binance's published rates, as a replay settles them; what Binance
actually charged is not in the evidence pack. Its equity path is that wallet plus each minute's result (native
realized and open profit) plus that funding.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from decimal import Decimal
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import secrets

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


def instant(text: str) -> int:
    """An ISO time (UTC when it names no zone) in nanoseconds: --from and --to."""
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return round((moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp() * 10**6) * 1000


def segments(pack: Mapping) -> list[dict]:
    """The run's trading starts, oldest first: {start (its warm-up's T), first, last (its process's journal lines),
    since, until (the wall time its process began, the next one began; None when unbounded)}. A process begins at its
    `connecting`; a journal without any is one process."""
    events = pack["events"]
    cuts = [i for i, row in enumerate(events) if row.get("event") == "connecting"][1:]
    found = []
    for first, last in itertools.pairwise([0, *cuts, len(events)]):
        warmed = next((row for row in events[first:last] if row.get("event") == "warmup"
                       and isinstance(row.get("at_ns"), int)), None)
        if warmed is not None:
            found.append({"start": warmed["at_ns"], "first": first, "last": last,
                          "since": events[first].get("observed_ns") if first else None,
                          "until": events[last].get("observed_ns") if last < len(events) else None})
    return found


def segment(pack: Mapping, number: int | None) -> tuple[dict, dict]:
    """(segment `number` (1 is the first; None the latest) as a pack of its own, {number, of}): its process's journal
    lines and evidence rows, the orders it initialized, and each minute's result since its process began."""
    found = segments(pack)
    if not found:
        raise refuse("LIVE_COMPARE_EMPTY", "the run's journal has no warm-up: its source never started",
                     missing=("warmup",))
    number = len(found) if number is None else number
    if not 1 <= number <= len(found):
        raise refuse("LIVE_COMPARE_EMPTY", f"the run has {len(found)} trading starts, not a start {number}",
                     missing=("segment",))
    item = found[number - 1]
    since, until = item["since"], item["until"]

    def inside(ns) -> bool:
        return (since is None or (ns or 0) >= since) and (until is None or (ns or 0) < until)

    lines = [dict(row) for row in pack["events"][item["first"]:item["last"]]]
    # The cache outlives processes: a process begins flat, so its first known result is what it inherited.
    inherited = next((Decimal(row["result"]) for row in lines
                      if row.get("event") == "minute_result" and row.get("result") is not None), Decimal(0))
    for row in lines:
        if row.get("event") == "minute_result" and row.get("result") is not None:
            row["result"] = shared._text(Decimal(row["result"]) - inherited)
    initialized = {event["client_order_id"] for event in pack["orders"] if event.get("type") == "OrderInitialized"
                   and item["start"] <= (event.get("ts_init") or 0) and (until is None or event["ts_init"] < until)}
    return ({**pack, "events": lines, "market": [row for row in pack["market"] if inside(row.get("wall_ns"))],
             "orders": [event for event in pack["orders"] if event.get("client_order_id") in initialized]},
            {"number": number, "of": len(found)})


def cut(pack: Mapping, until: int) -> dict:
    """The pack as it stood at `until`: journal lines observed, minutes, evidence rows (by event time when they have
    one) and order events initialized before it."""
    def before(row: Mapping, *keys: str) -> bool:
        ns = next((row[key] for key in keys if isinstance(row.get(key), int)), None)
        return ns is None or ns < until

    events = [row for row in pack["events"] if before(row, "minute_ns", "observed_ns")]
    return {**pack, "events": events, "market": [row for row in pack["market"] if before(row, "ts_event", "wall_ns")],
            "orders": [event for event in pack["orders"] if before(event, "ts_init", "ts_event")]}


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


GATE_REASONS = frozenset({"disconnected", "unverified", "unknown_orders", "account_mode", "foreign", "bars_missing"})


def gate(events: list[dict]) -> dict:
    """The entries Live's entry gate changed (engine.live_connection), as replay.reconcile attributes them: those sent
    after a hold, those withdrawn when the gate closed, those it denied natively, and the decision times of those
    refused after a hold."""
    return {"released": [row["client_order_id"] for row in events if row.get("event") == "entry_released"],
            "denied": [row["client_order_id"] for row in events if row.get("event") == "entry_denied"],
            "withdrawn": [row["client_order_id"] for row in events if row.get("event") == "entry_cancel_requested"
                          and row.get("reason") in GATE_REASONS],
            "refused": [row["ts_init"] for row in events if row.get("event") == "entry_refused"
                        and row.get("held_ns") is not None and isinstance(row.get("ts_init"), int)]}


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
    return {"bars": [row for row in pack["market"] if row.get("kind") == "bar"], "gate": gate(pack["events"]),
            "warmup": shared.received_warmup(row for row in pack["market"] if row.get("kind") == "historical_bar"),
            "events": pack["orders"], "settlements": settled, "equity": equity,
            "terms": dict((pack["manifest"].get("market") or {}).get("terms") or {}), "fees": _fees(snapshot, symbol)}


def _percentile(values: list[int], share: float) -> int | None:
    """The nearest-rank percentile."""
    ordered = sorted(values)
    return ordered[max(math.ceil(share * len(ordered)) - 1, 0)] if ordered else None


def _change(path: list[list], since: int | None, until: int | None) -> Decimal | None:
    inside = [Decimal(value) for minute, value in path
              if (since is None or minute >= since) and (until is None or minute < until)]
    return inside[-1] - inside[0] if inside else None


def measures(compared: Mapping, events: list[dict], since: int | None = None, until: int | None = None) -> dict:
    """The comparison's sums over the groups decided in [since, until) (§3.6's fills and holds): entries the replay
    filled and Live did not, Live orders filled in part, the mean adverse fill price difference in basis points (Live's
    buy above or sell below the replay's is positive), fees (Live's less the replay's), the equity change in the window
    (Live's less the replay's), and the entries Live's gate held: how many, how long until each was sent or refused,
    and how many runs a hold ended."""
    def inside(ns) -> bool:
        return isinstance(ns, int) and (since is None or ns >= since) and (until is None or ns < until)

    rows = [row for group in compared["groups"] or [] if inside(group["at_ns"]) for row in group["orders"]]
    filled = [row for row in rows if row["run"] and row["replay"] and row["run"]["fill"] and row["replay"]["fill"]]
    adverse = [row["price_bps"] * (1 if row["side"] == "BUY" else -1) for row in filled]
    fees = {side: sum((Decimal(row[side]["fill"]["commission"] or 0) for row in rows
                       if row[side] and row[side]["fill"]), Decimal(0)) for side in ("run", "replay")}
    text = shared._text
    run, replay = (_change(compared["equity"][side], since, until) for side in ("run", "replay"))
    held = [row for row in events if row.get("event") == "entry_held" and inside(row.get("ts_init"))]
    ended = [row["held_ns"] for row in events if row.get("event") in ("entry_released", "entry_refused", "entry_denied")
             and isinstance(row.get("held_ns"), int) and inside(row.get("ts_init"))]
    return {"groups": sum(inside(group["at_ns"]) for group in compared["groups"] or []),
            "entries_unfilled": sum(row["role"] == "entry" and bool(row["run"]) and not row["run"]["fill"]
                                    and bool(row["replay"]) and bool(row["replay"]["fill"]) for row in rows),
            "partial_fills": sum(bool(row["run"] and row["run"]["fill"] and row["run"]["qty"] is not None
                                      and Decimal(row["run"]["fill"]["qty"]) < Decimal(row["run"]["qty"]))
                                 for row in rows),
            "fills_paired": len(filled),
            "adverse_slippage_bps": sum(adverse) / len(adverse) if adverse else None,
            "fees": {"run": text(fees["run"]), "replay": text(fees["replay"]),
                     "difference": text(fees["run"] - fees["replay"])},
            "equity_change": {"run": text(run), "replay": text(replay),
                              "difference": text(run - replay) if run is not None and replay is not None else None},
            "holds": {"held": len(held), "held_ns": sorted(ended), "held_ns_median": _percentile(ended, 0.5),
                      "held_ns_p90": _percentile(ended, 0.9),
                      "ended_runs": sum(row.get("event") == "entry_refused" and isinstance(row.get("held_ns"), int)
                                        and inside(row.get("ts_init")) for row in events)}}


def segment_image(directory: Path, manifest: Mapping, pack: Mapping) -> str:
    """The runtime image the segment's process ran on: that of the latest launch requested before its first journal
    line (live.runs.launch_runtime; the manifest's for a launch that names none)."""
    from live import runs
    first = next((row["observed_ns"] for row in pack["events"] if isinstance(row.get("observed_ns"), int)), None)
    launches = [row for row in state.events(directory / "lifecycle.jsonl") if row.get("event") == "launch_requested"
                and (first is None or row.get("observed_ns", 0) <= first)]
    return runs.launch_runtime(directory, dict(manifest), launches[-1] if launches else None)["image_ref"]


def compare(root: Path, run_id: str, market: dict, at: str | None, output: Path, timeout: float | None = None,
            number: int | None = None, since: int | None = None, until: int | None = None,
            image_ref: str | None = None) -> dict:
    """live compare: replay one trading start of a Live run (the latest by default) up to `until` (its last minute by
    default) on the archive and write reconcile.json, with its measures over [since, until). Its result also lists
    the decisions the comparison could not explain (cause unexplained, at the decision stage), so a caller never
    reads reconcile.json. The replay runs on the image the start ran on, or on `image_ref` (the paired replay of an
    offered runtime image, live.daily)."""
    from market import files, instrument
    directory = state.directory(root, run_id)
    pack, numbered = segment(read_pack(directory), number)
    image_ref = image_ref or segment_image(directory, pack["manifest"], pack)
    if until is not None:
        pack = cut(pack, until)
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
        market, market_day, pack["source"], manifest["source"]["entry_class"], image_ref,
        symbols, start, end, manifest["config"]["leverage"], balance, output / "replay",
        f"trade-live-compare-{run_id}-{secrets.token_hex(4)}", timeout)
    compared = shared.compare(run, events, archive, reports, start, end, archived_warmup=archived,
                              replay_terms=replay_terms,
                              replay_fees={"maker": instrument.ASSUMED["maker_fee"],
                                           "taker": instrument.ASSUMED["taker_fee"]})
    result = {"format": shared.FORMAT, "kind": "live", "run_id": run_id, "candidate": manifest["candidate"],
              "source_sha256": manifest["source"]["source_sha256"], "image_ref": image_ref,
              "market_day": market_day, "window": {"start": shared._utc(start), "end": shared._utc(end)},
              "segment": numbered, "starting_balance_usdt": balance, "replay": replayed, **compared,
              "measures": {"from": shared._utc(since) if since is not None else None,
                           "to": shared._utc(until) if until is not None else None,
                           **measures(compared, pack["events"], since, until)}}
    (output / "reconcile.json").write_text(json.dumps(result, indent=2, sort_keys=True, default=str), encoding="utf-8")
    unexplained = [{"at": group.get("at"), "at_ns": group["at_ns"], "class": group["class"]}
                   for group in compared["groups"] or []
                   if group.get("cause") == "unexplained" and group.get("stage") == "decision"]
    return {"path": str(output / "reconcile.json"), "segment": numbered, "window": result["window"],
            "market_day": market_day, "summary": result["summary"], "measures": result["measures"],
            "replay": result["replay"], "unexplained": unexplained}
