"""If this fails, `research graph` no longer rebuilds a line from the ledger alone as a valid,
repeatable research-graph@3 document: versions with their source, runs and measures, the recommendation
(a version the recommendation only names as `about` is not marked kept),
a failed review that masks a run and one availability ignores for a run, the judgments as events, the targets in force for the line and
only the line's own runs and versions; or a graph is drawn while the ledger service is unreachable, whose missing
comparisons would read as research facts. A throwaway ledger, never the
active one."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from ledger import db, lines, strategies, targets
from ledger.errors import Refusal
from ledger.refusals import refuse
from qualification import availability
from registration import precheck
from replay import entry
from report import comparison, graph
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP, market as line_market
from tests.registration.world import RUNNER_ARGV, capture
from tests.replay.world import ReplayWorld, registered_grid
from tests.report.test_reports import CANDIDATE_RETURNS, FINGERPRINT

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/ide"))
from research_graph import contract, layout  # noqa: E402


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
        with db.connect(world.profile, "writer") as conn:
            targets.set_targets(conn, None, 0.15, 0.2)

    def graph(self, **options):
        return graph.research_graph(self.world.profile, **options)

    def test_1_the_line_is_a_valid_repeatable_graph_from_the_ledger(self):
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        self.assertEqual(found, self.graph(), "one ledger commit gives one graph")
        first, second = self.refs
        by_id = {c["id"]: c for c in found["candidates"]}
        self.assertLessEqual({first, second}, set(by_id))
        self.assertEqual((by_id[first]["status"], by_id[second]["status"]), ("recommended", "superseded"),
                         "a version the recommendation names only as `about` is not kept as a reference")
        run = next(t for t in by_id[second]["trials"] if t["purpose"] == "research")
        self.assertEqual((run["trial_id"], run["eligible"]), (self.runs[second]["trial_id"], True))
        self.assertIsNotNone(run["annual_return"], "an eligible run carries its measures")
        self.assertEqual(by_id[second]["registration"], "registration-pair")
        with db.read_as_of(self.world.profile) as conn:
            self.assertEqual(by_id[second]["source"], strategies.read_candidate(conn, second)["source"].decode(),
                             "a version carries its registered source")
        self.assertIsNotNone(by_id[second]["interpretation"])
        review = by_id[first]["reviews"][0]
        self.assertEqual(review["verdict"], "passed")
        for item in precheck.ITEMS:
            self.assertIn(f"{item} checked against the capture", review["note"],
                          "passed reviews retain every check's explanation in the graph")
        recommendation = [e for e in found["events"] if e["kind"] == "recommendation"]
        self.assertEqual(recommendation[-1]["recommends"], first)
        self.assertEqual(found["line"]["targets"], {"max_drawdown": 0.15, "annual_return": 0.2})

    def test_2_a_failed_review_masks_the_run_and_becomes_an_event(self):
        first, second = self.refs
        with db.read_as_of(self.world.profile) as conn:
            source = strategies.read_candidate(conn, second)["source_sha256"]
            (precheck_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s", (source,))
        notes = {
            "api": {"status": "passed", "note": "API inspected.\n\n- Orders use the pinned API.\n- Parameters match."},
            "causal": {"status": "failed", "note": "Found later.\n\nThe input arrives after submission."},
            "readiness": {"status": "no_opportunity", "note": "This capture does not reach the funding boundary."},
        }
        body = self.world.review_body(precheck_id, "failed", **notes)
        precheck.record_review(self.world.profile, body, "reviewer-g")
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        masked = next(c for c in found["candidates"] if c["id"] == second)
        run = next(t for t in masked["trials"] if t["purpose"] == "research")
        self.assertEqual((masked["status"], run["eligible"], run["annual_return"]), ("masked", False, None),
                         "a run without economic evidence shows no measures")
        self.assertIn("SOURCE_REVIEW_FAILED", run["ineligible_reason"])
        self.assertIn("causal", next(r for r in masked["reviews"] if r["verdict"] == "failed")["failed_items"])
        review = next(r for r in masked["reviews"] if r["verdict"] == "failed")
        for item in precheck.ITEMS:
            self.assertIn(body[item]["note"], review["note"],
                          "every item's original paragraphs and lists reach the detail renderer")
        self.assertIn("Causal (failed)\nFound later.", review["note"])
        self.assertIn("Readiness (no_opportunity)\n", review["note"])
        self.assertTrue(any(e["kind"] == "eligibility_change" and second in e["text"] for e in found["events"]))

    def test_2b_a_failed_review_availability_ignores_is_no_lost_evidence(self):
        world = self.world
        published = world.publish("resolved", parent=None)
        data, ref = published["source"], published["candidate"]
        def rows(count):
            return {name: {"rows": count, "sha256": "1" * 64} for name in ("fills", "orders", "positions")}
        quiet = world.open_precheck(data)
        capture(world.conn, quiet, data, fingerprint=rows(0))
        old = precheck.record_review(world.profile, world.review_body(
            quiet, "failed", activity={"status": "unresolved", "note": "no fills to inspect"}), "reviewer-g")["bundle"]
        passed = world.prechecked(data, fingerprint=rows(2))
        world.register("registration-resolved", world.body([ref], {ref: passed}))
        trial_id = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                             hypothesis="registration-resolved")["trial_id"]
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        run = next(t for c in found["candidates"] if c["id"] == ref for t in c["trials"] if t["purpose"] == "research")
        self.assertEqual((run["trial_id"], run["eligible"]), (trial_id, True))
        event = next(e for e in found["events"] if e["kind"] == "eligibility_change" and e["ref"] == old)
        self.assertIn("without economic evidence by it: none", event["text"],
                      "the graph names the runs availability counts the review against, not every run of the source")
        self.assertIn(f"not counted for [{trial_id}]: zero-fill, zero-position activity failure resolved", event["text"])

    def test_3_a_new_line_on_another_window_shows_no_run_of_the_old_one(self):
        first, second = self.refs
        bundle = lines.select_line(self.world.conn, "market", MARKET_COMMIT, date(2026, 2, 1), date(2026, 3, 1), first,
                                   slug="other-window", market=line_market(latest_complete_day=date(2026, 3, 31)),
                                   reviews=availability.review_records)["bundle"]
        found = graph.research_graph(self.world.profile, bundle)
        self.assertEqual(contract.check_graph(found), [])
        self.assertEqual([t for c in found["candidates"] for t in c["trials"] if t["purpose"] == "research"], [],
                         "the old line's runs traded another window")
        status = {c["id"]: c["status"] for c in found["candidates"]}
        self.assertEqual(status[first], "unrun")
        self.assertNotIn(second, status, "a version linked to the start whose research runs are all the old line's "
                         "is not drawn as this line's unrun or failed version")
        self.assertEqual(set(status.values()), {"unrun"}, "only the start and versions never run remain")
        child = self.world.publish("child", parent=first)["candidate"]
        self.assertIn(child, {c["id"] for c in graph.research_graph(self.world.profile, bundle)["candidates"]},
                      "a derivation not yet run anywhere is still drawn beside the line")
        lineage = next(w for w in layout.build_view(found)["widgets"] if w["type"] == "lineage@2")
        self.assertEqual(lineage["trail"], [], "a line without a recommendation still lays out")
        old = graph.research_graph(self.world.profile, self.world.line["bundle"])
        self.assertTrue(any(t["purpose"] == "research" for c in old["candidates"] for t in c["trials"]))
        self.assertIn(second, {c["id"] for c in old["candidates"]})

    def test_4_an_unreachable_ledger_refuses_the_graph(self):
        line = self.world.line["bundle"]

        def ledger_down(*arguments):
            raise refuse("LEDGER_UNAVAILABLE", "the ledger service is not running")
        with patch.object(comparison, "compare", ledger_down), self.assertRaises(Refusal) as caught:
            graph.research_graph(self.world.profile, line)
        self.assertEqual(caught.exception.code, "LEDGER_UNAVAILABLE")
        self.assertEqual(contract.check_graph(graph.research_graph(self.world.profile, line)), [],
                         "a run without a control is a missing comparison, not a refused graph")

if __name__ == "__main__":
    unittest.main()
