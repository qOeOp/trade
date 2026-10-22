"""Real CLI consumers over disposable Dolt and the stand-in native runtime, never the active ledger."""

from __future__ import annotations

import contextlib
import io
import shutil
import unittest

from cli.main import replay_report
from ledger import execution, metrics
from ledger.errors import Refusal
from registration import precheck
from replay import entry, reproduce
from report import status
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_COMMIT, SKIP
from tests.replay.world import ReplayWorld


ARGV = ["--start", "2026-01-05T00:00:00Z", "--trade-start", "2026-01-06T00:00:00Z",
        "--end", "2026-01-08T00:00:00Z", "--symbols", "AAAUSDT"]


@unittest.skipUnless(BINARY, SKIP)
class PrecheckCacheTests(unittest.TestCase):
    def setUp(self):
        self.world = ReplayWorld("pre-cache")
        self.addCleanup(self.world.close)

    def checked(self, name="original"):
        world = self.world
        with contextlib.redirect_stderr(io.StringIO()):
            return entry.precheck(world.profile, world.market, MARKET_COMMIT, "rsi@1", IDENTITY["image_ref"],
                                  ARGV, world.output(name))

    def report(self, trial_id, directory=None, regenerated=None, reproduction_trial=None):
        return replay_report(self.world.profile, trial_id, str(directory) if directory else None, None, True,
                             str(regenerated) if regenerated else None, reproduction_trial, True, True)

    def review(self, trial_id, verdict="passed"):
        body = self.world.review_body(trial_id, verdict)
        if verdict == "failed":
            body["causal"] = {"status": "failed", "note": "original causal review failed"}
        return precheck.record_review(self.world.profile, body, "fresh-reader")

    def body(self, review):
        return self.world.body(["rsi@1"], {"rsi@1": review["bundle"]}, comparison=None)

    def test_clean_native_tables_are_cache_but_original_technical_facts_remain(self):
        original = self.checked()
        trial_id = original["trial_id"]
        capture = execution.read_capture(self.world.conn, trial_id)
        for name in metrics.REPORT_FILES.values():
            path = "reports/" + name
            self.assertEqual(capture["statuses"][path], "hashed")
            self.assertNotIn(path, capture["files"])
        self.assertIn(execution.FINGERPRINT_RESULT, capture["files"])
        before = self.world.seq()
        facts = self.report(trial_id)
        detail = self.report(trial_id, self.world.output("original"))
        self.assertFalse(facts["economic_evidence_available"])
        self.assertEqual(facts["summary"]["source_sha256"], original["source_sha256"])
        self.assertEqual((detail["reports_verified"], len(detail["reports"]["orders"])), (True, 2))
        self.assertIn("positions", detail["reports"])
        self.assertEqual(self.world.seq(), before, "verified cache reads write nothing")
        with self.assertRaises(Refusal) as caught:
            metrics.load_run(self.world.conn, trial_id)
        self.assertEqual(caught.exception.code, "UNKNOWN_RUN", "a precheck has no economic result")

    def test_original_cache_rejects_modified_missing_extra_and_linked_reports(self):
        original = self.checked()
        directory = self.world.output("original")
        for mode in ("changed", "missing", "extra", "link"):
            clone = self.world.output(mode)
            shutil.copytree(directory, clone)
            target = clone / "reports" / "orders.csv"
            if mode == "changed":
                target.write_bytes(target.read_bytes() + b"changed\n")
            elif mode == "missing":
                target.unlink()
            elif mode == "extra":
                (clone / "reports" / "unexpected.csv").write_text("extra\n")
            else:
                target.unlink()
                target.symlink_to(directory / "reports" / "orders.csv")
            with self.subTest(mode=mode), self.assertRaises(Refusal) as caught:
                self.report(original["trial_id"], clone)
            self.assertEqual(caught.exception.code, "REPRODUCTION_MISMATCH")

    def test_lost_cache_is_rebuilt_reviewed_and_registered_without_new_exposure(self):
        world = self.world
        original = self.checked()
        trial_id = original["trial_id"]
        shutil.rmtree(world.output("original"))
        rebuilt = reproduce.reproduce(trial_id, world.output("rebuilt"), ledger=world.profile, market=world.market)
        self.assertEqual(rebuilt["trial_id"], trial_id)
        self.assertNotEqual(rebuilt["reproduction_trial_id"], trial_id)
        detail = self.report(trial_id, regenerated=world.output("rebuilt"),
                             reproduction_trial=rebuilt["reproduction_trial_id"])
        self.assertTrue(detail["reports_verified"])
        self.assertEqual(world.conn.rows("SELECT COUNT(*) FROM run"), [(0,)])
        self.assertEqual(world.conn.rows("SELECT COUNT(*) FROM evidence_bundle WHERE bundle LIKE 'source-review-%'"),
                         [(0,)], "cache regeneration does not manufacture a source review")
        review = self.review(trial_id)
        world.register("registration-after-cache", self.body(review))
        counts = status.research_status(world.profile)
        self.assertIn(rebuilt["reproduction_trial_id"], counts["excluded_trials"]["reproductions"])
        self.assertEqual(counts["trials"], 1)
        # Admission and source review still work without the regenerated directory.
        shutil.rmtree(world.output("rebuilt"))
        self.assertIsNone(self.report(trial_id)["reports"])
        self.assertEqual(precheck.require_precheck(world.conn, review["bundle"], original["source_sha256"],
                                                  original["image_ref"], None), trial_id)

    def test_missing_fingerprint_preserves_reports_without_tightening_precheck_admission(self):
        world = self.world
        world.fingerprint = None
        original = self.checked()
        self.assertEqual(original["status"], "passed")
        capture = execution.read_capture(world.conn, original["trial_id"])
        orders = world.output("original") / "reports" / "orders.csv"
        self.assertEqual(capture["files"]["reports/orders.csv"], orders.read_bytes())
        review = self.review(original["trial_id"])
        world.register("registration-no-fingerprint", self.body(review))

    def test_failed_or_unequal_regeneration_does_not_gain_an_exposure_exemption(self):
        world = self.world
        original = self.checked()
        review = self.review(original["trial_id"])
        world.fingerprint = {"fills": {"rows": 99, "sha256": "f" * 64}}
        with self.assertRaises(Refusal) as caught:
            reproduce.reproduce(original["trial_id"], world.output("changed"), ledger=world.profile, market=world.market)
        self.assertEqual((caught.exception.code, caught.exception.write_status), ("REPRODUCTION_MISMATCH", "written"))
        with self.assertRaises(Refusal) as caught:
            world.register("registration-changed", self.body(review))
        self.assertEqual(caught.exception.code, "SOURCE_ALREADY_EXPOSED")
        self.assertEqual(status.research_status(world.profile)["excluded_trials"]["reproductions"], [])

    def test_later_success_never_replaces_failed_original_or_failed_review(self):
        world = self.world
        world.scenario = {"audit_exit": 1, "audit_passed": False}
        original = self.checked()
        captured = execution.read_capture(world.conn, original["trial_id"])
        self.assertIn("reports/orders.csv", captured["files"])
        self.review(original["trial_id"], "failed")
        world.scenario = {}
        with self.assertRaises(Refusal):
            reproduce.reproduce(original["trial_id"], world.output("later"), ledger=world.profile, market=world.market)
        self.assertEqual(execution.read_capture(world.conn, original["trial_id"])["stages"]["audit"]["exit_code"], 1)
        passed = self.review(original["trial_id"])
        with self.assertRaises(Refusal) as caught:
            world.register("registration-still-failed", self.body(passed))
        self.assertEqual(caught.exception.code, "SOURCE_PRECHECK_FAILED")

    def test_failed_review_of_a_clean_precheck_is_not_erased_by_regeneration(self):
        world = self.world
        original = self.checked()
        self.review(original["trial_id"], "failed")
        passed = self.review(original["trial_id"])
        reproduce.reproduce(original["trial_id"], world.output("again"), ledger=world.profile, market=world.market)
        with self.assertRaises(Refusal) as caught:
            world.register("registration-failed-review", self.body(passed))
        self.assertEqual(caught.exception.code, "SOURCE_PRECHECK_FAILED")
        self.assertEqual(self.report(original["trial_id"])["stages"]["native"]["exit_code"], 0)
