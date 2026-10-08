"""
Read native entry fills against their five-minute LAST bar opens.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from audit_daily_signal_counts import INTERVAL_NS

from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _event_ns(value: str) -> int:
    timestamp = datetime.fromisoformat(value)
    if timestamp.utcoffset() is None or timestamp.utcoffset().total_seconds() != 0:
        raise RuntimeError(f"fill event is not UTC: {value}")
    return int(timestamp.timestamp()) * 1_000_000_000 + timestamp.microsecond * 1_000


def _filled_entries(path: Path) -> dict[str, dict[str, str]]:
    entries = {}
    with path.open(newline="") as stream:
        for order in csv.DictReader(stream):
            if order["tags"] != "['ENTRY']" or order["status"] != "FILLED":
                continue
            venue_id = order["venue_order_id"]
            if not venue_id or venue_id in entries:
                raise RuntimeError(f"missing or duplicate filled ENTRY venue ID: {venue_id}")
            entries[venue_id] = order
    return entries


def main() -> None:  # noqa: C901 - one native read-only join lifecycle.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--run-summary", type=Path, required=True)
    parser.add_argument("--run-orders", type=Path, required=True)
    parser.add_argument("--run-fills", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    summary = json.loads(args.run_summary.read_text())
    if summary["signal_variant"] != "daily-pivot" or summary["data_interval_minutes"] != 5:
        raise RuntimeError("five-minute native R-1u summary required")
    entries = _filled_entries(args.run_orders)
    instrument_coins = {row["instrument"]: row["coin"] for row in summary["per_coin"]}
    fills_by_instrument: dict[str, list[dict[str, str]]] = defaultdict(list)
    fills_by_venue: dict[str, list[dict[str, str]]] = defaultdict(list)
    with args.run_fills.open(newline="") as stream:
        for fill in csv.DictReader(stream):
            venue_id = fill["venue_order_id"]
            if venue_id not in entries:
                continue
            if fill["instrument_id"] != entries[venue_id]["instrument_id"]:
                raise RuntimeError(f"{venue_id}: fill/order instrument mismatch")
            fills_by_instrument[fill["instrument_id"]].append(fill)
            fills_by_venue[venue_id].append(fill)

    missing_fills = sorted(set(entries) - set(fills_by_venue))
    if missing_fills:
        raise RuntimeError(f"filled entry lacks native fill events: {missing_fills[:5]}")
    counts = Counter(
        {
            "filled_entry_orders": len(entries),
            "native_entry_fill_events": sum(map(len, fills_by_venue.values())),
            "entry_orders_with_multiple_fills": sum(
                len(rows) > 1 for rows in fills_by_venue.values()
            ),
            "matched_fill_bars": 0,
            "missing_fill_bars": 0,
            "favorable_open": 0,
            "equal_open": 0,
            "adverse_open": 0,
            "favorable_open_order_submitted_after_bar_open": 0,
            "favorable_open_order_submitted_by_bar_open": 0,
            "order_submitted_after_bar_open": 0,
            "fill_order_last_time_mismatch": 0,
        },
    )
    favorable_bps = []
    examples = []
    missing_bar_examples = []
    for instrument_id, fills in fills_by_instrument.items():
        if instrument_id not in instrument_coins:
            raise RuntimeError(f"unregistered native fill instrument: {instrument_id}")
        coin = instrument_coins[instrument_id]
        catalog = ParquetDataCatalog(str(args.catalog_root / coin / "minute"))
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        fill_times = [_event_ns(fill["ts_event"]) for fill in fills]
        bars = {
            bar.ts_event: bar
            for bar in catalog.query_bars(
                [instrument_id],
                start=min(fill_times) - INTERVAL_NS,
                end=max(fill_times) + 1,
            )
            if bar.bar_type == bar_type
        }
        for fill, fill_ns in zip(fills, fill_times, strict=True):
            entry = entries[fill["venue_order_id"]]
            bar = bars.get(fill_ns)
            if bar is None:
                counts["missing_fill_bars"] += 1
                if len(missing_bar_examples) < 10:
                    missing_bar_examples.append(
                        {"venue_order_id": fill["venue_order_id"], "fill_ns": fill_ns},
                    )
                continue
            counts["matched_fill_bars"] += 1
            limit = Decimal(entry["price"])
            opened = Decimal(str(bar.open))
            side = 1 if entry["side"] == "BUY" else -1
            improvement = Decimal(side) * (limit - opened)
            submitted_by_open = int(entry["ts_init"]) <= bar.ts_event + 1_000_000 - INTERVAL_NS
            if not submitted_by_open:
                counts["order_submitted_after_bar_open"] += 1
            if improvement > 0:
                counts["favorable_open"] += 1
                key = (
                    "favorable_open_order_submitted_by_bar_open"
                    if submitted_by_open
                    else "favorable_open_order_submitted_after_bar_open"
                )
                counts[key] += 1
                favorable_bps.append(float(improvement / limit * 10_000))
                if len(examples) < 10:
                    examples.append(
                        {
                            "venue_order_id": fill["venue_order_id"],
                            "instrument": instrument_id,
                            "side": entry["side"],
                            "limit": str(limit),
                            "bar_open": str(opened),
                            "bar_ts_event": bar.ts_event,
                            "entry_ts_init": entry["ts_init"],
                            "native_fill_px": fill["last_px"],
                            "submitted_by_bar_open": submitted_by_open,
                        },
                    )
            elif improvement == 0:
                counts["equal_open"] += 1
            else:
                counts["adverse_open"] += 1
            if (
                len(fills_by_venue[fill["venue_order_id"]]) == 1
                and int(entry["ts_last"]) != fill_ns
            ):
                counts["fill_order_last_time_mismatch"] += 1

    report = {
        "native_summary": str(args.run_summary),
        "native_summary_sha256": _sha256(args.run_summary),
        "native_orders": str(args.run_orders),
        "native_orders_sha256": _sha256(args.run_orders),
        "native_fills": str(args.run_fills),
        "native_fills_sha256": _sha256(args.run_fills),
        "diagnostic_source_sha256": _sha256(Path(__file__)),
        "counts": dict(sorted(counts.items())),
        "favorable_open_difference_bps_min": min(favorable_bps) if favorable_bps else None,
        "favorable_open_difference_bps_max": max(favorable_bps) if favorable_bps else None,
        "favorable_open_difference_bps_mean": (
            sum(favorable_bps) / len(favorable_bps) if favorable_bps else None
        ),
        "favorable_open_examples": examples,
        "missing_fill_bar_examples": missing_bar_examples,
        "method": "Read-only native entry-fill-event to five-minute LAST bar join. A favorable open is an observed bar price, not an alternate executable fill. Submission by interval open is necessary but not sufficient for order acceptance. No native fill or PnL is changed.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["counts"], indent=2))


if __name__ == "__main__":
    main()
