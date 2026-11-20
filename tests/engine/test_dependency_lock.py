"""engine.config.dependency_lock_sha256: a release, which bumps only the project's own version in `uv.lock`, keeps the
replay identity Live compares (live/runs.py REPLAY_CODE); a dependency pin changes it."""

import re
import unittest

from engine.config import ROOT, dependency_lock_sha256


class DependencyLockTests(unittest.TestCase):
    def test_only_the_projects_own_version_is_left_out(self):
        text = (ROOT / "uv.lock").read_text()
        project = re.compile(r'(name = "trade-research"\nversion = ")[^"]+("\nsource = \{ editable = "\." \})')
        pin = re.compile(r'(name = "nautilus-trader"\nversion = ")[^"]+(")')
        self.assertEqual(len(project.findall(text)), 1)
        self.assertEqual(len(pin.findall(text)), 1)
        released = project.sub(r"\g<1>99.0.0\g<2>", text)
        repinned = pin.sub(r"\g<1>99.0.0\g<2>", text)
        self.assertNotEqual(released, text)
        self.assertEqual(dependency_lock_sha256(released.encode()), dependency_lock_sha256(text.encode()))
        self.assertNotEqual(dependency_lock_sha256(repinned.encode()), dependency_lock_sha256(text.encode()))


if __name__ == "__main__":
    unittest.main()
