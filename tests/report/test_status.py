"""The trial counts of `research status` (user decision 2026-10-20): reproductions and trials the
product stopped before the strategy ran are listed apart and left out of the multiple-testing
counts. A throwaway ledger with the stand-in runtime; never the active ledger."""

from __future__ import annotations

import json
import unittest

from replay import entry, reproduce
from report import status
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid


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


if __name__ == "__main__":
    unittest.main()
