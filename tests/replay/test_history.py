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
from report import history as report_history, status
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid


class SegmentTests(unittest.TestCase):
    def test_segments_are_the_veto_years_the_period_the_holdout_and_the_forward_part(self):
        found = lines.history_segments(date(2021, 10, 1), date(2024, 10, 1), date(2019, 9, 1), date(2026, 11, 11))
        self.assertEqual([(item["kind"], item["label"], item["start"], item["end"]) for item in found], [
            ("veto", "2019", date(2019, 9, 1), date(2020, 1, 1)),
            ("veto", "2020", date(2020, 1, 1), date(2021, 1, 1)),
            ("veto", "2021", date(2021, 1, 1), date(2021, 10, 1)),
            ("control", "development", date(2021, 10, 1), date(2024, 10, 1)),
            ("holdout", "holdout", date(2024, 10, 1), date(2026, 10, 1)),
            ("forward", "forward", date(2026, 10, 1), date(2026, 11, 11))])

    def test_a_period_at_the_market_start_and_end_has_only_the_control(self):
        found = lines.history_segments(date(2026, 1, 1), date(2026, 4, 1), date(2026, 1, 1), date(2026, 4, 1))
        self.assertEqual([item["kind"] for item in found], ["control"])

    def test_a_holdout_the_market_does_not_reach_yet_is_cut_at_its_last_day(self):
        found = lines.history_segments(date(2026, 1, 1), date(2026, 2, 1), date(2026, 1, 1), date(2026, 4, 1))
        self.assertEqual([(item["kind"], item["start"], item["end"]) for item in found], [
            ("control", date(2026, 1, 1), date(2026, 2, 1)), ("holdout", date(2026, 2, 1), date(2026, 4, 1))])


class VerdictTests(unittest.TestCase):
    """3.7 (user 2026-11-11, "否决和留出分开都要过"): the veto years and the holdout are judged apart on the two targets,
    and a candidate meets them when both pass; with no countable veto year, on the holdout alone."""

    TARGETS = {"max_drawdown": 0.2, "annual_return": 0.3}

    @staticmethod
    def cell(kind, annual, drawdown, whole=True, short=False):
        return {"kind": kind, "whole_year": kind == "veto" and whole, "short": short,
                "measures": {"annual_return": annual, "mark_max_drawdown": drawdown}}

    def summary(self, *cells):
        return report_history._summary(list(cells), self.TARGETS)

    def test_both_must_pass(self):
        years = [self.cell("veto", 0.1, 0.15), self.cell("veto", 0.5, 0.1), self.cell("veto", 0.4, 0.18)]
        passed = self.summary(*years, self.cell("holdout", 0.35, 0.12))
        self.assertEqual((passed["veto"]["meets_targets"], passed["holdout"]["meets_targets"], passed["meets_targets"],
                          passed["judged_on"]), (True, True, True, "veto and holdout"),
                         "a year below the return target is fine while the median reaches it")
        self.assertIs(self.summary(*years, self.cell("holdout", 0.25, 0.12))["meets_targets"], False)
        self.assertIs(self.summary(*years[:2], self.cell("veto", 0.9, 0.25), self.cell("holdout", 0.35, 0.12))
                      ["meets_targets"], False, "one veto year over the drawdown target fails the veto")

    def test_without_a_countable_veto_year_the_holdout_alone_decides(self):
        found = self.summary(self.cell("veto", -0.5, 0.6, whole=False), self.cell("holdout", 0.35, 0.12))
        self.assertEqual((found["veto"]["meets_targets"], found["meets_targets"], found["judged_on"]),
                         (None, True, "holdout"))
        short = self.summary(self.cell("veto", 0.5, 0.1), self.cell("holdout", 0.35, 0.12, short=True))
        self.assertEqual((short["meets_targets"], short["judged_on"]), (None, None), "a short holdout counts in nothing")


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
        self.assertEqual(len(refused.exception.missing), 3, "2025 (from November), the control and the holdout")

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
        self.assertEqual(set(cells), {"veto", "control", "holdout"})
        self.assertEqual(cells["veto"]["trade_start"], "2025-11-02T00:00:00",
                         "the year starts one warm-up day after the market's first day")
        self.assertFalse(cells["veto"]["whole_year"])
        self.assertEqual((cells["holdout"]["trade_start"], cells["holdout"]["trade_end"]),
                         ("2026-02-01T00:00:00", "2026-04-01T00:00:00"), "the holdout, cut at the market's last day")
        self.assertEqual(row["summary"]["veto"]["whole_years"], 0)
        self.assertTrue(cells["holdout"]["short"], "two months of holdout in the fixture market")
        self.assertEqual((row["summary"]["meets_targets"], row["summary"]["judged_on"]), (None, None),
                         "neither a whole veto year nor a countable holdout to judge by")

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
        # L11: a closed line is read when named, never by default
        self.assertEqual((lines.list_lines(world.profile)["lines"], status.research_runs(world.profile)["runs"],
                          status.research_status(world.profile)["lines"]), ([], [], []))
        self.assertEqual([item["trial_id"] for item in status.research_runs(world.profile, line=line)["runs"]],
                         [passed["trial_id"]])
        self.assertEqual(status.research_status(world.profile, line=line)["research_attempts"], 1)

    def test_a_grid_point_registered_before_the_closing_runs_no_more(self):
        """The first history trial fixed the candidates, so a grid point still unrun takes no research run."""
        world = self.world
        line = world.line["line"]
        registration, (ref,) = registered_grid(world, ["kept"])
        pending, (later,) = registered_grid(world, ["unrun"])  # its own grid: no exposure to the history trial
        entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV, registration=registration)
        history.run_history(world.profile, world.market, MARKET_COMMIT, line, limit=1)
        trials = world.conn.rows("SELECT COUNT(*) FROM trial")
        with self.assertRaises(Refusal) as refused:
            entry.run(world.profile, world.market, MARKET_COMMIT, later, None, RUNNER_ARGV, registration=pending)
        self.assertEqual(refused.exception.code, "LINE_ENDED")
        self.assertIn("a research run now would be a result the test leaves out", refused.exception.message)
        self.assertEqual(world.conn.rows("SELECT COUNT(*) FROM trial"), trials, "no trial was written")

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
