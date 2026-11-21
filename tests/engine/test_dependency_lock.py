"""engine.config.dependency_lock_sha256: a release, which bumps only the project's own version in `uv.lock`, and a pin
of the dev group, which no image installs, keep the replay identity Live compares (live/admission.py REPLAY_CODE); a
pin the images install changes it, a transitive one included."""

import re
import unittest

from engine.config import ROOT, dependency_lock_sha256


class DependencyLockTests(unittest.TestCase):
    def test_only_what_the_images_install_is_hashed(self):
        text = (ROOT / "uv.lock").read_text()
        project = re.compile(r'(name = "trade-research"\nversion = ")[^"]+("\nsource = \{ editable = "\." \})')
        self.assertEqual(len(project.findall(text)), 1)
        released = project.sub(r"\g<1>99.0.0\g<2>", text)
        self.assertNotEqual(released, text)
        self.assertEqual(dependency_lock_sha256(released.encode()), dependency_lock_sha256(text.encode()))
        # ruff and mypy are the dev group's; six reaches the images only through pandas' python-dateutil.
        for name, kept in (("ruff", True), ("mypy", True), ("nautilus-trader", False), ("six", False)):
            pin = re.compile(rf'(name = "{name}"\nversion = ")[^"]+(")')
            self.assertEqual(len(pin.findall(text)), 1, name)
            repinned = pin.sub(r"\g<1>99.0.0\g<2>", text)
            with self.subTest(name=name):
                self.assertEqual(dependency_lock_sha256(repinned.encode()) == dependency_lock_sha256(text.encode()), kept)


if __name__ == "__main__":
    unittest.main()
