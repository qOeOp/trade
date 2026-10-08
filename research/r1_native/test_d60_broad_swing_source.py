"""
Check D60's causal anchor and live-bundle boundaries before a source data read.
"""

import unittest

from audit_d60_broad_swing_source import _advance_active
from audit_d60_broad_swing_source import _eligible_at_decision
from audit_d60_broad_swing_source import _plan_row
from audit_d60_broad_swing_source import _selected
from strategy import FOUR_HOUR_NS
from strategy import FourHour


def _bars() -> list[FourHour]:
    bars = [FourHour(i * FOUR_HOUR_NS, 120.0, 100.0, 115.0) for i in range(200)]
    bars[20] = FourHour(20 * FOUR_HOUR_NS, 120.0, 80.0, 115.0)
    bars[26] = FourHour(26 * FOUR_HOUR_NS, 120.0, 85.0, 115.0)
    bars[180] = FourHour(180 * FOUR_HOUR_NS, 140.0, 100.0, 135.0)
    bars[190] = FourHour(190 * FOUR_HOUR_NS, 140.0, 100.0, 135.0)
    bars[186] = FourHour(186 * FOUR_HOUR_NS, 120.0, 70.0, 115.0)
    return bars


class BroadSwingSourceCases(unittest.TestCase):
    def test_anchor_is_confirmed_by_b_and_tied_high_uses_earliest_bar(self):
        bars = _bars()
        selected = _selected(bars[:191], 190, 10.0)
        assert selected is not None
        assert selected["b_index"] == 180
        assert selected["a_index"] == 20
        assert selected["level_50"] == 110.0
        assert selected["level_618"] < selected["level_50"]
        assert selected["stop"] < selected["level_618"]

    def test_post_b_reach_prevents_late_arming_and_first_touch_preserves_second_tier(self):
        bars = _bars()
        selected = _selected(bars[:181], 180, 10.0)
        assert selected is not None
        assert _eligible_at_decision(bars, 180, selected)
        active = _plan_row(selected, 180, bars[180], bars)
        first_touch = FourHour(181 * FOUR_HOUR_NS, 130.0, 109.0, 125.0)
        active = _advance_active(active, selected, 181, first_touch)
        assert active is not None
        assert active["first_50_reach_utc"] is not None
        assert active["first_618_reach_utc"] is None
        deeper_touch = FourHour(182 * FOUR_HOUR_NS, 130.0, 102.0, 125.0)
        active = _advance_active(active, selected, 182, deeper_touch)
        assert active is not None
        assert active["first_618_reach_utc"] is not None
        bars[181] = first_touch
        assert not _eligible_at_decision(bars, 181, selected)

    def test_strictly_higher_b_supersedes_only_untouched_bundle(self):
        bars = _bars()
        selected = _selected(bars[:181], 180, 10.0)
        assert selected is not None
        new_high = {**selected, "b_high": selected["b_high"] + 1.0}
        active = _plan_row(selected, 180, bars[180], bars)
        assert _advance_active(active, new_high, 181, bars[181]) is None
        assert active["retired_reason"] == "new_strictly_higher_b_before_first_reach"
        engaged = _plan_row(selected, 180, bars[180], bars)
        engaged["first_50_reach_utc"] = "reached"
        assert _advance_active(engaged, new_high, 181, bars[181]) is engaged


if __name__ == "__main__":
    unittest.main()
