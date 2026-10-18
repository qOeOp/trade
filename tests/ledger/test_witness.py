"""RFC 3161 witnesses: offline verification, and stamping validation registration commits without network."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ledger import db, strategies, witness
from ledger.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service, source
from tests.ledger.tsa import LocalAuthority


FIXTURE = Path(__file__).with_name("fixtures") / "digicert-witness.tsr"
FIXTURE_COMMIT = "r1hp2ilqpahb7h6dulga0lnga1q87ouf"  # the Dolt commit this DigiCert response stamps


def token_of(response: Path) -> bytes:
    with tempfile.TemporaryDirectory() as directory:
        out = Path(directory, "token.der")
        subprocess.run(["openssl", "ts", "-reply", "-in", str(response), "-token_out", "-out", str(out)], check=True,
                       capture_output=True)
        return out.read_bytes()


@unittest.skipUnless(shutil.which("openssl"), "needs openssl")
class TokenTests(unittest.TestCase):
    def setUp(self):
        self.token = token_of(FIXTURE)

    def code(self, *args, **kwargs) -> str:
        with self.assertRaises(Refusal) as caught:
            witness.token_time(*args, **kwargs)
        return caught.exception.code

    def test_a_recorded_token_verifies_offline_and_gives_its_time(self):
        self.assertEqual(witness.token_time(self.token, FIXTURE_COMMIT), datetime(2026, 10, 11, 7, 9, 27, tzinfo=UTC))
        self.assertEqual(witness.token_time(self.token, FIXTURE_COMMIT, expected_nonce=0x1CD90CF33514E16E).year, 2026)

    def test_a_token_vouches_for_one_commit_its_own_bytes_nonce_and_roots(self):
        self.assertEqual(self.code(self.token, "a" * 32), "WITNESS_INVALID")
        altered = bytearray(self.token)
        altered[-40] ^= 0xFF
        self.assertEqual(self.code(bytes(altered), FIXTURE_COMMIT), "WITNESS_INVALID")
        self.assertEqual(self.code(self.token, FIXTURE_COMMIT, expected_nonce=1), "WITNESS_INVALID")
        self.assertEqual(self.code(b"", FIXTURE_COMMIT), "WITNESS_INVALID")
        authority = LocalAuthority()
        self.addCleanup(authority.close)
        self.assertEqual(self.code(self.token, FIXTURE_COMMIT, authority.roots), "WITNESS_INVALID")
        with patch.object(witness, "ROOTS_SHA256", "0" * 64):
            self.assertEqual(self.code(self.token, FIXTURE_COMMIT), "WITNESS_INVALID")


@unittest.skipUnless(BINARY and shutil.which("openssl"), SKIP)
class WitnessLedgerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.addClassCleanup(cls.service.close)
        cls.profile = cls.service.ledger("witness")
        cls.published = strategies.publish_candidate(cls.profile, source("validated"), "validated", "Fixture",
                                                     "root")["ledger_commit"]
        cls.authority = LocalAuthority()
        cls.addClassCleanup(cls.authority.close)

    def setUp(self):
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)
        self.posted = patch.object(witness, "_post", side_effect=self.authority.respond)
        self.posted.start()
        self.addCleanup(self.posted.stop)

    def register(self, label: str, retry_of: int | None = None, universe_rule: str = "pool-v1") -> str:
        """A validation registration row (registration.validation_register is a later phase)."""
        start = datetime(2030, 1, 1)

        def insert(conn, op):
            conn.rows("INSERT INTO validation_registration (strategy_id, revision, market_commit, universe_rule, "
                      "window_start, window_end, design, retry_of, op_id, created_at) VALUES ('validated', 1, %s, "
                      "%s, %s, %s, %s, %s, %s, NOW())",
                      ("m" * 32, universe_rule, start, start + timedelta(days=90),
                       json.dumps({"method": "fixture", "label": label}), retry_of, op))
            return {}

        return db.write(self.conn, "validation_register", {"label": label}, "validation_registration", insert)["commit"]

    def stamp(self, commit, **kwargs):
        return witness.witness(self.conn, commit, tsa_roots=self.authority.roots, **kwargs)

    def test_a_registration_commit_is_stamped_once_and_verified_on_read(self):
        commit = self.register("once")
        stamped = self.stamp(commit)
        self.assertEqual((stamped["status"], stamped["commit"], stamped["reason"]), ("stamped", commit, None))
        self.assertLess(abs(stamped["stamped_at"] - datetime.now(UTC)), timedelta(minutes=1))
        queries = self.authority.queries
        again = self.stamp(commit)
        self.assertEqual((again["status"], again["stamped_at"], again["witness_commit"]),
                         ("already_stamped", stamped["stamped_at"], stamped["witness_commit"]))
        self.assertEqual(self.authority.queries, queries)
        self.assertEqual(witness.stamped_at(self.conn, commit, self.authority.roots), stamped["stamped_at"])
        self.assertIsNone(witness.stamped_at(self.conn, "0" * 32, self.authority.roots))

    def test_only_registration_commits_are_stamped(self):
        head = self.published  # a commit that added a candidate, not a registration
        for commit in (head, "not-a-commit"):
            with self.subTest(commit=commit), self.assertRaises(Refusal) as caught:
                self.stamp(commit)
            self.assertEqual(caught.exception.code, "NOT_REGISTRATION_COMMIT")

        def stray(conn, op):
            conn.rows("INSERT INTO witness (commit_hash, token, op_id) VALUES (%s, 'x', %s)", (head, op))
            return {}

        with self.assertRaises(Refusal) as caught:
            db.write(self.conn, "witness", {"stray": head}, "witness", stray)
        self.assertEqual((caught.exception.code, caught.exception.missing),
                         ("COMMIT_CHECK_FAILED", ("witnesses_stamp_validation_registrations",)))

    def test_an_unreachable_authority_is_a_failed_status_and_a_bad_token_a_refusal(self):
        commit = self.register("unreachable")
        with patch.object(witness, "_post", side_effect=OSError("offline")):
            failed = self.stamp(commit)
        self.assertEqual((failed["status"], failed["reason"], failed["stamped_at"]),
                         ("failed", "WITNESS_UNAVAILABLE", None))
        with patch.object(witness, "_post", return_value=b"not a response"):
            self.assertEqual(self.stamp(commit)["status"], "failed")
        other = LocalAuthority()
        self.addCleanup(other.close)
        with self.assertRaises(Refusal) as caught:
            witness.witness(self.conn, commit, tsa_roots=other.roots)
        self.assertEqual(caught.exception.code, "WITNESS_INVALID")
        with patch.object(witness, "CLOCK_TOLERANCE", timedelta(days=-1)), self.assertRaises(Refusal) as caught:
            self.stamp(commit)
        self.assertEqual(caught.exception.code, "WITNESS_INVALID")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM witness WHERE commit_hash = %s",
                                          (commit,)), [(0,)])
        with self.assertRaises(ValueError):
            witness.witness(self.conn, commit, tsa_url="http://timestamp.example.invalid")

    def test_a_retry_keeps_the_candidate_universe_and_window(self):
        self.register("original")
        (original,), = self.service.sql(self.profile, "SELECT MAX(registration_id) FROM validation_registration")
        self.register("retry", retry_of=original)
        with self.assertRaises(Refusal) as caught:
            self.register("drifted retry", retry_of=original, universe_rule="pool-v2")
        self.assertEqual(caught.exception.missing, ("validation_retries_keep_candidate_and_window",))

    def test_sync_stamps_every_registration_still_missing_a_token(self):
        first, second = self.register("sync-a"), self.register("sync-b")
        self.stamp(first)
        synced = witness.sync_witness(self.conn, tsa_roots=self.authority.roots)
        self.assertIn(second, synced["witnessed"])
        self.assertNotIn(first, synced["witnessed"])
        self.assertGreaterEqual(synced["already"], 1)
        self.assertEqual(witness.sync_witness(self.conn, tsa_roots=self.authority.roots)["witnessed"], [])


if __name__ == "__main__":
    unittest.main()
