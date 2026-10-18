"""Working copies are new paths strictly under a temporary root."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

from ledger.errors import Refusal
from ledger.paths import temporary_path


class TemporaryPathTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="lp-", dir="/tmp")).resolve()
        self.addCleanup(__import__("shutil").rmtree, self.root, ignore_errors=True)

    def code(self, *args, **kwargs) -> str:
        with self.assertRaises(Refusal) as caught:
            temporary_path(*args, **kwargs)
        return caught.exception.code

    def test_a_new_path_under_a_temporary_root_is_returned_resolved(self):
        self.assertEqual(temporary_path(self.root / "work" / ".." / "out"), self.root / "out")
        self.assertEqual(temporary_path("/tmp/" + self.root.name + "/new"), self.root / "new")

    def test_paths_outside_or_at_a_temporary_root_are_refused(self):
        self.assertEqual(self.code(Path.home() / "work"), "NOT_TEMPORARY_PATH")
        self.assertEqual(self.code("/tmp"), "NOT_TEMPORARY_PATH")
        self.assertEqual(self.code(tempfile.gettempdir(), require_new=False), "NOT_TEMPORARY_PATH")
        escape = self.root / "escape"
        os.symlink(Path.home(), escape)
        self.assertEqual(self.code(escape / "inside", require_new=False), "NOT_TEMPORARY_PATH")
        self.assertEqual(self.code(self.root / "x", temp_roots=(Path.home(),)), "NOT_TEMPORARY_PATH")

    def test_existing_paths_including_dangling_links_are_refused_when_new_is_required(self):
        (self.root / "file").write_text("x")
        os.symlink(self.root / "missing", self.root / "dangling")
        for name in ("file", "dangling"):
            with self.subTest(name=name):
                self.assertEqual(self.code(self.root / name), "PATH_EXISTS")
        self.assertEqual(temporary_path(self.root / "file", require_new=False), self.root / "file")


if __name__ == "__main__":
    unittest.main()
