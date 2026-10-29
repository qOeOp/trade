"""Restore deadlines scale with retained history; the restored-head check stays mandatory."""

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ledger import admin, db
from ledger.errors import Refusal


class BackupHeadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="backup-head-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.backup = self.root / "backup"
        self.backup.mkdir()
        self.profile = db.LedgerProfile("fixture", "fixture", self.root / "service")
        self.work = self.root / "restore-work"
        self.work.mkdir()
        config = patch.object(db, "_service", return_value={"binary": "fixture-dolt"})
        config.start()
        self.addCleanup(config.stop)
        directory = patch.object(admin.tempfile, "mkdtemp", return_value=str(self.work))
        directory.start()
        self.addCleanup(directory.stop)

    def archive(self, size):
        # A sparse archive exercises a large backup without allocating its contents.
        path = self.backup / "history.darc"
        with path.open("wb") as stream:
            stream.truncate(size)
        return path

    def test_large_restore_can_finish_beyond_ten_minutes_and_still_lists_its_head(self):
        archive = self.archive(50 * 1024**3)
        calls = []

        def run(argv, **options):
            calls.append((argv, options))
            if argv[1:3] == ["backup", "restore"]:
                if options["timeout"] <= 601:
                    raise subprocess.TimeoutExpired(argv, options["timeout"])
            output = '{"rows":[{"name":"main","hash":"restored-head"}]}' if argv[1] == "sql" else ""
            return subprocess.CompletedProcess(argv, 0, stdout=output, stderr="")

        with patch.object(admin.subprocess, "run", side_effect=run):
            self.assertEqual(admin.backup_head(self.profile, self.backup), "restored-head")
        self.assertEqual(calls[-1][0][1], "sql")
        self.assertEqual(calls[-1][1]["timeout"], 600)
        self.assertFalse(self.work.exists())
        self.assertTrue(archive.exists())

    def test_restore_timeout_still_refuses_and_identifies_the_failed_phase(self):
        archive = self.archive(0)

        def run(argv, **options):
            if argv[1:3] == ["backup", "restore"]:
                raise subprocess.TimeoutExpired(argv, options["timeout"])
            return subprocess.CompletedProcess(argv, 0)

        with patch.object(admin.subprocess, "run", side_effect=run), self.assertRaises(Refusal) as caught:
            admin.backup_head(self.profile, self.backup)
        self.assertEqual(caught.exception.code, "DOLT_BACKUP")
        self.assertIn("restore timed out after 600s", caught.exception.message)
        self.assertFalse(self.work.exists())
        self.assertTrue(archive.exists())

    def test_a_restore_success_cannot_hide_a_branch_listing_timeout(self):
        self.archive(50 * 1024**3)

        def run(argv, **options):
            if argv[1] == "sql":
                self.assertEqual(options["timeout"], 600)
                raise subprocess.TimeoutExpired(argv, options["timeout"])
            return subprocess.CompletedProcess(argv, 0)

        with patch.object(admin.subprocess, "run", side_effect=run), self.assertRaises(Refusal) as caught:
            admin.backup_head(self.profile, self.backup)
        self.assertEqual(caught.exception.code, "DOLT_BACKUP")
        self.assertIn("list restored branches timed out after 600s", caught.exception.message)
        self.assertFalse(self.work.exists())


if __name__ == "__main__":
    unittest.main()
