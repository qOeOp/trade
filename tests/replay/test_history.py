"""The closing history test (replay.history, ledger.lines history_*, report.history): segments, the runner,
the line-close requirement and the reading."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime
import math
import statistics
import subprocess
import threading
import unittest
from unittest.mock import patch

from cli import research_commands
from ledger import admin, execution, lines, strategies
from registration import precheck
from replay import entry, history, seams as replay_seams
from report import graph, history as report_history, measures, runs, status
from runtime.container import STAGE_MEMORY_BYTES
from tests.ledger.dolt import BINARY, MARKET_DAY, SKIP
from tests.registration.test_register import second_line
from tests.registration.world import RUNNER_ARGV, config, months_rows
from tests.replay import world as replay_world
from tests.replay.world import Market, ReplayWorld, registered_grid
from tests.helpers import refused, tempdir


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
            ("veto", "2018-10", date(2019, 9, 1), date(2019, 10, 1)),
            ("veto", "2019-10", date(2019, 10, 1), date(2020, 10, 1)),
            ("veto", "2020-10", date(2020, 10, 1), date(2021, 10, 1)),
            ("control", "development", date(2021, 10, 1), date(2024, 10, 1)),
            ("holdout", "holdout", date(2024, 10, 1), date(2026, 10, 1)),
            ("forward", "forward", date(2026, 10, 1), date(2026, 11, 11))])

    def test_the_veto_reserve_before_a_three_year_period_is_a_whole_year(self):
        """0.5.0 release run, 2026-11-22: a market from 2020-01 and the period 2021-10 to 2024-10. Cut by the calendar,
        the veto years were 2020 (trading from February after the warm-up) and 2021 to September, neither whole, so
        the veto years never decided and the holdout alone did."""
        found = lines.history_segments(date(2021, 10, 1), date(2024, 10, 1), date(2020, 1, 1), date(2026, 10, 31))
        self.assertEqual([(item["label"], item["start"], item["end"]) for item in found if item["kind"] == "veto"],
                         [("2019-10", date(2020, 1, 1), date(2020, 10, 1)), ("2020-10", date(2020, 10, 1), date(2021, 10, 1))])

    def test_a_veto_year_cut_only_by_the_warm_up_is_whole(self):
        """#3760: the market's first day on the reserved year's start (the reserve before a longer period), so any
        warm-up moved the trade start; the year read as a part year, the summary judged on the holdout alone and
        require_unfalsified passed a candidate that lost the whole reserved year."""
        def year(input_start, trade_start):
            return report_history._whole_year({"input_start": datetime.fromisoformat(input_start),
                                               "trade_start": datetime.fromisoformat(trade_start),
                                               "trade_end": datetime(2022, 1, 1)})
        self.assertTrue(year("2021-01-01", "2021-01-01"))
        self.assertTrue(year("2021-01-01", "2021-01-02"), "one warm-up day after the market's first day")
        self.assertTrue(year("2021-01-01", "2021-07-01"), "a half-year warm-up")
        self.assertFalse(year("2021-03-01", "2021-03-02"), "the market's first day cut the year")
        self.assertFalse(year("2021-01-01", "2021-10-15"), "under SHORT_DAYS left after the warm-up")

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
                "status": "passed", "measures": {"annual_return": annual, "mark_max_drawdown": drawdown}}

    @staticmethod
    def unread(label, status="invalid"):
        """A whole veto year whose run is invalid, or whose trial has no run (status None): no measures."""
        return {"kind": "veto", "label": label, "whole_year": True, "short": False, "status": status}

    @staticmethod
    def summary(*cells, targets=TARGETS, control=True, planned=None):
        """The summary of `cells`, the test planning the veto years among them unless `planned` says which."""
        planned = {cell["label"] for cell in cells if cell["kind"] == "veto"} if planned is None else planned
        return report_history._summary(list(cells), targets, control, planned)

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

    def test_a_part_veto_year_without_a_passed_run_leaves_the_verdict_undecided(self):
        """20261120-01: the first veto year starts after the market's first day plus warm-up; its run sealed invalid
        (UNPROTECTED_POSITION) was neither read nor missing, so the holdout alone decided."""
        part = {"trial_id": 41, "kind": "veto", "label": "2020", "trade_start": "2020-01-31T00:00:00",
                "trade_end": "2021-01-01T00:00:00", "status": "invalid", "whole_year": False, "short": False}
        alone = self.summary(part, self.HOLDOUT)
        self.assertEqual((alone["veto"]["whole_years"], *self.verdict(alone)), (0, None, None, ["veto 2020"]))
        years = self.summary(part, self.cell("veto", 0.5, 0.1, label="2021"), self.HOLDOUT)
        self.assertEqual(self.verdict(years), (None, None, ["veto 2020"]))
        rerun = self.summary(part, {**part, "trial_id": 42, "status": "passed",
                                    "measures": {"annual_return": -0.5, "mark_max_drawdown": 0.6}}, self.HOLDOUT)
        self.assertEqual(self.verdict(rerun), (True, "holdout", []), "a passed part year is read in no summary")

    def test_a_year_takes_its_run_with_readings(self):
        """A trial left without a run (the host died) is replayed again: the year reads its rerun."""
        found = self.summary(self.unread("2020", status=None), self.cell("veto", 0.5, 0.1), self.HOLDOUT)
        self.assertEqual((found["veto"]["whole_years"], *self.verdict(found)), (1, True, "veto and holdout", []))

    def test_a_planned_veto_year_not_replayed_yet_leaves_the_verdict_undecided(self):
        """Gemini audit 2026-11-22: `line history --limit` or a failure leaves planned segments without a history
        trial, and the years present alone decided: the holdout alone with none, the one year replayed of three."""
        planned = ["2019", "2020", "2021"]
        none = self.summary(self.HOLDOUT, planned=planned)
        self.assertEqual((none["veto"]["whole_years"], none["holdout"]["meets_targets"], *self.verdict(none)),
                         (0, True, None, None, ["veto 2019", "veto 2020", "veto 2021"]), "not the holdout alone")
        one = self.summary(self.cell("veto", 0.5, 0.1), self.HOLDOUT, planned=planned)
        self.assertEqual((one["veto"]["whole_years"], *self.verdict(one)), (1, None, None, ["veto 2019", "veto 2021"]))
        self.assertEqual(self.verdict(self.summary(self.HOLDOUT, planned=[])), (True, "holdout", []),
                         "a test that plans no veto year is judged on the holdout alone")

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


class UnfalsifiedTests(unittest.TestCase):
    """20261120-05 (user 2026-11-21): a validation takes only a candidate its line's closing history test decided and
    did not falsify; an undecided verdict is refused apart, naming what it lacks."""

    SOURCE = "a" * 64

    @staticmethod
    def line(name, *rows):
        return {"line": name, "rows": list(rows)}

    def row(self, *cells, control=True, reproduces=True, source=SOURCE, planned=None):
        summary = VerdictTests.summary(*cells, control=control, planned=planned) if reproduces else None
        return {"source_sha256": source, "candidate": "rsi@1", "run": 7, "summary": summary}

    def refused(self, *tested):
        caught = refused(report_history.verdict, self.SOURCE, list(tested))
        return caught.code, list(caught.missing)

    def test_a_decided_verdict_admits_and_a_falsified_one_refuses(self):
        passed = self.row(VerdictTests.HOLDOUT)
        failed = self.row(VerdictTests.cell("holdout", 0.25, 0.12))
        self.assertEqual(report_history.verdict(self.SOURCE, [self.line("one", passed)]),
                         {"line": "one", "judged_on": "holdout"})
        self.assertEqual(self.refused(self.line("one", failed)), ("CANDIDATE_FALSIFIED", ["one"]))
        self.assertEqual(self.refused(self.line("one", passed), self.line("two", failed)),
                         ("CANDIDATE_FALSIFIED", ["two"]), "falsified on any line it was tested on")

    def test_an_undecided_verdict_is_refused_apart_and_names_what_it_lacks(self):
        self.assertEqual(self.refused(), ("HISTORY_UNDECIDED", ["line history"]), "no history trial of the source")
        self.assertEqual(self.refused(self.line("one", self.row(VerdictTests.HOLDOUT, control=False))),
                         ("HISTORY_UNDECIDED", ["one: control"]))
        self.assertEqual(self.refused(self.line("one", self.row(VerdictTests.HOLDOUT, reproduces=False))),
                         ("HISTORY_UNDECIDED", ["one: control"]), "a control unlike the research run voids the row")
        self.assertEqual(self.refused(self.line("one", self.row(VerdictTests.HOLDOUT, source="b" * 64))),
                         ("HISTORY_UNDECIDED", ["one: economic evidence"]), "a source the test no longer judges")
        self.assertEqual(self.refused(self.line("one", self.row(VerdictTests.unread("2020"), VerdictTests.HOLDOUT))),
                         ("HISTORY_UNDECIDED", ["one: veto 2020"]))
        self.assertEqual(self.refused(self.line("one", self.row(VerdictTests.HOLDOUT, planned=["2020", "2021"]))),
                         ("HISTORY_UNDECIDED", ["one: veto 2020", "one: veto 2021"]),
                         "a passed control and holdout with the planned veto years not replayed yet")


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
        found = report_history._discount(rows, returns, 6)
        daily = [measures.sharpe_365(returns[trial]) / math.sqrt(365) for trial in (1, 2, 3)]
        self.assertEqual(found, {"trials": 4, "trials_with_prior": 10, "holdouts_with_returns": 3,
                                 "daily_sharpe_variance": statistics.variance(daily)})
        for row, trial in zip(rows[:3], (1, 2, 3), strict=True):
            self.assertEqual(row["summary"]["holdout"]["deflated_sharpe"],
                             measures.deflated_sharpe(returns[trial], 4, statistics.variance(daily)))
            self.assertEqual(row["summary"]["holdout"]["deflated_sharpe_with_prior_trials"],
                             measures.deflated_sharpe(returns[trial], 10, statistics.variance(daily)),
                             "the trials that already looked at the holdout join the participants")
            self.assertLess(row["summary"]["holdout"]["deflated_sharpe_with_prior_trials"],
                            row["summary"]["holdout"]["deflated_sharpe"])
        self.assertGreater(rows[0]["summary"]["holdout"]["deflated_sharpe"], rows[2]["summary"]["holdout"]["deflated_sharpe"])
        self.assertIsNone(rows[3]["summary"], "a row whose control does not reproduce gets no summary")

    def test_a_short_or_missing_holdout_has_no_deflated_sharpe(self):
        rows = [self.row(1, 1, short=True), self.row(2, 2)]
        found = report_history._discount(rows, {2: [0.01, -0.01, 0.02] * 10}, None)
        self.assertEqual((found["holdouts_with_returns"], found["daily_sharpe_variance"]), (1, None))
        self.assertIsNone(rows[0]["summary"]["holdout"]["deflated_sharpe"])
        self.assertIsNone(rows[1]["summary"]["holdout"]["deflated_sharpe"], "one holdout leaves no variance")
        self.assertIsNone(rows[1]["summary"]["holdout"]["deflated_sharpe_with_prior_trials"])
        self.assertIsNone(found["trials_with_prior"], "no prior count read")


class WidthTests(unittest.TestCase):
    def test_as_many_replays_as_stage_limits_fit_beside_what_docker_holds(self):
        gib = 2**30
        cases = {(62 * gib, gib): 3, (62 * gib, 30 * gib): 1, (8 * gib, 0): 1, (0, 0): 1, (200 * gib, 0): 5}
        self.assertEqual({key: history.width(lambda key=key: key, 5) for key in cases}, cases,
                         "62.7 GiB Docker VM: 3 at 16 GiB; never 0; never more than the segments")

    def test_docker_memory_is_its_total_less_its_containers(self):
        answers = {"info": "67305488384\n", "stats": "302.5MiB / 40GiB\n1.5GiB / 62.68GiB\n\n42kB / 3GiB\n"}

        def run(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 0, stdout=answers[argv[1]])
        with patch.object(history.subprocess, "run", run):
            self.assertEqual(history.engine_memory(), (67305488384, int(302.5 * 2**20) + int(1.5 * 2**30) + 42_000))
        answers["stats"] = "-- / --\n"
        with patch.object(history.subprocess, "run", run):
            self.assertEqual(history.engine_memory(), (0, 0), "an unreadable answer admits one replay at a time")
        with patch.object(history.subprocess, "run", side_effect=OSError("no docker")):
            self.assertEqual(history.engine_memory(), (0, 0))

    def test_an_interrupt_stops_the_running_stages_and_starts_no_other(self):
        stopped, started = [], threading.Event()
        release = threading.Event()

        def inner(command, stdout, stderr, timeout):
            started.set()
            release.wait(10)
            return 137

        stages = history._Stages(inner)
        outcome = []

        def stage():
            try:
                stages.run(["docker", "run", "--name", "replay-x-trial-7-native"], None, None, None)
            except KeyboardInterrupt:
                outcome.append("interrupted")
        thread = threading.Thread(target=stage)
        thread.start()
        started.wait(10)
        with replay_seams.use(stop=stopped.append):
            stages.stop()
        release.set()
        thread.join(10)
        self.assertEqual((stopped, outcome), (["replay-x-trial-7-native"], ["interrupted"]),
                         "the container is stopped and its stage reads as interrupted, as entry._stage seals it")
        with self.assertRaises(KeyboardInterrupt):
            stages.run(["docker", "run", "--name", "replay-x-trial-8-native"], None, None, None)


@unittest.skipUnless(BINARY, SKIP)
class HistoryRunTests(unittest.TestCase):
    def setUp(self):
        self.world = ReplayWorld("history")
        # Room for three replays at once, so these tests run the segments concurrently.
        self.enterContext(patch.object(history, "engine_memory", lambda: (3 * STAGE_MEMORY_BYTES + history.MARGIN, 0)))

    def tearDown(self):
        self.world.close()

    def test_a_line_closes_only_after_every_segment_has_a_history_run(self):
        world = self.world
        line = world.line["line"]
        self.enterContext(patch.object(replay_world, "inspect_stand_in", windowed))  # passed history runs
        registration, (ref,) = registered_grid(world, ["kept"])  # an open line takes a registration
        passed = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV,
                           registration=registration)
        self.assertEqual(passed["status"], "passed")
        days = (date(2025, 11, 1), date(2026, 4, 1))  # the fake market: 2025-11 to its latest day 2026-03-31
        caught = refused(lines.close_line, world.profile, line, b"summary", days)
        self.assertEqual(caught.code, "HISTORY_INCOMPLETE")
        self.assertEqual(len(caught.missing), 3, "2025 (from November), the control and the holdout")
        source = world.conn.one("SELECT source_sha256 FROM trial WHERE trial_id = %s", (passed["trial_id"],))
        unfalsified = report_history.require_unfalsified

        def undecided():
            caught = refused(unfalsified, world.conn, source["source_sha256"], world.market)
            self.assertEqual(caught.code, "HISTORY_UNDECIDED")
            return list(caught.missing)
        self.assertEqual(undecided(), ["line history"], "20261120-05: no history trial of it yet")

        first = history.run_history(world.profile, world.market, MARKET_DAY, line, limit=1)
        self.assertEqual((len(first["ran"]), first["left"], first["participants"]), (1, 2, 1))
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": passed["trial_id"]}])
        late = world.publish("late", parent=None)
        reviews = {late["candidate"]: world.prechecked(late["source"])}
        closing = refused(world.register, world.body([late["candidate"]], reviews))
        self.assertEqual(closing.code, "LINE_ENDED", "the first history trial began the line's closing")
        rest = history.run_history(world.profile, world.market, MARKET_DAY, line)
        self.assertEqual((len(rest["ran"]), rest["left"]), (2, 0))
        self.assertEqual(history.run_history(world.profile, world.market, MARKET_DAY, line)["ran"], [],
                         "a rerun resumes: nothing is left")

        one_at_a_time = AssertionError("one run read at a time")
        with patch.object(execution, "read_capture", side_effect=one_at_a_time), \
                patch.object(measures, "run_facts", side_effect=one_at_a_time):
            read = report_history.research_history(world.profile, world.market, line=line)["lines"][0]
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
                         "no whole veto year and the part year passed, so it is read in no summary; "
                         "no countable holdout to judge by, and the fixture line has no targets")
        self.assertEqual(undecided(), [f"{line}: {item}" for item in row["summary"]["missing"]],
                         "a validation is refused while the verdict lacks a reading")

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

        backups = tempdir(self.addCleanup, prefix="backups-", dir="/tmp")
        profile = replace(world.profile, backup_root=backups / "export")
        with patch.object(report_history, "market_days", return_value=days):
            closed = research_commands.line_close(profile, line, b"summary", {})
        self.assertFalse(closed["replayed"])
        self.assertEqual(closed["backup"]["ledger_commit"], closed["ledger_commit"], "U2: closing syncs the backup")
        self.assertEqual(admin.backup_head(admin.backup_path(profile)), closed["ledger_commit"])
        self.assertEqual(refused(history.run_history, world.profile, world.market, MARKET_DAY, line).code, "LINE_ENDED")
        # L11: a closed line is read when named, never by default
        self.assertEqual((lines.list_lines(world.profile)["lines"], status.research_runs(world.profile)["runs"],
                          status.research_status(world.profile)["lines"]), ([], [], []))
        self.assertEqual([item["trial_id"] for item in status.research_runs(world.profile, line=line)["runs"]],
                         [passed["trial_id"]])
        self.assertEqual(status.research_status(world.profile, line=line)["research_attempts"], 1)

    def test_a_corrupt_captured_file_no_reading_uses_refuses_the_test(self):
        """The reading, and with it the validation and Live gates (require_unfalsified), checks every captured byte of
        every run it reads: the research run, each segment, and a control that did not pass."""
        world = self.world
        line = world.line["line"]
        self.enterContext(patch.object(replay_world, "inspect_stand_in", windowed))
        registration, (ref,) = registered_grid(world, ["kept"])
        research = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        source = world.conn.one("SELECT source_sha256 FROM trial WHERE trial_id = %s", (research["trial_id"],))

        def run(segments, **scenario):
            world.scenario = {"returns": [0.002, -0.001], **scenario}
            return [item["status"] for item in
                    history.run_history(world.profile, world.market, MARKET_DAY, line, limit=segments)["ran"]]

        def tamper(statement, params):
            conn = world.service.admin(world.profile)
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
                    cursor.execute(statement, params)
                    cursor.execute("CALL DOLT_COMMIT('-a', '-m', 'tamper: stored bytes')")
            finally:
                conn.close()

        def check():
            trials = world.conn.dicts("SELECT MAX(t.trial_id) AS trial_id FROM trial t JOIN run r ON r.trial_id = "
                                      "t.trial_id GROUP BY t.purpose, t.trade_start, t.trade_end ORDER BY trial_id")
            for trial in trials:  # the latest of each segment; a superseded run is not read
                stored = world.conn.one(
                    "SELECT c.sha256, c.content FROM evidence e JOIN evidence_content c ON c.sha256 = e.sha256 "
                    "WHERE e.bundle = %s AND e.path = 'reports/summary.json'", (f"trial-{trial['trial_id']}-capture",))
                with self.subTest(**trial):
                    tamper("DELETE FROM evidence_content WHERE sha256 = %s", (stored["sha256"],))
                    for read in (lambda: report_history.research_history(world.profile, world.market, line=line),
                                 lambda: report_history.require_unfalsified(world.conn, source["source_sha256"],
                                                                            world.market)):
                        self.assertEqual(refused(read).code, "LEDGER_CORRUPT")
                    tamper("INSERT INTO evidence_content (content) VALUES (%s)", (stored["content"],))
            report_history.research_history(world.profile, world.market, line=line)

        self.assertEqual([*run(1), *run(1, audit_passed=False, audit_exit=1)], ["passed", "invalid"])
        check()  # with an invalid control
        self.assertEqual(run(None), ["passed", "passed"])
        check()  # the rerun control and the holdout passed

    def test_a_grid_point_registered_before_the_closing_runs_no_more(self):
        """The first history trial fixed the candidates, so a grid point still unrun takes no research run."""
        world = self.world
        line = world.line["line"]
        registration, (ref,) = registered_grid(world, ["kept"])
        pending, (later,) = registered_grid(world, ["unrun"])  # its own grid: no exposure to the history trial
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        history.run_history(world.profile, world.market, MARKET_DAY, line, limit=1)
        trials = world.conn.rows("SELECT COUNT(*) FROM trial")
        caught = refused(entry.run, world.profile, world.market, MARKET_DAY, later, None, RUNNER_ARGV,
                         registration=pending)
        self.assertEqual(caught.code, "LINE_ENDED")
        self.assertIn("a research run now would be a result the test leaves out", caught.message)
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
            return report_history.research_history(world.profile, world.market, line=line)["lines"][0]["holdout_prior_trials"]

        history.run_history(world.profile, world.market, MARKET_DAY, mine)
        self.assertEqual((prior(mine)["trials"], prior(mine)["by_line"]), (0, []),
                         "the line's own holdout replay is not an earlier search of it")
        self.assertEqual(prior(mine)["instruments"], ["AAAUSDT", "BBBUSDT"], "those of its research trials")
        self.assertEqual(prior(other)["by_line"], [{"line": mine, "purpose": "history", "trials": 1}],
                         "the other line's holdout replay; its veto year and control end before the holdout")
        history.run_history(world.profile, world.market, MARKET_DAY, other)
        self.assertEqual(prior(mine)["by_line"], [{"line": other, "purpose": "history", "trials": 1}])
        self.assertEqual(prior(other)["trials"], 1, "unchanged by its own closing")
        by_line = report_history.research_history(world.profile, world.market)["lines"]
        self.assertEqual([item["holdout_prior_trials"]["trials"] for item in by_line], [1, 1])

    def test_a_control_that_does_not_reproduce_the_run_voids_its_row(self):
        world = self.world
        line = world.line["line"]
        registration, (ref,) = registered_grid(world, ["drifting"])
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        world.fingerprint = {"fills": {"rows": 3, "sha256": "1" * 64, "by_utc_day": {}}}
        history.run_history(world.profile, world.market, MARKET_DAY, line)
        (row,) = report_history.research_history(world.profile, world.market, line=line)["lines"][0]["rows"]
        self.assertIs(row["control_reproduces"], False)
        self.assertIsNone(row["summary"])

    def test_an_interrupted_control_is_missing_not_a_reproduction_failure(self):
        """#3761: a control trial without a run (an interrupted `line history`) read as a control that does not
        reproduce the research run, voiding the row's summary instead of naming the control missing."""
        world = self.world
        line = world.line["line"]
        self.enterContext(patch.object(replay_world, "inspect_stand_in", windowed))
        registration, (ref,) = registered_grid(world, ["kept"])
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)

        def interrupt(*args, **kwargs):
            raise KeyboardInterrupt

        with patch.object(lines, "history_segments", lambda *args, segments=lines.history_segments: [
                item for item in segments(*args) if item["kind"] == "control"]):
            with replay_seams.use(run=interrupt), self.assertRaises(KeyboardInterrupt):
                history.run_history(world.profile, world.market, MARKET_DAY, line)
        (control,) = lines.history_trials(world.conn, world.line["line_id"])
        self.assertIsNone(control["status"], "a control trial without a run")
        (row,) = report_history.research_history(world.profile, world.market, line=line)["lines"][0]["rows"]
        self.assertIsNone(row["control_reproduces"])
        self.assertIn("control", row["summary"]["missing"])
        self.assertIsNone(row["summary"]["meets_targets"])
        history.run_history(world.profile, world.market, MARKET_DAY, line)
        (row,) = report_history.research_history(world.profile, world.market, line=line)["lines"][0]["rows"]
        self.assertIs(row["control_reproduces"], True, "resuming replays the control")
        self.assertNotIn("control", row["summary"]["missing"])

    def test_an_invalid_whole_veto_year_or_a_missing_control_leaves_the_verdict_undecided(self):
        """20261114-12: before, the invalid year left the veto's denominator and a row without a control run was
        judged all the same, so this row read `meets_targets` true twice."""
        world = self.world
        line = world.line["line"]
        world.market = YearsMarket({MARKET_DAY: months_rows(YEARS_MONTHS)})
        lines.set_targets(world.conn, world.line["line_id"], 0.2, 0.2)
        registration, (ref,) = registered_grid(world, ["kept"])
        entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        segments = lines.history_segments

        def summary():
            (row,) = report_history.research_history(world.profile, world.market, line=line)["lines"][0]["rows"]
            return row["control_reproduces"], row["summary"]

        def replay(count, **scenario):
            world.scenario = {"returns": [0.001], **scenario}  # about 44% a year with no drawdown
            return [(item["segment"], item["status"]) for item in
                    history.run_history(world.profile, world.market, MARKET_DAY, line, limit=count)["ran"]]

        with patch.object(replay_world, "inspect_stand_in", windowed):
            self.assertEqual(replay(1), [("2023-01", "passed")])
            self.assertEqual(replay(1, audit_passed=False, audit_exit=1), [("2024-01", "invalid")])
            self.assertEqual(replay(1), [("2025-01", "passed")])
            # the state the run order never leaves, a holdout run before the control's: the reading must not lean on it
            with patch.object(lines, "history_segments", lambda *args: [
                    item for item in segments(*args) if item["kind"] != "control"]):
                self.assertEqual(replay(1), [("holdout", "passed")])
            reproduces, found = summary()
            self.assertIsNone(reproduces)
            self.assertEqual((found["veto"]["whole_years"], found["veto"]["meets_targets"], found["holdout"]["meets_targets"]),
                             (2, None, True), "2024 and 2025; 2023 starts in December")
            self.assertEqual((found["meets_targets"], found["judged_on"], found["missing"]),
                             (None, None, ["veto 2024-01", "control"]))
            self.assertIsNone(found["holdout"]["deflated_sharpe"], "one participant leaves no variance")
            self.assertEqual(replay(1), [("development", "passed")], "a segment without a run before a rerun")
            reproduces, found = summary()
            self.assertTrue(reproduces)
            self.assertEqual((found["veto"]["median_annual_return"] > 0.2, found["holdout"]["meets_targets"]),
                             (True, True), "the year read and the holdout both reach the targets")
            self.assertEqual((found["meets_targets"], found["judged_on"], found["missing"]), (None, None, ["veto 2024-01"]))

            # 20261120-03: an invalid segment is replayed again, once per call; one failing again stays invalid
            (first,), = world.conn.rows("SELECT t.trial_id FROM trial t JOIN run r ON r.trial_id = t.trial_id "
                                        "WHERE t.purpose = 'history' AND r.status = 'invalid'")
            world.scenario = {"returns": [0.001], "audit_passed": False, "audit_exit": 1}
            again = history.run_history(world.profile, world.market, MARKET_DAY, line)
            self.assertEqual([(item["segment"], item["status"], item["replaces"]) for item in again["ran"]],
                             [("2024-01", "invalid", first)])
            self.assertEqual((again["left"], again["invalid_left"]), (0, 0))
            self.assertEqual(replay(None), [("2024-01", "passed")], "the next call replays it again")
        reproduces, found = summary()
        self.assertEqual((found["meets_targets"], found["judged_on"], found["missing"]),
                         (True, "veto and holdout", []), "the rerun supersedes the invalid year")
        (row,) = report_history.research_history(world.profile, world.market, line=line)["lines"][0]["rows"]
        (year,) = [cell for cell in row["cells"] if cell["label"] == "2024-01"]
        self.assertEqual((year["status"], year["superseded"], len(row["cells"])),
                         ("passed", [first, again["ran"][0]["history_trial_id"]], 5),
                         "one cell per segment: 2023, 2024, 2025, the holdout and the control")
        found = status.research_status(world.profile)["excluded_trials"]["reproductions"]
        self.assertEqual(len(found), 2, "a rerun looks at what its first trial did: counted once")

    def test_veto_years_not_replayed_yet_leave_the_verdict_undecided(self):
        """Gemini audit 2026-11-22: with a passed control and holdout and no veto year replayed, the holdout alone
        decided and a validation or Live run took the candidate; with one year of three, that year alone."""
        world = self.world
        line = world.line["line"]
        world.market = YearsMarket({MARKET_DAY: months_rows(YEARS_MONTHS)})
        lines.set_targets(world.conn, world.line["line_id"], 0.2, 0.2)
        registration, (ref,) = registered_grid(world, ["kept"])
        passed = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        source = world.conn.one("SELECT source_sha256 FROM trial WHERE trial_id = %s", (passed["trial_id"],))
        segments = lines.history_segments
        world.scenario = {"returns": [0.001]}  # about 44% a year with no drawdown

        def replay(*kinds):
            with patch.object(lines, "history_segments", lambda *args: [
                    item for item in segments(*args) if item["kind"] in kinds]):
                return [item["segment"] for item in
                        history.run_history(world.profile, world.market, MARKET_DAY, line)["ran"]]

        def verdict():
            (row,) = report_history.research_history(world.profile, world.market, line=line)["lines"][0]["rows"]
            caught = refused(report_history.require_unfalsified, world.conn, source["source_sha256"], world.market)
            return (row["summary"]["holdout"]["meets_targets"], row["summary"]["meets_targets"],
                    row["summary"]["missing"], caught.code, list(caught.missing))

        with patch.object(replay_world, "inspect_stand_in", windowed):
            self.assertEqual(replay("control", "holdout"), ["development", "holdout"])
            self.assertEqual(verdict(), (True, None, ["veto 2023-01", "veto 2024-01", "veto 2025-01"], "HISTORY_UNDECIDED",
                                         [f"{line}: veto 2023-01", f"{line}: veto 2024-01", f"{line}: veto 2025-01"]))
            with patch.object(lines, "history_segments", lambda *args: [
                    item for item in segments(*args) if item["label"] == "2024-01"]):
                self.assertEqual([item["segment"] for item in history.run_history(
                    world.profile, world.market, MARKET_DAY, line)["ran"]], ["2024-01"])
            self.assertEqual(verdict(), (True, None, ["veto 2023-01", "veto 2025-01"], "HISTORY_UNDECIDED",
                                         [f"{line}: veto 2023-01", f"{line}: veto 2025-01"]))
            history.run_history(world.profile, world.market, MARKET_DAY, line)
        self.assertEqual(report_history.require_unfalsified(world.conn, source["source_sha256"], world.market),
                         {"line": line, "judged_on": "veto and holdout"}, "every planned year replayed")

    def test_a_holdout_cut_by_an_earlier_market_day_decides_nothing(self):
        """20261122-20 (user 2026-11-22, 「授权」): `line history --market-day` at a day whose market ends inside the
        holdout replays a cut holdout of 90 days or more; it passed `require_unfalsified` (validation, Live) while the
        holdout planned on the market's newest day had no run and `line close` refused. A day before the line's own
        market day is refused, and a holdout ending before min(planned end, market end) reads as missing."""
        world = self.world
        line = world.line["line"]
        early, newest = "2026-02-15", "2026-08-01"

        class Growing(YearsMarket):
            def days(self, market_day):  # the market at MARKET_DAY ends four months into the holdout
                latest = {early: date(2026, 2, 14), MARKET_DAY: date(2026, 5, 31)}.get(market_day, date(2026, 7, 31))
                return date(2023, 12, 1), latest

        world.market = Growing({day: months_rows(YEARS_MONTHS) for day in (early, MARKET_DAY, newest)})
        lines.set_targets(world.conn, world.line["line_id"], 0.2, 0.2)
        registration, (ref,) = registered_grid(world, ["kept"])
        passed = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        source = world.conn.one("SELECT source_sha256 FROM trial WHERE trial_id = %s", (passed["trial_id"],))["source_sha256"]
        world.scenario = {"returns": [0.001]}  # about 44% a year with no drawdown
        self.assertEqual(refused(history.run_history, world.profile, world.market, early, line).code,
                         "HISTORY_MARKET_DAY_EARLY", "a market day before the line's own")
        with patch.object(replay_world, "inspect_stand_in", windowed):
            cut = history.run_history(world.profile, world.market, MARKET_DAY, line)
            self.assertIn("holdout", [item["segment"] for item in cut["ran"]])
            (row,) = report_history.research_history(world.profile, world.market, line=line)["lines"][0]["rows"]
            holdout = next(cell for cell in row["cells"] if cell["kind"] == "holdout")
            self.assertEqual((holdout["trade_end"], holdout["short"]), ("2026-06-01T00:00:00", False))
            self.assertEqual((row["summary"]["meets_targets"], row["summary"]["missing"]), (None, ["holdout"]))
            caught = refused(report_history.require_unfalsified, world.conn, source, world.market)
            self.assertEqual((caught.code, list(caught.missing)), ("HISTORY_UNDECIDED", [f"{line}: holdout"]))
            history.run_history(world.profile, world.market, newest, line)  # the holdout to the market's end
        self.assertEqual(report_history.require_unfalsified(world.conn, source, world.market),
                         {"line": line, "judged_on": "veto and holdout"})

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
            found = report_history.research_history(world.profile, world.market, line=line)["lines"][0]
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
        caught = refused(lines.close_line, world.profile, line, b"summary", days)
        self.assertEqual(caught.code, "HISTORY_INCOMPLETE", "of every participant, the ledger's own rule")
        with patch.object(report_history, "market_days", return_value=days):
            closed = research_commands.line_close(world.profile, line, b"summary", {})
        self.assertFalse(closed["replayed"], "`line close` requires the candidates' segments only")


@unittest.skipUnless(BINARY, SKIP)
class ConcurrentHistoryTests(unittest.TestCase):
    """A-24: segments replay several at once; what they seal is what one at a time seals."""

    @staticmethod
    def memory(width):
        return lambda: (width * STAGE_MEMORY_BYTES + history.MARGIN, 0)

    def world(self, name):
        world = ReplayWorld(name)
        self.addCleanup(world.close)
        self.enterContext(patch.object(replay_world, "inspect_stand_in", windowed))
        registration, refs = registered_grid(world, ["first", "second"])
        for returns in ([0.002, -0.001], [0.003, -0.001]):
            world.scenario = {"returns": returns}
            entry.run(world.profile, world.market, MARKET_DAY, refs.pop(0), None, RUNNER_ARGV,
                      registration=registration)
        world.scenario = {"returns": [0.002, -0.001]}
        return world

    @staticmethod
    def at_once(record, overlap=False):
        """A replay.seams.run that records the most stage processes running at one time.

        With overlap, the first stage waits (up to 10 s) for a second one to start, so stand-in stages that finish
        at once still show whether the runner started several together."""
        inner, cond, running, met = replay_seams.current.run, threading.Condition(), [0], [False]

        def run(*args):
            with cond:
                running[0] += 1
                record.append(running[0])
                if running[0] > 1:
                    met[0] = True
                    cond.notify_all()
                elif overlap and not met[0]:
                    cond.wait_for(lambda: met[0], timeout=10)
            try:
                return inner(*args)
            finally:
                with cond:
                    running[0] -= 1
        return run

    @staticmethod
    def sealed(world):
        """Each history run's segment and what it sealed: status, reasons, fingerprints, reading and returns."""
        rows = world.conn.dicts(
            "SELECT t.trial_id, t.source_sha256, t.trade_start, t.trade_end, r.status, r.failure_reasons, r.fingerprints, "
            "rr.report FROM trial t JOIN run r ON r.trial_id = t.trial_id LEFT JOIN run_reading rr ON rr.trial_id = "
            "t.trial_id WHERE t.purpose = 'history' ORDER BY t.source_sha256, t.trade_start")
        for row in rows:
            row["returns"] = world.conn.rows("SELECT ts_event_ns, native_return FROM run_return WHERE trial_id = %s "
                                             "ORDER BY ts_event_ns", (row.pop("trial_id"),))
        return rows

    def test_concurrent_segments_seal_what_serial_ones_do(self):
        found = {}
        for width in (1, 3):
            world = self.world(f"history-{width}")
            record: list[int] = []
            with replay_seams.use(run=self.at_once(record, overlap=width > 1)):
                done = history.run_history(world.profile, world.market, MARKET_DAY, world.line["line"],
                                           memory=self.memory(width))
            found[width] = (done, self.sealed(world), max(record))
        (serial, serial_rows, one), (parallel, parallel_rows, many) = found[1], found[3]
        self.assertEqual((one, many > 1), (1, True), "one stage at a time, then several")
        self.assertEqual(len(serial["ran"]), 6, "two candidates by three segments")
        self.assertEqual([{**item, "history_trial_id": None} for item in parallel["ran"]],
                         [{**item, "history_trial_id": None} for item in serial["ran"]],
                         "the same segments in the same order, with the same status")
        self.assertEqual({key: value for key, value in parallel.items() if key != "ran"},
                         {key: value for key, value in serial.items() if key != "ran"})
        self.assertEqual(parallel_rows, serial_rows, "item by item the same sealed status, reading and fingerprints")
        self.assertTrue(all(row["status"] == "passed" for row in serial_rows))

    def test_a_failing_segment_lets_the_others_seal_and_a_rerun_resumes(self):
        world = self.world("history-resume")
        line = world.line["line"]
        export, failed = world.market.export_catalogs, threading.Event()

        def flaky(market_day, symbols, start_ns, end_ns, *args, **kwargs):
            if not failed.is_set():
                failed.set()
                raise RuntimeError("export failed")
            return export(market_day, symbols, start_ns, end_ns, *args, **kwargs)
        with patch.object(world.market, "export_catalogs", flaky):
            with self.assertRaises(RuntimeError):
                history.run_history(world.profile, world.market, MARKET_DAY, line, memory=self.memory(3))
        sealed = len(self.sealed(world))
        self.assertEqual(sealed, 2, "the two segments started beside the failing one sealed; none started after it")
        rest = history.run_history(world.profile, world.market, MARKET_DAY, line, memory=self.memory(3))
        self.assertEqual((len(rest["ran"]), rest["left"], len(self.sealed(world))), (4, 0, 6),
                         "a rerun replays only the segments without a run")
        self.assertEqual(history.run_history(world.profile, world.market, MARKET_DAY, line, memory=self.memory(3))["ran"],
                         [], "and nothing once each has one")
