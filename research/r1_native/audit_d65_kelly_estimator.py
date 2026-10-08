"""
Read native daily Portfolio returns for preregistered D65 Kelly feasibility.
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
        "returns_series.csv": "02297c7a5183f64d7ad4d65b19e2bc9bc06b871d4dd6da3f4a444e28f7b4729c",
        "capital_usage.json": "91a1cfc6b944685bd4e8d933b995df951460368f86f6d7cb9834869195f6889f",
    },
    "H18a": {
        "summary.json": "6298b850bc3100c7845dc9ee801ae4a899f3a94c64a5004ec2bdf0c61a8b8c80",
        "returns_series.csv": "25a643ac845e9a527528adc9221acd6c0a9919d7587d51957b78e21bdc4f8c1a",
        "capital_usage.json": "d309d3b04fc440c107849c60fcc2f002aa19221d79bb83b9a63e9777d034a352",
    },
}
DAY_NS = 86_400_000_000_000


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load(label: str, run: Path, capital: Path) -> tuple[dict, pd.DataFrame, dict]:
    actual = {
        "summary.json": _sha(run / "summary.json"),
        "returns_series.csv": _sha(run / "returns_series.csv"),
        "capital_usage.json": _sha(capital),
    }
    if actual != EXPECTED[label]:
        raise RuntimeError(f"{label} registered input changed: {actual}")
    summary = json.loads((run / "summary.json").read_text())
    if not summary["integrity_passed"]:
        raise RuntimeError(f"{label} native shared-account replay failed integrity")
    returns = pd.read_csv(run / "returns_series.csv")
    usage = json.loads(capital.read_text())
    return summary, returns, usage


def _read_one(
    label: str,
    summary: dict,
    returns: pd.DataFrame,
    usage: dict,
) -> tuple[dict, np.ndarray]:
    start_ns = pd.Timestamp(summary["period_start_utc"]).value
    end_ns = pd.Timestamp(summary["period_end_utc"]).value
    eligible = returns[returns.ts_event_ns.between(start_ns, end_ns, inclusive="both")].reset_index(
        drop=True,
    )
    times = eligible.ts_event_ns.to_numpy(dtype=np.int64)
    daily = eligible.native_return.to_numpy(dtype=np.float64)
    if (
        len(times) != 356
        or np.any(np.diff(times) != DAY_NS)
        or not np.isfinite(daily).all()
        or np.any(daily <= -1)
    ):
        raise RuntimeError(f"{label} native eligible return grid is incomplete or invalid")
    dates = pd.to_datetime(times, utc=True)
    iso = dates.isocalendar()
    weeks = [
        part.index.to_numpy()
        for _, part in eligible.assign(
            iso_year=iso.year.to_numpy(),
            iso_week=iso.week.to_numpy(),
        ).groupby(["iso_year", "iso_week"], sort=True)
    ]
    week_logs = [np.log1p(daily[index]) for index in weeks]
    if len(week_logs) != 52:
        raise RuntimeError(f"{label} expected 52 ISO-week blocks, got {len(week_logs)}")
    log_daily = np.log1p(daily)
    mean_log = float(log_daily.mean())
    annual_equiv = float(np.expm1(365 * mean_log) * 100)
    positive = 0
    negative = 0
    zero = 0
    first_sign = None
    last_sign = None
    complete_weeks = 0
    observed_days = 0
    for block in week_logs:
        observed_days += len(block)
        if len(block) != 7:
            continue
        complete_weeks += 1
        if complete_weeks < 13:
            continue
        historical_mean = float(log_daily[:observed_days].mean())
        sign = "positive" if historical_mean > 0 else "negative" if historical_mean < 0 else "zero"
        first_sign = sign if first_sign is None else first_sign
        last_sign = sign
        positive += sign == "positive"
        negative += sign == "negative"
        zero += sign == "zero"
    output = {
        "eligible_native_daily_rows": len(daily),
        "eligible_first_sample_utc": dates[0].isoformat(),
        "eligible_last_sample_utc": dates[-1].isoformat(),
        "native_final_account_utc": summary["period_end_utc"],
        "hours_after_last_daily_sample_to_final_account": float(
            (end_ns - times[-1]) / 3_600_000_000_000,
        ),
        "observed_mean_daily_log_return": mean_log,
        "observed_annualized_log_growth_equivalent_pct": annual_equiv,
        "native_summary_annualized_account_return_pct": summary["annualized_return_pct"],
        "iso_week_blocks": len(week_logs),
        "complete_iso_weeks": complete_weeks,
        "expanding_sign_after_13_complete_weeks": {
            "positive_boundaries": positive,
            "negative_boundaries": negative,
            "zero_boundaries": zero,
            "first_sign": first_sign,
            "last_sign": last_sign,
        },
        "native_concurrent_positions": {
            "five_minute_mean_open_coins": usage["positions"][
                "time_weighted_mean_simultaneously_open_coins"
            ],
            "five_minute_peak_open_coins": usage["positions"]["peak_simultaneously_open_coins"],
        },
    }
    return output, week_logs


def _bootstrap(weeks: list[np.ndarray], seed: int) -> dict:
    rng = np.random.default_rng(seed)
    sampled = np.empty(5000, dtype=np.float64)
    for i in range(len(sampled)):
        indices = rng.integers(0, len(weeks), size=len(weeks))
        values = np.concatenate([weeks[j] for j in indices])
        sampled[i] = np.expm1(365 * values.mean()) * 100
    low, high = np.quantile(sampled, [0.025, 0.975])
    return {
        "seed": seed,
        "draws": len(sampled),
        "bootstrap_95pct_annualized_log_growth_equivalent_pct": [float(low), float(high)],
        "interval_includes_zero": bool(low <= 0 <= high),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--h19-run", type=Path, required=True)
    parser.add_argument("--h18-run", type=Path, required=True)
    parser.add_argument("--h19-capital", type=Path, required=True)
    parser.add_argument("--h18-capital", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    results = {}
    shared_times = None
    for label, run, capital in (
        ("H19a", args.h19_run, args.h19_capital),
        ("H18a", args.h18_run, args.h18_capital),
    ):
        summary, returns, usage = _load(label, run, capital)
        start_ns = pd.Timestamp(summary["period_start_utc"]).value
        end_ns = pd.Timestamp(summary["period_end_utc"]).value
        times = returns.loc[
            returns.ts_event_ns.between(start_ns, end_ns, inclusive="both"),
            "ts_event_ns",
        ].to_numpy(dtype=np.int64)
        if shared_times is None:
            shared_times = times
        elif not np.array_equal(times, shared_times):
            raise RuntimeError("H19a and H18a native daily return clocks differ")
        result, weeks = _read_one(label, summary, returns, usage)
        result["weekly_block_bootstrap"] = _bootstrap(weeks, 20261008)
        results[label] = result
    output = {
        "schema": "r1-native-d65-kelly-estimator-feasibility/v1",
        "preregistration_commit": "263b7ea4f",
        "input_sha256": EXPECTED,
        "method": "Original native daily Portfolio returns, fixed eligible period, current-size log growth, 52 ISO-week resampling, expanding past-only sign. No Kelly optimizer, order changes or alternative PnL engine.",
        "runs": results,
        "limitations": [
            "The development year and bootstrap are already exposed and not multiplicity-adjusted or independent qualification.",
            "The native daily return series ends before the partial final account day and is not an exact final-equity reconstruction.",
            "Positive current-size log growth does not identify a Kelly fraction; zero-crossing uncertainty does not rule out a smaller or different strategy.",
            "Many coins are held concurrently, so per-trade binary independent-bet Kelly assumptions do not hold.",
        ],
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
