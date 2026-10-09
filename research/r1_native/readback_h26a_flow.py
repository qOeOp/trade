"""Read-only H26a/H25a native source-bundle overlap and Account reservation."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from audit_d91_h25a_capacity import FOUR_HOUR_NS
from audit_d91_h25a_capacity import reservation


def read(run: Path) -> dict:
    summary = json.loads((run / "summary.json").read_text())
    with (run / "orders.csv").open(newline="") as source:
        orders = list(csv.DictReader(source))
    with (run / "positions.csv").open(newline="") as source:
        positions = list(csv.DictReader(source))
    if not summary["integrity_passed"]:
        raise RuntimeError(f"native integrity failed: {run}")
    by_list = defaultdict(dict)
    entries = defaultdict(list)
    for order in orders:
        if order["order_list_id"]:
            by_list[order["order_list_id"]][order["tags"]] = order
        if order["tags"] == "['ENTRY']":
            entries[(order["strategy_id"].removeprefix("R1-"), int(order["ts_init"]))].append(order)
    decisions = {
        row["coin"]: [
            item for item in row["structural_support"]["decisions"] if item["accepted"]
        ]
        for row in summary["per_coin"]
    }
    bundles = {}
    parent_key = {}
    for (coin, ts), parents in entries.items():
        stops = {by_list[p["order_list_id"]]["['STOP_LOSS']"]["trigger_price"] for p in parents}
        targets = {by_list[p["order_list_id"]]["['TAKE_PROFIT']"]["price"] for p in parents}
        if len(parents) != 2 or len(stops) != 1 or len(targets) != 1:
            raise RuntimeError(f"native two-tier geometry changed: {coin}/{ts}")
        stop, target = next(iter(stops)), next(iter(targets))
        matches = [
            record for record in decisions[coin]
            if record["rounded_stop"] == stop
            and record["rounded_b"] == target
            and record["signal_end_ns"] <= ts < record["signal_end_ns"] + 180 * FOUR_HOUR_NS
        ]
        if len(matches) != 1:
            raise RuntimeError(f"native order lacks unique accepted source: {coin}/{ts}")
        key = (coin, stop, target, matches[0]["signal_end_ns"])
        if key in bundles:
            raise RuntimeError(f"duplicate native source key: {key}")
        bundles[key] = parents
        for parent in parents:
            parent_key[parent["client_order_id"]] = key
    outcomes = defaultdict(list)
    for position in positions:
        outcomes[parent_key[position["opening_order_id"]]].append(position)
    return {
        "summary": summary,
        "bundles": bundles,
        "outcomes": outcomes,
        "reservation": reservation(run),
        "sha256": {name: hashlib.sha256((run / name).read_bytes()).hexdigest() for name in ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv")},
    }


def cohort(outcomes: dict, keys: set) -> dict:
    positions = [p for key in keys for p in outcomes.get(key, [])]
    closed = [p for p in positions if p["ts_closed"]]
    pnls = [Decimal(p["realized_pnl"].removesuffix(" USDT")) for p in closed]
    return {
        "positions": len(positions),
        "closed": len(closed),
        "open_censored": len(positions) - len(closed),
        "positive_closed": sum(pnl > 0 for pnl in pnls),
        "native_closed_realized_pnl_usdt": str(sum(pnls, Decimal(0))),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    candidate, baseline = read(args.candidate), read(args.baseline)
    if (
        candidate["summary"]["signal_variant"] != "support-broad-any-prior-a-support-4h"
        or baseline["summary"]["signal_variant"] != "support-broad-prior-a-support-4h"
        or candidate["summary"]["runner_source_sha256"] != baseline["summary"]["runner_source_sha256"]
        or candidate["summary"]["period_start_utc"] != baseline["summary"]["period_start_utc"]
        or candidate["summary"]["period_end_utc"] != baseline["summary"]["period_end_utc"]
    ):
        raise RuntimeError("H26a/H25a native comparison identities differ")
    newer, older = set(candidate["bundles"]), set(baseline["bundles"])
    result = {
        "method": "read-only native order source-key and Position/Account readback; no hypothetical fills or account equity",
        "candidate_sha256": candidate["sha256"],
        "baseline_sha256": baseline["sha256"],
        "candidate_submitted_bundles": len(newer),
        "baseline_submitted_bundles": len(older),
        "exact_common_source_keys": len(newer & older),
        "candidate_only_source_keys": len(newer - older),
        "baseline_only_source_keys": len(older - newer),
        "candidate_only_positions": cohort(candidate["outcomes"], newer - older),
        "candidate_common_positions": cohort(candidate["outcomes"], newer & older),
        "baseline_common_positions": cohort(baseline["outcomes"], newer & older),
        "candidate_native_locked_margin": candidate["reservation"],
        "baseline_native_locked_margin": baseline["reservation"],
        "caution": "Source-key cohorts are descriptive under a changed shared-account path; candidate-only Position PnL does not identify an isolated causal effect of removing B resistance veto.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
