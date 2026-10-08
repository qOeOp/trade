"""
Check the H19a Strategy selector against frozen D60 geometry and candle timing.
"""

import unittest

from audit_d60_broad_swing_source import _selected as frozen_selected
from broad_swing_signal import BroadSwingPullback
from strategy import FOUR_HOUR_NS
from strategy import FourHour


class BroadSwingSignalCases(unittest.TestCase):
    def test_frozen_geometry_matches_at_every_completed_synthetic_decision(self):
        bars = [FourHour(i * FOUR_HOUR_NS, 120.0, 100.0, 115.0) for i in range(200)]
        bars[20] = FourHour(20 * FOUR_HOUR_NS, 120.0, 80.0, 115.0)
        bars[180] = FourHour(180 * FOUR_HOUR_NS, 140.0, 100.0, 135.0)
        bars[186] = FourHour(186 * FOUR_HOUR_NS, 120.0, 70.0, 115.0)
        selector = BroadSwingPullback()
        for i, bar in enumerate(bars):
            plan = selector.on_closed(bar, 10.0)
            assert selector.last_selected == frozen_selected(bars[: i + 1], i, 10.0)
            if i == 180:
                assert plan is not None
                assert (plan.a_index, plan.b_index) == (20, 180)
                assert plan.entry == 110.0
                assert plan.stop == selector.last_selected["stop"]
            if i == 190:
                assert selector.last_selected is not None
                assert plan is None

    def test_incomplete_four_hour_sequence_is_rejected(self):
        selector = BroadSwingPullback()
        selector.on_closed(FourHour(0, 120.0, 100.0, 115.0), None)
        try:
            selector.on_closed(FourHour(2 * FOUR_HOUR_NS, 120.0, 100.0, 115.0), 10.0)
        except RuntimeError as e:
            if "not contiguous" not in str(e):
                self.fail(f"unexpected four-hour input error: {e}")
        else:
            self.fail("four-hour input gap was accepted")


if __name__ == "__main__":
    unittest.main()
