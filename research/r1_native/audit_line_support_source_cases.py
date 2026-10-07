"""
Read H08 signal geometry near S16 without orders, fills or PnL.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC
from datetime import datetime
from pathlib import Path

from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import BOX_BARS
from strategy import STOP_BUFFER_ATR
from trendline_strategy import ConfirmedLineSupportTouches
from trendline_strategy import LineCandle

from vibe_trading.indicators import WilderMovingAverage


SOURCE_START = "2026-07-23T00:00:00+00:00"
SOURCE_END = "2026-07-25T00:00:00+00:00"
CASE_COINS = ("BTC", "LINK", "ETH")


def _geometry(state, candle, prior_atr, prior, signal):
    i = len(state.candles) - 1
    pivots = state.low_pivots[-2:]
    row = {
        "ts_event_utc": datetime.fromtimestamp(candle.ts_event / 1e9, UTC).isoformat(),
        "ohlc": [candle.open, candle.high, candle.low, candle.close],
        "prior_atr": prior_atr,
        "signal": bool(signal),
        "latest_confirmed_low_pivots": [{"index": j, "low": state.candles[j].low} for j in pivots],
    }
    if len(pivots) < 2 or prior_atr is None or len(prior) != BOX_BARS:
        return row
    j1, j2 = pivots
    p1, p2 = state.candles[j1].low, state.candles[j2].low
    slope = (p2 - p1) / (j2 - j1)
    line = p2 + slope * (i - j2)
    previous = state.candles[-2]
    previous_line = line - slope
    band = STOP_BUFFER_ATR * prior_atr
    stop = min(candle.low, line) - band
    target = max(bar.high for bar in prior)
    row.update(
        {
            "pair_age_bars": i - j2,
            "rising_pair": p2 > p1,
            "pair_dead_after_bar": (j1, j2) in state.dead_pairs,
            "projected_line": line,
            "touch_band": band,
            "previous_low_above_band": previous.low > previous_line + band,
            "previous_close_above_band": previous.close > previous_line + band,
            "current_low_touches_band": candle.low <= line + band,
            "current_close_above_line": candle.close > line,
            "bullish_close": candle.close > candle.open,
            "prior_60_bar_high": target,
            "planned_room_r": (
                (target - candle.close) / (candle.close - stop) if candle.close > stop else None
            ),
        },
    )
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.input_identity.read_bytes()).hexdigest() != INPUT_SHA256:
        raise RuntimeError("registered input identity bytes changed")
    if hashlib.sha256(args.parity.read_bytes()).hexdigest() != PARITY_SHA256:
        raise RuntimeError("corrected full-coverage parity bytes changed")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if not parity["all_exact"] or len(parity["coins"]) != 37:
        raise RuntimeError("corrected full-coverage parity is required")
    source_start_ns = _ns(SOURCE_START)
    source_end_ns = _ns(SOURCE_END)
    rows = {row["coin"]: row for row in identity["coins"]}
    parity_rows = {row["coin"]: row for row in parity["coins"]}
    output = {
        "scope": "read-only H08/S16 source-period geometry; no orders, fills or annual PnL",
        "input_identity_sha256": INPUT_SHA256,
        "corrected_h06_parity_sha256": PARITY_SHA256,
        "source_video_id": "sRwYzAKWVMY",
        "source_period_start_utc": SOURCE_START,
        "source_period_end_utc": SOURCE_END,
        "per_coin": [],
    }
    for coin in CASE_COINS:
        _, candles = _read_candles(
            args.catalog_root,
            rows[coin],
            parity_rows[coin],
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        state = ConfirmedLineSupportTouches()
        atr = WilderMovingAverage(14)
        details = []
        total_signals = 0
        for bar in candles:
            candle = LineCandle(
                bar.ts_event,
                float(bar.open),
                float(bar.high),
                float(bar.low),
                float(bar.close),
            )
            previous_close = state.candles[-1].close if state.candles else candle.close
            true_range = max(
                candle.high - candle.low,
                abs(candle.high - previous_close),
                abs(candle.low - previous_close),
            )
            prior_atr = atr.value if atr.initialized else None
            prior = state.candles[-BOX_BARS:]
            signals = state.on_closed(candle, prior_atr)
            atr.update_raw(true_range)
            total_signals += len(signals)
            if source_start_ns <= candle.ts_event < source_end_ns:
                details.append(_geometry(state, candle, prior_atr, prior, signals))
        if len(details) != 12:
            raise RuntimeError(f"{coin}: expected 12 complete four-hour source-period bars")
        output["per_coin"].append(
            {
                "coin": coin,
                "complete_four_hour_bars": len(candles),
                "all_year_signal_count_without_orders": total_signals,
                "source_period_signals": sum(row["signal"] for row in details),
                "source_period_bars": details,
            },
        )
    args.output.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
