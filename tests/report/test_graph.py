"""If this fails, `research graph` no longer rebuilds a line from the ledger alone as a valid,
repeatable research-graph/1 document: versions with their runs and measures, the recommendation,
a failed review that masks a run, and the judgments as events. A throwaway ledger, never the
active one."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest

from ledger import db, strategies
from registration import precheck
from replay import entry
from report import graph
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid
from tests.report.test_reports import CANDIDATE_RETURNS, FINGERPRINT

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/research-graph"))
from research_graph import contract  # noqa: E402


@unittest.skipUnless(BINARY, SKIP)
class ResearchGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("graph")
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
        first, second = cls.refs
        world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first},
                                                {"role": "about", "candidate": second}])

    def graph(self, **options):
        return graph.research_graph(self.world.profile, max_drawdown=0.15, annual_return=0.2, **options)

    def test_1_the_line_is_a_valid_repeatable_graph_from_the_ledger(self):
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        self.assertEqual(found, self.graph(), "one ledger commit gives one graph")
        first, second = self.refs
        by_id = {c["id"]: c for c in found["candidates"]}
        self.assertLessEqual({first, second}, set(by_id))
        self.assertEqual((by_id[first]["status"], by_id[second]["status"]), ("recommended", "kept_reference"))
        run = next(t for t in by_id[second]["trials"] if t["purpose"] == "research")
        self.assertEqual((run["trial_id"], run["eligible"]), (self.runs[second]["trial_id"], True))
        self.assertIsNotNone(run["annual_return"], "an eligible run carries its measures")
        self.assertEqual(by_id[second]["registration"], "registration-pair")
        self.assertIsNotNone(by_id[second]["interpretation"])
        recommendation = [e for e in found["events"] if e["kind"] == "recommendation"]
        self.assertEqual(recommendation[-1]["recommends"], first)
        self.assertEqual(found["line"]["targets"], {"max_drawdown": 0.15, "annual_return": 0.2})

    def test_2_a_failed_review_masks_the_run_and_becomes_an_event(self):
        first, second = self.refs
        with db.read_as_of(self.world.profile) as conn:
            source = strategies.read_candidate(conn, second)["source_sha256"]
            (precheck_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s", (source,))
        precheck.record_review(self.world.profile, self.world.review_body(
            precheck_id, "failed", causal={"status": "failed", "note": "found later"}), "reviewer-g")
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        masked = next(c for c in found["candidates"] if c["id"] == second)
        run = next(t for t in masked["trials"] if t["purpose"] == "research")
        self.assertEqual((masked["status"], run["eligible"], run["annual_return"]), ("masked", False, None),
                         "a run without economic evidence shows no measures")
        self.assertIn("SOURCE_REVIEW_FAILED", run["ineligible_reason"])
        self.assertIn("causal", next(r for r in masked["reviews"] if r["verdict"] == "failed")["failed_items"])
        self.assertTrue(any(e["kind"] == "eligibility_change" and second in e["text"] for e in found["events"]))


if __name__ == "__main__":
    unittest.main()
