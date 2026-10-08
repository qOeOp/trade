"""
Read native pending entry tiers at frozen D55 line-break events.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

from diagnose_h15a_entry_persistence import AUDIT_SHA256
from diagnose_h15a_entry_persistence import FILLS_SHA256
from diagnose_h15a_entry_persistence import POSITIONS_SHA256
from diagnose_h15a_entry_persistence import _ns
from diagnose_h15a_tier_capacity import _load_frozen_bundles


D55_SHA256 = "451eeb0a92f7b41e657ae461a726d422b41cb70e481ed5d692cbd3957a0ec32b"
TERMINAL = {"FILLED", "CANCELED", "EXPIRED", "REJECTED", "DENIED"}
OPEN = {"ACCEPTED", "SUBMITTED"}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_native(run: Path, summary_path: Path, audit_path: Path, d55_path: Path):
    if _sha(d55_path) != D55_SHA256:
        raise RuntimeError("registered D55 event report changed")
    if (
        _sha(run / "fills.csv") != FILLS_SHA256
        or _sha(run / "positions.csv") != POSITIONS_SHA256
        or _sha(audit_path) != AUDIT_SHA256
    ):
        raise RuntimeError("registered H15a native order/fill/position identity changed")
    hashes, audit, bundles = _load_frozen_bundles(run, summary_path, audit_path)
    d55 = json.loads(d55_path.read_text())
    if len(d55["positions"]) != 686 or d55["summary"]["native_line_break_events"] != 184:
        raise RuntimeError("D55 native position/event count differs")
    with (run / "fills.csv").open(newline="") as stream:
        fills = list(csv.DictReader(stream))
    with (run / "positions.csv").open(newline="") as stream:
        positions = {row["position_id"]: row for row in csv.DictReader(stream)}
    if len(positions) != 686:
        raise RuntimeError("H15a native position count differs")
    return hashes, audit, bundles, d55, fills, positions


def _index_entry_fills(fills: list[dict], bundles: dict) -> dict[str, list[int]]:
    entry_ids = {entry["client_order_id"] for lists in bundles.values() for entry, _, _ in lists}
    times: dict[str, list[int]] = defaultdict(list)
    for fill in fills:
        if fill["client_order_id"] in entry_ids:
            times[fill["client_order_id"]].append(_ns(fill["ts_event"]))
    if len(times) != 1551 or sum(map(len, times.values())) != 1551:
        raise RuntimeError("native entry fill coverage differs from accepted audit")
    return times


def _state_at_event(entry: dict, fill_times: list[int], event_ns: int) -> str:
    if int(entry["ts_init"]) > event_ns:
        raise RuntimeError("original bundle entry submitted after line-break event")
    if any(timestamp <= event_ns for timestamp in fill_times):
        return "already_filled"
    status = entry["status"]
    last_ns = int(entry["ts_last"])
    if status in TERMINAL and last_ns <= event_ns:
        return "already_terminal"
    if status == "FILLED" and min(fill_times) > event_ns:
        return "confirmed_pending_later_fill"
    if status in OPEN:
        return "confirmed_pending_still_open"
    if status in TERMINAL and last_ns > event_ns:
        return "ambiguous_pending_later_terminal"
    raise RuntimeError(f"unknown native entry state {status}")


def _inspect_event(row: dict, position: dict, bundles: dict, fill_times: dict) -> dict:
    event_ns = row["event_four_hour_close_ns"]
    first_order_id = position["opening_order_id"]
    key = (position["strategy_id"], None)
    candidate = [
        (bundle_key, lists)
        for bundle_key, lists in bundles.items()
        if bundle_key[0] == key[0]
        and any(entry["client_order_id"] == first_order_id for entry, _, _ in lists)
    ]
    if len(candidate) != 1:
        raise RuntimeError(f"native opening order has ambiguous bundle: {first_order_id}")
    bundle_key, lists = candidate[0]
    if len(lists) != 3:
        raise RuntimeError("not three native OTO entry lists")
    entry_states = []
    for entry, stop, target in sorted(
        lists,
        key=lambda item: Decimal(item[0]["price"]),
        reverse=True,
    ):
        order_id = entry["client_order_id"]
        times = fill_times.get(order_id, [])
        state = _state_at_event(entry, times, event_ns)
        entry_states.append(
            {
                "client_order_id": order_id,
                "order_list_id": entry["order_list_id"],
                "stop_order_id": stop["client_order_id"],
                "target_order_id": target["client_order_id"],
                "native_final_status": entry["status"],
                "state_at_event": state,
                "later_native_entry_fill_ns": [
                    timestamp for timestamp in times if timestamp > event_ns
                ],
            },
        )
    pending = [
        item for item in entry_states if item["state_at_event"].startswith("confirmed_pending")
    ]
    ambiguous = [
        item
        for item in entry_states
        if item["state_at_event"] == "ambiguous_pending_later_terminal"
    ]
    later_fills = sum(len(item["later_native_entry_fill_ns"]) for item in pending)
    return {
        "position_id": row["position_id"],
        "instrument_id": row["instrument_id"],
        "event_four_hour_close_ns": event_ns,
        "bundle_strategy_id": bundle_key[0],
        "bundle_ts_init": bundle_key[1],
        "confirmed_pending_entry_count": len(pending),
        "ambiguous_pending_entry_count": len(ambiguous),
        "later_fills_of_confirmed_pending_entries": later_fills,
        "native_close_cause": row["native_close_cause"],
        "native_whole_position_realized_pnl_usdt": row["native_final_realized_pnl_usdt"],
        "entry_states": entry_states,
    }


def _summarize(rows: list[dict]) -> dict:
    pending_events = [row for row in rows if row["confirmed_pending_entry_count"] >= 1]
    later_fills = sum(row["later_fills_of_confirmed_pending_entries"] for row in rows)
    if len(rows) != 184:
        raise RuntimeError("D55 line-break event coverage incomplete")
    return {
        "native_line_break_event_positions": len(rows),
        "confirmed_pending_entries_per_event": dict(
            Counter(row["confirmed_pending_entry_count"] for row in rows),
        ),
        "ambiguous_pending_entries_per_event": dict(
            Counter(row["ambiguous_pending_entry_count"] for row in rows),
        ),
        "event_positions_with_confirmed_pending_entry": len(pending_events),
        "later_native_fills_of_confirmed_pending_entries": later_fills,
        "later_filled_event_positions": sum(
            row["later_fills_of_confirmed_pending_entries"] > 0 for row in rows
        ),
        "eventual_close_causes_with_pending": dict(
            Counter(row["native_close_cause"] for row in pending_events),
        ),
        "eventual_whole_position_pnl_with_pending_usdt": str(
            sum(
                (Decimal(row["native_whole_position_realized_pnl_usdt"]) for row in pending_events),
                Decimal(0),
            ),
        ),
        "capacity_screen_pass": len(pending_events) >= 30 and later_fills >= 30,
    }


def diagnose(run: Path, summary_path: Path, audit_path: Path, d55_path: Path) -> dict:
    hashes, audit, bundles, d55, fills, positions = _load_native(
        run,
        summary_path,
        audit_path,
        d55_path,
    )
    fill_times = _index_entry_fills(fills, bundles)
    rows = [
        _inspect_event(row, positions[row["position_id"]], bundles, fill_times)
        for row in d55["positions"]
        if row["state"] == "line_broken_while_open"
    ]
    return {
        "method": "read-only native OTO entry status/fill intervals at D55 events; ambiguous pending-cancel intervals are excluded from confirmed capacity; no per-tier PnL or cancellation counterfactual",
        "registration": "RD_EXPERIMENTS.md D56",
        "frozen_sha256": {
            **hashes,
            "fills.csv": FILLS_SHA256,
            "positions.csv": POSITIONS_SHA256,
            "native_audit": AUDIT_SHA256,
            "d55_events": D55_SHA256,
        },
        "native_bundles": audit["native_bundles"],
        "native_brackets": audit["native_brackets"],
        "native_entry_fills": audit["filled_entries"],
        "summary": _summarize(rows),
        "events": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--d55", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(args.run, args.summary, args.audit, args.d55)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
