"""Read four native shared-account runs as one exposed factorial development test."""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
import math
import random
from collections import OrderedDict
from datetime import UTC
from datetime import datetime
from decimal import Decimal
from pathlib import Path


VARIANTS = {
    "00": "support-three-tier-4h",
    "10": "support-broad-two-tier-4h",
    "01": "support-three-tier-line-cancel-4h",
    "11": "support-broad-two-tier-line-cancel-4h",
}
FILES = (
    "summary.json",
    "orders.csv",
    "fills.csv",
    "positions.csv",
    "account.csv",
    "returns_series.csv",
)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _money(value: str) -> Decimal:
    return Decimal(str(value).split()[0])


def _costs(run: Path) -> dict:
    commissions = Decimal(0)
    with (run / "fills.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            commissions += _money(row["commission"])
    funding = Decimal(0)
    funding_events = 0
    positive = []
    nonpositive = []
    with (run / "positions.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            if row["ts_closed"]:
                pnl = _money(row["realized_pnl"])
                (positive if pnl > 0 else nonpositive).append(pnl)
            for event in ast.literal_eval(row["adjustments"] or "[]"):
                if event.get("adjustment_type") == "FUNDING":
                    funding += _money(event["pnl_change"])
                    funding_events += 1
    average_positive = sum(positive, Decimal(0)) / len(positive) if positive else None
    average_nonpositive = (
        -sum(nonpositive, Decimal(0)) / len(nonpositive) if nonpositive else None
    )
    return {
        "fill_commissions_usdt": str(commissions),
        "position_funding_adjustments_usdt": str(funding),
        "position_funding_events": funding_events,
        "closed_positive_count": len(positive),
        "closed_nonpositive_count": len(nonpositive),
        "average_positive_closed_pnl_usdt": (
            str(average_positive) if average_positive is not None else None
        ),
        "average_nonpositive_closed_magnitude_usdt": (
            str(average_nonpositive) if average_nonpositive is not None else None
        ),
        "realized_payoff_ratio": (
            str(average_positive / average_nonpositive)
            if average_positive is not None and average_nonpositive
            else None
        ),
    }


def _returns(run: Path, trade_start_ns: int) -> dict[int, float]:
    with (run / "returns_series.csv").open(newline="") as stream:
        values = {
            int(row["ts_event_ns"]): float(row["native_return"])
            for row in csv.DictReader(stream)
            if int(row["ts_event_ns"]) >= trade_start_ns
        }
    if not values or any(
        value <= -1 or not math.isfinite(value) for value in values.values()
    ):
        raise ValueError(f"invalid native returns: {run}")
    return dict(sorted(values.items()))


def _annualized(values: list[float]) -> float:
    return (
        math.exp(sum(math.log1p(value) for value in values) * 365 / len(values)) - 1
    ) * 100


def _interval(values: list[float]) -> list[float]:
    ordered = sorted(values)
    return [ordered[int((len(ordered) - 1) * quantile)] for quantile in (0.025, 0.975)]


def compare(
    runs: dict[str, Path], audits: dict[str, Path], draws: int, seed: int
) -> dict:
    summaries = {
        cell: json.loads((run / "summary.json").read_text())
        for cell, run in runs.items()
    }
    first = summaries["00"]
    for cell, summary in summaries.items():
        if summary["signal_variant"] != VARIANTS[cell]:
            raise ValueError(f"{cell}: wrong signal variant")
        if (
            not summary["integrity_passed"]
            or summary["integrity_findings"]
            or summary["denied_orders"]
            or summary["rejected_orders"]
        ):
            raise ValueError(f"{cell}: native runner integrity failed")
        audit = json.loads(audits[cell].read_text())
        if not audit["passed"] or audit["findings"]:
            raise ValueError(f"{cell}: independent native audit failed")
        if any(_sha(runs[cell] / name) != audit["file_sha256"][name] for name in FILES):
            raise ValueError(f"{cell}: native report hash differs from audit")
        comparable = (
            "strategy_source_sha256",
            "retracement_strategy_source_sha256",
            "tiered_strategy_source_sha256",
            "runner_source_sha256",
            "period_start_utc",
            "period_end_utc",
            "starting_balance_usdt",
            "native_risk_submit_rate",
            "sizing",
            "account_model",
            "data_interval_minutes",
        )
        if any(summary[field] != first[field] for field in comparable):
            raise ValueError(f"{cell}: frozen account/window/source fields differ")
        for a, b in zip(summary["per_coin"], first["per_coin"], strict=True):
            if (a["instrument"], a["counts"], a["quantity"]) != (
                b["instrument"],
                b["counts"],
                b["quantity"],
            ):
                raise ValueError(f"{cell}: instrument/input counts differ")
    cancels = {
        cell: sum(
            (row["entry_line_cancel"] or {}).get("entry_cancel_requests", 0)
            for row in summary["per_coin"]
        )
        for cell, summary in summaries.items()
    }
    if cancels["11"] <= 0 or cancels["00"] or cancels["10"]:
        raise ValueError(
            "combined cancellation was absent or leaked into an untreated cell"
        )
    equities = {
        cell: Decimal(summary["final_equity_usdt"])
        for cell, summary in summaries.items()
    }
    economics = {cell: _costs(run) for cell, run in runs.items()}
    for cell, summary in summaries.items():
        if (
            economics[cell]["closed_positive_count"] != summary["winning_trades"]
            or economics[cell]["closed_positive_count"]
            + economics[cell]["closed_nonpositive_count"]
            != summary["closed_trades"]
        ):
            raise ValueError(
                f"{cell}: native closed position economics differ from summary"
            )
    b_effect_base = equities["01"] - equities["00"]
    b_effect_broad = equities["11"] - equities["10"]
    interaction = b_effect_broad - b_effect_base
    trade_start_ns = int(
        datetime.fromisoformat(first["period_start_utc"]).timestamp() * 1e9
    )
    returns = {cell: _returns(run, trade_start_ns) for cell, run in runs.items()}
    keys = list(returns["00"])
    if any(list(values) != keys for values in returns.values()):
        raise ValueError("four native daily-return timelines differ")
    weeks: OrderedDict[tuple[int, int], list[tuple[float, float, float, float]]] = (
        OrderedDict()
    )
    for timestamp in keys:
        iso = datetime.fromtimestamp(timestamp / 1e9, tz=UTC).isocalendar()
        weeks.setdefault((iso.year, iso.week), []).append(
            tuple(returns[cell][timestamp] for cell in ("00", "10", "01", "11")),
        )
    blocks = list(weeks.values())
    generator = random.Random(seed)  # noqa: S311 - reproducible research resampling.
    interaction_samples = []
    b_broad_samples = []
    for _ in range(draws):
        sampled = [row for _ in blocks for row in generator.choice(blocks)]
        annual = [_annualized([row[index] for row in sampled]) for index in range(4)]
        b_broad_samples.append(annual[3] - annual[1])
        interaction_samples.append((annual[3] - annual[1]) - (annual[2] - annual[0]))
    return {
        "scope": "descriptive factorial development read on repeatedly exposed year; not independent qualification",
        "variants": VARIANTS,
        "reports": {
            cell: {
                "run": str(run),
                "audit": str(audits[cell]),
                "files_sha256": {name: _sha(run / name) for name in FILES},
            }
            for cell, run in runs.items()
        },
        "cells": {
            cell: {
                "final_equity_usdt": str(equities[cell]),
                "annualized_return_pct": summary["annualized_return_pct"],
                "closed_trades": summary["closed_trades"],
                "winning_trades": summary["winning_trades"],
                "closed_trade_win_rate": summary["closed_trade_win_rate"],
                "native_sharpe_365": summary["native_sharpe_365"],
                "native_max_drawdown_daily_close": summary[
                    "native_max_drawdown_daily_close"
                ],
                "entry_cancel_requests": cancels[cell],
                **economics[cell],
            }
            for cell, summary in summaries.items()
        },
        "account_differences_usdt": {
            "b_on_h15a": str(b_effect_base),
            "b_on_h19a": str(b_effect_broad),
            "factorial_interaction": str(interaction),
        },
        "paired_week_bootstrap": {
            "seed": seed,
            "draws": draws,
            "days": len(keys),
            "week_blocks": len(blocks),
            "b_on_h19a_annualized_daily_return_difference_pp_interval_95": _interval(
                b_broad_samples
            ),
            "interaction_annualized_daily_return_difference_pp_interval_95": _interval(
                interaction_samples
            ),
            "limitation": "exploratory and not adjusted for previous candidate selection",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for cell in VARIANTS:
        parser.add_argument(f"--run-{cell}", type=Path, required=True)
        parser.add_argument(f"--audit-{cell}", type=Path, required=True)
    parser.add_argument("--draws", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20261008)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.draws < 100:
        raise ValueError("at least 100 paired draws required")
    runs = {cell: getattr(args, f"run_{cell}") for cell in VARIANTS}
    audits = {cell: getattr(args, f"audit_{cell}") for cell in VARIANTS}
    result = compare(runs, audits, args.draws, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    print(
        json.dumps(
            {"cells": len(result["cells"]), "result": str(args.output)}, indent=2
        )
    )


if __name__ == "__main__":
    main()
