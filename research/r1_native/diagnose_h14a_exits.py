"""
Attribute frozen H14a and paired H13f positions to native closing orders.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from diagnose_h13f_exits import _closed_rows
from diagnose_h13f_exits import _read_csv
from diagnose_h13f_exits import _statistics


READBACK_SHA256 = "1369b89be5c92d8e5c2c0af3ed35adead766324c535f04e51af7e0158044bbbc"
BUCKETS = ("stop_loss", "take_profit", "market_time", "other_unknown")
REPORTS = ("summary.json", "orders.csv", "positions.csv", "fills.csv")


def _run(run: Path, identity: dict, variant: str) -> dict:
    hashes = {name: hashlib.sha256((run / name).read_bytes()).hexdigest() for name in REPORTS}
    if hashes != {name: identity["files_sha256"][name] for name in REPORTS}:
        raise RuntimeError(f"frozen native reports differ: {run}")
    summary = json.loads((run / "summary.json").read_text())
    if summary["signal_variant"] != variant or not summary["integrity_passed"]:
        raise RuntimeError(f"wrong or failed native strategy: {run}")
    orders = _read_csv(run / "orders.csv")
    order_by_id = {order["client_order_id"]: order for order in orders}
    if len(order_by_id) != len(orders):
        raise RuntimeError(f"duplicate native order ID: {run}")
    positions = _read_csv(run / "positions.csv")
    closed, open_positions = _closed_rows(positions, order_by_id)
    if (
        len(closed) != summary["closed_trades"]
        or sum(row["pnl"] > 0 for row in closed) != summary["winning_trades"]
        or len(closed) + len(open_positions) != len(positions)
    ):
        raise RuntimeError(f"native position counts do not reconcile: {run}")
    by_bucket = defaultdict(list)
    by_coin = defaultdict(list)
    for row in closed:
        by_bucket[row["bucket"]].append(row)
        by_coin[row["coin"]].append(row)
    return {
        "run": str(run),
        "reports_sha256": hashes,
        "closed_total": _statistics(closed),
        "buckets": {name: _statistics(by_bucket[name]) for name in BUCKETS},
        "per_coin": {
            coin: {
                "total": _statistics(rows),
                "buckets": {
                    name: _statistics([row for row in rows if row["bucket"] == name])
                    for name in BUCKETS
                },
            }
            for coin, rows in sorted(by_coin.items())
        },
        "open_position_ids": open_positions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--readback", type=Path, required=True)
    parser.add_argument("--candidate-run", type=Path, required=True)
    parser.add_argument("--baseline-run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.readback.read_bytes()).hexdigest() != READBACK_SHA256:
        raise RuntimeError("D43 native readback identity differs")
    readback = json.loads(args.readback.read_text())
    result = {
        "method": "read-only native closing-order attribution; no replacement fills or PnL",
        "readback_sha256": READBACK_SHA256,
        "candidate": _run(args.candidate_run, readback["candidate"], "support-near50-4h"),
        "baseline": _run(args.baseline_run, readback["baseline"], "support-rejection-4h"),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
