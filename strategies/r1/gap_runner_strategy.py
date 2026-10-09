"""H24a: native H19a tiers with protected B and conditional gap runner shares."""

from __future__ import annotations

from decimal import ROUND_DOWN
from itertools import pairwise

from nautilus_trader.model import Bar
from nautilus_trader.model import OrderSide
from nautilus_trader.model import OrderType
from nautilus_trader.model import Quantity
from nautilus_trader.model import TimeInForce
from retracement_strategy import RetracementPlan
from strategy import FOUR_HOUR_NS
from tiered_retracement_strategy import BROAD_LIFETIME_NS
from tiered_retracement_strategy import TierBundle
from tiered_retracement_strategy import TieredRetracementStrategy


class GapRunnerStrategy(TieredRetracementStrategy):
    """Keep Nautilus as order, Position and account owner for four brackets."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant != "support-broad-gap-runner-4h":
            raise ValueError("gap runner requires its registered signal variant")
        self.b_target_ids: set = set()
        self.runner_target_ids: set = set()
        self.first_b_fill_ns: int | None = None
        self.gap_decision_ns: int | None = None
        self.gap_decision_done = False
        self.b_target_fills = 0
        self.gap_persistent_decisions = 0
        self.no_gap_decisions = 0
        self.no_gap_market_exits = 0
        self.runner_targets_before_decision = 0
        self.runner_minimum_skips = 0
        self.max_submitted_stop_risk_fraction = 0.0
        self.max_submitted_notional_fraction = 0.0

    def _shares(self, quantity: Quantity, entry: float):
        step = self.instrument.size_increment.as_decimal()
        runner_units = (quantity.as_decimal() / (2 * step)).to_integral_value(
            rounding=ROUND_DOWN
        )
        runner_dec = runner_units * step
        b_dec = quantity.as_decimal() - runner_dec
        runner = Quantity.from_str(f"{runner_dec:.{self.instrument.size_precision}f}")
        b = Quantity.from_str(f"{b_dec:.{self.instrument.size_precision}f}")
        multiplier = self.instrument.multiplier.as_double()
        for share in (b, runner):
            if (
                share.as_double() <= 0
                or (
                    self.instrument.min_quantity is not None
                    and share.as_decimal() < self.instrument.min_quantity.as_decimal()
                )
                or (
                    self.instrument.min_notional is not None
                    and share.as_double() * entry * multiplier
                    < self.instrument.min_notional.as_double()
                )
            ):
                self.runner_minimum_skips += 1
                return None
        if b.as_decimal() + runner.as_decimal() != quantity.as_decimal():
            raise RuntimeError("native runner split changed original tier quantity")
        return b, runner

    def _submit_bundle(self, plan: RetracementPlan) -> None:
        span = plan.b_high - plan.a_low
        prices = tuple(
            self.instrument.make_price(plan.b_high - ratio * span)
            for ratio in self.tier_ratios
        )
        stop = self.instrument.make_price(plan.stop)
        b_target = self.instrument.make_price(plan.target)
        levels = tuple(price.as_double() for price in prices)
        if not (
            stop.as_double() > 0
            and stop.as_double() < levels[-1]
            and all(higher > lower for higher, lower in pairwise(levels))
            and levels[0] < b_target.as_double()
        ):
            self.bundle_invalid_price_skips += 1
            return
        quantities = self._tier_quantities(levels, stop.as_double())
        if quantities is None:
            return
        shares = [
            self._shares(quantity, level)
            for quantity, level in zip(quantities, levels, strict=True)
        ]
        if any(pair is None for pair in shares):
            return  # Atomic source setup: do not submit a partial tier bundle.
        equity = self.portfolio.equity(venue=self.instrument_id.venue)[
            self.instrument.quote_currency
        ].as_double()
        multiplier = self.instrument.multiplier.as_double()
        total_stop_risk = sum(
            quantity.as_double() * (entry - stop.as_double()) * multiplier
            for quantity, entry in zip(quantities, levels, strict=True)
        )
        total_notional = sum(
            quantity.as_double() * entry * multiplier
            for quantity, entry in zip(quantities, levels, strict=True)
        )
        risk_fraction = total_stop_risk / equity
        notional_fraction = total_notional / equity
        if risk_fraction > 0.0025 + 1e-10 or notional_fraction > 0.05 + 1e-10:
            raise RuntimeError(
                "native gap runner exceeds frozen portfolio risk or notional cap"
            )
        self.max_submitted_stop_risk_fraction = max(
            self.max_submitted_stop_risk_fraction, risk_fraction
        )
        self.max_submitted_notional_fraction = max(
            self.max_submitted_notional_fraction, notional_fraction
        )
        runner_target = self.instrument.make_price(
            b_target.as_double() + prices[0].as_double() - stop.as_double(),
        )
        if runner_target.as_double() <= b_target.as_double():
            self.bundle_invalid_price_skips += 1
            return
        order_lists = []
        b_target_ids = set()
        runner_target_ids = set()
        for price, pair in zip(prices, shares, strict=True):
            for quantity, target, target_ids in (
                (pair[0], b_target, b_target_ids),
                (pair[1], runner_target, runner_target_ids),
            ):
                orders = self.order_factory.bracket(
                    instrument_id=self.instrument_id,
                    order_side=OrderSide.BUY,
                    quantity=quantity,
                    entry_order_type=OrderType.LIMIT,
                    entry_price=price,
                    time_in_force=TimeInForce.GTD,
                    expire_time=plan.ts_event + BROAD_LIFETIME_NS,
                    tp_price=target,
                    tp_post_only=False,
                    sl_trigger_price=stop,
                )
                self._activate_target_first(orders)
                target_ids.add(orders[2].client_order_id)
                order_lists.append(orders)
        self.bundle = TierBundle(
            pair=(plan.a_index, plan.b_index),
            entry_ids=tuple(orders[0].client_order_id for orders in order_lists),
            filled_ids=set(),
            b_high=plan.b_high,
        )
        self.b_target_ids = b_target_ids
        self.runner_target_ids = runner_target_ids
        self.first_b_fill_ns = None
        self.gap_decision_ns = None
        self.gap_decision_done = False
        for orders in order_lists:
            self.submit_order_list(orders)
        self.bundle_submissions += 1
        self.waiting_released += 1

    def on_order_filled(self, event) -> None:
        if event.client_order_id in self.b_target_ids:
            self.b_target_fills += 1
            if self.first_b_fill_ns is None:
                self.first_b_fill_ns = event.ts_event
                self.gap_decision_ns = (
                    event.ts_event // FOUR_HOUR_NS + 2
                ) * FOUR_HOUR_NS
                bundle = self.bundle
                if bundle is not None:
                    for entry_id in bundle.entry_ids:
                        if entry_id in bundle.filled_ids:
                            continue
                        order = self.cache.order(entry_id)
                        if (
                            order is not None
                            and order.is_open
                            and not order.is_pending_cancel
                        ):
                            self.cancel_order(entry_id)
        if (
            event.client_order_id in self.runner_target_ids
            and self.gap_decision_ns is not None
            and event.ts_event < self.gap_decision_ns
        ):
            self.runner_targets_before_decision += 1
        super().on_order_filled(event)

    def _on_four_hour_bar(self, bar: Bar) -> None:
        super()._on_four_hour_bar(bar)
        if (
            self.gap_decision_ns is None
            or self.gap_decision_done
            or bar.ts_event < self.gap_decision_ns
        ):
            return
        self.gap_decision_done = True
        if len(self.four_hour_history) < 3:
            raise RuntimeError(
                "native gap decision lacks preceding complete four-hour bars"
            )
        preceding = self.four_hour_history[-3]
        following = self.four_hour_history[-1]
        if following.low > preceding.high:
            self.gap_persistent_decisions += 1
            return
        self.no_gap_decisions += 1
        bundle = self.bundle
        if bundle is not None and not bundle.net_flat:
            self.cancel_all_orders(self.instrument_id)
            self.close_all_positions(self.instrument_id)
            self.no_gap_market_exits += 1

    def on_position_closed(self, event) -> None:
        super().on_position_closed(event)
        self.b_target_ids.clear()
        self.runner_target_ids.clear()
        self.first_b_fill_ns = None
        self.gap_decision_ns = None
        self.gap_decision_done = False
