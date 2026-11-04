"""The export receipt's sentence is an input of every run."""
import hashlib
import unittest

from market import coverage


class ReceiptSentence(unittest.TestCase):
    def test_wording_is_what_the_recorded_runs_hashed(self):
        # Trials 215 onward recorded this wording inside export_content_sha256. If this fails the reproduction and
        # the comparison of every one of them refuse: put the wording back and correct INTERPRETATION instead.
        found = hashlib.sha256(coverage.RECEIPT_INTERPRETATION.encode()).hexdigest()
        self.assertEqual(found, "5479f14ec6bcd8e576a38c00b1633e8738fc94ff84fa3cdadaaa0b07d6cb8396")


if __name__ == "__main__":
    unittest.main()
