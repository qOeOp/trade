"""The trial counts of `research status` (user decision 2026-10-20): reproductions and trials the
product stopped before the strategy ran are listed apart and left out of the multiple-testing
counts; its comparison table, split by execution identity, and the recommendation that names every
candidate of the line's identity in it. A throwaway ledger with the stand-in runtime; never the
active ledger."""

from __future__ import annotations

import json
import unittest
from unittest import mock

from ledger.errors import Refusal
from ledger import db, judgments, strategies
from registration import precheck, register, seams as registration_seams
from replay import entry, reproduce
from report import measures, runs, status
from runtime import image
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_COMMIT, RUNTIME, SKIP
from tests.registration.world import RUNNER_ARGV, capture as capture_fixture
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
        done = reproduce.reproduce(passed["trial_id"], world.output("again"), ledger=world.profile, market=world.market)
        after = status.research_status(world.profile)
        self.assertEqual(after["excluded_trials"]["reproductions"], [done["reproduction_trial_id"]])
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
        self.assertEqual([item["trial_id"] for item in table["runs"]], [self.runs[ref]["trial_id"] for ref in self.refs])
        for item in table["runs"]:
            report = runs.run_report(self.world.profile, item["trial_id"])
            self.assertEqual({name: item["measures"][name]["value"] for name in table["measures"]},
                             {name: report["headline"][name]["value"] for name in table["measures"]},
                             "the single-run report's measures, not a recomputation")
        first, second = table["runs"]
        for item, other in ((first, second), (second, first)):
            dominated = status._dominates(other["measures"], item["measures"])
            self.assertEqual(item["dominated_by"], [other["trial_id"]] if dominated else [])
            complete = all(item["measures"][name]["value"] is not None for name in table["measures"])
            self.assertEqual(item["non_dominated"], (not dominated) if complete else None)

    def test_a_recommendation_must_name_every_candidate_of_the_table(self):
        first, second = self.refs
        with self.assertRaises(Refusal) as caught:
            self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first}])
        self.assertEqual((caught.exception.code, caught.exception.missing), ("RECOMMENDATION_INCOMPLETE", (second,)))
        self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first},
                                                     {"role": "about", "candidate": second}])

    def test_x_a_line_whose_candidates_are_on_a_contract_without_layout_is_gated(self):
        first, second = self.refs
        self.world.judge("priority", subjects=[{"role": "parent", "candidate": first},
                                               {"role": "control", "candidate": second}])
        with db.connect(self.world.profile, "reader") as conn:
            self.assertNotIn("RUNTIME_UNSUPPORTED", [gate["code"] for gate in status.research_state(conn)["gates"]])
            with mock.patch.dict(image.LAYOUTS, {"replay-contract@v99": {}}, clear=True):
                gate = status.research_state(conn)["gates"][-1]
        self.assertEqual((gate["code"], gate["missing"]), ("RUNTIME_UNSUPPORTED", sorted(self.refs)))
        self.assertIn(strategies.RUNTIME_CONTRACT, gate["message"])
        self.assertIn("replay-contract@v99", gate["message"])

    def test_y_the_default_state_keeps_the_judgments_after_the_recommendation(self):
        first, second = self.refs
        self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first},
                                                     {"role": "about", "candidate": second}])
        later = self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.runs[first]["trial_id"]}])
        with db.connect(self.world.profile, "reader") as conn:
            default, full = status.research_state(conn), status.research_state(conn, full=True)
        self.assertEqual([item["judgment_id"] for item in default["interpretations"]], [later])
        self.assertEqual(default["earlier"], {"interpretations": len(full["interpretations"]) - 1,
                                              "search_exposures": len(full["search_exposures"])})
        self.assertGreater(len(full["interpretations"]), 1)
        self.assertIsNone(default["facts"])
        self.assertEqual(full["facts"]["counts"]["research_attempts"], 2)
        self.assertIsNone(full["earlier"])
        self.assertEqual((default["recommendation"], default["gates"], default["unreviewed_trials"]),
                         (full["recommendation"], full["gates"], full["unreviewed_trials"]))

    def test_z_a_later_failed_review_lists_the_run_apart_and_flags_its_earlier_report(self):
        first, second = self.refs
        trial_id = self.runs[second]["trial_id"]
        before = status.research_status(self.world.profile)["ledger_commit"]
        with db.read_as_of(self.world.profile) as conn:
            source_sha256 = strategies.read_candidate(conn, second)["source_sha256"]
            (precheck_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s",
                                        (source_sha256,))
        precheck.record_review(self.world.profile, self.world.review_body(
            precheck_id, "failed", causal={"status": "failed", "note": "found after the run was sealed"}), "reviewer-z")
        table = status.research_status(self.world.profile)["comparison"]
        self.assertEqual([item["trial_id"] for item in table["runs"]], [self.runs[first]["trial_id"]])
        (apart,) = table["without_economic_evidence"]
        self.assertEqual((apart["candidate"], apart["trial_id"]), (second, trial_id))
        self.assertTrue(any(reason.startswith("SOURCE_REVIEW_FAILED") for reason in apart["reasons"]))
        earlier = runs.run_report(self.world.profile, trial_id, before)
        self.assertIsNotNone(earlier["headline"], "the historical reading stays readable")
        self.assertTrue(any("at the research head" in item and "SOURCE_REVIEW_FAILED" in item
                            for item in earlier["limitations"]))
        self.assertFalse(any("at the research head" in item
                             for item in runs.run_report(self.world.profile, self.runs[first]["trial_id"], before)
                             ["limitations"]), "a run the head still qualifies carries no such note")

OTHER_DIGEST = "sha256:" + "c" * 64
OTHER_IDENTITY = {**IDENTITY, "image_ref": "ghcr.io/qoeop/trade-runtime@" + OTHER_DIGEST, "image_digest": OTHER_DIGEST}
BETTER_RETURNS = [0.004, -0.0002, 0.003, -0.0001, 0.002]  # beats CANDIDATE_RETURNS on every measure it moves


@unittest.skipUnless(BINARY, SKIP)
class ExecutionIdentityTests(unittest.TestCase):
    """Two runs on the line's first image, then a better one on a rebuilt image (finding 20261025-25):
    rows carry their identity, dominance stays within one, and the recommendation and the unreviewed
    trials follow the line's latest identity."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("identity")
        cls.addClassCleanup(world.close)
        world.fingerprint = FINGERPRINT
        cls.selected = db.head_commit(world.conn)
        cls.refs = registered_grid(world, ["first", "second"], "registration-pair")
        cls.trials = {}
        for ref, returns in zip(cls.refs, (None, CANDIDATE_RETURNS), strict=True):
            world.scenario = {"returns": returns} if returns else {}
            cls.trials[ref] = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                                        hypothesis="registration-pair")["trial_id"]
            world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.trials[ref]}])
        cls.before = db.head_commit(world.conn)
        published = world.publish("third", parent=None)
        cls.third = published["candidate"]
        precheck_id = world.open_precheck(published["source"], runtime={**RUNTIME, **OTHER_IDENTITY})
        capture_fixture(world.conn, precheck_id, published["source"])
        review = precheck.record_review(world.profile, world.review_body(precheck_id), "reviewer-b")["bundle"]
        with registration_seams.use(resolve_runtime=lambda ref: dict(OTHER_IDENTITY)):
            world.register("registration-other", world.body([cls.third], {cls.third: review}))
            world.scenario = {"returns": BETTER_RETURNS}
            cls.trials[cls.third] = entry.run(world.profile, world.market, MARKET_COMMIT, cls.third, None,
                                              RUNNER_ARGV, hypothesis="registration-other")["trial_id"]
        world.scenario = {}
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.trials[cls.third]}])

    def test_a_rows_carry_their_identity_and_dominance_stays_within_one(self):
        table = status.research_status(self.world.profile)["comparison"]
        rows = {item["candidate"]: item for item in table["runs"]}
        by_trial = {item["trial_id"]: item for item in table["runs"]}
        first, second = (rows[ref]["execution_identity"] for ref in self.refs)
        third = rows[self.third]["execution_identity"]
        self.assertEqual(first, second)
        self.assertEqual((first["runtime_contract"], first["image_digest"]),
                         (IDENTITY["runtime_contract"], IDENTITY["image_digest"]))
        self.assertEqual((third["runtime_contract"], third["image_digest"]),
                         (IDENTITY["runtime_contract"], OTHER_DIGEST))
        self.assertNotEqual(first["key"], third["key"])
        with db.read_as_of(self.world.profile) as conn:
            effective = register.control_trial(conn, self.trials[self.third])["effective_config"]
        self.assertEqual(third["execution"], effective["account"].get("execution"))
        better, worse = rows[self.third], rows[self.refs[1]]
        self.assertTrue(status._dominates(better["measures"], worse["measures"]),
                        "the rebuilt image's run would dominate the old one if they were compared")
        self.assertNotIn(better["trial_id"], worse["dominated_by"])
        for item in table["runs"]:
            for other in item["dominated_by"]:
                self.assertEqual(by_trial[other]["execution_identity"]["key"],
                                 item["execution_identity"]["key"])
        self.assertTrue(better["non_dominated"], "alone in its identity")
        self.assertEqual(table["execution_identity"], third, "the line's latest trial sets its identity")
        self.assertEqual(table["candidates"], [self.third])

    def test_b_a_recommendation_names_the_candidates_of_the_lines_identity_at_its_commit(self):
        world = self.world
        self.assertEqual(status.compared_candidates(world.profile, world.line["bundle"], self.before), sorted(self.refs))
        self.assertEqual(status.compared_candidates(world.profile, world.line["bundle"], self.selected), [],
                         "a line without a trial of its own has no identity yet")
        with self.assertRaises(Refusal) as caught:
            judgments.add_judgment(world.profile, "recommendation", world.line["bundle"], self.before, "old image",
                                   subjects=[{"role": "recommended", "candidate": self.third}],
                                   compared=lambda line, at: status.compared_candidates(world.profile, line, at))
        self.assertEqual((caught.exception.code, caught.exception.missing),
                         ("RECOMMENDATION_INCOMPLETE", tuple(sorted(self.refs))))

    def test_c_the_unreviewed_trials_are_those_of_the_lines_identity_and_the_count_keeps_every_one(self):
        with db.connect(self.world.profile, "reader") as conn:
            empty = status.research_state(conn, at=self.selected)
            old = status.research_state(conn, at=self.before)
            new = status.research_state(conn)
        self.assertEqual((empty["execution_identity"], empty["unreviewed_trials"]), (None, []))
        self.assertEqual(old["unreviewed_trials"], [self.trials[ref] for ref in self.refs])
        self.assertEqual(new["unreviewed_trials"], [self.trials[self.third]])
        self.assertEqual(new["execution_identity"]["image_digest"], OTHER_DIGEST)
        self.assertEqual(new["trials_on_line"], 3, "the trial count still counts every identity")

    def test_d_a_recommendation_of_the_new_identity_need_not_name_the_old_one(self):
        self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": self.third}])
        with db.connect(self.world.profile, "reader") as conn:
            self.assertEqual(status.research_state(conn)["unreviewed_trials"], [])


if __name__ == "__main__":
    unittest.main()
