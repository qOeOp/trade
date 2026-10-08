"""
Classify verified H06 line signals against the frozen H03 four-hour box.

This reads native Catalog LAST bars and creates no orders, fills or returns.

"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path

from audit_source_daily_context import _tree_digest
from audit_trendline_signal_parity import INPUT_SHA256
from audit_trendline_signal_parity import _closed_four_hour
from strategy import BOX_BARS
from trendline_strategy import ConfirmedLineBreaks

from vibe_trading.indicators import WilderMovingAverage
from vibe_trading.model import BarType
from vibe_trading.persistence import ParquetDataCatalog


PARITY_SHA256 = "ee1b06ef9d42645aeb107c5e8425273827c97181c8cf942630c31bdf8cde7978"


def _ns(value: str) -> int:
    return int(datetime.fromisoformat(value).timestamp() * 1e9)


def _blank():
    return {
        "signals": 0,
        "outside_in_direction": 0,
        "within_prior_box": 0,
        "outside_opposite_direction": 0,
        "edge_between_close_and_2r_target": 0,
        "edge_not_between_close_and_2r_target": 0,
    }


def _classify(candles, trade_start_ns: int):
    state = ConfirmedLineBreaks()
    atr = WilderMovingAverage(14)
    by_side = {"long": _blank(), "short": _blank()}
    for candle in candles:
        prior = state.candles[-BOX_BARS:]
        previous_close = state.candles[-1].close if state.candles else candle.close
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        prior_atr = atr.value if atr.initialized else None
        signals = state.on_closed(candle, prior_atr)
        atr.update_raw(true_range)
        for signal in signals:
            if signal.ts_event < trade_start_ns:
                continue
            if len(prior) != BOX_BARS:
                raise RuntimeError("H06 signal lacks 60 completed prior four-hour bars")
            high = max(bar.high for bar in prior)
            low = min(bar.low for bar in prior)
            row = by_side["long" if signal.side == 1 else "short"]
            row["signals"] += 1
            edge = high if signal.side == 1 else low
            if (signal.reference_close - edge) * signal.side > 0:
                row["outside_in_direction"] += 1
            elif low <= signal.reference_close <= high:
                row["within_prior_box"] += 1
                if (edge - signal.reference_close) * signal.side > 0 and (
                    signal.target - edge
                ) * signal.side > 0:
                    row["edge_between_close_and_2r_target"] += 1
                else:
                    row["edge_not_between_close_and_2r_target"] += 1
            else:
                row["outside_opposite_direction"] += 1
    return by_side


def _read_candles(
    catalog_root: Path,
    row: dict,
    parity_row: dict,
    start_ns: int,
    end_ns: int,
):
    coin = row["coin"]
    root = catalog_root / coin / "minute"
    if _tree_digest(root) != row["minute_catalog"]["sha256"]:
        raise RuntimeError(f"{coin}: minute Catalog differs from registered identity")
    completion = json.loads((root / "r1-download-complete.json").read_text())
    instrument = completion["instrument"]
    if (
        instrument != parity_row["instrument"]
        or completion["start_ns"] != start_ns
        or completion["end_ns"] != end_ns
        or completion["bar_minutes"] != 5
    ):
        raise RuntimeError(f"{coin}: instrument or interval differs from parity")
    catalog = ParquetDataCatalog(str(root))
    bar_type = BarType.from_str(f"{instrument}-5-MINUTE-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars([instrument], start=start_ns, end=end_ns)
            if bar.bar_type == bar_type
        ),
        key=lambda bar: bar.ts_event,
    )
    candles, partial = _closed_four_hour(bars, start_ns, end_ns)
    if (
        len(bars) != parity_row["five_minute_bars"]
        or len(candles) != parity_row["complete_four_hour_bars"]
        or partial != parity_row["partial_four_hour_bars"]
    ):
        raise RuntimeError(f"{coin}: bar coverage differs from corrected parity")
    return instrument, candles


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input_identity.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("registered input identity bytes changed")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if (
        hashlib.sha256(args.parity.read_bytes()).hexdigest() != PARITY_SHA256
        or not parity["all_exact"]
        or len(parity["coins"]) != len(identity["coins"])
        or len(parity["coins"]) != 37
    ):
        raise RuntimeError("corrected full-coverage H06 parity is required")
    by_coin = {row["coin"]: row for row in parity["coins"]}
    start_ns = _ns(parity["start_utc"])
    end_ns = _ns(parity["end_utc"])
    trade_start_ns = _ns(parity["trade_start_utc"])
    output = {
        "scope": "read-only line versus prior 60-bar box geometry; no new rule, orders, fills, returns or account replay",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_h06_parity_sha256": PARITY_SHA256,
        "box_bars": BOX_BARS,
        "box_source": "H03 frozen 60 completed four-hour LAST bars; descriptive proxy, not Ronnie's drawn outer structure",
        "trade_start_utc": parity["trade_start_utc"],
        "end_utc": parity["end_utc"],
        "per_coin": [],
    }
    total = {"long": _blank(), "short": _blank()}
    for row in identity["coins"]:
        coin = row["coin"]
        instrument, candles = _read_candles(
            args.catalog_root,
            row,
            by_coin[coin],
            start_ns,
            end_ns,
        )
        classified = _classify(candles, trade_start_ns)
        signal_count = sum(part["signals"] for part in classified.values())
        if signal_count != by_coin[coin]["native_signals"]:
            raise RuntimeError(f"{coin}: signal count differs from corrected parity")
        for side, counts in classified.items():
            for name, value in counts.items():
                total[side][name] += value
        output["per_coin"].append(
            {"coin": coin, "instrument": instrument, "by_side": classified},
        )
        print(f"{coin}: {signal_count} H06 signals classified", flush=True)
    output["totals_by_side"] = total
    output["total_signals"] = sum(row["signals"] for row in total.values())
    if output["total_signals"] != sum(row["native_signals"] for row in parity["coins"]):
        raise RuntimeError("total signal count differs from corrected parity")
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
