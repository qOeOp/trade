"""Execution captures, independent source reviews, precheck admission, the precheck exposure
exemption and the reviewed start of a research line, on a throwaway ledger."""

from __future__ import annotations

from datetime import date
import hashlib
import json
import unittest

from ledger import evidence, execution, lines, trials
from ledger.errors import Refusal
from qualification import availability
from registration import comparability, precheck
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_COMMIT, RUNTIME, SKIP, context, market, sha
from tests.registration.world import World, capture, config, coverage_bytes, product_write

OTHER_RUNTIME = {**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "c" * 64,
                 "image_digest": "sha256:" + "c" * 64}


@unittest.skipUnless(BINARY, SKIP)
class PrecheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = World("precheck")
        cls.addClassCleanup(cls.world.close)
        cls.candidate = cls.world.publish("prechecked")
        cls.data = cls.candidate["source"]

    def setUp(self):
        self.conn = self.world.conn

    def code(self, function, *args, **kwargs) -> str:
        with self.assertRaises(Refusal) as caught:
            function(*args, **kwargs)
        return caught.exception.code

    def sealed(self, data=None, runtime=None, identity=None, **options) -> int:
        data = data or self.data
        trial_id = self.world.open_precheck(data, identity, runtime=runtime)
        capture(self.conn, trial_id, data, **options)
        return trial_id

    def review(self, trial_id: int, verdict="passed", **items) -> str:
        return precheck.record_review(self.world.profile, self.world.review_body(trial_id, verdict, **items),
                                      "reviewer-b")["bundle"]

    def keys(self, **identity) -> tuple[dict, dict]:
        declared = {"market_database": "market", "market_commit": MARKET_COMMIT, "universe_rule": "pool-v1",
                    "symbols": ["AAAUSDT", "BBBUSDT"], "export_content_sha256": "f" * 64, **identity}
        return comparability.config_key(config()), comparability.input_key(declared)

    # Captures

    def test_a_capture_is_read_with_every_identity_and_file_checked(self):
        trial_id = self.sealed(runtime_errors=b'{"callback": "on_bar"}\n')
        read = execution.read_capture(self.conn, trial_id)
        self.assertEqual((read["status"], read["purpose"], read["stages"]["native"]["exit_code"]),
                         ("captured", "precheck", 0))
        self.assertEqual(read["listed"]["source/strategy.py"]["sha256"], hashlib.sha256(self.data).hexdigest())
        self.assertEqual(read["statuses"]["native.stderr.txt"], "captured_empty")
        self.assertEqual(read["runtime_failures"], [{"callback": "on_bar"}])
        self.assertEqual(read["input_coverage"]["effective_config"]["symbols"], ["AAAUSDT"])
        unsealed = self.world.open_precheck(self.data)
        self.assertEqual(execution.read_capture(self.conn, unsealed)["status"], "missing")
        self.assertEqual(self.code(execution.read_capture, self.conn, 999_999), "TRIAL_NOT_FOUND")

    def test_a_capture_that_disagrees_with_its_trial_or_manifest_is_refused(self):
        def forged(mutate) -> str:
            trial_id = self.world.open_precheck(self.data)
            files = {"native.stdout.txt": b"ran"}
            listed = {"native.stdout.txt": {"status": "captured", "sha256": hashlib.sha256(b"ran").hexdigest(),
                                            "length": 3}}
            manifest = {"format": "execution_capture_v1", "trial_id": trial_id, "purpose": "precheck",
                        "source_sha256": sha(self.data), "runtime_identity": dict(IDENTITY), "argv": [],
                        "stages": {}, "outcome": {"kind": "completed"}, "files": listed}
            mutate(manifest, files)
            files["execution.json"] = json.dumps(manifest).encode()
            product_write(self.conn, "forged_capture", f"trial-{trial_id}-execution", files)
            return self.code(execution.read_capture, self.conn, trial_id)

        self.assertEqual(forged(lambda m, f: f.update({"extra.txt": b"x"})), "EXECUTION_IDENTITY")
        self.assertEqual(forged(lambda m, f: m.update(purpose="research")), "EXECUTION_IDENTITY")
        self.assertEqual(forged(lambda m, f: m.update(source_sha256="0" * 64)), "EXECUTION_IDENTITY")
        self.assertEqual(forged(lambda m, f: m["files"].update({"x": {"status": "lost"}})), "EXECUTION_IDENTITY")
        self.assertEqual(forged(lambda m, f: m["files"]["native.stdout.txt"].update(length=4)), "LEDGER_CORRUPT")
        self.assertEqual(forged(lambda m, f: m["files"]["native.stdout.txt"].update(status="captured_empty")),
                         "LEDGER_CORRUPT")
        self.assertEqual(forged(lambda m, f: (f.update({"source/strategy.py": b"other"}), m["files"].update(
            {"source/strategy.py": {"status": "captured", "sha256": hashlib.sha256(b"other").hexdigest(),
                                    "length": 5}}))), "EXECUTION_IDENTITY")

    # Reviews

    def test_a_review_is_bound_to_the_precheck_and_appended_once(self):
        trial_id = self.sealed()
        recorded = precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")
        self.assertEqual((recorded["trial_id"], recorded["source_sha256"], recorded["image_digest"]),
                         (trial_id, sha(self.data), IDENTITY["image_digest"]))
        self.assertTrue(recorded["bundle"].startswith(f"source-review-{trial_id}-"))
        again = precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")
        self.assertEqual((again["bundle"], again["replayed"], again["ledger_commit"]),
                         (recorded["bundle"], True, recorded["ledger_commit"]))
        stored = json.loads(self.world.service.sql(self.world.profile, "SELECT c.content FROM evidence e JOIN "
                                                   "evidence_content c ON c.sha256 = e.sha256 WHERE e.bundle = %s",
                                                   (recorded["bundle"],))[0][0])
        self.assertEqual((stored["format"], stored["execution_bundle"], stored["authority"]),
                         ("source-review-v1", f"trial-{trial_id}-execution", "reviewer-b"))

    def test_malformed_reviews_and_reviews_without_a_precheck_capture_are_refused(self):
        trial_id = self.sealed()
        body = self.world.review_body(trial_id)
        malformed = [{**body, "extra": 1}, {k: v for k, v in body.items() if k != "api"}, {**body, "trial_id": "1"},
                     {**body, "trial_id": True}, {**body, "verdict": "maybe"},
                     {**body, "api": {"status": "fine", "note": "n"}}, {**body, "api": {"status": "passed", "note": " "}},
                     {**body, "api": {"status": "passed", "note": "n", "score": 1}},
                     {**body, "causal": {"status": "unresolved", "note": "lookahead unclear"}},
                     {**body, "verdict": "failed"}, "not a body"]
        seq = self.world.seq()
        for value in malformed:
            with self.subTest(value=value):
                self.assertEqual(self.code(precheck.record_review, self.world.profile, value, "b"), "REVIEW_INVALID")
        self.assertEqual(self.world.seq(), seq)
        self.assertEqual(self.code(precheck.record_review, self.world.profile,
                                   self.world.review_body(999_999), "b"), "TRIAL_NOT_FOUND")
        unsealed = self.world.open_precheck(self.data)
        explored = trials.open_trial(self.conn, "explore", sha(self.data), RUNTIME,
                                     {"identity": {"market_commit": MARKET_COMMIT, "universe_rule": "pool-v1",
                                                   "symbols": ["AAAUSDT"], "export_content_sha256": "e" * 64},
                                      "input_coverage": coverage_bytes(config())},
                                     {"start": 0, "trade_start": 60 * 10**9, "end": 120 * 10**9},
                                     context(self.data, "/tmp/explore-review"))["trial_id"]
        capture(self.conn, explored, self.data, purpose="explore")
        seq = self.world.seq()
        for target in (unsealed, explored):
            with self.subTest(target=target):
                self.assertEqual(self.code(precheck.record_review, self.world.profile,
                                           self.world.review_body(target), "b"), "PRECHECK_CAPTURE_MISSING")
        self.assertEqual(self.world.seq(), seq)

    # Admission

    def test_a_passing_review_of_a_clean_precheck_admits_the_source(self):
        trial_id = self.sealed()
        bundle = self.review(trial_id, api={"status": "no_opportunity", "note": "no signal in three days"})
        self.assertEqual(precheck.require_precheck(self.conn, bundle, sha(self.data), IDENTITY["image_ref"], None),
                         trial_id)
        _, declared = self.keys()
        self.assertEqual(precheck.require_precheck(self.conn, bundle, sha(self.data), IDENTITY["image_ref"], declared),
                         trial_id)

    def test_a_review_of_another_source_runtime_or_input_is_required_again(self):
        bundle = self.review(self.sealed())
        other = self.world.publish("other source")
        copied = evidence.load_bundle(self.conn, bundle)["files"]  # a passing review copied outside the namespace
        product_write(self.conn, "agent_review", "my-review", copied)
        _, moved = self.keys(market_commit="n" * 32)
        cases = [("source-review-missing", sha(self.data), IDENTITY["image_ref"], None),
                 ("my-review", sha(self.data), IDENTITY["image_ref"], None),
                 (bundle, sha(other["source"]), IDENTITY["image_ref"], None),
                 (bundle, sha(self.data), OTHER_RUNTIME["image_ref"], None),
                 (bundle, sha(self.data), IDENTITY["image_ref"], moved)]
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(self.code(precheck.require_precheck, self.conn, *case), "SOURCE_PRECHECK_REQUIRED")
        product_write(self.conn, "forged_review", "source-review-forged",
                      {"source-review.json": json.dumps({"format": "source-review-v1", "trial_id": 999_999}).encode()})
        self.assertEqual(self.code(precheck.require_precheck, self.conn, "source-review-forged", sha(self.data),
                                   IDENTITY["image_ref"], None), "TRIAL_NOT_FOUND")

    def test_review_records_are_the_product_reviews_with_the_commit_that_wrote_each(self):
        from qualification import availability
        trial_id = self.sealed()
        recorded = precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-q")
        copied = evidence.load_bundle(self.conn, recorded["bundle"])["files"]
        product_write(self.conn, "agent_review", "copied-review", copied)  # outside the namespace: never read
        product_write(self.conn, "copied_review", "source-review-copied", copied)  # not written by record_review
        found = {item["bundle"]: item for item in availability.review_records(self.conn)}
        self.assertNotIn("copied-review", found)
        self.assertEqual((found[recorded["bundle"]]["ledger_commit"], found[recorded["bundle"]]["ignored"]),
                         (recorded["ledger_commit"], None))
        forged = found["source-review-copied"]
        self.assertTrue(forged["ledger_commit"] and forged["ledger_commit"] != recorded["ledger_commit"],
                        "another write's bundle is dated by the history")

    def test_lifecycle_inputs_are_compared_both_ways(self):
        trial_id = self.sealed(identity={"lifecycle_bundle": "lifecycle-" + MARKET_COMMIT})
        bundle = self.review(trial_id)
        _, declared = self.keys()
        self.assertEqual(self.code(precheck.require_precheck, self.conn, bundle, sha(self.data), IDENTITY["image_ref"],
                                   declared), "SOURCE_PRECHECK_REQUIRED")
        _, with_lifecycle = self.keys(lifecycle_bundle="lifecycle-" + MARKET_COMMIT)
        self.assertEqual(precheck.require_precheck(self.conn, bundle, sha(self.data), IDENTITY["image_ref"],
                                                   with_lifecycle), trial_id)

    def test_any_failed_review_of_the_precheck_fails_admission(self):
        trial_id = self.sealed()
        passed = self.review(trial_id)
        self.assertEqual(precheck.require_precheck(self.conn, passed, sha(self.data), IDENTITY["image_ref"], None),
                         trial_id)
        self.review(trial_id, "failed", causal={"status": "failed", "note": "reads the next bar's close"})
        self.assertEqual(self.code(precheck.require_precheck, self.conn, passed, sha(self.data), IDENTITY["image_ref"],
                                   None), "SOURCE_PRECHECK_FAILED")

    def test_a_failed_precheck_or_review_item_fails_admission(self):
        cases = [{"native_exit": 1}, {"audit_exit": 2}, {"audit_exit": None}, {"outcome": "interrupted"},
                 {"runtime_errors": b'{"callback": "on_bar", "error": "KeyError"}\n'}]
        for options in cases:
            with self.subTest(options=options):
                bundle = self.review(self.sealed(**options))
                self.assertEqual(self.code(precheck.require_precheck, self.conn, bundle, sha(self.data),
                                           IDENTITY["image_ref"], None), "SOURCE_PRECHECK_FAILED")
        for status in ("failed", "unresolved"):
            with self.subTest(status=status):
                bundle = self.review(self.sealed(), "failed", readiness={"status": status, "note": "indicator cold"})
                self.assertEqual(self.code(precheck.require_precheck, self.conn, bundle, sha(self.data),
                                           IDENTITY["image_ref"], None), "SOURCE_PRECHECK_FAILED")

    # Exposure exemption

    def test_only_a_matching_declared_precheck_is_exempt_from_exposure(self):
        declared_config, declared_inputs = self.keys()
        exempt = self.sealed()
        self.assertTrue(precheck.exposure_exempt(self.conn, exempt, sha(self.data), IDENTITY["image_ref"],
                                                 declared_config, declared_inputs))
        unsealed = self.world.open_precheck(self.data)
        moved = self.sealed(identity={"market_commit": "n" * 32})
        wider = self.sealed(identity={"symbols": ["AAAUSDT", "ZZZUSDT"]})
        other_image = self.sealed(runtime=OTHER_RUNTIME)
        for trial_id in (unsealed, moved, wider, other_image):
            with self.subTest(trial_id=trial_id):
                self.assertFalse(precheck.exposure_exempt(self.conn, trial_id, sha(self.data), IDENTITY["image_ref"],
                                                          declared_config, declared_inputs))
        # The registration's membership file holds its whole contract set, the precheck's a subset of it.
        self.assertTrue(precheck.exposure_exempt(self.conn, exempt, sha(self.data), IDENTITY["image_ref"],
                                                 {**declared_config, "universe_sha256": "f" * 64}, declared_inputs))
        self.assertFalse(precheck.exposure_exempt(self.conn, exempt, sha(self.data), IDENTITY["image_ref"],
                                                  {**declared_config, "execution_bar_minutes": 5}, declared_inputs))
        other_account = comparability.config_key(config(account={"balance_usdt": "5000"}))
        self.assertFalse(precheck.exposure_exempt(self.conn, exempt, sha(self.data), IDENTITY["image_ref"],
                                                  other_account, declared_inputs))
        self.assertFalse(precheck.exposure_exempt(self.conn, exempt, sha(self.world.publish("x")["source"]),
                                                  IDENTITY["image_ref"], declared_config, declared_inputs))
        self.assertEqual(self.code(precheck.exposure_exempt, self.conn, 999_999, sha(self.data), IDENTITY["image_ref"],
                                   declared_config, declared_inputs), "TRIAL_NOT_FOUND")
        damaged = self.world.open_precheck(self.data)
        listed = {"native.stdout.txt": {"status": "captured", "sha256": "0" * 64, "length": 3}}
        manifest = {"format": "execution_capture_v1", "trial_id": damaged, "purpose": "precheck",
                    "source_sha256": sha(self.data), "runtime_identity": dict(IDENTITY), "files": listed}
        product_write(self.conn, "damaged_capture", f"trial-{damaged}-execution",
                      {"execution.json": json.dumps(manifest).encode(), "native.stdout.txt": b"ran"})
        self.assertEqual(self.code(precheck.exposure_exempt, self.conn, damaged, sha(self.data), IDENTITY["image_ref"],
                                   declared_config, declared_inputs), "LEDGER_CORRUPT")
        malformed = self.world.open_precheck(self.data)
        product_write(self.conn, "malformed_capture", f"trial-{malformed}-execution",
                      {"execution.json": json.dumps({**manifest, "trial_id": malformed, "files": {}}).encode(),
                       "native.stdout.txt": b"ran"})
        self.assertEqual(self.code(precheck.exposure_exempt, self.conn, malformed, sha(self.data),
                                   IDENTITY["image_ref"], declared_config, declared_inputs), "SOURCE_PRECHECK_REQUIRED")

    def test_a_precheck_longer_than_seven_trading_days_is_not_exempt(self):
        declared_config, declared_inputs = self.keys()
        for days, exempt in ((precheck.PRECHECK_MAX_DAYS, True), (precheck.PRECHECK_MAX_DAYS + 1, False)):
            trial_id = self.world.open_precheck(self.data, days=days)
            capture(self.conn, trial_id, self.data)
            with self.subTest(days=days):
                self.assertIs(precheck.exposure_exempt(self.conn, trial_id, sha(self.data), IDENTITY["image_ref"],
                                                       declared_config, declared_inputs), exempt)

    def test_only_a_precheck_that_failed_before_market_data_leaves_the_source_unexposed(self):
        def failures(*stages):
            return b"".join(json.dumps({"stage": stage, "exception_type": "Refusal"}).encode() + b"\n"
                            for stage in stages)
        for stage in precheck.PRE_DATA_STAGES:
            with self.subTest(stage=stage):
                trial_id = self.sealed(runtime=OTHER_RUNTIME, native_exit=1, audit_exit=None,
                                       runtime_errors=failures(stage))
                self.assertTrue(precheck.stopped_before_data(self.conn, trial_id, sha(self.data)))
                self.assertFalse(precheck.stopped_before_data(self.conn, trial_id,
                                                              sha(self.world.publish("other")["source"])))
        cases = {"replay stage": {"native_exit": 1, "runtime_errors": failures("replay")},
                 "a later stage beside it": {"native_exit": 1, "runtime_errors": failures("inputs", "replay")},
                 "no failure receipt": {"native_exit": 1},
                 "native exit zero": {"runtime_errors": failures("inputs")}}
        for label, options in cases.items():
            with self.subTest(label=label):
                self.assertFalse(precheck.stopped_before_data(self.conn, self.sealed(**options), sha(self.data)))
        self.assertFalse(precheck.stopped_before_data(self.conn, self.world.open_precheck(self.data), sha(self.data)))


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(BINARY, SKIP)
class LineStartTests(unittest.TestCase):
    """line select starts a line only at a revision with a passed source review and no failed one."""

    def test_an_unreviewed_or_failed_start_is_refused_and_a_passed_one_selected(self):
        world = World("line-start")
        self.addCleanup(world.close)

        def select(ref: str) -> dict:
            return lines.select_line(world.conn, "market", MARKET_COMMIT, date(2026, 1, 1), date(2026, 2, 1), ref,
                                     slug="passing-start", market=market(), reviews=availability.review_records)

        def code(ref: str) -> str:
            with self.assertRaises(Refusal) as caught:
                select(ref)
            return caught.exception.code

        self.assertEqual(code(world.publish("unreviewed")["candidate"]), "START_REVIEW_REQUIRED")
        failing = world.publish("failing")
        trial_id = world.open_precheck(failing["source"])
        capture(world.conn, trial_id, failing["source"])
        precheck.record_review(world.profile, world.review_body(
            trial_id, "failed", causal={"status": "failed", "note": "reads the next bar's close"}), "reviewer-b")
        self.assertEqual(code(failing["candidate"]), "START_REVIEW_REQUIRED")
        passing = world.publish("passing")
        world.prechecked(passing["source"])
        selected = select(passing["candidate"])
        self.assertEqual((selected["bundle"].endswith("-passing-start"), selected["created"]), (True, True))
