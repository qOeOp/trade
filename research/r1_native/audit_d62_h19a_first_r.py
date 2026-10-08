"""
Count H19a closed-position first-R LAST reaches before native final exits.

This reads frozen native reports and Catalog bars. Bar reaches are only opportunities,
never simulated fills or a replacement Portfolio result.

"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
from collections import Counter
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import numpy as np
from audit_source_daily_context import _tree_digest

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


SOURCE_HASHES = {
    "summary.json": "7d95658949badb9b76ead4b7fcbebda8b5901c836b332bc9bec57dc0d859f7ec",
    "orders.csv": "9bc7228673948e0299e2f208405d870eb7c8b2215ce44b0b10006102da97feaa",
    "fills.csv": "3b798730719e633f02bcd2fc05977cacbeaecb539d9de584536bc25a71ffa391",
    "positions.csv": "54e211bcf50de11269800a2c7f8e0e2a77e3704a1efd30292e60b7ec96a77a3a",
}
INPUT_SHA256 = "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc"
AUDIT_SHA256 = "f9297dc270bae5b692d3066adc7cb1eda1b218b69fe030b6f4434f5816bb882a"
INTERVAL_NS = 5 * 60_000_000_000


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _amount(value: str) -> Decimal:
    return Decimal(value.split()[0])


def _last_grid(catalog_root: Path, input_row: dict) -> tuple[str, np.ndarray, np.ndarray]:
    coin = input_row["coin"]
    root = catalog_root / coin / "minute"
    if _tree_digest(root) != input_row["minute_catalog"]["sha256"]:
        raise RuntimeError(f"{coin}: native LAST Catalog identity differs")
    completion = json.loads((root / "r1-download-complete.json").read_text())
    instrument_id = completion["instrument"]
    if completion["bar_minutes"] != 5 or completion["counts"]["last"] != 105_222:
        raise RuntimeError(f"{coin}: native LAST completion differs")
    catalog = ParquetDataCatalog(str(root))
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (bar for bar in catalog.query_bars([instrument_id]) if bar.bar_type == bar_type),
        key=lambda bar: bar.ts_event,
    )
    times = np.fromiter((bar.ts_event for bar in bars), dtype=np.int64)
    highs = np.fromiter((float(bar.high) for bar in bars), dtype=np.float64)
    if len(times) != 105_222 or np.any(np.diff(times) != INTERVAL_NS):
        raise RuntimeError(f"{coin}: five-minute LAST grid differs")
    return instrument_id, times, highs


def _classify(
    row: dict,
    orders: dict[str, dict],
    stops: dict[str, list[dict]],
    targets: dict[str, list[dict]],
    times: np.ndarray,
    highs: np.ndarray,
) -> dict:
    events = ast.literal_eval(row["events"])
    if not events or events[0]["type"] != "OrderFilled" or events[0]["order_side"] != "BUY":
        raise RuntimeError("native position lacks first BUY fill")
    first = events[0]
    if first["client_order_id"] != row["opening_order_id"]:
        raise RuntimeError("first native fill and opening order differ")
    first_order = first["client_order_id"]
    if len(stops[first_order]) != 1 or len(targets[first_order]) != 1:
        raise RuntimeError("first native OTO lacks unique stop and target")
    entry = Decimal(first["last_px"])
    stop = Decimal(stops[first_order][0]["trigger_price"])
    target = Decimal(targets[first_order][0]["price"])
    risk = entry - stop
    if not 0 < stop < entry < target or risk <= 0:
        raise RuntimeError("first native fill has invalid stop/target geometry")
    first_ns = int(first["ts_event"])
    is_closed = bool(row["ts_closed"])
    final_ns = int(events[-1]["ts_event"])
    if is_closed and events[-1]["order_side"] != "SELL":
        raise RuntimeError("closed native position lacks final SELL fill")
    if final_ns < first_ns:
        raise RuntimeError("native fill event order reversed")
    strict_start = np.searchsorted(times, first_ns, side="right")
    strict_end = np.searchsorted(times, final_ns, side="left") if is_closed else len(times)
    permissive_start = np.searchsorted(times, first_ns, side="left")
    permissive_end = np.searchsorted(times, final_ns, side="right") if is_closed else len(times)
    threshold = entry + risk
    strict_high = (
        Decimal(str(highs[strict_start:strict_end].max())) if strict_end > strict_start else None
    )
    permissive_high = (
        Decimal(str(highs[permissive_start:permissive_end].max()))
        if permissive_end > permissive_start
        else None
    )
    close_order = orders.get(row["closing_order_id"]) if is_closed else None
    if is_closed and close_order is None:
        raise RuntimeError("native closing order missing")
    later_entries = {
        event["client_order_id"]
        for event in events[1:]
        if event["order_side"] == "BUY" and event["client_order_id"] != first_order
    }
    pnl = _amount(row["realized_pnl"])
    return {
        "instrument_id": row["instrument_id"],
        "position_id": row["position_id"],
        "first_fill_ns": first_ns,
        "last_fill_ns": final_ns,
        "closed": is_closed,
        "native_win": pnl > 0 if is_closed else None,
        "native_final_realized_pnl_usdt": str(pnl),
        "native_closing_order_type": close_order["type"] if close_order else None,
        "first_entry_px": str(entry),
        "first_stop_px": str(stop),
        "first_target_b_px": str(target),
        "first_target_b_r": str((target - entry) / risk),
        "native_fill_events": len(events),
        "later_distinct_entry_orders": len(later_entries),
        "strict_interior_five_minute_bars": int(max(0, strict_end - strict_start)),
        "strict_first_r_reached": strict_high is not None and strict_high >= threshold,
        "permissive_first_r_reached": permissive_high is not None and permissive_high >= threshold,
        "same_event_first_and_final_fill": first_ns == final_ns if is_closed else False,
    }


def _summary(rows: list[dict]) -> dict:
    closed = [row for row in rows if row["closed"]]
    open_rows = [row for row in rows if not row["closed"]]
    wins = [row for row in closed if row["native_win"]]
    nonwins = [row for row in closed if not row["native_win"]]
    if len(closed) != 496 or len(wins) != 212 or len(open_rows) != 11:
        raise RuntimeError("H19a native position and win counts differ from frozen summary")
    strict = [row for row in nonwins if row["strict_first_r_reached"]]
    permissive = [row for row in nonwins if row["permissive_first_r_reached"]]
    if len(strict) > len(permissive):
        raise RuntimeError("strict first-R reach exceeds permissive reach")
    closing = Counter(row["native_closing_order_type"] for row in closed)
    rescued_by_close = Counter(row["native_closing_order_type"] for row in strict)
    rescued_by_later_tiers = Counter(row["later_distinct_entry_orders"] for row in strict)
    winners_by_close = Counter(row["native_closing_order_type"] for row in wins)
    return {
        "native_closed_positions": len(closed),
        "native_positive_closed_positions": len(wins),
        "native_nonpositive_closed_positions": len(nonwins),
        "native_open_right_censored_positions": len(open_rows),
        "native_closing_order_types": dict(sorted(closing.items())),
        "native_winner_closing_order_types": dict(sorted(winners_by_close.items())),
        "nonwinners_with_strict_interior_first_r_reach": len(strict),
        "nonwinners_with_permissive_boundary_first_r_reach": len(permissive),
        "strict_reaches_by_native_close_type": dict(sorted(rescued_by_close.items())),
        "strict_reaches_by_later_distinct_entry_orders": dict(
            sorted(rescued_by_later_tiers.items()),
        ),
        "closed_positions_without_strict_interior_bar": sum(
            row["strict_interior_five_minute_bars"] == 0 for row in closed
        ),
        "same_event_first_and_final_closes": sum(
            row["same_event_first_and_final_fill"] for row in closed
        ),
        "fixed_set_win_rate_if_every_strict_reach_nonwinner_were_rescued": (len(wins) + len(strict))
        / len(closed),
        "fixed_set_win_rate_ceiling_if_every_permissive_reach_nonwinner_were_rescued": (
            len(wins) + len(permissive)
        )
        / len(closed),
        "strict_reach_meets_86_needed_for_approx_60pct": len(strict) >= 86,
        "permissive_reach_meets_86_needed_for_approx_60pct": len(permissive) >= 86,
        "first_target_b_r_min": str(min(Decimal(row["first_target_b_r"]) for row in closed)),
        "first_target_b_r_max": str(max(Decimal(row["first_target_b_r"]) for row in closed)),
    }


def main() -> None:  # noqa: C901 - binds frozen reports and all native Catalogs.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--accepted-audit", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for name, expected in SOURCE_HASHES.items():
        if _sha(args.run / name) != expected:
            raise RuntimeError(f"frozen H19a native report changed: {name}")
    if _sha(args.input_identity) != INPUT_SHA256 or _sha(args.accepted_audit) != AUDIT_SHA256:
        raise RuntimeError("frozen input identity or accepted native audit changed")
    audit = json.loads(args.accepted_audit.read_text())
    if not audit["passed"] or audit["run"] != str(args.run):
        raise RuntimeError("accepted H19a native audit does not bind this run")
    identity = json.loads(args.input_identity.read_text())
    if Path(identity["minute_catalog_root"]) != args.catalog_root or len(identity["coins"]) != 37:
        raise RuntimeError("D62 requires registered 37 native Catalogs")
    with (args.run / "orders.csv").open(newline="") as stream:
        order_rows = list(csv.DictReader(stream))
    orders = {row["client_order_id"]: row for row in order_rows}
    if len(orders) != len(order_rows):
        raise RuntimeError("duplicate native client order ID")
    stops: dict[str, list[dict]] = defaultdict(list)
    targets: dict[str, list[dict]] = defaultdict(list)
    for row in order_rows:
        if row["tags"] == "['STOP_LOSS']":
            stops[row["parent_order_id"]].append(row)
        elif row["tags"] == "['TAKE_PROFIT']":
            targets[row["parent_order_id"]].append(row)
    with (args.run / "positions.csv").open(newline="") as stream:
        position_rows = list(csv.DictReader(stream))
    by_instrument: dict[str, list[dict]] = defaultdict(list)
    for row in position_rows:
        by_instrument[row["instrument_id"]].append(row)
    rows = []
    for input_row in identity["coins"]:
        instrument_id, times, highs = _last_grid(args.catalog_root, input_row)
        instrument_rows = by_instrument.pop(instrument_id, [])
        rows.extend(_classify(row, orders, stops, targets, times, highs) for row in instrument_rows)
        print(f"{input_row['coin']}: checked {len(instrument_rows)} positions", flush=True)
    if by_instrument:
        raise RuntimeError("native positions contain unregistered instrument IDs")
    output = {
        "schema": "r1-native-d62-first-risk-unit-opportunity/v1",
        "preregistration_commit": "d26884a67",
        "input_sha256": {
            **SOURCE_HASHES,
            "registered_identity": INPUT_SHA256,
            "accepted_native_audit": AUDIT_SHA256,
        },
        "method": "Actual native first BUY fill and linked original OTO stop define R. Strict LAST high excludes entry/final-exit bars; permissive includes both and can include unavailable price path. Native PnL decides winner status. No bar reach is a fill or alternate account return.",
        "summary": _summary(rows),
        "positions": rows,
    }
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
