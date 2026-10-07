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
from vibe_trading.model import StrategyId
from vibe_trading.model import TimeInForce
from vibe_trading.trading import Strategy
from vibe_trading.trading import StrategyConfig


K = 3
BODY_X = 1.5
VALID_DAYS = 10
HOLD_DAYS = 60
STOP_BUFFER_ATR = 0.25
DAY_NS = 86_400_000_000_000
MILLISECOND_NS = 1_000_000


def daily_available_ns(ts_event: int) -> int:
    """
    Normalize external 23:59:59.999 and internal 00:00 daily closes.
    """
    return ts_event + MILLISECOND_NS if ts_event % DAY_NS == DAY_NS - MILLISECOND_NS else ts_event


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
        trade_start_ns: int | None = None,
        historical_daily_bars: list[Bar] | None = None,
        execution_bar_minutes: int = 1,
        strategy_id: StrategyId | None = None,
        risk_budget_fraction: float | None = None,
        max_coin_notional_fraction: float = 0.05,
    ):
        return super().__new__(cls)

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
    ) -> None:
        super().__init__(
            StrategyConfig(strategy_id=strategy_id) if strategy_id else None,
        )
        self.instrument_id = instrument_id
        self.daily_bar_type = daily_bar_type
        self.minute_bar_type = BarType.from_str(
            f"{instrument_id}-{execution_bar_minutes}-MINUTE-LAST-EXTERNAL",
        )
        self.execution_bar_minutes = execution_bar_minutes
        self.trade_size = trade_size
        if risk_budget_fraction is not None and not 0 < risk_budget_fraction < 1:
            raise ValueError("risk budget fraction must be between zero and one")
        if not 0 < max_coin_notional_fraction <= 1:
            raise ValueError("coin notional cap must be between zero and one")
        self.risk_budget_fraction = risk_budget_fraction
        self.max_coin_notional_fraction = max_coin_notional_fraction
        self.risk_size_skips = 0
        self.trade_start_ns = trade_start_ns
        self.historical_daily_bars = historical_daily_bars or []
        # Source atr_of uses ewm(alpha=1/14, adjust=False), seeded by first TR.
        # The native Wilder moving average has exactly that update rule.
        self.atr = WilderMovingAverage(14)
        self.days: list[Daily] = []
        self.last_daily_ns: int | None = None
        self.pivot_highs: list[tuple[int, float, float]] = []
        self.pivot_lows: list[tuple[int, float, float]] = []
        self.trend = 0
        self.entries: set = set()
        self.waiting: list[WaitingSignal] = []
        self.resting_entry_id = None
        self.resting_signal: WaitingSignal | None = None
        self.canceling_entry_id = None
        self.canceling_signal: WaitingSignal | None = None
        self.reference_price: float | None = None
        self.active_entry_id = None
        self.opened_ns: int | None = None
        self.slot_violations = 0
        self.signals = 0
        self.signals_while_open = 0
        self.waiting_voided = 0
        self.waiting_released = 0
        self.breaks_in_trade_window = 0
        self.trend_aligned_breaks_in_trade_window = 0

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.instrument_id)
        if self.instrument is None:
            raise RuntimeError(f"missing instrument {self.instrument_id}")
        self.subscribe_bars(self.minute_bar_type)
        self.subscribe_bars(
            BarType.from_str(
                f"{self.daily_bar_type}@{self.execution_bar_minutes}-MINUTE-EXTERNAL",
            ),
        )
        for bar in self.historical_daily_bars:
            self._on_daily_bar(bar)
        self.historical_daily_bars.clear()

    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type == self.minute_bar_type:
            self._advance_waiting(bar)
            return
        if bar.bar_type == self.daily_bar_type:
            self._on_daily_bar(bar)

    def _on_daily_bar(self, bar: Bar) -> None:
        self.last_daily_ns = bar.ts_event
        available_ns = daily_available_ns(bar.ts_event)
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

        if self.trade_start_ns is None or available_ns >= self.trade_start_ns:
            self.breaks_in_trade_window += len(crossed_highs) + len(crossed_lows)
            self.trend_aligned_breaks_in_trade_window += (
                len(crossed_highs) if self.trend == 1 else 0
            ) + (len(crossed_lows) if self.trend == -1 else 0)

        for _, level, edge in crossed_highs if self.trend == 1 else []:
            self._arm(available_ns, 1, level, edge)
        for _, level, edge in crossed_lows if self.trend == -1 else []:
            self._arm(available_ns, -1, level, edge)
        self._release_waiting(day.close)

    def _confirm_pivot(self, i: int) -> None:
        j = i - K
        window = self.days[j - K : j + K + 1]
        pivot = self.days[j]
        if pivot.high == max(day.high for day in window):
            self.pivot_highs.append((j, pivot.high, max(pivot.open, pivot.close)))
        if pivot.low == min(day.low for day in window):
            self.pivot_lows.append((j, pivot.low, min(pivot.open, pivot.close)))

    def _arm(self, ts_event: int, side: int, level: float, edge: float) -> None:
        if self.trade_start_ns is not None and ts_event < self.trade_start_ns:
            return
        atr = self.atr.value
        zone = max(edge, level - atr) if side == 1 else min(edge, level + atr)
        stop = zone - side * STOP_BUFFER_ATR * atr
        if (level - stop) * side <= 0:
            return
        target = level + side * 2 * abs(level - stop)
        signal = WaitingSignal(ts_event, side, level, stop, target)
        self.signals += 1
        if self.opened_ns is not None:
            self.signals_while_open += 1
        self.waiting.append(signal)

    def _advance_waiting(self, bar: Bar) -> None:
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
                # An unsubmitted candidate's first touch has passed. It cannot
                # become a new resting order after seeing the touch.
                self.waiting_voided += 1
                continue
            remaining.append(signal)
        self.waiting = remaining
        self._release_waiting(float(bar.close))

    def _release_waiting(self, reference_price: float) -> None:
        self.reference_price = reference_price
        now_ns = self.clock.timestamp_ns()
        self.waiting = [
            signal for signal in self.waiting if now_ns < signal.armed_ns + VALID_DAYS * DAY_NS
        ]
        if self.opened_ns is not None or self.canceling_entry_id is not None:
            return
        candidates = self.waiting + (
            [self.resting_signal] if self.resting_signal is not None else []
        )
        if not candidates:
            return
        # A bar's matching pass collects eligible same-side orders before the
        # first fill callback. Resting multiple entry brackets can therefore
        # fill more than once despite canceling siblings in on_order_filled.
        # Keep one native entry bracket live and retain untouched alternatives.
        candidate = min(
            candidates,
            key=lambda signal: (
                abs(reference_price - signal.level),
                signal.armed_ns,
                signal.level,
            ),
        )
        if candidate == self.resting_signal:
            return
        if self.resting_entry_id is not None:
            # Wait for the native cancellation event before submitting the
            # closer candidate; the old bracket may still be executable.
            self.canceling_entry_id = self.resting_entry_id
            self.canceling_signal = self.resting_signal
            self.waiting.append(self.resting_signal)
            self.resting_entry_id = None
            self.resting_signal = None
            self.cancel_order(self.canceling_entry_id)
            return
        self.waiting.remove(candidate)
        self._submit_signal(candidate)
        self.waiting_released += 1

    def _submit_signal(self, signal: WaitingSignal) -> None:
        quantity = self._order_quantity(signal)
        if quantity is None:
            return
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY if signal.side == 1 else OrderSide.SELL,
            quantity=quantity,
            entry_order_type=OrderType.LIMIT,
            entry_price=self.instrument.make_price(signal.level),
            time_in_force=TimeInForce.GTD,
            expire_time=signal.armed_ns + VALID_DAYS * DAY_NS,
            tp_price=self.instrument.make_price(signal.target),
            tp_post_only=False,
            sl_trigger_price=self.instrument.make_price(signal.stop),
        )
        self.resting_entry_id = orders[0].client_order_id
        self.resting_signal = signal
        self.entries.add(self.resting_entry_id)
        self.submit_order_list(orders)

    def _order_quantity(self, signal: WaitingSignal) -> Quantity | None:
        if self.risk_budget_fraction is None:
            return self.trade_size
        equity_by_currency = self.portfolio.equity(venue=self.instrument_id.venue)
        equity_money = equity_by_currency.get(self.instrument.quote_currency)
        if equity_money is None or equity_money.as_double() <= 0:
            raise RuntimeError(
                f"missing positive native equity for {self.instrument_id}",
            )
        equity = equity_money.as_double()
        multiplier = self.instrument.multiplier.as_double()
        risk_per_unit = abs(signal.level - signal.stop) * multiplier
        notional_per_unit = signal.level * multiplier
        raw_size = min(
            equity * self.risk_budget_fraction / risk_per_unit,
            equity * self.max_coin_notional_fraction / notional_per_unit,
        )
        quantity = self.instrument.make_qty(raw_size, round_down=True)
        minimum_quantity = self.instrument.min_quantity
        minimum_notional = self.instrument.min_notional
        if (
            quantity.as_double() <= 0
            or (
                minimum_quantity is not None
                and quantity.as_decimal() < minimum_quantity.as_decimal()
            )
            or (
                minimum_notional is not None
                and quantity.as_double() * notional_per_unit < minimum_notional.as_double()
            )
        ):
            self.risk_size_skips += 1
            return None
        return quantity

    def on_order_filled(self, event) -> None:
        if event.client_order_id not in self.entries:
            return
        if self.active_entry_id is not None and event.client_order_id != self.active_entry_id:
            self.slot_violations += 1
            self.log.error("R-1 slot violation: more than one entry filled")
        if self.opened_ns is None:
            self.opened_ns = event.ts_event
            self.active_entry_id = event.client_order_id
        self.resting_entry_id = None
        self.resting_signal = None
        if event.client_order_id == self.canceling_entry_id:
            self.canceling_entry_id = None
            if self.canceling_signal in self.waiting:
                self.waiting.remove(self.canceling_signal)
            self.canceling_signal = None

    def on_position_closed(self, event) -> None:
        if self.active_entry_id is not None:
            self.entries.discard(self.active_entry_id)
        self.opened_ns = None
        self.active_entry_id = None

    def on_order_canceled(self, event) -> None:
        self.entries.discard(event.client_order_id)
        if event.client_order_id == self.canceling_entry_id:
            self.canceling_entry_id = None
            self.canceling_signal = None
            if self.reference_price is not None:
                self._release_waiting(self.reference_price)
        if event.client_order_id == self.resting_entry_id:
            self.resting_entry_id = None
            self.resting_signal = None

    def on_order_expired(self, event) -> None:
        self.entries.discard(event.client_order_id)
        if event.client_order_id == self.resting_entry_id:
            self.resting_entry_id = None
            self.resting_signal = None

    def on_order_rejected(self, event) -> None:
        self.entries.discard(event.client_order_id)
        if event.client_order_id == self.resting_entry_id:
            self.resting_entry_id = None
            self.resting_signal = None
        self.log.error(f"R-1 order rejected: {event}")

    def on_order_denied(self, event) -> None:
        self.entries.discard(event.client_order_id)
        if event.client_order_id == self.resting_entry_id:
            self.resting_entry_id = None
            self.resting_signal = None
        self.log.error(f"R-1 order denied: {event}")
