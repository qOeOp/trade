"""Strategy bodies live in Dolt; the product tree must not regain a strategy source directory."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RepositoryLayoutTests(unittest.TestCase):
    def test_strategy_bodies_are_not_kept_in_git(self):
        for path in ("strategies", "research/r1_variants"):
            self.assertFalse((ROOT / path).exists(), f"{path} must not exist; publish strategy source to Dolt")


if __name__ == "__main__":
    unittest.main()
