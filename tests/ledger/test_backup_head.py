"""Reading a backup's head links its table files instead of restoring it, and still refuses what it cannot read."""

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ledger import admin, db
from ledger.errors import Refusal


TABLE = "0frkgm4f1b08v0qjbgmv06ibf6oe4qgc"


class LinkStoreTests(unittest.TestCase):
    def test_table_files_are_linked_and_everything_dolt_may_write_is_copied(self):
        with tempfile.TemporaryDirectory(prefix="backup-head-test-") as temporary:
            backup, store = Path(temporary) / "backup", Path(temporary) / "store"
            (backup / "oldgen").mkdir(parents=True)
            for name in (TABLE, f"{TABLE[::-1]}.darc", "oldgen/" + TABLE[::-1], admin.JOURNAL_FILE,
                         "manifest", "LOCK", "oldgen/LOCK", "journal.idx"):
                (backup / name).write_text(name)
            admin._link_store(backup, store)
            linked = {path.relative_to(store).as_posix() for path in store.rglob("*") if path.is_symlink()}
            copied = {path.relative_to(store).as_posix() for path in store.rglob("*")
                      if path.is_file() and not path.is_symlink()}
            self.assertEqual(linked, {TABLE, f"{TABLE[::-1]}.darc", "oldgen/" + TABLE[::-1]})
            self.assertEqual(copied, {admin.JOURNAL_FILE, "manifest", "journal.idx"})
            (store / "manifest").write_text("rewritten")
            self.assertEqual((backup / "manifest").read_text(), "manifest")


class BackupHeadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="backup-head-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.backup = self.root / "backup"
        self.backup.mkdir()
        self.profile = db.LedgerProfile("fixture", "fixture", self.root / "service")
        self.work = self.root / "work"
        self.work.mkdir()
        config = patch.object(db, "_service", return_value={"binary": "fixture-dolt"})
        config.start()
        self.addCleanup(config.stop)
        directory = patch.object(admin.tempfile, "mkdtemp", return_value=str(self.work))
        directory.start()
        self.addCleanup(directory.stop)

    def run_dolt(self, argv, **options):
        if argv[1] == "init":
            (Path(options["cwd"]) / ".dolt" / "noms").mkdir(parents=True)
        return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

    def test_a_backup_without_a_manifest_refuses_before_running_dolt(self):
        with patch.object(admin.subprocess, "run") as run, self.assertRaises(Refusal) as caught:
            admin.backup_head(self.profile, self.backup)
        self.assertEqual(caught.exception.code, "DOLT_BACKUP")
        run.assert_not_called()

    def test_a_listing_timeout_refuses_names_its_phase_and_leaves_no_work_directory(self):
        (self.backup / "manifest").write_text("5:__DOLT__")

        def run(argv, **options):
            if argv[1] == "sql":
                self.assertEqual(options["env"]["DOLT_DISABLE_EVENT_FLUSH"], "1")
                raise subprocess.TimeoutExpired(argv, options["timeout"])
            return self.run_dolt(argv, **options)

        with patch.object(admin.subprocess, "run", side_effect=run), self.assertRaises(Refusal) as caught:
            admin.backup_head(self.profile, self.backup)
        self.assertEqual(caught.exception.code, "DOLT_BACKUP")
        self.assertIn("list branches timed out after 600s", caught.exception.message)
        self.assertFalse(self.work.exists())
        self.assertTrue((self.backup / "manifest").exists())


if __name__ == "__main__":
    unittest.main()
