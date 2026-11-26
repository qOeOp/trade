"""An execution run against a replay of its own source on the archive, one tool for Paper and Live
(docs/plans/execution-paths-replan-20261110.zh.md, R3.2; docs/plans/run-reconcile-20261112.zh.md).

Paper (paper.compare) and Live (live.compare) read their run into one record (run_record): the one-minute bars its source
received, the warm-up it received, its native order events, its funding settlements, its equity path and the
contract terms and fee rates it traded at. Each reads the archive's minutes for the run's window (replay.rerun.archive,
with its own refusal) and passes them with that record to replay.rerun.replay_and_compare, then writes comparison.json
with its own keys. The replay runs the run's source on its image over the same window, with the same instruments, leverage and starting balance and the same warm-up (the source's WARMUP, requested at the
window's start), and the membership the run had: to the end of the window's last month, as Paper and Live read it
month by month (engine.membership), not cut at the window's end, so a source that checks an entry's expiry against
it sends the entries of the window's last order lifetime as the run did; it is no trial and writes nothing to a
ledger.

The comparison goes in order: input bars, then decisions (which order, when, at what price and quantity), then
fills, fees and funding, then the equity path.

Orders are compared in groups. Positions are HEDGING, one per entry order (engine.order_rules), so an entry order,
the position it opened and every exit order of that position (its stops, targets and partial exits) are one group.
An exit that filled names its position; an exit that never filled is given to the position it could close (the
latest one opened on its contract and opposite side that still held its quantity). Groups pair per contract and
entry side, nearest entry decision first, within PAIR_NS; inside a pair the entries pair and the exits pair per role
in the order they were sent, so a scale-out's second target meets the other side's second target.

Each group's first difference since its contract's previous agreeing group takes its cause from what the product
knows, in this order (user 2026-11-12): a live bar missing, a live bar late, an aggregated bar the source received
late (user 2026-11-21), a live bar unlike the archive's, a
warm-up unlike the archive's (while the difference falls within the warm-up's reach), contract terms or fee rates
unlike the replay's, a lone group at the window's end, Live's entry gate, or a Paper run held after an interruption
(its source without the recovery protocol: from the first `resumed` on it sends no entry and withdraws those it had;
user 2026-11-17) while the group was open. Only when none applies is it unexplained, and only an
unexplained difference that the replay made alone (a group or an order only the replay had) is a look-ahead
suspect. Once the paths part, the positions they trade from differ, so each later difference up to the next
agreeing group is a consequence of that first one.

A live bar is late when the run received it more than LATE_NS after Binance sent it (its kline_event,
engine.kline_events): only the run's own delay (user 2026-11-18). A bar with no kline_event is neither late nor on
time: it counts as the side connection's gap, with the reason, when that connection was down then (its kline_socket
lines), else as unknown.

An aggregated bar is late when the source received it more than engine.history.AGGREGATE_LATE_NS after its bucket's end
(the run's late_aggregate rows, engine.realtime.MarketRows): rc7 closes a time bar on a monotonic-clock timer, which a
host sleep or VM pause leaves behind (doctor 20261114-30), while the one-minute bars keep arriving on time.

A first difference also carries, over the same span, the early bars of its contract with the largest lead (a live bar
the run's clock stamped before its close: that clock was behind the venue's), its unknown bars and those in a gap of the side connection with the reasons, and the bars Binance
itself sent more than LATE_NS after their close with the longest such delay. They are shown, not a cause: they do not
change the attribution or a look-ahead suspect (user 2026-11-14, 2026-11-18).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import ast
from decimal import Decimal
import itertools
import json
from pathlib import Path

from engine.config import instrument_id, symbol_of, utc_text
from engine.history import bucket_end
from engine.kline_events import LATE_NS, received
from ledger import metrics
from replay.equity import (LISTED, MILLISECOND_NS, MINUTE_NS, amount, equity_differences, price_places,
                           replay_equity)


FORMAT = "run-comparison@2026-11-24.1"
ON_TIME_NS = MINUTE_NS  # a decision or fill within one bar of its counterpart is on time
PAIR_NS = 10 * MINUTE_NS  # an uncalibrated example value: entries further apart are different trades
ROLES = {"ENTRY": "entry", "STOP_LOSS": "stop", "TAKE_PROFIT": "target"}
BAR_FIELDS = ("open", "high", "low", "close", "volume")
CAUSES = ("missing_bar", "late_bar", "late_aggregate", "bar_mismatch", "metrics", "warmup", "contract_terms",
          "window_end", "entry_gate", "held")  # in this order
METRICS_VALUES = ("sum_open_interest", "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio",
                  "count_long_short_ratio")
METRICS_VISIBLE_NS = 5 * MINUTE_NS  # a metrics row reaches the source 5 minutes after ts_event (market.export)
STAGES = ("decision", "fill", "fee", "funding")  # a group's first difference is looked for in this order
FINAL = {"OrderFilled": "filled", "OrderCanceled": "canceled", "OrderExpired": "expired",
         "OrderRejected": "rejected", "OrderDenied": "denied"}


def text(value: Decimal | None) -> str | None:
    return None if value is None else format(value.normalize(), "f")


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
            # An OrderInitialized's ts_event is its ts_init; Paper's journal (engine.paper) records only ts_event.
            item.update(side=event.get("order_side"), type=event.get("order_type"),
                        init_ns=event.get("ts_init", event.get("ts_event")),
                        role=next((ROLES[tag] for tag in tags if tag in ROLES), (tags[0] if tags else "other").lower()),
                        reduce_only=bool(event.get("reduce_only")), qty=amount(event.get("quantity")),
                        price=amount(event.get("price")), trigger=amount(event.get("trigger_price")),
                        parent=event.get("parent_order_id"))
        elif kind == "OrderFilled":
            qty, px = amount(event.get("last_qty")), amount(event.get("last_px"))
            assert qty is not None and px is not None, "a Nautilus OrderFilled always carries last_qty and last_px"
            filled = item["filled"] or {"ts_ns": event.get("ts_event"), "qty": Decimal(0), "notional": Decimal(0),
                                        "commission": Decimal(0)}
            filled["qty"] += qty
            filled["notional"] += qty * px
            filled["commission"] += amount(event.get("commission")) or Decimal(0)
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
    return {"order": order["order"], "type": order["type"], "init": utc_text(order["init_ns"] or 0),
            "init_ns": order["init_ns"], "qty": text(order["qty"]), "price": text(order["price"]),
            "trigger": text(order["trigger"]), "status": order["status"],
            "fill": None if not filled else {"ts": utc_text(filled["ts_ns"]), "ts_ns": filled["ts_ns"],
                                             "qty": text(filled["qty"]), "px": text(filled["px"]),
                                             "commission": text(filled["commission"])}}


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
    funding = {"run": text(run_funding.get(run["position"] or "", Decimal(0))) if run else None,
               "replay": text(replay_funding.get(replay["position"] or "", Decimal(0))) if replay else None}
    result: dict = {"instrument": either["instrument"], "side": either["side"],
              "at": utc_text(min(_start(group) for group in (run, replay) if group)),
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
    if abs(Decimal(funding["run"] or 0) - Decimal(funding["replay"] or 0)) > metrics.MONEY:
        return result | {"class": "differs", "stage": "funding", "first": None}
    return result | {"class": "same", "stage": None, "first": None}


def _span(group: Mapping) -> tuple[int, int]:
    """The first and last time a group's orders were sent or filled, on either side."""
    found = [value for item in group["orders"] for value in _times(item)] or [group["at_ns"]]
    return min(found), max(found)


def _alone(group: Mapping, sides: tuple[str, ...]) -> bool:
    """The group's first difference is something only one of `sides` ("run_only", "replay_only") did."""
    if group["class"] in sides:
        return True
    first = group["first"]
    return first is not None and group["orders"][first]["class"] in sides


# Inputs

DIGEST = ("bars", "first_ts_event", "last_ts_event", "sha256")


def run_record(market: Iterable[Mapping], **run) -> dict:
    """A run as compare reads it: from its rows the market rows (engine.realtime.MarketRows: Paper's journal, Live's
    evidence pack; other rows are passed over), and `run`'s own parts as given: side_starts (its processes' starts),
    events (its native order events), settlements, equity, taken, terms, fees, and Paper's held, interrupted and
    paused or Live's gate."""
    rows = list(market)
    warmup: dict[str, dict[str, dict]] = {}
    for row in rows:
        if row["kind"] == "warmup":
            warmup.setdefault(row["instrument_id"], {})[row["period"]] = {key: row.get(key) for key in DIGEST}
    return {"bars": [row for row in rows if row["kind"] == "bar"], "warmup": warmup,
            "kline_events": [row for row in rows if row["kind"] == "kline_event"],
            "kline_sockets": [row for row in rows if row["kind"] == "kline_socket"],
            "late_aggregates": [row for row in rows if row["kind"] == "late_aggregate"],
            "metrics": [row for row in rows if row["kind"] in ("metrics", "metrics_unsubscribed")], **run}


def bars(run_bars: list[dict], archive: Mapping[str, list[list]], start: int, end: int,
         events: Iterable[Mapping] = (), sockets: Iterable[Mapping] = (), starts: Iterable[int] = ()) -> dict[str, dict]:
    """Per contract, the one-minute bars the run's source received against the archive's: {missing: closes of
    archive bars no live bar matched, late: closes of live bars received (ts_init) more than LATE_NS after Binance
    sent them (their kline_event in `events`, engine.kline_events), unknown: closes of live bars with no kline_event,
    side_down: {close: reason} of those with none while the side connection was down (`sockets`: its kline_socket
    lines, `starts`: the run's process starts, engine.kline_events.received), sent: {close: ns from the close to Binance sending it}, early: {close: ns by which the source's clock stamped
    (ts_init) the live bar before its close}, differing: {close: {field: [live, archive]}}, live_only}.

    A bar reaches the source after its close, so an early one means the run's clock was behind the venue's. The
    Sandbox matches a bar at its ts_init, so Paper sees a GTD order expire at that close one bar late (probe
    2026-11-14)."""
    live: dict[str, dict[int, dict]] = {}
    for line in run_bars:
        if start < line["ts_event"] <= end:
            live.setdefault(symbol_of(line["instrument_id"]), {})[line["ts_event"]] = line
    sent = received([bar for rows in live.values() for bar in rows.values()], events, sockets, starts)
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
        timing = sent.get(instrument_id(symbol)) or {"late": [], "unknown": [], "side_down": {}, "sent": {}}
        early = {close: close - bar["ts_init"] for close, bar in sorted(mine.items())
                 if isinstance(bar.get("ts_init"), int) and bar["ts_init"] < close}
        result[symbol] = {"archive": len(stored), "live": len(mine), "late": sorted(timing["late"]),
                          "unknown": sorted(timing["unknown"]), "side_down": dict(sorted(timing["side_down"].items())),
                          "sent": dict(sorted(timing["sent"].items())),
                          "early": early,
                          "missing": sorted(set(stored) - set(mine)), "live_only": sorted(set(mine) - set(stored)),
                          "differing": differing}
    return result


def late_aggregates(rows: Iterable[Mapping], start: int, end: int) -> dict[str, list[tuple[int, str, int]]]:
    """Per contract, the aggregated bars its source received late (late_aggregate rows) whose bucket ends in (start,
    end]: [(bucket end, bar type, ns from the bucket's end to receipt)], by bucket end."""
    found: dict[str, list[tuple[int, str, int]]] = {}
    for row in rows:
        closed = bucket_end(row["bar_type"], row["ts_event"])
        if closed is not None and start < closed <= end:
            found.setdefault(symbol_of(row["bar_type"]), []).append((closed, row["bar_type"], row["wall_ns"] - closed))
    return {symbol: sorted(items) for symbol, items in found.items()}


def _followed(arrivals: Iterable[int], unsubscribed: list[int], end: int) -> list[tuple[int, int]]:
    """The spans [from, to) in which a source followed a contract's metrics: from each row it received after the
    previous unsubscribe (the first of all included) to the next unsubscribe, or `end`."""
    spans: list[tuple[int, int]] = []
    for at in sorted(arrivals):
        if not spans or at >= spans[-1][1]:
            spans.append((at, min([cut for cut in unsubscribed if cut > at] + [end])))
    return spans


def compare_metrics(run_rows: Iterable[Mapping], archive: Mapping[str, list[list]], end: int) -> dict[str, dict]:
    """Per contract whose source received metrics (Live's evidence pack, Paper's journal), the rows it received
    against those a replay streams (`archive`: {symbol: [[ts_event, four values as text or None, ties]]},
    archive_metrics), each by the instant it reached the source (ts_event + METRICS_VISIBLE_NS), while it followed
    them: from the first it received to its unsubscribe (`metrics_unsubscribed`, at its wall_ns), and again from the
    first it received after one, up to `end`: {archive, live, missing, late, live_only, differing: {instant: {field:
    [live, archive]}}} ("live" is the run's side, Paper's too). A row due before the unsubscribe and not received
    counts as missing, also one due at a bar close the source unsubscribed on.

    Values are equal as numbers, with one tolerance: a position ratio the archive holds exactly at the midpoint of
    REST's 4th decimal (`ties`: {field: the half-down rounding}, archive_metrics) also agrees at that midpoint's
    other rounding, 0.0001 below the replay's half-up. The archive's 6 places do not say which way REST rounded the
    true value; on 650 such rows of 64,000 (8 contracts, 29 days to 2026-11-14) REST rounded 350 up and 300 down,
    and no rule from the archive's columns reproduced it. No other difference is accepted
    (docs/plans/binance-metrics-rest-parity.zh.md)."""
    live: dict[str, dict[int, Mapping]] = {}
    unsubscribed: dict[str, list[int]] = {}
    for line in run_rows:
        if line.get("kind") == "metrics_unsubscribed":
            unsubscribed.setdefault(symbol_of(line["instrument_id"]), []).append(line["wall_ns"])
        elif line["ts_event"] + METRICS_VISIBLE_NS < end:
            live.setdefault(symbol_of(line["instrument_id"]), {})[line["ts_event"] + METRICS_VISIBLE_NS] = line
    result = {}
    for symbol, mine in live.items():
        spans = _followed(mine, unsubscribed.get(symbol, []), end)
        stored = {row[0] + METRICS_VISIBLE_NS: (dict(zip(METRICS_VALUES, row[1:-1], strict=True)), row[-1])
                  for row in archive.get(symbol, [])
                  if any(low <= row[0] + METRICS_VISIBLE_NS < high for low, high in spans)}
        differing = {}
        for at, (row, ties) in stored.items():
            if at in mine:
                fields = {name: [mine[at].get(name), row[name]] for name in METRICS_VALUES
                          if amount(mine[at].get(name)) != amount(row[name])
                          and (name not in ties or amount(mine[at].get(name)) != amount(ties[name]))}
                if fields:
                    differing[at] = fields
        late = sorted(at for at, line in mine.items()
                      if isinstance(line.get("wall_ns"), int) and line["wall_ns"] - at > LATE_NS)
        result[symbol] = {"archive": len(stored), "live": len(mine), "late": late,
                          "missing": sorted(set(stored) - set(mine)), "live_only": sorted(set(mine) - set(stored)),
                          "differing": differing}
    return result


FUNDING_INTERVAL_NS = 8 * 60 * MINUTE_NS  # Binance's longest funding interval


def warmup(received: Mapping[str, Mapping[str, Mapping]], archived: Mapping[str, Mapping[str, Mapping]]) -> dict:
    """Per contract and period, the warm-up the run received against the archive's: {run, archive, same}, and its
    reach: how long after the start its bars stay in the source's window (bars times the period)."""
    from engine.warmup import PERIODS
    result = {}
    for iid, periods in received.items():
        symbol = symbol_of(iid)
        found = {}
        for period, got in periods.items():
            expected = (archived.get(symbol) or {}).get(period)
            found[period] = {"run": dict(got), "archive": expected, "same": expected is not None and all(
                got.get(key) == expected.get(key) for key in ("bars", "first_ts_event", "last_ts_event"))
                and got.get("sha256") in expected.get("sha256s", ())}
        reach = max(((got.get("bars") or 0) * PERIODS[period] * MINUTE_NS if period in PERIODS else
                     (got.get("last_ts_event") or 0) - (got.get("first_ts_event") or 0) + FUNDING_INTERVAL_NS
                     for period, got in periods.items()), default=0)
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
              contract: Mapping[str, dict], start: int, end: int, gate: Mapping | None = None,
              metered: Mapping[str, dict] | None = None, held: int | None = None,
              interrupted: Mapping[str, list[tuple[int, int]]] | None = None) -> list[dict]:
    """Each group pair with its cause when it differs (CAUSES, in order; else unexplained), whether it is a
    look-ahead suspect, or the earlier difference it follows. `held`: when a Paper run of a source without the
    recovery protocol was first held (engine.paper_session; its first `resumed`): from then on it sent no entry and
    withdrew those it had, so a group that reaches past it may differ for that. `interrupted`: per contract, the
    [from, to) of the interruptions it was held over (paper.compare.interruptions); for a group reaching past `held`,
    the bars missing there are the hold's, not `missing_bar` evidence (every resume misses at least one)."""
    agreed: dict[str, int] = {}  # the decision of the contract's latest agreeing group
    parted: dict[str, int] = {}  # the contract's first difference since its previous agreeing group
    empty: dict = {"missing": [], "late": [], "unknown": [], "side_down": {}, "sent": {}, "early": {}, "differing": {},
                   "late_aggregate": []}
    for group in compared:
        symbol = symbol_of(group["instrument"])
        first, last = _span(group)
        if group["class"] == "same":
            agreed[symbol] = max(first, agreed.get(symbol, start))
            parted.pop(symbol, None)
            continue
        if symbol in parted:
            group |= {"cause": "consequence", "follows": utc_text(parted[symbol]), "look_ahead_suspect": False}
            continue
        parted[symbol] = first
        # The inputs since the previous agreeing group was decided: that it agreed later, while still open (a
        # concurrent position), shows nothing about the inputs this group's decision read.
        since = agreed.get(symbol, start)
        inputs = found.get(symbol) or empty
        if held is not None and last >= held:
            spans = (interrupted or {}).get(symbol, ())
            inputs = {**inputs, "missing": [close for close in inputs["missing"]
                                            if not any(lo <= close < hi for lo, hi in spans)]}
        evidence: dict = {"missing_bars": len(_within(inputs["missing"], since, last)),
                    "late_bars": len(_within(inputs["late"], since, last)),
                    "late_aggregate_bars": len(_within((closed for closed, _, _ in inputs["late_aggregate"]), since, last)),
                    "differing_bars": len(_within(inputs["differing"], since, last))}
        rows = (metered or {}).get(symbol) or empty
        evidence |= {"missing_metrics": len(_within(rows["missing"], since, last)),
                     "late_metrics": len(_within(rows["late"], since, last)),
                     "differing_metrics": len(_within(rows["differing"], since, last))}
        listed = [at for item in (inputs, rows) for kind in ("missing", "late", "differing")
                  for at in _within(item[kind], since, last)]
        evidence["first"] = utc_text(min(listed)) if listed else None
        warm = warmed.get(symbol)
        evidence["warmup"] = bool(warm and not warm["same"] and first < start + warm["reach_ns"])
        item = contract.get(symbol) or {"differs": [], "fees": []}
        evidence["terms"] = item["differs"] + (item["fees"] if group["stage"] == "fee" else [])
        known = {"missing_bar": evidence["missing_bars"] > 0, "late_bar": evidence["late_bars"] > 0,
                 "late_aggregate": evidence["late_aggregate_bars"] > 0,
                 "bar_mismatch": evidence["differing_bars"] > 0,
                 "metrics": evidence["missing_metrics"] + evidence["late_metrics"] + evidence["differing_metrics"] > 0,
                 "warmup": evidence["warmup"],
                 "contract_terms": bool(evidence["terms"]),
                 "window_end": _alone(group, ("run_only", "replay_only")) and last >= end - MINUTE_NS, "entry_gate": _gated(group, gate or {}),
                 "held": held is not None and last >= held}
        cause = next((name for name in CAUSES if known[name]), "unexplained")
        early = [inputs["early"][close] for close in _within(inputs["early"], since, last)]
        evidence |= {"early_bars": len(early), "early_lead_ms": text(Decimal(max(early)) / MILLISECOND_NS) if early else None}
        published = [inputs["sent"][close] for close in _within(inputs["sent"], since, last)]
        down = [inputs["side_down"][close] for close in _within(inputs["side_down"], since, last)]
        evidence |= {"unknown_bars": len(_within(inputs["unknown"], since, last)),
                     "side_down_bars": len(down), "side_down_reasons": sorted(set(down)),
                     "published_late_bars": sum(delay > LATE_NS for delay in published),
                     "publication_delay_ms": text(Decimal(max(published)) / MILLISECOND_NS) if published else None}
        group |= {"cause": cause, "evidence": evidence,
                  "look_ahead_suspect": cause == "unexplained" and _alone(group, ("replay_only",))}
    return compared


# Funding

def run_funding(settled: Iterable[Mapping]) -> dict[str, Decimal]:
    """Each position's funding from a run's settlements ({positions: {position ID: signed quantity}, rate, mark}), as
    the replay settles each position (ledger.run_journal.settle)."""
    from ledger.run_journal import settle
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
                                                 + (amount(adjustment.get("pnl_change")) or Decimal(0)))
    return found


# The whole comparison

def _published_late(item: Mapping) -> int:
    """The live bars Binance sent more than LATE_NS after their close: evidence, never a cause."""
    return sum(delay > LATE_NS for delay in item["sent"].values())


def _listed_metrics(item: Mapping) -> dict:
    """A contract's metrics comparison as comparison.json lists it: complete counts, the first LISTED of each kind."""
    return {"archive": item["archive"], "live": item["live"],
            **{f"{kind}_metrics": len(item[kind]) for kind in ("missing", "late", "differing", "live_only")},
            **{kind: [utc_text(at) for at in item[kind][:LISTED]] for kind in ("missing", "late", "live_only")},
            "differing": [{"at": utc_text(at), "fields": fields} for at, fields in list(item["differing"].items())[:LISTED]]}


def compare(run: Mapping, replay_events: list[dict] | None, archive: Mapping[str, list[list]],
            reports: Path | None, start: int, end: int, *, archived_warmup: Mapping | None = None,
            replay_terms: Mapping | None = None, replay_fees: Mapping | None = None,
            archived_metrics: Mapping | None = None, archived_marks: Mapping | None = None) -> dict:
    """A run against its replay. `run`: {bars, warmup ({instrument: {period: digest}}), metrics (rows received and
    unsubscribes), late_aggregates (late_aggregate rows), events (native order events), settlements (funding), equity
    ([(minute, value)]), taken ({minute: the run clock when it took that value}, equity_differences), terms ({symbol:
    terms}), fees ({symbol: {maker, taker}})}.
    `archived_marks`: {symbol: {minute: the archive's MARK close}}, for equity mark-rounding attribution (mark_rounding).
    `replay_events` None means the replay wrote no order events: its orders are unknown, not none."""
    found = bars(run.get("bars") or [], archive, start, end, run.get("kline_events") or [],
                 run.get("kline_sockets") or [], run.get("side_starts") or [])
    aggregates = late_aggregates(run.get("late_aggregates") or [], start, end)
    for symbol, item in found.items():
        item["late_aggregate"] = aggregates.get(symbol, [])
    warmed = warmup(run.get("warmup") or {}, archived_warmup or {})
    metered = compare_metrics(run.get("metrics") or [], archived_metrics or {}, end)
    contract = terms(sorted(archive), run.get("terms") or {}, traded_terms(replay_terms or {}, reports), run.get("fees"),
                     replay_fees)
    inputs = {symbol: {"bars": {**{key: item[key] for key in ("archive", "live")},
                                # The lists stop at LISTED; the counts are complete.
                                "missing_bars": len(item["missing"]), "late_bars": len(item["late"]),
                                "unknown_bars": len(item["unknown"]), "side_down_bars": len(item["side_down"]),
                                "published_late_bars": _published_late(item),
                                "early_bars": len(item["early"]), "differing_bars": len(item["differing"]),
                                "missing": [utc_text(close) for close in item["missing"][:LISTED]],
                                "late": [utc_text(close) for close in item["late"][:LISTED]],
                                "late_aggregate_bars": len(item["late_aggregate"]),
                                "late_aggregate": [{"bar_type": kind, "bucket_end": utc_text(closed),
                                                    "late_ms": text(Decimal(late) / MILLISECOND_NS)}
                                                   for closed, kind, late in item["late_aggregate"][:LISTED]],
                                "unknown": [utc_text(close) for close in item["unknown"][:LISTED]],
                                "side_down": [{"close": utc_text(close), "reason": reason}
                                              for close, reason in list(item["side_down"].items())[:LISTED]],
                                "published_late": [{"close": utc_text(close), "delay_ms": text(Decimal(delay) / MILLISECOND_NS)}
                                                   for close, delay in item["sent"].items() if delay > LATE_NS][:LISTED],
                                "early": [{"close": utc_text(close), "lead_ms": text(Decimal(lead) / MILLISECOND_NS)}
                                          for close, lead in list(item["early"].items())[:LISTED]],
                                "live_only": [utc_text(close) for close in item["live_only"][:LISTED]],
                                "differing": [{"close": utc_text(close), "fields": fields}
                                              for close, fields in list(item["differing"].items())[:LISTED]]},
                       "metrics": _listed_metrics(metered[symbol]) if symbol in metered else None,
                       "warmup": warmed.get(symbol), "terms": contract.get(symbol)}
              for symbol, item in found.items()}
    run_orders = orders(run.get("events") or [])
    summary: dict = {"run_orders": len(run_orders), "run_fills": sum(bool(item["filled"]) for item in run_orders),
               "missing_bars": sum(len(item["missing"]) for item in found.values()),
               "late_bars": sum(len(item["late"]) for item in found.values()),
               "late_aggregate_bars": sum(len(item["late_aggregate"]) for item in found.values()),
               "unknown_bars": sum(len(item["unknown"]) for item in found.values()),
               "side_down_bars": sum(len(item["side_down"]) for item in found.values()),
               "published_late_bars": sum(_published_late(item) for item in found.values()),
               "early_bars": sum(len(item["early"]) for item in found.values()),
               "differing_bars": sum(len(item["differing"]) for item in found.values()),
               **{f"{kind}_metrics": sum(len(item[kind]) for item in metered.values())
                  for kind in ("missing", "late", "differing")},
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
                             found, warmed, contract, start, end, run.get("gate"), metered, run.get("held"),
                             run.get("interrupted"))
        summary |= {"replay_orders": len(replay_orders),
                    "replay_fills": sum(bool(item["filled"]) for item in replay_orders),
                    "groups": len(compared),
                    **{kind: sum(group["class"] == kind for group in compared)
                       for kind in ("same", "differs", "run_only", "replay_only")},
                    "consequences": sum(group.get("cause") == "consequence" for group in compared),
                    "look_ahead_suspects": sum(bool(group.get("look_ahead_suspect")) for group in compared)}
    run_equity = [(minute, value) for minute, value in run.get("equity") or [] if start <= minute < end]
    equity: dict[str, list] = {"run": [[minute, str(value)] for minute, value in run_equity],
              "replay": replay_equity(reports, [minute for minute, _ in run_equity])
              if reports and (reports / "account.csv").is_file() else []}
    replayed = {minute: Decimal(value) for minute, value in equity["replay"]}
    gaps = [abs(value - replayed[minute]) for minute, value in run_equity if minute in replayed]
    summary["equity_max_difference"] = str(max(gaps)) if gaps else None
    explained = equity_differences(run_equity, replayed, compared, run.get("taken") or {}, run.get("paused") or (),
                                   archived_marks, price_places(run.get("bars") or []))
    # The list stops at LISTED; the count is complete.
    equity["differences"] = explained[:LISTED]
    summary["equity_unexplained_minutes"] = sum(item["cause"] == "unexplained" for item in explained)
    return {"summary": summary, "inputs": inputs, "groups": compared, "equity": equity}
