"""
Read frozen H18a line events against the original second confirmed low.
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
from statistics import median


D55_SHA256 = "451eeb0a92f7b41e657ae461a726d422b41cb70e481ed5d692cbd3957a0ec32b"
D56_SHA256 = "63a25d403614f45c1d5a8a0097731b35ef5ae3111dabd1a7c4ad08c703433095"
ATTRIBUTION_SHA256 = "74cdbd7c9e2fa714be921ba847fe2f7c7dd857111d6c2ca4690d9bc63c35c3d0"
ORIGINAL_POSITIONS_SHA256 = "5659583d7d21a7079cd28c7d9efafddf479cfa8f40809c4d4d35525fabd8735e"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _original_positions(path: Path) -> dict:
    positions = {}
    with path.open(newline="") as stream:
        for row in csv.DictReader(stream):
            events = ast.literal_eval(row["events"])
            if not events or events[0]["client_order_id"] != row["opening_order_id"]:
                raise RuntimeError(f"original native opening event differs: {row['position_id']}")
            if row["position_id"] in positions:
                raise RuntimeError("duplicate original native position")
            positions[row["position_id"]] = {
                "strategy_id": row["strategy_id"],
                "opening_order_id": row["opening_order_id"],
                "first_fill_ns": int(events[0]["ts_event"]),
            }
    if len(positions) != 686:
        raise RuntimeError("original native position count differs")
    return positions


def diagnose(d55_path: Path, d56_path: Path, attribution_path: Path, positions_path: Path) -> dict:
    expected = (
        (d55_path, D55_SHA256),
        (d56_path, D56_SHA256),
        (attribution_path, ATTRIBUTION_SHA256),
        (positions_path, ORIGINAL_POSITIONS_SHA256),
    )
    if any(_sha(path) != sha for path, sha in expected):
        raise RuntimeError("frozen native diagnostic input differs from D57 registration")
    d55 = json.loads(d55_path.read_text())
    d56 = json.loads(d56_path.read_text())
    attribution = json.loads(attribution_path.read_text())
    original = _original_positions(positions_path)
    if (
        len(d55["positions"]) != 686
        or len(d56["events"]) != 184
        or attribution["positions"] != 686
        or attribution["counts"]["avoided_entry_fill_events"] != 95
        or attribution["counts"]["avoided_entry_fills_closed"] != 72
    ):
        raise RuntimeError("original native diagnostic capacity differs")
    d56_events = {row["position_id"]: row for row in d56["events"]}
    if len(d56_events) != 184:
        raise RuntimeError("duplicate D56 event")
    changed = {
        (row["strategy_id"], row["opening_order_id"]): row
        for row in attribution["paired_positions_with_delta_or_avoided_fill"]
    }
    if len(changed) != len(attribution["paired_positions_with_delta_or_avoided_fill"]):
        raise RuntimeError("duplicate paired native attribution")
    groups = {name: [] for name in ("strong_low_breach", "line_only")}
    for row in d55["positions"]:
        if row["state"] != "line_broken_while_open":
            continue
        position_id = row["position_id"]
        pending = d56_events.get(position_id)
        identity = original.get(position_id)
        if (
            pending is None
            or identity is None
            or int(pending["event_four_hour_close_ns"]) != int(row["event_four_hour_close_ns"])
            or identity["first_fill_ns"] != int(row["first_fill_ns"])
        ):
            raise RuntimeError(f"D55/D56/native event identity differs: {position_id}")
        paired = changed.get((identity["strategy_id"], identity["opening_order_id"]))
        avoided = paired["avoided_entry_fills"] if paired else 0
        delta = Decimal(paired["realized_pnl_delta_usdt"]) if paired else Decimal(0)
        state = (
            "strong_low_breach"
            if Decimal(row["event_last_close"]) < Decimal(row["line"]["low2"])
            else "line_only"
        )
        groups[state].append(
            {
                "position_id": position_id,
                "event_four_hour_close_ns": row["event_four_hour_close_ns"],
                "event_age_complete_bars": row["event_age_complete_bars"],
                "event_close_first_r": row["event_close_first_r"],
                "event_last_close": row["event_last_close"],
                "frozen_second_low": row["line"]["low2"],
                "confirmed_pending_entry_count": pending["confirmed_pending_entry_count"],
                "ambiguous_pending_entry_count": pending["ambiguous_pending_entry_count"],
                "later_fills_of_confirmed_pending_entries": pending[
                    "later_fills_of_confirmed_pending_entries"
                ],
                "avoided_entry_fills_h18a": avoided,
                "native_close_cause": row["native_close_cause"],
                "paired_position_realized_pnl_delta_usdt": str(delta),
            },
        )
    if sum(map(len, groups.values())) != 184:
        raise RuntimeError("D55 event coverage differs")
    summaries = {}
    for name, rows in groups.items():
        confirmed = [row for row in rows if row["confirmed_pending_entry_count"] > 0]
        summaries[name] = {
            "events": len(rows),
            "confirmed_pending_events": len(confirmed),
            "ambiguous_pending_events": sum(
                row["ambiguous_pending_entry_count"] > 0 for row in rows
            ),
            "later_fills_of_confirmed_pending_entries": sum(
                row["later_fills_of_confirmed_pending_entries"] for row in rows
            ),
            "avoided_entry_fills_h18a": sum(row["avoided_entry_fills_h18a"] for row in rows),
            "avoided_fills_with_confirmed_pending": sum(
                row["avoided_entry_fills_h18a"] for row in confirmed
            ),
            "paired_realized_pnl_delta_all_usdt": str(
                sum(
                    (Decimal(row["paired_position_realized_pnl_delta_usdt"]) for row in rows),
                    Decimal(0),
                ),
            ),
            "paired_realized_pnl_delta_confirmed_pending_usdt": str(
                sum(
                    (Decimal(row["paired_position_realized_pnl_delta_usdt"]) for row in confirmed),
                    Decimal(0),
                ),
            ),
            "native_close_causes": dict(
                sorted(Counter(row["native_close_cause"] for row in rows).items()),
            ),
            "median_event_age_complete_bars": median(row["event_age_complete_bars"] for row in rows)
            if rows
            else None,
            "median_event_close_first_r": median(
                Decimal(row["event_close_first_r"]) for row in rows
            )
            if rows
            else None,
        }
    strong = summaries["strong_low_breach"]
    capacity_pass = (
        strong["confirmed_pending_events"] >= 30
        and strong["avoided_fills_with_confirmed_pending"] >= 30
        and Decimal(strong["paired_realized_pnl_delta_confirmed_pending_usdt"]) >= 5000
    )
    return {
        "method": "read-only, preregistered original second-pivot-low event state joined to native pending entries and paired whole-position realized PnL; no child replay",
        "registration": "RD_EXPERIMENTS.md D57 commits dd36032be and 557f7df98",
        "input_sha256": {path.name: sha for path, sha in expected},
        "events": 184,
        "summary": summaries,
        "capacity_screen_pass": capacity_pass,
        "positions": groups,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--d55", type=Path, required=True)
    parser.add_argument("--d56", type=Path, required=True)
    parser.add_argument("--attribution", type=Path, required=True)
    parser.add_argument("--original-positions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(args.d55, args.d56, args.attribution, args.original_positions)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, default=str) + "\n")


if __name__ == "__main__":
    main()
