"""
Causal H08b plan checks before native order and account replay.
"""

import unittest

from strategy import FOUR_HOUR_NS
from test_line_support_signal import _history
from test_line_support_signal import _replay
from trendline_strategy import LineCandle


class LineRestingSignalCases(unittest.TestCase):
    def test_only_confirmed_anchors_price_the_next_bar(self):
        history = _history()
        assert _replay(history[:38]).next_bar_resting_plan(2.0) is None
        state = _replay(history)
        plan = state.next_bar_resting_plan(2.0)
        assert plan is not None
        assert plan.ts_event == 59 * FOUR_HOUR_NS
        assert plan.anchors == (10, 30)
        assert (plan.entry, plan.stop, plan.target) == (103.0, 102.0, 115.9)
        assert plan.entry < history[-1].close

    def test_a_touch_disclosed_by_the_decision_bar_cannot_arm_old_entry(self):
        history = _history()
        history[-1] = LineCandle(59 * FOUR_HOUR_NS, 103, 115.9, 102.7, 104)
        state = _replay(history)
        assert state.next_bar_resting_plan(2.0) is None

    def test_a_projected_limit_above_the_decision_close_is_refused(self):
        history = _history()
        history[-1] = LineCandle(59 * FOUR_HOUR_NS, 102.8, 115.9, 102.76, 102.8)
        state = _replay(history)
        assert state.next_bar_resting_plan(2.0) is None

    def test_a_closed_break_kills_the_pair_before_rearming(self):
        state = _replay(_history())
        assert state.next_bar_resting_plan(2.0) is not None
        state.on_closed(LineCandle(60 * FOUR_HOUR_NS, 103, 104, 100, 101), 2.0)
        assert (10, 30) in state.dead_pairs
        assert state.next_bar_resting_plan(2.0) is None


if __name__ == "__main__":
    unittest.main()
