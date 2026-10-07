"""
Attribute native R-1 positions and measure conservative pre-exit excursion.

This reads native reports and the already prepared LAST catalog. It never creates
orders, fills, returns, or an alternative backtest result.

"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _last_bars(catalog_root: Path, instrument_id: str):
    coin = instrument_id.split("USDT", 1)[0].removeprefix("1000")
    catalog = ParquetDataCatalog(str(catalog_root / coin / "minute"))
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (bar for bar in catalog.query_bars([instrument_id]) if bar.bar_type == bar_type),
        key=lambda bar: bar.ts_event,
    )
    timestamps = np.fromiter((bar.ts_event for bar in bars), dtype=np.int64)
    highs = np.fromiter((float(bar.high) for bar in bars), dtype=np.float64)
    lows = np.fromiter((float(bar.low) for bar in bars), dtype=np.float64)
    if not len(timestamps) or len(timestamps) != len(np.unique(timestamps)):
        raise RuntimeError(f"{instrument_id}: missing or duplicate LAST bars")
    return timestamps, highs, lows


def _mfe_r(prices, entry_price: float, risk: float, side: int) -> float:
    if not len(prices):
        return 0.0
    best = prices.max() if side == 1 else prices.min()
    return max(0.0, side * (best - entry_price) / risk)


def _position_excursion(row, by_venue_order, by_order_list, bars):
    events = ast.literal_eval(row["events"])
    if len(events) != 2 or events[0]["order_type"] != "LIMIT":
        raise RuntimeError(f"{row['instrument_id']}: unexpected native position fill path")
    entry, exit_event = events
    entry_order = by_venue_order[entry["venue_order_id"]]
    stop_order = by_order_list[entry_order["order_list_id"]]
    entry_price = float(entry["last_px"])
    stop_price = float(stop_order["trigger_price"])
    side = 1 if entry["order_side"] == "BUY" else -1
    risk = side * (entry_price - stop_price)
    if risk <= 0:
        raise RuntimeError(f"{row['instrument_id']}: invalid native stop distance")
    timestamps, highs, lows = bars
    favorable = highs if side == 1 else lows
    strict_start = np.searchsorted(timestamps, entry["ts_event"], side="right")
    strict_end = np.searchsorted(timestamps, exit_event["ts_event"], side="left")
    permissive_start = np.searchsorted(timestamps, entry["ts_event"], side="left")
    permissive_end = np.searchsorted(timestamps, exit_event["ts_event"], side="right")
    strict = _mfe_r(favorable[strict_start:strict_end], entry_price, risk, side)
    permissive = _mfe_r(favorable[permissive_start:permissive_end], entry_price, risk, side)
    return (
        exit_event["order_type"],
        float(str(row["realized_pnl"]).split()[0]) > 0,
        strict,
        permissive,
        bool(strict_end <= strict_start),
        entry["ts_event"] == exit_event["ts_event"],
    )


def main() -> None:  # noqa: C901 - one read-only native position/path audit.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-complex-as-unresolved", action="store_true")
    args = parser.parse_args()

    positions_path = args.run / "positions.csv"
    orders_path = args.run / "orders.csv"
    positions = pd.read_csv(positions_path)
    positions = positions[positions["ts_closed"].notna()].copy()
    orders = pd.read_csv(orders_path)
    entries = orders[(orders["tags"] == "['ENTRY']") & (orders["status"] == "FILLED")]
    by_venue_order = entries.set_index("venue_order_id").to_dict("index")
    stops = orders[orders["type"] == "STOP_MARKET"]
    by_order_list = stops.set_index("order_list_id").to_dict("index")
    if len(by_venue_order) != len(entries) or len(by_order_list) != len(stops):
        raise RuntimeError("native entry/stop identity is not unique")

    groups: dict[str, list[dict]] = {}
    for row in positions.to_dict("records"):
        groups.setdefault(row["instrument_id"], []).append(row)

    closing = Counter()
    stop_mfe_strict = Counter()
    stop_mfe_permissive = Counter()
    wins = 0
    valid = 0
    no_interior_bars = 0
    complex_paths = 0
    complex_nonwins = 0
    complex_examples = []
    same_event_stops = 0
    same_event_stop_permissive_1r = 0
    other_boundary_only_stop_permissive_1r = 0
    for instrument_id, rows in sorted(groups.items()):
        bars = _last_bars(args.catalog_root, instrument_id)
        for row in rows:
            events = ast.literal_eval(row["events"])
            if len(events) != 2 or events[0]["order_type"] != "LIMIT":
                if not args.allow_complex_as_unresolved:
                    raise RuntimeError(f"{instrument_id}: unexpected native position fill path")
                is_win = float(str(row["realized_pnl"]).split()[0]) > 0
                closing[events[-1]["order_type"]] += 1
                wins += is_win
                valid += 1
                complex_paths += 1
                complex_nonwins += not is_win
                if len(complex_examples) < 10:
                    complex_examples.append(
                        {
                            "instrument_id": instrument_id,
                            "fill_events": len(events),
                            "closing_fill_type": events[-1]["order_type"],
                            "native_win": is_win,
                        },
                    )
                continue
            (
                closing_type,
                is_win,
                strict_mfe_r,
                permissive_mfe_r,
                no_interior,
                same_event,
            ) = _position_excursion(row, by_venue_order, by_order_list, bars)
            closing[closing_type] += 1
            wins += is_win
            valid += 1
            no_interior_bars += no_interior
            if closing_type == "STOP_MARKET":
                same_event_stops += same_event
                same_event_stop_permissive_1r += int(
                    same_event and permissive_mfe_r >= 1.0,
                )
                other_boundary_only_stop_permissive_1r += int(
                    not same_event and strict_mfe_r < 1.0 <= permissive_mfe_r,
                )
                for level in (0.5, 1.0, 1.5, 2.0):
                    if strict_mfe_r >= level:
                        stop_mfe_strict[str(level)] += 1
                    if permissive_mfe_r >= level:
                        stop_mfe_permissive[str(level)] += 1

    if valid != len(positions):
        raise RuntimeError("native closed-position count mismatch")
    strict_same_set_rate = (wins + stop_mfe_strict["1.0"]) / valid
    permissive_same_set_ceiling = (wins + stop_mfe_permissive["1.0"] + complex_nonwins) / valid
    report = {
        "native_run": str(args.run),
        "native_positions_sha256": _sha256(positions_path),
        "native_orders_sha256": _sha256(orders_path),
        "catalog_root": str(args.catalog_root),
        "closed_positions": valid,
        "positive_native_positions": wins,
        "closing_fill_types": dict(sorted(closing.items())),
        "stop_positions_with_strict_interior_mfe_at_least_r": dict(
            sorted(stop_mfe_strict.items()),
        ),
        "stop_positions_with_permissive_boundary_mfe_at_least_r": dict(
            sorted(stop_mfe_permissive.items()),
        ),
        "positions_without_strict_interior_bars": no_interior_bars,
        "complex_native_fill_paths_without_excursion": complex_paths,
        "complex_native_nonwins_assumed_rescued_for_ceiling": complex_nonwins,
        "complex_native_fill_examples": complex_examples,
        "simple_same_event_stops": same_event_stops,
        "simple_same_event_stops_with_permissive_1r": same_event_stop_permissive_1r,
        "other_stops_with_boundary_only_permissive_1r": other_boundary_only_stop_permissive_1r,
        "same_trade_set_win_rate_if_strict_1r_prior_stops_become_wins": strict_same_set_rate,
        "same_trade_set_win_rate_ceiling_if_all_permissive_1r_stops_become_wins": permissive_same_set_ceiling,
        "method": "MFE uses native LAST five-minute bars. Strict measure excludes entry/exit bars; permissive measure includes both and may count pre-entry or post-exit price. Both use native entry fill to linked stop trigger as risk. When explicitly allowed, complex native fill paths are not scanned; every nonwinning complex position is generously assumed rescued in the permissive ceiling. These are opportunity bounds, not a resimulation or net PnL result; changed slot timing can change the trade set.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
