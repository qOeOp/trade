"""Read-only H25a opportunity and native Account reservation attribution."""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import pandas as pd

from audit_d80_brooks_breakout_context import FOUR_HOUR_NS
from audit_d80_brooks_breakout_context import MILLISECOND_NS


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
D77 = RESULTS / "2026-10-08-d77-native-entry-geometry-bundles.json.gz"
D80 = RESULTS / "2026-10-08-d80-brooks-breakout-context-bundles.json.gz"
START = pd.Timestamp("2025-10-17T00:00:00Z").value
END = pd.Timestamp("2026-10-07T08:30:00Z").value
EXPECTED = {
    "h25": {
        "summary.json": "b5e052a37c7b4448e26cd0a3d07a714429eed9844cf461ccc686bdacfd8dd89a",
        "orders.csv": "d42381fe8b89d8d38ede2b9254fe212e8159e6c71022ea635c5312e55433a13c",
        "fills.csv": "deea705571d5574a6eb72402e82a7571450b2f6f8f17ebfdffe2b67159f35cc0",
        "positions.csv": "e1a6d42e3aeed012c88ff8b3000fe035ccd814c5c98ca43b2a6d45ca8fe766a6",
        "account.csv": "5466b9419852ef15543af48a9b695b34159b4b9d1194a6c1a5cdc293735aea32",
    },
    "h19": {
        "summary.json": "658145b32c86bfb947e4b1a909cc05e84a2f9284a6969ac7237ee538407b06fc",
        "orders.csv": "4c2e2a7e3b8218a9fc19926c57a4968d34bff9ab290d08a1c43fc9f50e52fd9f",
        "fills.csv": "64d80c70b318285a2bcaf841f176330e8bc28290c0e9860a1d4562109d2e5fda",
        "positions.csv": "f70afa4df79a7b61afe7fdcb8343aab47f61c25281a48c755f9ab6cda67d3af2",
        "account.csv": "69530413f22af40f57c5290dcc06417580c9f95f395b0c7c465b1d95ac2ab33e",
    },
}
AUDITS = {
    "2026-10-08-h25a-37-native-audit.json": "4ec28272e7445c0bef5e3279a3fb82cc6a3e1b562a470918ff7bd4081daa910d",
    "2026-10-08-h25a-37-support-clock.json": "f9476f2c07c138d278c5e8ae10b94cb6c604796d29d01219a5ee504f249c6174",
    "2026-10-08-h25a-paired-h19a-native-audit.json": "e24638b713ab1bff9119e955fd69eb2d1427bc3004e4cff8bf5e9853b20081d2",
    "2026-10-08-h25a-paired-h19a-parity.json": "3bc3b0d19902193078a6683b5db1c0138aa98e773cc0a4d01362b9ffa9ba89e2",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def native_report(run: Path, name: str) -> dict:
    for filename, expected in EXPECTED[name].items():
        if sha(run / filename) != expected:
            raise RuntimeError(f"{name}/{filename}: frozen native report changed")
    return {
        "summary": json.loads((run / "summary.json").read_text()),
        "orders": rows(run / "orders.csv"),
        "positions": rows(run / "positions.csv"),
    }


def weighted_quantile(values: list[tuple[float, int]], q: float) -> float:
    total = sum(duration for _, duration in values)
    threshold = total * q
    elapsed = 0
    for fraction, duration in sorted(values):
        elapsed += duration
        if elapsed >= threshold:
            return fraction
    return values[-1][0]


def reservation(run: Path) -> dict:
    samples = []
    previous_ns = None
    previous_fraction = 0.0
    events = 0
    with (run / "account.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            if row["currency"] != "USDT":
                continue
            ns = pd.Timestamp(row["ts_event"]).value
            if previous_ns is not None and ns < previous_ns:
                raise RuntimeError("native Account report clock regressed")
            if previous_ns is not None:
                begin, finish = max(previous_ns, START), min(ns, END)
                if finish > begin:
                    samples.append((previous_fraction, finish - begin))
            total = float(row["total"])
            locked = float(row["locked"])
            if total <= 0 or locked < 0:
                raise RuntimeError("invalid native Account total or locked margin")
            previous_fraction = locked / total
            previous_ns = ns
            events += 1
    if previous_ns is None or previous_ns > END:
        raise RuntimeError("native Account report lacks interval")
    samples.append((previous_fraction, END - max(previous_ns, START)))
    duration = sum(weight for _, weight in samples)
    if duration != END - START:
        raise RuntimeError("time-weighted Account interval incomplete")
    return {
        "native_account_events": events,
        "time_weighted_locked_to_total_mean": sum(value * weight for value, weight in samples) / duration,
        "time_weighted_locked_to_total_p50": weighted_quantile(samples, 0.5),
        "time_weighted_locked_to_total_p95": weighted_quantile(samples, 0.95),
        "observed_max_locked_to_total": max(value for value, _ in samples),
        "elapsed_fraction_under_1pct_locked": sum(weight for value, weight in samples if value < 0.01) / duration,
        "interpretation": "Native Account locked margin divided by Account total balance, time-weighted across report events; neither native Portfolio equity nor gross notional/stop-risk utilization.",
    }


def usdt(value: str) -> Decimal:
    return Decimal(value.removesuffix(" USDT"))


def position_summary(positions: list[dict], orders: dict) -> dict:
    closed = [p for p in positions if p["ts_closed"]]
    wins = [p for p in closed if usdt(p["realized_pnl"]) > 0]
    return {
        "positions": len(positions),
        "closed": len(closed),
        "open_censored": len(positions) - len(closed),
        "wins": len(wins),
        "native_closed_realized_pnl_usdt": str(sum((usdt(p["realized_pnl"]) for p in closed), Decimal(0))),
        "native_final_exit_type": dict(Counter(orders[p["closing_order_id"]]["type"] for p in closed)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h25", type=Path, required=True)
    parser.add_argument("--h19", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    h25 = native_report(args.h25, "h25")
    h19 = native_report(args.h19, "h19")
    for filename, digest in AUDITS.items():
        path = RESULTS / filename
        data = json.loads(path.read_text())
        if sha(path) != digest or not data.get("passed", data.get("parity_passed", False)):
            raise RuntimeError(f"required native audit changed or failed: {filename}")
    with gzip.open(D77, "rt") as stream:
        d77 = json.load(stream)
    with gzip.open(D80, "rt") as stream:
        old_source = {row["bundle_id"]: row for row in json.load(stream)}
    old_parent = {}
    old_bundles = defaultdict(list)
    for bundle in d77:
        source = old_source[bundle["bundle_id"]]
        first = bundle["tier_geometry"]["first"]
        key = (bundle["coin"], first["stop"], first["target"], source["signal_end_ns"] + MILLISECOND_NS)
        old_bundles[key].append(bundle)
        for tier in bundle["tier_geometry"].values():
            old_parent[tier["parent_order_id"]] = key
    new_by_list = defaultdict(dict)
    new_groups = defaultdict(list)
    for order in h25["orders"]:
        if order["order_list_id"]:
            new_by_list[order["order_list_id"]][order["tags"]] = order
        if order["tags"] == "['ENTRY']":
            new_groups[(order["strategy_id"].removeprefix("R1-"), int(order["ts_init"]))].append(order)
    decisions = defaultdict(list)
    for coin_row in h25["summary"]["per_coin"]:
        for record in coin_row["structural_support"]["decisions"]:
            if record["accepted"]:
                decisions[coin_row["coin"]].append(record)
    new_parent = {}
    new_bundles = defaultdict(list)
    for (coin, ts), parents in new_groups.items():
        stops = {new_by_list[p["order_list_id"]]["['STOP_LOSS']"]["trigger_price"] for p in parents}
        targets = {new_by_list[p["order_list_id"]]["['TAKE_PROFIT']"]["price"] for p in parents}
        if len(parents) != 2 or len(stops) != 1 or len(targets) != 1:
            raise RuntimeError("H25 native tier bundle geometry changed")
        stop, target = next(iter(stops)), next(iter(targets))
        matched = [
            record for record in decisions[coin]
            if record["rounded_stop"] == stop and record["rounded_b"] == target
            and record["signal_end_ns"] <= ts < record["signal_end_ns"] + 180 * FOUR_HOUR_NS
        ]
        if len(matched) != 1:
            raise RuntimeError(f"H25 native bundle lacks unique accepted source {coin}/{ts}")
        key = (coin, stop, target, matched[0]["signal_end_ns"])
        new_bundles[key].append(parents)
        for parent in parents:
            new_parent[parent["client_order_id"]] = key
    old_positions = defaultdict(list)
    new_positions = defaultdict(list)
    for p in h19["positions"]:
        old_positions[old_parent[p["opening_order_id"]]].append(p)
    for p in h25["positions"]:
        new_positions[new_parent[p["opening_order_id"]]].append(p)
    exact = {
        key for key in new_bundles.keys() & old_bundles.keys()
        if len(new_bundles[key]) == len(old_bundles[key]) == 1
    }
    paired_closed = [
        key for key in exact & new_positions.keys() & old_positions.keys()
        if all(p["ts_closed"] for p in new_positions[key])
        and all(p["ts_closed"] for p in old_positions[key])
    ]
    matched_new = [p for key in paired_closed for p in new_positions[key]]
    matched_old = [p for key in paired_closed for p in old_positions[key]]
    old_order = {o["client_order_id"]: o for o in h19["orders"]}
    new_order = {o["client_order_id"]: o for o in h25["orders"]}
    result = {
        "schema": "r1-native-d91-h25a-capacity/v1",
        "source_sha256": {"h25": EXPECTED["h25"], "h19": EXPECTED["h19"], "audits": AUDITS, "d77": sha(D77), "d80": sha(D80)},
        "native_account_equity_usdt": {"h25": h25["summary"]["final_equity_usdt"], "h19": h19["summary"]["final_equity_usdt"]},
        "native_account_locked_margin": {"h25": reservation(args.h25), "h19": reservation(args.h19)},
        "h25_native_positions": position_summary(h25["positions"], new_order),
        "h19_native_positions": position_summary(h19["positions"], old_order),
        "source_bundle_overlap": {
            "h25_submitted": sum(map(len, new_bundles.values())),
            "h19_submitted": sum(map(len, old_bundles.values())),
            "exact_unique_common_source_keys": len(exact),
            "h25_only_source_keys": len(new_bundles.keys() - old_bundles.keys()),
            "h19_only_source_keys": len(old_bundles.keys() - new_bundles.keys()),
            "ambiguous_source_keys": sum(len(new_bundles.get(key, [])) > 1 or len(old_bundles.get(key, [])) > 1 for key in new_bundles.keys() | old_bundles.keys()),
            "paired_fully_closed_common_source_bundles": len(paired_closed),
            "paired_h25_native_positions": position_summary(matched_new, new_order),
            "paired_h19_native_positions": position_summary(matched_old, old_order),
            "paired_native_closed_pnl_difference_usdt": str(
                sum((usdt(p["realized_pnl"]) for p in matched_new), Decimal(0))
                - sum((usdt(p["realized_pnl"]) for p in matched_old), Decimal(0))
            ),
        },
        "h25_decision_funnel": {
            "structural_decisions": sum(len(row["structural_support"]["decisions"]) for row in h25["summary"]["per_coin"]),
            "accepted": sum(row["structural_support"]["accepted"] for row in h25["summary"]["per_coin"]),
            "rejected": sum(row["structural_support"]["rejected"] for row in h25["summary"]["per_coin"]),
            "submitted_bundles": sum(map(len, new_bundles.values())),
            "accepted_waiting_plan_voids": sum(row["tiered_pullback"]["untouched_plan_voids"] for row in h25["summary"]["per_coin"]),
            "invalid_price_skips": sum(row["tiered_pullback"]["invalid_price_skips"] for row in h25["summary"]["per_coin"]),
            "minimum_quantity_skips": sum(row["tiered_pullback"]["minimum_skips"] for row in h25["summary"]["per_coin"]),
        },
        "limitations": ["Native locked margin is not notional exposure or risk utilization.", "Source-key paired Position PnL is descriptive; changing the shared-account opportunity path prevents causal interpretation.", "Feature was selected after many exposed-year reads and is not independently qualified."],
    }
    if (result["h25_native_positions"]["closed"], result["h19_native_positions"]["closed"]) != (102, 496):
        raise RuntimeError("native closed population changed")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
