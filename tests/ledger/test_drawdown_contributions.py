"""Native cumulative realized snapshots isolate peak-to-trough contributions."""

from decimal import Decimal
import unittest

from ledger import metrics


class DrawdownContributionTests(unittest.TestCase):
    def section(self, snapshots, closed=(), peak=100, starting=100):
        exposures = metrics.ExposureTable([
            {"ts_event_ns": t, "position_id": name, "notional_value": Decimal(1),
             "realized_pnl": realized, "unrealized_pnl": Decimal(mark)} for t, name, realized, mark in snapshots])
        positions = [{"position_id": "A", "instrument_id": "A"}, {"position_id": "B", "instrument_id": "B"}]
        cycles = [{"closed": False}, {"closed": False}]
        for name, last, realized in closed:
            positions.append({"position_id": name + "-snapshot", "instrument_id": name})
            cycles.append({"closed": True, "ts_last": last, "realized": Decimal(realized)})
        drawn = {"peak_ns": peak, "trough_ns": 200, "max_drawdown": .15}
        return metrics._drawdown_section(drawn, [{"label": 100, "equity": Decimal(100)},
                                                 {"label": 200, "equity": Decimal(70)}],
                                         cycles, positions, exposures, Decimal(starting))

    def test_peak_mark_is_subtracted_and_partial_realization_included(self):
        found = self.section([(100, "A", Decimal(-2), 100), (100, "B", Decimal(0), 0),
                              (200, "A", Decimal(3), 85), (200, "B", Decimal(0), -20)])
        self.assertAlmostEqual(found["top_instrument_share_in_drawdown@3"]["value"], 2 / 3)
        self.assertEqual(found["top_instrument@3"]["value"], "B")

    def test_closed_and_reopened_cycles_keep_only_interval_changes(self):
        # A's earlier +50 cancels; the cycle open at peak has R=-2,U=12, closes R=5.
        # A reopens with R=-1,U=-4 => A loses 10; B loses 20.
        unit = 60 * 10**9
        # Use separated minute labels, not integer timestamps inside one observer interval.
        snapshots = [(100, "A", Decimal(-2), 12), (100, "B", Decimal(0), 0),
                     (200, "A", Decimal(-1), -4), (200, "B", Decimal(0), -20)]
        exposures = metrics.ExposureTable([{ "ts_event_ns": t * unit, "position_id": name,
                     "notional_value": Decimal(1), "realized_pnl": r, "unrealized_pnl": Decimal(u)}
                     for t, name, r, u in snapshots])
        positions = [{"position_id": name, "instrument_id": name} for name in ("A", "B", "old", "closed")]
        positions[2]["instrument_id"] = positions[3]["instrument_id"] = "A"
        cycles = [{"closed": False}, {"closed": False}, {"closed": True, "ts_last": 50 * unit, "realized": Decimal(50)},
                  {"closed": True, "ts_last": 150 * unit, "realized": Decimal(5)}]
        found = metrics._drawdown_section({"peak_ns": 100 * unit, "trough_ns": 200 * unit, "max_drawdown": .3},
                   [{"label": 100 * unit, "equity": Decimal(100)}, {"label": 200 * unit, "equity": Decimal(70)}],
                   cycles, positions, exposures, Decimal(100))
        self.assertAlmostEqual(found["top_instrument_share_in_drawdown@3"]["value"], 2 / 3)

    def test_initial_peak_preserves_first_losses_and_positive_offsets(self):
        found = self.section([(200, "A", Decimal(-10), -30), (200, "B", Decimal(0), 10)], peak=None)
        self.assertEqual(found["top_instrument_share_in_drawdown@3"]["value"], 1.0)

    def test_missing_or_corrupt_snapshot_invalidates_only_contributions(self):
        for realized, reason in ((None, "NATIVE_REALIZED_SNAPSHOT_MISSING"),
                                 (Decimal(999), "DRAWDOWN_CONTRIBUTION_UNRECONCILED")):
            found = self.section([(100, "A", Decimal(0), 0), (200, "A", realized, -30)])
            self.assertIsNone(found["top_instrument_share_in_drawdown@3"]["value"])
            self.assertEqual(found["top_instrument_share_in_drawdown@3"]["null_reason"], reason)
            self.assertEqual(found["mark_max_drawdown@2"]["value"], .15)
