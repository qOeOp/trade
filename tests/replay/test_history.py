"""The closing history test (replay.history, ledger.lines history_*, report.history): segments, the runner,
the line-close requirement and the reading."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from cli import main
from ledger import admin, lines
from replay import entry, history
from report import history as report_history
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid


class SegmentTests(unittest.TestCase):
    def test_segments_are_the_years_before_the_period_the_period_and_the_forward_part(self):
        found = lines.history_segments(date(2025, 10, 1), date(2026, 10, 1), date(2019, 9, 1), date(2026, 11, 11))
        self.assertEqual([(item["kind"], item["label"], item["start"], item["end"]) for item in found], [
            ("year", "2019", date(2019, 9, 1), date(2020, 1, 1)),
            *[("year", str(year), date(year, 1, 1), date(year + 1, 1, 1)) for year in range(2020, 2025)],
            ("year", "2025", date(2025, 1, 1), date(2025, 10, 1)),
            ("control", "development", date(2025, 10, 1), date(2026, 10, 1)),
            ("forward", "forward", date(2026, 10, 1), date(2026, 11, 11))])

    def test_a_period_at_the_market_start_and_end_has_only_the_control(self):
        found = lines.history_segments(date(2026, 1, 1), date(2026, 4, 1), date(2026, 1, 1), date(2026, 4, 1))
        self.assertEqual([item["kind"] for item in found], ["control"])


@unittest.skipUnless(BINARY, SKIP)
class HistoryRunTests(unittest.TestCase):
    def setUp(self):
        self.world = ReplayWorld("history")

    def tearDown(self):
        self.world.close()

    def test_a_line_closes_only_after_every_segment_has_a_history_run(self):
        world = self.world
        line = world.line["line"]
        registration, (ref,) = registered_grid(world, ["kept"])  # an open line takes a registration
        passed = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                           registration=registration)
        self.assertEqual(passed["status"], "passed")
        days = (date(2025, 11, 1), date(2026, 4, 1))  # the fake market: 2025-11 to its latest day 2026-03-31
        with self.assertRaises(Refusal) as refused:
            lines.close_line(world.profile, line, b"summary", days)
        self.assertEqual(refused.exception.code, "HISTORY_INCOMPLETE")
        self.assertEqual(len(refused.exception.missing), 3, "2025 (from November), the control and the forward part")

        first = history.run_history(world.profile, world.market, MARKET_COMMIT, line, limit=1)
        self.assertEqual((len(first["ran"]), first["left"], first["participants"]), (1, 2, 1))
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": passed["trial_id"]}])
        late = world.publish("late", parent=None)
        reviews = {late["candidate"]: world.prechecked(late["source"])}
        with self.assertRaises(Refusal) as closing:
            world.register(world.body([late["candidate"]], reviews))
        self.assertEqual(closing.exception.code, "LINE_ENDED", "the first history trial began the line's closing")
        rest = history.run_history(world.profile, world.market, MARKET_COMMIT, line)
        self.assertEqual((len(rest["ran"]), rest["left"]), (2, 0))
        self.assertEqual(history.run_history(world.profile, world.market, MARKET_COMMIT, line)["ran"], [],
                         "a rerun resumes: nothing is left")

        read = report_history.research_history(world.profile, line=line)["lines"][0]
        self.assertEqual(read["participants"], 1)
        (row,) = read["rows"]
        self.assertEqual(row["run"], passed["trial_id"])
        self.assertTrue(row["control_reproduces"], "the control replays the research run bit for bit")
        cells = {cell["kind"]: cell for cell in row["cells"]}
        self.assertEqual(set(cells), {"year", "control", "forward"})
        self.assertEqual(cells["year"]["trade_start"], "2025-11-02T00:00:00",
                         "the year starts one warm-up day after the market's first day")
        self.assertFalse(cells["year"]["whole_year"])
        self.assertEqual(cells["forward"]["trade_end"], "2026-04-01T00:00:00")
        self.assertEqual(row["summary"]["whole_years"], 0)
        self.assertIsNone(row["summary"]["meets_targets"], "no whole year outside the period to judge by")

        backups = Path(tempfile.mkdtemp(prefix="backups-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, backups, True)
        profile = replace(world.profile, backup_root=backups / "export")
        with patch.object(main, "_market_days", return_value=days):
            closed = main.line_close(profile, line, b"summary", {})
        self.assertFalse(closed["replayed"])
        self.assertEqual(closed["backup"]["ledger_commit"], closed["ledger_commit"], "U2: closing syncs the backup")
        self.assertEqual(admin.backup_head(admin.backup_path(profile)), closed["ledger_commit"])
        with self.assertRaises(Refusal) as ended:
            history.run_history(world.profile, world.market, MARKET_COMMIT, line)
        self.assertEqual(ended.exception.code, "LINE_ENDED")

    def test_a_control_that_does_not_reproduce_the_run_voids_its_row(self):
        world = self.world
        line = world.line["line"]
        registration, (ref,) = registered_grid(world, ["drifting"])
        entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV, registration=registration)
        world.fingerprint = {"fills": {"rows": 3, "sha256": "1" * 64, "by_utc_day": {}}}
        history.run_history(world.profile, world.market, MARKET_COMMIT, line)
        (row,) = report_history.research_history(world.profile, line=line)["lines"][0]["rows"]
        self.assertIs(row["control_reproduces"], False)
        self.assertIsNone(row["summary"])


if __name__ == "__main__":
    unittest.main()
