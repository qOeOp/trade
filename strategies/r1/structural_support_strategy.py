"""Native broad tiers after prior A support; optional outside-A protection."""

from __future__ import annotations

from dataclasses import replace

from broad_swing_signal import ANCHOR_LOOKBACK
from broad_swing_signal import PIVOT_ORDER
from strategy import STOP_BUFFER_ATR
from strategy import FourHour
from tiered_retracement_strategy import TieredRetracementStrategy


class StructuralSupportStrategy(TieredRetracementStrategy):
    """Apply one pre-registered completed-bar state before native OTO submission."""

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        if self.signal_variant not in (
            "support-broad-prior-a-support-4h",
            "support-broad-any-prior-a-support-4h",
            "support-broad-any-prior-a-outside-stop-4h",
        ):
            raise ValueError("structural support requires its registered signal variant")
        self.structural_state_decisions: list[dict] = []
        self.structural_accepted = 0
        self.structural_rejected = 0

    @staticmethod
    def _prior_pivots(candles: list[FourHour], signal_i: int, bound_i: int, side: str) -> list[int]:
        field = "high" if side == "high" else "low"
        compare = max if side == "high" else min
        first = max(PIVOT_ORDER, signal_i - ANCHOR_LOOKBACK + 1)
        return [
            j for j in range(first, min(bound_i, signal_i - PIVOT_ORDER + 1))
            if getattr(candles[j], field) == compare(
                getattr(bar, field)
                for bar in candles[j - PIVOT_ORDER : j + PIVOT_ORDER + 1]
            )
        ]

    def _queue_broad_candidate(self, candle: FourHour) -> None:
        previous = self.waiting_plan
        prior_atr = self.atr.value if self.atr.initialized else None
        super()._queue_broad_candidate(candle)
        plan = self.waiting_plan
        if plan is None or plan is previous or plan.ts_event != candle.ts_event:
            return
        if prior_atr is None or prior_atr <= 0:
            raise RuntimeError("native structural state lacks prior Wilder ATR")
        candles = self.broad_state.candles
        signal_i = len(candles) - 1
        a_i, b_i = plan.a_index, plan.b_index
        if not 0 <= a_i < b_i <= signal_i:
            raise RuntimeError("native structural state has noncausal A/B indices")
        a = self.instrument.make_price(plan.a_low).as_double()
        b = self.instrument.make_price(plan.b_high).as_double()
        older_lows = self._prior_pivots(candles, signal_i, a_i, "low")
        older_highs = self._prior_pivots(candles, signal_i, b_i, "high")
        support = [j for j in older_lows if abs(candles[j].low - a) <= prior_atr]
        resistance = [j for j in older_highs if abs(candles[j].high - b) <= prior_atr]
        outside_stop_variant = self.signal_variant == "support-broad-any-prior-a-outside-stop-4h"
        accepted = bool(support) and (
            self.signal_variant != "support-broad-prior-a-support-4h" or not resistance
        )
        old_stop = str(self.instrument.make_price(plan.stop))
        outside_geometry_valid = None
        if outside_stop_variant:
            outside_stop = self.instrument.make_price(a - STOP_BUFFER_ATR * prior_atr)
            deeper = self.instrument.make_price(plan.b_high - 0.618 * (plan.b_high - plan.a_low))
            outside_geometry_valid = 0 < outside_stop.as_double() < a < deeper.as_double() < b
            accepted = accepted and outside_geometry_valid
            if accepted:
                plan = replace(plan, stop=outside_stop.as_double())
                self.waiting_plan = plan
        decision = {
            "signal_end_ns": candle.ts_event,
            "a_end_ns": candles[a_i].ts_event,
            "b_end_ns": candles[b_i].ts_event,
            "rounded_a": str(self.instrument.make_price(plan.a_low)),
            "rounded_b": str(self.instrument.make_price(plan.b_high)),
            "rounded_stop": str(self.instrument.make_price(plan.stop)),
            "prior_14bar_wilder_atr": prior_atr,
            "prior_confirmed_support_test_count": len(support),
            "prior_confirmed_resistance_test_count": len(resistance),
            "accepted": accepted,
        }
        if outside_stop_variant:
            decision["original_rounded_stop"] = old_stop
            decision["outside_a_geometry_valid"] = outside_geometry_valid
        self.structural_state_decisions.append(decision)
        if accepted:
            self.structural_accepted += 1
        else:
            self.structural_rejected += 1
            self.waiting_plan = None
