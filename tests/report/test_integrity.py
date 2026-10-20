"""A declared two-by-two read from its four corners, and the read-time views that facts recorded
after sealing must not bend: a retry after a later source review, each out-of-sample member's own
design, and a run whose records no longer verify. One throwaway ledger whose lineage is base, a and
b (both children of base) and ab (a child of a, the merge of a and b); the tests run in order and
the later ones tamper with it. Never the active ledger."""

from __future__ import annotations

import json
import math
import unittest

from ledger import db, strategies
from qualification import availability
from registration import precheck, register, seams as registration_seams
from replay import entry
from report import candidates, comparison, measures, seams, status
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP, SOURCE
from tests.registration.world import OUTCOMES, RUNNER_ARGV, capture
from tests.replay.world import ReplayWorld
from tests.report.test_reports import FINGERPRINT, market_returns


BASE = SOURCE + b"FIRST = 1\nMIDDLE = 0\nSECOND = 2\n"
A = BASE.replace(b"FIRST = 1", b"FIRST = 10")
B = BASE.replace(b"SECOND = 2", b"SECOND = 20")
AB = A.replace(b"SECOND = 2", b"SECOND = 20")
NOT_THE_MERGE = A.replace(b"SECOND = 2", b"SECOND = 21")
B_LATE = BASE.replace(b"SECOND = 2", b"SECOND = 22")
AB_LATE = A.replace(b"SECOND = 2", b"SECOND = 22")
RETURNS = {"a": [0.001, -0.0005], "b": [0.0005, -0.0006, 0.0002], "ab": [0.002, -0.001, 0.0005],
           "not_the_merge": [0.0015, -0.0002], "b_late": [0.0004, -0.0001], "ab_late": [0.001, 0.0002, -0.0004]}


@unittest.skipUnless(BINARY, SKIP)
class IntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("integrity")
        cls.addClassCleanup(world.close)
        cls.market = seams.use(market_returns=market_returns)
        cls.market.__enter__()
        cls.addClassCleanup(cls.market.__exit__, None, None, None)
        world.fingerprint = FINGERPRINT
        world.judge("review_cadence", cadence=50)
        cls.refs, cls.runs = {}, {}
        cls.publish("base", BASE, None, None)
        world.register("registration-base", world.body([cls.refs["base"]], {cls.refs["base"]: world.prechecked(BASE)}))
        cls.replay("base", "registration-base")
        cls.derive("a", A, "base", "base", "the first change")
        cls.derive("b", B, "base", "base", "the second change")
        interaction = {"base": cls.refs["base"], "a": cls.refs["a"], "b": cls.refs["b"]}
        cls.derive("ab", AB, "a", "a", "the second change", interaction)
        cls.derive("not_the_merge", NOT_THE_MERGE, "a", "a", "another second change", interaction)
        # A corner registered before its run: the interaction is declared while b_late has not run yet.
        cls.publish("b_late", B_LATE, "base", "a late second change")
        cls.register_child("b_late", B_LATE, "base", "base", "a late second change")
        cls.publish("ab_late", AB_LATE, "a", "a late second change")
        cls.register_child("ab_late", AB_LATE, "a", "a", "a late second change",
                           {"base": cls.refs["base"], "a": cls.refs["a"], "b": cls.refs["b_late"]})
        cls.replay("b_late", "registration-b_late")
        cls.replay("ab_late", "registration-ab_late")

    @classmethod
    def publish(cls, name: str, data: bytes, parent: str | None, difference: str | None) -> None:
        cls.refs[name] = strategies.publish_candidate(cls.world.profile, data, "lattice", "Fixture", f"corner {name}",
                                                      parent=cls.refs[parent] if parent else None,
                                                      difference=difference)["candidate"]

    @classmethod
    def register_child(cls, name, data, parent, control, change, interaction=None) -> None:
        world = cls.world
        prediction = {"mechanism": [{"slice": "capital_scaled", "measure": "unit_return", "direction": "up",
                                     "duty": "F3", "reason": "fixture"}], "outcomes": dict(OUTCOMES)}
        if interaction is not None:
            prediction["interaction"] = interaction
        world.register(f"registration-{name}", world.body(
            [cls.refs[name]], {cls.refs[name]: world.prechecked(data)}, parent=cls.refs[parent],
            control_run=cls.runs[control]["run_id"], change=change, duties=["F3"], prediction=prediction))

    @classmethod
    def derive(cls, name, data, parent, control, change, interaction=None) -> None:
        cls.publish(name, data, parent, change)
        cls.register_child(name, data, parent, control, change, interaction)
        cls.replay(name, f"registration-{name}")

    @classmethod
    def replay(cls, name: str, bundle: str) -> None:
        world = cls.world
        world.scenario = {"returns": RETURNS[name]} if name in RETURNS else {}
        try:
            cls.runs[name] = entry.run(world.profile, world.market, MARKET_COMMIT, cls.refs[name], None, RUNNER_ARGV,
                                       hypothesis=bundle)
        finally:
            world.scenario = {}
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.runs[name]["trial_id"]}])

    def setUp(self):
        self.world = self.__class__.world
        self.profile = self.world.profile

    def series(self, name: str) -> list[float]:
        with db.read_as_of(self.profile) as conn:
            return [value for _, value, _ in measures.run_facts(conn, self.runs[name]["run_id"])["returns"]]

    def test_1_a_declared_two_by_two_gives_the_uncorrected_interaction_and_both_contributions(self):
        found = comparison.compare(self.profile, "registration-ab", self.runs["ab"]["run_id"])
        interaction = found["attribution"]["interaction"]
        self.assertTrue(interaction["available"], interaction["reason"])
        self.assertEqual({name: item["run_id"] for name, item in interaction["corners"].items()},
                         {name: self.runs[name]["run_id"] for name in ("base", "a", "b", "ab")})
        logs = {name: sum(map(math.log1p, self.series(name))) / 31 for name in ("base", "a", "b", "ab")}
        expected = logs["ab"] - logs["a"] - logs["b"] + logs["base"]
        self.assertAlmostEqual(interaction["test"]["mean_daily_log_difference"], expected, places=12)
        weighted = comparison.paired([self.series("base"), self.series("a")], [self.series("b"), self.series("ab")],
                                     found["evidence"]["design"], 1, weights=(1, -1, -1, 1))
        self.assertEqual(interaction["test"]["mean_log_basic_interval"], weighted["mean_log_basic_interval"])
        self.assertEqual((interaction["uncorrected"], interaction["p"]), (True, None))
        self.assertFalse({"p_one_sided", "p_bonferroni"} & set(interaction["test"]), "no p for an interaction")
        self.assertFalse(any("p_one_sided" in item for item in interaction["test"]["block_sensitivity"]))
        parts = interaction["contributions"]
        self.assertAlmostEqual(parts["a"] + parts["b"], logs["ab"] - logs["base"], places=12)
        self.assertAlmostEqual(parts["a"], ((logs["a"] - logs["base"]) + (logs["ab"] - logs["b"])) / 2, places=12)
        self.assertIsNotNone(found["evidence"]["p_one_sided"], "the paired test of the comparison itself stands")

    def test_2_corners_that_do_not_attest_the_shape_leave_the_rest_of_the_comparison(self):
        cases = {"not_the_merge": "is not the source of", "ab_late": "not before the declaring registration"}
        for name, why in cases.items():
            with self.subTest(corner=name):
                found = comparison.compare(self.profile, f"registration-{name}", self.runs[name]["run_id"])
                interaction = found["attribution"]["interaction"]
                self.assertFalse(interaction["available"])
                self.assertTrue(interaction["reason"].startswith("INTERACTION_UNATTESTED: "), interaction["reason"])
                self.assertIn(why, interaction["reason"])
                self.assertIsNotNone(found["evidence"]["mean_daily_log_difference"])
                self.assertTrue(found["attribution"]["slices"]["trade_pairs"]["available"])
        plain = comparison.compare(self.profile, "registration-a", self.runs["a"]["run_id"])
        self.assertIsNone(plain["attribution"]["interaction"], "no declaration, no interaction")

    def test_3_a_source_review_recorded_after_sealing_does_not_make_a_passed_attempt_retryable(self):
        trial_id = self.world.open_precheck(BASE)
        capture(self.world.conn, trial_id, BASE)
        precheck.record_review(self.profile, self.world.review_body(
            trial_id, "failed", api={"status": "failed", "note": "found after the run was sealed"}), "reviewer-d")
        with db.read_as_of(self.profile) as conn:
            now = availability.assess(conn, {"run_id": self.runs["base"]["run_id"]})
        self.assertTrue(any(reason.startswith("SOURCE_REVIEW_FAILED") for reason in now["reasons"]),
                        "the read-time view counts the later review")
        with registration_seams.use(qualification_assess=availability.assess,
                                    qualification_require=availability.require):
            with db.read_as_of(self.profile) as conn:
                self.assertFalse(register.retryable(conn, self.runs["base"]["trial_id"]))
                self.assertFalse(register.retryable(conn, self.runs["a"]["trial_id"]))

    def admin_sql(self, *statements: str, params=None) -> None:
        conn = self.world.service.admin(self.profile)
        try:
            with conn.cursor() as cursor:
                for statement in statements:
                    cursor.execute(statement, params if "%s" in statement else None)
        finally:
            conn.close()

    def test_4_each_out_of_sample_member_is_tested_by_its_own_registered_design(self):
        registered = self.world.plan("registration-base")["body"]["comparison"]
        designs = [{**registered, "seed": 3}, {**registered, "seed": 29, "block_days": 3}]
        with db.read_as_of(self.profile) as conn:
            rows = {name: strategies.read_candidate(conn, self.refs[name]) for name in ("a", "b")}
        for (name, design), op in zip(zip(("a", "b"), designs, strict=True), ("v:a", "v:b"), strict=True):
            self.admin_sql("INSERT INTO validation_registration (strategy_id, revision, market_commit, universe_rule, "
                           "window_start, window_end, design, retry_of, op_id, created_at) VALUES (%s, %s, %s, "
                           "'pool-v1', '2026-01-01', '2026-02-01', %s, NULL, %s, UTC_TIMESTAMP(6))",
                           params=(rows[name]["strategy_id"], rows[name]["revision"], MARKET_COMMIT, json.dumps(design),
                                   op))
            self.admin_sql(f"INSERT INTO validation_binding (registration_id, trial_id, op_id) SELECT registration_id, "
                           f"{self.runs[name]['trial_id']}, 'bind:{op}' FROM validation_registration WHERE op_id = "
                           f"'{op}'")
        self.admin_sql("CALL DOLT_COMMIT('-a', '-m', 'tamper: two bound out-of-sample registrations', "
                       "'--skip-verification')")
        (first,), = self.world.service.sql(self.profile, "SELECT registration_id FROM validation_registration WHERE "
                                                         "op_id = 'v:a'")
        found = comparison.validation_report(self.profile, first)
        members = {member["candidate"]: member for member in found["family"]["members"]}
        own = comparison.single(self.series("b"), designs[1], 2)["p_one_sided"]
        borrowed = comparison.single(self.series("b"), designs[0], 2)["p_one_sided"]
        self.assertNotEqual(own, borrowed, "the fixture designs give different p values")
        self.assertEqual(members[self.refs["b"]]["p_one_sided"], own)
        self.assertEqual(members[self.refs["a"]]["p_one_sided"], found["single"]["p_one_sided"])
        self.assertEqual(found["single"]["design"], designs[0])

    def test_5_a_run_whose_records_do_not_verify_does_not_stop_the_lists_and_counts(self):
        trial_id = self.runs["not_the_merge"]["trial_id"]
        self.admin_sql(f"UPDATE evidence SET content = '{{}}' WHERE bundle = 'trial-{trial_id}-execution' AND "
                       "path = 'execution.json'",
                       "CALL DOLT_COMMIT('-a', '-m', 'tamper: an execution capture', '--skip-verification')")
        listed = candidates.candidates(self.profile)
        attempts = {item["trial_id"]: item for row in listed["candidates"] for item in row["attempts"]}
        broken = attempts[trial_id]["availability"]
        self.assertFalse(broken["economic_evidence_available"])
        self.assertTrue(broken["reasons"][0].startswith("EXECUTION_IDENTITY: "))
        self.assertTrue(attempts[self.runs["ab"]["trial_id"]]["availability"]["economic_evidence_available"])
        counted = status.research_status(self.profile)
        self.assertEqual(counted["unverified_runs"], [{"run_id": self.runs["not_the_merge"]["run_id"],
                                                       "reason": broken["reasons"][0]}])
        self.assertEqual(counted["valid_research_runs"] + counted["diagnostic_only_research_runs"]
                         + counted["invalid_research_runs"] + counted["unfinished_research_attempts"],
                         counted["research_attempts"])
        with db.connect(self.profile, "reader") as conn:
            state = status.research_state(conn)
        facts = [fact for item in state["interpretations"] for fact in item["facts"]
                 if (fact.get("trial") or {}).get("trial_id") == trial_id]
        self.assertEqual((facts[0]["availability"]["economic_evidence_available"], facts[0]["headline"]), (False, None))


if __name__ == "__main__":
    unittest.main()
