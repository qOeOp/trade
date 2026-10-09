"""Time-weight frozen native margin account balance reports without simulating capital."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd


START = pd.Timestamp("2025-10-17T00:00:00Z")
END = pd.Timestamp("2026-10-07T08:30:00Z")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    account_path = args.run / "account.csv"
    rows = pd.read_csv(
        account_path, usecols=["ts_event", "total", "locked", "free", "currency"]
    )
    if set(rows.currency) != {"USDT"}:
        raise ValueError("expected one USDT native margin account")
    rows["ts_event"] = pd.to_datetime(rows.ts_event, utc=True, format="mixed")
    if not rows.ts_event.is_monotonic_increasing:
        raise ValueError("native account rows are out of order")
    rows = rows.groupby("ts_event", sort=False, as_index=False).last()
    before_start = rows.loc[rows.ts_event <= START]
    if before_start.empty:
        raise ValueError("no native account state at the eligibility start")
    active = pd.concat(
        [
            before_start.tail(1),
            rows.loc[(rows.ts_event > START) & (rows.ts_event < END)],
        ]
    )
    if active[["total", "locked", "free"]].isna().any().any():
        raise ValueError("null native account balance")
    residual = (active.total - active.locked - active.free).abs()
    if (residual > 0.000001).any() or (
        active[["total", "locked", "free"]] < -0.000001
    ).any().any():
        raise ValueError("invalid native account balance identity")
    if (active.total <= 0).any():
        raise ValueError("nonpositive native margin account total")
    starts = active.ts_event.clip(lower=START)
    ends = list(starts.iloc[1:]) + [END]
    widths = pd.Series(
        [(b - a).total_seconds() for a, b in zip(starts, ends, strict=True)]
    )
    expected_seconds = (END - START).total_seconds()
    if abs(float(widths.sum()) - expected_seconds) > 0.001 or (widths <= 0).any():
        raise ValueError("account path does not cover the registered trade window")

    def weighted(values: pd.Series) -> float:
        return float((values.reset_index(drop=True) * widths).sum() / expected_seconds)

    result = {
        "method": "last native USDT margin balance per timestamp, forward-held to next account event",
        "run": str(args.run),
        "account_sha256": hashlib.sha256(account_path.read_bytes()).hexdigest(),
        "period_start_utc": START.isoformat(),
        "period_end_utc": END.isoformat(),
        "native_account_rows": len(rows),
        "within_window_distinct_states": len(active),
        "max_balance_identity_residual_usdt": float(residual.max()),
        "time_weighted_locked_usdt": weighted(active.locked),
        "max_locked_usdt": float(active.locked.max()),
        "time_weighted_locked_to_total": weighted(active.locked / active.total),
        "time_weighted_free_to_total": weighted(active.free / active.total),
        "minimum_free_usdt": float(active.free.min()),
        "d69_original_stop_risk_mean_usdt": 5039.87,
        "d69_original_stop_risk_peak_usdt": 9863.15,
        "interpretation": "Native margin-balance reservation, not mark-to-market equity, economic capital or guaranteed stop loss.",
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
