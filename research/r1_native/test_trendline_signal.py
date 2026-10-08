"""
Causal geometry checks for H06 before reading native economic results.
"""

import unittest

from strategy import FOUR_HOUR_NS
from trendline_strategy import ConfirmedLineBreaks
from trendline_strategy import LineCandle


def _history() -> list[LineCandle]:
    bars = []
    for i in range(40):
        high = 99.0 - 0.1 * i
        if i == 10:
            high = 110.0
        if i == 30:
            high = 105.0
        bars.append(LineCandle(i * FOUR_HOUR_NS, high - 2, high, high - 3, high - 1))
    return bars


def _replay(bars: list[LineCandle]) -> tuple[ConfirmedLineBreaks, list]:
    state = ConfirmedLineBreaks()
    events = []
    for bar in bars:
        events.extend(state.on_closed(bar, 2.0))
    return state, events


class TrendlineSignalCases(unittest.TestCase):
    def test_two_confirmed_falling_highs_and_strong_first_close(self):
        history = _history()
        state, before = _replay(history)
        assert before == []
        assert state.high_pivots[-2:] == [10, 30]
        # The second anchor at 30 was not available until bar 38 closed.
        assert 30 not in _replay(history[:38])[0].high_pivots
        assert 30 in _replay(history[:39])[0].high_pivots

        candidate = LineCandle(40 * FOUR_HOUR_NS, 100.0, 105.0, 99.0, 104.0)
        signal = state.on_closed(candidate, 2.0)
        assert len(signal) == 1
        assert (signal[0].side, signal[0].anchors) == (1, (10, 30))
        assert (signal[0].stop, signal[0].target) == (99.0, 114.0)

    def test_weak_first_cross_consumes_the_anchor_pair(self):
        state, _ = _replay(_history())
        weak = LineCandle(40 * FOUR_HOUR_NS, 102.0, 104.0, 100.0, 103.0)
        strong_later = LineCandle(41 * FOUR_HOUR_NS, 99.0, 106.0, 98.0, 105.0)
        assert state.on_closed(weak, 2.0) == []
        assert (state.first_crosses, state.weak_crosses) == (1, 1)
        assert state.on_closed(strong_later, 2.0) == []

    def test_first_cross_during_signal_warmup_still_consumes_pair(self):
        history = _history()
        # Put the second pivot at 20 so its eighth confirming bar is 28.
        history[20] = LineCandle(20 * FOUR_HOUR_NS, 103.0, 105.0, 101.0, 102.0)
        history[30] = LineCandle(30 * FOUR_HOUR_NS, 95.0, 96.0, 93.0, 94.0)
        history[29] = LineCandle(29 * FOUR_HOUR_NS, 99.0, 102.0, 98.0, 101.0)
        state, events = _replay(history)
        assert events == []
        assert (1, 10, 20) in state.dead_pairs
        later = state.on_closed(LineCandle(40 * FOUR_HOUR_NS, 96.0, 101.0, 95.0, 100.0), 2.0)
        assert all(event.anchors != (10, 20) for event in later)

    def test_rising_lows_can_signal_the_symmetric_short(self):
        mirrored = [
            LineCandle(bar.ts_event, 200 - bar.open, 200 - bar.low, 200 - bar.high, 200 - bar.close)
            for bar in _history()
        ]
        state, before = _replay(mirrored)
        assert before == []
        original = LineCandle(40 * FOUR_HOUR_NS, 100.0, 105.0, 99.0, 104.0)
        candidate = LineCandle(
            original.ts_event,
            200 - original.open,
            200 - original.low,
            200 - original.high,
            200 - original.close,
        )
        signal = state.on_closed(candidate, 2.0)
        assert len(signal) == 1
        assert (signal[0].side, signal[0].anchors) == (-1, (10, 30))
        assert (signal[0].stop, signal[0].target) == (101.0, 86.0)

    def test_gap_in_four_hour_input_is_a_named_failure(self):
        state, _ = _replay(_history())
        with self.assertRaisesRegex(RuntimeError, "not contiguous"):  # noqa: PT027
            state.on_closed(LineCandle(41 * FOUR_HOUR_NS, 100, 105, 99, 104), 2.0)


if __name__ == "__main__":
    unittest.main()
