"""
Budgeted pullback tiers using native Nautilus contingent order lists.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

from broad_swing_signal import BroadSwingPullback
from retracement_strategy import ConfirmedSupportPullback
from retracement_strategy import RetracementPlan
from strategy import FOUR_HOUR_NS
from strategy import FourHour
from strategy import R1Strategy
from trendline_strategy import MAX_LINE_EXTENSION
from trendline_strategy import ConfirmedLineSupportTouches
from trendline_strategy import LineCandle

from vibe_trading.model import Bar
from vibe_trading.model import OrderSide
from vibe_trading.model import OrderType
from vibe_trading.model import TimeInForce


THREE_TIER_RATIOS = (0.5, 0.618, 0.764)
DEEP_TIER_RATIOS = (0.618, 0.764)
BROAD_TIER_RATIOS = (0.5, 0.618)
TOTAL_RISK_FRACTION = 0.0025
TOTAL_NOTIONAL_FRACTION = 0.05
LIFETIME_NS = 30 * FOUR_HOUR_NS
BROAD_LIFETIME_NS = 180 * FOUR_HOUR_NS


@dataclass
class TierBundle:
    pair: tuple[int, int]
    entry_ids: tuple
    filled_ids: set
    net_flat: bool = True
    retiring: bool = False
    b_high: float | None = None


class TieredRetracementStrategy(R1Strategy):
    """
    Own one tier bundle while Nautilus owns orders and portfolio state.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant in (
            "support-three-tier-4h",
            "support-three-tier-line-cancel-4h",
        ):
            self.tier_ratios = THREE_TIER_RATIOS
        elif self.signal_variant == "support-deep-two-tier-4h":
            self.tier_ratios = DEEP_TIER_RATIOS
        elif self.signal_variant == "support-broad-two-tier-4h":
            self.tier_ratios = BROAD_TIER_RATIOS
        else:
            raise ValueError("unsupported budgeted tier signal")
        if (
            self.risk_budget_fraction != TOTAL_RISK_FRACTION
            or self.max_coin_notional_fraction != TOTAL_NOTIONAL_FRACTION
        ):
            raise ValueError("budgeted tiers require 25-bp risk and 5% coin notional cap")
        self.broad_enabled = self.signal_variant == "support-broad-two-tier-4h"
        self.bundle_lifetime_ns = BROAD_LIFETIME_NS if self.broad_enabled else LIFETIME_NS
        self.broad_state = BroadSwingPullback() if self.broad_enabled else None
        self.broad_planned_pairs: set[tuple[int, int]] = set()
        self.support_state = (
            None
            if self.broad_enabled
            else ConfirmedSupportPullback(
                timing="confirmed-update",
                support_mode="none",
                entry_ratio=0.5,
                minimum_target_r=0.0,
                stop_at_origin=True,
            )
        )
        self.selected_pair: tuple[int, int] | None = None
        self.bundle: TierBundle | None = None
        self.waiting_plan: RetracementPlan | None = None
        self.release_after_ns: int | None = None
        self.bundle_submissions = 0
        self.bundle_retirements = 0
        self.bundle_supersessions = 0
        self.bundle_cancel_race_fills = 0
        self.bundle_invalid_price_skips = 0
        self.bundle_minimum_skips = 0
        self.bundle_order_failures = 0
        self.line_cancel_enabled = self.signal_variant == "support-three-tier-line-cancel-4h"
        self.line_state = ConfirmedLineSupportTouches() if self.line_cancel_enabled else None
        self.line_frozen_for_position = False
        self.frozen_line: tuple[int, float, float] | None = None
        self.line_break_triggered = False
        self.line_cancel_requested_ids: set = set()
        self.line_snapshots = 0
        self.line_break_events = 0
        self.line_cancel_requests = 0
        self.line_cancel_race_fills = 0

    def _on_four_hour_bar(self, bar: Bar) -> None:
        if self.line_cancel_enabled:
            self.line_state.on_closed(
                LineCandle(
                    bar.ts_event,
                    float(bar.open),
                    float(bar.high),
                    float(bar.low),
                    float(bar.close),
                ),
                None,
            )
            self._cancel_pending_on_frozen_line_break(bar)
        super()._on_four_hour_bar(bar)

    def _freeze_entry_line(self) -> None:
        self.line_frozen_for_position = True
        i = len(self.line_state.candles) - 1
        if i < 0:
            return
        projected = self.line_state._latest_rising_line(i)
        if projected is None:
            return
        (_, j2), p2, slope, _ = projected
        self.frozen_line = (j2, p2, slope)
        self.line_snapshots += 1

    def _cancel_pending_on_frozen_line_break(self, bar: Bar) -> None:
        if (
            not self.line_frozen_for_position
            or self.frozen_line is None
            or self.line_break_triggered
            or self.opened_ns is None
            or bar.ts_event < self.opened_ns + FOUR_HOUR_NS
            or bar.ts_event >= self.opened_ns + LIFETIME_NS
        ):
            return
        bundle = self.bundle
        if bundle is None or bundle.net_flat or bundle.retiring:
            return
        i = len(self.line_state.candles) - 1
        j2, p2, slope = self.frozen_line
        if i - j2 > MAX_LINE_EXTENSION or float(bar.close) >= p2 + slope * (i - j2):
            return
        self.line_break_triggered = True
        self.line_break_events += 1
        for entry_id in bundle.entry_ids:
            if entry_id in bundle.filled_ids:
                continue
            order = self.cache.order(entry_id)
            if order is not None and order.is_open and not order.is_pending_cancel:
                self.cancel_order(entry_id)
                self.line_cancel_requested_ids.add(entry_id)
                self.line_cancel_requests += 1

    def _queue_four_hour_candidate(self, candle: FourHour) -> None:
        if self.broad_enabled:
            self._queue_broad_candidate(candle)
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
                self.waiting_plan = None
                if self.bundle is not None and self.bundle.net_flat:
                    self.bundle_supersessions += 1
                    self.release_after_ns = candle.ts_event
                    self._retire_bundle()
        if plan is None or (
            self.trade_start_ns is not None and candle.ts_event < self.trade_start_ns
        ):
            return
        self.signals += 1
        if self.bundle is not None and not self.bundle.net_flat:
            self.signals_while_open += 1
            return
        self.waiting_plan = plan

    def _queue_broad_candidate(self, candle: FourHour) -> None:
        plan = self.broad_state.on_closed(
            candle,
            self.atr.value if self.atr.initialized else None,
        )
        selected = self.broad_state.last_selected
        if selected is None:
            return
        new_high = selected["b_high"]
        if self.waiting_plan is not None and new_high > self.waiting_plan.b_high:
            self.waiting_plan = None
        if (
            self.bundle is not None
            and self.bundle.net_flat
            and not self.bundle.retiring
            and self.bundle.b_high is not None
            and new_high > self.bundle.b_high
        ):
            self.bundle_supersessions += 1
            self.release_after_ns = candle.ts_event
            self._retire_bundle()
        if plan is None or (
            self.trade_start_ns is not None and candle.ts_event < self.trade_start_ns
        ):
            return
        pair = (plan.a_index, plan.b_index)
        if pair in self.broad_planned_pairs or self.waiting_plan is not None:
            return
        if self.bundle is not None:
            if not self.bundle.net_flat:
                self.signals_while_open += 1
                return
            if not self.bundle.retiring:
                return
        self.broad_planned_pairs.add(pair)
        self.waiting_plan = plan
        self.signals += 1

    def _advance_waiting(self, bar: Bar) -> None:
        plan = self.waiting_plan
        if plan is not None:
            entry = self.instrument.make_price(plan.entry).as_double()
            if bar.ts_event >= plan.ts_event + self.bundle_lifetime_ns:
                self.waiting_plan = None
            elif bar.ts_event > plan.ts_event and float(bar.low) <= entry:
                self.waiting_plan = None
                self.waiting_voided += 1
        self._release_waiting(float(bar.close))

    def _release_waiting(self, reference_price: float) -> None:
        self.reference_price = reference_price
        plan = self.waiting_plan
        now_ns = self.clock.timestamp_ns()
        if (
            plan is None
            or self.bundle is not None
            or now_ns >= plan.ts_event + self.bundle_lifetime_ns
            or (self.release_after_ns is not None and now_ns <= self.release_after_ns)
        ):
            return
        self.waiting_plan = None
        self.release_after_ns = None
        self._submit_bundle(plan)

    def _tier_quantities(self, levels: tuple[float, ...], stop: float):
        equity_by_currency = self.portfolio.equity(venue=self.instrument_id.venue)
        equity_money = equity_by_currency.get(self.instrument.quote_currency)
        if equity_money is None or equity_money.as_double() <= 0:
            raise RuntimeError(f"missing positive native equity for {self.instrument_id}")
        equity = equity_money.as_double()
        multiplier = self.instrument.multiplier.as_double()
        quantities = []
        for entry in levels:
            raw = min(
                equity * TOTAL_RISK_FRACTION / len(levels) / ((entry - stop) * multiplier),
                equity * TOTAL_NOTIONAL_FRACTION / len(levels) / (entry * multiplier),
            )
            quantity = self.instrument.make_qty(raw, round_down=True)
            if (
                quantity.as_double() <= 0
                or (
                    self.instrument.min_quantity is not None
                    and quantity.as_decimal() < self.instrument.min_quantity.as_decimal()
                )
                or (
                    self.instrument.min_notional is not None
                    and quantity.as_double() * entry * multiplier
                    < self.instrument.min_notional.as_double()
                )
            ):
                self.bundle_minimum_skips += 1
                return None
            quantities.append(quantity)
        return quantities

    def _submit_bundle(self, plan: RetracementPlan) -> None:
        span = plan.b_high - plan.a_low
        prices = tuple(
            self.instrument.make_price(plan.b_high - ratio * span) for ratio in self.tier_ratios
        )
        stop = self.instrument.make_price(plan.stop)
        target = self.instrument.make_price(plan.target)
        levels = tuple(price.as_double() for price in prices)
        if not (
            stop.as_double() > 0
            and stop.as_double() < levels[-1]
            and all(higher > lower for higher, lower in pairwise(levels))
            and levels[0] < target.as_double()
        ):
            self.bundle_invalid_price_skips += 1
            return
        quantities = self._tier_quantities(levels, stop.as_double())
        if quantities is None:
            return
        order_lists = [
            self.order_factory.bracket(
                instrument_id=self.instrument_id,
                order_side=OrderSide.BUY,
                quantity=quantity,
                entry_order_type=OrderType.LIMIT,
                entry_price=price,
                time_in_force=TimeInForce.GTD,
                expire_time=plan.ts_event + self.bundle_lifetime_ns,
                tp_price=target,
                tp_post_only=False,
                sl_trigger_price=stop,
            )
            for price, quantity in zip(prices, quantities, strict=True)
        ]
        self.bundle = TierBundle(
            pair=(plan.a_index, plan.b_index),
            entry_ids=tuple(orders[0].client_order_id for orders in order_lists),
            filled_ids=set(),
            b_high=plan.b_high,
        )
        for orders in order_lists:
            self.submit_order_list(orders)
        self.bundle_submissions += 1
        self.waiting_released += 1

    def _retire_bundle(self) -> None:
        bundle = self.bundle
        if bundle is None:
            return
        bundle.retiring = True
        for entry_id in bundle.entry_ids:
            order = self.cache.order(entry_id)
            if order is not None and order.is_open and not order.is_pending_cancel:
                self.cancel_order(entry_id)
        self._release_retired_bundle()

    def _release_retired_bundle(self) -> None:
        bundle = self.bundle
        if bundle is None or not bundle.net_flat:
            return
        if any(
            (order := self.cache.order(entry_id)) is None or not order.is_closed
            for entry_id in bundle.entry_ids
        ):
            return
        bundle.retiring = True
        self.bundle = None
        self.bundle_retirements += 1
        if self.reference_price is not None:
            self._release_waiting(self.reference_price)

    def on_order_filled(self, event) -> None:
        first_fill_of_position = self.line_cancel_enabled and self.opened_ns is None
        if self.line_cancel_enabled and event.client_order_id in self.line_cancel_requested_ids:
            self.line_cancel_race_fills += 1
        bundle = self.bundle
        if bundle is None or event.client_order_id not in bundle.entry_ids:
            return
        if bundle.retiring:
            self.bundle_cancel_race_fills += 1
            self.waiting_plan = None
            bundle.retiring = False
        bundle.filled_ids.add(event.client_order_id)
        bundle.net_flat = False
        if self.opened_ns is None:
            self.opened_ns = event.ts_event
        if first_fill_of_position:
            self._freeze_entry_line()

    def on_position_closed(self, event) -> None:
        self.opened_ns = None
        if self.line_cancel_enabled:
            self.line_frozen_for_position = False
            self.frozen_line = None
            self.line_break_triggered = False
            self.line_cancel_requested_ids.clear()
        if self.bundle is not None:
            self.bundle.net_flat = True
            self._retire_bundle()

    def on_order_canceled(self, event) -> None:
        self._release_retired_bundle()

    def on_order_expired(self, event) -> None:
        self._release_retired_bundle()

    def on_order_rejected(self, event) -> None:
        self.bundle_order_failures += 1
        self.cancel_all_orders(self.instrument_id)
        self.close_all_positions(self.instrument_id)
        self._release_retired_bundle()

    def on_order_denied(self, event) -> None:
        self.bundle_order_failures += 1
        self.cancel_all_orders(self.instrument_id)
        self.close_all_positions(self.instrument_id)
        self._release_retired_bundle()
