"""20261029-01: resolved zero-activity reviews, using only a throwaway ledger."""

from __future__ import annotations

import unittest

from ledger import db
from shared.errors import Refusal
from registration import availability, precheck, register, seams
from replay import entry
from report import runs
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_DAY, RUNTIME, SKIP, sha
from tests.registration.world import RUNNER_ARGV, capture
from tests.replay.world import ReplayWorld


QUIET = {"status": "unresolved", "note": "no fills to inspect"}
OTHER_RUNTIME = {**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "c" * 64,
                 "image_digest": "sha256:" + "c" * 64}


@unittest.skipUnless(BINARY, SKIP)
class ReviewActivityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = ReplayWorld("review-activity")
        cls.addClassCleanup(cls.world.close)

    def reviewed(self, data, fills=0, positions=0, *, verdict="failed", runtime=None, fingerprinted=True, **items):
        world = self.world
        trial_id = world.open_precheck(data, runtime=runtime)
        fingerprint = {name: {"rows": rows, "sha256": "1" * 64}
                       for name, rows in (("fills", fills), ("orders", fills), ("positions", positions))}
        capture(world.conn, trial_id, data, fingerprint=fingerprint if fingerprinted else None)
        body = world.review_body(trial_id, verdict, **items)
        return precheck.record_review(world.profile, body, "reviewer-b")["review_id"]

    def check(self, data, scope=None):
        return availability.source_reviews(self.world.conn, {"source_sha256": sha(data),
                                                            "image_digest": IDENTITY["image_digest"]}, scope=scope)

    def test_resolved_review_unmasks_the_sealed_report_without_rewriting_it(self):
        world = self.world
        candidate = world.publish("resolved", parent=None)
        data, ref = candidate["source"], candidate["candidate"]
        old = self.reviewed(data, activity=QUIET)
        original = precheck.read_review(world.conn, old)
        passed = self.reviewed(data, 2, 1, verdict="passed")
        registration = world.register(world.body([ref], {ref: passed}))["registration_id"]
        run = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=registration)
        self.assertEqual(run["status"], "passed")
        sealed_commit = db.head_commit(world.conn)
        report = runs.run_report(world.profile, run["trial_id"])
        self.assertIsNotNone(report["headline"])
        with db.read_as_of(world.profile) as conn:
            value = availability.require(conn, {"trial_id": run["trial_id"]})
            with seams.use(qualification_assess=availability.assess):
                self.assertFalse(register.retryable(conn, run["trial_id"]))
            identity = conn.one(f"SELECT image_ref, {', '.join(precheck.PRECHECK_COLUMNS)} FROM trial WHERE trial_id = %s",
                                (precheck.read_review(conn, old)["trial_id"],))
            with self.assertRaises(Refusal) as caught:
                precheck.require_precheck(conn, old, sha(data), identity)
        self.assertEqual(caught.exception.code, "SOURCE_PRECHECK_FAILED")
        self.assertEqual([item["review_id"] for item in value["source_check"]["reviews"]], [passed])
        self.assertEqual(value["source_check"]["ignored"][0]["review_id"], old)
        self.assertEqual(precheck.read_review(world.conn, old), original)
        self.assertEqual(db.head_commit(world.conn), sealed_commit)

    def test_only_the_original_three_conditions_release_the_failure(self):
        cases = [("api", 0, 0, {"api": QUIET, "activity": QUIET}, 2, False),
                 ("causal", 0, 0, {"causal": QUIET, "activity": QUIET}, 2, False),
                 ("readiness", 0, 0, {"readiness": QUIET, "activity": QUIET}, 2, False),
                 ("fills", 1, 0, {"activity": QUIET}, 2, False),
                 ("positions", 0, 1, {"activity": QUIET}, 2, False),
                 ("later-quiet", 0, 0, {"activity": QUIET}, 0, False),
                 ("later-failed", 0, 0, {"activity": QUIET}, 2, True)]
        for label, fills, positions, items, later_fills, failed in cases:
            with self.subTest(label=label):
                data = self.world.publish(label)["source"]
                old = self.reviewed(data, fills, positions, **items)
                later = self.reviewed(data, later_fills, later_fills, verdict="passed")
                if failed:
                    trial_id = precheck.read_review(self.world.conn, later)["trial_id"]
                    precheck.record_review(self.world.profile, self.world.review_body(
                        trial_id, "failed", activity=QUIET), "reviewer-c")
                found = self.check(data)
                self.assertEqual(found["status"], "failed")
                self.assertIn(old, [item["review_id"] for item in found["reviews"]])

    def test_missing_sealed_counts_cannot_be_assumed_zero(self):
        data = self.world.publish("missing-counts")["source"]
        self.reviewed(data, fingerprinted=False, activity=QUIET)
        self.reviewed(data, 2, 1, verdict="passed")
        self.assertEqual(self.check(data)["status"], "failed")

    def test_activity_failed_can_be_resolved_as_well_as_unresolved(self):
        data = self.world.publish("activity-failed")["source"]
        self.reviewed(data, activity={"status": "failed", "note": "no activity"})
        self.reviewed(data, 2, 1, verdict="passed")
        self.assertEqual(self.check(data)["status"], "passed")

    def test_recovery_requires_a_later_traded_review_of_this_source_and_image(self):
        for label in ("absent", "earlier", "another-source", "another-image"):
            with self.subTest(label=label):
                data = self.world.publish(label)["source"]
                if label == "earlier":
                    self.reviewed(data, 2, 1, verdict="passed")
                self.reviewed(data, activity=QUIET)
                if label == "another-source":
                    self.reviewed(self.world.publish("different")["source"], 2, 1, verdict="passed")
                if label == "another-image":
                    self.reviewed(data, 2, 1, verdict="passed", runtime=OTHER_RUNTIME)
                self.assertEqual(self.check(data)["status"], "failed")

    def test_recovery_obeys_the_review_scope(self):
        data = self.world.publish("scope")["source"]
        old = self.reviewed(data, activity=QUIET)
        passed = self.reviewed(data, 2, 1, verdict="passed")
        self.assertNotEqual(self.check(data, {"review_ids": [old]})["status"], "passed")
        self.assertEqual(self.check(data, {"review_ids": [old, passed]})["status"], "passed")
        self.assertEqual(self.check(data, {"review_ids": [passed]})["status"], "passed")
        trial_id = precheck.read_review(self.world.conn, passed)["trial_id"]
        precheck.record_review(self.world.profile, self.world.review_body(
            trial_id, "failed", causal=QUIET), "reviewer-c")
        self.assertEqual(self.check(data)["status"], "failed")
        self.assertEqual(self.check(data, {"review_ids": [old, passed]})["status"], "passed")
