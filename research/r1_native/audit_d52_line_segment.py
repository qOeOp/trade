"""
Read frozen H06 down-break events and local source geometry for D52.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC
from datetime import datetime
from pathlib import Path

from audit_d51_bearish_source import BTC_BANDS
from audit_d51_bearish_source import CUTOFF
from audit_d51_bearish_source import MAX_B_AGE
from audit_d51_bearish_source import _band_delta
from audit_d51_bearish_source import _prior_atr
from audit_line_box_context import PARITY_SHA256
from audit_line_box_context import _ns
from audit_line_box_context import _read_candles
from audit_trendline_signal_parity import INPUT_SHA256
from strategy import STOP_BUFFER_ATR
from trendline_strategy import PIVOT_ORDER
from trendline_strategy import ConfirmedLineBreaks

from vibe_trading.indicators import WilderMovingAverage


REGISTRATION_COMMIT = "03e93cb4f"
S13_SHA256 = "bca695a166bad228fda307cd36ac58814fa721e33920cbd503a0113bc4d762f8"
D51_SHA256 = "d95b653537e194a4b999c8ee64d0242487f2b912e2096977e5acbae1b1e4c81e"
EVENT_MIN_UTC = "2026-07-23T00:00:00+00:00"
EVENT_MAX_UTC = "2026-07-25T00:00:00+00:00"
EVENT_LOOKBACK_BARS = 30
COINS = ("BTC", "ETH", "LINK")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _utc(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, UTC).isoformat()


class ObservedLineBreaks(ConfirmedLineBreaks):
    """
    Observe H06 first-cross decisions without changing its signal rule.
    """

    def __init__(self) -> None:
        super().__init__()
        self.down_crosses: list[dict] = []

    def _check_side(self, i, candle, prior_atr, side, pivots):
        first_before = self.first_crosses
        weak_before = self.weak_crosses
        signal = super()._check_side(i, candle, prior_atr, side, pivots)
        if side != -1 or self.first_crosses == first_before:
            return signal
        j1, j2 = pivots[-2:]
        p1, p2 = self.candles[j1].low, self.candles[j2].low
        line = p2 + (p2 - p1) * (i - j2) / (j2 - j1)
        self.down_crosses.append(
            {
                "index": i,
                "event_utc": _utc(candle.ts_event),
                "event_close": candle.close,
                "event_open": candle.open,
                "bearish_body": candle.open - candle.close,
                "prior_atr": prior_atr,
                "prior_rising_line_at_event": line,
                "low_pivot_anchor_utc": [_utc(self.candles[j].ts_event) for j in (j1, j2)],
                "low_pivot_confirmed_utc": [
                    _utc(self.candles[j + PIVOT_ORDER].ts_event) for j in (j1, j2)
                ],
                "weak_strength_or_close": self.weak_crosses != weak_before,
                "qualified_h06_signal": signal is not None,
            },
        )
        return signal


def _events(candles: list, decision_i: int) -> tuple[list[dict], list[int]]:
    state = ObservedLineBreaks()
    atr = WilderMovingAverage(14)
    previous_close = float(candles[0].close)
    for candle in candles[: decision_i + 1]:
        high, low = float(candle.high), float(candle.low)
        true_range = max(
            high - low,
            abs(high - previous_close),
            abs(low - previous_close),
        )
        state.on_closed(candle, atr.value if atr.initialized else None)
        atr.update_raw(true_range)
        previous_close = float(candle.close)
    earliest = decision_i - EVENT_LOOKBACK_BARS + 1
    return (
        [row for row in state.down_crosses if row["index"] >= earliest],
        state.high_pivots,
    )


def _local_btc(
    candles: list,
    decision_i: int,
    event: dict,
    high_pivots: list[int],
) -> dict:
    event_i = event["index"]
    eligible = [
        j
        for j in high_pivots
        if event_i - EVENT_LOOKBACK_BARS <= j < event_i and j + PIVOT_ORDER <= event_i
    ]
    if not eligible:
        return {"reason": "no high pivot confirmed by selected down-break event"}
    a = eligible[-1]
    b = min(
        range(event_i, decision_i + 1),
        key=lambda j: (float(candles[j].low), j),
    )
    high, low = float(candles[a].high), float(candles[b].low)
    if high <= low:
        return {"reason": "local high not above event-segmented low"}
    span = high - low
    levels = {
        "high_anchor": high,
        "low_anchor": low,
        "0.5": low + 0.5 * span,
        "0.618": low + 0.618 * span,
    }
    first_touch = next(
        (j for j in range(b + 1, decision_i + 1) if float(candles[j].high) >= levels["0.618"]),
        None,
    )
    stop = high + STOP_BUFFER_ATR * _prior_atr(candles, decision_i)
    room_r = (levels["0.618"] - low) / (stop - levels["0.618"])
    return {
        "reason": None,
        "a_high_utc": _utc(candles[a].ts_event),
        "a_confirmed_utc": _utc(candles[a + PIVOT_ORDER].ts_event),
        "b_low_utc": _utc(candles[b].ts_event),
        "b_age_four_hour_bars": decision_i - b,
        "eligible_confirmed_highs_before_event": len(eligible),
        "levels": levels,
        "source_band_differences": {
            key: _band_delta(value, BTC_BANDS[key]) for key, value in levels.items()
        },
        "all_source_bands_match": all(
            _band_delta(value, BTC_BANDS[key]) == 0 for key, value in levels.items()
        ),
        "first_618_touch_after_low_utc": _utc(candles[first_touch].ts_event)
        if first_touch is not None
        else None,
        "within_existing_30_bar_horizon": decision_i - b <= MAX_B_AGE,
        "researcher_stop_above_high": stop,
        "researcher_first_target_low": low,
        "room_r_before_instrument_rounding": room_r,
        "candidate_price_order_and_one_r": 0 < low < levels["0.618"] < stop and room_r >= 1,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-identity", type=Path, required=True)
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--parity", type=Path, required=True)
    parser.add_argument("--s13", type=Path, required=True)
    parser.add_argument("--d51", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if _sha(args.input_identity) != INPUT_SHA256:
        raise RuntimeError("registered input identity changed")
    if _sha(args.parity) != PARITY_SHA256:
        raise RuntimeError("corrected complete-bar parity changed")
    if _sha(args.s13) != S13_SHA256 or _sha(args.d51) != D51_SHA256:
        raise RuntimeError("frozen source or predecessor result changed")
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
        by_time = {bar.ts_event: i for i, bar in enumerate(candles)}
        decision_i = by_time.get(_ns(CUTOFF))
        if decision_i is None:
            raise RuntimeError(f"{coin}: no complete source cutoff")
        events, high_pivots = _events(candles, decision_i)
        qualified = [row for row in events if row["qualified_h06_signal"]]
        row = {
            "coin": coin,
            "instrument": instrument,
            "minute_catalog_sha256": input_row["minute_catalog"]["sha256"],
            "source_cutoff_utc": CUTOFF,
            "all_down_first_crosses_last_30_bars": events,
            "qualified_down_signals_last_30_bars": len(qualified),
            "weak_down_crosses_last_30_bars": sum(
                event["weak_strength_or_close"] for event in events
            ),
        }
        if coin == "BTC":
            latest = qualified[-1] if qualified else None
            row["selected_latest_qualified_down_break"] = latest
            row["local_impulse"] = (
                _local_btc(candles, decision_i, latest, high_pivots) if latest else None
            )
        rows.append(row)
    by_coin = {row["coin"]: row for row in rows}
    btc = by_coin["BTC"]
    event = btc["selected_latest_qualified_down_break"]
    impulse = btc["local_impulse"]
    gates = {
        "btc_latest_qualified_down_break_in_source_interval": event is not None
        and EVENT_MIN_UTC <= event["event_utc"] <= EVENT_MAX_UTC,
        "btc_local_a_b_and_levels_in_source_bands": impulse is not None
        and impulse["reason"] is None
        and impulse["all_source_bands_match"],
        "btc_local_618_untouched_and_within_horizon": impulse is not None
        and impulse["reason"] is None
        and impulse["first_618_touch_after_low_utc"] is None
        and impulse["within_existing_30_bar_horizon"],
        "btc_local_short_has_one_r_room": impulse is not None
        and impulse["reason"] is None
        and impulse["candidate_price_order_and_one_r"],
        "eth_has_no_qualified_down_break": by_coin["ETH"]["qualified_down_signals_last_30_bars"]
        == 0,
        "link_has_no_qualified_down_break": by_coin["LINK"]["qualified_down_signals_last_30_bars"]
        == 0,
    }
    result = {
        "scope": "D52 source-date H06 event and segmented impulse only; no orders, fills, future candles or PnL",
        "registration_commit": REGISTRATION_COMMIT,
        "reader_sha256": _sha(Path(__file__)),
        "input_identity_sha256": INPUT_SHA256,
        "corrected_parity_sha256": PARITY_SHA256,
        "s13_source_sha256": S13_SHA256,
        "d51_predecessor_sha256": D51_SHA256,
        "source_cutoff_utc": CUTOFF,
        "source_event_interval_utc": [EVENT_MIN_UTC, EVENT_MAX_UTC],
        "visual_bands": BTC_BANDS,
        "gates": gates,
        "all_source_gates_pass": all(gates.values()),
        "rows": rows,
        "economic_data_read": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
