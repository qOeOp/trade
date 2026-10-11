"""All retained local paths exclude the same resolved temporary roots."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from research.records.common import _is_temporary_path


class TemporaryPathTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="trade-path-test-", dir=Path.home())
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.system_temp = self.home / "system-temp"
        self.system_temp.mkdir()
        self.temporary = patch("research.records.common.tempfile.gettempdir", return_value=str(self.system_temp))
        self.temporary.start()
        self.addCleanup(self.temporary.stop)

    def test_helper_resolves_both_temp_roots_and_preserves_normal_home_paths(self):
        for path in (Path("/tmp"), Path("/tmp") / "new-seal", self.system_temp,
                     self.system_temp / "not-created" / "proof.json"):
            with self.subTest(path=path):
                self.assertTrue(_is_temporary_path(path))
        for path in (self.home / "retained", self.home / "system-temp-sibling"):
            with self.subTest(path=path):
                self.assertFalse(_is_temporary_path(path))
        link = self.home / "temp-alias"
        link.symlink_to(self.system_temp, target_is_directory=True)
        self.assertTrue(_is_temporary_path(link / "proof.json"))

    def test_fresh_processes_honor_changed_tmpdir_without_losing_tmp_exclusion(self):
        script = """
import json, sys, tempfile
from pathlib import Path
from research.records.common import _is_temporary_path
selected = Path(sys.argv[1]).resolve()
print(json.dumps([Path(tempfile.gettempdir()).resolve() == selected,
                  _is_temporary_path(selected / 'new.json'),
                  _is_temporary_path(Path('/tmp') / 'new.json'),
                  _is_temporary_path(selected.parent / 'retained')]))
"""
        for name in ("first-tmpdir", "second-tmpdir"):
            directory = self.home / name
            directory.mkdir()
            result = subprocess.run([sys.executable, "-c", script, str(directory)],
                                    env={**os.environ, "TMPDIR": str(directory), "TEMP": str(directory),
                                         "TMP": str(directory), "PYTHONDONTWRITEBYTECODE": "1"},
                                    capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout), [True, True, True, False])


if __name__ == "__main__":
    unittest.main()
