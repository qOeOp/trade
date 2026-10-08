"""
H15a three-tier pullback using native Nautilus contingent order lists.
"""

from __future__ import annotations

from dataclasses import dataclass

from retracement_strategy import ConfirmedSupportPullback
from retracement_strategy import RetracementPlan
from strategy import FOUR_HOUR_NS
from strategy import FourHour
from strategy import R1Strategy

from vibe_trading.model import Bar
from vibe_trading.model import OrderSide
from vibe_trading.model import OrderType
from vibe_trading.model import TimeInForce


TIER_RATIOS = (0.5, 0.618, 0.764)
TOTAL_RISK_FRACTION = 0.0025
TOTAL_NOTIONAL_FRACTION = 0.05
LIFETIME_NS = 30 * FOUR_HOUR_NS


@dataclass
class TierBundle:
    pair: tuple[int, int]
    entry_ids: tuple
    filled_ids: set
    net_flat: bool = True
    retiring: bool = False


class TieredRetracementStrategy(R1Strategy):
    """
    Own one three-entry bundle while Nautilus owns orders and portfolio state.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant != "support-three-tier-4h":
            raise ValueError("tiered pullback requires support-three-tier-4h")
        if (
            self.risk_budget_fraction != TOTAL_RISK_FRACTION
            or self.max_coin_notional_fraction != TOTAL_NOTIONAL_FRACTION
        ):
            raise ValueError("H15a requires its frozen 25-bp risk and 5% coin notional cap")
        self.support_state = ConfirmedSupportPullback(
            timing="confirmed-update",
            support_mode="none",
            entry_ratio=0.5,
            minimum_target_r=0.0,
            stop_at_origin=True,
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

    def _advance_waiting(self, bar: Bar) -> None:
        plan = self.waiting_plan
        if plan is not None:
            entry = self.instrument.make_price(plan.entry).as_double()
            if bar.ts_event >= plan.ts_event + LIFETIME_NS:
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
            or now_ns >= plan.ts_event + LIFETIME_NS
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
            self.instrument.make_price(plan.b_high - ratio * span) for ratio in TIER_RATIOS
        )
        stop = self.instrument.make_price(plan.stop)
        target = self.instrument.make_price(plan.target)
        levels = tuple(price.as_double() for price in prices)
        if not (0 < stop.as_double() < levels[2] < levels[1] < levels[0] < target.as_double()):
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
                expire_time=plan.ts_event + LIFETIME_NS,
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

    def on_position_closed(self, event) -> None:
        self.opened_ns = None
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
