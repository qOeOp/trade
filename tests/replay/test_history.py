"""The closing history test (replay.history, ledger.lines history_*, report.history): segments, the runner,
the line-close requirement and the reading."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
import math
from pathlib import Path
import shutil
import statistics
import tempfile
import unittest
from unittest.mock import patch

from cli import research_commands
from ledger import admin, lines, strategies, targets
from registration import precheck
from replay import entry, history
from report import graph, history as report_history, measures, runs, status
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, MARKET_DAY, SKIP
from tests.registration.test_register import second_line
from tests.registration.world import RUNNER_ARGV, config, months_rows
from tests.replay import world as replay_world
from tests.replay.world import Market, ReplayWorld, registered_grid


YEARS_MONTHS = [f"{year}-{month:02d}" for year in range(2023, 2027) for month in range(1, 13)][11:43]  # 2023-12 to 2026-07


class YearsMarket(Market):
    """The fake market from December 2023 to July 2026: before the fixtures' January 2026 development period lie the
    whole years 2024 and 2025, after it a six-month holdout."""

    def days(self, market_day):
        return date(2023, 12, 1), date(2026, 7, 31)


def windowed(identity, runner_argv, inputs):
    """The stand-in probe reporting the window the runner was given (the fixtures' reports January whatever ran, so
    a history run over another window is invalid: COVERAGE_MISMATCH)."""
    at = {name: runner_argv[runner_argv.index(name) + 1] for name in ("--start", "--trade-start", "--end")}
    return {"runtime_contract": identity["runtime_contract"], "effective_config": config(
        symbols=inputs["symbols"], root=str(inputs["root"]), start=at["--start"], trade_start=at["--trade-start"],
        end=at["--end"])}


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
    and a candidate meets them when both pass; a test with no whole veto year is judged on the holdout alone. A verdict
    needs every reading it is defined on (20261114-12, user 2026-11-15): with one missing it is undecided."""

    TARGETS = {"max_drawdown": 0.2, "annual_return": 0.3}
    HOLDOUT = {"kind": "holdout", "label": "holdout", "whole_year": False, "short": False,
               "measures": {"annual_return": 0.35, "mark_max_drawdown": 0.12}}

    @staticmethod
    def cell(kind, annual, drawdown, whole=True, short=False, label="2020"):
        return {"kind": kind, "label": label, "whole_year": kind == "veto" and whole, "short": short,
                "measures": {"annual_return": annual, "mark_max_drawdown": drawdown}}

    @staticmethod
    def unread(label, status="invalid"):
        """A whole veto year whose run is invalid, or whose trial has no run (status None): no measures."""
        return {"kind": "veto", "label": label, "whole_year": True, "short": False, "status": status}

    def summary(self, *cells, targets=TARGETS, control=True):
        return report_history._summary(list(cells), targets, control)

    @staticmethod
    def verdict(found):
        return found["meets_targets"], found["judged_on"], found["missing"]

    def test_both_must_pass(self):
        years = [self.cell("veto", 0.1, 0.15, label="2019"), self.cell("veto", 0.5, 0.1),
                 self.cell("veto", 0.4, 0.18, label="2021")]
        passed = self.summary(*years, self.HOLDOUT)
        self.assertEqual((passed["veto"]["meets_targets"], passed["holdout"]["meets_targets"], *self.verdict(passed)),
                         (True, True, True, "veto and holdout", []),
                         "a year below the return target is fine while the median reaches it")
        self.assertEqual(self.verdict(self.summary(*years, self.cell("holdout", 0.25, 0.12))),
                         (False, "veto and holdout", []))
        self.assertIs(self.summary(*years[:2], self.cell("veto", 0.9, 0.25, label="2021"), self.HOLDOUT)
                      ["meets_targets"], False, "one veto year over the drawdown target fails the veto")

    def test_a_test_without_a_whole_veto_year_is_judged_on_the_holdout_alone(self):
        found = self.summary(self.cell("veto", -0.5, 0.6, whole=False), self.HOLDOUT)
        self.assertEqual((found["veto"]["whole_years"], found["veto"]["meets_targets"], *self.verdict(found)),
                         (0, None, True, "holdout", []))

    def test_a_whole_veto_year_without_readings_leaves_the_verdict_undecided(self):
        """Before, such a year left the veto's denominator: the others, or the holdout alone, decided."""
        every = self.summary(self.unread("2020"), self.unread("2021", status=None), self.HOLDOUT)
        self.assertEqual((every["veto"]["whole_years"], every["veto"]["meets_targets"], every["holdout"]["meets_targets"]),
                         (2, None, True), "the years stay counted, and the holdout keeps its own verdict")
        self.assertEqual(self.verdict(every), (None, None, ["veto 2020", "veto 2021"]), "not the holdout alone")
        one = self.summary(self.cell("veto", 0.5, 0.1, label="2019"), self.unread("2020"),
                           self.cell("veto", 0.4, 0.1, label="2021"), self.HOLDOUT)
        self.assertEqual(self.verdict(one), (None, None, ["veto 2020"]))
        self.assertEqual((one["veto"]["whole_years"], one["veto"]["profitable_years"], one["veto"]["median_annual_return"],
                          one["veto"]["years_meeting_targets"], one["veto"]["meets_targets"]), (3, 2, 0.45, None, None),
                         "the readings are those of the years read; no verdict on a part of the years")
        over = self.summary(self.unread("2020"), self.cell("veto", 0.4, 0.5, label="2021"), self.HOLDOUT)
        self.assertEqual(self.verdict(over), (None, None, ["veto 2020"]), "undecided whatever the other years read")
        unknown = self.summary(self.cell("veto", None, 0.1), self.cell("veto", 0.4, 0.1, label="2021"), self.HOLDOUT)
        self.assertEqual(self.verdict(unknown), (None, None, ["veto 2020"]), "a passed year without its annual return")

    def test_a_year_takes_its_run_with_readings(self):
        """A trial left without a run (the host died) is replayed again: the year reads its rerun."""
        found = self.summary(self.unread("2020", status=None), self.cell("veto", 0.5, 0.1), self.HOLDOUT)
        self.assertEqual((found["veto"]["whole_years"], *self.verdict(found)), (1, True, "veto and holdout", []))

    def test_without_a_control_run_nothing_is_decided(self):
        found = self.summary(self.cell("veto", 0.5, 0.1), self.HOLDOUT, control=False)
        self.assertEqual((found["veto"]["meets_targets"], found["holdout"]["meets_targets"], *self.verdict(found)),
                         (True, True, None, None, ["control"]))

    def test_without_a_countable_holdout_or_targets_nothing_is_decided(self):
        short = self.summary(self.cell("veto", 0.5, 0.1), self.cell("holdout", 0.35, 0.12, short=True))
        self.assertEqual(self.verdict(short), (None, None, ["holdout"]), "a short holdout counts in nothing")
        invalid = self.summary(self.cell("veto", 0.5, 0.1), {"kind": "holdout", "label": "holdout", "short": False})
        self.assertEqual(self.verdict(invalid), (None, None, ["holdout"]))
        self.assertEqual(self.verdict(self.summary(self.cell("veto", 0.5, 0.1), self.cell("holdout", 0.35, None))),
                         (None, None, ["holdout"]))
        every = self.summary(self.unread("2020"), control=False, targets=None)
        self.assertEqual(self.verdict(every), (None, None, ["veto 2020", "control", "holdout", "targets"]))
        self.assertEqual(self.verdict(self.summary(self.cell("veto", 0.5, 0.1), self.HOLDOUT, targets=None)),
                         (None, None, ["targets"]))


class DiscountTests(unittest.TestCase):
    """3.7: a candidate picked by these readings is picked among the participants, so each holdout's deflated Sharpe
    takes the participant count as its trials, through the one formula (measures.deflated_sharpe)."""

    @staticmethod
    def row(run, holdout, short=False, summary=True):
        return {"run": run, "cells": [{"kind": "veto", "trial_id": run * 10, "short": False},
                                      {"kind": "holdout", "trial_id": holdout, "short": short}],
                "summary": {"holdout": {}} if summary else None}

    def test_each_holdout_is_deflated_at_the_participant_count(self):
        returns = {1: [0.01, -0.005, 0.02, 0.0, 0.004] * 20, 2: [0.002, -0.01, 0.006, 0.001] * 25,
                   3: [-0.004, 0.003, -0.002, 0.001, 0.0] * 20}
        rows = [self.row(1, 1), self.row(2, 2), self.row(3, 3), self.row(4, None, summary=False)]
        found = report_history._discount(rows, returns)
        daily = [measures.sharpe_365(returns[trial]) / math.sqrt(365) for trial in (1, 2, 3)]
        self.assertEqual(found, {"trials": 4, "holdouts_with_returns": 3, "daily_sharpe_variance": statistics.variance(daily)})
        for row, trial in zip(rows[:3], (1, 2, 3), strict=True):
            self.assertEqual(row["summary"]["holdout"]["deflated_sharpe"],
                             measures.deflated_sharpe(returns[trial], 4, statistics.variance(daily)))
        self.assertGreater(rows[0]["summary"]["holdout"]["deflated_sharpe"], rows[2]["summary"]["holdout"]["deflated_sharpe"])
        self.assertIsNone(rows[3]["summary"], "a row whose control does not reproduce gets no summary")

    def test_a_short_or_missing_holdout_has_no_deflated_sharpe(self):
        rows = [self.row(1, 1, short=True), self.row(2, 2)]
        found = report_history._discount(rows, {2: [0.01, -0.01, 0.02] * 10})
        self.assertEqual((found["holdouts_with_returns"], found["daily_sharpe_variance"]), (1, None))
        self.assertIsNone(rows[0]["summary"]["holdout"]["deflated_sharpe"])
        self.assertIsNone(rows[1]["summary"]["holdout"]["deflated_sharpe"], "one holdout leaves no variance")


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
        passed = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV,
                           registration=registration)
        self.assertEqual(passed["status"], "passed")
        days = (date(2025, 11, 1), date(2026, 4, 1))  # the fake market: 2025-11 to its latest day 2026-03-31
        with self.assertRaises(Refusal) as refused:
            lines.close_line(world.profile, line, b"summary", days)
        self.assertEqual(refused.exception.code, "HISTORY_INCOMPLETE")
        self.assertEqual(len(refused.exception.missing), 3, "2025 (from November), the control and the holdout")

        first = history.run_history(world.profile, world.market, MARKET_DAY, line, limit=1)
        self.assertEqual((len(first["ran"]), first["left"], first["participants"]), (1, 2, 1))
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": passed["trial_id"]}])
        late = world.publish("late", parent=None)
        reviews = {late["candidate"]: world.prechecked(late["source"])}
        with self.assertRaises(Refusal) as closing:
            world.register(world.body([late["candidate"]], reviews))
        self.assertEqual(closing.exception.code, "LINE_ENDED", "the first history trial began the line's closing")
        rest = history.run_history(world.profile, world.market, MARKET_DAY, line)
        self.assertEqual((len(rest["ran"]), rest["left"]), (2, 0))
        self.assertEqual(history.run_history(world.profile, world.market, MARKET_DAY, line)["ran"], [],
                         "a rerun resumes: nothing is left")

        read = report_history.research_history(world.profile, line=line)["lines"][0]
        self.assertEqual(read["participants"], 1)
        (row,) = read["rows"]
        self.assertEqual(row["run"], passed["trial_id"])
        self.assertRegex(row["candidate"], r"^[\w.-]+@\d+$", "the participant is named as the IDE names a version")
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
        self.assertEqual((row["summary"]["meets_targets"], row["summary"]["judged_on"], row["summary"]["missing"]),
                         (None, None, ["holdout", "targets"]),
                         "no whole veto year; no countable holdout to judge by, and the fixture line has no targets")

        # 20261120-04: a sealed history run reads as a research run does, on the Runs page and in `replay report`,
        # and still enters no research comparison or ranking (the research_runs assertions below).
        control = cells["control"]["trial_id"]
        report = runs.run_report(world.profile, control)
        self.assertEqual((report["availability"]["economic_evidence_available"], report["availability"]["reasons"]),
                         (True, []))
        self.assertIsNotNone(report["headline"], "its readings are not masked")
        self.assertTrue(runs.tables(control, world.profile)["daily_returns"], "--tables reads it")
        drawn = graph.research_graph(world.profile, line, comparisons=False, counts=False)
        found = next(t for c in drawn["candidates"] for t in c["trials"] if t["trial_id"] == control)
        self.assertEqual((found["purpose"], found["eligible"]), ("history", True))
        self.assertIsNotNone(found["annual_return"])
        self.assertEqual([item["trial_id"] for item in status.research_runs(world.profile)["runs"]], [passed["trial_id"]],
                         "no history run among the line's research runs")

        backups = Path(tempfile.mkdtemp(prefix="backups-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, backups, True)
        profile = replace(world.profile, backup_root=backups / "export")
        with patch.object(research_commands, "_market_days", return_value=days):
            closed = research_commands.line_close(profile, line, b"summary", {})
        self.assertFalse(closed["replayed"])
        self.assertEqual(closed["backup"]["ledger_commit"], closed["ledger_commit"], "U2: closing syncs the backup")
        self.assertEqual(admin.backup_head(admin.backup_path(profile)), closed["ledger_commit"])
        with self.assertRaises(Refusal) as ended:
            history.run_history(world.profile, world.market, MARKET_DAY, line)
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
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        history.run_history(world.profile, world.market, MARKET_DAY, line, limit=1)
        trials = world.conn.rows("SELECT COUNT(*) FROM trial")
        with self.assertRaises(Refusal) as refused:
            entry.run(world.profile, world.market, MARKET_DAY, later, None, RUNNER_ARGV, registration=pending)
        self.assertEqual(refused.exception.code, "LINE_ENDED")
        self.assertIn("a research run now would be a result the test leaves out", refused.exception.message)
        self.assertEqual(world.conn.rows("SELECT COUNT(*) FROM trial"), trials, "no trial was written")

    def test_a_holdout_counts_the_earlier_searches_of_a_line_sharing_it(self):
        """20261112-17: lines opened in one quarter share a holdout, so one line's closing replays are earlier
        searches of the other's holdout; a line's own history trials are not."""
        world = self.world
        mine = world.line["line"]
        registration, (ref,) = registered_grid(world, ["mine"])
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        other = second_line(world, "rsi-twin")  # the same development period and holdout
        self.assertEqual((lines.read_line(world.conn, other)["dev_end"], lines.read_line(world.conn, mine)["dev_end"]),
                         ("2026-02-01", "2026-02-01"))
        theirs = world.publish("theirs", parent=None)
        body = world.body([theirs["candidate"]], {theirs["candidate"]: world.prechecked(theirs["source"])})
        entry.run(world.profile, world.market, MARKET_DAY, theirs["candidate"], None, RUNNER_ARGV,
                  registration=world.register(body, line=other)["registration_id"])

        def prior(line):
            return report_history.research_history(world.profile, line=line)["lines"][0]["holdout_prior_trials"]

        history.run_history(world.profile, world.market, MARKET_DAY, mine)
        self.assertEqual((prior(mine)["trials"], prior(mine)["by_line"]), (0, []),
                         "the line's own holdout replay is not an earlier search of it")
        self.assertEqual(prior(mine)["instruments"], ["AAAUSDT", "BBBUSDT"], "those of its research trials")
        self.assertEqual(prior(other)["by_line"], [{"line": mine, "purpose": "history", "trials": 1}],
                         "the other line's holdout replay; its veto year and control end before the holdout")
        history.run_history(world.profile, world.market, MARKET_DAY, other)
        self.assertEqual(prior(mine)["by_line"], [{"line": other, "purpose": "history", "trials": 1}])
        self.assertEqual(prior(other)["trials"], 1, "unchanged by its own closing")
        by_line = report_history.research_history(world.profile)["lines"]
        self.assertEqual([item["holdout_prior_trials"]["trials"] for item in by_line], [1, 1])

    def test_a_control_that_does_not_reproduce_the_run_voids_its_row(self):
        world = self.world
        line = world.line["line"]
        registration, (ref,) = registered_grid(world, ["drifting"])
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        world.fingerprint = {"fills": {"rows": 3, "sha256": "1" * 64, "by_utc_day": {}}}
        history.run_history(world.profile, world.market, MARKET_DAY, line)
        (row,) = report_history.research_history(world.profile, line=line)["lines"][0]["rows"]
        self.assertIs(row["control_reproduces"], False)
        self.assertIsNone(row["summary"])

    def test_an_invalid_whole_veto_year_or_a_missing_control_leaves_the_verdict_undecided(self):
        """20261114-12: before, the invalid year left the veto's denominator and a row without a control run was
        judged all the same, so this row read `meets_targets` true twice."""
        world = self.world
        line = world.line["line"]
        world.market = YearsMarket({MARKET_DAY: months_rows(YEARS_MONTHS)})
        targets.set_targets(world.conn, world.line["line_id"], 0.2, 0.2)
        registration, (ref,) = registered_grid(world, ["kept"])
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        segments = lines.history_segments

        def summary():
            (row,) = report_history.research_history(world.profile, line=line)["lines"][0]["rows"]
            return row["control_reproduces"], row["summary"]

        def replay(count, **scenario):
            world.scenario = {"returns": [0.001], **scenario}  # about 44% a year with no drawdown
            return [(item["segment"], item["status"]) for item in
                    history.run_history(world.profile, world.market, MARKET_DAY, line, limit=count)["ran"]]

        with patch.object(replay_world, "inspect_stand_in", windowed):
            self.assertEqual(replay(1), [("2023", "passed")])
            self.assertEqual(replay(1, audit_passed=False, audit_exit=1), [("2024", "invalid")])
            self.assertEqual(replay(1), [("2025", "passed")])
            # the state the run order never leaves, a holdout run before the control's: the reading must not lean on it
            with patch.object(lines, "history_segments", lambda *args: [
                    item for item in segments(*args) if item["kind"] != "control"]):
                self.assertEqual(replay(1), [("holdout", "passed")])
            reproduces, found = summary()
            self.assertIsNone(reproduces)
            self.assertEqual((found["veto"]["whole_years"], found["veto"]["meets_targets"], found["holdout"]["meets_targets"]),
                             (2, None, True), "2024 and 2025; 2023 starts in December")
            self.assertEqual((found["meets_targets"], found["judged_on"], found["missing"]),
                             (None, None, ["veto 2024", "control"]))
            self.assertIsNone(found["holdout"]["deflated_sharpe"], "one participant leaves no variance")
            self.assertEqual(replay(None), [("development", "passed")])
        reproduces, found = summary()
        self.assertTrue(reproduces)
        self.assertEqual((found["veto"]["median_annual_return"] > 0.2, found["holdout"]["meets_targets"]), (True, True),
                         "the year read and the holdout both reach the targets")
        self.assertEqual((found["meets_targets"], found["judged_on"], found["missing"]), (None, None, ["veto 2024"]),
                         "the invalid year cannot be replayed again: the row stays undecided")

    def test_a_source_without_economic_evidence_is_no_candidate(self):
        """20261114-13: the test's candidates are the participants whose research run carries economic evidence, as
        `research status` judges it. Before, a source whose review had failed was replayed, shown with its
        development readings and given a summary."""
        world = self.world
        line = world.line["line"]
        registration, refs = registered_grid(world, ["kept", "early", "late"])
        runs = {ref: entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV,
                               registration=registration)["trial_id"] for ref in refs}
        kept, early, late = refs

        def fail_review(ref):
            sha = strategies.read_candidate(world.conn, ref)["source_sha256"]
            (trial_id,), = world.conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s",
                                           (sha,))
            precheck.record_review(world.profile, world.review_body(
                trial_id, "failed", causal={"status": "failed", "note": "found after the run was sealed"}), "reviewer-z")

        def read():
            found = report_history.research_history(world.profile, line=line)["lines"][0]
            return ([row["candidate"] for row in found["rows"]], found["participants"], found["discount"]["trials"],
                    [(item["candidate"], item["run"], item["reasons"][0].split(":")[0])
                     for item in found["without_economic_evidence"]])

        self.assertEqual(read(), ([kept, early, late], 3, 3, []))
        fail_review(early)
        apart = status.research_status(world.profile, line=line)["comparison"]["without_economic_evidence"]
        self.assertEqual([item["candidate"] for item in apart], [early], "the judgment `research status` reads")
        ran = history.run_history(world.profile, world.market, MARKET_DAY, line)
        self.assertEqual({item["run"] for item in ran["ran"]}, {runs[kept], runs[late]}, "the failed source is not replayed")
        self.assertEqual((ran["participants"], ran["left"], [item["candidate"] for item in ran["without_economic_evidence"]]),
                         (2, 0, [early]))
        self.assertEqual(read(), ([kept, late], 2, 2, [(early, runs[early], "SOURCE_REVIEW_FAILED")]))

        fail_review(late)  # after its history runs: judged on read, it loses its row and its readings
        self.assertEqual(read(), ([kept], 1, 1, [(early, runs[early], "SOURCE_REVIEW_FAILED"),
                                                 (late, runs[late], "SOURCE_REVIEW_FAILED")]))
        days = (date(2025, 11, 1), date(2026, 4, 1))
        with self.assertRaises(Refusal) as refused:
            lines.close_line(world.profile, line, b"summary", days)
        self.assertEqual(refused.exception.code, "HISTORY_INCOMPLETE", "of every participant, the ledger's own rule")
        with patch.object(research_commands, "_market_days", return_value=days):
            closed = research_commands.line_close(world.profile, line, b"summary", {})
        self.assertFalse(closed["replayed"], "`line close` requires the candidates' segments only")
