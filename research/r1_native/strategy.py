"""
R-1u role reversal retest, expressed as a native Nautilus Strategy.

Rule source: research/ronnie/loop/family_r.py at
0725a7b3f89902e27cd421a18b4b879a13268534. Only closed daily bars
generate signals. A native bracket owns entry, stop, target, and fill events.

"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from vibe_trading.indicators import WilderMovingAverage
from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import InstrumentId
from vibe_trading.model import OrderSide
from vibe_trading.model import OrderType
from vibe_trading.model import Quantity
from vibe_trading.model import TimeInForce
from vibe_trading.trading import Strategy


K = 3
BODY_X = 1.5
VALID_DAYS = 10
HOLD_DAYS = 60
STOP_BUFFER_ATR = 0.25
DAY_NS = 86_400_000_000_000


@dataclass(frozen=True)
class Daily:
    open: float
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class WaitingSignal:
    armed_ns: int
    side: int
    level: float
    stop: float
    target: float


class R1Strategy(Strategy):
    def __new__(
        cls,
        instrument_id: InstrumentId,
        daily_bar_type: BarType,
        trade_size: Quantity,
    ):
        return super().__new__(cls)

    def __init__(
        self,
        instrument_id: InstrumentId,
        daily_bar_type: BarType,
        trade_size: Quantity,
    ) -> None:
        super().__init__()
        self.instrument_id = instrument_id
        self.daily_bar_type = daily_bar_type
        self.minute_bar_type = BarType.from_str(
            f"{instrument_id}-1-MINUTE-LAST-EXTERNAL",
        )
        self.trade_size = trade_size
        # Source atr_of uses ewm(alpha=1/14, adjust=False), seeded by first TR.
        # The native Wilder moving average has exactly that update rule.
        self.atr = WilderMovingAverage(14)
        self.days: list[Daily] = []
        self.pivot_highs: list[tuple[int, float, float]] = []
        self.pivot_lows: list[tuple[int, float, float]] = []
        self.trend = 0
        self.entries: set = set()
        self.waiting: list[WaitingSignal] = []
        self.active_entry_id = None
        self.opened_ns: int | None = None
        self.slot_violations = 0
        self.signals = 0
        self.signals_while_open = 0
        self.waiting_voided = 0
        self.waiting_released = 0

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.instrument_id)
        if self.instrument is None:
            raise RuntimeError(f"missing instrument {self.instrument_id}")
        self.subscribe_bars(self.minute_bar_type)
        self.subscribe_bars(
            BarType.from_str(f"{self.daily_bar_type}@1-MINUTE-EXTERNAL"),
        )

    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type == self.minute_bar_type:
            self._advance_waiting(bar)
            return
        if bar.bar_type == self.daily_bar_type:
            self._on_daily_bar(bar)

    def _on_daily_bar(self, bar: Bar) -> None:
        day = Daily(*(float(x) for x in (bar.open, bar.high, bar.low, bar.close)))
        previous_close = self.days[-1].close if self.days else day.close
        true_range = max(
            day.high - day.low,
            abs(day.high - previous_close),
            abs(day.low - previous_close),
        )
        self.days.append(day)
        self.atr.update_raw(true_range)
        i = len(self.days) - 1
        if self.opened_ns is not None and bar.ts_event >= self.opened_ns + HOLD_DAYS * DAY_NS:
            self.cancel_all_orders(self.instrument_id)
            self.close_all_positions(self.instrument_id)
        if i < 2 * K + 21 or not self.atr.initialized:
            return

        self._confirm_pivot(i)

        prev = self.days[i - 1]
        body = abs(day.close - day.open)
        prior_median = median(abs(x.close - x.open) for x in self.days[i - 20 : i])
        big = body >= BODY_X * prior_median
        big2 = abs(day.close - prev.open) >= 2 * BODY_X * prior_median
        strong_up = (day.close > day.open and big) or (day.close > prev.open and big2)
        strong_down = (day.close < day.open and big) or (day.close < prev.open and big2)

        crossed_highs = (
            [p for p in self.pivot_highs if prev.close <= p[1] < day.close] if strong_up else []
        )
        crossed_lows = (
            [p for p in self.pivot_lows if day.close < p[1] <= prev.close] if strong_down else []
        )
        if (
            self.pivot_highs
            and strong_up
            and day.close > self.pivot_highs[-1][1]
            and self.trend != 1
        ):
            self.trend = 1
        elif (
            self.pivot_lows
            and strong_down
            and day.close < self.pivot_lows[-1][1]
            and self.trend != -1
        ):
            self.trend = -1

        for _, level, edge in crossed_highs if self.trend == 1 else []:
            self._arm(bar.ts_event, 1, level, edge)
        for _, level, edge in crossed_lows if self.trend == -1 else []:
            self._arm(bar.ts_event, -1, level, edge)

    def _confirm_pivot(self, i: int) -> None:
        j = i - K
        window = self.days[j - K : j + K + 1]
        pivot = self.days[j]
        if pivot.high == max(day.high for day in window):
            self.pivot_highs.append((j, pivot.high, max(pivot.open, pivot.close)))
        if pivot.low == min(day.low for day in window):
            self.pivot_lows.append((j, pivot.low, min(pivot.open, pivot.close)))

    def _arm(self, ts_event: int, side: int, level: float, edge: float) -> None:
        atr = self.atr.value
        zone = max(edge, level - atr) if side == 1 else min(edge, level + atr)
        stop = zone - side * STOP_BUFFER_ATR * atr
        if (level - stop) * side <= 0:
            return
        target = level + side * 2 * abs(level - stop)
        signal = WaitingSignal(ts_event, side, level, stop, target)
        if self.opened_ns is not None:
            self.signals_while_open += 1
            self.waiting.append(signal)
            return
        self._submit_signal(signal)

    def _advance_waiting(self, bar: Bar) -> None:
        if not self.waiting:
            return
        remaining = []
        for signal in self.waiting:
            if bar.ts_event >= signal.armed_ns + VALID_DAYS * DAY_NS:
                continue
            touched = (
                float(bar.low) <= signal.level
                if signal.side == 1
                else float(bar.high) >= signal.level
            )
            if bar.ts_event > signal.armed_ns and touched:
                # The first touch occurred while this coin's slot was occupied.
                # Native matching still owns fills for every submitted order.
                self.waiting_voided += 1
                continue
            remaining.append(signal)
        self.waiting = remaining
        if self.opened_ns is None:
            for signal in self.waiting:
                self._submit_signal(signal)
                self.waiting_released += 1
            self.waiting.clear()

    def _submit_signal(self, signal: WaitingSignal) -> None:
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY if signal.side == 1 else OrderSide.SELL,
            quantity=self.trade_size,
            entry_order_type=OrderType.LIMIT,
            entry_price=self.instrument.make_price(signal.level),
            time_in_force=TimeInForce.GTD,
            expire_time=signal.armed_ns + VALID_DAYS * DAY_NS,
            tp_price=self.instrument.make_price(signal.target),
            tp_post_only=False,
            sl_trigger_price=self.instrument.make_price(signal.stop),
        )
        self.entries.add(orders[0].client_order_id)
        self.signals += 1
        self.submit_order_list(orders)

    def on_order_filled(self, event) -> None:
        if event.client_order_id not in self.entries:
            return
        if self.active_entry_id is not None and event.client_order_id != self.active_entry_id:
            self.slot_violations += 1
            self.log.error("R-1 slot violation: more than one entry filled")
        if self.opened_ns is None:
            self.opened_ns = event.ts_event
            self.active_entry_id = event.client_order_id
        for entry_id in tuple(self.entries):
            if entry_id != event.client_order_id:
                self.cancel_order(entry_id)

    def on_position_closed(self, event) -> None:
        if self.active_entry_id is not None:
            self.entries.discard(self.active_entry_id)
        self.opened_ns = None
        self.active_entry_id = None

    def on_order_canceled(self, event) -> None:
        self.entries.discard(event.client_order_id)

    def on_order_expired(self, event) -> None:
        self.entries.discard(event.client_order_id)

    def on_order_rejected(self, event) -> None:
        self.entries.discard(event.client_order_id)
        self.log.error(f"R-1 order rejected: {event}")
