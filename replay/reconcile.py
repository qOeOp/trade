"""An execution run against a replay of its own source on the archive, one tool for Paper and Live
(docs/plans/execution-paths-replan-20261110.zh.md, R3.2; docs/plans/run-reconcile-20261112.zh.md).

Paper (paper.reconcile) and Live (live.compare) read their run into one record: the one-minute bars its source
received, the warm-up it received, its native order events, its funding settlements, its equity path and the
contract terms and fee rates it traded at. The replay runs the run's source on its image over the same window, with
the same instruments, leverage and starting balance and the same warm-up (the source's WARMUP, requested at the
window's start); it is no trial and writes nothing to a ledger.

The comparison goes in order: input bars, then decisions (which order, when, at what price and quantity), then
fills, fees and funding, then the equity path.

Orders are compared in groups. Positions are HEDGING, one per entry order (engine.order_rules), so an entry order,
the position it opened and every exit order of that position (its stops, targets and partial exits) are one group.
An exit that filled names its position; an exit that never filled is given to the position it could close (the
latest one opened on its contract and opposite side that still held its quantity). Groups pair per contract and
entry side, nearest entry decision first, within PAIR_NS; inside a pair the entries pair and the exits pair per role
in the order they were sent, so a scale-out's second target meets the other side's second target.

Each group's first difference since its contract's previous agreeing group takes its cause from what the product
knows, in this order (user 2026-11-12): a live bar missing, a live bar late, a live bar unlike the archive's, a
warm-up unlike the archive's (while the difference falls within the warm-up's reach), contract terms or fee rates
unlike the replay's, or a lone group at the window's end. Only when none applies is it unexplained, and only an
unexplained difference that the replay made alone (a group or an order only the replay had) is a look-ahead
suspect. Once the paths part, the positions they trade from differ, so each later difference up to the next
agreeing group is a consequence of that first one.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import ast
import csv
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN
import gzip
import hashlib
import itertools
import json
from pathlib import Path

from shared.refusals import refuse


FORMAT = "run-reconcile@2026-11-12"
MINUTE_NS = 60 * 10**9
MILLISECOND_NS = 10**6
ON_TIME_NS = MINUTE_NS  # a decision or fill within one bar of its counterpart is on time
PAIR_NS = 10 * MINUTE_NS  # an uncalibrated example value: entries further apart are different trades
LATE_NS = 2 * 10**9  # a bar reaching the source later than this after its close is late (engine.paper.LATE_BAR_NS)
CENT = Decimal("0.00000001")  # USDT's precision
LISTED = 50  # bars listed per contract and kind; the counts are complete
ROLES = {"ENTRY": "entry", "STOP_LOSS": "stop", "TAKE_PROFIT": "target"}
BAR_FIELDS = ("open", "high", "low", "close", "volume")
MINUTE_BAR = "1-MINUTE-LAST-EXTERNAL"
PERIODS = {"1-MINUTE": 1, "3-MINUTE": 3, "5-MINUTE": 5, "15-MINUTE": 15, "30-MINUTE": 30, "1-HOUR": 60,
           "2-HOUR": 120, "4-HOUR": 240, "6-HOUR": 360, "8-HOUR": 480, "12-HOUR": 720, "1-DAY": 1440}  # engine.warmup
CAUSES = ("missing_bar", "late_bar", "bar_mismatch", "warmup", "contract_terms", "window_end",
          "entry_gate")  # in this order
STAGES = ("decision", "fill", "fee", "funding")  # a group's first difference is looked for in this order
FINAL = {"OrderFilled": "filled", "OrderCanceled": "canceled", "OrderExpired": "expired",
         "OrderRejected": "rejected", "OrderDenied": "denied"}


def _utc(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _amount(value) -> Decimal | None:
    """A Nautilus amount ("0.25 USDT", "0.25") as a Decimal."""
    if value is None or value == "":
        return None
    return Decimal(str(value).split()[0])


def _text(value: Decimal | None) -> str | None:
    return None if value is None else format(value.normalize(), "f")


def symbol_of(instrument_id: str) -> str:
    return instrument_id.split("-", 1)[0]


# Orders and groups

def orders(events: Iterable[Mapping]) -> list[dict]:
    """Each order the native events name, by its first event: {order, instrument, side, type, role, reduce_only,
    init_ns, qty (ordered), price (its limit), trigger, status, position (of its fills), parent, filled (None, or
    {ts_ns of its first fill, qty, px: the quantity-weighted price, commission})}."""
    found: dict[str, dict] = {}
    for event in events:
        name, kind = event.get("client_order_id"), event.get("type")
        if name is None:
            continue
        item = found.setdefault(name, {"order": name, "instrument": event.get("instrument_id"),
                                       "side": event.get("order_side"), "type": event.get("order_type"),
                                       "role": "other", "reduce_only": False, "init_ns": event.get("ts_event"),
                                       "qty": None, "price": None, "trigger": None, "status": "open",
                                       "position": None, "parent": None, "filled": None})
        if kind == "OrderInitialized":
            tags = event.get("tags") or []
            item.update(side=event.get("order_side"), type=event.get("order_type"), init_ns=event.get("ts_init"),
                        role=next((ROLES[tag] for tag in tags if tag in ROLES), (tags[0] if tags else "other").lower()),
                        reduce_only=bool(event.get("reduce_only")), qty=_amount(event.get("quantity")),
                        price=_amount(event.get("price")), trigger=_amount(event.get("trigger_price")),
                        parent=event.get("parent_order_id"))
        elif kind == "OrderFilled":
            qty, px = _amount(event.get("last_qty")), _amount(event.get("last_px"))
            assert qty is not None and px is not None, "a Nautilus OrderFilled always carries last_qty and last_px"
            filled = item["filled"] or {"ts_ns": event.get("ts_event"), "qty": Decimal(0), "notional": Decimal(0),
                                        "commission": Decimal(0)}
            filled["qty"] += qty
            filled["notional"] += qty * px
            filled["commission"] += _amount(event.get("commission")) or Decimal(0)
            item["filled"] = filled
            item["position"] = item["position"] or event.get("position_id")
            item["status"] = "filled"
        elif kind in FINAL:
            item["status"] = FINAL[kind]
    for item in found.values():
        if item["filled"]:
            filled = item["filled"]
            filled["px"] = filled.pop("notional") / filled["qty"]
    return sorted(found.values(), key=lambda item: (item["init_ns"] or 0, item["order"]))


def _opposite(side: str | None) -> str | None:
    return {"BUY": "SELL", "SELL": "BUY"}.get(side or "")


def _start(group: Mapping) -> int:
    first = group["entry"] or group["exits"][0]
    return first["init_ns"] or 0


def groups(found: list[dict]) -> list[dict]:
    """The orders as groups {instrument, side (the position's), entry (None for exits of a position the window did not
    open), exits, position}, by their entry's decision time."""
    result: list[dict] = []
    by_position: dict[str, dict] = {}
    by_order: dict[str, dict] = {}
    for item in found:
        if not item["reduce_only"]:
            opened = {"instrument": item["instrument"], "side": item["side"], "entry": item, "exits": [],
                      "position": item["position"]}
            result.append(opened)
            by_order[item["order"]] = opened
            if item["position"]:
                by_position[item["position"]] = opened
    unplaced: list[dict] = []
    for item in found:
        if not item["reduce_only"]:
            continue
        group: dict | None = by_position.get(item["position"]) if item["position"] else by_order.get(item["parent"] or "")
        if group is None and item["position"]:
            group = {"instrument": item["instrument"], "side": _opposite(item["side"]), "entry": None, "exits": [],
                     "position": item["position"]}
            result.append(group)
            by_position[item["position"]] = group
        if group is None:
            unplaced.append(item)
        else:
            group["exits"].append(item)
    for item in unplaced:  # an exit that never filled: the position it could close when it was sent
        group = _holder(result, item)
        if group is None:
            group = {"instrument": item["instrument"], "side": _opposite(item["side"]), "entry": None,
                     "exits": [], "position": None}
            result.append(group)
        group["exits"].append(item)
    for group in result:
        group["exits"].sort(key=_sent)
    return sorted(result, key=lambda group: (_start(group), (group["entry"] or group["exits"][0])["order"]))


def _sent(item: Mapping) -> tuple:
    """An exit's place among its group's: by when it was decided, then, among those decided at the same instant (a
    scale-out's targets), by its terms. Neither the IDs (a replay's are UUIDs) nor the native reports (grouped by ID)
    give the order they were sent in."""
    return (item["init_ns"] or 0, item["price"] if item["price"] is not None else Decimal(-1),
            item["trigger"] if item["trigger"] is not None else Decimal(-1), item["qty"] or Decimal(0), item["order"])


def _holder(found: list[dict], exit_: Mapping) -> dict | None:
    """The latest group opened on the exit's contract and opposite side, before it was sent, that still held its
    quantity then."""
    at = exit_["init_ns"] or 0
    best = None
    for group in found:
        entry = group["entry"]
        if (group["instrument"] != exit_["instrument"] or group["side"] == exit_["side"] or entry is None
                or not entry["filled"] or entry["filled"]["ts_ns"] > at):
            continue
        closed = sum((item["filled"]["qty"] for item in group["exits"]
                      if item["filled"] and item["filled"]["ts_ns"] <= at), Decimal(0))
        if entry["filled"]["qty"] - closed >= (exit_["qty"] or Decimal(0)) and (
                best is None or entry["filled"]["ts_ns"] >= best["entry"]["filled"]["ts_ns"]):
            best = group
    return best


def _terms_of(order: Mapping | None) -> tuple:
    return (order["type"], order["qty"], order["price"], order["trigger"]) if order else ()


def pair(run: list[dict], replay: list[dict]) -> list[tuple[dict | None, dict | None]]:
    """Run and replay groups paired per contract and side, the nearest entry decisions within PAIR_NS first (an equal
    order before a different one at the same distance); the rest stand alone. By the earlier side's start."""
    candidates = []
    for i, mine in enumerate(run):
        for j, other in enumerate(replay):
            if (mine["instrument"], mine["side"]) != (other["instrument"], other["side"]):
                continue
            if (mine["entry"] is None) != (other["entry"] is None):
                continue
            distance = abs(_start(mine) - _start(other))
            if distance <= PAIR_NS:
                candidates.append((distance, _terms_of(mine["entry"]) != _terms_of(other["entry"]), i, j))
    taken_run: set[int] = set()
    taken_replay: set[int] = set()
    pairs: list[tuple[dict | None, dict | None]] = []
    for _, _, i, j in sorted(candidates):
        if i not in taken_run and j not in taken_replay:
            taken_run.add(i)
            taken_replay.add(j)
            pairs.append((run[i], replay[j]))
    pairs += [(mine, None) for i, mine in enumerate(run) if i not in taken_run]
    pairs += [(None, other) for j, other in enumerate(replay) if j not in taken_replay]
    return sorted(pairs, key=lambda p: min(_start(group) for group in p if group))


# Within a group

def _view(order: Mapping | None) -> dict | None:
    if order is None:
        return None
    filled = order["filled"]
    return {"order": order["order"], "type": order["type"], "init": _utc(order["init_ns"] or 0),
            "init_ns": order["init_ns"], "qty": _text(order["qty"]), "price": _text(order["price"]),
            "trigger": _text(order["trigger"]), "status": order["status"],
            "fill": None if not filled else {"ts": _utc(filled["ts_ns"]), "ts_ns": filled["ts_ns"],
                                             "qty": _text(filled["qty"]), "px": _text(filled["px"]),
                                             "commission": _text(filled["commission"])}}


def _order_rows(run: Mapping | None, replay: Mapping | None) -> list[tuple[dict | None, dict | None]]:
    """The group's orders paired: the entries, then each role's exits in the order they were sent."""
    rows: list[tuple[dict | None, dict | None]] = []
    if (run and run["entry"]) or (replay and replay["entry"]):
        rows.append((run["entry"] if run else None, replay["entry"] if replay else None))
    exits_run = (run or {}).get("exits", [])
    exits_replay = (replay or {}).get("exits", [])
    roles = list(dict.fromkeys(item["role"] for item in [*exits_run, *exits_replay]))
    paired: list[tuple[dict | None, dict | None]] = []
    for role in roles:
        paired += itertools.zip_longest([item for item in exits_run if item["role"] == role],
                                        [item for item in exits_replay if item["role"] == role])
    rows += sorted(paired, key=lambda p: min(item["init_ns"] or 0 for item in p if item))
    return rows


def _row(run: dict | None, replay: dict | None) -> dict:
    """One order pair: its stage (decision, fill, fee) and class (same, time, type, quantity, price, amount,
    run_only, replay_only) of its first difference."""
    either = run or replay
    assert either is not None
    item = {"role": either["role"], "side": either["side"], "run": _view(run), "replay": _view(replay)}
    if run is None or replay is None:
        stage, kind = "decision", "run_only" if replay is None else "replay_only"
    elif run["type"] != replay["type"]:
        stage, kind = "decision", "type"
    elif abs((run["init_ns"] or 0) - (replay["init_ns"] or 0)) > ON_TIME_NS:
        stage, kind = "decision", "time"
    elif run["qty"] != replay["qty"]:
        stage, kind = "decision", "quantity"
    elif (run["price"], run["trigger"]) != (replay["price"], replay["trigger"]):
        stage, kind = "decision", "price"
    elif bool(run["filled"]) != bool(replay["filled"]):
        stage, kind = "fill", "run_only" if run["filled"] else "replay_only"
    elif run["filled"] and abs(run["filled"]["ts_ns"] - replay["filled"]["ts_ns"]) > ON_TIME_NS:
        stage, kind = "fill", "time"
    elif run["filled"] and run["filled"]["qty"] != replay["filled"]["qty"]:
        stage, kind = "fill", "quantity"
    elif run["filled"] and run["filled"]["px"] != replay["filled"]["px"]:
        stage, kind = "fill", "price"
    elif run["filled"] and run["filled"]["commission"] != replay["filled"]["commission"]:
        stage, kind = "fee", "amount"
    else:
        stage, kind = None, "same"
    item |= {"stage": stage, "class": kind}
    if run and replay:
        item["decision_delay_ms"] = ((run["init_ns"] or 0) - (replay["init_ns"] or 0)) // MILLISECOND_NS
        if run["filled"] and replay["filled"]:
            item["delay_ms"] = (run["filled"]["ts_ns"] - replay["filled"]["ts_ns"]) // MILLISECOND_NS
            item["price_bps"] = float((run["filled"]["px"] - replay["filled"]["px"]) / replay["filled"]["px"] * 10_000)
    return item


def _times(item: Mapping) -> list[int]:
    return [value for side in (item["run"], item["replay"]) if side
            for value in (side["init_ns"], (side["fill"] or {}).get("ts_ns")) if value is not None]


def compare_group(run: dict | None, replay: dict | None, run_funding: Mapping[str, Decimal],
                  replay_funding: Mapping[str, Decimal]) -> dict:
    """A group pair's orders, its funding and its first difference: stage, class and the order row it is in."""
    either = run or replay
    assert either is not None
    rows = [_row(a, b) for a, b in _order_rows(run, replay)]
    funding = {"run": _text(run_funding.get(run["position"] or "", Decimal(0))) if run else None,
               "replay": _text(replay_funding.get(replay["position"] or "", Decimal(0))) if replay else None}
    result: dict = {"instrument": either["instrument"], "side": either["side"],
              "at": _utc(min(_start(group) for group in (run, replay) if group)),
              "at_ns": min(_start(group) for group in (run, replay) if group),
              "run_position": run["position"] if run else None,
              "replay_position": replay["position"] if replay else None,
              "orders": rows, "funding": funding}
    if run is None or replay is None:
        result |= {"class": "run_only" if replay is None else "replay_only", "stage": "decision", "first": 0}
        return result
    for stage in STAGES[:3]:
        found = next((i for i, item in enumerate(rows) if item["stage"] == stage), None)
        if found is not None:
            return result | {"class": "differs", "stage": stage, "first": found}
    if abs(Decimal(funding["run"] or 0) - Decimal(funding["replay"] or 0)) > CENT:
        return result | {"class": "differs", "stage": "funding", "first": None}
    return result | {"class": "same", "stage": None, "first": None}


def _span(group: Mapping) -> tuple[int, int]:
    """The first and last time a group's orders were sent or filled, on either side."""
    found = [value for item in group["orders"] for value in _times(item)] or [group["at_ns"]]
    return min(found), max(found)


def _lone(group: Mapping) -> bool:
    """The group's first difference is something only one side did."""
    if group["class"] in ("run_only", "replay_only"):
        return True
    first = group["first"]
    return first is not None and group["orders"][first]["class"] in ("run_only", "replay_only")


def _replay_alone(group: Mapping) -> bool:
    if group["class"] == "replay_only":
        return True
    first = group["first"]
    return first is not None and group["orders"][first]["class"] == "replay_only"


# Inputs

def _period(bar_type: str, instrument_id: str) -> str:
    """'1-HOUR' of 'BTCUSDT-PERP.BINANCE-1-HOUR-LAST-EXTERNAL'."""
    return bar_type[len(instrument_id) + 1:].rsplit("-", 2)[0]


def bars(run_bars: list[dict], archive: Mapping[str, list[list]], start: int, end: int) -> dict[str, dict]:
    """Per contract, the one-minute bars the run's source received against the archive's: {missing: closes of
    archive bars no live bar matched, late: closes of live bars that reached the source more than LATE_NS after
    their close, differing: {close: {field: [live, archive]}}, live_only}."""
    live: dict[str, dict[int, dict]] = {}
    for line in run_bars:
        if line.get("bar_type", f"{line['instrument_id']}-{MINUTE_BAR}") != f"{line['instrument_id']}-{MINUTE_BAR}":
            continue  # an aggregation a Live source subscribed to
        if start < line["ts_event"] <= end:
            live.setdefault(symbol_of(line["instrument_id"]), {})[line["ts_event"]] = line
    result = {}
    for symbol, rows in archive.items():
        stored = {row[1] * MILLISECOND_NS: dict(zip(BAR_FIELDS, row[2:7], strict=True)) for row in rows}
        mine = live.get(symbol, {})
        differing = {}
        for close, bar in stored.items():
            if close in mine:
                fields = {name: [mine[close][name], bar[name]] for name in BAR_FIELDS
                          if Decimal(mine[close][name]) != Decimal(bar[name])}
                if fields:
                    differing[close] = fields
        late = sorted(close for close, bar in mine.items()
                      if isinstance(bar.get("wall_ns"), int) and bar["wall_ns"] - (close + MILLISECOND_NS) > LATE_NS)
        result[symbol] = {"archive": len(stored), "live": len(mine), "late": late,
                          "missing": sorted(set(stored) - set(mine)), "live_only": sorted(set(mine) - set(stored)),
                          "differing": differing}
    return result


def digest(rows: Iterable[tuple]) -> dict:
    """A history as engine.paper.warmup_digest records it: rows (ts_event, open, high, low, close, volume) as text."""
    found = list(rows)
    text = "\n".join(",".join(str(value) for value in row) for row in found)
    return {"bars": len(found), "first_ts_event": found[0][0] if found else None,
            "last_ts_event": found[-1][0] if found else None, "sha256": hashlib.sha256(text.encode()).hexdigest()}


def received_warmup(historical: Iterable[Mapping]) -> dict[str, dict[str, dict]]:
    """The digest of each history (`historical_bar` rows of a Live evidence pack) per contract and period."""
    found: dict[str, dict[str, list[tuple]]] = {}
    for line in historical:
        iid = line["instrument_id"]
        found.setdefault(iid, {}).setdefault(_period(line["bar_type"], iid), []).append(
            (line["ts_event"], *(line[name] for name in BAR_FIELDS)))
    return {iid: {period: digest(sorted(rows)) for period, rows in periods.items()} for iid, periods in found.items()}


def _places(increment: str) -> list[int]:
    """The precisions a contract's bars may be written at: its increment's decimals as the market stores it, and
    without trailing zeros (a venue may give either)."""
    from market.instrument import decimals
    return sorted({decimals(increment), decimals(format(Decimal(increment).normalize(), "f"))})


def _at(value, places: int) -> str:
    return format(Decimal(value).quantize(Decimal(1).scaleb(-places), ROUND_HALF_EVEN), "f")


def archive_warmup(market: dict, market_day: str, symbol: str, at: int, received: Mapping[str, Mapping],
                   terms: Mapping) -> dict[str, dict]:
    """Per period the run received, the same bars from the archive's minutes: `received`'s count of bars of the
    period ending 1 ms before floor(at, P) (engine.warmup.history_range), each aggregated from its minutes, as
    digests {bars, first_ts_event, last_ts_event, sha256s}: one per precision the contract's bars may be written at
    (_places), so the text compares as Nautilus wrote it."""
    from market import read
    found = {}
    for period, got in received.items():
        step = PERIODS[period] * MINUTE_NS
        count = got.get("bars") or 0
        end = at // step * step
        first_open = end - count * step
        rows = []
        if count:
            stored = read.stored_bars(market, market_day, symbol, "LAST", "1m", _utc(first_open), _utc(end), None,
                                      funding=False)["bars"]["rows"]
            buckets: dict[int, list] = {}
            for row in stored:
                buckets.setdefault(row[0] * MILLISECOND_NS // step * step, []).append(row)
            for opened in range(first_open, end, step):
                minutes = buckets.get(opened)
                if minutes:
                    rows.append((opened + step - MILLISECOND_NS, Decimal(minutes[0][2]),
                                 max(Decimal(row[3]) for row in minutes), min(Decimal(row[4]) for row in minutes),
                                 Decimal(minutes[-1][5]), sum((Decimal(row[6]) for row in minutes), Decimal(0))))
        written = [digest([(row[0], *(_at(value, price) for value in row[1:5]), _at(row[5], size)) for row in rows])
                   for price in _places(terms["price_increment"]) for size in _places(terms["size_increment"])]
        found[period] = {key: written[0][key] for key in ("bars", "first_ts_event", "last_ts_event")} | {
            "sha256s": sorted({item["sha256"] for item in written})}
    return found


def warmup(received: Mapping[str, Mapping[str, Mapping]], archived: Mapping[str, Mapping[str, Mapping]]) -> dict:
    """Per contract and period, the warm-up the run received against the archive's: {run, archive, same}, and its
    reach: how long after the start its bars stay in the source's window (bars times the period)."""
    result = {}
    for iid, periods in received.items():
        symbol = symbol_of(iid)
        found = {}
        for period, got in periods.items():
            expected = (archived.get(symbol) or {}).get(period)
            found[period] = {"run": dict(got), "archive": expected, "same": expected is not None and all(
                got.get(key) == expected.get(key) for key in ("bars", "first_ts_event", "last_ts_event"))
                and got.get("sha256") in expected.get("sha256s", ())}
        reach = max(((got.get("bars") or 0) * PERIODS[period] * MINUTE_NS for period, got in periods.items()), default=0)
        result[symbol] = {"periods": found, "reach_ns": reach, "same": all(item["same"] for item in found.values())}
    return result


def terms(symbols: Iterable[str], run_terms: Mapping[str, Mapping], replay_terms: Mapping[str, Mapping],
          run_fees: Mapping[str, Mapping] | None, replay_fees: Mapping | None) -> dict:
    """Per contract, the run's contract terms and its fee rates on that contract ({symbol: {maker, taker}}) against
    the replay's: {differs: [...] (engine.terms_changed, the replay's as the market's), fees: [...]}; terms either
    side lacks are not compared."""
    from engine.config import terms_changed

    def fees(symbol: str) -> list[str]:
        run = (run_fees or {}).get(symbol)
        return [f"{name}: run {run.get(name)}, replay {replay_fees.get(name)}"
                for name in ("maker", "taker") if run and replay_fees
                and Decimal(str(run[name])) != Decimal(str(replay_fees[name]))]
    return {symbol: {"differs": terms_changed(dict(replay_terms[symbol]), dict(run_terms[symbol]))
                     if symbol in run_terms and symbol in replay_terms else [], "fees": fees(symbol)}
            for symbol in symbols}


def traded_terms(replay_terms: Mapping[str, Mapping], reports: Path | None) -> dict[str, dict]:
    """The terms the replay's instruments traded on: the market's, with the price increment its export widened to
    where the archive's prices lie off the terms' grid (market.instrument.build_instrument: a current 0.10 tick over
    history on the 0.01 grid), as the replay's input-coverage.json beside its reports records it."""
    found = {symbol: dict(item) for symbol, item in replay_terms.items()}
    coverage = reports.parent / "input-coverage.json" if reports is not None else None
    if coverage is None or not coverage.is_file():
        return found
    for symbol, receipt in (json.loads(coverage.read_text(encoding="utf-8")).get("export_receipts") or {}).items():
        widened = [piece["price_precision"] for piece in receipt.get("pieces") or ()
                   if piece.get("price_precision_widened")]
        if widened and symbol in found:
            found[symbol]["price_increment"] = format(Decimal(1).scaleb(-max(widened)), "f")
    return found


# Attribution

def _within(closes: Iterable[int], since: int, until: int) -> list[int]:
    return [close for close in closes if since < close <= until]


def _gated(group: Mapping, gate: Mapping) -> bool:
    """Live's entry gate (engine.live_connection) changed this group: its run entry was sent after a hold, withdrawn
    or denied at a closed gate, decided as the replay's and filled otherwise, or the replay alone decided an entry Live
    refused after holding it (gate: {released, withdrawn, denied: run client order IDs; refused: the decision times of
    those entries})."""
    gated = {*gate.get("released", ()), *gate.get("withdrawn", ()), *gate.get("denied", ())}
    entry = next((row for row in group["orders"] if row["run"] and row["run"]["order"] in gated), None)
    if entry is not None:
        return entry["stage"] == "fill"  # decided as the replay did, filled otherwise; what follows is its consequence
    return group["class"] == "replay_only" and any(
        abs(decided - row["replay"]["init_ns"]) <= ON_TIME_NS
        for row in group["orders"] if row["replay"] for decided in gate.get("refused", ()))


def attribute(compared: list[dict], found: Mapping[str, dict], warmed: Mapping[str, dict],
              contract: Mapping[str, dict], start: int, end: int, gate: Mapping | None = None) -> list[dict]:
    """Each group pair with its cause when it differs (CAUSES, in order; else unexplained), whether it is a
    look-ahead suspect, or the earlier difference it follows."""
    agreed: dict[str, int] = {}  # the decision of the contract's latest agreeing group
    parted: dict[str, int] = {}  # the contract's first difference since its previous agreeing group
    empty: dict = {"missing": [], "late": [], "differing": {}}
    for group in compared:
        symbol = symbol_of(group["instrument"])
        first, last = _span(group)
        if group["class"] == "same":
            agreed[symbol] = max(first, agreed.get(symbol, start))
            parted.pop(symbol, None)
            continue
        if symbol in parted:
            group |= {"cause": "consequence", "follows": _utc(parted[symbol]), "look_ahead_suspect": False}
            continue
        parted[symbol] = first
        # The inputs since the previous agreeing group was decided: that it agreed later, while still open (a
        # concurrent position), shows nothing about the inputs this group's decision read.
        since = agreed.get(symbol, start)
        inputs = found.get(symbol) or empty
        evidence: dict = {"missing_bars": len(_within(inputs["missing"], since, last)),
                    "late_bars": len(_within(inputs["late"], since, last)),
                    "differing_bars": len(_within(inputs["differing"], since, last))}
        listed = (_within(inputs["missing"], since, last) + _within(inputs["late"], since, last)
                  + _within(inputs["differing"], since, last))
        evidence["first"] = _utc(min(listed)) if listed else None
        warm = warmed.get(symbol)
        evidence["warmup"] = bool(warm and not warm["same"] and first < start + warm["reach_ns"])
        item = contract.get(symbol) or {"differs": [], "fees": []}
        evidence["terms"] = item["differs"] + (item["fees"] if group["stage"] == "fee" else [])
        known = {"missing_bar": evidence["missing_bars"] > 0, "late_bar": evidence["late_bars"] > 0,
                 "bar_mismatch": evidence["differing_bars"] > 0, "warmup": evidence["warmup"],
                 "contract_terms": bool(evidence["terms"]),
                 "window_end": _lone(group) and last >= end - MINUTE_NS, "entry_gate": _gated(group, gate or {})}
        cause = next((name for name in CAUSES if known[name]), "unexplained")
        group |= {"cause": cause, "evidence": evidence,
                  "look_ahead_suspect": cause == "unexplained" and _replay_alone(group)}
    return compared


# Funding and equity

def run_funding(settled: Iterable[Mapping]) -> dict[str, Decimal]:
    """Each position's funding from a run's settlements ({positions: {position ID: signed quantity}, rate, mark}), as
    the replay settles each position (ledger.paper.settle)."""
    from ledger.paper import settle
    found: dict[str, Decimal] = {}
    for item in settled:
        if item.get("rate") is None or item.get("mark") is None:
            continue
        for position, quantity in (item.get("positions") or {}).items():
            found[position] = found.get(position, Decimal(0)) + settle({position: quantity}, item["rate"], item["mark"])
    return found


def replay_funding(reports: Path | None) -> dict[str, Decimal]:
    """Each replay position's funding: the FUNDING adjustments its positions.csv row lists."""
    found: dict[str, Decimal] = {}
    path = reports / "positions.csv" if reports else None
    if path is None or not path.is_file():
        return found
    from engine.native_csv import dict_reader
    with path.open(newline="", encoding="utf-8") as handle:
        for row in dict_reader(handle):
            for adjustment in ast.literal_eval(row.get("adjustments") or "[]"):
                if adjustment.get("adjustment_type") == "FUNDING":
                    found[row["position_id"]] = (found.get(row["position_id"], Decimal(0))
                                                 + (_amount(adjustment.get("pnl_change")) or Decimal(0)))
    return found


def replay_equity(reports: Path, minutes: list[int]) -> list[list]:
    """The replay's equity at each run snapshot minute: its account balance after the minute's bar plus the open
    profit of its positions at that bar's close."""
    with (reports / "account.csv").open(newline="", encoding="utf-8") as handle:
        balances = sorted((round(datetime.fromisoformat(row["ts_event"]).timestamp() * 1000) * MILLISECOND_NS,
                           Decimal(row["total"])) for row in csv.DictReader(handle))
    open_profit: dict[int, Decimal] = {}
    exposures = reports / "exposures.csv.gz"
    if exposures.is_file():
        with gzip.open(exposures, "rt", newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                at = int(row["ts_event_ns"])
                open_profit[at] = open_profit.get(at, Decimal(0)) + (_amount(row["unrealized_pnl"]) or Decimal(0))
    path, i, balance = [], 0, None
    for minute in sorted(minutes):
        close = minute + MINUTE_NS - MILLISECOND_NS
        while i < len(balances) and balances[i][0] <= close:
            balance = balances[i][1]
            i += 1
        if balance is not None:
            path.append([minute, str(balance + open_profit.get(close, Decimal(0)))])
    return path


# The whole comparison

def compare(run: Mapping, replay_events: list[dict] | None, archive: Mapping[str, list[list]],
            reports: Path | None, start: int, end: int, *, archived_warmup: Mapping | None = None,
            replay_terms: Mapping | None = None, replay_fees: Mapping | None = None) -> dict:
    """A run against its replay. `run`: {bars, warmup ({instrument: {period: digest}}), events (native order
    events), settlements (funding), equity ([(minute, value)]), terms ({symbol: terms}), fees ({symbol: {maker, taker}})}.
    `replay_events` None means the replay wrote no order events: its orders are unknown, not none."""
    found = bars(run.get("bars") or [], archive, start, end)
    warmed = warmup(run.get("warmup") or {}, archived_warmup or {})
    contract = terms(sorted(archive), run.get("terms") or {}, traded_terms(replay_terms or {}, reports), run.get("fees"),
                     replay_fees)
    inputs = {symbol: {"bars": {**{key: item[key] for key in ("archive", "live")},
                                # The lists stop at LISTED; the counts are complete.
                                "missing_bars": len(item["missing"]), "late_bars": len(item["late"]),
                                "differing_bars": len(item["differing"]),
                                "missing": [_utc(close) for close in item["missing"][:LISTED]],
                                "late": [_utc(close) for close in item["late"][:LISTED]],
                                "live_only": [_utc(close) for close in item["live_only"][:LISTED]],
                                "differing": [{"close": _utc(close), "fields": fields}
                                              for close, fields in list(item["differing"].items())[:LISTED]]},
                       "warmup": warmed.get(symbol), "terms": contract.get(symbol)}
              for symbol, item in found.items()}
    run_orders = orders(run.get("events") or [])
    summary: dict = {"run_orders": len(run_orders), "run_fills": sum(bool(item["filled"]) for item in run_orders),
               "missing_bars": sum(len(item["missing"]) for item in found.values()),
               "late_bars": sum(len(item["late"]) for item in found.values()),
               "differing_bars": sum(len(item["differing"]) for item in found.values()),
               "warmup_differs": sum(not item["same"] for item in warmed.values()),
               "terms_differ": sum(bool(item["differs"] or item["fees"]) for item in contract.values())}
    compared = None
    if replay_events is None:
        summary |= dict.fromkeys(("replay_orders", "replay_fills", "groups", "same", "differs", "run_only",
                                  "replay_only", "consequences", "look_ahead_suspects"))
    else:
        replay_orders = orders(replay_events)
        mine, theirs = run_funding(run.get("settlements") or []), replay_funding(reports)
        compared = attribute([compare_group(a, b, mine, theirs) for a, b in pair(groups(run_orders), groups(replay_orders))],
                             found, warmed, contract, start, end, run.get("gate"))
        summary |= {"replay_orders": len(replay_orders),
                    "replay_fills": sum(bool(item["filled"]) for item in replay_orders),
                    "groups": len(compared),
                    **{kind: sum(group["class"] == kind for group in compared)
                       for kind in ("same", "differs", "run_only", "replay_only")},
                    "consequences": sum(group.get("cause") == "consequence" for group in compared),
                    "look_ahead_suspects": sum(bool(group.get("look_ahead_suspect")) for group in compared)}
    run_equity = [(minute, value) for minute, value in run.get("equity") or [] if start <= minute < end]
    equity = {"run": [[minute, str(value)] for minute, value in run_equity],
              "replay": replay_equity(reports, [minute for minute, _ in run_equity])
              if reports and (reports / "account.csv").is_file() else []}
    replayed = {minute: Decimal(value) for minute, value in equity["replay"]}
    gaps = [abs(value - replayed[minute]) for minute, value in run_equity if minute in replayed]
    summary["equity_max_difference"] = str(max(gaps)) if gaps else None
    return {"summary": summary, "inputs": inputs, "groups": compared, "equity": equity}


# Archive and replay

def archive(market: dict, at: str | None, symbols: list[str], start: int, end: int,
            code: str) -> tuple[str, dict[str, list]]:
    """(market day, each contract's archived one-minute bars in [start, end)); `code` when the market does not hold
    them all yet."""
    from market import read
    market_day, found = None, {}
    for symbol in symbols:
        stored = read.stored_bars(market, market_day or at, symbol, "LAST", "1m", _utc(start), _utc(end), None,
                                  funding=False)
        market_day = stored["market_day"]
        found[symbol] = stored["bars"]["rows"]
        if not found[symbol] or found[symbol][-1][1] * MILLISECOND_NS < end - MILLISECOND_NS:
            month = _utc(end - 1)[:7]
            raise refuse(code, f"market day {market_day} holds {symbol}'s minutes only to "
                               f"{_utc(found[symbol][-1][1] * MILLISECOND_NS) if found[symbol] else 'nothing'} of "
                               f"the run's [{_utc(start)}, {_utc(end)})", missing=(f"market import --month {month}",))
    return market_day, found  # type: ignore[return-value]


def replay(market: dict, market_day: str, source: bytes, entry_class: str, image_ref: str, symbols: list[str],
           start: int, end: int, leverage: str, starting_balance: str, output: Path, name: str,
           timeout: float | None) -> tuple[dict, list[dict] | None, Path | None]:
    """(the replay's status, its order events or None when it wrote none, its reports directory or None without an
    account report): the run's source on its image over [start, end), warmed at `start` as the run was, in the bars
    environment at the run's leverage and starting balance."""
    from replay import entry
    argv = ["--symbols", *symbols, "--start", _utc(start), "--trade-start", _utc(start), "--end", _utc(end),
            "--execution", "bars", "--leverage", str(leverage), "--starting-balance", str(starting_balance)]
    replayed = entry.replay_unrecorded(market, market_day, source, entry_class, image_ref, argv, output, name, timeout)
    reports = Path(replayed["path"]) / entry.REPORTS
    events_file = reports / "order_events.jsonl.gz"
    events = [json.loads(raw) for raw in gzip.open(events_file)] if events_file.is_file() else None
    return (replayed, events,
            reports if (reports / "account.csv").is_file() else None)
