"""Check H24a's gap decisions against native B fills and completed LAST bars."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import pandas as pd

from audit_d80_brooks_breakout_context import FOUR_HOUR_NS
from audit_d80_brooks_breakout_context import START
from audit_d80_brooks_breakout_context import native_bars


IDENTITY = Path(__file__).resolve().parent / "results/2026-10-07-input-identity.json"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def audit(run: Path) -> dict:
    summary = json.loads((run / "summary.json").read_text())
    identity = json.loads(IDENTITY.read_text())
    if (
        summary["signal_variant"] != "support-broad-gap-runner-4h"
        or len(summary["per_coin"]) != 37
    ):
        raise ValueError("full 37-coin H24a native report required")
    orders = read_csv(run / "orders.csv")
    fills = read_csv(run / "fills.csv")
    positions = read_csv(run / "positions.csv")
    by_list = defaultdict(dict)
    bundles = defaultdict(list)
    for order in orders:
        if order["order_list_id"]:
            by_list[order["order_list_id"]][order["tags"]] = order
        if order["tags"] == "['ENTRY']":
            bundles[(order["strategy_id"], order["ts_init"])].append(order)
    b_targets = {}
    for key, parents in bundles.items():
        if len(parents) != 4:
            raise RuntimeError(f"incomplete native four-bracket bundle {key}")
        targets = [
            by_list[parent["order_list_id"]]["['TAKE_PROFIT']"] for parent in parents
        ]
        b_price = min(Decimal(target["price"]) for target in targets)
        for target in targets:
            if Decimal(target["price"]) == b_price:
                b_targets[target["client_order_id"]] = key
    first_b = {}
    for fill in fills:
        key = b_targets.get(fill["client_order_id"])
        if key is None:
            continue
        ts = pd.Timestamp(fill["ts_event"]).value
        if key not in first_b or ts < first_b[key]:
            first_b[key] = ts
    position_times = defaultdict(list)
    for position in positions:
        position_times[position["strategy_id"]].append(
            (
                pd.Timestamp(position["ts_opened"]).value,
                pd.Timestamp(position["ts_closed"]).value
                if position["ts_closed"]
                else None,
                position["closing_order_id"],
            )
        )
    by_coin = defaultdict(list)
    for key, fill_ns in first_b.items():
        strategy, _ = key
        coin = strategy.removeprefix("R1-")
        decision_ns = (fill_ns // FOUR_HOUR_NS + 2) * FOUR_HOUR_NS
        matching_positions = [
            (opened, closed, closing_order)
            for opened, closed, closing_order in position_times[strategy]
            if opened <= fill_ns and (closed is None or fill_ns <= closed)
        ]
        if len(matching_positions) != 1:
            raise RuntimeError(
                f"native B fill has {len(matching_positions)} Positions: {key}"
            )
        _, closed_ns, close_order = matching_positions[0]
        by_coin[coin].append(
            {
                "bundle": key,
                "first_b_fill_ns": fill_ns,
                "gap_decision_ns": decision_ns,
                "position_closed_ns": closed_ns,
                "position_close_order_id": close_order,
                "position_reaches_decision": closed_ns is None
                or closed_ns >= decision_ns,
            }
        )
    old_close_market = {
        row["client_order_id"]
        for row in orders
        if row["type"] == "MARKET"
        and row["side"] == "SELL"
        and row["status"] == "FILLED"
    }
    findings = []
    checked = []
    catalog_root = Path(identity["minute_catalog_root"])
    for coin_identity in identity["coins"]:
        coin = coin_identity["coin"]
        if not by_coin[coin]:
            continue
        _, bars, _ = native_bars(
            catalog_root, coin, coin_identity["minute_catalog"]["sha256"]
        )
        for case in by_coin[coin]:
            i = (case["first_b_fill_ns"] - START) // FOUR_HOUR_NS
            if i < 1 or i + 1 >= len(bars):
                findings.append(f"{case['bundle']}: native gap bar not observable")
                continue
            gap = bars[i + 1]["low"] > bars[i - 1]["high"]
            case["micro_gap"] = gap
            case["coin"] = coin
            case["native_market_close"] = (
                case["position_close_order_id"] in old_close_market
            )
            checked.append(case)
    observed_gap = sum(
        row["position_reaches_decision"] and row["micro_gap"] for row in checked
    )
    observed_no_gap = sum(
        row["position_reaches_decision"] and not row["micro_gap"] for row in checked
    )
    summary_gap = sum(
        row["gap_runner"]["persistent_gap_decisions"] for row in summary["per_coin"]
    )
    summary_no_gap = sum(
        row["gap_runner"]["no_gap_decisions"] for row in summary["per_coin"]
    )
    if (observed_gap, observed_no_gap) != (summary_gap, summary_no_gap):
        findings.append(
            f"native closed-bar decisions {observed_gap}/{observed_no_gap} differ from Strategy {summary_gap}/{summary_no_gap}"
        )
    no_gap_missing_market = [
        row["bundle"]
        for row in checked
        if row["position_reaches_decision"]
        and not row["micro_gap"]
        and not row["native_market_close"]
    ]
    if no_gap_missing_market:
        findings.append(
            f"no-gap runner lacked native market exit: {no_gap_missing_market[:5]}"
        )
    return {
        "schema": "r1-native-h24a-gap-clock/v1",
        "run": str(run),
        "source_sha256": {
            name: sha(run / name)
            for name in ("summary.json", "orders.csv", "fills.csv", "positions.csv")
        },
        "first_native_b_target_fills": len(first_b),
        "native_positions_reaching_gap_decision": sum(
            row["position_reaches_decision"] for row in checked
        ),
        "catalog_micro_gap_decisions": observed_gap,
        "catalog_no_gap_decisions": observed_no_gap,
        "strategy_micro_gap_decisions": summary_gap,
        "strategy_no_gap_decisions": summary_no_gap,
        "no_gap_without_native_market_close": len(no_gap_missing_market),
        "findings": findings,
        "passed": not findings,
    }


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
