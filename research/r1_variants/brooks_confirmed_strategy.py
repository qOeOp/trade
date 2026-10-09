"""H23a: native post-touch second-entry or strong-breakout stop bracket."""

from __future__ import annotations

from dataclasses import dataclass

from nautilus_trader.model import Bar
from nautilus_trader.model import OrderSide
from nautilus_trader.model import OrderType
from nautilus_trader.model import TimeInForce
from research.r1_variants.retracement_strategy import RetracementPlan
from backtest.r1.stop_entry import with_buy_stop_parent
from research.r1_variants.strategy import FOUR_HOUR_NS
from research.r1_variants.strategy import FourHour
from research.r1_variants.tiered_retracement_strategy import TierBundle
from research.r1_variants.tiered_retracement_strategy import TieredRetracementStrategy


MILLISECOND_NS = 1_000_000
SIGNAL_BARS = 4  # The fifth full bar is reserved for a next-bar trigger.


@dataclass
class PostTouchWatch:
    plan: RetracementPlan
    touch_bar_end_ns: int | None = None
    high1_seen: bool = False
    high2_seen: bool = False
    strong_seen: bool = False
    active_order_id: object | None = None
    active_deadline_ns: int | None = None
    pending_setup: FourHour | None = None
    pending_branch: str | None = None


class BrooksConfirmedStrategy(TieredRetracementStrategy):
    """Keep H19a's selector/account boundary; replace resting entry timing."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant != "support-brooks-confirmed-4h":
            raise ValueError(
                "Brooks confirmation requires its registered signal variant"
            )
        self.watch: PostTouchWatch | None = None
        self.watch_touches = 0
        self.watch_invalidations = 0
        self.watch_expiries = 0
        self.high2_signals = 0
        self.strong_signals = 0
        self.high2_submissions = 0
        self.strong_submissions = 0

    def _queue_broad_candidate(self, candle: FourHour) -> None:
        plan = self.broad_state.on_closed(
            candle,
            self.atr.value if self.atr.initialized else None,
        )
        selected = self.broad_state.last_selected
        if selected is None:
            return
        high = selected["b_high"]
        if self.watch is not None and high > self.watch.plan.b_high:
            self.bundle_supersessions += 1
            self._clear_watch()
        if self.waiting_plan is not None and high > self.waiting_plan.b_high:
            self.waiting_plan = None
        if (
            self.bundle is not None
            and self.bundle.net_flat
            and not self.bundle.retiring
            and self.bundle.b_high is not None
            and high > self.bundle.b_high
        ):
            self.release_after_ns = candle.ts_event
            self._retire_bundle()
        if plan is None or (
            self.trade_start_ns is not None and candle.ts_event < self.trade_start_ns
        ):
            return
        pair = (plan.a_index, plan.b_index)
        if pair in self.broad_planned_pairs or self.waiting_plan is not None:
            return
        if self.watch is not None:
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

    def _release_waiting(self, reference_price: float) -> None:
        self.reference_price = reference_price
        plan = self.waiting_plan
        now_ns = self.clock.timestamp_ns()
        if (
            plan is None
            or self.watch is not None
            or self.bundle is not None
            or now_ns >= plan.ts_event + self.bundle_lifetime_ns
            or (self.release_after_ns is not None and now_ns <= self.release_after_ns)
        ):
            return
        self.waiting_plan = None
        self.release_after_ns = None
        self.watch = PostTouchWatch(plan=plan)

    def _clear_watch(self) -> None:
        self.watch = None
        if self.bundle is not None and self.bundle.net_flat:
            self._retire_bundle()

    def _advance_waiting(self, bar: Bar) -> None:
        watch = self.watch
        if watch is None:
            self._release_waiting(float(bar.close))
            return
        plan = watch.plan
        if bar.ts_event >= plan.ts_event + self.bundle_lifetime_ns:
            self.watch_expiries += 1
            self._clear_watch()
            return
        if bar.ts_event <= plan.ts_event:
            return
        low, high = float(bar.low), float(bar.high)
        level_50 = self.instrument.make_price(plan.entry).as_double()
        stop = self.instrument.make_price(plan.stop).as_double()
        target = self.instrument.make_price(plan.target).as_double()
        if watch.touch_bar_end_ns is None:
            if low > level_50:
                return
            # OHLC gives no ordering inside the touch minute. A simultaneous
            # stop or target is conservatively an invalid watch, not a fill.
            if low <= stop or high >= target:
                self.watch_invalidations += 1
                self._clear_watch()
                return
            watch.touch_bar_end_ns = (
                (bar.ts_event + MILLISECOND_NS + FOUR_HOUR_NS - 1) // FOUR_HOUR_NS
            ) * FOUR_HOUR_NS - MILLISECOND_NS
            self.watch_touches += 1
            return
        if self.bundle is not None and not self.bundle.net_flat:
            return
        if low <= stop or high >= target:
            self.watch_invalidations += 1
            self._clear_watch()

    def _on_four_hour_bar(self, bar: Bar) -> None:
        super()._on_four_hour_bar(bar)
        watch = self.watch
        if watch is None or watch.touch_bar_end_ns is None:
            return
        if watch.active_order_id is not None and (
            watch.active_deadline_ns is not None
            and bar.ts_event >= watch.active_deadline_ns
        ):
            order = self.cache.order(watch.active_order_id)
            if order is not None and order.is_open and not order.is_pending_cancel:
                self.cancel_order(watch.active_order_id)
        age = (bar.ts_event - watch.touch_bar_end_ns) // FOUR_HOUR_NS
        if age <= 0:
            return
        if age >= 5:
            self.watch_expiries += 1
            self._clear_watch()
            return
        if len(self.four_hour_history) < 2:
            return
        prior = self.four_hour_history[-2]
        current = self.four_hour_history[-1]
        high2 = False
        if not watch.high2_seen:
            if not watch.high1_seen:
                watch.high1_seen = current.high > prior.high
            elif current.high < prior.high:
                watch.high2_seen = True
                high2 = True
                self.high2_signals += 1
        strong = False
        if not watch.strong_seen and (
            current.high > current.low
            and float(bar.close) > float(bar.open)
            and current.close >= current.low + 0.75 * (current.high - current.low)
            and current.close > prior.high
        ):
            watch.strong_seen = True
            strong = True
            self.strong_signals += 1
        if high2 or strong:
            branch = "high2" if high2 else "strong"
            if self.bundle is None:
                self._submit_confirmed_stop(watch, current, branch)
            elif (
                self.bundle.net_flat
                and watch.active_deadline_ns is not None
                and bar.ts_event >= watch.active_deadline_ns
            ):
                # A same-boundary cancel/expiry may be delivered after this
                # closed-bar callback; submit once the old parent is terminal.
                watch.pending_setup = current
                watch.pending_branch = branch

    def _submit_deferred_if_released(self) -> None:
        watch = self.watch
        if (
            watch is None
            or watch.pending_setup is None
            or watch.pending_branch is None
            or self.bundle is not None
        ):
            return
        setup, branch = watch.pending_setup, watch.pending_branch
        watch.pending_setup = None
        watch.pending_branch = None
        if self.clock.timestamp_ns() < setup.ts_event + FOUR_HOUR_NS:
            self._submit_confirmed_stop(watch, setup, branch)

    def _submit_confirmed_stop(
        self,
        watch: PostTouchWatch,
        setup: FourHour,
        branch: str,
    ) -> None:
        plan = watch.plan
        trigger = self.instrument.make_price(
            setup.high + self.instrument.price_increment.as_double(),
        )
        stop = self.instrument.make_price(plan.stop)
        target = self.instrument.make_price(plan.target)
        if not 0 < stop.as_double() < trigger.as_double() < target.as_double():
            self.bundle_invalid_price_skips += 1
            return
        quantities = self._tier_quantities((trigger.as_double(),), stop.as_double())
        if quantities is None:
            return
        expire_time = setup.ts_event + FOUR_HOUR_NS
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY,
            quantity=quantities[0],
            entry_order_type=OrderType.LIMIT,
            entry_price=trigger,
            time_in_force=TimeInForce.GTD,
            expire_time=expire_time,
            tp_price=target,
            tp_post_only=False,
            sl_trigger_price=stop,
        )
        # This Nautilus version's bracket factory does not accept a STOP_MARKET
        # parent. Retain its native OTO/OCO children and their generated IDs,
        # replacing only the parent with a native StopMarketOrder. As in H19a,
        # the target must activate before the stop on an immediate stop fill.
        orders = with_buy_stop_parent(
            orders, self.instrument_id, quantities[0], trigger,
            expire_time, self.clock.timestamp_ns(),
        )
        self.bundle = TierBundle(
            pair=(plan.a_index, plan.b_index),
            entry_ids=(orders[0].client_order_id,),
            filled_ids=set(),
            b_high=plan.b_high,
        )
        watch.active_order_id = orders[0].client_order_id
        watch.active_deadline_ns = expire_time
        self.submit_order_list(orders)
        self.bundle_submissions += 1
        self.waiting_released += 1
        if branch == "high2":
            self.high2_submissions += 1
        else:
            self.strong_submissions += 1

    def on_order_filled(self, event) -> None:
        if self.bundle is not None and event.client_order_id in self.bundle.entry_ids:
            self.watch = None
        super().on_order_filled(event)

    def on_order_expired(self, event) -> None:
        if (
            self.watch is not None
            and event.client_order_id == self.watch.active_order_id
        ):
            self.watch.active_order_id = None
            self.watch.active_deadline_ns = None
        super().on_order_expired(event)
        self._submit_deferred_if_released()

    def on_order_canceled(self, event) -> None:
        if (
            self.watch is not None
            and event.client_order_id == self.watch.active_order_id
        ):
            self.watch.active_order_id = None
            self.watch.active_deadline_ns = None
        super().on_order_canceled(event)
        self._submit_deferred_if_released()

    def on_order_rejected(self, event) -> None:
        self.watch = None
        super().on_order_rejected(event)

    def on_order_denied(self, event) -> None:
        self.watch = None
        super().on_order_denied(event)
