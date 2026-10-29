"""Explicit recovery of unrelated IDE market histories retains both, and normal polling stays ff-only.
Real Dolt 2.4.2 with file remotes and disposable databases; no active ledger, market or credentials.
"""
from __future__ import annotations

import importlib.util
from contextlib import nullcontext
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pymysql

from ledger import db
from tests.ledger.dolt import BINARY, SKIP, Service

spec = importlib.util.spec_from_file_location("ide_replica", Path(__file__).resolve().parents[2]
                                             / "services/ide/docker/replica.py")
replica = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replica)


@unittest.skipUnless(BINARY, SKIP)
class ReplicaTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("ide_copy")
        self.copy = self.service.admin(self.profile)
        self.addCleanup(self.copy.close)
        replica.sql(self.copy, "CREATE DATABASE upstream_market")
        self.upstream = db._admin(db._service(self.profile.service_root), database="upstream_market")
        self.addCleanup(self.upstream.close)
        replica.sql(self.upstream, "CREATE TABLE fixture (id INT PRIMARY KEY)")
        replica.sql(self.upstream, "INSERT INTO dolt_tests VALUES "
                    "('fixture', 'commit', 'SELECT COUNT(*) FROM fixture WHERE id < 0', 'expected_single_value', '==', '0')")
        replica.sql(self.upstream, "INSERT INTO fixture VALUES (1)")
        self.commit()
        replica.sql(self.upstream, "CALL DOLT_BRANCH('legacy-x')")
        self.work = tempfile.TemporaryDirectory(prefix="ide-replica-", dir="/tmp")
        self.addCleanup(self.work.cleanup)
        self.remote = (Path(self.work.name) / "remote").as_uri()
        for conn in (self.upstream, self.copy):
            replica.sql(conn, "CALL DOLT_REMOTE('add', 'origin', %s)", (self.remote,))
        for branch in ("main", "legacy-x"):
            replica.sql(self.upstream, "CALL DOLT_PUSH('origin', %s)", (branch,))

    def commit(self):
        replica.sql(self.upstream, "CALL DOLT_COMMIT('-A', '--allow-empty', '-m', 'fixture')")

    def head(self, conn):
        return replica.sql(conn, "SELECT DOLT_HASHOF('HEAD')")[0][0]

    def test_unrelated_copy_is_retained_then_follows_main_and_keeps_historical_branches(self):
        old = self.head(self.copy)
        with self.assertRaises(pymysql.MySQLError) as caught:
            replica.pull(self.copy, "market")
        self.assertIn("no common ancestor", str(caught.exception).lower())
        self.assertEqual(self.head(self.copy), old, "normal polling cannot reset a divergent head")
        repaired = replica.repair_market(self.copy)
        self.assertEqual(repaired["before"], old)
        self.assertEqual(repaired["after"], self.head(self.upstream))
        archive = repaired["retained_branch"]
        self.assertEqual(replica.sql(self.copy, "SELECT DOLT_HASHOF(%s)", (archive,)), [(old,)])
        self.assertTrue(replica.sql(self.copy, "SHOW TABLES AS OF %s", (old,)), "old tables remain readable")
        self.assertEqual(replica.sql(self.copy, "SELECT * FROM fixture"), [(1,)])
        self.assertEqual(replica.sql(self.copy, "SELECT name FROM dolt_branches ORDER BY name"),
                         [(archive,), ("legacy-x",), ("main",)])
        self.assertIsNone(replica.repair_market(self.copy)["retained_branch"], "repeated recovery is a no-op")
        replica.sql(self.upstream, "INSERT INTO fixture VALUES (2)")
        self.commit()
        replica.sql(self.upstream, "CALL DOLT_PUSH('origin', 'main')")
        replica.pull(self.copy, "market")
        self.assertEqual(self.head(self.copy), self.head(self.upstream))
        self.assertEqual(replica.sql(self.copy, "SELECT DOLT_HASHOF(%s)", (archive,)), [(old,)])

    def test_dirty_copy_and_a_failed_preservation_leave_main_untouched(self):
        old = self.head(self.copy)
        replica.sql(self.copy, "CREATE TABLE uncommitted (id INT)")
        with self.assertRaisesRegex(RuntimeError, "uncommitted"):
            replica.repair_market(self.copy)
        self.assertEqual(self.head(self.copy), old)
        replica.sql(self.copy, "DROP TABLE uncommitted")
        with patch.object(replica, "retain", side_effect=RuntimeError("cannot preserve")):
            with self.assertRaisesRegex(RuntimeError, "cannot preserve"):
                replica.repair_market(self.copy)
        self.assertEqual(self.head(self.copy), old)

    def test_polling_reports_unrelated_history_as_rewritten_without_repairing_it(self):
        old = self.head(self.copy)
        with patch.object(replica, "SERVICE", Path(self.work.name)), \
                patch.object(replica, "connection", return_value=nullcontext(self.copy)):
            self.assertEqual(replica.main(["market"]), replica.REWRITTEN)
        self.assertEqual(self.head(self.copy), old)


if __name__ == "__main__":
    unittest.main()
