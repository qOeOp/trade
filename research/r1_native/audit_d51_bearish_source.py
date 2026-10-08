"""
Read D51 bearish-retracement source geometry from frozen native Catalogs.
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
from audit_source_daily_context import _days
from audit_source_daily_context import _tree_digest
from audit_source_daily_context import _trend_state
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import BOX_BARS
from strategy import STOP_BUFFER_ATR

from vibe_trading.indicators import WilderMovingAverage


REGISTRATION_COMMIT = "77ca71162"
S13_SHA256 = "bca695a166bad228fda307cd36ac58814fa721e33920cbd503a0113bc4d762f8"
CUTOFF = "2026-07-27T00:00:00+00:00"
PIVOT_ORDER = 8
ANCHOR_LOOKBACK = 180
MIN_ANCHOR_SPAN = 6
MAX_B_AGE = 30
COINS = ("BTC", "ETH", "LINK")
BTC_BANDS = {
    "high_anchor": (67_000.0, 67_500.0),
    "low_anchor": (63_500.0, 64_100.0),
    "0.5": (65_300.0, 65_600.0),
    "0.618": (65_700.0, 66_100.0),
}


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _utc(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, UTC).isoformat()


def _band_delta(price: float, band: tuple[float, float]) -> float:
    low, high = band
    return min(price - low, 0) if price < low else max(price - high, 0)


def _pivot_high(candles: list, index: int) -> bool:
    window = candles[index - PIVOT_ORDER : index + PIVOT_ORDER + 1]
    return float(candles[index].high) == max(float(bar.high) for bar in window)


def _prior_atr(candles: list, decision_i: int) -> float:
    atr = WilderMovingAverage(14)
    previous_close = float(candles[0].close)
    for candle in candles[:decision_i]:
        high, low = float(candle.high), float(candle.low)
        atr.update_raw(
            max(high - low, abs(high - previous_close), abs(low - previous_close)),
        )
        previous_close = float(candle.close)
    if not atr.initialized:
        raise RuntimeError("source cutoff lacks completed prior ATR")
    return atr.value


def _four_hour_row(candles: list, coin: str) -> dict:
    by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
    decision_i = by_time.get(_ns(CUTOFF))
    if decision_i is None or decision_i < ANCHOR_LOOKBACK:
        raise RuntimeError(f"{coin}: no complete four-hour source cutoff")
    known = candles[: decision_i + 1]
    b = min(
        range(decision_i - BOX_BARS + 1, decision_i + 1),
        key=lambda j: (float(known[j].low), j),
    )
    eligible = [
        j
        for j in range(max(PIVOT_ORDER, decision_i - ANCHOR_LOOKBACK + 1), b)
        if b - j >= MIN_ANCHOR_SPAN and j + PIVOT_ORDER <= decision_i and _pivot_high(known, j)
    ]
    row = {
        "coin": coin,
        "decision_utc": CUTOFF,
        "last_complete_four_hour_utc": _utc(known[-1].ts_event),
        "last_complete_close": float(known[-1].close),
        "selected_low_utc": _utc(known[b].ts_event),
        "selected_low": float(known[b].low),
        "confirmed_high_candidates_before_low": len(eligible),
        "impulse": None,
        "reason": None,
    }
    if not eligible:
        row["reason"] = "no eligible confirmed high before selected 60-bar low"
        return row
    a = eligible[-1]
    high, low = float(known[a].high), float(known[b].low)
    if high <= low:
        row["reason"] = "nonpositive bearish impulse"
        return row
    span = high - low
    level_50 = low + 0.5 * span
    level_618 = low + 0.618 * span
    atr = _prior_atr(known, decision_i)
    stop = high + STOP_BUFFER_ATR * atr
    room_r = (level_618 - low) / (stop - level_618)
    first_touch = next(
        (j for j in range(b + 1, decision_i + 1) if float(known[j].high) >= level_618),
        None,
    )
    levels = {
        "high_anchor": high,
        "low_anchor": low,
        "0.5": level_50,
        "0.618": level_618,
    }
    row["impulse"] = {
        "high_anchor_utc": _utc(known[a].ts_event),
        "high_confirmed_utc": _utc(known[a + PIVOT_ORDER].ts_event),
        "low_anchor_utc": _utc(known[b].ts_event),
        "low_age_four_hour_bars": decision_i - b,
        "anchor_span_four_hour_bars": b - a,
        "levels": levels,
        "source_band_differences": (
            {key: _band_delta(value, BTC_BANDS[key]) for key, value in levels.items()}
            if coin == "BTC"
            else None
        ),
        "first_618_touch_after_low_utc": _utc(known[first_touch].ts_event)
        if first_touch is not None
        else None,
        "prior_four_hour_atr": atr,
        "researcher_stop_above_high": stop,
        "researcher_first_target_low": low,
        "room_r_before_instrument_rounding": room_r,
        "candidate_price_order_and_one_r": 0 < low < level_618 < stop and room_r >= 1,
        "within_existing_30_bar_horizon": decision_i - b <= MAX_B_AGE,
    }
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s13", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _sha(args.input_identity) != INPUT_SHA256:
        raise RuntimeError("registered input identity changed")
    if _sha(args.parity) != PARITY_SHA256:
        raise RuntimeError("frozen corrected four-hour parity changed")
    if _sha(args.s13) != S13_SHA256:
        raise RuntimeError("frozen S13 source evidence changed")
    identity = json.loads(args.input_identity.read_text())
    parity = json.loads(args.parity.read_text())
    if (
        Path(identity["minute_catalog_root"]) != args.catalog_root
        or not parity["all_exact"]
        or len(parity["coins"]) != 37
    ):
        raise RuntimeError("native input identity or full parity differs")
    rows = []
    for coin in COINS:
        input_row = next(row for row in identity["coins"] if row["coin"] == coin)
        parity_row = next(row for row in parity["coins"] if row["coin"] == coin)
        instrument, candles = _read_candles(
            args.catalog_root,
            input_row,
            parity_row,
            _ns(parity["start_utc"]),
            _ns(parity["end_utc"]),
        )
        daily_root = Path(identity["daily_catalog_root"])
        if _tree_digest(daily_root / coin / "daily") != input_row["daily_catalog"]["sha256"]:
            raise RuntimeError(f"{coin}: registered daily Catalog changed")
        days, daily_instrument = _days(daily_root, coin, _ns(CUTOFF))
        if instrument != daily_instrument:
            raise RuntimeError(f"{coin}: daily/four-hour Instrument differs")
        row = _four_hour_row(candles, coin)
        row.update(
            {
                "instrument": instrument,
                "minute_catalog_sha256": input_row["minute_catalog"]["sha256"],
                "daily_catalog_sha256": input_row["daily_catalog"]["sha256"],
                "daily_context": _trend_state(days, 3),
            },
        )
        rows.append(row)
    by_coin = {row["coin"]: row for row in rows}
    btc = by_coin["BTC"]
    impulse = btc["impulse"]
    gates = {
        "btc_selected_geometry_in_all_source_bands": impulse is not None
        and all(delta == 0 for delta in impulse["source_band_differences"].values()),
        "btc_untouched_618_within_30_bars": impulse is not None
        and impulse["first_618_touch_after_low_utc"] is None
        and impulse["within_existing_30_bar_horizon"],
        "btc_bearish_daily_trend": btc["daily_context"]["trend"] == -1,
        "eth_not_bearish_daily_trend": by_coin["ETH"]["daily_context"]["trend"] != -1,
        "link_not_bearish_daily_trend": by_coin["LINK"]["daily_context"]["trend"] != -1,
        "btc_ordered_one_r_room": impulse is not None
        and impulse["candidate_price_order_and_one_r"],
    }
    result = {
        "scope": "D51 source-date geometry and direction only; no order, fill, future candle or economic read",
        "registration_commit": REGISTRATION_COMMIT,
        "reader_sha256": _sha(Path(__file__)),
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "s13_source_sha256": S13_SHA256,
        "source_cutoff_utc": CUTOFF,
        "btc_visual_bands": BTC_BANDS,
        "gates": gates,
        "all_source_gates_pass": all(gates.values()),
        "rows": rows,
        "economic_data_read": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
