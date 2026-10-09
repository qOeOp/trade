"""Read-only causal pooled net-R stability diagnostic on frozen D66 native positions."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np


INPUT_SHA256 = "780da1817851913f64f5682207976f6e37d2821f5b9bb612434ac3ad36bab305"
MONTHS = tuple(f"{year}-{month:02d}" for year, start, end in ((2025, 11, 12), (2026, 1, 10)) for month in range(start, end + 1))
BOOTSTRAP_DRAWS = 5000
BOOTSTRAP_SEED = 20261008


def _utc(ns: int) -> datetime:
    seconds, remainder_ns = divmod(ns, 1_000_000_000)
    return datetime.fromtimestamp(seconds, tz=timezone.utc) + timedelta(microseconds=remainder_ns // 1000)


def _week(ns: int) -> str:
    year, week, _ = _utc(ns).isocalendar()
    return f"{year}-W{week:02d}"


def _parsed(label: str, run: dict) -> list[dict]:
    rows = []
    ids = set()
    for source in run["positions"]:
        identity = source["position_id"]
        if identity in ids:
            raise RuntimeError(f"{label}: duplicate position {identity}")
        ids.add(identity)
        submit_ns = int(source["first_order_init_ns"])
        close_ns = source["native_closed_ns"]
        if source["closed"] != (close_ns is not None):
            raise RuntimeError(f"{label}: inconsistent position close {identity}")
        if close_ns is not None and int(close_ns) <= submit_ns:
            raise RuntimeError(f"{label}: close precedes submitted parent {identity}")
        net_r = float(source["net_r_multiple"]) if source["closed"] else None
        if net_r is not None and not np.isfinite(net_r):
            raise RuntimeError(f"{label}: invalid net R {identity}")
        rows.append({
            "position_id": identity,
            "coin": source["instrument_id"],
            "submit_ns": submit_ns,
            "close_ns": int(close_ns) if close_ns is not None else None,
            "net_r": net_r,
            "prior_same_coin_d66": source["prior_closed_same_coin_at_submit"],
        })
    expected = run["summary"]
    if (len(rows), sum(row["close_ns"] is not None for row in rows)) != (
        expected["native_positions"], expected["native_closed_positions"]
    ):
        raise RuntimeError(f"{label}: D66 native position counts differ")
    return rows


def _prior(rows: list[dict], at_ns: int) -> list[dict]:
    return [row for row in rows if row["close_ns"] is not None and row["close_ns"] < at_ns]


def _decision_rows(rows: list[dict]) -> list[dict]:
    result = []
    for row in sorted(rows, key=lambda item: (item["submit_ns"], item["position_id"])):
        prior = _prior(rows, row["submit_ns"])
        same_coin = sum(item["coin"] == row["coin"] for item in prior)
        if same_coin != row["prior_same_coin_d66"]:
            raise RuntimeError(f"{row['position_id']}: D66 same-coin causal count mismatch")
        result.append({
            "position_id": row["position_id"],
            "coin": row["coin"],
            "submit_utc": _utc(row["submit_ns"]).isoformat(),
            "prior_pooled_closed": len(prior),
            "prior_distinct_coins": len({item["coin"] for item in prior}),
            "prior_distinct_close_weeks": len({_week(item["close_ns"]) for item in prior}),
            "prior_same_coin_closed": same_coin,
            "prior_pooled_mean_net_r": float(np.mean([item["net_r"] for item in prior])) if prior else None,
            "prior_pooled_mean_positive": bool(np.mean([item["net_r"] for item in prior]) > 0) if prior else None,
            "position_closed_at_report_end": row["close_ns"] is not None,
        })
    return result


def _monthly(rows: list[dict], rng: np.random.Generator) -> list[dict]:
    output = []
    for month in MONTHS:
        year, number = map(int, month.split("-"))
        start = datetime(year, number, 1, tzinfo=timezone.utc)
        end = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=timezone.utc)
        start_ns = int(start.timestamp() * 1_000_000_000)
        end_ns = int(end.timestamp() * 1_000_000_000)
        prior = _prior(rows, start_ns)
        cohort = [row for row in rows if start_ns <= row["submit_ns"] < end_ns]
        closed_cohort = [row for row in cohort if row["close_ns"] is not None]
        weeks = defaultdict(list)
        for row in prior:
            weeks[_week(row["close_ns"])].append(row["net_r"])
        prior_mean = float(np.mean([row["net_r"] for row in prior])) if prior else None
        cohort_mean = float(np.mean([row["net_r"] for row in closed_cohort])) if closed_cohort else None
        interval = None
        if len(weeks) >= 4:
            ordered = [weeks[key] for key in sorted(weeks)]
            sums = np.array([sum(values) for values in ordered])
            counts = np.array([len(values) for values in ordered])
            draws = rng.integers(0, len(ordered), size=(BOOTSTRAP_DRAWS, len(ordered)))
            means = sums[draws].sum(axis=1) / counts[draws].sum(axis=1)
            interval = [float(x) for x in np.quantile(means, [0.025, 0.975])]
        output.append({
            "month_utc": month,
            "prior_closed": len(prior),
            "prior_distinct_coins": len({row["coin"] for row in prior}),
            "prior_distinct_close_weeks": len(weeks),
            "prior_mean_net_r": prior_mean,
            "prior_week_block_95pct_interval": interval,
            "prior_lower_bound_positive": interval[0] > 0 if interval else None,
            "submissions": len(cohort),
            "closed_submissions_at_report_end": len(closed_cohort),
            "right_censored_submissions": len(cohort) - len(closed_cohort),
            "closed_cohort_mean_net_r": cohort_mean,
            "prior_and_later_cohort_mean_sign_agree": (
                (prior_mean > 0) == (cohort_mean > 0)
                if prior_mean is not None and cohort_mean is not None and prior_mean != 0 and cohort_mean != 0
                else None
            ),
        })
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("D66 native report SHA-256 does not match frozen input")
    with gzip.open(args.input, "rt") as stream:
        source = json.load(stream)
    if source["schema"] != "r1-native-d66-position-net-r/v1":
        raise RuntimeError("unexpected D66 native report schema")
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    runs = {}
    for label in ("H19a", "H18a"):
        rows = _parsed(label, source["runs"][label])
        decisions = _decision_rows(rows)
        monthly = _monthly(rows, rng)
        runs[label] = {
            "native_positions": len(rows),
            "native_closed_positions": sum(row["close_ns"] is not None for row in rows),
            "decision_rows": decisions,
            "monthly": monthly,
            "months_with_prior_interval": sum(row["prior_week_block_95pct_interval"] is not None for row in monthly),
            "months_with_positive_prior_lower_bound": sum(row["prior_lower_bound_positive"] is True for row in monthly),
        }
    output = {
        "schema": "r1-native-d68-causal-pooled-net-r/v1",
        "preregistration_commit": "0e1b2d299",
        "input_sha256": INPUT_SHA256,
        "bootstrap": {"unit": "UTC ISO close week", "draws": BOOTSTRAP_DRAWS, "seed": BOOTSTRAP_SEED},
        "runs": runs,
        "limitations": [
            "The input is actual native Position net PnL including fees and funding divided by ex-post cumulative filled stop risk; it is not whole-account log growth or planned pre-entry risk.",
            "Open Positions are right-censored; later-realized monthly cohorts cannot enter the earlier estimate.",
            "Week-block intervals are exploratory on an exposed, multiple-tested year and do not establish a positive independent edge.",
            "These rows describe fixed native trades; no Kelly fraction, counterfactual order or equity path is simulated.",
        ],
    }
    data = (json.dumps(output, separators=(",", ":"), allow_nan=False) + "\n").encode()
    with args.output.open("wb") as stream:
        with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as zipped:
            zipped.write(data)


if __name__ == "__main__":
    main()
