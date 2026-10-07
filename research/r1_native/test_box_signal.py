"""
Source geometry checks for the native four-hour box signal.
"""

import unittest
from types import SimpleNamespace

from strategy import BOX_BARS
from strategy import FOUR_HOUR_NS
from strategy import FourHour
from strategy import R1Strategy
from strategy import confirmed_box_break
from strategy import prospective_box_edge


def _range_bars():
    bars = [FourHour(i * FOUR_HOUR_NS, 98.0, 92.0, 95.0) for i in range(BOX_BARS)]
    for i in (5, 25):
        bars[i] = FourHour(i * FOUR_HOUR_NS, 100.0, 97.0, 98.0)
    for i in (15, 40):
        bars[i] = FourHour(i * FOUR_HOUR_NS, 93.0, 90.0, 92.0)
    return bars


class BoxSignalCases(unittest.TestCase):
    def test_close_beyond_repeated_upper_edge_arms_role_reversal(self):
        history = _range_bars()
        current = FourHour(BOX_BARS * FOUR_HOUR_NS, 102.0, 99.0, 101.0)
        assert confirmed_box_break(history, current, 1.0) == (1, 100.0, 96.75)

    def test_wick_through_edge_and_range_middle_are_idle(self):
        history = _range_bars()
        wick = FourHour(BOX_BARS * FOUR_HOUR_NS, 102.0, 98.0, 99.0)
        middle = FourHour(BOX_BARS * FOUR_HOUR_NS, 98.0, 92.0, 95.0)
        assert confirmed_box_break(history, wick, 1.0) is None
        assert confirmed_box_break(history, middle, 1.0) is None

    def test_short_stop_sits_above_lower_edge_touch_wicks(self):
        history = _range_bars()
        current = FourHour(BOX_BARS * FOUR_HOUR_NS, 91.0, 88.0, 89.0)
        assert confirmed_box_break(history, current, 1.0) == (-1, 90.0, 93.25)

    def test_requires_full_contiguous_range(self):
        history = _range_bars()
        current = FourHour(BOX_BARS * FOUR_HOUR_NS, 102.0, 99.0, 101.0)
        assert confirmed_box_break(history[1:], current, 1.0) is None
        history[30] = FourHour(31 * FOUR_HOUR_NS, 98.0, 92.0, 95.0)
        assert confirmed_box_break(history, current, 1.0) is None

    def test_requires_repeated_edges_and_registered_atr_width(self):
        history = _range_bars()
        current = FourHour(BOX_BARS * FOUR_HOUR_NS, 102.0, 99.0, 101.0)
        history[25] = FourHour(25 * FOUR_HOUR_NS, 98.0, 92.0, 95.0)
        assert confirmed_box_break(history, current, 1.0) is None
        history = _range_bars()
        assert confirmed_box_break(history, current, 0.5) is None
        assert confirmed_box_break(history, current, 3.0) is None

    def test_prospective_lower_and_upper_edge_are_distinct_orders(self):
        history = _range_bars()
        current_ns = BOX_BARS * FOUR_HOUR_NS
        lower = FourHour(current_ns, 92.0, 89.0, 90.5)
        upper = FourHour(current_ns, 101.0, 98.0, 99.5)
        assert prospective_box_edge(history, lower, 1.0) == (1, 90.0, 89.75, 95.0)
        assert prospective_box_edge(history, upper, 1.0) == (-1, 100.0, 100.25, 95.0)

    def test_range_middle_or_unconfirmed_box_cannot_arm_edge_order(self):
        history = _range_bars()
        current_ns = BOX_BARS * FOUR_HOUR_NS
        middle_with_old_lower_touch = FourHour(current_ns, 96.0, 89.0, 95.0)
        assert prospective_box_edge(history, middle_with_old_lower_touch, 1.0) is None
        history[25] = FourHour(25 * FOUR_HOUR_NS, 98.0, 92.0, 95.0)
        near_lower = FourHour(current_ns, 92.0, 90.25, 90.5)
        assert prospective_box_edge(history, near_lower, 1.0) is None

    def test_edge_plan_is_armed_only_for_the_next_four_hour_bar(self):
        history = _range_bars()
        current = FourHour(BOX_BARS * FOUR_HOUR_NS, 92.0, 89.0, 90.5)
        state = SimpleNamespace(
            atr=SimpleNamespace(initialized=True, value=1.0),
            signal_variant="box-edge-4h",
            four_hour_history=history,
            box_edge_plans=0,
            trade_start_ns=current.ts_event,
            waiting=[],
            signals=0,
            opened_ns=None,
        )
        R1Strategy._queue_four_hour_candidate(state, current)
        assert state.box_edge_plans == state.signals == len(state.waiting) == 1
        order = state.waiting[0]
        assert order.armed_ns == current.ts_event
        assert order.expires_ns == current.ts_event + FOUR_HOUR_NS
        assert (order.side, order.level, order.stop, order.target) == (
            1,
            90.0,
            89.75,
            95.0,
        )


if __name__ == "__main__":
    unittest.main()
