"""
Read native staged-exit reports for terminal protection and orphaned exit orders.

This audits report identities and order states. It does not create fills, account equity
or strategy returns.

"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

import pandas as pd


OPEN_STATUSES = {"ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED", "PENDING_UPDATE"}


def audit(run_dir: Path) -> dict:  # noqa: C901 - one report read checks native identities and states.
    summary = json.loads((run_dir / "summary.json").read_text())
    if summary["exit_variant"] not in ("staged-r1s", "staged-edge-1r"):
        raise ValueError("native staged-exit summary required")
    orders = pd.read_csv(run_dir / "orders.csv", dtype={"client_order_id": str})
    positions = pd.read_csv(run_dir / "positions.csv", dtype={"opening_order_id": str})
    if not orders.client_order_id.is_unique or orders.client_order_id.isna().any():
        raise RuntimeError("native order IDs are absent or duplicated")
    by_id = orders.set_index("client_order_id")
    findings = []
    if not summary.get("integrity_passed", False):
        findings.append("runner reported order integrity failure")
    live_positions = positions[positions.ts_closed.isna()]
    for position in positions.itertuples():
        entry_id = position.opening_order_id
        if entry_id not in by_id.index:
            findings.append(f"missing entry {entry_id}")
            continue
        entry = by_id.loc[entry_id]
        if entry.type != "LIMIT" or entry.contingency_type != "OTO":
            findings.append(f"entry is not native OTO limit: {entry_id}")
        children = orders[orders.parent_order_id == entry_id]
        if len(children) != 1 or children.iloc[0].type != "STOP_MARKET":
            findings.append(f"entry has no unique native stop: {entry_id}")
            continue
        stop = children.iloc[0]
        if pd.isna(position.ts_closed):
            if stop.status != "ACCEPTED":
                findings.append(f"open position has no accepted stop: {entry_id}")
            elif Decimal(str(stop.quantity)) - Decimal(str(stop.filled_qty)) != Decimal(
                str(position.quantity),
            ):
                findings.append(f"open position stop quantity differs: {entry_id}")
        elif stop.status not in {"CANCELED", "FILLED"}:
            findings.append(f"closed position retains stop: {entry_id}")
    open_exits = orders[
        orders.status.isin(OPEN_STATUSES)
        & orders.is_reduce_only
        & orders.type.isin(["LIMIT", "STOP_MARKET"])
    ]
    for order in open_exits.itertuples():
        same_contract = live_positions[
            (live_positions.instrument_id == order.instrument_id)
            & (live_positions.strategy_id == order.strategy_id)
        ]
        if len(same_contract) != 1:
            parent = (
                by_id.loc[order.parent_order_id] if order.parent_order_id in by_id.index else None
            )
            if (
                order.status == "SUBMITTED"
                and parent is not None
                and parent.status in OPEN_STATUSES
                and Decimal(str(parent.filled_qty)) == 0
                and parent.contingency_type == "OTO"
            ):
                continue
            findings.append(f"orphaned live exit: {order.client_order_id}")
    if summary["denied_orders"] or summary["rejected_orders"]:
        findings.append("native orders denied or rejected")
    if any(
        row["staged_execution"]["protection_failures"]
        or row["staged_execution"]["order_failures"]
        or row["staged_execution"]["invalid_actual_target_closes"]
        for row in summary["per_coin"]
    ):
        findings.append("Strategy reported order integrity failure")
    return {
        "run": str(run_dir),
        "positions": len(positions),
        "closed_positions": int(positions.ts_closed.notna().sum()),
        "open_positions": len(live_positions),
        "native_stops": int((orders.type == "STOP_MARKET").sum()),
        "open_reduce_only_exits": len(open_exits),
        "same_bar_first_stop": sum(
            row["staged_execution"]["same_bar_first_stop"] for row in summary["per_coin"]
        ),
        "findings": findings,
        "passed": not findings,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit(args.run)
    payload = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload)
    else:
        print(payload, end="")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
