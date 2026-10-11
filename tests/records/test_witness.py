"""RFC 3161 tokens verify offline against the pinned roots, as of their own time."""

from datetime import datetime
from pathlib import Path
import shutil
import unittest

from research.records.common import RecordError
from research.records.witness import token_time


TOKEN = Path(__file__).with_name("fixtures") / "digicert-witness.tsr"
COMMIT = "r1hp2ilqpahb7h6dulga0lnga1q87ouf"  # the Dolt commit this DigiCert response stamps


@unittest.skipUnless(shutil.which("openssl"), "needs openssl")
class TokenTests(unittest.TestCase):
    def test_a_recorded_token_verifies_and_gives_its_time(self):
        self.assertEqual(token_time(TOKEN.read_bytes(), COMMIT), datetime(2026, 10, 11, 7, 9, 27))

    def test_a_token_does_not_vouch_for_another_commit_or_altered_bytes(self):
        with self.assertRaises(RecordError) as caught:
            token_time(TOKEN.read_bytes(), "a" * 32)
        self.assertEqual(caught.exception.code, "WITNESS_INVALID")
        altered = bytearray(TOKEN.read_bytes())
        altered[-40] ^= 0xFF
        with self.assertRaises(RecordError):
            token_time(bytes(altered), COMMIT)


if __name__ == "__main__":
    unittest.main()
