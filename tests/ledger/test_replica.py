"""Native Dolt: syncing published research cannot write, rewind or populate Paper execution records."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import pymysql

from cli import replica as controller, service
from ledger import db, paper, publish, replica, strategies
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service, source


@unittest.skipUnless(BINARY, SKIP)
class ReplicaTests(unittest.TestCase):
    def setUp(self):
        self.source = Service()
        self.addCleanup(self.source.close)
        self.research = self.source.ledger("published")
        strategies.publish_candidate(self.research, source("root"), "root", "Fixture", "root")
        self.temp = tempfile.TemporaryDirectory(prefix="mirror-", dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.origin = (self.root / "origin").as_uri()
        publish.set_remote(self.research, self.origin)
        publish.publish(self.research)
        self.environment = patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(self.root / "profiles")})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        with patch.object(service, "LISTEN", "127.0.0.1"):
            self.server, self.mirror = controller.start(
                self.root / "s", self.root / "data", self.root / "backup", self.origin, db._free_port(),
                self.root / "readers", self.root / "controllers", BINARY, subprocess_log := tempfile.TemporaryFile())
        self.addCleanup(subprocess_log.close)
        self.addCleanup(service._stop, self.server)
        self.execution = db.load_profile("paper")

    def test_public_bootstrap_has_no_research_writer_and_no_old_execution_records(self):
        self.assertIsNone(self.mirror.kind)
        config = db._known_service(self.root / "s")
        self.assertEqual(set(config["databases"]["research"]), {"reader"})
        with self.assertRaises(Refusal):
            db.connect(self.mirror, "writer")
        with db.connect(self.execution, "reader") as conn:
            self.assertEqual(paper.paper_runs(conn), [])
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM paper_source"), [(0,)])
        forwarded = json.loads((self.root / "controllers/service.json").read_text())
        self.assertNotIn("root_password", forwarded, "Paper never holds the service administrator")
        self.assertEqual(self.execution.holds, "paper")
        self.assertNotIn("writer", forwarded["databases"]["research"])
        self.assertIn("writer", forwarded["databases"]["paper"])
        self.assertTrue((self.root / "controllers/paper").is_dir(),
                        "Docker needs the writable child mountpoint inside the read-only controller volume")

    def test_sync_advances_research_only_and_keeps_pinned_old_reads(self):
        before = replica.status(self.mirror)["ledger_commit"]
        with db.read_as_of(self.mirror) as pinned:
            paper.copy_source(self.execution, pinned, "root@1")
        with db.connect(self.execution, "reader") as conn:
            execution_before = db.head_commit(conn)
        strategies.publish_candidate(self.research, source("child"), "root", "Fixture", "child",
                                     "root@1", "second")
        publish.publish(self.research)
        result = replica.sync(self.mirror)
        with db.read_as_of(self.mirror) as head:
            self.assertEqual(replica.status(self.mirror)["ledger_commit"], db.head_commit(head),
                             "the page's server follows the controller's head and reads the product at it")
        self.assertTrue(result["changed"])
        self.assertEqual(result["previous_commit"], before)
        self.assertFalse(replica.sync(self.mirror)["changed"])
        history = replica.status(self.mirror)["history"]
        self.assertEqual([(h["previous_commit"], h["ledger_commit"]) for h in history],
                         [(before, result["ledger_commit"]), (None, before)],
                         "each move of main once, newest first; a sync that changes nothing adds none")
        self.assertRegex(history[0]["at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        with db.read_as_of(self.mirror, before) as old:
            self.assertEqual(strategies.read_candidate(old, "root@1")["source"], source("root"))
            with self.assertRaises(Refusal):
                strategies.read_candidate(old, "root@2")
        with db.connect(self.execution, "reader") as conn:
            self.assertEqual(db.head_commit(conn), execution_before)
            self.assertEqual(paper.paper_runs(conn), [])
        with db.read_as_of(self.mirror) as current:
            copied = paper.copy_source(self.execution, current, "root@2")
        with db.connect(self.execution, "reader") as conn:
            self.assertEqual(paper.read_source(conn, copied["source_sha256"])["source"], source("child"))

    def test_failed_fetch_preserves_visible_research_and_execution(self):
        before = replica.status(self.mirror)["ledger_commit"]
        original = publish._rows

        def offline(cursor, statement, arguments=()):
            if statement == "CALL DOLT_FETCH('origin')":
                raise pymysql.OperationalError(2013, "isolated disconnected origin")
            return original(cursor, statement, arguments)

        with patch("ledger.replica.publish._rows", side_effect=offline):
            with self.assertRaises(Refusal) as caught:
                replica.sync(self.mirror)
        self.assertEqual(caught.exception.code, "REPLICA_SYNC_FAILED")
        self.assertEqual(replica.status(self.mirror)["ledger_commit"], before)
        with self.assertRaises(Refusal):
            replica.sync(self.execution)

    def test_invalid_remote_retains_last_good_head(self):
        before = replica.status(self.mirror)["ledger_commit"]
        with self.source.admin(self.research) as conn:
            with conn.cursor() as cursor:
                cursor.execute("UPDATE ledger_schema SET version = 999 WHERE singleton = 1")
                cursor.execute("CALL DOLT_COMMIT('-a', '-m', 'isolated invalid schema')")
                cursor.fetchall()
        publish.publish(self.research)
        with self.assertRaises(Refusal) as caught:
            replica.sync(self.mirror)
        self.assertEqual(caught.exception.code, "REPLICA_INVALID")
        self.assertEqual(replica.status(self.mirror)["ledger_commit"], before)

    def test_non_fast_forward_does_not_reset_the_local_research_head(self):
        raw = db._admin(db._known_service(self.root / "s"), database="research")
        try:
            with raw.cursor() as cursor:
                cursor.execute("CALL DOLT_COMMIT('--allow-empty', '-m', 'isolated local divergence')")
                cursor.fetchall()
        finally:
            raw.close()
        before = replica.status(self.mirror)["ledger_commit"]
        strategies.publish_candidate(self.research, source("other"), "other", "Fixture", "remote change")
        publish.publish(self.research)
        with self.assertRaises(Refusal) as caught:
            replica.sync(self.mirror)
        self.assertEqual(caught.exception.code, "REPLICA_SYNC_FAILED")
        self.assertEqual(replica.status(self.mirror)["ledger_commit"], before)

    def test_source_copy_keeps_the_exact_revision_and_nothing_else(self):
        strategies.publish_candidate(self.research, source("unused"), "root", "Fixture", "unused")
        strategies.publish_candidate(self.research, source("selected"), "root", "Fixture", "selected",
                                     "root@1", "selected parent skips revision 2")
        publish.publish(self.research)
        replica.sync(self.mirror)
        with db.read_as_of(self.mirror) as published:
            row = paper.copy_source(self.execution, published, "root@3")
            paper.copy_source(self.execution, published, "root@3")
        with db.connect(self.execution, "reader") as conn:
            self.assertEqual(conn.rows("SELECT source_sha256 FROM paper_source"), [(row["source_sha256"],)])
            stored = paper.read_source(conn, row["source_sha256"])
            self.assertEqual((stored["source"], stored["entry_class"]), (source("selected"), row["entry_class"]))

    def test_background_sync_invokes_one_cli_operation_and_reports_the_new_head(self):
        strategies.publish_candidate(self.research, source("background"), "background", "Fixture", "new source")
        publish.publish(self.research)
        sync = controller.Sync(self.mirror)
        with patch("cli.replica.subprocess.run", wraps=controller.subprocess.run) as command:
            self.assertEqual(sync.request(), {"state": "syncing"})
            self.assertEqual(sync.request(), {"state": "syncing"})
            until = time.monotonic() + 15
            while sync.status()["state"] == "syncing" and time.monotonic() < until:
                time.sleep(.02)
            self.assertEqual(sync.status()["state"], "ready", sync.status())
            self.assertTrue(sync.status()["changed"])
            self.assertEqual(command.call_count, 1)

    def test_lost_fast_forward_reply_is_confirmed_without_reset_or_duplicate_work(self):
        strategies.publish_candidate(self.research, source("lost-reply"), "reply", "Fixture", "remote change")
        publish.publish(self.research)
        original = publish._rows

        def lost_reply(cursor, statement, arguments=()):
            result = original(cursor, statement, arguments)
            if statement == "CALL DOLT_MERGE('--ff-only', 'origin/main')":
                raise pymysql.OperationalError(2013, "isolated lost reply after successful fast-forward")
            return result

        with patch("ledger.replica.publish._rows", side_effect=lost_reply):
            result = replica.sync(self.mirror)
        self.assertTrue(result["changed"])
        self.assertEqual(replica.status(self.mirror)["ledger_commit"], result["ledger_commit"])
