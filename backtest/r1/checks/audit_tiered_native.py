"""Audit native report integrity and reconcile reported economics for every native run.

Strategy-specific geometry belongs in the strategy's own ``replay_integrity_findings``.
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict
import csv
import hashlib
import json
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

import pandas as pd


TERMINAL = {"FILLED", "CANCELED", "EXPIRED", "DENIED", "REJECTED"}
OPEN = {"ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED", "PENDING_UPDATE"}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _decimal(value) -> Decimal:
    return Decimal(str(value))


def _rows(run: Path, name: str) -> list[dict]:
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


def _generic_result(run, orders, fills, positions, findings, economics):
    names = ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv")
    return {"run": str(run), "scope": "native report identity, links, final protection and reported economics",
            "file_sha256": {name: _sha(run / name) for name in names},
            "native_orders": len(orders), "native_fills": len(fills), "native_positions": len(positions),
            "native_economics": economics,
            "coverage_limits": ["No strategy signal, target geometry or historical protection reconstruction",
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
                                         "linked_order_ids", "parent_order_id", "ts_init", "commissions", "is_reduce_only", "tags"}),
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
    economics = {}
    try:
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
        for position in live:
            exits = [order for order in orders if _scope(order) == _scope(position)
                     and order["status"] in OPEN - {"SUBMITTED"}
                     and order["side"] == ("BUY" if position["side"] == "SHORT" else "SELL")
                     and (order["is_reduce_only"] == "True"
                          or set(_list(order["tags"])) & {"STOP_LOSS", "TAKE_PROFIT"})]
            for kind in ("STOP_MARKET", "LIMIT"):
                covered = sum((_quantity(order["quantity"]) - _quantity(order["filled_qty"])
                               for order in exits if order["type"] == kind), Decimal(0))
                if covered != _quantity(position["quantity"]):
                    findings.append(f"open native {kind} protection size differs: {position['position_id']}")
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
    except (KeyError, TypeError, ValueError, ArithmeticError) as error:
        findings.append(f"invalid native report payload: {error}")
    return _generic_result(run, orders, fills, positions, findings, economics)


def audit(run: Path) -> dict:
    """Reconcile one run's native reports; the result names every finding."""
    return _generic_audit(run, json.loads((run / "summary.json").read_text()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    # Older custody commands pass the input catalog; the generic audit does not read it.
    parser.add_argument("--catalog-root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.run)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
