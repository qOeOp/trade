"""
Native staged exits for R-1s daily pivots and H11 four-hour range edges.

Nautilus orders, fills, cache positions and Portfolio remain the facts. The Strategy
retains only signal intent, order IDs and native-event progress.

"""

from __future__ import annotations

from decimal import ROUND_FLOOR

from strategy import DAY_NS
from strategy import FOUR_HOUR_NS
from strategy import STOP_BUFFER_ATR
from strategy import VALID_DAYS
from strategy import R1Strategy
from strategy import WaitingSignal

from vibe_trading.core import UUID4
from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import ContingencyType
from vibe_trading.model import InstrumentId
from vibe_trading.model import LimitOrder
from vibe_trading.model import OrderSide
from vibe_trading.model import Quantity
from vibe_trading.model import StopMarketOrder
from vibe_trading.model import StrategyId
from vibe_trading.model import TimeInForce
from vibe_trading.model import TriggerType


class R1StagedStrategy(R1Strategy):
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
        signal_variant: str = "daily-pivot",
    ) -> None:
        if signal_variant not in ("daily-pivot", "box-edge-4h"):
            raise ValueError("staged exits require daily pivots or four-hour range edges")
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
            signal_variant,
        )
        self.staged_entry_id = None
        self.staged_stop_id = None
        self.staged_first_id = None
        self.staged_last_id = None
        self.staged_signal: WaitingSignal | None = None
        self.staged_cleanup_pending = False
        self.staged_missing_impulse = 0
        self.staged_split_skips = 0
        self.staged_invalid_price_skips = 0
        self.staged_invalid_notional_skips = 0
        self.staged_invalid_actual_target_closes = 0
        self.staged_unallocatable_closes = 0
        self.staged_protection_failures = 0
        self.staged_order_failures = 0
        self.staged_same_bar_first_stop = 0
        self.staged_breakeven_unavailable = 0
        self.staged_stop_cancel_emergencies = 0
        self.staged_keep_original_stop = False
        self.staged_emergency_pending = False
        self.staged_emergency_close_sent = False
        self.staged_emergency_closes = 0

    def _frozen_impulse(self, side: int) -> float:
        opposite = self.pivot_lows if side == 1 else self.pivot_highs
        if not opposite:
            self.staged_missing_impulse += 1
            return 0.0
        index, pivot_price, _ = opposite[-1]
        extrema = self.days[index:]
        extreme = max(day.high for day in extrema) if side == 1 else min(day.low for day in extrema)
        return abs(extreme - pivot_price)

    def _arm(self, ts_event: int, side: int, level: float, edge: float) -> None:
        if self.trade_start_ns is not None and ts_event < self.trade_start_ns:
            return
        atr = self.atr.value
        zone = max(edge, level - atr) if side == 1 else min(edge, level + atr)
        stop = zone - side * STOP_BUFFER_ATR * atr
        if (level - stop) * side <= 0:
            return
        target = level + side * 2 * abs(level - stop)
        self.waiting.append(
            WaitingSignal(
                ts_event,
                ts_event + VALID_DAYS * DAY_NS,
                side,
                level,
                stop,
                target,
                self._frozen_impulse(side),
            ),
        )
        self.signals += 1
        if self.opened_ns is not None:
            self.signals_while_open += 1

    def _split_quantity(self, quantity: Quantity) -> tuple[Quantity, Quantity] | None:
        step = self.instrument.size_increment.as_decimal()
        units = (quantity.as_decimal() / step).to_integral_value(rounding=ROUND_FLOOR)
        first_units = int(units) // 2
        if first_units < 1:
            return None
        precision = self.instrument.size_precision
        first = Quantity.from_str(f"{first_units * step:.{precision}f}")
        last = Quantity.from_str(f"{(int(units) - first_units) * step:.{precision}f}")
        minimum = self.instrument.min_quantity
        if minimum is not None and (
            first.as_decimal() < minimum.as_decimal() or last.as_decimal() < minimum.as_decimal()
        ):
            return None
        return first, last

    def _meets_min_notional(self, price_sizes: tuple[tuple[float, Quantity], ...]) -> bool:
        minimum = self.instrument.min_notional
        if minimum is None:
            return True
        multiplier = self.instrument.multiplier.as_decimal()
        return all(
            self.instrument.make_price(price).as_decimal() * size.as_decimal() * multiplier
            >= minimum.as_decimal()
            for price, size in price_sizes
        )

    def _exit_targets(
        self,
        signal: WaitingSignal,
        entry_price: float,
    ) -> tuple[float, float] | None:
        if self.signal_variant == "box-edge-4h":
            entry = self.instrument.make_price(entry_price).as_double()
            stop = self.instrument.make_price(signal.stop).as_double()
            risk = signal.side * (entry - stop)
            if risk <= 0:
                return None
            first = self.instrument.make_price(entry + signal.side * risk).as_double()
            last = self.instrument.make_price(signal.target).as_double()
            if (
                first <= 0
                or last <= 0
                or signal.side * (first - entry) <= 0
                or signal.side * (last - first) < 0
            ):
                return None
            return first, last
        impulse_target = entry_price + signal.side * signal.impulse
        last = (
            impulse_target if signal.side * (impulse_target - signal.target) > 0 else signal.target
        )
        return signal.target, last

    def _release_waiting(self, reference_price: float) -> None:
        if self.staged_cleanup_pending:
            return
        super()._release_waiting(reference_price)

    def _submit_signal(self, signal: WaitingSignal) -> None:
        quantity = self._order_quantity(signal)
        if quantity is None:
            return
        split = self._split_quantity(quantity)
        if split is None:
            self.staged_split_skips += 1
            return
        first_qty, last_qty = split
        targets = self._exit_targets(signal, signal.level)
        if targets is None:
            self.staged_invalid_price_skips += 1
            return
        first_target, last_target = targets
        if any(
            self.instrument.make_price(value).as_double() <= 0
            for value in (signal.level, signal.stop, first_target, last_target)
        ):
            self.staged_invalid_price_skips += 1
            return
        if not self._meets_min_notional(
            (
                (signal.level, quantity),
                (signal.stop, quantity),
                (first_target, first_qty),
                (last_target, last_qty),
            ),
        ):
            self.staged_invalid_notional_skips += 1
            return
        if self.staged_entry_id is not None:
            raise RuntimeError("R-1s still owns an earlier native order group")

        factory = self.order_factory
        entry_id = factory.generate_client_order_id()
        stop_id = factory.generate_client_order_id()
        order_list_id = factory.generate_order_list_id()
        side = OrderSide.BUY if signal.side == 1 else OrderSide.SELL
        close_side = OrderSide.SELL if signal.side == 1 else OrderSide.BUY
        ts = self.clock.timestamp_ns()
        entry = LimitOrder(
            factory.trader_id,
            factory.strategy_id,
            self.instrument_id,
            entry_id,
            side,
            quantity,
            self.instrument.make_price(signal.level),
            TimeInForce.GTD,
            False,
            False,
            False,
            UUID4(),
            ts,
            expire_time=signal.expires_ns,
            contingency_type=ContingencyType.OTO,
            order_list_id=order_list_id,
            linked_order_ids=[stop_id],
        )
        stop = StopMarketOrder(
            factory.trader_id,
            factory.strategy_id,
            self.instrument_id,
            stop_id,
            close_side,
            quantity,
            self.instrument.make_price(signal.stop),
            TriggerType.DEFAULT,
            TimeInForce.GTC,
            True,
            False,
            UUID4(),
            ts,
            order_list_id=order_list_id,
            parent_order_id=entry_id,
        )
        self.staged_entry_id = entry_id
        self.staged_stop_id = stop_id
        self.staged_signal = signal
        self.resting_entry_id = entry_id
        self.resting_signal = signal
        self.entries.add(entry_id)
        self.submit_order_list([entry, stop])

    def _position(self):
        if self.staged_entry_id is None:
            return None
        return self.cache.position_for_order(self.staged_entry_id)

    def _cancel_open(self, order_ids) -> None:
        for order_id in order_ids:
            if order_id is None:
                continue
            order = self.cache.order(order_id)
            if order is not None and order.is_open and not order.is_pending_cancel:
                self.cancel_order(order_id)

    def _first_complete(self) -> bool:
        if self.staged_first_id is None:
            return False
        first = self.cache.order(self.staged_first_id)
        return first is not None and first.filled_qty == first.quantity

    def _emergency_close(self) -> None:
        if self.staged_emergency_close_sent:
            return
        position = self._position()
        if position is None or not position.is_open:
            return
        self.staged_emergency_pending = True
        ids = (self.staged_entry_id, self.staged_first_id, self.staged_last_id)
        self._cancel_open(ids)
        if any(
            order_id is not None
            and (order := self.cache.order(order_id)) is not None
            and not order.is_closed
            for order_id in ids
        ):
            return
        self.staged_emergency_close_sent = True
        self.staged_emergency_closes += 1
        self.close_all_positions(self.instrument_id)

    def _close_after_exit_guard(self) -> None:
        if self.signal_variant == "box-edge-4h":
            self._emergency_close()
        else:
            self.close_all_positions(self.instrument_id)

    def _sync_stop(self) -> None:
        if (
            self.staged_cleanup_pending
            or self.staged_emergency_pending
            or self.staged_stop_id is None
        ):
            return
        position = self._position()
        if position is None or not position.is_open:
            return
        stop = self.cache.order(self.staged_stop_id)
        if stop is None or stop.is_closed:
            if self.signal_variant == "box-edge-4h":
                self.staged_stop_cancel_emergencies += 1
                self._emergency_close()
            else:
                self.staged_protection_failures += 1
                self.close_all_positions(self.instrument_id)
            return
        if stop.is_pending_update or stop.is_pending_cancel:
            return
        desired_size = stop.filled_qty.as_decimal() + position.quantity.as_decimal()
        desired_quantity = Quantity.from_str(
            f"{desired_size:.{self.instrument.size_precision}f}",
        )
        trigger_value = (
            position.avg_px_open
            if self._first_complete() and not self.staged_keep_original_stop
            else self.staged_signal.stop
        )
        desired_trigger = self.instrument.make_price(trigger_value)
        if stop.quantity != desired_quantity or stop.trigger_price != desired_trigger:
            self.modify_order(
                self.staged_stop_id,
                quantity=desired_quantity,
                trigger_price=desired_trigger,
            )

    def _activate_exits(self) -> None:
        if (
            self.staged_entry_id is None
            or self.staged_first_id is not None
            or self.staged_emergency_pending
        ):
            return
        entry = self.cache.order(self.staged_entry_id)
        position = self._position()
        if entry is None or not entry.is_closed or position is None or not position.is_open:
            return
        stop = self.cache.order(self.staged_stop_id)
        if (
            stop is None
            or not stop.is_open
            or stop.is_pending_update
            or stop.leaves_qty != position.quantity
        ):
            self._sync_stop()
            return
        split = self._split_quantity(position.quantity)
        if split is None:
            self.staged_unallocatable_closes += 1
            self._close_after_exit_guard()
            return
        first_qty, last_qty = split
        signal = self.staged_signal
        targets = self._exit_targets(signal, position.avg_px_open)
        if targets is None:
            self.staged_invalid_actual_target_closes += 1
            self._close_after_exit_guard()
            return
        first_target, last_target = targets
        if any(self.instrument.make_price(value).as_double() <= 0 for value in targets):
            self.staged_invalid_actual_target_closes += 1
            self._close_after_exit_guard()
            return
        if not self._meets_min_notional(
            ((first_target, first_qty), (last_target, last_qty)),
        ):
            self.staged_invalid_actual_target_closes += 1
            self._close_after_exit_guard()
            return
        close_side = OrderSide.SELL if signal.side == 1 else OrderSide.BUY
        first = self.order_factory.limit(
            self.instrument_id,
            close_side,
            first_qty,
            self.instrument.make_price(first_target),
            reduce_only=True,
        )
        last = self.order_factory.limit(
            self.instrument_id,
            close_side,
            last_qty,
            self.instrument.make_price(last_target),
            reduce_only=True,
        )
        self.staged_first_id = first.client_order_id
        self.staged_last_id = last.client_order_id
        self.submit_order(first, position_id=position.id)
        self.submit_order(last, position_id=position.id)

    def _finish_cleanup(self) -> None:
        if not self.staged_cleanup_pending:
            return
        position = self._position()
        if position is not None and position.is_open:
            return
        ids = (
            self.staged_entry_id,
            self.staged_stop_id,
            self.staged_first_id,
            self.staged_last_id,
        )
        if any(
            order_id is not None
            and (order := self.cache.order(order_id)) is not None
            and not order.is_closed
            for order_id in ids
        ):
            return
        self.staged_entry_id = None
        self.staged_stop_id = None
        self.staged_first_id = None
        self.staged_last_id = None
        self.staged_signal = None
        self.staged_cleanup_pending = False
        self.staged_keep_original_stop = False
        self.staged_emergency_pending = False
        self.staged_emergency_close_sent = False
        if self.reference_price is not None:
            self._release_waiting(self.reference_price)

    def on_bar(self, bar: Bar) -> None:
        super().on_bar(bar)
        if bar.bar_type == self.minute_bar_type:
            self._sync_stop()
            self._activate_exits()

    def _on_four_hour_bar(self, bar: Bar) -> None:
        if (
            self.signal_variant == "box-edge-4h"
            and self.opened_ns is not None
            and bar.ts_event >= self.opened_ns + 30 * FOUR_HOUR_NS
        ):
            self.staged_emergency_pending = True
            self.staged_emergency_close_sent = True
        super()._on_four_hour_bar(bar)

    def on_order_filled(self, event) -> None:
        order_id = event.client_order_id
        if order_id == self.staged_entry_id:
            super().on_order_filled(event)
            self._sync_stop()
            entry = self.cache.order(order_id)
            if entry.is_closed:
                self._activate_exits()
            elif not entry.is_pending_cancel:
                self.cancel_order(order_id)
            return
        if order_id == self.staged_stop_id:
            first = self.cache.order(self.staged_first_id) if self.staged_first_id else None
            if (
                first is not None
                and first.filled_qty.as_decimal() > 0
                and first.ts_last == event.ts_event
            ):
                self.staged_same_bar_first_stop += 1
            self._cancel_open((self.staged_first_id, self.staged_last_id))
            self._sync_stop()
        elif order_id in (self.staged_first_id, self.staged_last_id):
            self._sync_stop()
        if self.staged_emergency_pending:
            self._emergency_close()

    def on_order_accepted(self, event) -> None:
        if event.client_order_id == self.staged_stop_id:
            self._sync_stop()
            self._activate_exits()

    def on_order_updated(self, event) -> None:
        if event.client_order_id == self.staged_stop_id:
            self._sync_stop()
            self._activate_exits()

    def on_order_canceled(self, event) -> None:
        entry_canceled = event.client_order_id == self.staged_entry_id
        if entry_canceled and self.active_entry_id is None:
            self.staged_cleanup_pending = True
        super().on_order_canceled(event)
        if entry_canceled:
            if self.active_entry_id is not None:
                self._sync_stop()
                self._activate_exits()
            else:
                self._cancel_open((self.staged_stop_id,))
        if event.client_order_id == self.staged_stop_id and self.signal_variant == "box-edge-4h":
            self._sync_stop()
        if self.staged_emergency_pending:
            self._emergency_close()
        self._finish_cleanup()

    def on_order_expired(self, event) -> None:
        entry_expired = event.client_order_id == self.staged_entry_id
        if entry_expired and self.active_entry_id is None:
            self.staged_cleanup_pending = True
        super().on_order_expired(event)
        if entry_expired:
            if self.active_entry_id is not None:
                self._sync_stop()
                self._activate_exits()
            else:
                self._cancel_open((self.staged_stop_id,))
        if self.staged_emergency_pending:
            self._emergency_close()
        self._finish_cleanup()

    def on_order_rejected(self, event) -> None:
        order_id = event.client_order_id
        if order_id == self.staged_entry_id:
            self.staged_cleanup_pending = True
            self._cancel_open((self.staged_stop_id,))
        elif order_id in (self.staged_stop_id, self.staged_first_id, self.staged_last_id):
            self.staged_order_failures += 1
            if order_id == self.staged_stop_id:
                self.staged_protection_failures += 1
            self._cancel_open((self.staged_entry_id,))
            if self.signal_variant == "box-edge-4h":
                self._emergency_close()
            else:
                self.close_all_positions(self.instrument_id)
        elif self.staged_emergency_close_sent and self.signal_variant == "box-edge-4h":
            self.staged_order_failures += 1
        super().on_order_rejected(event)
        if self.staged_emergency_pending:
            self._emergency_close()
        self._finish_cleanup()

    def on_order_denied(self, event) -> None:
        order_id = event.client_order_id
        if order_id == self.staged_entry_id:
            self.staged_cleanup_pending = True
            self._cancel_open((self.staged_stop_id,))
        elif order_id in (self.staged_stop_id, self.staged_first_id, self.staged_last_id):
            self.staged_order_failures += 1
            if order_id == self.staged_stop_id:
                self.staged_protection_failures += 1
            self._cancel_open((self.staged_entry_id,))
            if self.signal_variant == "box-edge-4h":
                self._emergency_close()
            else:
                self.close_all_positions(self.instrument_id)
        elif self.staged_emergency_close_sent and self.signal_variant == "box-edge-4h":
            self.staged_order_failures += 1
        super().on_order_denied(event)
        if self.staged_emergency_pending:
            self._emergency_close()
        self._finish_cleanup()

    def on_order_modify_rejected(self, event) -> None:
        if event.client_order_id == self.staged_stop_id:
            stop = self.cache.order(self.staged_stop_id)
            if self.signal_variant == "box-edge-4h" and stop is not None and stop.is_open:
                self.staged_breakeven_unavailable += 1
                self.staged_keep_original_stop = True
                self._sync_stop()
            else:
                if self.signal_variant == "box-edge-4h":
                    self.staged_stop_cancel_emergencies += 1
                    self._emergency_close()
                else:
                    self.staged_protection_failures += 1
                    self.staged_order_failures += 1
                    self.close_all_positions(self.instrument_id)
        self.log.error(f"R-1s order modification rejected: {event}")

    def on_position_closed(self, event) -> None:
        self.staged_cleanup_pending = True
        super().on_position_closed(event)
        self._cancel_open(
            (
                self.staged_entry_id,
                self.staged_stop_id,
                self.staged_first_id,
                self.staged_last_id,
            ),
        )
        self._finish_cleanup()
