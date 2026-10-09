"""Audit H29a native orders against frozen D99 signal geometry and OTO links."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EVENTS = ROOT / "results/2026-10-09-d99-failed-range-break-events.json"
EVENTS_SHA256 = "fe291be8173049f167d3012231459cc3e311de453039c7959adeb9480ab9c408"
FOUR_HOUR_NS = 14_400_000_000_000


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def audit(run: Path) -> dict:
    if sha(EVENTS) != EVENTS_SHA256:
        raise RuntimeError("frozen D99 event detail changed")
    summary = json.loads((run / "summary.json").read_text())
    if summary["signal_variant"] != "box-failed-breakout-4h":
        raise ValueError("H29a native report required")
    events = json.loads(EVENTS.read_text())
    expected = {(e["coin"], e["decision_ns"]): e for e in events}
    universe = {row["coin"]: row for row in summary["per_coin"]}
    instrument_coin = {row["instrument"]: coin for coin, row in universe.items()}
    orders = rows(run / "orders.csv")
    by_id = {row["client_order_id"]: row for row in orders}
    groups = defaultdict(list)
    for row in orders:
        groups[row["order_list_id"]].append(row)
    parents = [row for row in orders if row["tags"] == "['ENTRY']"]
    findings: list[str] = []
    seen = set()
    parent_coins = Counter()
    filled_parents = 0
    for parent in parents:
        order_id = parent["client_order_id"]
        coin = instrument_coin.get(parent["instrument_id"])
        key = (coin, int(parent["ts_init"]))
        event = expected.get(key)
        if event is None or key in seen:
            findings.append(f"{order_id}: no unique frozen D99 decision")
            continue
        seen.add(key)
        parent_coins[coin] += 1
        if (
            parent["type"] != "STOP_MARKET"
            or parent["side"] != "BUY"
            or parent["time_in_force"] != "GTD"
            or parent["contingency_type"] != "OTO"
            or Decimal(parent["trigger_price"]) != Decimal(event["native_trigger"])
            or int(parent["expire_time_ns"]) != key[1] + FOUR_HOUR_NS
        ):
            findings.append(f"{order_id}: native parent differs from frozen D99 plan")
        members = groups[parent["order_list_id"]]
        child = [row for row in members if row["parent_order_id"] == order_id]
        stops = [row for row in child if row["tags"] == "['STOP_LOSS']"]
        targets = [row for row in child if row["tags"] == "['TAKE_PROFIT']"]
        if len(members) != 3 or len(stops) != 1 or len(targets) != 1:
            findings.append(f"{order_id}: native OTO child topology differs")
            continue
        stop, target = stops[0], targets[0]
        if (
            stop["type"] != "STOP_MARKET"
            or stop["side"] != "SELL"
            or Decimal(stop["trigger_price"]) != Decimal(event["native_stop"])
            or target["type"] != "LIMIT"
            or target["side"] != "SELL"
            or Decimal(target["price"]) != Decimal(event["native_midpoint_target"])
            or stop["quantity"] != parent["quantity"]
            or target["quantity"] != parent["quantity"]
        ):
            findings.append(f"{order_id}: native protection differs from frozen D99 plan")
        if Decimal(parent["filled_qty"]) > 0:
            filled_parents += 1
            if int(parent["ts_last"]) > int(parent["expire_time_ns"]):
                findings.append(f"{order_id}: fill after next-bar GTD")
            if stop["status"] not in ("ACCEPTED", "TRIGGERED", "FILLED", "CANCELED"):
                findings.append(f"{order_id}: native protective stop was not activated")
            if target["status"] not in ("ACCEPTED", "FILLED", "CANCELED"):
                findings.append(f"{order_id}: native target was not activated")
        elif stop["status"] not in ("INITIALIZED", "CANCELED", "EXPIRED"):
            findings.append(f"{order_id}: unfilled parent activated protection")
    for coin, row in universe.items():
        signal_count = sum(e["coin"] == coin for e in events)
        observed = row["failed_range_breakout"]
        if observed["valid_signals"] != signal_count:
            findings.append(f"{coin}: native signal count differs from D99")
        if observed["submitted_brackets"] != parent_coins[coin]:
            findings.append(f"{coin}: native bracket count differs from report")
        if (
            observed["valid_signals"]
            != observed["submitted_brackets"]
            + observed["occupied_skips"]
            + row["risk_size_skips"]
        ):
            findings.append(f"{coin}: valid signals do not reconcile to native actions")
    positions = rows(run / "positions.csv")
    for position in positions:
        if position["opening_order_id"] not in by_id:
            findings.append("native position has no H29a entry parent")
        elif by_id[position["opening_order_id"]]["type"] != "STOP_MARKET":
            findings.append("native position entry is not a STOP_MARKET parent")
    return {
        "schema": "r1-native-h29a-source-order-audit/v1",
        "summary_sha256": sha(run / "summary.json"),
        "orders_sha256": sha(run / "orders.csv"),
        "positions_sha256": sha(run / "positions.csv"),
        "d99_events_sha256": EVENTS_SHA256,
        "coins": len(universe),
        "valid_signals": sum(sum(e["coin"] == c for e in events) for c in universe),
        "native_parent_orders": len(parents),
        "native_filled_parents": filled_parents,
        "native_positions": len(positions),
        "findings": findings[:100],
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
