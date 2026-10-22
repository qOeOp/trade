"""Runtime transitions through normal registration and binding on disposable Dolt ledgers."""

from __future__ import annotations

import copy
import unittest

from ledger import trials
from registration import precheck, register, seams
from tests.ledger.dolt import BINARY, RUNTIME, SKIP, context, sha, source
from tests.registration.test_register import OTHER_RUNTIME, refused
from tests.registration.world import LINE_WINDOW, World, capture, coverage_bytes, inspect_stand_in


@unittest.skipUnless(BINARY, SKIP)
class ContinuityTests(unittest.TestCase):
    def setUp(self):
        self.world = World("continuity")
        self.addCleanup(self.world.close)
        self.data = source("root")
        self.review = self.review_on(self.data, RUNTIME)
        self.body = self.world.body(["rsi@1"], {"rsi@1": self.review}, comparison=None)
        self.world.register("registration-old", self.body)
        self.old_trial = self.world.research_trial("registration-old", self.data)
        capture(self.world.conn, self.old_trial, self.data, purpose="research", fingerprint={"fixture": "same"})
        self.old_run = self.world.seal_run(self.old_trial)
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.old_trial}])

    def review_on(self, data, runtime):
        trial_id = self.world.open_precheck(data, runtime=runtime)
        capture(self.world.conn, trial_id, data)
        return precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")["bundle"]

    def on_new_runtime(self):
        return seams.use(resolve_runtime=lambda ref: dict(OTHER_RUNTIME), inspect_runtime=inspect_stand_in,
                         market=lambda profile: profile, qualification_require=self.world.qualification.require,
                         qualification_assess=self.world.qualification.assess)

    def migrated_body(self):
        return {**self.body, "retry_of": "registration-old",
                "prechecks": {"rsi@1": self.review_on(self.data, OTHER_RUNTIME)}}

    def reproduction(self, fingerprint, *, effective=None):
        execution = self.world.plan("registration-old")["execution"]
        config = effective or execution["effective_config"]
        trial_id = trials.open_trial(
            self.world.conn, "explore", sha(self.data), RUNTIME,
            {"identity": execution["input_identity"], "input_coverage": coverage_bytes(config)},
            LINE_WINDOW, context(self.data, self.world.workdir()))["trial_id"]
        capture(self.world.conn, trial_id, self.data, purpose="explore", fingerprint=fingerprint)
        return trial_id

    def test_valid_baseline_rebuild_binds_once_and_preserves_history(self):
        self.reproduction({"fixture": "same"})
        body = self.migrated_body()
        with self.on_new_runtime():
            self.world.register("registration-new", body)
            trial_id = self.world.research_trial("registration-new", self.data, runtime=OTHER_RUNTIME)
            capture(self.world.conn, trial_id, self.data, purpose="research")
            self.world.seal_run(trial_id)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
            self.assertEqual(refused(self.world.research_trial, "registration-new", self.data,
                                     runtime=OTHER_RUNTIME).code, "GRID_ALREADY_ATTEMPTED")
            self.assertEqual(refused(self.world.register, "registration-again",
                                     {**body, "retry_of": "registration-new"}).code, "RETRY_NOT_ALLOWED")
        with seams.use(resolve_runtime=lambda ref: dict(RUNTIME)):
            self.assertEqual(refused(self.world.register, "registration-rollback",
                                     {**self.body, "retry_of": "registration-new"}).code, "RETRY_NOT_ALLOWED")
        self.assertEqual(self.world.plan("registration-old")["body"], self.body)
        self.assertEqual(self.world.conn.one("SELECT status FROM run WHERE run_id = %s",
                                            (self.old_run,))["status"], "passed")

    def test_migration_requires_a_new_review_and_explicit_retry_link(self):
        body = self.migrated_body()
        with self.on_new_runtime():
            for name, changed, expected in (
                ("old-review", {**body, "prechecks": self.body["prechecks"]}, "SOURCE_PRECHECK_REQUIRED"),
                ("unlinked", {k: v for k, v in body.items() if k != "retry_of"}, "SOURCE_ALREADY_EXPOSED"),
            ):
                with self.subTest(name=name):
                    self.assertEqual(refused(self.world.register, "registration-" + name, changed).code, expected)

    def test_valid_retry_cannot_change_research_declarations_or_execution_inputs(self):
        body = self.migrated_body()
        with self.on_new_runtime():
            for field in ("conditions", "prediction", "grid", "rationale", "comparison"):
                changed = copy.deepcopy(body)
                if field == "grid":
                    changed[field][0]["params"] = {"changed": True}
                elif field == "prediction":
                    changed[field]["outcomes"]["loss"] += " and reconsider"
                elif field == "rationale":
                    changed[field]["local"] += " a different question"
                elif field == "comparison":
                    changed[field] = dict(self.world.body([], {})["comparison"])
                else:
                    changed[field] += " changed"
                with self.subTest(field=field):
                    self.assertEqual(refused(self.world.register, "registration-change-" + field, changed).code,
                                     "RETRY_NOT_ALLOWED")
            def changed_account(identity, argv, inputs):
                inspected = inspect_stand_in(identity, argv, inputs)
                inspected["effective_config"]["account"]["starting_balance_usdt"] = "200000"
                return inspected
            with seams.use(inspect_runtime=changed_account):
                self.assertEqual(refused(self.world.register, "registration-account", body).code,
                                 "RETRY_NOT_ALLOWED")

    def test_a_mismatching_explore_is_still_an_unregistered_exposure(self):
        self.reproduction({"fixture": "different"})
        body = self.migrated_body()
        seq = self.world.seq()
        with self.on_new_runtime():
            self.assertEqual(refused(self.world.register, "registration-new", body).code, "SOURCE_ALREADY_EXPOSED")
        self.assertEqual(self.world.seq(), seq)

    def test_reproduction_proof_requires_configuration_and_completed_fingerprinting(self):
        effective = copy.deepcopy(self.world.plan("registration-old")["execution"]["effective_config"])
        effective["account"]["starting_balance_usdt"] = "200000"
        wrong_config = self.reproduction({"fixture": "same"}, effective=effective)
        missing_fingerprint = self.reproduction(None)
        for trial_id in (wrong_config, missing_fingerprint):
            with self.subTest(trial_id=trial_id):
                self.assertFalse(register._verified_reproduction(self.world.conn, trial_id, ["registration-old"]))

    def test_invalid_child_retries_against_the_new_control_only(self):
        child = self.world.publish("child")
        old_review = self.review_on(child["source"], RUNTIME)
        original = self.world.body([child["candidate"]], {child["candidate"]: old_review}, parent="rsi@1",
                                   control_run=self.old_run, change="cap volume at 5%", duties=["G3"])
        self.world.register("registration-child-old", original)
        failed = self.world.research_trial("registration-child-old", child["source"])
        self.world.seal_run(failed, "invalid")
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": failed}])
        baseline = self.migrated_body()
        child_review = self.review_on(child["source"], OTHER_RUNTIME)
        with self.on_new_runtime():
            self.world.register("registration-new", baseline)
            rebuilt = self.world.research_trial("registration-new", self.data, runtime=OTHER_RUNTIME)
            rebuilt_run = self.world.seal_run(rebuilt)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": rebuilt}])
            retry = {**original, "retry_of": "registration-child-old",
                     "prechecks": {child["candidate"]: child_review}}
            self.assertEqual(refused(self.world.register, "registration-child-old-control", retry).code,
                             "COMPARABILITY_MISMATCH")
            self.world.register("registration-child-new", {**retry, "control_run": rebuilt_run})
            self.world.research_trial("registration-child-new", child["source"], runtime=OTHER_RUNTIME)
        self.assertEqual(self.world.conn.one("SELECT status FROM run WHERE trial_id = %s", (failed,))["status"],
                         "invalid")
