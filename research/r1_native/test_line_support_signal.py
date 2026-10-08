"""
Causal geometry checks for the registered H08 support-touch hypothesis.
"""

import unittest

from strategy import FOUR_HOUR_NS
from trendline_strategy import ConfirmedLineSupportTouches
from trendline_strategy import LineCandle


def _history() -> list[LineCandle]:
    bars = []
    for i in range(60):
        low = 100 + 0.1 * i
        if i == 10:
            low = 90
        elif i == 30:
            low = 95
        bars.append(LineCandle(i * FOUR_HOUR_NS, low + 4, low + 10, low, low + 5))
    return bars


def _replay(bars: list[LineCandle]) -> ConfirmedLineSupportTouches:
    state = ConfirmedLineSupportTouches()
    for bar in bars:
        assert state.on_closed(bar, 2.0) == []
    return state


class LineSupportSignalCases(unittest.TestCase):
    def test_confirmed_rising_lows_touch_rejection_and_prior_high_target(self):
        history = _history()
        assert 30 not in _replay(history[:38]).low_pivots
        assert 30 in _replay(history[:39]).low_pivots
        state = _replay(history)
        signal = state.on_closed(
            LineCandle(60 * FOUR_HOUR_NS, 104, 120, 102.4, 105),
            2.0,
        )
        assert len(signal) == 1
        assert (signal[0].side, signal[0].anchors) == (1, (10, 30))
        assert abs(signal[0].stop - 101.9) < 1e-8
        assert abs(signal[0].target - 115.9) < 1e-8
        assert (state.touches, state.rejections, state.room_skips) == (1, 1, 0)

    def test_preceding_bar_must_start_above_touch_band(self):
        history = _history()
        history[-1] = LineCandle(59 * FOUR_HOUR_NS, 109, 115.9, 102.5, 110)
        state = _replay(history)
        assert state.on_closed(LineCandle(60 * FOUR_HOUR_NS, 104, 106, 102.4, 105), 2.0) == []
        assert state.touches == 0

    def test_prior_high_must_offer_at_least_one_planned_r(self):
        state = _replay(_history())
        assert state.on_closed(LineCandle(60 * FOUR_HOUR_NS, 113, 115, 102.4, 114), 2.0) == []
        assert (state.rejections, state.room_skips) == (1, 1)

    def test_closed_break_kills_anchor_pair(self):
        state = _replay(_history())
        assert state.on_closed(LineCandle(60 * FOUR_HOUR_NS, 103, 104, 100, 101), 2.0) == []
        assert (10, 30) in state.dead_pairs
        assert state.on_closed(LineCandle(61 * FOUR_HOUR_NS, 104, 106, 102.65, 105), 2.0) == []
        assert state.broken_pairs == 1

    def test_input_gap_is_named_failure(self):
        state = _replay(_history())
        with self.assertRaisesRegex(RuntimeError, "not contiguous"):  # noqa: PT027
            state.on_closed(LineCandle(62 * FOUR_HOUR_NS, 104, 106, 102.4, 105), 2.0)


if __name__ == "__main__":
    unittest.main()
