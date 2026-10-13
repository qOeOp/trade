"""Audit native report integrity and reconcile reported economics for every native run.

Besides reconciling the reports, the audit replays the native order event history and refuses a
run in which a position stays larger than its working reduce-only stop orders for more than one
execution bar, unless the strategy declares ``USES_STOP_LOSS = False``. Strategy-specific geometry
belongs in the strategy's own ``replay_integrity_findings``.
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import json
import sys
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

import pandas as pd


TERMINAL = {"FILLED", "CANCELED", "EXPIRED", "DENIED", "REJECTED"}
OPEN = {"ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED", "PENDING_UPDATE"}
ORDER_EVENTS = "order_events.jsonl.gz"
BAR_NS = 60_000_000_000
STOP_TYPES = {"STOP_MARKET", "STOP_LIMIT", "TRAILING_STOP_MARKET", "TRAILING_STOP_LIMIT"}
ENDING_EVENTS = {"OrderCanceled": "CANCELED", "OrderExpired": "EXPIRED",
                 "OrderDenied": "DENIED", "OrderRejected": "REJECTED"}
PASSIVE_EVENTS = {"OrderSubmitted", "OrderEmulated", "OrderReleased", "OrderTriggered", "OrderPendingUpdate",
                  "OrderPendingCancel", "OrderModifyRejected", "OrderCancelRejected"}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _decimal(value) -> Decimal:
    return Decimal(str(value))


def _rows(run: Path, name: str) -> list[dict]:
    csv.field_size_limit(sys.maxsize)
    with (run / f"{name}.csv").open(newline="") as stream:
        return list(csv.DictReader(stream))


def _list(value: str) -> list:
    result = ast.literal_eval(value) if value else []
    if not isinstance(result, list):
        raise ValueError("native report list field is not a list")
    return result


def _money(value: str) -> Decimal:
    amount, currency = value.split()
    if currency != "USDT":
        raise ValueError("native R1 report money must use USDT")
    result = _decimal(amount)
    if not result.is_finite():
        raise ValueError("native report money is not finite")
    return result


def _quantity(value: str) -> Decimal:
    result = _decimal(value)
    if not result.is_finite() or result < 0:
        raise ValueError("native report quantity is negative or not finite")
    return result


def _scope(row: dict) -> tuple:
    return tuple(row[name] for name in ("strategy_id", "instrument_id", "account_id"))


def _order_scope_matches(left: dict, right: dict) -> bool:
    # Dormant OTO children have no account_id until Nautilus activates them.
    return (all(left[name] == right[name] for name in ("strategy_id", "instrument_id"))
            and (not left["account_id"] or not right["account_id"]
                 or left["account_id"] == right["account_id"]))


def _ns_utc(value: int) -> str:
    return pd.Timestamp(value, tz="UTC").isoformat()


def read_order_events(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        return [json.loads(line) for line in stream]


def _event_report_findings(events: list[dict], orders: list[dict], fills: list[dict]) -> list[str]:
    """The event history holds exactly the reported orders and fills."""
    findings, history = [], defaultdict(list)
    for event in events:
        history[event["client_order_id"]].append(event)
    reported = {row["client_order_id"]: row for row in orders}
    if set(history) != set(reported):
        findings.append("native order event history and orders report hold different orders")
    for identity, order_events in history.items():
        first, row = order_events[0], reported.get(identity)
        if first["type"] != "OrderInitialized" or any(
                event["type"] == "OrderInitialized" for event in order_events[1:]):
            findings.append(f"native order event history does not start with one initialization: {identity}")
            continue
        if any(int(left["ts_event"]) > int(right["ts_event"]) for left, right in pairwise(order_events)):
            findings.append(f"native order events are out of time order: {identity}")
        if any((event["strategy_id"], event["instrument_id"]) != (first["strategy_id"], first["instrument_id"])
               for event in order_events):
            findings.append(f"native order events change scope: {identity}")
        if row is None:
            continue
        quantity = _quantity(first["quantity"])
        for event in order_events:
            if event["type"] == "OrderUpdated" and event.get("quantity") is not None:
                quantity = _quantity(event["quantity"])
        filled = sum((_quantity(event["last_qty"]) for event in order_events if event["type"] == "OrderFilled"),
                     Decimal(0))
        ended = [ENDING_EVENTS[event["type"]] for event in order_events if event["type"] in ENDING_EVENTS]
        status = row["status"]
        if (quantity != _quantity(row["quantity"]) or filled != _quantity(row["filled_qty"])
                or (first["strategy_id"], first["instrument_id"]) != (row["strategy_id"], row["instrument_id"])
                or first["order_side"] != row["side"] or first["order_type"] != row["type"]
                or (status in ENDING_EVENTS.values()) != bool(ended)
                or (ended and ended[-1] != status)):
            findings.append(f"native order event history differs from orders report: {identity}")
    event_fills = {event["event_id"]: event for event in events if event["type"] == "OrderFilled"}
    reported_fills = {row["event_id"]: row for row in fills}
    if set(event_fills) != set(reported_fills) or any(
            (event["client_order_id"], event["trade_id"], _quantity(event["last_qty"]), int(event["ts_event"]))
            != (row["client_order_id"], row["trade_id"], _quantity(row["last_qty"]), pd.Timestamp(row["ts_event"]).value)
            for event_id, event in event_fills.items() if (row := reported_fills.get(event_id)) is not None):
        findings.append("native order event fills differ from fills report")
    return findings


def uncovered_intervals(events: list[dict], end_ns: int) -> list[dict]:
    """Intervals longer than one bar in which a position exceeds its working reduce-only stops.

    Events are applied one timestamp at a time and the state is read after each timestamp, so
    nothing depends on the order of different orders' events within one nanosecond. A stop covers
    its unfilled quantity from its acceptance until it is canceled, expired, rejected or filled.
    """
    orders, position, position_orders, position_ids = {}, defaultdict(Decimal), defaultdict(list), {}
    previous_stops, uncovered, intervals = defaultdict(set), {}, []

    def close(scope, end, open_at_end=False):
        value = uncovered.pop(scope)
        if end - value["start_ns"] > BAR_NS:
            intervals.append({**value, "end_ns": end, "open_at_end": open_at_end})

    timeline = defaultdict(list)
    for event in events:
        timeline[int(event["ts_event"])].append(event)
    for timestamp in sorted(timeline):
        touched = set()
        for event in timeline[timestamp]:
            kind, identity = event["type"], event["client_order_id"]
            if kind == "OrderInitialized":
                orders[identity] = {"scope": (event["strategy_id"], event["instrument_id"]),
                                    "side": event["order_side"], "type": event["order_type"],
                                    "reduce_only": event["reduce_only"] is True,
                                    "quantity": _quantity(event["quantity"]), "filled": Decimal(0),
                                    "accepted": False, "ended": False}
            order = orders[identity]
            scope = order["scope"]
            touched.add(scope)
            if kind == "OrderAccepted":
                order["accepted"] = True
            elif kind == "OrderUpdated":
                if event.get("quantity") is not None:
                    order["quantity"] = _quantity(event["quantity"])
            elif kind == "OrderFilled":
                if position[scope] == 0:
                    position_orders[scope] = []
                if identity not in position_orders[scope]:
                    position_orders[scope].append(identity)
                position_ids[scope] = event.get("position_id") or ""
                quantity = _quantity(event["last_qty"])
                order["filled"] += quantity
                position[scope] += quantity if event["order_side"] == "BUY" else -quantity
            elif kind in ENDING_EVENTS:
                order["ended"] = True
            elif kind not in PASSIVE_EVENTS | {"OrderInitialized"}:
                raise ValueError(f"unknown native order event type {kind}")
        for scope in sorted(touched):
            held = position[scope]
            closing = "SELL" if held > 0 else "BUY"
            stops = {identity: order["quantity"] - order["filled"] for identity, order in orders.items()
                     if order["scope"] == scope and order["accepted"] and not order["ended"]
                     and order["reduce_only"] and order["type"] in STOP_TYPES and order["side"] == closing
                     and order["filled"] < order["quantity"]} if held else {}
            covered = sum(stops.values(), Decimal(0))
            if held and covered < abs(held):
                if scope not in uncovered:
                    uncovered[scope] = {
                        "strategy_id": scope[0], "instrument_id": scope[1],
                        "position_id": position_ids.get(scope, ""), "start_ns": timestamp,
                        "position_quantity": str(abs(held)), "stop_quantity": str(covered),
                        "position_order_ids": list(position_orders[scope]),
                        "ended_stop_order_ids": sorted(previous_stops[scope] - set(stops))}
                elif abs(held) > Decimal(uncovered[scope]["position_quantity"]):
                    uncovered[scope]["position_quantity"] = str(abs(held))
            elif scope in uncovered:
                close(scope, timestamp)
            previous_stops[scope] = set(stops)
    for scope in sorted(uncovered):
        close(scope, end_ns, open_at_end=True)
    return sorted(intervals, key=lambda value: (value["instrument_id"], value["strategy_id"], value["start_ns"]))


def _protection(run: Path, orders: list[dict], fills: list[dict], summary: dict) -> tuple[list[str], dict]:
    """Reconcile the order event history and refuse unprotected positions unless the source has no stop."""
    path = run / ORDER_EVENTS
    if not path.is_file():
        return ["native order event history missing"], {}
    events = read_order_events(path)
    findings = _event_report_findings(events, orders, fills)
    uses_stop_loss = summary.get("strategy_uses_stop_loss", True)
    if type(uses_stop_loss) is not bool:
        findings.append("summary strategy_uses_stop_loss is not a boolean")
    intervals = uncovered_intervals(events, pd.Timestamp(summary["period_end_utc"]).value)
    if uses_stop_loss is not False:
        for value in intervals:
            findings.append(
                f"unprotected position {value['instrument_id']} ({value['strategy_id']}): "
                f"{value['position_quantity']} held with {value['stop_quantity']} reduce-only stop from "
                f"{_ns_utc(value['start_ns'])} to {'replay end' if value['open_at_end'] else _ns_utc(value['end_ns'])}; "
                f"position orders {value['position_order_ids']}, ended stops {value['ended_stop_order_ids']}")
    return findings, {"strategy_uses_stop_loss": uses_stop_loss, "native_order_events": len(events),
                      "uncovered_intervals": intervals}


def _generic_result(run, orders, fills, positions, findings, economics, protection=None):
    names = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv",
             ORDER_EVENTS)
    return {"run": str(run),
            "scope": "native report identity, links, protection history and reported economics",
            "file_sha256": {name: _sha(run / name) for name in names if (run / name).is_file()},
            "native_orders": len(orders), "native_fills": len(fills), "native_positions": len(positions),
            "native_economics": economics, **(protection or {}),
            "coverage_limits": ["No strategy signal or target geometry reconstruction",
                                "Protection is the unfilled quantity of accepted reduce-only stop orders on the "
                                "closing side; stop prices are not checked",
                                "Events of one nanosecond are applied together; an uncovered interval of at most "
                                "one execution bar is allowed",
                                "Funding uses native reported adjustments; no rate-based settlement recalculation",
                                "Per-timestamp funding reconciliation excludes timestamps with concurrent fills",
                                "Final equity is reconciled to balance only when no position remains open"],
            "findings": findings, "passed": not findings}


def _generic_audit(run: Path, summary: dict) -> dict:  # noqa: C901
    """Reconcile native report facts; never calculate fills or market PnL."""
    orders, fills, positions, accounts = (_rows(run, name) for name in
                                         ("orders", "fills", "positions", "account"))
    findings = []
    scope_fields = {"strategy_id", "instrument_id", "account_id"}
    required = (
        ("orders", orders, scope_fields | {"client_order_id", "status", "side", "type", "quantity", "filled_qty",
                                         "linked_order_ids", "parent_order_id", "ts_init", "commissions"}),
        ("fills", fills, scope_fields | {"client_order_id", "event_id", "trade_id", "order_side", "order_type",
                                       "last_qty", "last_px", "commission", "ts_event"}),
        ("positions", positions, scope_fields | {"position_id", "events", "adjustments", "commissions", "side", "quantity",
                                               "buy_qty", "sell_qty", "ts_closed", "realized_pnl", "opening_order_id", "closing_order_id"}),
        ("account", accounts, {"account_id", "currency", "base_currency", "total", "locked", "free", "ts_event"}),
    )
    for name, rows, fields in required:
        if any(not fields <= row.keys() for row in rows):
            findings.append(f"native {name} report fields missing")
    if findings:
        return _generic_result(run, orders, fills, positions, findings, {})
    by_id = {row["client_order_id"]: row for row in orders}
    if "" in by_id or len(by_id) != len(orders):
        findings.append("native order identity missing or duplicated")
    if any(row["status"] not in TERMINAL | OPEN for row in orders):
        findings.append("unknown native order status")
    position_ids = [row["position_id"] for row in positions]
    if "" in position_ids or len(set(position_ids)) != len(position_ids):
        findings.append("native position identity missing or duplicated")
    denied = sum(row["status"] == "DENIED" for row in orders)
    rejected = sum(row["status"] == "REJECTED" for row in orders)
    if not summary["integrity_passed"] or denied or rejected:
        findings.append("runner or native orders reported integrity failure")
    if denied != summary["denied_orders"] or rejected != summary["rejected_orders"]:
        findings.append("native denied/rejected counts differ from summary")
    economics, protection = {}, {}
    try:
        protection_findings, protection = _protection(run, orders, fills, summary)
        findings.extend(protection_findings)
        for row in orders:
            original, filled = _quantity(row["quantity"]), _quantity(row["filled_qty"])
            if original <= 0 or filled > original or row["side"] not in {"BUY", "SELL"}:
                findings.append(f"invalid native order quantity or side: {row['client_order_id']}")
            if row["status"] == "FILLED" and filled != original:
                findings.append(f"native FILLED order is not fully filled: {row['client_order_id']}")
            links = _list(row["linked_order_ids"])
            if row["parent_order_id"]:
                links.append(row["parent_order_id"])
            for identity in links:
                target = by_id.get(identity)
                if target is None or identity == row["client_order_id"] or not _order_scope_matches(target, row):
                    findings.append(f"invalid native contingent link: {row['client_order_id']}")
        quantities, commissions = defaultdict(Decimal), defaultdict(Decimal)
        native_fills, fill_times = {}, set()
        for fill in fills:
            identity, event_id = fill["client_order_id"], fill["event_id"]
            order = by_id.get(identity)
            if not event_id or event_id in native_fills:
                findings.append("native fill identity missing or duplicated")
            native_fills[event_id] = fill
            fill_ns = pd.Timestamp(fill["ts_event"]).value
            fill_times.add(fill_ns)
            if (order is None or _scope(fill) != _scope(order)
                    or fill["order_side"] != order["side"] or fill["order_type"] != order["type"]):
                findings.append(f"native fill has no matching order: {identity}")
            elif fill_ns < int(order["ts_init"]):
                findings.append(f"native fill precedes order submission: {identity}")
            qty, price = _quantity(fill["last_qty"]), _quantity(fill["last_px"])
            if qty <= 0 or price <= 0:
                findings.append(f"invalid native fill quantity or price: {identity}")
            quantities[identity] += qty
            commissions[identity] += _money(fill["commission"])
        for identity, order in by_id.items():
            if quantities[identity] != _quantity(order["filled_qty"]):
                findings.append(f"native fill quantity differs from order: {identity}")
            order_fees = sum((_money(value) for value in _list(order["commissions"])), Decimal(0))
            if commissions[identity] != order_fees:
                findings.append(f"native fill commission differs from order: {identity}")
        seen_events, seen_adjustments = Counter(), set()
        position_fees, realized, funding = Decimal(0), Decimal(0), Decimal(0)
        funding_by_time = defaultdict(Decimal)
        live, closed_pnl = [], []
        for position in positions:
            events = _list(position["events"])
            if not events or events[0]["client_order_id"] != position["opening_order_id"]:
                findings.append(f"native opening order differs from first position fill: {position['position_id']}")
            if position["ts_closed"] and (
                not events or events[-1]["client_order_id"] != position["closing_order_id"]
            ):
                findings.append(f"native closing order differs from last position fill: {position['position_id']}")
            if any(int(left["ts_event"]) > int(right["ts_event"]) for left, right in pairwise(events)):
                findings.append(f"native position fill events are out of time order: {position['position_id']}")
            bought, sold, event_fees = Decimal(0), Decimal(0), Decimal(0)
            for event in events:
                event_id = event["event_id"]
                seen_events[event_id] += 1
                fill = native_fills.get(event_id)
                fields = ("client_order_id", "strategy_id", "instrument_id", "account_id",
                          "order_side", "order_type", "last_qty", "last_px", "commission", "trade_id")
                if (event.get("type") != "OrderFilled" or fill is None
                        or _scope(event) != _scope(position)
                        or any(str(event[field]) != fill[field] for field in fields)
                        or int(event["ts_event"]) != pd.Timestamp(fill["ts_event"]).value):
                    findings.append(f"native position event differs from fill: {position['position_id']}")
                qty = _quantity(event["last_qty"])
                if event["order_side"] == "BUY":
                    bought += qty
                elif event["order_side"] == "SELL":
                    sold += qty
                else:
                    findings.append("unknown native position fill side")
                event_fees += _money(event["commission"])
            for field in ("opening_order_id", "closing_order_id"):
                identity = position[field]
                order = by_id.get(identity) if identity else None
                if (not identity and (field == "opening_order_id" or position["ts_closed"])) or (
                    identity and (order is None or _scope(order) != _scope(position)
                                  or quantities[identity] <= 0
                                  or identity not in {event["client_order_id"] for event in events})
                ):
                    findings.append(f"invalid native position order link: {position['position_id']}")
            signed = _quantity(position["quantity"]) * (-1 if position["side"] == "SHORT" else 1)
            if (bought != _quantity(position["buy_qty"]) or sold != _quantity(position["sell_qty"])
                    or bought - sold != signed
                    or position["side"] not in {"LONG", "SHORT", "FLAT"}
                    or bool(position["ts_closed"]) != (signed == 0)):
                findings.append(f"native position quantity differs from fills: {position['position_id']}")
            fees = sum((_money(value) for value in _list(position["commissions"])), Decimal(0))
            if fees != event_fees:
                findings.append(f"native position commission differs from fills: {position['position_id']}")
            position_fees += fees
            pnl = _money(position["realized_pnl"])
            realized += pnl
            if position["ts_closed"]:
                closed_pnl.append(pnl)
            else:
                live.append(position)
            for adjustment in _list(position["adjustments"]):
                event_id = adjustment["event_id"]
                if (not event_id or event_id in seen_adjustments
                        or _scope(adjustment) != _scope(position)
                        or adjustment["adjustment_type"] != "FUNDING"
                        or adjustment.get("quantity_change") is not None):
                    findings.append(f"invalid native funding adjustment: {position['position_id']}")
                seen_adjustments.add(event_id)
                amount = _money(adjustment["pnl_change"])
                funding += amount
                funding_by_time[int(adjustment["ts_event"])] += amount
        if seen_events != Counter({identity: 1 for identity in native_fills}):
            findings.append("native position events do not cover fills exactly once")
        if position_fees != sum(commissions.values(), Decimal(0)):
            findings.append("native position and fill commission totals differ")
        if (summary["closed_trades"] != len(closed_pnl)
                or summary["winning_trades"] != sum(value > 0 for value in closed_pnl)):
            findings.append("native closed-position counts differ from summary")
        if not accounts:
            findings.append("native account report is empty")
        else:
            for account in accounts:
                balances = [_decimal(account[name]) for name in ("total", "locked", "free")]
                if (account["currency"] != "USDT" or account["base_currency"] != "USDT"
                        or not all(value.is_finite() for value in balances)
                        or balances[0] != balances[1] + balances[2]):
                    findings.append("native account balance fields disagree")
            if any(pd.Timestamp(left["ts_event"]).value > pd.Timestamp(right["ts_event"]).value
                   for left, right in pairwise(accounts)):
                findings.append("native account report is out of time order")
            balance_changes = defaultdict(Decimal)
            for left, right in pairwise(accounts):
                balance_changes[pd.Timestamp(right["ts_event"]).value] += (
                    _decimal(right["total"]) - _decimal(left["total"]))
            for timestamp in set(balance_changes) | set(funding_by_time):
                if timestamp not in fill_times and (
                    timestamp not in balance_changes
                    or abs(balance_changes[timestamp] - funding_by_time[timestamp]) > Decimal("0.00000001")
                ):
                    findings.append(f"native funding differs from account balance change: {timestamp}")
            starting, final_balance = _decimal(accounts[0]["total"]), _decimal(accounts[-1]["total"])
            if starting != _decimal(summary["starting_balance_usdt"]):
                findings.append("native starting balance differs from summary")
            if abs(final_balance - starting - realized) > Decimal("0.00000001"):
                findings.append("native account balance change differs from reported realized PnL")
            if not live and abs(final_balance - _decimal(summary["final_equity_usdt"])) > Decimal("0.00000001"):
                findings.append("flat native account balance differs from final equity")
            if any(row["account_id"] != accounts[0]["account_id"] for row in [*orders, *fills, *positions, *accounts]
                   if row["account_id"]):
                findings.append("native reports span different accounts")
            economics = {"starting_balance_usdt": str(starting), "final_balance_usdt": str(final_balance),
                         "reported_realized_pnl_usdt": str(realized),
                         "fill_commissions_usdt": str(sum(commissions.values(), Decimal(0))),
                         "funding_adjustments": len(seen_adjustments),
                         "reported_funding_usdt": str(funding),
                         "funding_timestamps_with_concurrent_fills": len(set(funding_by_time) & fill_times)}
    except (KeyError, TypeError, ValueError, ArithmeticError, OSError, EOFError) as error:
        findings.append(f"invalid native report payload: {error}")
    return _generic_result(run, orders, fills, positions, findings, economics, protection)


def audit(run: Path) -> dict:
    """Reconcile one run's native reports; the result names every finding."""
    return _generic_audit(run, json.loads((run / "summary.json").read_text()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.run)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
