"""
Select one causally confirmed broad four-hour pullback for native tier orders.

The frozen D60 diagnostic remains an immutable read-only evidence artifact. This
production selector implements its registered geometry; Nautilus owns orders, fills,
positions, and account equity.

"""

from __future__ import annotations

from retracement_strategy import RetracementPlan
from strategy import FOUR_HOUR_NS
from strategy import STOP_BUFFER_ATR
from strategy import FourHour


PIVOT_ORDER = 8
ANCHOR_LOOKBACK = 180
BOX_BARS = 60
MIN_ANCHOR_SPAN = 6
DEEP_STOP_RATIO = 0.764


class BroadSwingPullback:
    """
    Track complete LAST candles and expose D60's selected A/B and eligible plan.
    """

    def __init__(self) -> None:
        self.candles: list[FourHour] = []
        self.last_selected: dict | None = None

    def _pivot_low(self, j: int) -> bool:
        window = self.candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
        return self.candles[j].low == min(bar.low for bar in window)

    def _selected(self, i: int, prior_atr: float | None) -> dict | None:
        if i + 1 < ANCHOR_LOOKBACK or prior_atr is None or prior_atr <= 0:
            return None
        b = max(range(i - BOX_BARS + 1, i + 1), key=lambda j: (self.candles[j].high, -j))
        eligible = [
            j
            for j in range(max(PIVOT_ORDER, b - ANCHOR_LOOKBACK + 1), b - MIN_ANCHOR_SPAN + 1)
            if j + PIVOT_ORDER <= b and self._pivot_low(j)
        ]
        if not eligible:
            return None
        a = min(eligible, key=lambda j: (self.candles[j].low, j))
        low, high = self.candles[a].low, self.candles[b].high
        if not 0 < low < high:
            return None
        span = high - low
        return {
            "a_index": a,
            "b_index": b,
            "a_low": low,
            "b_high": high,
            "level_50": high - 0.5 * span,
            "level_618": high - 0.618 * span,
            "level_764": high - DEEP_STOP_RATIO * span,
            "stop": high - DEEP_STOP_RATIO * span - STOP_BUFFER_ATR * prior_atr,
            "target": high,
        }

    def _eligible(self, i: int, selected: dict) -> bool:
        b = selected["b_index"]
        return self.candles[i].close > selected["level_50"] and all(
            self.candles[j].low > selected["level_50"] for j in range(b + 1, i + 1)
        )

    def on_closed(self, candle: FourHour, prior_atr: float | None) -> RetracementPlan | None:
        if self.candles and candle.ts_event - self.candles[-1].ts_event != FOUR_HOUR_NS:
            raise RuntimeError("broad-swing four-hour LAST input is not contiguous")
        self.candles.append(candle)
        i = len(self.candles) - 1
        selected = self._selected(i, prior_atr)
        self.last_selected = selected
        if selected is None or selected["stop"] <= 0 or not self._eligible(i, selected):
            return None
        return RetracementPlan(
            ts_event=candle.ts_event,
            a_index=selected["a_index"],
            b_index=selected["b_index"],
            a_low=selected["a_low"],
            b_high=selected["b_high"],
            level_50=selected["level_50"],
            entry=selected["level_50"],
            level_764=selected["level_764"],
            stop=selected["stop"],
            target=selected["target"],
            support_low_indices=(),
            support_kind="broad-confirmed-swing",
        )
