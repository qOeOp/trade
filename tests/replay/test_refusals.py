"""Every refusal code the replay package raises has a meaning and repair commands in the ledger's
refusal catalogue."""

from __future__ import annotations

from pathlib import Path
import unittest

from ledger.refusals import CATALOGUE, refusal_catalogue
from tests.registration import test_refusals


class ReplayRefusalTests(unittest.TestCase):
    def test_every_raised_code_has_a_meaning_and_repair_commands(self):
        package = Path(__file__).resolve().parents[2] / "replay"
        original = test_refusals.PACKAGE
        try:
            test_refusals.PACKAGE = package
            codes = test_refusals.raised_codes()
        finally:
            test_refusals.PACKAGE = original
        self.assertIn("REPRODUCTION_MISMATCH", codes)
        for code, sites in codes.items():
            with self.subTest(code=code, sites=sites):
                self.assertIn(code, CATALOGUE)
                self.assertTrue(refusal_catalogue(code)["next_actions"])


if __name__ == "__main__":
    unittest.main()
