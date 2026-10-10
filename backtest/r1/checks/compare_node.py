"""Compare a native BacktestNode replay with the existing BacktestEngine control."""

import argparse
import ast
import csv
import hashlib
import json
from decimal import Decimal
from importlib.metadata import version
from pathlib import Path


VOLATILE = {
    "orders": {"init_id", "venue_order_id", "last_trade_id"},
    "fills": {"venue_order_id", "trade_id", "event_id"},
    "positions": {
        "position_id",
        "events",
        "adjustments",
        "venue_order_ids",
        "trade_ids",
    },
    "account": set(),
    "returns_series": set(),
}


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def canonical(name: str, data: list[dict[str, str]]) -> list[dict[str, str]]:
    if name == "orders":
        return sorted(data, key=lambda row: row["client_order_id"])
    if name == "fills":
        return sorted(
            data,
            key=lambda row: (
                row["client_order_id"],
                row["ts_event"],
                row["last_qty"],
                row["last_px"],
            ),
        )
    if name == "positions":
        return sorted(
            data,
            key=lambda row: (
                row["opening_order_id"],
                row["closing_order_id"],
                row["ts_opened"],
            ),
        )
    return data


def funding(data: list[dict[str, str]]) -> list[tuple[str, int, str]]:
    result = []
    for row in data:
        for event in ast.literal_eval(row["adjustments"]) if row["adjustments"] else []:
            if event.get("adjustment_type") == "FUNDING":
                result.append(
                    (
                        event["instrument_id"],
                        event["ts_event"],
                        event["pnl_change"],
                    )
                )
    return sorted(result)


def compare(reference: Path, candidate: Path) -> dict:
    baseline = json.loads((reference / "summary.json").read_text())
    node = json.loads((candidate / "summary.json").read_text())
    results = {
        "reference": str(reference),
        "candidate": str(candidate),
        "nautilus_version": version("nautilus_trader"),
        "reference_summary_sha256": hashlib.sha256(
            (reference / "summary.json").read_bytes(),
        ).hexdigest(),
        "candidate_summary_sha256": hashlib.sha256(
            (candidate / "summary.json").read_bytes(),
        ).hexdigest(),
    }
    for name in VOLATILE:
        left = canonical(name, rows(reference / f"{name}.csv"))
        right = canonical(name, rows(candidate / f"{name}.csv"))
        columns = set(left[0]) if left else set()
        column_match = columns == (set(right[0]) if right else set())
        compared = sorted(columns - VOLATILE[name])
        mismatches = []
        for index, (a, b) in enumerate(zip(left, right, strict=False)):
            different = [column for column in compared if a[column] != b[column]]
            if different:
                mismatches.append({"row": index, "fields": different})
        results[name] = {
            "counts": [len(left), len(right)],
            "column_match": column_match,
            "compared_columns": len(compared),
            "mismatch_count": len(mismatches),
            "first_mismatches": mismatches[:3],
        }
        if name == "positions":
            a_funding, b_funding = funding(left), funding(right)
            results["funding_adjustments"] = {
                "counts": [len(a_funding), len(b_funding)],
                "exact_match": a_funding == b_funding,
                "total_usdt": str(
                    sum(
                        (Decimal(event[2].split()[0]) for event in a_funding),
                        Decimal(0),
                    )
                ),
            }
    metrics = (
        "final_equity_usdt",
        "annualized_return_pct",
        "closed_trades",
        "winning_trades",
        "native_sharpe_365",
        "native_max_drawdown_daily_close",
    )
    results["metrics"] = {
        metric: [baseline[metric], node[metric]] for metric in metrics
    }
    results["passed"] = (
        all(
            report["counts"][0] == report["counts"][1]
            and report["column_match"]
            and report["mismatch_count"] == 0
            for name, report in results.items()
            if name in VOLATILE
        )
        and results["funding_adjustments"]["exact_match"]
        and all(_metric_equal(baseline[metric], node[metric]) for metric in metrics)
    )
    return results


def _metric_equal(left, right) -> bool:
    """Equal within one hundred-millionth; an undefined reading (no trades) matches only itself."""
    if left is None or right is None:
        return left is right
    return abs(Decimal(str(left)) - Decimal(str(right))) <= Decimal("0.00000001")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    result = compare(args.reference, args.candidate)
    output = json.dumps(result, indent=2) + "\n"
    if args.receipt:
        args.receipt.write_text(output)
    print(output)
    raise SystemExit(0 if result["passed"] else 1)
