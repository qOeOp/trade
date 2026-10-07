"""
Source geometry checks for the native four-hour box signal.
"""

import unittest

from strategy import BOX_BARS
from strategy import FOUR_HOUR_NS
from strategy import FourHour
from strategy import confirmed_box_break


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


if __name__ == "__main__":
    unittest.main()
