"""Runtime transitions through normal registration and binding on disposable Dolt ledgers."""

from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from ledger import trials
from registration import precheck, register, seams
from tests.ledger.dolt import BINARY, RUNTIME, SKIP, sha, source
from tests.registration.test_register import OTHER_RUNTIME, refused
from tests.registration.world import ACCOUNT, DESIGN, LINE_WINDOW, World, capture, config, inspect_stand_in


@unittest.skipUnless(BINARY, SKIP)
class ContinuityTests(unittest.TestCase):
    def setUp(self):
        self.world = World("continuity")
        self.addCleanup(self.world.close)
        self.data = source("root")
        self.review = self.review_on(self.data, RUNTIME)
        self.body = self.world.body(["rsi@1"], {"rsi@1": self.review}, comparison=None)
        self.old = self.world.register(self.body)["registration_id"]
        self.old_trial = self.world.research_trial(self.old, self.data)
        capture(self.world.conn, self.old_trial, self.data, purpose="research", fingerprint={"fixture": "same"})
        self.old_run = self.world.seal_run(self.old_trial)
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.old_trial}])

    def review_on(self, data, runtime, effective_config=None) -> int:
        trial_id = self.world.open_precheck(data, effective_config=effective_config, runtime=runtime)
        capture(self.world.conn, trial_id, data)
        return precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")["review_id"]

    def on_new_runtime(self):
        return seams.use(resolve_runtime=lambda ref: dict(OTHER_RUNTIME))

    def migrated_body(self):
        return {**self.body, "retry_of": self.old, "prechecks": {"rsi@1": self.review_on(self.data, OTHER_RUNTIME)}}

    def register(self, body) -> int:
        return self.world.register(body)["registration_id"]

    def reproduction(self, fingerprint, *, effective=None):
        trial_id = trials.open_trial(self.world.conn, "explore", sha(self.data), RUNTIME,
                                     self.world.receipt(self.old, effective), LINE_WINDOW,
                                     self.world.start(self.data))["trial_id"]
        capture(self.world.conn, trial_id, self.data, purpose="explore", fingerprint=fingerprint)
        return trial_id

    def test_valid_baseline_rebuild_binds_once_and_preserves_history(self):
        self.reproduction({"fixture": "same"})
        body = self.migrated_body()
        with self.on_new_runtime():
            new = self.register(body)
            trial_id = self.world.research_trial(new, self.data, runtime=OTHER_RUNTIME)
            capture(self.world.conn, trial_id, self.data, purpose="research")
            self.world.seal_run(trial_id)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
            self.assertEqual(refused(self.world.research_trial, new, self.data, runtime=OTHER_RUNTIME).code,
                             "GRID_ALREADY_ATTEMPTED")
            self.assertEqual(refused(self.world.register, {**body, "retry_of": new}).code, "RETRY_NOT_ALLOWED")
        self.assertEqual(refused(self.world.register, {**self.body, "retry_of": new}).code, "RETRY_NOT_ALLOWED",
                         "a rollback to the old image is no rebuild of the new run")
        third = {**OTHER_RUNTIME, "image_digest": "sha256:" + "d" * 64,
                 "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "d" * 64}
        third_review = self.review_on(self.data, third)
        with seams.use(resolve_runtime=lambda ref: dict(third)):
            self.register({**body, "retry_of": new, "prechecks": {"rsi@1": third_review}})
        self.assertEqual(self.world.plan(self.old)["body"], {key: self.body[key] for key in register.BODY_KEYS})
        self.assertEqual(self.world.conn.one("SELECT status FROM run WHERE trial_id = %s",
                                             (self.old_run,))["status"], "passed")

    def test_migration_requires_a_new_review_and_explicit_retry_link(self):
        body = self.migrated_body()
        with self.on_new_runtime():
            for name, changed, expected in (
                ("old review", {**body, "prechecks": self.body["prechecks"]}, "SOURCE_PRECHECK_REQUIRED"),
                ("unlinked", {k: v for k, v in body.items() if k != "retry_of"}, "SOURCE_ALREADY_EXPOSED"),
            ):
                with self.subTest(name=name):
                    self.assertEqual(refused(self.world.register, changed).code, expected)

    def test_valid_retry_cannot_change_research_declarations_or_execution_inputs(self):
        body = self.migrated_body()
        other = self.world.publish("other root", parent=None)
        other_review = self.review_on(other["source"], OTHER_RUNTIME)
        with self.on_new_runtime():
            for field in ("conditions", "prediction", "grid", "rationale", "comparison"):
                changed = copy.deepcopy(body)
                if field == "grid":
                    changed["grid"].append(other["candidate"])
                    changed["prechecks"][other["candidate"]] = other_review
                elif field == "prediction":
                    changed[field]["outcomes"]["loss"] += " and reconsider"
                elif field == "rationale":
                    changed[field]["local"] += " a different question"
                elif field == "comparison":
                    changed[field] = dict(DESIGN)
                else:
                    changed[field] += " changed"
                with self.subTest(field=field):
                    self.assertEqual(refused(self.world.register, changed).code, "RETRY_NOT_ALLOWED")

            def changed_account(identity, argv, inputs):
                inspected = inspect_stand_in(identity, argv, inputs)
                inspected["effective_config"]["account"]["starting_balance_usdt"] = "200000"
                return inspected
            # Its precheck ran on the new account too, so the retry rule is what refuses it.
            account = {**ACCOUNT, "starting_balance_usdt": "200000"}
            ran = config(symbols=["AAAUSDT"], start="2026-01-05T00:00:00Z", trade_start="2026-01-06T00:00:00Z",
                         end="2026-01-08T00:00:00Z", account=account)
            reviewed = self.review_on(self.data, OTHER_RUNTIME, ran)
            with seams.use(inspect_runtime=changed_account):
                self.assertEqual(refused(self.world.register, {**body, "prechecks": {"rsi@1": reviewed}}).code,
                                 "RETRY_NOT_ALLOWED")
            export = self.world.market.export_catalogs

            def changed_export(*args, **kwargs):
                found = export(*args, **kwargs)
                bar_file = found["root"] / "AAAUSDT/bars.parquet"
                bar_file.write_bytes(bar_file.read_bytes() + b" changed data")
                return found
            with patch.object(self.world.market, "export_catalogs", changed_export):
                self.assertEqual(refused(self.world.register, body).code, "RETRY_NOT_ALLOWED")

    def test_a_mismatching_explore_is_still_an_unregistered_exposure(self):
        self.reproduction({"fixture": "different"})
        body = self.migrated_body()
        seq = self.world.seq()
        with self.on_new_runtime():
            self.assertEqual(refused(self.world.register, body).code, "SOURCE_ALREADY_EXPOSED")
        self.assertEqual(self.world.seq(), seq)

    def test_an_uncited_old_precheck_remains_an_exposure(self):
        self.review_on(self.data, RUNTIME)
        body = self.migrated_body()
        with self.on_new_runtime():
            self.assertEqual(refused(self.world.register, body).code, "SOURCE_ALREADY_EXPOSED")

    def exposed(self):
        body = self.migrated_body()
        with self.on_new_runtime():
            exc = refused(self.world.register, body)
        self.assertEqual((exc.code, exc.missing), ("SOURCE_ALREADY_EXPOSED", ("rsi@1",)))

    def test_a_reproduction_with_another_configuration_is_an_exposure(self):
        self.reproduction({"fixture": "same"}, effective=config(account={**ACCOUNT, "starting_balance_usdt": "200000"}))
        self.exposed()

    def test_a_reproduction_without_a_completed_fingerprint_is_an_exposure(self):
        self.reproduction(None)
        self.exposed()

    def test_a_reproduction_of_a_chain_run_does_not_count_on_the_same_image(self):
        """Condition (4), relaxation 2: a verified reproduction of a trial the retry chain consumed is
        not counted whether or not the retry changes the image."""
        self.world.qualification.unavailable.add(self.old_run)  # a same-image retry needs no economic evidence
        self.reproduction({"fixture": "same"})
        self.assertFalse(self.world.register({**self.body, "retry_of": self.old})["replayed"])

    def test_invalid_child_retries_against_the_new_control_only(self):
        child = self.world.publish("child")
        old_review = self.review_on(child["source"], RUNTIME)
        original = self.world.body([child["candidate"]], {child["candidate"]: old_review},
                                   control_trial_id=self.old_run, duties=["G3"])
        child_old = self.register(original)
        failed = self.world.research_trial(child_old, child["source"])
        self.world.seal_run(failed, "invalid")
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": failed}])
        baseline = self.migrated_body()
        child_review = self.review_on(child["source"], OTHER_RUNTIME)
        with self.on_new_runtime():
            new = self.register(baseline)
            rebuilt = self.world.research_trial(new, self.data, runtime=OTHER_RUNTIME)
            rebuilt_run = self.world.seal_run(rebuilt)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": rebuilt}])
            retry = {**original, "retry_of": child_old, "prechecks": {child["candidate"]: child_review}}
            exc = refused(self.world.register, retry)
            self.assertEqual((exc.code, exc.missing), ("COMPARABILITY_MISMATCH", ("image_digest",)))
            child_new = self.register({**retry, "control_trial_id": rebuilt_run})
            self.world.research_trial(child_new, child["source"], runtime=OTHER_RUNTIME)
        self.assertEqual(self.world.conn.one("SELECT status FROM run WHERE trial_id = %s", (failed,))["status"],
                         "invalid")

    def test_successful_derived_rebuild_requires_the_equivalent_control_source(self):
        child = self.world.publish("valid child")
        review = self.review_on(child["source"], RUNTIME)
        original = self.world.body([child["candidate"]], {child["candidate"]: review},
                                   control_trial_id=self.old_run, duties=["G3"])
        child_old = self.register(original)
        old = self.world.research_trial(child_old, child["source"])
        self.world.seal_run(old)
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": old}])
        baseline = self.migrated_body()
        new_review = self.review_on(child["source"], OTHER_RUNTIME)
        other = self.world.publish("other root", parent=None)
        other_review = self.review_on(other["source"], OTHER_RUNTIME)
        with self.on_new_runtime():
            new = self.register(baseline)
            new_trial = self.world.research_trial(new, self.data, runtime=OTHER_RUNTIME)
            new_run = self.world.seal_run(new_trial)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": new_trial}])
            unrelated_registration = self.register(self.world.body([other["candidate"]],
                                                                   {other["candidate"]: other_review}, comparison=None))
            unrelated = self.world.research_trial(unrelated_registration, other["source"], runtime=OTHER_RUNTIME)
            unrelated_run = self.world.seal_run(unrelated)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": unrelated}])
            retry = {**original, "retry_of": child_old, "prechecks": {child["candidate"]: new_review}}
            self.assertEqual(refused(self.world.register, {**retry, "control_trial_id": unrelated_run}).code,
                             "RETRY_NOT_ALLOWED")
            self.register({**retry, "control_trial_id": new_run})
