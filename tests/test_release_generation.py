"""release-generation.py: a version that changes the ledger schema generation must raise the minor (0.x) or major
version; any other version passes."""

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_generation", ROOT / ".github/scripts/release-generation.py")
assert spec and spec.loader
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

SAME = {"SCHEMA_VERSION": 2, "PAPER_SCHEMA_VERSION": 1}
RESEARCH = {"SCHEMA_VERSION": 3, "PAPER_SCHEMA_VERSION": 1}
PAPER = {"SCHEMA_VERSION": 2, "PAPER_SCHEMA_VERSION": 2}


class GenerationGuardTests(unittest.TestCase):
    def test_a_patch_that_changes_either_generation_is_refused_before_1_0(self):
        for after in (RESEARCH, PAPER):
            reason = guard.refusal("0.5.2", "0.5.1", SAME, after)
            self.assertIn("release 0.6.0", reason)

    def test_a_minor_or_major_version_may_change_it_before_1_0(self):
        self.assertIsNone(guard.refusal("0.6.0", "0.5.1", SAME, RESEARCH))
        self.assertIsNone(guard.refusal("1.0.0", "0.5.1", SAME, PAPER))

    def test_from_1_0_only_a_major_version_may_change_it(self):
        self.assertIn("release 2.0.0", guard.refusal("1.1.0", "1.0.3", SAME, RESEARCH))
        self.assertIn("release 2.0.0", guard.refusal("1.0.4", "1.0.3", SAME, PAPER))
        self.assertIsNone(guard.refusal("2.0.0", "1.0.3", SAME, RESEARCH))

    def test_any_version_keeps_an_unchanged_generation(self):
        self.assertIsNone(guard.refusal("0.5.2", "0.5.1", SAME, dict(SAME)))

    def test_the_generations_are_read_from_ledger_db_without_importing_it(self):
        self.assertEqual(guard.generations((ROOT / "ledger/db.py").read_text()).keys(), set(guard.NAMES))
        with self.assertRaises(SystemExit):
            guard.generations("SCHEMA_VERSION = 2\n")
        with self.assertRaises(SystemExit):
            guard.generations("SCHEMA_VERSION = '2'\nPAPER_SCHEMA_VERSION = 1\n")


if __name__ == "__main__":
    unittest.main()
