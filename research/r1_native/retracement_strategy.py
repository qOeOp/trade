"""
Causal H13 support-confluence signal with native Nautilus orders and fills.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from dataclasses import dataclass

from strategy import BOX_BARS
from strategy import BOX_RETEST_BARS
from strategy import FOUR_HOUR_NS
from strategy import STOP_BUFFER_ATR
from strategy import FourHour
from strategy import R1Strategy
from strategy import WaitingSignal

from vibe_trading.model import OrderSide
from vibe_trading.model import OrderType
from vibe_trading.model import TimeInForce


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
    support_high_indices: tuple[int, ...] = ()
    support_kind: str = "prior-lows"

    def as_dict(self) -> dict:
        return asdict(self)


def classify_first_touch_rejection(
    plan: RetracementPlan,
    candle: FourHour,
    *,
    round_price: Callable[[float], float],
) -> tuple[str, float | None]:
    """
    Classify one completed bar against a previously armed H13c plan.
    """
    if candle.ts_event <= plan.ts_event:
        return "not-after-plan", None
    if candle.low > plan.entry:
        return "untouched", None
    if candle.low <= plan.stop:
        return "stop-crossed-before-decision", None
    if candle.close <= plan.entry:
        return "close-not-above-tier", None
    if candle.close >= plan.target:
        return "close-at-or-above-target", None
    entry, stop, target = (round_price(price) for price in (candle.close, plan.stop, plan.target))
    if not (0 < stop < entry < target) or target - entry < 2 * (entry - stop):
        return "rounded-price-or-room-invalid", None
    return "admitted-rejection", entry


def retire_first_touch_plan(
    active: RetracementPlan | None,
    selected_pair: tuple[int, int] | None,
    ts_event: int,
) -> tuple[RetracementPlan | None, str | None]:
    """
    Retire a plan before its touch is assessed at this completed bar.
    """
    if active is None:
        return None, None
    if selected_pair is not None and selected_pair != (active.a_index, active.b_index):
        return None, "superseded"
    if ts_event >= active.ts_event + 30 * FOUR_HOUR_NS:
        return None, "expired"
    return active, None


class ConfirmedSupportPullback:
    """
    Evaluate completed four-hour bars; Nautilus still owns execution.
    """

    def __init__(
        self,
        *,
        timing: str = "near-tier",
        support_mode: str = "all-lows",
        entry_ratio: float = ENTRY_RATIO,
        minimum_target_r: float = 2.0,
    ) -> None:
        if timing not in ("near-tier", "immediate", "confirmed-update"):
            raise ValueError("unsupported support-pullback timing")
        if support_mode not in ("all-lows", "confirmed-pivots", "prior-highs", "none"):
            raise ValueError("unsupported support-pullback support mode")
        if (entry_ratio, minimum_target_r) not in ((ENTRY_RATIO, 2.0), (NEAR_RATIO, 1.5)):
            raise ValueError("unsupported pullback entry and room pairing")
        if entry_ratio == NEAR_RATIO and support_mode != "none":
            raise ValueError("the separate 50-percent style has no mandatory 61.8 support test")
        self.timing = timing
        self.support_mode = support_mode
        self.entry_ratio = entry_ratio
        self.minimum_target_r = minimum_target_r
        self.candles: list[FourHour] = []
        self.low_pivots: list[int] = []
        self.high_pivots: list[int] = []
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
        if self.candles[j].high == max(bar.high for bar in window):
            self.high_pivots.append(j)

    def _support_at(
        self,
        i: int,
        b: int,
        entry: float,
        prior_atr: float,
        row: dict,
    ) -> tuple[int, ...] | None:
        if self.support_mode == "none":
            row["support_low_indices"] = ()
            row["support_high_indices"] = ()
            return ()
        if self.support_mode == "all-lows":
            candidates = range(i - ANCHOR_LOOKBACK + 1, b)
        else:
            pivots = self.high_pivots if self.support_mode == "prior-highs" else self.low_pivots
            candidates = (j for j in pivots if i - ANCHOR_LOOKBACK + 1 <= j and j + PIVOT_ORDER < b)
        support = tuple(
            j
            for j in candidates
            if abs(
                (
                    self.candles[j].high
                    if self.support_mode == "prior-highs"
                    else self.candles[j].low
                )
                - entry,
            )
            <= SUPPORT_BAND_ATR * prior_atr
        )
        row["support_low_indices"] = support if self.support_mode != "prior-highs" else ()
        row["support_high_indices"] = support if self.support_mode == "prior-highs" else ()
        if not any(later - earlier >= MIN_ANCHOR_SPAN for earlier in support for later in support):
            self.no_support += 1
            row["reason"] = (
                "no-prior-separated-resistance-highs"
                if self.support_mode == "prior-highs"
                else "no-prior-separated-horizontal-support"
            )
            return None
        if self.support_mode == "prior-highs":
            old_high = max(self.candles[support[0]].high, self.candles[support[-1]].high)
            breaks = tuple(
                j
                for j in range(support[-1] + PIVOT_ORDER + 1, i + 1)
                if self.candles[j].close > old_high
            )
            row["old_resistance_break_indices"] = breaks
            if not breaks:
                self.no_support += 1
                row["reason"] = "old-resistance-not-closed-above"
                return None
        return support

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
        entry = high - self.entry_ratio * span
        level_764 = high - STOP_RATIO * span
        stop = level_764 - STOP_BUFFER_ATR * prior_atr
        row["impulse"] = {
            "a_index": a,
            "b_index": b,
            "a_low": low,
            "b_high": high,
            "level_50": level_50,
            "level_618": high - ENTRY_RATIO * span,
            "level_764": level_764,
            "stop": stop,
            "entry": entry,
            "entry_ratio": self.entry_ratio,
        }
        support = self._support_at(i, b, entry, prior_atr, row)
        if support is None:
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
        if not (0 < stop < entry < candle.close < high) or (
            high - entry
        ) < self.minimum_target_r * (entry - stop):
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
            support if self.support_mode != "prior-highs" else (),
            support if self.support_mode == "prior-highs" else (),
            "old-resistance-highs"
            if self.support_mode == "prior-highs"
            else "none"
            if self.support_mode == "none"
            else "prior-lows",
        )
        row["plan"] = plan.as_dict()
        return plan, row


class RetracementStrategy(R1Strategy):
    """
    Submit H13c limits or H13f close-rejection markets through native brackets.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant not in ("support-confirmed-4h", "support-rejection-4h"):
            raise ValueError("retracement strategy requires a supported pullback variant")
        self.support_state = ConfirmedSupportPullback(timing="confirmed-update")
        self.selected_pair: tuple[int, int] | None = None
        self.retracement_supersessions = 0
        self.retracement_cancel_race_fills = 0
        self.retracement_invalid_price_skips = 0
        self.first_touch_plan: RetracementPlan | None = None
        self.pending_rejection: tuple[FourHour, RetracementPlan, float] | None = None
        self.first_touch_counts: dict[str, int] = {}
        self.retracement_actual_price_violations = 0

    def _queue_four_hour_candidate(self, candle: FourHour) -> None:
        if self.signal_variant == "support-rejection-4h":
            self._queue_first_touch_rejection(candle)
            return
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

    def _queue_first_touch_rejection(self, candle: FourHour) -> None:
        plan = self.support_state.on_closed(
            candle,
            self.atr.value if self.atr.initialized else None,
        )
        impulse = self.support_state.last_readout["impulse"]
        pair = None
        if impulse is not None:
            pair = (impulse["a_index"], impulse["b_index"])
        active, retirement = retire_first_touch_plan(self.first_touch_plan, pair, candle.ts_event)
        self.first_touch_plan = active
        if pair is not None:
            self.selected_pair = pair
        if retirement is not None:
            self.first_touch_counts[retirement] = self.first_touch_counts.get(retirement, 0) + 1
            if retirement == "superseded":
                self.retracement_supersessions += 1
        if active is not None and candle.ts_event > active.ts_event and candle.low <= active.entry:
            reason, entry = classify_first_touch_rejection(
                active,
                candle,
                round_price=lambda price: self.instrument.make_price(price).as_double(),
            )
            self.first_touch_plan = None
            self.first_touch_counts[reason] = self.first_touch_counts.get(reason, 0) + 1
            if reason == "admitted-rejection" and entry is not None:
                if (
                    self.opened_ns is None
                    and self.resting_entry_id is None
                    and self.canceling_entry_id is None
                ):
                    self.pending_rejection = (candle, active, entry)
                else:
                    self.signals_while_open += 1
        if plan is not None and (
            self.trade_start_ns is None or candle.ts_event >= self.trade_start_ns
        ):
            if self.opened_ns is None and self.resting_entry_id is None:
                self.first_touch_plan = plan
            else:
                self.signals_while_open += 1

    def _advance_waiting(self, bar) -> None:
        if self.signal_variant == "support-rejection-4h" and self.pending_rejection is not None:
            candle, plan, entry = self.pending_rejection
            if bar.ts_event > candle.ts_event:
                self.pending_rejection = None
                if self.opened_ns is None and self.resting_entry_id is None:
                    self._submit_rejection_market(candle, plan, entry)
                else:
                    self.signals_while_open += 1
        super()._advance_waiting(bar)

    def _submit_rejection_market(
        self,
        candle: FourHour,
        plan: RetracementPlan,
        entry: float,
    ) -> None:
        signal = WaitingSignal(
            candle.ts_event,
            candle.ts_event + 30 * FOUR_HOUR_NS,
            1,
            entry,
            plan.stop,
            plan.target,
        )
        self.signals += 1
        quantity = self._order_quantity(signal)
        if quantity is None:
            return
        stop = self.instrument.make_price(signal.stop).as_double()
        target = self.instrument.make_price(signal.target).as_double()
        if not (0 < stop < entry < target and target - entry >= 2 * (entry - stop)):
            self.retracement_invalid_price_skips += 1
            return
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY,
            quantity=quantity,
            entry_order_type=OrderType.MARKET,
            time_in_force=TimeInForce.GTC,
            tp_price=self.instrument.make_price(signal.target),
            tp_post_only=False,
            sl_trigger_price=self.instrument.make_price(signal.stop),
        )
        self.resting_entry_id = orders[0].client_order_id
        self.resting_signal = signal
        self.entries.add(self.resting_entry_id)
        self.submit_order_list(orders)
        self.waiting_released += 1

    def on_order_filled(self, event) -> None:
        canceled_entry_filled = event.client_order_id == self.canceling_entry_id
        signal = self.resting_signal if event.client_order_id in self.entries else None
        super().on_order_filled(event)
        if self.signal_variant == "support-rejection-4h" and signal is not None:
            actual = float(event.last_px)
            stop = self.instrument.make_price(signal.stop).as_double()
            target = self.instrument.make_price(signal.target).as_double()
            if not 0 < stop < actual < target:
                self.retracement_actual_price_violations += 1
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
