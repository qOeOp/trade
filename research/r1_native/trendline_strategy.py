"""
H06 line breaks and exploratory H08/H08b support entries with native Nautilus orders.

The signal definition is frozen at
0725a7b3f89902e27cd421a18b4b879a13268534:research/ronnie/combo/candidates/trendline_break_strong.py.
The frozen old source defines H06 only; H08/H08b are separately preregistered in
RD_EXPERIMENTS.md. The old research fill model is not used here.

"""

from __future__ import annotations

from dataclasses import dataclass

from strategy import BOX_BARS
from strategy import FOUR_HOUR_NS
from strategy import STOP_BUFFER_ATR
from strategy import R1Strategy
from strategy import WaitingSignal

from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import InstrumentId
from vibe_trading.model import OrderSide
from vibe_trading.model import OrderType
from vibe_trading.model import Quantity
from vibe_trading.model import StrategyId
from vibe_trading.model import TimeInForce


PIVOT_ORDER = 8
MIN_ANCHOR_SPAN = 6
MAX_LINE_EXTENSION = 60
MIN_BODY_ATR = 1.0
MIN_CLOSE_POSITION = 0.7
TARGET_R = 2.0
MAX_HOLD_BARS = 30


@dataclass(frozen=True)
class LineCandle:
    ts_event: int
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class LineBreak:
    ts_event: int
    side: int
    reference_close: float
    stop: float
    target: float
    anchors: tuple[int, int]


@dataclass(frozen=True)
class LineRestingPlan:
    ts_event: int
    entry: float
    stop: float
    target: float
    anchors: tuple[int, int]


class ConfirmedLineBreaks:
    """
    Evaluate only completed four-hour bars; order events stay in Strategy.
    """

    def __init__(self) -> None:
        self.candles: list[LineCandle] = []
        self.high_pivots: list[int] = []
        self.low_pivots: list[int] = []
        self.dead_pairs: set[tuple[int, int, int]] = set()
        self.first_crosses = 0
        self.weak_crosses = 0

    def on_closed(self, candle: LineCandle, prior_atr: float | None) -> list[LineBreak]:
        if self.candles and candle.ts_event - self.candles[-1].ts_event != FOUR_HOUR_NS:
            raise RuntimeError("H06 four-hour input is not contiguous")
        self.candles.append(candle)
        i = len(self.candles) - 1
        self._confirm_pivot(i)
        result = []
        for side, pivots in ((1, self.high_pivots), (-1, self.low_pivots)):
            candidate = self._check_side(i, candle, prior_atr, side, pivots)
            if candidate is not None:
                result.append(candidate)
        return result

    def _confirm_pivot(self, i: int) -> None:
        if i >= 2 * PIVOT_ORDER:
            j = i - PIVOT_ORDER
            window = self.candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
            pivot = self.candles[j]
            if pivot.high == max(bar.high for bar in window):
                self.high_pivots.append(j)
            if pivot.low == min(bar.low for bar in window):
                self.low_pivots.append(j)

    def _check_side(
        self,
        i: int,
        candle: LineCandle,
        prior_atr: float,
        side: int,
        pivots: list[int],
    ) -> LineBreak | None:
        if len(pivots) < 2:
            return None
        j1, j2 = pivots[-2:]
        key = (side, j1, j2)
        if key in self.dead_pairs or j2 - j1 < MIN_ANCHOR_SPAN or i - j2 > MAX_LINE_EXTENSION:
            return None
        p1 = self.candles[j1].high if side == 1 else self.candles[j1].low
        p2 = self.candles[j2].high if side == 1 else self.candles[j2].low
        if (p2 - p1) * side >= 0:
            return None
        slope = (p2 - p1) / (j2 - j1)
        if (candle.close - (p2 + slope * (i - j2))) * side <= 0:
            return None
        self.dead_pairs.add(key)
        if any(
            (self.candles[index].close - (p2 + slope * (index - j2))) * side > 0
            for index in range(j2 + 1, i)
        ):
            return None
        self.first_crosses += 1
        # The source consumes a crossed pair even during signal warmup.
        if i < 30 or prior_atr is None or prior_atr <= 0:
            return None
        candle_range = candle.high - candle.low
        directional_body = (candle.close - candle.open) * side
        close_position = (
            (candle.close - candle.low) / candle_range
            if side == 1 and candle_range > 0
            else (candle.high - candle.close) / candle_range
            if candle_range > 0
            else 0.0
        )
        if (
            candle_range <= 0
            or directional_body < MIN_BODY_ATR * prior_atr
            or close_position < MIN_CLOSE_POSITION
        ):
            self.weak_crosses += 1
            return None
        stop = candle.low if side == 1 else candle.high
        return LineBreak(
            candle.ts_event,
            side,
            candle.close,
            stop,
            candle.close + side * TARGET_R * abs(candle.close - stop),
            (j1, j2),
        )


class ConfirmedLineSupportTouches:
    """
    H08 rising-line support contacts on completed four-hour LAST bars only.
    """

    def __init__(self) -> None:
        self.candles: list[LineCandle] = []
        self.low_pivots: list[int] = []
        self.dead_pairs: set[tuple[int, int]] = set()
        self.broken_pairs = 0
        self.touches = 0
        self.rejections = 0
        self.room_skips = 0

    def on_closed(self, candle: LineCandle, prior_atr: float | None) -> list[LineBreak]:
        if self.candles and candle.ts_event - self.candles[-1].ts_event != FOUR_HOUR_NS:
            raise RuntimeError("H08 four-hour input is not contiguous")
        prior = self.candles[-BOX_BARS:]
        previous = self.candles[-1] if self.candles else None
        self.candles.append(candle)
        i = len(self.candles) - 1
        if i >= 2 * PIVOT_ORDER:
            j = i - PIVOT_ORDER
            window = self.candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
            if self.candles[j].low == min(bar.low for bar in window):
                self.low_pivots.append(j)
        projected = self._latest_rising_line(i)
        if projected is None:
            return []
        pair, p2, slope, line = projected
        j2 = pair[1]
        if (
            any(self.candles[k].close <= p2 + slope * (k - j2) for k in range(j2 + 1, i))
            or candle.close <= line
        ):
            self.dead_pairs.add(pair)
            self.broken_pairs += 1
            return []
        if prior_atr is None or prior_atr <= 0 or len(prior) != BOX_BARS or previous is None:
            return []
        band = STOP_BUFFER_ATR * prior_atr
        previous_line = line - slope
        if (
            previous.close <= previous_line + band
            or previous.low <= previous_line + band
            or candle.low > line + band
        ):
            return []
        self.touches += 1
        if candle.close <= candle.open:
            return []
        self.rejections += 1
        stop = min(candle.low, line) - band
        target = max(bar.high for bar in prior)
        risk = candle.close - stop
        if risk <= 0 or target - candle.close < risk:
            self.room_skips += 1
            return []
        return [LineBreak(candle.ts_event, 1, candle.close, stop, target, pair)]

    def _latest_rising_line(self, i: int):
        if len(self.low_pivots) < 2:
            return None
        j1, j2 = self.low_pivots[-2:]
        pair = (j1, j2)
        if pair in self.dead_pairs or j2 - j1 < MIN_ANCHOR_SPAN or i - j2 > MAX_LINE_EXTENSION:
            return None
        p1, p2 = self.candles[j1].low, self.candles[j2].low
        if p2 <= p1:
            return None
        slope = (p2 - p1) / (j2 - j1)
        return pair, p2, slope, p2 + slope * (i - j2)

    def next_bar_resting_plan(self, prior_atr: float | None) -> LineRestingPlan | None:
        """
        Use the latest completed bar to price one future four-hour limit.
        """
        i = len(self.candles) - 1
        if i < 0 or prior_atr is None or prior_atr <= 0 or len(self.candles) < BOX_BARS:
            return None
        projected = self._latest_rising_line(i)
        if projected is None:
            return None
        pair, _, slope, line = projected
        candle = self.candles[i]
        band = STOP_BUFFER_ATR * prior_atr
        if candle.low <= line + band or candle.close <= line + band:
            return None
        next_line = line + slope
        entry, stop = next_line + band, next_line - band
        target = max(bar.high for bar in self.candles[-BOX_BARS:])
        if entry >= candle.close or entry <= stop or target - entry < entry - stop:
            self.room_skips += 1
            return None
        return LineRestingPlan(candle.ts_event, entry, stop, target, pair)


class TrendlineBreakStrategy(R1Strategy):
    def __init__(
        self,
        instrument_id: InstrumentId,
        daily_bar_type: BarType,
        trade_size: Quantity,
        trade_start_ns: int | None = None,
        historical_daily_bars: list[Bar] | None = None,
        execution_bar_minutes: int = 1,
        strategy_id: StrategyId | None = None,
        risk_budget_fraction: float | None = None,
        max_coin_notional_fraction: float = 0.05,
        signal_variant: str = "trendline-4h",
    ) -> None:
        if signal_variant not in ("trendline-4h", "line-support-4h", "line-resting-4h"):
            raise ValueError("line Strategy requires a registered four-hour signal")
        super().__init__(
            instrument_id,
            daily_bar_type,
            trade_size,
            trade_start_ns,
            historical_daily_bars,
            execution_bar_minutes,
            strategy_id,
            risk_budget_fraction,
            max_coin_notional_fraction,
            "box-4h",
        )
        self.signal_variant = signal_variant
        self.line_state = (
            ConfirmedLineBreaks()
            if signal_variant == "trendline-4h"
            else ConfirmedLineSupportTouches()
        )
        self.line_invalid_price_skips = 0
        self.line_time_exits = 0
        self.line_active_signal_ns: int | None = None

    def _on_four_hour_bar(self, bar: Bar) -> None:
        candle = LineCandle(
            bar.ts_event,
            float(bar.open),
            float(bar.high),
            float(bar.low),
            float(bar.close),
        )
        previous_close = (
            self.line_state.candles[-1].close if self.line_state.candles else candle.close
        )
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        prior_atr = self.atr.value if self.atr.initialized else None
        breaks = self.line_state.on_closed(candle, prior_atr)
        resting_plan = (
            self.line_state.next_bar_resting_plan(prior_atr)
            if self.signal_variant == "line-resting-4h"
            else None
        )
        self.atr.update_raw(true_range)
        time_origin_ns = (
            self.opened_ns
            if self.signal_variant == "line-resting-4h"
            else self.line_active_signal_ns
        )
        hold_bars = MAX_HOLD_BARS if self.signal_variant == "line-resting-4h" else MAX_HOLD_BARS + 1
        if (
            self.opened_ns is not None
            and time_origin_ns is not None
            and bar.ts_event >= time_origin_ns + hold_bars * FOUR_HOUR_NS
        ):
            self.cancel_all_orders(self.instrument_id)
            self.close_all_positions(self.instrument_id)
            self.line_time_exits += 1
        if self.signal_variant == "line-resting-4h":
            if resting_plan is None or (
                self.trade_start_ns is not None and resting_plan.ts_event < self.trade_start_ns
            ):
                return
            self.signals += 1
            if self.opened_ns is not None or self.resting_entry_id is not None:
                self.signals_while_open += 1
                return
            self._submit_line_resting(resting_plan)
            return
        for candidate in breaks:
            if self.trade_start_ns is not None and candidate.ts_event < self.trade_start_ns:
                continue
            self.signals += 1
            if self.opened_ns is not None or self.resting_entry_id is not None:
                self.signals_while_open += 1
                continue
            self._submit_line_break(candidate)

    def _submit_line_break(self, candidate: LineBreak) -> None:
        signal = WaitingSignal(
            candidate.ts_event,
            candidate.ts_event + MAX_HOLD_BARS * FOUR_HOUR_NS,
            candidate.side,
            candidate.reference_close,
            candidate.stop,
            candidate.target,
        )
        quantity = self._order_quantity(signal)
        if quantity is None:
            return
        prices = tuple(
            self.instrument.make_price(price).as_double()
            for price in (candidate.reference_close, candidate.stop, candidate.target)
        )
        reference, stop, target = prices
        if (
            any(price <= 0 for price in prices)
            or (reference - stop) * candidate.side <= 0
            or (target - reference) * candidate.side <= 0
        ):
            self.line_invalid_price_skips += 1
            return
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY if candidate.side == 1 else OrderSide.SELL,
            quantity=quantity,
            entry_order_type=OrderType.MARKET,
            time_in_force=TimeInForce.GTC,
            tp_price=self.instrument.make_price(candidate.target),
            tp_post_only=False,
            sl_trigger_price=self.instrument.make_price(candidate.stop),
        )
        self.resting_entry_id = orders[0].client_order_id
        self.resting_signal = signal
        self.line_active_signal_ns = candidate.ts_event
        self.entries.add(self.resting_entry_id)
        self.submit_order_list(orders)
        self.waiting_released += 1

    def _submit_line_resting(self, plan: LineRestingPlan) -> None:
        expires_ns = plan.ts_event + FOUR_HOUR_NS - 1
        signal = WaitingSignal(plan.ts_event, expires_ns, 1, plan.entry, plan.stop, plan.target)
        quantity = self._order_quantity(signal)
        if quantity is None:
            return
        entry, stop, target = (
            self.instrument.make_price(price).as_double()
            for price in (plan.entry, plan.stop, plan.target)
        )
        if (
            min(entry, stop, target) <= 0
            or entry >= self.line_state.candles[-1].close
            or entry <= stop
            or target - entry < entry - stop
        ):
            self.line_invalid_price_skips += 1
            return
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY,
            quantity=quantity,
            entry_order_type=OrderType.LIMIT,
            entry_price=self.instrument.make_price(plan.entry),
            time_in_force=TimeInForce.GTD,
            expire_time=expires_ns,
            tp_price=self.instrument.make_price(plan.target),
            tp_post_only=False,
            sl_trigger_price=self.instrument.make_price(plan.stop),
        )
        self.resting_entry_id = orders[0].client_order_id
        self.resting_signal = signal
        self.entries.add(self.resting_entry_id)
        self.submit_order_list(orders)
        self.waiting_released += 1

    def on_position_closed(self, event) -> None:
        super().on_position_closed(event)
        self.line_active_signal_ns = None
