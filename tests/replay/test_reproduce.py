"""Reproducing a sealed run: the directory is handed over only when the semantic fingerprint its own
fingerprint stage sealed equals the one recorded at sealing; an absent fingerprint is never taken as
a match. Reading a run names a missing capture or fingerprint."""

from __future__ import annotations

import json
import unittest

from ledger import coverage, execution, metrics, strategies, trials
from ledger.errors import Refusal
from registration import register
from replay import entry, reproduce
from tests.ledger.dolt import BINARY, MARKET_COMMIT, RUNTIME, SKIP, context, sha
from tests.registration.world import LINE_WINDOW, RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid


FINGERPRINT = {"fills": {"rows": 2, "sha256": "1" * 64, "by_utc_day": {"2026-01-01": "2" * 64}}}


@unittest.skipUnless(BINARY, SKIP)
class ReproduceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("reproduce")
        cls.addClassCleanup(world.close)
        fingerprinted, unprinted = registered_grid(world, ["r1", "r2"])
        cls.forged_refs = registered_grid(world, ["f1", "f2"], "registration-forged")
        world.fingerprint = FINGERPRINT
        cls.fingerprinted = entry.run(world.profile, world.market, MARKET_COMMIT, fingerprinted, None, RUNNER_ARGV,
                                      hypothesis="registration-grid")["trial_id"]
        world.fingerprint = None
        cls.unprinted = entry.run(world.profile, world.market, MARKET_COMMIT, unprinted, None, RUNNER_ARGV,
                                  hypothesis="registration-grid")["trial_id"]

    def setUp(self):
        self.world = self.__class__.world

    def reproduce(self, trial_id: int, name: str):
        return reproduce.reproduce(trial_id, self.world.output(name), ledger=self.world.profile, market=self.world.market)

    def test_the_recorded_fingerprint_is_the_sealed_fingerprint_stage(self):
        stored = metrics.load_run(self.world.conn, self.fingerprinted)
        self.assertEqual((stored["run"]["fingerprints"], stored["capture"]["stages"]["fingerprint"]["exit_code"],
                          stored["evidence"]["unavailable"]), (FINGERPRINT, 0, []))
        self.assertEqual(stored["capture"]["statuses"]["fingerprint/fingerprint.json"], "hashed",
                         "the run row keeps the fingerprint; the capture its hash")
        unprinted = metrics.load_run(self.world.conn, self.unprinted)
        self.assertEqual((unprinted["capture"]["stages"]["fingerprint"]["exit_code"],
                          unprinted["evidence"]["fingerprints"]),
                         (3, "missing"))
        self.assertEqual((unprinted["run"]["status"], [item["code"] for item in unprinted["run"]["failure_reasons"]]),
                         ("invalid", ["FINGERPRINT_FAILED"]), "a run without a fingerprint is stored invalid")

    def forged(self, ref: str, receipt_identity: dict | None = None) -> int:
        """A passed run row stored without any capture, its start coverage receipt naming `receipt_identity`."""
        data = strategies.read_candidate(self.world.conn, ref)["source"]
        actual = self.world.plan("registration-forged")["execution"]
        receipt = json.dumps({"format": coverage.FORMAT, "effective_config": actual["effective_config"],
                              "export_receipts": {}, "input_identity": receipt_identity or actual["input_identity"]})
        trial_id = trials.open_trial(self.world.conn, "research", sha(data), RUNTIME,
                                     {"identity": actual["input_identity"], "input_coverage": receipt.encode()},
                                     LINE_WINDOW, context(data, self.world.workdir()),
                                     register.binder("registration-forged", sha(data)))["trial_id"]
        return self.world.seal_run(trial_id)

    def test_reading_a_run_names_a_missing_capture_and_checks_the_coverage_identity(self):
        stored = metrics.load_run(self.world.conn, self.forged(self.forged_refs[0]))
        self.assertEqual(stored["evidence"]["capture"], "missing")
        self.assertEqual([item.split(":")[0] for item in stored["evidence"]["unavailable"]], ["CAPTURE_MISSING"])
        other = {**self.world.plan("registration-forged")["execution"]["input_identity"],
                 "export_content_sha256": "0" * 64}
        with self.assertRaises(Refusal) as caught:
            metrics.load_run(self.world.conn, self.forged(self.forged_refs[1], other))
        self.assertEqual(caught.exception.code, "EXECUTION_IDENTITY")

    def test_a_matching_fingerprint_hands_over_the_reproduced_reports(self):
        self.world.fingerprint = FINGERPRINT
        done = self.reproduce(self.fingerprinted, "same")
        self.assertEqual((done["trial_id"], done["fingerprints_match"]), (self.fingerprinted, True))
        self.assertTrue((self.world.output("same") / "reports" / "fills.csv").is_file())
        capture = execution.read_capture(self.world.conn, done["reproduction_trial_id"])
        self.assertEqual((capture["status"], capture["purpose"]), ("captured", "explore"))
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM run")[0][0], 2,
                         "a reproduction stores no run")

    def test_a_different_or_absent_fingerprint_refuses_and_keeps_the_directory(self):
        cases = [(self.fingerprinted, {"fills": {"rows": 3}}, "changed"),
                 (self.fingerprinted, None, "stage-failed"),
                 (self.unprinted, None, "never-recorded")]
        for trial_id, computed, name in cases:
            self.world.fingerprint = computed
            with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                self.reproduce(trial_id, name)
            self.assertEqual((caught.exception.code, caught.exception.write_status),
                             ("REPRODUCTION_MISMATCH", "written"), "the reproduction's own trial was committed")
            self.assertTrue((self.world.output(name) / "reports").is_dir())
        with self.assertRaises(Refusal) as caught:
            self.reproduce(9999, "unknown")
        self.assertEqual(caught.exception.code, "UNKNOWN_RUN")


if __name__ == "__main__":
    unittest.main()
