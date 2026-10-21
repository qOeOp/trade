"""The trial counts of `research status` (user decision 2026-10-20): reproductions and trials the
product stopped before the strategy ran are listed apart and left out of the multiple-testing
counts; its comparison table and the recommendation that names every candidate in it. A throwaway
ledger with the stand-in runtime; never the active ledger."""

from __future__ import annotations

import json
import unittest

from ledger.errors import Refusal
from ledger import db, judgments
from replay import entry, reproduce
from report import measures, runs, status
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid
from tests.report.test_reports import CANDIDATE_RETURNS, FINGERPRINT


def capture(native_exit=1, outcome="completed", summary="missing", failures="missing") -> dict:
    return {"stages": {"native": {"state": "exited", "exit_code": native_exit}}, "outcome": {"kind": outcome},
            "files": {"reports/summary.json": {"status": summary}, "reports/runtime_failures.jsonl": {"status": failures}}}


class StoppedBeforeStrategyTests(unittest.TestCase):
    def test_only_a_completed_nonzero_exit_without_summary_or_strategy_failures_is_stopped(self):
        load = json.dumps({"stage": "load", "exception_type": "Refusal", "code": "BINDING_MISMATCH", "count": 1})
        bar = json.dumps({"stage": "on_bar", "exception_type": "AttributeError"})
        cases = [(capture(), None, True), (capture(), load.encode(), True),
                 (capture(), (load + "\n" + bar).encode(), False), (capture(), b"not json", False),
                 (capture(summary="captured"), None, False), (capture(native_exit=0), None, False),
                 (capture(outcome="interrupted"), None, False), (None, None, False)]
        for found, failures, expected in cases:
            with self.subTest(capture=found, failures=failures):
                self.assertIs(status.stopped_before_strategy(found, failures), expected)


@unittest.skipUnless(BINARY, SKIP)
class TrialCountTests(unittest.TestCase):
    def setUp(self):
        self.world = world = ReplayWorld("status")
        self.addCleanup(world.close)
        world.fingerprint = {"fills": {"rows": 2, "sha256": "1" * 64}}

    def replay(self, ref: str, bundle: str) -> dict:
        return entry.run(self.world.profile, self.world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                         hypothesis=bundle)

    def test_history_keeps_replaced_text_subjects_and_pinned_pages_without_changing_gates(self):
        world = self.world
        first = judgments.add_judgment(world.profile, "interpretation", world.line["bundle"],
                                       db.head_commit(world.conn), "original conclusion",
                                       subjects=[{"role": "about", "candidate": "rsi@1"}])
        for _ in range(20):
            world.judge("priority")
        last = judgments.add_judgment(world.profile, "interpretation", world.line["bundle"],
                                      db.head_commit(world.conn), "corrected conclusion",
                                      subjects=[{"role": "about", "candidate": "rsi@1"}],
                                      supersedes=first["judgment_id"])
        with db.connect(world.profile, "reader") as conn:
            default = status.research_state(conn)
            first_page = status.research_state(conn, history=True)
            self.assertEqual(default["judgment_history"], {"total": 22, "superseded": 1,
                                                           "entries": [], "next_before": None})
            self.assertEqual(default["gates"], first_page["gates"])
            self.assertEqual(default["interpretations"], first_page["interpretations"])
            history = first_page["judgment_history"]
            self.assertEqual(len(history["entries"]), 20)
            self.assertEqual(history["entries"][0]["supersedes"], first["judgment_id"])
            older = status.research_state(conn, at=first_page["at"], history_before=history["next_before"])
            tail = older["judgment_history"]
            self.assertEqual(len(tail["entries"]), 2)
            original = tail["entries"][-1]
            self.assertEqual((original["body"], original["superseded_by"]),
                             ("original conclusion", last["judgment_id"]))
            self.assertEqual(original["subjects"][0]["strategy_id"], "rsi")
            self.assertIsNone(tail["next_before"])
            pinned = status.research_state(conn, at=first["ledger_commit"], history=True)
            self.assertEqual(pinned["judgment_history"]["total"], 1)
            self.assertIsNone(pinned["judgment_history"]["entries"][0]["superseded_by"])

    def test_reproductions_and_trials_stopped_before_the_strategy_are_not_counted(self):
        world = self.world
        (kept,) = registered_grid(world, ["kept"], "registration-kept")
        passed = self.replay(kept, "registration-kept")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": passed["trial_id"]}])
        (stopped,) = registered_grid(world, ["stopped"], "registration-stopped")
        world.scenario = {"skip_reports": True}  # the runner exits 1 before writing any report
        refused = self.replay(stopped, "registration-stopped")
        world.scenario = {}
        before = status.research_status(world.profile)
        self.assertEqual(refused["status"], "invalid")
        self.assertEqual(before["excluded_trials"], {"reproductions": [],
                                                     "stopped_before_strategy": [refused["trial_id"]]})
        done = reproduce.reproduce(passed["run_id"], world.output("again"), ledger=world.profile, market=world.market)
        after = status.research_status(world.profile)
        self.assertEqual(after["excluded_trials"]["reproductions"], [done["trial_id"]])
        self.assertEqual((after["trials"], after["distinct_sources"], after["by_development_window"]),
                         (before["trials"], before["distinct_sources"], before["by_development_window"]))
        window = after["by_development_window"]
        self.assertEqual(sum(item["trials"] for item in window), after["trials"])
        self.assertEqual(after["invalid_research_runs"], 1, "the attempt itself still counts as invalid")


def measured(annual, drawdown, sharpe, win) -> dict:
    values = dict(zip(status.TABLE_MEASURES, (annual, drawdown, sharpe, win), strict=True))
    return {measures.key(name): {"value": value} for name, value in values.items()}


class DominanceTests(unittest.TestCase):
    def test_a_run_dominates_when_no_worse_on_all_four_and_better_on_one(self):
        base = measured(0.10, 0.20, 1.0, 0.5)
        self.assertTrue(status._dominates(measured(0.10, 0.15, 1.0, 0.5), base), "a smaller drawdown is better")
        self.assertTrue(status._dominates(measured(0.12, 0.20, 1.1, 0.6), base))
        self.assertFalse(status._dominates(base, base), "equal on all four is no dominance")
        self.assertFalse(status._dominates(measured(0.20, 0.30, 2.0, 0.9), base), "a larger drawdown trades off")
        self.assertFalse(status._dominates(measured(0.20, 0.10, 2.0, None), base), "a missing measure never compares")


@unittest.skipUnless(BINARY, SKIP)
class ComparisonTableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("comparison")
        cls.addClassCleanup(world.close)
        world.fingerprint = FINGERPRINT
        cls.refs = registered_grid(world, ["first", "second"], "registration-pair")
        cls.runs = {}
        for ref, returns in zip(cls.refs, (None, CANDIDATE_RETURNS), strict=True):
            world.scenario = {"returns": returns} if returns else {}
            cls.runs[ref] = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                                      hypothesis="registration-pair")
            world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.runs[ref]["trial_id"]}])
        world.scenario = {}

    def test_the_table_lists_every_available_run_with_its_report_measures_and_dominance(self):
        table = status.research_status(self.world.profile)["comparison"]
        self.assertEqual((table["line"], table["window_start"], table["window_end"], table["universe_rule"]),
                         (self.world.line["bundle"], "2026-01-01", "2026-02-01", self.world.line["universe_rule"]))
        self.assertEqual(table["candidates"], sorted(self.refs))
        self.assertEqual([item["run_id"] for item in table["runs"]], [self.runs[ref]["run_id"] for ref in self.refs])
        for item in table["runs"]:
            report = runs.run_report(self.world.profile, item["run_id"])
            self.assertEqual({name: item["measures"][name]["value"] for name in table["measures"]},
                             {name: report["headline"][name]["value"] for name in table["measures"]},
                             "the single-run report's measures, not a recomputation")
        first, second = table["runs"]
        for item, other in ((first, second), (second, first)):
            dominated = status._dominates(other["measures"], item["measures"])
            self.assertEqual(item["dominated_by"], [other["run_id"]] if dominated else [])
            complete = all(item["measures"][name]["value"] is not None for name in table["measures"])
            self.assertEqual(item["non_dominated"], (not dominated) if complete else None)

    def test_a_recommendation_must_name_every_candidate_of_the_table(self):
        first, second = self.refs
        with self.assertRaises(Refusal) as caught:
            self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first}])
        self.assertEqual((caught.exception.code, caught.exception.missing), ("RECOMMENDATION_INCOMPLETE", (second,)))
        self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first},
                                                     {"role": "about", "candidate": second}])

if __name__ == "__main__":
    unittest.main()
