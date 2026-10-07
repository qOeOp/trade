"""
Causal H13 support-confluence signal with native Nautilus orders and fills.
"""

from __future__ import annotations

from dataclasses import asdict
from dataclasses import dataclass

from strategy import BOX_BARS
from strategy import BOX_RETEST_BARS
from strategy import FOUR_HOUR_NS
from strategy import STOP_BUFFER_ATR
from strategy import FourHour
from strategy import R1Strategy
from strategy import WaitingSignal


PIVOT_ORDER = 8
ANCHOR_LOOKBACK = 180
MIN_ANCHOR_SPAN = 6
SUPPORT_BAND_ATR = 0.25
ENTRY_RATIO = 0.618
STOP_RATIO = 0.764
NEAR_RATIO = 0.5


@dataclass(frozen=True)
class RetracementPlan:
    ts_event: int
    a_index: int
    b_index: int
    a_low: float
    b_high: float
    level_50: float
    entry: float
    level_764: float
    stop: float
    target: float
    support_low_indices: tuple[int, ...]

    def as_dict(self) -> dict:
        return asdict(self)


class ConfirmedSupportPullback:
    """
    Evaluate completed four-hour bars; Nautilus still owns execution.
    """

    def __init__(self, *, timing: str = "near-tier") -> None:
        if timing not in ("near-tier", "immediate", "confirmed-update"):
            raise ValueError("unsupported support-pullback timing")
        self.timing = timing
        self.candles: list[FourHour] = []
        self.low_pivots: list[int] = []
        self.planned_pairs: set[tuple[int, int]] = set()
        self.last_readout: dict | None = None
        self.plans = 0
        self.no_anchor = 0
        self.no_support = 0
        self.not_approaching = 0
        self.no_room = 0

    def on_closed(self, candle: FourHour, prior_atr: float | None) -> RetracementPlan | None:
        if self.candles and candle.ts_event - self.candles[-1].ts_event != FOUR_HOUR_NS:
            raise RuntimeError("H13 four-hour LAST input is not contiguous")
        self.candles.append(candle)
        i = len(self.candles) - 1
        self._confirm_pivot(i)
        plan, readout = self._evaluate(i, prior_atr)
        self.last_readout = readout
        if plan is not None:
            self.planned_pairs.add((plan.a_index, plan.b_index))
            self.plans += 1
        return plan

    def _confirm_pivot(self, i: int) -> None:
        if i < 2 * PIVOT_ORDER:
            return
        j = i - PIVOT_ORDER
        window = self.candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
        if self.candles[j].low == min(bar.low for bar in window):
            self.low_pivots.append(j)

    def _evaluate(self, i: int, prior_atr: float | None) -> tuple[RetracementPlan | None, dict]:
        row: dict = {"index": i, "reason": None, "impulse": None, "plan": None}
        if i + 1 < ANCHOR_LOOKBACK or prior_atr is None or prior_atr <= 0:
            row["reason"] = "insufficient-history-or-atr"
            return None, row
        first_b = i - BOX_BARS + 1
        b = max(range(first_b, i + 1), key=lambda j: (self.candles[j].high, -j))
        eligible = [
            j
            for j in self.low_pivots
            if i - ANCHOR_LOOKBACK + 1 <= j < b and b - j >= MIN_ANCHOR_SPAN
        ]
        if not eligible or i - b > BOX_RETEST_BARS:
            self.no_anchor += 1
            row["reason"] = "no-recent-confirmed-impulse"
            return None, row
        a = eligible[-1]
        low, high = self.candles[a].low, self.candles[b].high
        if high <= low:
            self.no_anchor += 1
            row["reason"] = "nonpositive-impulse"
            return None, row
        span = high - low
        level_50 = high - NEAR_RATIO * span
        entry = high - ENTRY_RATIO * span
        level_764 = high - STOP_RATIO * span
        stop = level_764 - STOP_BUFFER_ATR * prior_atr
        row["impulse"] = {
            "a_index": a,
            "b_index": b,
            "a_low": low,
            "b_high": high,
            "level_50": level_50,
            "level_618": entry,
            "level_764": level_764,
            "stop": stop,
        }
        support = tuple(
            j
            for j in range(i - ANCHOR_LOOKBACK + 1, b)
            if abs(self.candles[j].low - entry) <= SUPPORT_BAND_ATR * prior_atr
        )
        row["support_low_indices"] = support
        if not any(later - earlier >= MIN_ANCHOR_SPAN for earlier in support for later in support):
            self.no_support += 1
            row["reason"] = "no-prior-separated-horizontal-support"
            return None, row
        candle = self.candles[i]
        if self.timing == "near-tier":
            approaching = entry < candle.close <= level_50 and candle.low > entry
        elif self.timing == "immediate":
            approaching = b == i and entry < candle.close and candle.low > entry
        else:
            approaching = entry < candle.close and all(
                self.candles[j].low > entry for j in range(b, i + 1)
            )
        if not approaching:
            self.not_approaching += 1
            row["reason"] = {
                "near-tier": "not-before-61.8-touch-in-approach-zone",
                "immediate": "not-new-high-before-61.8-touch",
                "confirmed-update": "61.8-touched-since-high-or-closed-below",
            }[self.timing]
            return None, row
        if (a, b) in self.planned_pairs:
            row["reason"] = "pair-already-planned"
            return None, row
        if not (0 < stop < entry < candle.close < high) or (high - entry) < 2 * (entry - stop):
            self.no_room += 1
            row["reason"] = "invalid-price-or-less-than-2r-room"
            return None, row
        plan = RetracementPlan(
            candle.ts_event,
            a,
            b,
            low,
            high,
            level_50,
            entry,
            level_764,
            stop,
            high,
            support,
        )
        row["plan"] = plan.as_dict()
        return plan, row


class RetracementStrategy(R1Strategy):
    """
    Submit H13c through native brackets, with acknowledged entry replacement.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant != "support-confirmed-4h":
            raise ValueError("retracement strategy requires support-confirmed-4h")
        self.support_state = ConfirmedSupportPullback(timing="confirmed-update")
        self.selected_pair: tuple[int, int] | None = None
        self.retracement_supersessions = 0
        self.retracement_cancel_race_fills = 0
        self.retracement_invalid_price_skips = 0

    def _queue_four_hour_candidate(self, candle: FourHour) -> None:
        plan = self.support_state.on_closed(
            candle,
            self.atr.value if self.atr.initialized else None,
        )
        impulse = self.support_state.last_readout["impulse"]
        if impulse is not None:
            pair = (impulse["a_index"], impulse["b_index"])
            if pair != self.selected_pair:
                self.selected_pair = pair
                self.waiting.clear()
                if self.resting_entry_id is not None and self.opened_ns is None:
                    self.canceling_entry_id = self.resting_entry_id
                    self.canceling_signal = None
                    self.resting_entry_id = None
                    self.resting_signal = None
                    self.retracement_supersessions += 1
                    self.cancel_order(self.canceling_entry_id)
        if plan is None or (
            self.trade_start_ns is not None and candle.ts_event < self.trade_start_ns
        ):
            return
        if self.opened_ns is not None:
            self.signals_while_open += 1
            return
        signal = WaitingSignal(
            candle.ts_event,
            candle.ts_event + 30 * FOUR_HOUR_NS,
            1,
            plan.entry,
            plan.stop,
            plan.target,
        )
        self.waiting.append(signal)
        self.signals += 1

    def on_order_filled(self, event) -> None:
        canceled_entry_filled = event.client_order_id == self.canceling_entry_id
        super().on_order_filled(event)
        if canceled_entry_filled:
            self.retracement_cancel_race_fills += 1
        if event.client_order_id in self.entries:
            self.waiting.clear()

    def _submit_signal(self, signal: WaitingSignal) -> None:
        entry = self.instrument.make_price(signal.level).as_double()
        stop = self.instrument.make_price(signal.stop).as_double()
        target = self.instrument.make_price(signal.target).as_double()
        if not (0 < stop < entry < target and target - entry >= 2 * (entry - stop)):
            self.retracement_invalid_price_skips += 1
            return
        super()._submit_signal(signal)
