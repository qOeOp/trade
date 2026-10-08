"""
Audit budgeted native tier orders, fills and open protection from reports.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

import pandas as pd

from vibe_trading.persistence import ParquetDataCatalog


TERMINAL = {"FILLED", "CANCELED", "EXPIRED", "DENIED", "REJECTED"}
OPEN = {"ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED", "PENDING_UPDATE"}
FOUR_HOUR_NS = 4 * 3_600_000_000_000
TIER_RATIOS = {
    "support-three-tier-4h": (Decimal("0.5"), Decimal("0.618"), Decimal("0.764")),
    "support-deep-two-tier-4h": (Decimal("0.618"), Decimal("0.764")),
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


def audit(run: Path, catalog_root: Path) -> dict:  # noqa: C901 - one native report audit.
    summary = json.loads((run / "summary.json").read_text())
    ratios = TIER_RATIOS.get(summary["signal_variant"])
    if ratios is None:
        raise ValueError("budgeted native tier replay required")
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
            entry.type != "LIMIT"
            or entry.side != "BUY"
            or entry.time_in_force != "GTD"
            or entry.contingency_type != "OTO"
            or stop.type != "STOP_MARKET"
            or target.type != "LIMIT"
            or stop.parent_order_id != entry.client_order_id
            or target.parent_order_id != entry.client_order_id
        ):
            findings.append(f"invalid native bracket topology {list_id}")
        if (
            _decimal(entry.quantity) != _decimal(stop.quantity)
            or _decimal(entry.quantity) != _decimal(target.quantity)
            or not 0 < _decimal(stop.trigger_price) < _decimal(entry.price) < _decimal(target.price)
        ):
            findings.append(f"invalid native bracket prices or quantities {list_id}")
        decision_ns = int(entry.ts_init) // FOUR_HOUR_NS * FOUR_HOUR_NS
        if int(entry.expire_time_ns) != decision_ns + 30 * FOUR_HOUR_NS:
            findings.append(f"entry GTD deadline differs {list_id}")
        if entry.status in {"CANCELED", "EXPIRED"} and (
            stop.status != "CANCELED" or target.status != "CANCELED"
        ):
            findings.append(f"terminal unfilled entry retains child {list_id}")
        if entry.status == "FILLED" and int(entry.ts_last) <= int(entry.ts_init):
            findings.append(f"entry filled at or before submission {list_id}")
    for (strategy_id, ts_init), group in entries.groupby(["strategy_id", "ts_init"]):
        sorted_group = group.sort_values("price", ascending=False)
        if len(sorted_group) != len(ratios):
            findings.append(f"bundle has {len(sorted_group)} tiers: {strategy_id} {ts_init}")
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
        if not (0 < stop < estimated_a < levels[-1] < target) or any(
            higher <= lower for higher, lower in pairwise(levels)
        ):
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
            & (orders.parent_order_id.isin(entries[entries.status == "FILLED"].client_order_id))
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
    entry_status = entries.set_index("client_order_id").status.to_dict()
    for row in orders[
        orders.status.isin(OPEN) & orders.tags.isin(("['STOP_LOSS']", "['TAKE_PROFIT']"))
    ].itertuples():
        parent_status = entry_status.get(row.parent_order_id)
        if row.status == "SUBMITTED":
            # Native OTO children wait at SUBMITTED until their entry fills.
            if parent_status not in {"ACCEPTED", "SUBMITTED", "PARTIALLY_FILLED", "PENDING_UPDATE"}:
                findings.append(f"dormant exit has no live entry {row.client_order_id}")
        elif parent_status not in {"FILLED", "PARTIALLY_FILLED"}:
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
        "filled_entries": int((entries.status == "FILLED").sum()),
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
