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
