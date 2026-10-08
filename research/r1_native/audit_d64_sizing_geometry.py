"""
Read native entry/stop orders for preregistered D64 sizing geometry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd


EXPECTED = {
    "H19a": {
        "summary.json": "7d95658949badb9b76ead4b7fcbebda8b5901c836b332bc9bec57dc0d859f7ec",
        "orders.csv": "9bc7228673948e0299e2f208405d870eb7c8b2215ce44b0b10006102da97feaa",
    },
    "H18a": {
        "summary.json": "6298b850bc3100c7845dc9ee801ae4a899f3a94c64a5004ec2bdf0c61a8b8c80",
        "orders.csv": "35169fc9298c78e6b15e73b958fa147bfb018485571bc3122ce7cbc36410d763",
    },
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_one(label: str, run: Path) -> dict:
    actual = {name: _sha(run / name) for name in EXPECTED[label]}
    if actual != EXPECTED[label]:
        raise RuntimeError(f"{label} frozen report identity changed: {actual}")
    summary = json.loads((run / "summary.json").read_text())
    if (
        not summary["integrity_passed"]
        or summary["sizing"]["risk_budget_bps"] != 25
        or summary["sizing"]["coin_notional_cap_pct"] != 5
    ):
        raise RuntimeError(f"{label} is not the accepted 25-bp/5% native run")
    orders = pd.read_csv(
        run / "orders.csv",
        usecols=[
            "client_order_id",
            "instrument_id",
            "side",
            "type",
            "price",
            "trigger_price",
            "parent_order_id",
            "order_list_id",
        ],
    )
    entries = orders[
        (orders.side == "BUY") & (orders.type == "LIMIT") & orders.parent_order_id.isna()
    ].copy()
    stops = orders[(orders.side == "SELL") & (orders.type == "STOP_MARKET")].copy()
    if len(entries) != len(stops) or entries.client_order_id.duplicated().any():
        raise RuntimeError(f"{label} missing or duplicate native entry/stop")
    paired = entries.merge(
        stops,
        left_on="client_order_id",
        right_on="parent_order_id",
        how="outer",
        validate="one_to_one",
        suffixes=("_entry", "_stop"),
        indicator=True,
    )
    if (
        not paired._merge.eq("both").all()
        or not paired.instrument_id_entry.eq(paired.instrument_id_stop).all()
        or not paired.order_list_id_entry.eq(paired.order_list_id_stop).all()
    ):
        raise RuntimeError(f"{label} native stop protection does not pair exactly")
    entry_px = paired.price_entry.to_numpy(dtype=float)
    stop_px = paired.trigger_price_stop.to_numpy(dtype=float)
    if not np.isfinite(entry_px).all() or not np.isfinite(stop_px).all():
        raise RuntimeError(f"{label} has nonfinite entry or stop")
    if np.any(stop_px <= 0) or np.any(entry_px <= stop_px):
        raise RuntimeError(f"{label} has nonpositive initial stop risk")
    distance = (entry_px - stop_px) / entry_px
    threshold = 0.0025 / 0.05
    risk_bound = distance > threshold + 1e-12
    notional_bound = distance < threshold - 1e-12
    tie = ~(risk_bound | notional_bound)
    coins = paired.instrument_id_entry.str.split("USDT-PERP", n=1).str[0]
    per_coin = {}
    for coin in sorted(coins.unique()):
        mask = coins.eq(coin).to_numpy()
        per_coin[coin] = {
            "native_entry_tiers": int(mask.sum()),
            "raw_risk_bound_tiers": int(np.count_nonzero(risk_bound & mask)),
            "raw_notional_bound_tiers": int(np.count_nonzero(notional_bound & mask)),
        }
    return {
        "run": str(run),
        "native_entry_tiers": len(paired),
        "native_parent_linked_stops": len(stops),
        "raw_risk_bound_tiers": int(np.count_nonzero(risk_bound)),
        "raw_notional_bound_tiers": int(np.count_nonzero(notional_bound)),
        "raw_ties": int(np.count_nonzero(tie)),
        "raw_risk_bound_fraction": float(np.mean(risk_bound)),
        "initial_stop_distance_pct": {
            "min": float(np.min(distance) * 100),
            "median": float(np.median(distance) * 100),
            "p90": float(np.quantile(distance, 0.9) * 100),
            "max": float(np.max(distance) * 100),
        },
        "per_coin": per_coin,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h19-run", type=Path, required=True)
    parser.add_argument("--h18-run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    runs = {
        "H19a": _read_one("H19a", args.h19_run),
        "H18a": _read_one("H18a", args.h18_run),
    }
    result = {
        "schema": "r1-native-d64-sizing-geometry/v1",
        "preregistration_commit": "9cc1efa4f",
        "input_sha256": EXPECTED,
        "method": "Unique native BUY LIMIT parent and original parent-linked SELL STOP_MARKET; raw sizing branch from initial stop distance versus the registered 5% crossover. No PnL or resimulation.",
        "risk_vs_notional_crossover_stop_distance_pct": 5.0,
        "runs": runs,
        "limitations": [
            "The raw cap branch can be obscured by native quantity rounding at the final order quantity.",
            "A different risk or notional cap may change fills, portfolio path and correlation; no counterfactual return follows from this geometry read.",
            "Neither native outcome distribution nor source evidence validates a Kelly fraction.",
        ],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
