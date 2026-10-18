"""Reproducing a sealed run: the directory is handed over only when the image's semantic fingerprint
equals the one recorded at sealing; an absent fingerprint is never taken as a match."""

from __future__ import annotations

import unittest

from ledger import execution
from ledger.errors import Refusal
from replay import entry, reproduce
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid


FINGERPRINT = {"fills": {"rows": 2, "sha256": "1" * 64, "by_utc_day": {"2026-01-01": "2" * 64}}}


@unittest.skipUnless(BINARY, SKIP)
class ReproduceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("reproduce")
        cls.addClassCleanup(world.close)
        fingerprinted, unprinted = registered_grid(world, ["r1", "r2"])
        world.fingerprint = FINGERPRINT
        cls.fingerprinted = entry.run(world.profile, world.market, MARKET_COMMIT, fingerprinted, None, RUNNER_ARGV,
                                      hypothesis="registration-grid")["run_id"]
        world.fingerprint = None
        cls.unprinted = entry.run(world.profile, world.market, MARKET_COMMIT, unprinted, None, RUNNER_ARGV,
                                  hypothesis="registration-grid")["run_id"]

    def setUp(self):
        self.world = self.__class__.world

    def reproduce(self, run_id: int, name: str):
        return reproduce.reproduce(run_id, self.world.output(name), ledger=self.world.profile, market=self.world.market)

    def test_a_matching_fingerprint_hands_over_the_reproduced_reports(self):
        self.world.fingerprint = FINGERPRINT
        done = self.reproduce(self.fingerprinted, "same")
        self.assertEqual((done["run_id"], done["fingerprints_match"]), (self.fingerprinted, True))
        self.assertTrue((self.world.output("same") / "reports" / "fills.csv").is_file())
        capture = execution.read_capture(self.world.conn, done["trial_id"])
        self.assertEqual((capture["status"], capture["purpose"]), ("captured", "explore"))
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM run")[0][0], 2,
                         "a reproduction stores no run")

    def test_a_different_or_absent_fingerprint_refuses_and_keeps_the_directory(self):
        cases = [(self.fingerprinted, {"fills": {"rows": 3}}, "changed"),
                 (self.fingerprinted, None, "image-without-entry"),
                 (self.unprinted, None, "never-recorded")]
        for run_id, computed, name in cases:
            self.world.fingerprint = computed
            with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                self.reproduce(run_id, name)
            self.assertEqual(caught.exception.code, "REPRODUCTION_MISMATCH")
            self.assertTrue((self.world.output(name) / "reports").is_dir())
        with self.assertRaises(Refusal) as caught:
            self.reproduce(9999, "unknown")
        self.assertEqual(caught.exception.code, "UNKNOWN_RUN")


if __name__ == "__main__":
    unittest.main()
