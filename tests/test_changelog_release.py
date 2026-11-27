"""changelog-release.py: a new version's section, folding into an unreleased one, and a version's notes."""

import contextlib
from datetime import UTC, datetime
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("changelog_release", ROOT / ".github/scripts/changelog-release.py")
assert spec and spec.loader
changelog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(changelog)

HEAD = "# Changelog\n\n## Unreleased\n\nOne file per change.\n\n"
OLD = "## 0.4.4 (2026-11-21)\n\n- Old.\n"
TODAY = datetime.now(UTC).date().isoformat()


class ChangelogReleaseTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.fragments, self.file = root / "changelog.d", root / "CHANGELOG.md"
        self.fragments.mkdir()
        for name, value in (("FRAGMENTS", self.fragments), ("CHANGELOG", self.file)):
            previous = getattr(changelog, name)
            setattr(changelog, name, value)
            self.addCleanup(setattr, changelog, name, previous)

    def release(self, version, **fragments):
        for name, text in fragments.items():
            (self.fragments / f"{name}.md").write_text(text)
        with contextlib.redirect_stdout(io.StringIO()):
            changelog.main(version)

    def test_a_new_version_takes_every_entry_breaking_first(self):
        self.file.write_text(HEAD + OLD)
        self.release("0.5.0", a="- Fix.\n  More.\n", b="- Breaking change.\n")
        self.assertEqual(self.file.read_text(),
                         HEAD + f"## 0.5.0 ({TODAY})\n\n- Breaking change.\n- Fix.\n  More.\n\n" + OLD)
        self.assertEqual(list(self.fragments.iterdir()), [])

    def test_entries_fold_into_the_newest_section_when_its_version_is_not_released(self):
        self.file.write_text(HEAD + "## 0.5.0 (2026-11-20)\n\n- Breaking one.\n- Two.\n\n" + OLD)
        self.release("0.5.0", a="- Three.\n- Breaking four.\n")
        self.assertEqual(self.file.read_text(), HEAD + f"## 0.5.0 ({TODAY})\n\n- Breaking one.\n- Breaking four.\n"
                         "- Two.\n- Three.\n\n" + OLD)
        self.assertEqual(changelog.notes("0.5.0"), "- Breaking one.\n- Breaking four.\n- Two.\n- Three.\n")

    def test_refusals(self):
        self.file.write_text(HEAD + OLD + "\n## 0.4.3 (2026-11-17)\n\n- Older.\n")
        for version, message in (("0.4.3", "below its newest"), ("5", "usage")):
            with self.assertRaisesRegex(SystemExit, message):
                self.release(version, a="- New.\n")
        (self.fragments / "a.md").unlink()
        with self.assertRaisesRegex(SystemExit, "no entries"):
            self.release("0.5.0")
        with self.assertRaisesRegex(SystemExit, "no 0.5.0"):
            changelog.notes("0.5.0")
        self.assertEqual(changelog.notes("0.4.4"), "- Old.\n")


class RepositoryFragmentTests(unittest.TestCase):
    def test_every_fragment_reads_as_the_release_reads_it(self):
        """A fragment the release cannot read stops release.yml after it merged; here its pull request fails."""
        for path in sorted((ROOT / "changelog.d").glob("*.md")):
            with self.subTest(path.name):
                try:
                    found = changelog.entries(path.read_text())
                except SystemExit as exc:
                    self.fail(f"changelog.d/{path.name}: {exc}")
                self.assertTrue(found, f"changelog.d/{path.name} holds no list entry")


if __name__ == "__main__":
    unittest.main()
