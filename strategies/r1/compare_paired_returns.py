"""
Compare two native daily return series with paired ISO-week resampling.

This is an exploratory uncertainty read on already viewed history. It does not create
trades or provide an independent holdout or multiplicity correction.

"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
from collections import OrderedDict
from datetime import UTC
from datetime import datetime
from pathlib import Path

from nautilus_trader.analysis import SharpeRatio


DAY_NS = 86_400_000_000_000


def _read(path: Path, trade_start_ns: int) -> dict[int, float]:
    with path.open(newline="") as stream:
        reader = csv.DictReader(stream)
        values = {
            int(row["ts_event_ns"]): float(row["native_return"])
            for row in reader
            if int(row["ts_event_ns"]) >= trade_start_ns
        }
    if not values or any(value <= -1 for value in values.values()):
        raise ValueError(f"invalid native returns: {path}")
    return dict(sorted(values.items()))


def _annualized(values: list[float]) -> float:
    return (math.exp(sum(math.log1p(value) for value in values) * 365 / len(values)) - 1) * 100


def _sharpe(values: list[float]) -> float:
    return SharpeRatio(365).calculate_from_returns(
        {index * DAY_NS: value for index, value in enumerate(values)},
    )


def _interval(values: list[float]) -> list[float]:
    ordered = sorted(values)
    return [ordered[int((len(ordered) - 1) * q)] for q in (0.025, 0.975)]


def compare(candidate: Path, baseline: Path, draws: int, seed: int) -> dict:
    candidate_summary = json.loads((candidate / "summary.json").read_text())
    baseline_summary = json.loads((baseline / "summary.json").read_text())
    if (
        candidate_summary["period_start_utc"] != baseline_summary["period_start_utc"]
        or candidate_summary["period_end_utc"] != baseline_summary["period_end_utc"]
        or candidate_summary["strategy_source_sha256"] != baseline_summary["strategy_source_sha256"]
        or candidate_summary["runner_source_sha256"] != baseline_summary["runner_source_sha256"]
        or [row["counts"] for row in candidate_summary["per_coin"]]
        != [row["counts"] for row in baseline_summary["per_coin"]]
        or [row["quantity"] for row in candidate_summary["per_coin"]]
        != [row["quantity"] for row in baseline_summary["per_coin"]]
    ):
        raise RuntimeError("native paired replay identities differ")
    trade_start_ns = int(
        datetime.fromisoformat(candidate_summary["period_start_utc"]).timestamp() * 1e9,
    )
    candidate_path = candidate / "returns_series.csv"
    baseline_path = baseline / "returns_series.csv"
    candidate_returns = _read(candidate_path, trade_start_ns)
    baseline_returns = _read(baseline_path, trade_start_ns)
    if candidate_returns.keys() != baseline_returns.keys():
        raise RuntimeError("native daily-return timelines differ")
    weeks: OrderedDict[tuple[int, int], list[tuple[float, float]]] = OrderedDict()
    for ts, candidate_return in candidate_returns.items():
        iso = datetime.fromtimestamp(ts / 1e9, tz=UTC).isocalendar()
        weeks.setdefault((iso.year, iso.week), []).append(
            (candidate_return, baseline_returns[ts]),
        )
    blocks = list(weeks.values())
    generator = random.Random(seed)  # noqa: S311 - reproducible research resampling.
    return_deltas = []
    sharpe_deltas = []
    for _ in range(draws):
        sample = [pair for _ in blocks for pair in generator.choice(blocks)]
        candidate_sample = [row[0] for row in sample]
        baseline_sample = [row[1] for row in sample]
        return_deltas.append(_annualized(candidate_sample) - _annualized(baseline_sample))
        sharpe_deltas.append(_sharpe(candidate_sample) - _sharpe(baseline_sample))
    candidate_values = list(candidate_returns.values())
    baseline_values = list(baseline_returns.values())
    return {
        "method": "paired ISO-week bootstrap on already viewed native daily returns; exploratory, unadjusted for prior tests",
        "seed": seed,
        "draws": draws,
        "days": len(candidate_values),
        "week_blocks": len(blocks),
        "candidate_summary_sha256": hashlib.sha256(
            (candidate / "summary.json").read_bytes(),
        ).hexdigest(),
        "baseline_summary_sha256": hashlib.sha256(
            (baseline / "summary.json").read_bytes(),
        ).hexdigest(),
        "candidate_returns_sha256": hashlib.sha256(candidate_path.read_bytes()).hexdigest(),
        "baseline_returns_sha256": hashlib.sha256(baseline_path.read_bytes()).hexdigest(),
        "observed_annualized_daily_return_difference_pp": _annualized(candidate_values)
        - _annualized(baseline_values),
        "bootstrap_95pct_annualized_daily_return_difference_pp": _interval(return_deltas),
        "observed_native_sharpe_365_difference": _sharpe(candidate_values)
        - _sharpe(baseline_values),
        "bootstrap_95pct_native_sharpe_365_difference": _interval(sharpe_deltas),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--draws", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20261008)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.draws < 100:
        raise ValueError("at least 100 paired draws required")
    result = compare(args.candidate, args.baseline, args.draws, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
