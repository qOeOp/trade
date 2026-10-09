"""Read only planned native OTO geometry for the registered H21a/H19a pair."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd


def read_run(path: Path) -> dict:
    order_path = path / "orders.csv"
    orders = pd.read_csv(
        order_path,
        usecols=[
            "instrument_id",
            "order_list_id",
            "tags",
            "price",
            "trigger_price",
            "quantity",
            "filled_qty",
            "ts_init",
            "ts_last",
        ],
    )
    orders = orders.loc[orders.order_list_id.notna()]
    identity = ["instrument_id", "order_list_id", "tags"]
    if orders.duplicated(identity).any():
        raise ValueError("duplicate native OTO child identity")
    grouped = orders.pivot(
        index=["instrument_id", "order_list_id"],
        columns="tags",
        values=[
            "price",
            "trigger_price",
            "quantity",
            "filled_qty",
            "ts_init",
            "ts_last",
        ],
    )
    entry = grouped[("price", "['ENTRY']")].astype(float)
    stop = grouped[("trigger_price", "['STOP_LOSS']")].astype(float)
    target = grouped[("price", "['TAKE_PROFIT']")].astype(float)
    quantity = grouped[("quantity", "['ENTRY']")].astype(float)
    filled = grouped[("filled_qty", "['ENTRY']")].astype(float) > 0
    if not ((stop < entry) & (entry < target)).all():
        raise ValueError("native OTO price geometry is not long stop/entry/target")
    reward_risk = (target - entry) / (entry - stop)
    original_stop_risk = (entry - stop) * quantity
    age_hours = (
        grouped[("ts_last", "['ENTRY']")].astype(float)
        - grouped[("ts_init", "['ENTRY']")].astype(float)
    ) / 3_600_000_000_000
    return {
        "run": str(path),
        "orders_sha256": hashlib.sha256(order_path.read_bytes()).hexdigest(),
        "native_parent_orders": len(grouped),
        "parents_with_positive_fill": int(filled.sum()),
        "parent_fill_fraction": float(filled.mean()),
        "planned_reward_to_original_stop_risk_median_all": float(reward_risk.median()),
        "planned_reward_to_original_stop_risk_median_filled": float(
            reward_risk[filled].median(),
        ),
        "planned_reward_to_original_stop_risk_mean_filled": float(
            reward_risk[filled].mean(),
        ),
        "original_stop_risk_usdt_median_filled": float(
            original_stop_risk[filled].median()
        ),
        "native_entry_order_submit_to_last_event_hours_median_filled": float(
            age_hours[filled].median(),
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = {
        "method": "read-only native OTO order report; no simulated fills or account ledger",
        "candidate": read_run(args.candidate),
        "baseline": read_run(args.baseline),
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
