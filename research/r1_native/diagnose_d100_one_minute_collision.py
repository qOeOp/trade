"""D100: read actual one-minute LAST bars inside frozen H10 same-bar stops."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

import pandas as pd
from nautilus_trader.model import BarType
from nautilus_trader.persistence import ParquetDataCatalog


ROOT = Path(__file__).resolve().parent
IDENTITY = ROOT / "results/2026-10-07-input-identity.json"
IDENTITY_SHA = "ce9963ca68c66d34af74dbdbfff484f320a622fa73afe64844518aed354ec9fc"
H10 = Path("/tmp/r1-rd-h10-full-37")
READBACK = ROOT / "results/2026-10-08-h10-native-readback.json"
ONE_MINUTE_ROOT = Path("/tmp/r1-37-2026oct7")
MINUTE_NS = 60_000_000_000
FIVE_MINUTE_NS = 5 * MINUTE_NS
MILLISECOND_NS = 1_000_000


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rows(path: Path) -> list[dict]:
    with path.open(newline="") as stream:
        return list(csv.DictReader(stream))


def _one_bar(catalog, instrument_id: str, bar_type, start_ns: int, end_ns: int):
    return sorted(
        (
            bar
            for bar in catalog.query_bars([instrument_id], start=start_ns, end=end_ns)
            if bar.bar_type == bar_type
        ),
        key=lambda bar: bar.ts_event,
    )


def inspect(output: Path, detail: Path) -> None:
    if sha(IDENTITY) != IDENTITY_SHA:
        raise RuntimeError("registered 37-coin input identity changed")
    readback = json.loads(READBACK.read_text())["runs"]["h10"]
    for name in ("summary.json", "orders.csv", "positions.csv"):
        if sha(H10 / name) != readback["files_sha256"][name]:
            raise RuntimeError(f"frozen H10 {name} changed")
    old_summary = json.loads((H10 / "summary.json").read_text())
    if old_summary["closed_trades"] != 934 or old_summary["winning_trades"] != 61:
        raise RuntimeError("frozen H10 economic control changed")
    by_id = {row["client_order_id"]: row for row in rows(H10 / "orders.csv")}
    candidate = []
    for position in rows(H10 / "positions.csv"):
        if position["ts_opened"] != position["ts_closed"]:
            continue
        entry = by_id[position["opening_order_id"]]
        stop = by_id[position["closing_order_id"]]
        if entry["type"] == "LIMIT" and stop["type"] == "STOP_MARKET" and stop["tags"] == "['STOP_LOSS']":
            candidate.append((position, entry, stop))
    if len(candidate) != 199 or len(candidate) != readback["same_event_stop_closes"]:
        raise RuntimeError("frozen H10 same-event stop population changed")
    by_coin = defaultdict(list)
    for position, entry, stop in candidate:
        by_coin[entry["strategy_id"].removeprefix("R1-")].append((position, entry, stop))
    current_rows = {row["coin"]: row for row in json.loads(IDENTITY.read_text())["coins"]}
    detail_rows = []
    receipt_hashes = {}
    reasons = Counter()
    for coin, events in sorted(by_coin.items()):
        if coin not in current_rows:
            raise RuntimeError(f"H10 coin absent from frozen input identity: {coin}")
        one_path = ONE_MINUTE_ROOT / coin / "minute"
        receipt = one_path / "r1-download-complete.json"
        if not receipt.is_file():
            reasons["one_minute_catalog_unavailable"] += len(events)
            continue
        receipt_hashes[coin] = sha(receipt)
        completion = json.loads(receipt.read_text())
        instrument_id = completion["instrument"]
        if instrument_id != events[0][1]["instrument_id"]:
            raise RuntimeError(f"{coin}: one-minute InstrumentId mismatch")
        one_catalog = ParquetDataCatalog(str(one_path))
        five_catalog = ParquetDataCatalog(str(Path(json.loads(IDENTITY.read_text())["minute_catalog_root"]) / coin / "minute"))
        one_type = BarType.from_str(f"{instrument_id}-1-MINUTE-LAST-EXTERNAL")
        five_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        for position, entry, stop in events:
            end_ns = pd.Timestamp(position["ts_opened"]).value
            start_ns = end_ns + MILLISECOND_NS - FIVE_MINUTE_NS
            if start_ns < completion["start_ns"] or end_ns >= completion["end_ns"]:
                reasons["outside_existing_one_minute_window"] += 1
                continue
            minute = _one_bar(one_catalog, instrument_id, one_type, start_ns, end_ns)
            five = _one_bar(five_catalog, instrument_id, five_type, end_ns, end_ns)
            if (
                len(minute) != 5
                or len(five) != 1
                or [bar.ts_event for bar in minute]
                != [start_ns + (i + 1) * MINUTE_NS - MILLISECOND_NS for i in range(5)]
            ):
                raise RuntimeError(f"{coin} {end_ns}: incomplete 1m/5m observed LAST bars")
            old = five[0]
            observed = (
                minute[0].open,
                max(bar.high for bar in minute),
                min(bar.low for bar in minute),
                minute[-1].close,
            )
            expected = (old.open, old.high, old.low, old.close)
            if any(Decimal(str(a)) != Decimal(str(b)) for a, b in zip(observed, expected, strict=True)):
                raise RuntimeError(f"{coin} {end_ns}: real 1m aggregation differs from frozen 5m")
            entry_px = Decimal(entry["price"])
            stop_px = Decimal(stop["trigger_price"])
            if entry["side"] == "BUY":
                entry_minutes = [i for i, bar in enumerate(minute) if Decimal(str(bar.low)) <= entry_px]
                stop_minutes = [i for i, bar in enumerate(minute) if Decimal(str(bar.low)) <= stop_px]
            else:
                entry_minutes = [i for i, bar in enumerate(minute) if Decimal(str(bar.high)) >= entry_px]
                stop_minutes = [i for i, bar in enumerate(minute) if Decimal(str(bar.high)) >= stop_px]
            if not entry_minutes or not stop_minutes:
                raise RuntimeError(f"{coin} {end_ns}: 1m price misses recorded 5m fill/stop")
            first_entry, first_stop = min(entry_minutes), min(stop_minutes)
            classification = (
                "entry_before_stop_in_different_minutes"
                if first_entry < first_stop
                else "entry_and_stop_in_same_first_minute"
                if first_entry == first_stop
                else "stop_price_before_entry_price"
            )
            reasons[classification] += 1
            detail_rows.append({
                "coin": coin,
                "five_minute_end_ns": end_ns,
                "entry_order_id": entry["client_order_id"],
                "stop_order_id": stop["client_order_id"],
                "side": entry["side"],
                "entry_price": str(entry_px),
                "stop_price": str(stop_px),
                "first_entry_minute": first_entry,
                "first_stop_minute": first_stop,
                "classification": classification,
            })
    detail_rows.sort(key=lambda row: (row["five_minute_end_ns"], row["coin"], row["entry_order_id"]))
    result = {
        "schema": "r1-d100-one-minute-h10-collision/v1",
        "method": "read-only actual Nautilus 1m LAST vs frozen H10 native 5m fill/stop; price reach is not a 1m native fill",
        "registered_h10_same_five_minute_stops": len(candidate),
        "existing_one_minute_coverage_ns": [1788220800000000000, 1791361800000000000],
        "overlap_events": len(detail_rows),
        "classification": dict(sorted(reasons.items())),
        "one_minute_receipts_sha256": dict(sorted(receipt_hashes.items())),
        "frozen_h10_reports_sha256": {name: sha(H10 / name) for name in ("summary.json", "orders.csv", "positions.csv")},
        "first_separated_case": next((row for row in detail_rows if row["classification"] == "entry_before_stop_in_different_minutes"), None),
        "first_same_minute_case": next((row for row in detail_rows if row["classification"] == "entry_and_stop_in_same_first_minute"), None),
        "limits": "No 1m Nautilus orders or account PnL; same-minute OHLC remains unordered. Historical one-minute coverage does not include the entire H10 year.",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    detail.write_text(json.dumps(detail_rows, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--detail", type=Path, required=True)
    args = parser.parse_args()
    inspect(args.output, args.detail)


if __name__ == "__main__":
    main()
