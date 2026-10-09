"""Complete native R1 H19a broad-swing, two-tier strategy.

All strategy rules live in this file: causal four-hour LAST selection, prior-bar
Wilder ATR, 50%/61.8% entry tiers, structural stop, swing-high target, sizing and
native bracket lifecycle. The shared runner supplies market data and a fixed
capital account; Nautilus owns orders, fills, fees, funding and account state.

Behavioral source: H19a support-broad-two-tier-4h at 44e229331. Historical
variants and research evidence are managed outside the strategy directory.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from itertools import pairwise

from nautilus_trader.indicators import WilderMovingAverage
from nautilus_trader.model import Bar, BarType, InstrumentId, LimitOrder
from nautilus_trader.model import OrderSide, OrderType, Quantity, StrategyId, TimeInForce
from nautilus_trader.trading import Strategy, StrategyConfig


SIGNAL_VARIANT = "support-broad-two-tier-4h"
FOUR_HOUR_NS = 86_400_000_000_000 // 6
STOP_BUFFER_ATR = 0.25
PIVOT_ORDER = 8
ANCHOR_LOOKBACK = 180
BOX_BARS = 60
MIN_ANCHOR_SPAN = 6
DEEP_STOP_RATIO = 0.764
BROAD_TIER_RATIOS = (0.5, 0.618)
TOTAL_RISK_FRACTION = 0.0025
TOTAL_NOTIONAL_FRACTION = 0.05
BROAD_LIFETIME_NS = 180 * FOUR_HOUR_NS


@dataclass(frozen=True)
class FourHour:
    ts_event: int
    high: float
    low: float
    close: float


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


class BroadSwingPullback:
    """
    Track complete LAST candles and expose D60's selected A/B and eligible plan.
    """

    def __init__(self) -> None:
        self.candles: list[FourHour] = []
        self.last_selected: dict | None = None

    def _pivot_low(self, j: int) -> bool:
        window = self.candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
        return self.candles[j].low == min(bar.low for bar in window)

    def _selected(self, i: int, prior_atr: float | None) -> dict | None:
        if i + 1 < ANCHOR_LOOKBACK or prior_atr is None or prior_atr <= 0:
            return None
        b = max(range(i - BOX_BARS + 1, i + 1), key=lambda j: (self.candles[j].high, -j))
        eligible = [
            j
            for j in range(max(PIVOT_ORDER, b - ANCHOR_LOOKBACK + 1), b - MIN_ANCHOR_SPAN + 1)
            if j + PIVOT_ORDER <= b and self._pivot_low(j)
        ]
        if not eligible:
            return None
        a = min(eligible, key=lambda j: (self.candles[j].low, j))
        low, high = self.candles[a].low, self.candles[b].high
        if not 0 < low < high:
            return None
        span = high - low
        return {
            "a_index": a,
            "b_index": b,
            "a_low": low,
            "b_high": high,
            "level_50": high - 0.5 * span,
            "level_618": high - 0.618 * span,
            "level_764": high - DEEP_STOP_RATIO * span,
            "stop": high - DEEP_STOP_RATIO * span - STOP_BUFFER_ATR * prior_atr,
            "target": high,
        }

    def _eligible(self, i: int, selected: dict) -> bool:
        b = selected["b_index"]
        return self.candles[i].close > selected["level_50"] and all(
            self.candles[j].low > selected["level_50"] for j in range(b + 1, i + 1)
        )

    def on_closed(self, candle: FourHour, prior_atr: float | None) -> RetracementPlan | None:
        if self.candles and candle.ts_event - self.candles[-1].ts_event != FOUR_HOUR_NS:
            raise RuntimeError("broad-swing four-hour LAST input is not contiguous")
        self.candles.append(candle)
        i = len(self.candles) - 1
        selected = self._selected(i, prior_atr)
        self.last_selected = selected
        if selected is None or selected["stop"] <= 0 or not self._eligible(i, selected):
            return None
        return RetracementPlan(
            ts_event=candle.ts_event,
            a_index=selected["a_index"],
            b_index=selected["b_index"],
            a_low=selected["a_low"],
            b_high=selected["b_high"],
            level_50=selected["level_50"],
            entry=selected["level_50"],
            level_764=selected["level_764"],
            stop=selected["stop"],
            target=selected["target"],
            support_low_indices=(),
            support_kind="broad-confirmed-swing",
        )


@dataclass
class TierBundle:
    pair: tuple[int, int]
    entry_ids: tuple
    filled_ids: set
    net_flat: bool = True
    retiring: bool = False
    b_high: float | None = None


class R1Strategy(Strategy):
    """Execute one instrument's H19a rules in the supplied native account.

    Constructor arguments retain the existing native runner interface. Daily
    bars and trade_size are compatibility inputs; H19a uses four-hour signals
    and native equity sizing with the required 25-bp risk and 5% notional cap.
    """

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
        signal_variant: str = SIGNAL_VARIANT,
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
        signal_variant: str = SIGNAL_VARIANT,
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
        if signal_variant != SIGNAL_VARIANT:
            raise ValueError("unsupported R-1 signal variant")
        self.signal_variant = signal_variant
        self.four_hour_bar_type = BarType.from_str(
            f"{instrument_id}-4-HOUR-LAST-INTERNAL",
        )
        self.four_hour_history: list[FourHour] = []
        self.trade_size = trade_size
        if risk_budget_fraction is not None and not 0 < risk_budget_fraction < 1:
            raise ValueError("risk budget fraction must be between zero and one")
        if not 0 < max_coin_notional_fraction <= 1:
            raise ValueError("coin notional cap must be between zero and one")
        if (
            risk_budget_fraction != TOTAL_RISK_FRACTION
            or max_coin_notional_fraction != TOTAL_NOTIONAL_FRACTION
        ):
            raise ValueError(
                "budgeted tiers require 25-bp risk and 5% coin notional cap"
            )
        self.risk_budget_fraction = risk_budget_fraction
        self.max_coin_notional_fraction = max_coin_notional_fraction
        self.trade_start_ns = trade_start_ns
        self.historical_daily_bars = historical_daily_bars or []
        # Seed with the first TR and update with alpha=1/14, adjust=False.
        self.atr = WilderMovingAverage(14)
        self.reference_price: float | None = None
        self.opened_ns: int | None = None
        self.signals = 0
        self.signals_while_open = 0
        self.waiting_voided = 0
        self.waiting_released = 0
        # Retain the generic runner's zero-valued report fields for parity.
        self.slot_violations = 0
        self.box_breaks = 0
        self.risk_size_skips = 0
        self.tier_ratios = BROAD_TIER_RATIOS
        self.bundle_lifetime_ns = BROAD_LIFETIME_NS
        self.broad_state = BroadSwingPullback()
        self.broad_planned_pairs: set[tuple[int, int]] = set()
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

    def on_start(self) -> None:
        self.instrument = self.cache.instrument(self.instrument_id)
        if self.instrument is None:
            raise RuntimeError(f"missing instrument {self.instrument_id}")
        self.subscribe_bars(self.minute_bar_type)
        self.subscribe_bars(
            BarType.from_str(
                f"{self.four_hour_bar_type}@{self.execution_bar_minutes}-MINUTE-EXTERNAL",
            ),
        )
        self.historical_daily_bars.clear()

    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type == self.minute_bar_type:
            self._advance_waiting(bar)
            return
        if bar.bar_type == self.four_hour_bar_type:
            self._on_four_hour_bar(bar)

    def _on_four_hour_bar(self, bar: Bar) -> None:
        candle = FourHour(
            bar.ts_event,
            float(bar.high),
            float(bar.low),
            float(bar.close),
        )
        previous_close = (
            self.four_hour_history[-1].close if self.four_hour_history else candle.close
        )
        true_range = max(
            candle.high - candle.low,
            abs(candle.high - previous_close),
            abs(candle.low - previous_close),
        )
        hold_ns = 180 * FOUR_HOUR_NS
        if self.opened_ns is not None and bar.ts_event >= self.opened_ns + hold_ns:
            self.cancel_all_orders(self.instrument_id)
            self.close_all_positions(self.instrument_id)
        # The signal sees the previous closed bar's ATR; update only after it.
        self._queue_four_hour_candidate(candle)
        self.atr.update_raw(true_range)
        self.four_hour_history.append(candle)
        self.four_hour_history = self.four_hour_history[-BOX_BARS:]
        self._release_waiting(candle.close)

    def _queue_four_hour_candidate(self, candle: FourHour) -> None:
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
            raise RuntimeError(
                f"missing positive native equity for {self.instrument_id}"
            )
        equity = equity_money.as_double()
        multiplier = self.instrument.multiplier.as_double()
        quantities = []
        for entry in levels:
            raw = min(
                equity
                * TOTAL_RISK_FRACTION
                / len(levels)
                / ((entry - stop) * multiplier),
                equity * TOTAL_NOTIONAL_FRACTION / len(levels) / (entry * multiplier),
            )
            quantity = self.instrument.make_qty(raw, round_down=True)
            if (
                quantity.as_double() <= 0
                or (
                    self.instrument.min_quantity is not None
                    and quantity.as_decimal()
                    < self.instrument.min_quantity.as_decimal()
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
            self.instrument.make_price(plan.b_high - ratio * span)
            for ratio in self.tier_ratios
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
        for orders in order_lists:
            self._activate_target_first(orders)
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

    @staticmethod
    def _activate_target_first(orders) -> None:
        # The pinned rc3 matcher activates OTO children in linked-ID order.
        # Target first prevents a synchronous entry-bar stop from rejecting it.
        if (
            len(orders) != 3
            or orders[0].order_type != OrderType.LIMIT
            or orders[1].order_type != OrderType.STOP_MARKET
            or orders[2].order_type != OrderType.LIMIT
        ):
            raise RuntimeError("native bracket child layout changed")
        entry = orders[0].to_dict()
        entry["linked_order_ids"] = [
            str(orders[2].client_order_id),
            str(orders[1].client_order_id),
        ]
        orders[0] = LimitOrder.from_dict(entry)

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
