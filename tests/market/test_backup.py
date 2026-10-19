"""The market database's backup on a throwaway Dolt service: `market init --backup-root` and the
active database's placement, the incremental dolt_backup sync, the review that its head is still an
ancestor of main, and every refusal of the sync. Never the active service."""

from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
import unittest

from ledger import admin, db
from ledger.errors import Refusal
from market import store
from report import review
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed


NOT_TEMPORARY = Path.home() / "trade-market-test-not-temporary"  # never created: the refusal comes first


@unittest.skipUnless(BINARY, SKIP)
class MarketBackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)
        cls.backups = Path(tempfile.mkdtemp(prefix="market-backups-", dir="/tmp"))
        cls.addClassCleanup(shutil.rmtree, cls.backups, True)

    def market(self, database: str, backup: str | None = None) -> dict:
        profile = self.fixture.add(database, backup_root=self.backups / (backup or database))
        self.imported(profile, "2025-01")
        return profile

    def imported(self, profile: dict, month: str) -> str:
        return seed(profile, month=month, through=f"{month}-28", terms=[], bars={})

    def head(self, profile: dict) -> str:
        return self.fixture.admin(profile, "SELECT hash FROM dolt_branches WHERE name = 'main'")[0][0]

    def backed(self, profile: dict) -> str | None:
        found = db.LedgerProfile.from_json(profile)
        return admin.backup_head(found, admin.backup_path(found))

    def refused(self, code: str, call) -> Refusal:
        with self.assertRaises(Refusal) as caught:
            call()
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception

    def test_init_records_the_backup_and_an_active_market_keeps_both_outside_checkout_and_temporary_roots(self):
        kept = self.fixture.add("market_kept", backup_root=self.backups / "kept")
        self.assertEqual(kept["backup"], str(self.backups / "kept"))
        self.assertIsNone(self.fixture.profile["backup"])
        service = self.fixture.service.root / "live"
        for root, backup in ((NOT_TEMPORARY, None), (service, NOT_TEMPORARY / "backup"),
                             (NOT_TEMPORARY, self.backups / "live"),
                             (db.REPOSITORY / "never-created", db.REPOSITORY / "never-backup")):
            with self.subTest(service=root, backup=backup):
                self.refused("ISOLATION_BREACH", lambda: db.init_market("live", "live", root, "active", backup,
                                                                        dolt_binary=BINARY))
        for path in (NOT_TEMPORARY, service, self.backups / "live", db.REPOSITORY / "never-created",
                     db.REPOSITORY / "never-backup", self.fixture.service.home / "live.json"):
            self.assertFalse(path.exists(), path)

    def test_the_backup_holds_main_and_the_review_finds_its_head_an_ancestor(self):
        profile = self.market("market_synced")
        before = review.market_review(profile)
        self.assertEqual((before["ok"], before["history"]["status"], before["limitations"]),
                         (True, "no_backup", [review.HISTORY_UNCHECKED]))
        first = admin.market_backup(profile)
        self.assertEqual((first["market_commit"], first["previous_head"], self.backed(profile)),
                         (self.head(profile), None, self.head(profile)))
        self.assertEqual(first["backup_path"], str(self.backups / "market_synced" / "backup"))
        later = self.imported(profile, "2025-02")
        behind = review.market_review(profile)
        self.assertEqual((behind["ok"], behind["history"]["status"], behind["history"]["head"], behind["commit"]),
                         (True, "ancestor", first["market_commit"], later))
        again = admin.market_backup(profile)
        self.assertEqual((again["previous_head"], again["market_commit"], self.backed(profile)),
                         (first["market_commit"], later, later))

    def test_a_rewritten_commit_is_a_finding_and_its_backup_is_never_overwritten(self):
        profile = self.market("market_amended")
        synced = admin.market_backup(profile)["market_commit"]
        self.fixture.admin(profile, "CALL DOLT_COMMIT('--amend', '--allow-empty', '--skip-verification', '-m', "
                                    "'amended by hand')")  # what the import account can do to its last commit
        self.assertNotEqual(self.head(profile), synced)
        found = review.market_review(profile)
        self.assertEqual((found["ok"], found["history"]["status"], [item["code"] for item in found["findings"]]),
                         (False, "not_ancestor", ["HISTORY_REWRITTEN"]))
        self.refused("BACKUP_DIVERGED", lambda: admin.market_backup(profile))
        self.assertEqual(self.backed(profile), synced)
        other = self.market("market_other", backup="market_amended")  # another database's backup directory
        self.refused("BACKUP_DIVERGED", lambda: admin.market_backup(other))
        self.assertEqual(self.backed(profile), synced)

    def test_sync_refusals(self):
        profile = self.market("market_refused")
        self.refused("BACKUP_TARGET_UNSET", lambda: admin.market_backup(self.fixture.profile))
        for backup in (self.fixture.service.service_root / "backups", db.REPOSITORY / "never-backup"):
            with self.subTest(backup=backup):
                self.refused("EXPORT_PATH_INVALID", lambda: admin.market_backup({**profile, "backup": str(backup)}))
                self.assertFalse(backup.exists())
        self.refused("ISOLATION_BREACH", lambda: admin.market_backup({**profile, "role": "active"}))
        occupied = self.backups / "occupied"
        occupied.mkdir()
        (occupied / "backup").write_text("not a backup directory")
        self.refused("EXPORT_PATH_INVALID", lambda: admin.market_backup({**profile, "backup": str(occupied)}))
        with store.connect(profile, "import") as running:
            store.lock(running)
            self.refused("CONCURRENT_IMPORT", lambda: admin.market_backup(profile))
        self.assertFalse((self.backups / "market_refused").exists())
        broken = self.backups / "broken"
        (broken / "backup").mkdir(parents=True)
        (broken / "backup" / "garbage").write_text("not a dolt backup")
        self.refused("DOLT_BACKUP", lambda: admin.market_backup({**profile, "backup": str(broken)}))
        found = review.market_review({**profile, "backup": str(broken)})
        self.assertEqual((found["ok"], found["history"]["status"], [item["code"] for item in found["findings"]]),
                         (False, "unreadable", ["BACKUP_UNREADABLE"]))
        self.assertEqual(admin.market_backup(profile)["market_commit"], self.head(profile))


if __name__ == "__main__":
    unittest.main()
