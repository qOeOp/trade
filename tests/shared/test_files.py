import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

from shared.files import atomic_write


class AtomicWriteTests(unittest.TestCase):
    def test_a_failed_write_keeps_the_old_file_and_leaves_no_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "status.json"
            atomic_write(path, b"old", 0o600)
            self.assertEqual((path.read_bytes(), stat.S_IMODE(path.stat().st_mode)), (b"old", 0o600))
            with mock.patch.object(os, "fsync", side_effect=OSError("disk full")), self.assertRaises(OSError):
                atomic_write(path, b"new")
            self.assertEqual((path.read_bytes(), os.listdir(directory)), (b"old", ["status.json"]))


if __name__ == "__main__":
    unittest.main()
