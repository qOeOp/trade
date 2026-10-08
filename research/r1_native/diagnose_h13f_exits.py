"""
Attribute frozen H13f native closed positions to their actual closing orders.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from statistics import median


EXPECTED_SHA256 = {
    "summary.json": "a401a4edd0d0412726b59adf1d96769a0fe6af26c5bdef9711efb78951994f5e",
    "orders.csv": "48c689e9e5fbae9dee400ea157bfc9612cf8a7901c15a3c699488f4dcd2d846a",
    "positions.csv": "bb745c7194b2ca981db970bff226a1df96c6084676e2df0bd384d4ca0618fea7",
    "fills.csv": "98c20caa1e881160185b6f789ac3ebea01ae431f482cb461cd191940a7efe788",
}
DAY_NS = Decimal(86_400_000_000_000)


def _read_csv(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def _classify(order: dict) -> str:
    if order["type"] == "STOP_MARKET" and order["tags"] == "['STOP_LOSS']":
        return "stop_loss"
    if order["type"] == "LIMIT" and order["tags"] == "['TAKE_PROFIT']":
        return "take_profit"
    if order["type"] == "MARKET":
        return "market_time"
    return "other_unknown"


def _statistics(rows: list[dict]) -> dict:
    wins = [row for row in rows if row["pnl"] > 0]
    days = [row["duration_days"] for row in rows]
    return {
        "closed_positions": len(rows),
        "positive_positions": len(wins),
        "signed_realized_pnl_usdt": str(sum((row["pnl"] for row in rows), Decimal(0))),
        "average_duration_days": str(sum(days, Decimal(0)) / len(days)) if days else None,
        "median_duration_days": str(median(days)) if days else None,
    }


def _closed_rows(
    positions: list[dict],
    order_by_id: dict[str, dict],
) -> tuple[list[dict], list[str]]:
    closed: list[dict] = []
    open_positions: list[str] = []
    for position in positions:
        if not position["ts_closed"]:
            open_positions.append(position["position_id"])
            continue
        order = order_by_id.get(position["closing_order_id"])
        if order is None or order["instrument_id"] != position["instrument_id"]:
            raise RuntimeError(f"missing matching native closing order: {position['position_id']}")
        if order["status"] != "FILLED":
            raise RuntimeError(f"terminal position lacks filled exit: {position['position_id']}")
        closed.append(
            {
                "coin": position["instrument_id"].split("USDT-")[0],
                "bucket": _classify(order),
                "pnl": Decimal(position["realized_pnl"].split()[0]),
                "duration_days": Decimal(position["duration_ns"]) / DAY_NS,
            },
        )
    return closed, open_positions


def diagnose(run: Path) -> dict:
    hashes = {
        name: hashlib.sha256((run / name).read_bytes()).hexdigest() for name in EXPECTED_SHA256
    }
    if hashes != EXPECTED_SHA256:
        raise RuntimeError("frozen native report bytes differ from D37 preregistration")
    summary = json.loads((run / "summary.json").read_text())
    if summary["signal_variant"] != "support-rejection-4h" or not summary["integrity_passed"]:
        raise RuntimeError("complete H13f native report required")
    orders = _read_csv(run / "orders.csv")
    order_by_id = {order["client_order_id"]: order for order in orders}
    if len(order_by_id) != len(orders):
        raise RuntimeError("duplicate native order identity")
    closed, open_positions = _closed_rows(_read_csv(run / "positions.csv"), order_by_id)
    wins = sum(row["pnl"] > 0 for row in closed)
    if len(closed) != summary["closed_trades"] or wins != summary["winning_trades"]:
        raise RuntimeError("native closed count or positive count does not reconcile")
    if len(open_positions) != 1:
        raise RuntimeError("frozen H13f open-position count differs")
    by_bucket = defaultdict(list)
    by_coin = defaultdict(list)
    for row in closed:
        by_bucket[row["bucket"]].append(row)
        by_coin[row["coin"]].append(row)
    buckets = {
        name: _statistics(by_bucket[name])
        for name in ("stop_loss", "take_profit", "market_time", "other_unknown")
    }
    return {
        "method": "read-only D37 native closing-order attribution; no replacement fills or PnL",
        "registration_commit": "56e74720d",
        "report_sha256": hashes,
        "closed_total": _statistics(closed),
        "buckets": buckets,
        "per_coin": {coin: _statistics(rows) for coin, rows in sorted(by_coin.items())},
        "open_position_ids": open_positions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(args.run)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
