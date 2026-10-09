"""
Bind paired native reports to fees, funding and payoff.
"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path


REPORTS = (
    "summary.json",
    "orders.csv",
    "fills.csv",
    "positions.csv",
    "returns_series.csv",
    "account.csv",
)


def _read(run: Path) -> dict:
    summary = json.loads((run / "summary.json").read_text())
    if not summary["integrity_passed"]:
        raise RuntimeError("native runner integrity did not pass")
    fees = Decimal(0)
    with (run / "fills.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            fees += Decimal(row["commission"].split()[0])
    closed = []
    open_positions = 0
    funding = Decimal(0)
    adjustments = Counter()
    with (run / "positions.csv").open(newline="") as stream:
        for row in csv.DictReader(stream):
            if row["ts_closed"]:
                closed.append(Decimal(row["realized_pnl"].split()[0]))
            else:
                open_positions += 1
            for adjustment in ast.literal_eval(row["adjustments"]):
                adjustments[adjustment["adjustment_type"]] += 1
                if adjustment["adjustment_type"] == "FUNDING":
                    funding += Decimal(adjustment["pnl_change"].split()[0])
    winners = [pnl for pnl in closed if pnl > 0]
    losers = [pnl for pnl in closed if pnl <= 0]
    if len(closed) != summary["closed_trades"] or len(winners) != summary["winning_trades"]:
        raise RuntimeError("closed-position win count differs from native summary")
    avg_win = sum(winners) / len(winners) if winners else Decimal(0)
    avg_loss = sum(losers) / len(losers) if losers else Decimal(0)
    return {
        "run": str(run),
        "files_sha256": {
            name: hashlib.sha256((run / name).read_bytes()).hexdigest() for name in REPORTS
        },
        "strategy_source_sha256": summary["strategy_source_sha256"],
        "retracement_strategy_source_sha256": summary["retracement_strategy_source_sha256"],
        "runner_source_sha256": summary["runner_source_sha256"],
        "closed_positions": len(closed),
        "open_positions": open_positions,
        "positive_closed_positions": len(winners),
        "average_positive_closed_pnl_usdt": str(avg_win),
        "average_nonpositive_closed_pnl_usdt": str(avg_loss),
        "average_win_loss_ratio": float(avg_win / -avg_loss) if avg_loss < 0 else None,
        "position_fill_commissions_usdt": str(fees),
        "position_funding_adjustment_events": adjustments["FUNDING"],
        "position_funding_adjustment_net_usdt": str(funding),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    candidate = _read(args.candidate)
    baseline = _read(args.baseline)
    if (
        candidate["strategy_source_sha256"] != baseline["strategy_source_sha256"]
        or candidate["runner_source_sha256"] != baseline["runner_source_sha256"]
    ):
        raise RuntimeError("paired runs do not share native strategy and runner source")
    result = {
        "method": "read-only native summary, fill and position report reconciliation; no alternate fills or PnL engine",
        "candidate": candidate,
        "baseline": baseline,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
