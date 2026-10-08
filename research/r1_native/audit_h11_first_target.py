"""
Audit actual H11 native target fills as a fixed-position-set opportunity screen.
"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path


REPORT_SHA256 = {
    "orders.csv": "32d4b96c2e2f6260c7967b5535c056889e4c32dbabb9bb9eef7a48577890b256",
    "fills.csv": "92280f293f95637ac390d01c3be662ceb8896806ecf2b22e86b460679043afc5",
    "positions.csv": "30f38bc97ba757196674ca93e433b6b996467c408b15451cfff92707329c97c5",
    "summary.json": "f3ecaa606741c96dbd14cf2cf4340db4f4bc42632daccdb75c15413042fed5ba",
}
STAGED_SOURCE_SHA256 = "0959fc660d11c7e50c76d42f960b94c2edb14468c69d04934178c693648862ef"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as file:
        return list(csv.DictReader(file))


def _money(value: str) -> Decimal:
    return Decimal(value.split()[0])


def _load(root: Path):
    for name, digest in REPORT_SHA256.items():
        if _sha(root / name) != digest:
            raise RuntimeError(f"frozen H11 native report changed: {name}")
    summary = json.loads((root / "summary.json").read_text())
    if summary["staged_strategy_source_sha256"] != STAGED_SOURCE_SHA256:
        raise RuntimeError("H11 native Strategy source differs")
    orders = _read_csv(root / "orders.csv")
    fills = _read_csv(root / "fills.csv")
    positions = _read_csv(root / "positions.csv")
    by_id = {order["client_order_id"]: order for order in orders}
    if len(by_id) != len(orders):
        raise RuntimeError("duplicate native order ID")
    by_trade = {fill["trade_id"]: fill for fill in fills}
    if len(by_trade) != len(fills):
        raise RuntimeError("duplicate native fill trade ID")
    closed = [position for position in positions if position["ts_closed"]]
    if (
        len(closed) != summary["closed_trades"]
        or sum(_money(position["realized_pnl"]) > 0 for position in closed)
        != summary["winning_trades"]
    ):
        raise RuntimeError("H11 native closed-position or win count differs")
    return summary, closed, by_id, by_trade


def _target_fills(position: dict[str, str], by_id: dict, by_trade: dict):
    events = ast.literal_eval(position["events"])
    if not isinstance(events, list):
        raise TypeError("native position events are not a list")
    seen_trades = set()
    target_fills = []
    for event in events:
        if event["type"] != "OrderFilled":
            continue
        trade_id = event["trade_id"]
        if trade_id in seen_trades or trade_id not in by_trade:
            raise RuntimeError("duplicate or missing native position fill")
        seen_trades.add(trade_id)
        fill = by_trade[trade_id]
        if fill["client_order_id"] != event["client_order_id"]:
            raise RuntimeError("native position event/fill order ID differs")
        order = by_id.get(event["client_order_id"])
        if order is None:
            raise RuntimeError("native filled order absent from order report")
        if order["type"] != "LIMIT" or order["is_reduce_only"] != "True":
            continue
        if order["side"] == position["entry"]:
            raise RuntimeError("target order has opening side")
        entry = Decimal(position["avg_px_open"])
        target_price = Decimal(order["price"])
        if (target_price - entry) * (1 if position["entry"] == "BUY" else -1) <= 0:
            raise RuntimeError("native target price is not favorable to entry")
        target_fills.append(
            {
                "client_order_id": order["client_order_id"],
                "last_qty": str(Decimal(fill["last_qty"])),
                "order_price": str(target_price),
                "fill_price": fill["last_px"],
            },
        )
    return target_fills


def _position_row(position: dict[str, str], by_id: dict, by_trade: dict) -> dict:
    target_fills = _target_fills(position, by_id, by_trade)
    target_qty = sum((Decimal(fill["last_qty"]) for fill in target_fills), Decimal(0))
    peak_qty = Decimal(position["peak_qty"])
    if peak_qty <= 0 or target_qty > peak_qty:
        raise RuntimeError("target fill exceeds native peak position quantity")
    closing_order = by_id.get(position["closing_order_id"])
    if closing_order is None:
        raise RuntimeError("native closing order missing")
    return {
        "position_id": position["position_id"],
        "instrument_id": position["instrument_id"],
        "realized_pnl_usdt": str(_money(position["realized_pnl"])),
        "target_fill_count": len(target_fills),
        "target_filled_fraction_of_peak": str(target_qty / peak_qty),
        "closing_order_type": closing_order["type"],
        "target_fills": target_fills,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary, closed, by_id, by_trade = _load(args.native_report)
    rows = [_position_row(position, by_id, by_trade) for position in closed]
    reached = [row for row in rows if row["target_fill_count"] > 0]
    partially_reached = [
        row for row in reached if Decimal(row["target_filled_fraction_of_peak"]) < 1
    ]
    missed = [row for row in rows if row["target_fill_count"] == 0]
    missed_native_winners = [row for row in missed if Decimal(row["realized_pnl_usdt"]) > 0]
    output = {
        "method": "read-only native H11 position-event, fill and reduce-only LIMIT order joins; any target fill is a generous fixed-set +1R opportunity, not an all-at-1R replay",
        "reader_sha256": _sha(Path(__file__)),
        "report_sha256": REPORT_SHA256,
        "native_closed_positions": len(closed),
        "native_winning_positions": summary["winning_trades"],
        "positions_with_native_target_fill": len(reached),
        "positions_with_partial_target_fill": len(partially_reached),
        "positions_without_target_fill": len(missed),
        "native_winners_without_target_fill": len(missed_native_winners),
        "target_reached_closing_order_types": dict(
            Counter(row["closing_order_type"] for row in reached),
        ),
        "target_reached_nonpositive_positions": sum(
            Decimal(row["realized_pnl_usdt"]) <= 0 for row in reached
        ),
        "fixed_set_optimistic_target_fill_win_rate_pct": 100 * len(reached) / len(closed),
        "fixed_set_target_or_native_winner_coverage_pct": 100
        * (len(reached) + len(missed_native_winners))
        / len(closed),
        "passes_55pct_coverage_scale": len(reached) >= 549,
        "passes_60pct_coverage_scale": len(reached) >= 599,
        "positions_with_target_fill": reached,
        "economic_replay": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
