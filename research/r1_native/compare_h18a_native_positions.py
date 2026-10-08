"""
Attribute paired H18a and H15a native position differences without replaying fills.
"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path


REPORTS = ("summary.json", "positions.csv", "fills.csv", "orders.csv")


def _read(run: Path) -> tuple[dict, dict]:
    summary = json.loads((run / "summary.json").read_text())
    positions = {}
    with (run / "positions.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            key = (row["strategy_id"], row["ts_opened"], row["opening_order_id"])
            if key in positions:
                raise RuntimeError(f"duplicate native position key: {key}")
            events = ast.literal_eval(row["events"])
            if not events or events[0]["client_order_id"] != row["opening_order_id"]:
                raise RuntimeError(f"native opening event differs: {key}")
            positions[key] = {
                "closed": bool(row["ts_closed"]),
                "pnl": Decimal(row["realized_pnl"].split()[0]),
                "buy_fills": sum(event["order_side"] == "BUY" for event in events),
                "closing_order_type": events[-1]["order_type"] if row["ts_closed"] else None,
            }
    if len(positions) != summary["closed_trades"] + sum(
        not row["closed"] for row in positions.values()
    ):
        raise RuntimeError("native position count differs from summary")
    return summary, positions


def compare(candidate: Path, baseline: Path) -> dict:
    child_summary, child = _read(candidate)
    parent_summary, parent = _read(baseline)
    if (
        child.keys() != parent.keys()
        or child_summary["runner_source_sha256"] != parent_summary["runner_source_sha256"]
        or child_summary["strategy_source_sha256"] != parent_summary["strategy_source_sha256"]
        or not child_summary["integrity_passed"]
        or not parent_summary["integrity_passed"]
    ):
        raise RuntimeError("paired native position identity or integrity differs")
    counts = Counter()
    pnl = defaultdict(Decimal)
    changed = []
    for key in sorted(child):
        new, old = child[key], parent[key]
        if new["closed"] != old["closed"]:
            raise RuntimeError(f"paired position closure differs: {key}")
        if new["buy_fills"] > old["buy_fills"]:
            raise RuntimeError(f"cancel child gained native entry fills: {key}")
        avoided = old["buy_fills"] - new["buy_fills"]
        delta = new["pnl"] - old["pnl"]
        group = "avoided_entry_fills" if avoided else "same_entry_fill_count"
        closure = "closed" if new["closed"] else "open"
        counts[f"{group}_{closure}"] += 1
        counts["avoided_entry_fill_events"] += avoided
        pnl[f"{group}_{closure}"] += delta
        if delta or avoided:
            changed.append(
                {
                    "strategy_id": key[0],
                    "ts_opened": key[1],
                    "opening_order_id": key[2],
                    "avoided_entry_fills": avoided,
                    "closed": new["closed"],
                    "parent_closing_order_type": old["closing_order_type"],
                    "child_closing_order_type": new["closing_order_type"],
                    "parent_realized_pnl_usdt": str(old["pnl"]),
                    "child_realized_pnl_usdt": str(new["pnl"]),
                    "realized_pnl_delta_usdt": str(delta),
                },
            )
    return {
        "method": "paired native Position rows with identical first fill; retrospective attribution only, no tier PnL or counterfactual ledger",
        "candidate": str(candidate),
        "baseline": str(baseline),
        "file_sha256": {
            name: {
                "candidate": hashlib.sha256((candidate / name).read_bytes()).hexdigest(),
                "baseline": hashlib.sha256((baseline / name).read_bytes()).hexdigest(),
            }
            for name in REPORTS
        },
        "positions": len(child),
        "counts": dict(sorted(counts.items())),
        "realized_pnl_delta_usdt": {key: str(value) for key, value in sorted(pnl.items())},
        "paired_positions_with_delta_or_avoided_fill": changed,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compare(args.candidate, args.baseline)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
