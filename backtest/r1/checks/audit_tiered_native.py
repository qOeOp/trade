"""Audit native report integrity, with additional budgeted-tier geometry gates."""

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

from nautilus_trader.persistence import ParquetDataCatalog


TERMINAL = {"FILLED", "CANCELED", "EXPIRED", "DENIED", "REJECTED"}
OPEN = {"ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED", "PENDING_UPDATE"}
FOUR_HOUR_NS = 4 * 3_600_000_000_000
TIER_RATIOS = {
    "support-three-tier-4h": (Decimal("0.5"), Decimal("0.618"), Decimal("0.764")),
    "support-three-tier-line-cancel-4h": (
        Decimal("0.5"),
        Decimal("0.618"),
        Decimal("0.764"),
    ),
    "support-deep-two-tier-4h": (Decimal("0.618"), Decimal("0.764")),
    "support-broad-two-tier-4h": (Decimal("0.5"), Decimal("0.618")),
    "support-broad-two-tier-line-cancel-4h": (Decimal("0.5"), Decimal("0.618")),
    "support-brooks-confirmed-4h": (Decimal("0.5"), Decimal("0.618")),
    "support-broad-gap-runner-4h": (Decimal("0.5"), Decimal("0.618")),
    "support-broad-prior-a-support-4h": (Decimal("0.5"), Decimal("0.618")),
    "support-broad-any-prior-a-support-4h": (Decimal("0.5"), Decimal("0.618")),
    "support-broad-any-prior-a-outside-stop-4h": (Decimal("0.5"), Decimal("0.618")),
}
BROAD_VARIANTS = {
    "support-broad-two-tier-4h",
    "support-broad-two-tier-line-cancel-4h",
    "support-brooks-confirmed-4h",
    "support-broad-gap-runner-4h",
    "support-broad-prior-a-support-4h",
    "support-broad-any-prior-a-support-4h",
    "support-broad-any-prior-a-outside-stop-4h",
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _decimal(value) -> Decimal:
    return Decimal(str(value))


def _native_instruments(root: Path, summary: dict) -> dict:
    instruments = {}
    for row in summary["per_coin"]:
        catalog = ParquetDataCatalog(str(root / row["coin"] / "minute"))
        native = catalog.instruments(instrument_ids=[row["instrument"]])
        if len(native) != 1:
            raise RuntimeError(f"missing native Instrument: {row['coin']}")
        instruments[row["instrument"]] = native[0]
    return instruments


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


def audit(run: Path, catalog_root: Path) -> dict:
    """Run the generic reconciliation for every run; recognized tier shapes add their own gates."""
    summary = json.loads((run / "summary.json").read_text())
    result = _generic_audit(run, summary)
    if summary.get("signal_variant") not in TIER_RATIOS:
        return result
    try:
        tiered = _audit_tiered(run, catalog_root)
    except Exception as error:  # Any tier failure is recorded and fails the run.
        tiered = {"findings": [f"budgeted tier audit failed: {type(error).__name__}: {error}"]}
    findings = [*result["findings"], *tiered.pop("findings")]
    for name in ("run", "file_sha256", "passed"):
        tiered.pop(name, None)
    return {**result, **tiered,
            "scope": result["scope"] + "; budgeted-tier bracket topology, geometry, quantity and risk",
            "findings": findings, "passed": not findings}


def _audit_tiered(run: Path, catalog_root: Path) -> dict:  # noqa: C901 - one native report audit.
    summary = json.loads((run / "summary.json").read_text())
    confirmed = summary["signal_variant"] == "support-brooks-confirmed-4h"
    gap_runner = summary["signal_variant"] == "support-broad-gap-runner-4h"
    ratios = TIER_RATIOS.get(summary["signal_variant"])
    if (
        summary["sizing"]["risk_budget_bps"] != 25
        or summary["sizing"]["coin_notional_cap_pct"] != 5
    ):
        raise ValueError("budgeted native tier risk settings differ")
    instruments = _native_instruments(catalog_root, summary)
    orders = pd.read_csv(
        run / "orders.csv",
        dtype={"client_order_id": str, "ts_init": str, "expire_time_ns": str},
    )
    fills = pd.read_csv(run / "fills.csv", dtype={"client_order_id": str})
    positions = pd.read_csv(run / "positions.csv", dtype={"opening_order_id": str})
    findings = []
    if gap_runner:
        for coin in summary["per_coin"]:
            readout = coin["gap_runner"]
            if (
                readout["max_submitted_stop_risk_fraction"] > 0.0025 + 1e-10
                or readout["max_submitted_notional_fraction"] > 0.05 + 1e-10
            ):
                findings.append(f"native gap runner exceeded budget: {coin['coin']}")
    if not summary["integrity_passed"] or summary["denied_orders"] or summary["rejected_orders"]:
        findings.append("runner reported native order integrity failure")
    if not orders.client_order_id.is_unique or orders.client_order_id.isna().any():
        findings.append("native order identity missing or duplicated")
    if not orders.status.isin(TERMINAL | OPEN).all():
        findings.append("unknown native order status")
    brackets = orders[orders.tags.isin(("['ENTRY']", "['STOP_LOSS']", "['TAKE_PROFIT']"))]
    time_exits = orders[~orders.index.isin(brackets.index)]
    if not (
        time_exits.type.eq("MARKET") & time_exits.side.eq("SELL") & time_exits.status.eq("FILLED")
    ).all():
        findings.append("unexpected non-bracket native order")
    entries = brackets[brackets.tags == "['ENTRY']"]
    for list_id, group in brackets.groupby("order_list_id"):
        if len(group) != 3 or set(group.tags) != {
            "['ENTRY']",
            "['STOP_LOSS']",
            "['TAKE_PROFIT']",
        }:
            findings.append(f"incomplete native bracket {list_id}")
            continue
        entry = group[group.tags == "['ENTRY']"].iloc[0]
        stop = group[group.tags == "['STOP_LOSS']"].iloc[0]
        target = group[group.tags == "['TAKE_PROFIT']"].iloc[0]
        if (
            entry.type != ("STOP_MARKET" if confirmed else "LIMIT")
            or entry.side != "BUY"
            or entry.time_in_force != "GTD"
            or entry.contingency_type != "OTO"
            or stop.type != "STOP_MARKET"
            or target.type != "LIMIT"
            or stop.parent_order_id != entry.client_order_id
            or target.parent_order_id != entry.client_order_id
        ):
            findings.append(f"invalid native bracket topology {list_id}")
        original_qty = _decimal(entry.quantity)
        filled_qty = _decimal(entry.filled_qty)
        stop_qty = _decimal(stop.quantity)
        target_qty = _decimal(target.quantity)
        child_qty_valid = (
            stop_qty == target_qty == original_qty
            if filled_qty == 0
            else 0 < stop_qty <= original_qty and 0 < target_qty <= original_qty
        )
        if (
            not 0 <= filled_qty <= original_qty
            or not child_qty_valid
            or not 0
            < _decimal(stop.trigger_price)
            < _decimal(entry.trigger_price if confirmed else entry.price)
            < _decimal(target.price)
        ):
            findings.append(f"invalid native bracket prices or quantities {list_id}")
        decision_ns = int(entry.ts_init) // FOUR_HOUR_NS * FOUR_HOUR_NS
        life_bars = 1 if confirmed else 180 if summary["signal_variant"] in BROAD_VARIANTS else 30
        if int(entry.expire_time_ns) != decision_ns + life_bars * FOUR_HOUR_NS:
            findings.append(f"entry GTD deadline differs {list_id}")
        if (
            entry.status in {"CANCELED", "EXPIRED"}
            and filled_qty == 0
            and (stop.status != "CANCELED" or target.status != "CANCELED")
        ):
            findings.append(f"terminal unfilled entry retains child {list_id}")
        if filled_qty > 0 and int(entry.ts_last) <= int(entry.ts_init):
            findings.append(f"entry filled at or before submission {list_id}")
    for (strategy_id, ts_init), group in entries.groupby(["strategy_id", "ts_init"]):
        sorted_group = group.sort_values("trigger_price" if confirmed else "price", ascending=False)
        expected_entries = 1 if confirmed else 4 if gap_runner else len(ratios)
        if len(sorted_group) != expected_entries:
            findings.append(f"bundle has {len(sorted_group)} tiers: {strategy_id} {ts_init}")
            continue
        if confirmed:
            continue  # The new stop price is a post-touch bar high, not a retracement ratio.
        if gap_runner:
            levels = sorted(
                {_decimal(value) for value in sorted_group.price}, reverse=True
            )
            targets = sorted(
                {
                    _decimal(value)
                    for value in brackets[
                        brackets.order_list_id.isin(sorted_group.order_list_id)
                        & brackets.tags.eq("['TAKE_PROFIT']")
                    ].price
                }
            )
            stops = brackets[
                brackets.order_list_id.isin(sorted_group.order_list_id)
                & brackets.tags.eq("['STOP_LOSS']")
            ]
            if (
                len(sorted_group) != 4
                or len(levels) != 2
                or len(targets) != 2
                or len(stops) != 4
                or not stops.trigger_price.eq(stops.trigger_price.iloc[0]).all()
            ):
                findings.append(f"gap runner four-bracket geometry differs: {strategy_id} {ts_init}")
                continue
            stop = _decimal(stops.trigger_price.iloc[0])
            b_target, runner_target = targets
            instrument = instruments[sorted_group.instrument_id.iloc[0]]
            tick = instrument.price_increment.as_decimal()
            estimated_a = b_target - (b_target - levels[0]) / ratios[0]
            if not (
                0 < estimated_a < stop < levels[1] < levels[0] < b_target
                and abs(runner_target - (b_target + levels[0] - stop)) <= 2 * tick
                and all(
                    abs(level - (b_target - ratio * (b_target - estimated_a))) <= 2 * tick
                    for level, ratio in zip(levels, ratios, strict=True)
                )
            ):
                findings.append(f"gap runner source levels or target differ: {strategy_id} {ts_init}")
            for level in levels:
                pair = sorted_group[sorted_group.price.map(_decimal) == level]
                if len(pair) != 2:
                    findings.append(f"gap runner tier split differs: {strategy_id} {ts_init}")
                    continue
                pair_targets = brackets[
                    brackets.order_list_id.isin(pair.order_list_id)
                    & brackets.tags.eq("['TAKE_PROFIT']")
                ]
                if {_decimal(value) for value in pair_targets.price} != set(targets):
                    findings.append(f"gap runner tier targets differ: {strategy_id} {ts_init}")
                q = sorted((_decimal(value) for value in pair.quantity), reverse=True)
                if q[1] <= 0 or q[0] - q[1] > instrument.size_increment.as_decimal():
                    findings.append(f"gap runner tier quantity split differs: {strategy_id} {ts_init}")
            continue
        child = brackets[brackets.order_list_id.isin(sorted_group.order_list_id)]
        stops = child[child.tags == "['STOP_LOSS']"]
        targets = child[child.tags == "['TAKE_PROFIT']"]
        if (
            not stops.trigger_price.eq(stops.trigger_price.iloc[0]).all()
            or not targets.price.eq(
                targets.price.iloc[0],
            ).all()
        ):
            findings.append(f"bundle stop or target differs: {strategy_id} {ts_init}")
            continue
        target = _decimal(targets.price.iloc[0])
        levels = tuple(_decimal(value) for value in sorted_group.price)
        stop = _decimal(stops.trigger_price.iloc[0])
        estimated_a = target - (target - levels[0]) / ratios[0]
        instrument = instruments[sorted_group.instrument_id.iloc[0]]
        tick = instrument.price_increment.as_decimal()
        span = target - estimated_a
        proper_stop = (
            0 < stop < estimated_a < levels[-1] < target
            if summary["signal_variant"] == "support-broad-any-prior-a-outside-stop-4h"
            else 0 < estimated_a < stop < levels[-1] < target
            if summary["signal_variant"] in BROAD_VARIANTS
            else 0 < stop < estimated_a < levels[-1] < target
        )
        if not proper_stop or any(higher <= lower for higher, lower in pairwise(levels)):
            findings.append(f"bundle tier geometry differs: {strategy_id} {ts_init}")
        if any(
            abs(level - (target - ratio * span)) > 2 * tick
            for level, ratio in zip(levels, ratios, strict=True)
        ):
            findings.append(f"bundle ratios differ: {strategy_id} {ts_init}")
    live = positions[positions.ts_closed.isna()]
    for position in live.itertuples():
        linked = orders[
            (orders.strategy_id == position.strategy_id)
            & (orders.status == "ACCEPTED")
            & (
                orders.parent_order_id.isin(
                    entries[entries.filled_qty.map(_decimal) > 0].client_order_id,
                )
            )
        ]
        stops = linked[linked.tags == "['STOP_LOSS']"]
        targets = linked[linked.tags == "['TAKE_PROFIT']"]
        stop_qty = sum((_decimal(value) for value in stops.quantity), Decimal(0))
        target_qty = sum((_decimal(value) for value in targets.quantity), Decimal(0))
        if stop_qty != _decimal(position.quantity) or target_qty != _decimal(position.quantity):
            findings.append(f"open position native protection size differs {position.position_id}")
    for strategy_id, group in fills.groupby("strategy_id"):
        net = Decimal(0)
        for fill in group.sort_values("ts_event", kind="stable").itertuples():
            qty = _decimal(fill.last_qty)
            net += qty if fill.order_side == "BUY" else -qty
            if net < 0:
                findings.append(f"native fills net short: {strategy_id} {fill.ts_event}")
                break
        position_qty = sum(
            (_decimal(value) for value in live[live.strategy_id == strategy_id].quantity),
            Decimal(0),
        )
        if net != position_qty:
            findings.append(f"native fill net differs from open position: {strategy_id}")
    entry_by_id = entries.set_index("client_order_id")
    for row in orders[
        orders.status.isin(OPEN) & orders.tags.isin(("['STOP_LOSS']", "['TAKE_PROFIT']"))
    ].itertuples():
        parent = (
            entry_by_id.loc[row.parent_order_id]
            if row.parent_order_id in entry_by_id.index
            else None
        )
        parent_status = parent.status if parent is not None else None
        if row.status == "SUBMITTED":
            # Native OTO children wait at SUBMITTED until their entry fills.
            if parent_status not in {"ACCEPTED", "SUBMITTED", "PARTIALLY_FILLED", "PENDING_UPDATE"}:
                findings.append(f"dormant exit has no live entry {row.client_order_id}")
        elif parent is None or _decimal(parent.filled_qty) <= 0:
            findings.append(f"active exit has no filled parent {row.client_order_id}")
    file_names = (
        "summary.json",
        "orders.csv",
        "fills.csv",
        "positions.csv",
        "account.csv",
        "returns_series.csv",
    )
    return {
        "run": str(run),
        "file_sha256": {name: _sha(run / name) for name in file_names},
        "native_bundles": int(entries.groupby(["strategy_id", "ts_init"]).ngroups),
        "native_brackets": int(entries.order_list_id.nunique()),
        "filled_entries": int((entries.filled_qty.map(_decimal) > 0).sum()),
        "partially_filled_then_canceled_entries": int(
            ((entries.status == "CANCELED") & (entries.filled_qty.map(_decimal) > 0)).sum(),
        ),
        "closed_positions": int(positions.ts_closed.notna().sum()),
        "open_positions": len(live),
        "accepted_exit_orders": int(
            (
                orders.status.eq("ACCEPTED")
                & orders.tags.isin(("['STOP_LOSS']", "['TAKE_PROFIT']"))
            ).sum(),
        ),
        "native_market_time_exits": len(time_exits),
        "findings": findings,
        "passed": not findings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.run, args.catalog_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
