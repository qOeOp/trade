"""H29a: native next-bar stop entry after a completed failed lower-box break."""

from __future__ import annotations

from nautilus_trader.model import Bar, OrderSide, OrderType, TimeInForce

from stop_entry import with_buy_stop_parent
from strategy import (
    FOUR_HOUR_NS,
    STOP_BUFFER_ATR,
    FourHour,
    R1Strategy,
    WaitingSignal,
    _confirmed_box_edges,
)


class FailedRangeBreakoutStrategy(R1Strategy):
    """Own the H29a source selection; let Nautilus own orders, fills and PnL."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant != "box-failed-breakout-4h":
            raise ValueError("H29a requires its registered signal variant")
        self.failed_range_valid_signals = 0
        self.failed_range_occupied_skips = 0
        self.failed_range_submitted_brackets = 0
        self.failed_range_invalid_price_skips = 0

    def _queue_four_hour_candidate(self, candle: FourHour) -> None:
        # H29a computes the plan before the current candle updates ATR/history.
        pass

    def _on_four_hour_bar(self, bar: Bar) -> None:
        candidate = self._candidate_before_update(bar)
        super()._on_four_hour_bar(bar)
        if candidate is None or (
            self.trade_start_ns is not None and bar.ts_event < self.trade_start_ns
        ):
            return
        self.signals += 1
        self.failed_range_valid_signals += 1
        if (
            self.opened_ns is not None
            or self.resting_entry_id is not None
            or self.canceling_entry_id is not None
        ):
            self.failed_range_occupied_skips += 1
            if self.opened_ns is not None:
                self.signals_while_open += 1
            return
        quantity = self._order_quantity(candidate)
        if quantity is None:
            return
        trigger = self.instrument.make_price(candidate.level)
        stop = self.instrument.make_price(candidate.stop)
        target = self.instrument.make_price(candidate.target)
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY,
            quantity=quantity,
            entry_order_type=OrderType.LIMIT,
            entry_price=trigger,
            time_in_force=TimeInForce.GTD,
            expire_time=candidate.expires_ns,
            tp_price=target,
            tp_post_only=False,
            sl_trigger_price=stop,
        )
        orders = with_buy_stop_parent(
            orders,
            self.instrument_id,
            quantity,
            trigger,
            candidate.expires_ns,
            self.clock.timestamp_ns(),
        )
        self.resting_entry_id = orders[0].client_order_id
        self.resting_signal = candidate
        self.entries.add(self.resting_entry_id)
        self.submit_order_list(orders)
        self.waiting_released += 1
        self.failed_range_submitted_brackets += 1

    def _candidate_before_update(self, bar: Bar) -> WaitingSignal | None:
        if not self.atr.initialized:
            return None
        candle = FourHour(bar.ts_event, float(bar.high), float(bar.low), float(bar.close))
        box = _confirmed_box_edges(self.four_hour_history, candle, self.atr.value)
        if box is None:
            return None
        upper, lower, _, _ = box
        opening = float(bar.open)
        span = candle.high - candle.low
        if not (
            candle.low < lower
            and candle.close > lower
            and span > 0
            and candle.close > opening
            and candle.close >= candle.low + 0.75 * span
        ):
            return None
        trigger = self.instrument.make_price(
            candle.high + self.instrument.price_increment.as_double(),
        )
        stop = self.instrument.make_price(candle.low - STOP_BUFFER_ATR * self.atr.value)
        target = self.instrument.make_price((upper + lower) / 2)
        entry_px, stop_px, target_px = (
            price.as_double() for price in (trigger, stop, target)
        )
        if not (0 < stop_px < entry_px < target_px and entry_px > candle.high):
            self.failed_range_invalid_price_skips += 1
            return None
        return WaitingSignal(
            candle.ts_event,
            candle.ts_event + FOUR_HOUR_NS,
            1,
            entry_px,
            stop_px,
            target_px,
        )
