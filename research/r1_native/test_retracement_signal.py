"""
Causal H13 signal cases; native Strategy owns actual orders and fills.
"""

import unittest

from retracement_strategy import ConfirmedSupportPullback
from strategy import FOUR_HOUR_NS
from strategy import FourHour


def _bars(*, second_support: bool = True, untouched: bool = True):
    bars = [FourHour(i * FOUR_HOUR_NS, 120.0, 108.0 + i * 0.01, 115.0) for i in range(198)]
    for index in (80, 90) if second_support else (80,):
        bars[index] = FourHour(index * FOUR_HOUR_NS, 120.0, 105.3, 115.0)
    bars[100] = FourHour(100 * FOUR_HOUR_NS, 120.0, 90.0, 115.0)
    bars[185] = FourHour(185 * FOUR_HOUR_NS, 130.0, 109.85, 115.0)
    bars[197] = FourHour(197 * FOUR_HOUR_NS, 120.0, 106.0 if untouched else 105.0, 109.0)
    return bars


class RetracementSignalCases(unittest.TestCase):
    def test_confirmed_support_pivots_precede_high_and_reject_ordinary_lows(self):
        bars = _bars()
        confirmed = ConfirmedSupportPullback(
            timing="confirmed-update",
            support_mode="confirmed-pivots",
        )
        plans = [plan for bar in bars if (plan := confirmed.on_closed(bar, 1.0)) is not None]
        assert len(plans) == 1
        assert plans[0].support_low_indices == (80, 90)
        assert all(index + 8 < plans[0].b_index for index in plans[0].support_low_indices)

        ordinary = bars.copy()
        for index in (81, 91):
            ordinary[index] = FourHour(index * FOUR_HOUR_NS, 120.0, 104.5, 115.0)
        old_rule = ConfirmedSupportPullback(timing="confirmed-update")
        new_rule = ConfirmedSupportPullback(
            timing="confirmed-update",
            support_mode="confirmed-pivots",
        )
        assert any(old_rule.on_closed(bar, 1.0) is not None for bar in ordinary)
        assert all(new_rule.on_closed(bar, 1.0) is None for bar in ordinary)

    def test_confirmed_update_arms_after_low_confirmation_only_if_tier_untouched(self):
        bars = [FourHour(i * FOUR_HOUR_NS, 120.0, 110.0, 115.0) for i in range(210)]
        for index in (80, 90):
            bars[index] = FourHour(index * FOUR_HOUR_NS, 120.0, 105.3, 115.0)
        bars[190] = FourHour(190 * FOUR_HOUR_NS, 120.0, 90.0, 115.0)
        bars[196] = FourHour(196 * FOUR_HOUR_NS, 130.0, 110.0, 115.0)
        state = ConfirmedSupportPullback(timing="confirmed-update")
        plans = [plan for bar in bars if (plan := state.on_closed(bar, 1.0)) is not None]
        assert len(plans) == 1
        assert (plans[0].a_index, plans[0].b_index) == (190, 196)
        assert plans[0].ts_event == 198 * FOUR_HOUR_NS

        touched = bars.copy()
        touched[197] = FourHour(197 * FOUR_HOUR_NS, 120.0, 105.0, 115.0)
        touched_state = ConfirmedSupportPullback(timing="confirmed-update")
        touched_plans = [
            plan for bar in touched if (plan := touched_state.on_closed(bar, 1.0)) is not None
        ]
        assert touched_plans == []

    def test_immediate_plan_arms_on_new_high_before_retracement(self):
        state = ConfirmedSupportPullback(timing="immediate")
        plans = [plan for bar in _bars() if (plan := state.on_closed(bar, 1.0)) is not None]
        assert len(plans) == 1
        assert plans[0].ts_event == 185 * FOUR_HOUR_NS
        assert plans[0].entry < 115.0 < plans[0].target

    def test_immediate_plan_rejects_high_bar_that_already_touched_entry(self):
        bars = _bars()
        bars[185] = FourHour(185 * FOUR_HOUR_NS, 130.0, 105.0, 115.0)
        state = ConfirmedSupportPullback(timing="immediate")
        plans = [plan for bar in bars if (plan := state.on_closed(bar, 1.0)) is not None]
        assert plans == []

    def test_prior_support_and_untouched_tier_emit_one_plan(self):
        state = ConfirmedSupportPullback()
        plans = [plan for bar in _bars() if (plan := state.on_closed(bar, 1.0)) is not None]
        assert len(plans) == 1
        plan = plans[0]
        assert (plan.a_index, plan.b_index) == (100, 185)
        assert abs(plan.entry - 105.28) < 1e-8
        assert abs(plan.level_764 - 99.44) < 1e-8
        assert abs(plan.stop - 99.19) < 1e-8
        assert 80 in plan.support_low_indices
        assert 90 in plan.support_low_indices
        assert state._evaluate(197, 1.0)[1]["reason"] == "pair-already-planned"

    def test_one_old_support_low_does_not_claim_horizontal_cluster(self):
        state = ConfirmedSupportPullback()
        plans = [
            plan
            for bar in _bars(second_support=False)
            if (plan := state.on_closed(bar, 1.0)) is not None
        ]
        assert plans == []
        assert state.last_readout["reason"] == "no-prior-separated-horizontal-support"

    def test_current_bar_touch_cannot_become_pretouch_limit(self):
        state = ConfirmedSupportPullback()
        plans = [
            plan
            for bar in _bars(untouched=False)
            if (plan := state.on_closed(bar, 1.0)) is not None
        ]
        assert plans == []
        assert state.last_readout["reason"] == "not-before-61.8-touch-in-approach-zone"


if __name__ == "__main__":
    unittest.main()
