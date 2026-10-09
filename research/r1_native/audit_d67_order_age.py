"""Read only: H19a native Position outcomes by first-fill plan age."""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
from decimal import Decimal
from pathlib import Path

import numpy as np


FOUR_HOUR_NS = 4 * 60 * 60 * 1_000_000_000
PLAN_LIFETIME_NS = 180 * FOUR_HOUR_NS
EARLY_LIFETIME_NS = 30 * FOUR_HOUR_NS
EXPECTED = {
    "summary.json": "d6fd06da5cb743acf568a0c80dfb6b3d45342c816977b5e5c77d0b1625a153cb",
    "orders.csv": "81c5feddd9cb44f50f6c83df921bc945b84a089bcee622fb291a7cfb1a1b8e96",
    "positions.csv": "498551ad70c41701778f9b004aaa77ec2d602de72846acfd0fa3efe2cfbde218",
    "parity-cleanup-h19a.json": "9b5e57720e779cc03241545bd85542a31f1a23a241c587c3ddbde0c261e4df64",
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _money(value: str) -> Decimal:
    return Decimal(value.split()[0])


def _segment(rows: list[dict]) -> dict:
    closed = [row for row in rows if row["closed"]]
    open_rows = [row for row in rows if not row["closed"]]
    winners = [row for row in closed if Decimal(row["native_realized_pnl_usdt"]) > 0]
    losers = [row for row in closed if Decimal(row["native_realized_pnl_usdt"]) < 0]
    winner_sum = sum((Decimal(row["native_realized_pnl_usdt"]) for row in winners), Decimal(0))
    loser_sum = sum((Decimal(row["native_realized_pnl_usdt"]) for row in losers), Decimal(0))
    closed_pnl = winner_sum + loser_sum
    age = np.array([row["first_fill_age_four_hour_bars"] for row in rows], dtype=float)
    return {
        "positions": len(rows),
        "closed": len(closed),
        "open_right_censored": len(open_rows),
        "closed_winners": len(winners),
        "closed_nonwinners": len(closed) - len(winners),
        "closed_win_rate": len(winners) / len(closed) if closed else None,
        "closed_native_net_pnl_usdt": str(closed_pnl),
        "open_native_realized_pnl_usdt": str(sum((_money(row["native_realized_pnl_usdt"]) for row in open_rows), Decimal(0))),
        "mean_closed_native_net_pnl_usdt": str(closed_pnl / len(closed)) if closed else None,
        "mean_win_to_mean_loss_magnitude": (
            float((winner_sum / len(winners)) / (-loser_sum / len(losers)))
            if winners and losers else None
        ),
        "first_fill_age_four_hour_bars": {
            "median": float(np.median(age)) if len(age) else None,
            "p90": float(np.quantile(age, 0.9)) if len(age) else None,
            "max": float(age.max()) if len(age) else None,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    observed = {
        name: _sha(args.parity if name == "parity-cleanup-h19a.json" else args.run / name)
        for name in EXPECTED
    }
    if observed != EXPECTED:
        raise RuntimeError(f"frozen native inputs changed: {observed}")
    summary = json.loads((args.run / "summary.json").read_text())
    parity = json.loads(args.parity.read_text())
    if not summary["integrity_passed"] or summary["denied_orders"] or summary["rejected_orders"]:
        raise RuntimeError("native runner integrity gate failed")
    if not parity["parity_passed"] or parity["candidate"] != str(args.run):
        raise RuntimeError("published Nautilus parity receipt does not bind the native run")
    with (args.run / "orders.csv").open(newline="") as stream:
        orders = list(csv.DictReader(stream))
    by_id = {row["client_order_id"]: row for row in orders}
    if len(by_id) != len(orders):
        raise RuntimeError("duplicate native order ID")
    rows = []
    with (args.run / "positions.csv").open(newline="") as stream:
        for position in csv.DictReader(stream):
            events = ast.literal_eval(position["events"])
            buys = [event for event in events if event["type"] == "OrderFilled" and event["order_side"] == "BUY"]
            if not buys or buys[0]["client_order_id"] != position["opening_order_id"]:
                raise RuntimeError(f"{position['position_id']}: first native fill mismatch")
            first_fill = buys[0]
            first_order = by_id[first_fill["client_order_id"]]
            if first_order["type"] != "LIMIT" or first_order["side"] != "BUY" or first_order["time_in_force"] != "GTD":
                raise RuntimeError(f"{position['position_id']}: first entry is not a native GTD buy limit")
            plan_ns = int(first_order["expire_time_ns"]) - PLAN_LIFETIME_NS
            first_fill_ns = int(first_fill["ts_event"])
            if not 0 < plan_ns <= int(first_order["ts_init"]) <= first_fill_ns < int(first_order["expire_time_ns"]):
                raise RuntimeError(f"{position['position_id']}: invalid plan/order/fill clock")
            rows.append({
                "position_id": position["position_id"],
                "instrument_id": position["instrument_id"],
                "first_entry_order_id": first_fill["client_order_id"],
                "plan_ns": plan_ns,
                "first_order_init_ns": int(first_order["ts_init"]),
                "first_fill_ns": first_fill_ns,
                "first_fill_age_four_hour_bars": (first_fill_ns - plan_ns) / FOUR_HOUR_NS,
                "late_first_fill": first_fill_ns >= plan_ns + EARLY_LIFETIME_NS,
                "closed": bool(position["ts_closed"]),
                "native_realized_pnl_usdt": str(_money(position["realized_pnl"])),
            })
    all_rows = _segment(rows)
    if (
        all_rows["closed"] != summary["closed_trades"]
        or all_rows["closed_winners"] != summary["winning_trades"]
        or abs(
            sum((Decimal(row["native_realized_pnl_usdt"]) for row in rows), Decimal(0))
            - Decimal(str(summary["stats_pnls"]["USDT"]["PnL (total)"]))
        ) > Decimal("0.000001")
    ):
        raise RuntimeError("native position count/PnL reconciliation failed")
    early = _segment([row for row in rows if not row["late_first_fill"]])
    late = _segment([row for row in rows if row["late_first_fill"]])
    uplift = early["closed_win_rate"] - all_rows["closed_win_rate"]
    gate = late["closed"] >= 30 and Decimal(late["closed_native_net_pnl_usdt"]) < 0 and uplift >= 0.05
    late_winners = [row for row in rows if row["late_first_fill"] and row["closed"] and Decimal(row["native_realized_pnl_usdt"]) > 0]
    output = {
        "schema": "r1-native-d67-first-fill-age/v1",
        "preregistration_commit": "cca38e84eee5ed8dac563959bac4aa29ae30565d",
        "input_sha256": EXPECTED,
        "method": "Use each original native Position's first BUY OrderFilled, its original parent GTD deadline minus H19a's frozen 180 four-hour bars, and native realized PnL including fees/funding. No order cancellation or alternative account path is simulated.",
        "cutoff_four_hour_bars": 30,
        "all": all_rows,
        "early": early,
        "late": late,
        "static_early_only_win_rate_uplift_percentage_points": uplift * 100,
        "native_late_winner_count": len(late_winners),
        "native_late_winner_net_pnl_usdt": str(sum((Decimal(row["native_realized_pnl_usdt"]) for row in late_winners), Decimal(0))),
        "admit_five_day_native_child": gate,
        "positions": rows,
        "limitations": [
            "Fixed-set early-only win rate is an algebraic screen, not a native Strategy or account result.",
            "A five-day cancellation would also change later-tier fills, future opportunities, equity sizing, fees and funding.",
            "Open positions are right-censored for win/payoff summaries, but their accrued realized PnL is included in the native total reconciliation.",
            "The year and cutoff family have been viewed; no independent or multiplicity-adjusted edge is claimed.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
