"""
Normalize frozen native position PnL by actual entered stop risk for D66.
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

import numpy as np
import pandas as pd


EXPECTED = {
    "H19a": {
        "summary.json": "7d95658949badb9b76ead4b7fcbebda8b5901c836b332bc9bec57dc0d859f7ec",
        "orders.csv": "9bc7228673948e0299e2f208405d870eb7c8b2215ce44b0b10006102da97feaa",
        "fills.csv": "3b798730719e633f02bcd2fc05977cacbeaecb539d9de584536bc25a71ffa391",
        "positions.csv": "54e211bcf50de11269800a2c7f8e0e2a77e3704a1efd30292e60b7ec96a77a3a",
        "audit.json": "f9297dc270bae5b692d3066adc7cb1eda1b218b69fe030b6f4434f5816bb882a",
    },
    "H18a": {
        "summary.json": "6298b850bc3100c7845dc9ee801ae4a899f3a94c64a5004ec2bdf0c61a8b8c80",
        "orders.csv": "35169fc9298c78e6b15e73b958fa147bfb018485571bc3122ce7cbc36410d763",
        "fills.csv": "b92effc8ccbfced1c81f388f8f4ce4cc28b68517079057cc8c985ca016cba64a",
        "positions.csv": "6555dbd3315ae11108198fc04116fb1da43d58c3207dd45a3f753e4995b5436e",
        "audit.json": "aa84512bc6565542d6aabe9e9501215bceb24a5579fad57a76b1c55fa25cf24b",
    },
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _money(value: str) -> Decimal:
    return Decimal(value.split()[0])


def _read(
    label: str,
    run: Path,
    audit_path: Path,
) -> tuple[dict, list[dict], dict[str, dict], dict[str, dict]]:
    actual = {
        name: _sha(audit_path if name == "audit.json" else run / name) for name in EXPECTED[label]
    }
    if actual != EXPECTED[label]:
        raise RuntimeError(f"{label} frozen native report/audit changed: {actual}")
    summary = json.loads((run / "summary.json").read_text())
    audit = json.loads(audit_path.read_text())
    if not summary["integrity_passed"] or not audit["passed"] or audit["run"] != str(run):
        raise RuntimeError(f"{label} native report audit failed or binds another run")
    with (run / "orders.csv").open(newline="") as stream:
        orders = list(csv.DictReader(stream))
    by_id = {row["client_order_id"]: row for row in orders}
    if len(by_id) != len(orders):
        raise RuntimeError(f"{label} duplicate native client order ID")
    stops = defaultdict(list)
    for row in orders:
        if row["side"] == "SELL" and row["type"] == "STOP_MARKET":
            stops[row["parent_order_id"]].append(row)
    with (run / "positions.csv").open(newline="") as stream:
        positions = list(csv.DictReader(stream))
    return summary, positions, by_id, stops


def _position(row: dict, by_id: dict[str, dict], stops: dict[str, list[dict]]) -> dict:
    events = ast.literal_eval(row["events"])
    if not events or any(event["type"] != "OrderFilled" for event in events):
        raise RuntimeError(f"{row['position_id']}: invalid native fill history")
    buys = [event for event in events if event["order_side"] == "BUY"]
    if not buys or buys[0]["client_order_id"] != row["opening_order_id"]:
        raise RuntimeError(f"{row['position_id']}: opening fill and order differ")
    multiplier = Decimal(row["multiplier"])
    if multiplier <= 0:
        raise RuntimeError(f"{row['position_id']}: invalid native multiplier")
    risk = Decimal(0)
    for event in buys:
        order_id = event["client_order_id"]
        order = by_id.get(order_id)
        linked = stops.get(order_id, [])
        if order is None or order["side"] != "BUY" or order["type"] != "LIMIT" or len(linked) != 1:
            raise RuntimeError(f"{row['position_id']}: missing native entry/stop pair")
        if linked[0]["instrument_id"] != row["instrument_id"]:
            raise RuntimeError(f"{row['position_id']}: protective stop instrument differs")
        fill_px = Decimal(event["last_px"])
        stop_px = Decimal(linked[0]["trigger_price"])
        qty = Decimal(event["last_qty"])
        if qty <= 0 or not 0 < stop_px < fill_px:
            raise RuntimeError(f"{row['position_id']}: invalid actual entry risk")
        risk += qty * (fill_px - stop_px) * multiplier
    if risk <= 0:
        raise RuntimeError(f"{row['position_id']}: zero gross entered stop risk")
    first_order = by_id[row["opening_order_id"]]
    pnl = _money(row["realized_pnl"])
    closed = bool(row["ts_closed"])
    return {
        "position_id": row["position_id"],
        "instrument_id": row["instrument_id"],
        "first_order_init_ns": int(first_order["ts_init"]),
        "native_closed_ns": pd.Timestamp(row["ts_closed"]).value if closed else None,
        "closed": closed,
        "native_realized_pnl_usdt": str(pnl),
        "gross_entered_initial_stop_risk_usdt": str(risk),
        "net_r_multiple": str(pnl / risk) if closed else None,
        "native_buy_fill_events": len(buys),
        "distinct_filled_entry_orders": len({event["client_order_id"] for event in buys}),
    }


def _summarize(label: str, summary: dict, rows: list[dict]) -> dict:
    closed = [row for row in rows if row["closed"]]
    open_rows = [row for row in rows if not row["closed"]]
    wins = [row for row in closed if Decimal(row["native_realized_pnl_usdt"]) > 0]
    if len(closed) != summary["closed_trades"] or len(wins) != summary["winning_trades"]:
        raise RuntimeError(f"{label} closed/win counts differ from native summary")
    all_realized = sum((Decimal(row["native_realized_pnl_usdt"]) for row in rows), Decimal(0))
    expected = Decimal(str(summary["stats_pnls"]["USDT"]["PnL (total)"]))
    if abs(all_realized - expected) > Decimal("0.000001"):
        raise RuntimeError(f"{label} native realized PnL sum differs from summary")
    closed_by_coin = defaultdict(list)
    for row in closed:
        closed_by_coin[row["instrument_id"]].append(row["native_closed_ns"])
    for times in closed_by_coin.values():
        times.sort()
    for row in rows:
        earlier = closed_by_coin[row["instrument_id"]]
        row["prior_closed_same_coin_at_submit"] = int(
            np.searchsorted(earlier, row["first_order_init_ns"], side="left"),
        )
    multiples = np.array([float(row["net_r_multiple"]) for row in closed])
    prior = np.array([row["prior_closed_same_coin_at_submit"] for row in closed])
    if not np.isfinite(multiples).all():
        raise RuntimeError(f"{label} invalid native net-R multiple")
    tier_counts = Counter(row["distinct_filled_entry_orders"] for row in closed)
    return {
        "native_positions": len(rows),
        "native_closed_positions": len(closed),
        "native_open_right_censored_positions": len(open_rows),
        "native_positive_closed_positions": len(wins),
        "sum_all_native_position_realized_pnl_usdt": str(all_realized),
        "closed_net_r_multiple": {
            "mean": float(multiples.mean()),
            "median": float(np.median(multiples)),
            "p10": float(np.quantile(multiples, 0.1)),
            "p90": float(np.quantile(multiples, 0.9)),
            "min": float(multiples.min()),
            "max": float(multiples.max()),
        },
        "distinct_filled_entry_orders_per_closed_position": dict(sorted(tier_counts.items())),
        "prior_closed_same_coin_at_submit": {
            "median": float(np.median(prior)),
            "p90": float(np.quantile(prior, 0.9)),
            "max": int(prior.max()),
            "closed_positions_with_at_least_30_prior": int(np.count_nonzero(prior >= 30)),
            "fraction_with_at_least_30_prior": float(np.mean(prior >= 30)),
        },
        "closed_positions_by_coin": dict(
            sorted(Counter(row["instrument_id"] for row in closed).items()),
        ),
    }


def _one(label: str, run: Path, audit_path: Path) -> dict:
    summary, position_rows, by_id, stops = _read(label, run, audit_path)
    positions = [_position(row, by_id, stops) for row in position_rows]
    return {
        "run": str(run),
        "summary": _summarize(label, summary, positions),
        "positions": positions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h19-run", type=Path, required=True)
    parser.add_argument("--h18-run", type=Path, required=True)
    parser.add_argument("--h19-audit", type=Path, required=True)
    parser.add_argument("--h18-audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = {
        "schema": "r1-native-d66-position-net-r/v1",
        "preregistration_commit": "6a20ca304",
        "input_sha256": EXPECTED,
        "method": "Original native Position OrderFilled BUY events and parent-linked OTO stops define gross entered stop risk; final native realized PnL defines closed net R. Only strictly earlier same-coin closes at first order submission count as causal historical samples. No resizing or counterfactual PnL.",
        "runs": {
            "H19a": _one("H19a", args.h19_run, args.h19_audit),
            "H18a": _one("H18a", args.h18_run, args.h18_audit),
        },
        "limitations": [
            "Gross entered initial stop risk sums all actual entry fills; it is not maximum concurrent risk or the planned pre-entry bundle risk.",
            "Open positions are right-censored and excluded from closed net-R statistics.",
            "Prior same-coin count is sample depth, not independence or an accurate Kelly estimator.",
            "These are exposed-year descriptive outcomes, not new native strategy or account returns.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
