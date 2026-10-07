"""
Audit H13c and paired R-1u native bracket and open-protection facts.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

import pandas as pd


OPEN = {"ACCEPTED", "PARTIALLY_FILLED", "SUBMITTED", "PENDING_UPDATE"}


def audit(run: Path) -> dict:  # noqa: C901 - one native report relationship audit.
    summary = json.loads((run / "summary.json").read_text())
    if summary["signal_variant"] not in ("support-confirmed-4h", "daily-pivot"):
        raise ValueError("H13c or paired R-1u native replay required")
    orders = pd.read_csv(run / "orders.csv", dtype={"client_order_id": str})
    positions = pd.read_csv(run / "positions.csv", dtype={"opening_order_id": str})
    findings = []
    if not summary["integrity_passed"] or summary["denied_orders"] or summary["rejected_orders"]:
        findings.append("runner reported native order failure")
    if not orders.client_order_id.is_unique or orders.client_order_id.isna().any():
        findings.append("missing or duplicate native order identity")
    if summary["signal_variant"] == "support-confirmed-4h" and any(
        row["support_pullback"]["cancel_race_fills"] < 0 for row in summary["per_coin"]
    ):
        findings.append("invalid cancel/fill race count")
    brackets = orders[orders.tags.isin(["['ENTRY']", "['STOP_LOSS']", "['TAKE_PROFIT']"])]
    for list_id, group in brackets.groupby("order_list_id"):
        roles = set(group.tags)
        if roles != {"['ENTRY']", "['STOP_LOSS']", "['TAKE_PROFIT']"} or len(group) != 3:
            findings.append(f"incomplete or duplicate native bracket {list_id}")
            continue
        entry = group[group.tags == "['ENTRY']"].iloc[0]
        stop = group[group.tags == "['STOP_LOSS']"].iloc[0]
        target = group[group.tags == "['TAKE_PROFIT']"].iloc[0]
        if entry.type != "LIMIT" or entry.contingency_type != "OTO":
            findings.append(f"invalid native entry {entry.client_order_id}")
        if stop.type != "STOP_MARKET" or target.type != "LIMIT":
            findings.append(f"invalid native exits {list_id}")
        stop_price = Decimal(str(stop.trigger_price))
        entry_price = Decimal(str(entry.price))
        target_price = Decimal(str(target.price))
        valid_price_order = (
            stop_price < entry_price < target_price
            if entry.side == "BUY"
            else target_price < entry_price < stop_price
        )
        if not valid_price_order:
            findings.append(f"invalid native bracket price order {list_id}")
        if stop.parent_order_id != entry.client_order_id:
            findings.append(f"stop parent differs from entry {list_id}")
        if entry.status in {"CANCELED", "EXPIRED"} and (
            stop.status != "CANCELED" or target.status != "CANCELED"
        ):
            findings.append(f"unfilled canceled entry retains exits {list_id}")
    by_id = orders.set_index("client_order_id")
    live = positions[positions.ts_closed.isna()]
    for position in positions.itertuples():
        if position.opening_order_id not in by_id.index:
            findings.append(f"position lacks native entry {position.position_id}")
            continue
        entry = by_id.loc[position.opening_order_id]
        if entry.status != "FILLED":
            findings.append(f"position entry is not filled {position.position_id}")
        children = orders[orders.order_list_id == entry.order_list_id]
        stops = children[children.tags == "['STOP_LOSS']"]
        targets = children[children.tags == "['TAKE_PROFIT']"]
        if len(stops) != 1 or len(targets) != 1:
            findings.append(f"position has incomplete native protection {position.position_id}")
            continue
        stop, target = stops.iloc[0], targets.iloc[0]
        if pd.isna(position.ts_closed):
            if stop.status != "ACCEPTED" or target.status != "ACCEPTED":
                findings.append(f"open position lacks accepted stop/target {position.position_id}")
            if Decimal(str(stop.quantity)) - Decimal(str(stop.filled_qty)) != Decimal(
                str(position.quantity),
            ):
                findings.append(f"open stop size differs from position {position.position_id}")
        elif stop.status in OPEN or target.status in OPEN:
            findings.append(f"closed position retains live exit {position.position_id}")
    for order in orders[orders.is_reduce_only & orders.status.isin(OPEN)].itertuples():
        if order.tags not in ("['STOP_LOSS']", "['TAKE_PROFIT']"):
            findings.append(f"unrecognized open reduce-only exit {order.client_order_id}")
            continue
        entry = orders[orders.order_list_id == order.order_list_id]
        entry = entry[entry.tags == "['ENTRY']"]
        if len(entry) != 1:
            findings.append(f"orphaned open exit {order.client_order_id}")
            continue
        if entry.iloc[0].status != "FILLED":
            if entry.iloc[0].status not in OPEN:
                findings.append(f"open exit linked to terminal entry {order.client_order_id}")
            continue
        if not any(
            position.opening_order_id == entry.iloc[0].client_order_id
            for position in live.itertuples()
        ):
            findings.append(f"open exit without open position {order.client_order_id}")
    return {
        "run": str(run),
        "native_brackets": int(brackets.order_list_id.nunique()),
        "filled_entries": int((brackets[brackets.tags == "['ENTRY']"].status == "FILLED").sum()),
        "closed_positions": int(positions.ts_closed.notna().sum()),
        "open_positions": len(live),
        "supersessions": (
            sum(row["support_pullback"]["supersessions"] for row in summary["per_coin"])
            if summary["signal_variant"] == "support-confirmed-4h"
            else None
        ),
        "findings": findings,
        "passed": not findings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.run)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
