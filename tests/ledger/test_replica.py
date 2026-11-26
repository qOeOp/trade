"""Native Dolt: syncing published research cannot write, rewind or populate Paper execution records."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import pymysql

from ledger import db, paper, publish, replica, server, service, strategies
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service, source
from tests.helpers import refused


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
            self.process, self.mirror = replica.start(
                self.root / "s", self.root / "data", self.root / "backup", self.origin, server.free_port(),
                self.root / "readers", self.root / "controllers", BINARY, subprocess_log := tempfile.TemporaryFile())  # noqa: SIM115
        self.addCleanup(subprocess_log.close)
        self.addCleanup(server.stop, self.process)
        self.execution = db.load_profile("paper")

    def test_public_bootstrap_has_no_research_writer_and_no_old_execution_records(self):
        self.assertIsNone(self.mirror.kind)
        config = server.known_service(self.root / "s")
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

    def test_a_sync_fetches_main_only(self):
        conn = server.connect_root(server.service_config(self.research.service_root), database=self.research.database)
        with conn.cursor() as cursor:
            cursor.execute("CALL DOLT_BRANCH('other-line')")
            cursor.execute("CALL DOLT_CHECKOUT('other-line')")
            cursor.execute("CALL DOLT_COMMIT('--allow-empty', '-m', 'only on another line')")
            cursor.execute("SELECT DOLT_HASHOF('other-line')")
            (other,), = cursor.fetchall()
            cursor.execute("CALL DOLT_PUSH('origin', 'other-line:v0.0')")
            cursor.execute("CALL DOLT_BRANCH('-d', '-r', 'origin/v0.0')")  # an archived line: the ledger tracks main
        conn.close()
        strategies.publish_candidate(self.research, source("line"), "line", "Fixture", "on the line")
        publish.publish(self.research)
        self.assertTrue(replica.sync(self.mirror)["changed"])
        mirror = server.admin(self.mirror)
        try:
            with mirror.cursor() as cursor:
                cursor.execute(f"USE `{self.mirror.database}`")
                cursor.execute("SELECT name FROM dolt_remote_branches")
                self.assertEqual([name for (name,) in cursor.fetchall()], [publish.TRACKING])
                cursor.execute("SELECT name FROM dolt_branches")
                self.assertEqual([name for (name,) in cursor.fetchall()], ["main"])
                with self.assertRaises(pymysql.MySQLError, msg="an archived line's commits are never fetched"):
                    cursor.execute("CALL DOLT_BRANCH('probe', %s)", (other,))
        finally:
            mirror.close()
        self.assertEqual(publish.where(self.mirror), {  # what the release host reads, with the reader alone
            "remote": self.origin, "tracked": ["main"], "line": publish.LINE,
            "head": replica.status(self.mirror)["ledger_commit"]})

    def restart(self):
        server.stop(self.process)
        with patch.object(service, "LISTEN", "127.0.0.1"):
            self.process, self.mirror = replica.start(
                self.root / "s", self.root / "data", self.root / "backup", self.origin,
                server.known_service(self.root / "s")["port"], self.root / "readers", self.root / "controllers",
                BINARY, log := tempfile.TemporaryFile())  # noqa: SIM115
        self.addCleanup(log.close)
        self.addCleanup(server.stop, self.process)

    def test_a_mirror_that_followed_its_line_s_branch_follows_main_from_its_next_start(self):
        """0.5.3's mirror tracked origin's v0.5; once main holds its head, a 0.5.4 start leaves it tracking main
        alone, with the line's tag, and its syncs fast-forward from there."""
        conn = server.connect_root(server.service_config(self.research.service_root), database=self.research.database)
        with conn.cursor() as cursor:
            cursor.execute("CALL DOLT_PUSH('origin', 'main:v0.5')")
            cursor.execute("CALL DOLT_BRANCH('-d', '-r', 'origin/v0.5')")
        conn.close()
        mirror = server.admin(self.mirror)
        try:
            with mirror.cursor() as cursor:
                cursor.execute("CALL DOLT_FETCH('origin', 'refs/heads/v0.5:refs/remotes/origin/v0.5')")
                cursor.execute("CALL DOLT_BRANCH('-d', '-r', 'origin/main')")
                cursor.execute("CALL DOLT_TAG('-d', %s)", (publish.TAG,))  # 0.5.3's ledger had no line tag
        finally:
            mirror.close()
        self.assertEqual(publish.where(self.mirror) | {"head": None},
                         {"remote": self.origin, "tracked": ["v0.5"], "line": None, "head": None})
        strategies.publish_candidate(self.research, source("moved"), "moved", "Fixture", "after the move")
        published = publish.publish(self.research)["head"]
        self.restart()
        self.assertEqual(publish.where(self.mirror) | {"head": None},
                         {"remote": self.origin, "tracked": ["main"], "line": publish.LINE, "head": None})
        self.assertEqual(replica.sync(self.mirror)["ledger_commit"], published)

    def test_a_mirror_of_an_earlier_line_keeps_its_head_when_main_is_replaced(self):
        """After a new line forces main, the old version's mirror cannot fast-forward: it keeps what it has until its
        own cutover mirrors main afresh."""
        before = replica.status(self.mirror)["ledger_commit"]
        replaced = Service()
        self.addCleanup(replaced.close)
        other = replaced.ledger("replaced")
        publish.set_remote(other, self.origin)
        with patch.object(publish, "LINE", "v9"), patch.object(publish, "TAG", "line/v9"):
            conn = server.connect_root(server.service_config(other.service_root), database=other.database)
            with conn.cursor() as cursor:
                cursor.execute("CALL DOLT_TAG('-d', %s)", (db.line_tag(),))
                cursor.execute("CALL DOLT_TAG('line/v9', (SELECT commit_hash FROM dolt_log WHERE commit_order = 1))")
            conn.close()
            publish.replace(other)
        self.assertEqual(refused(replica.sync, self.mirror).code, "REPLICA_SYNC_FAILED")
        self.assertEqual(replica.status(self.mirror)["ledger_commit"], before)

    def test_failed_fetch_preserves_visible_research_and_execution(self):
        before = replica.status(self.mirror)["ledger_commit"]
        original = server.cursor_rows

        def offline(cursor, statement, arguments=()):
            if statement == "CALL DOLT_FETCH(%s, %s)":
                raise pymysql.OperationalError(2013, "isolated disconnected origin")
            return original(cursor, statement, arguments)

        with patch("ledger.server.cursor_rows", side_effect=offline):
            caught = refused(replica.sync, self.mirror)
        self.assertEqual(caught.code, "REPLICA_SYNC_FAILED")
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
        self.assertEqual(refused(replica.sync, self.mirror).code, "REPLICA_INVALID")
        self.assertEqual(replica.status(self.mirror)["ledger_commit"], before)

    def test_non_fast_forward_does_not_reset_the_local_research_head(self):
        raw = server.connect_root(server.known_service(self.root / "s"), database="research")
        try:
            with raw.cursor() as cursor:
                cursor.execute("CALL DOLT_COMMIT('--allow-empty', '-m', 'isolated local divergence')")
                cursor.fetchall()
        finally:
            raw.close()
        before = replica.status(self.mirror)["ledger_commit"]
        strategies.publish_candidate(self.research, source("other"), "other", "Fixture", "remote change")
        publish.publish(self.research)
        self.assertEqual(refused(replica.sync, self.mirror).code, "REPLICA_SYNC_FAILED")
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
        sync = replica.Sync(self.mirror)
        with patch("ledger.replica.subprocess.run", wraps=replica.subprocess.run) as command:
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
        original = server.cursor_rows

        def lost_reply(cursor, statement, arguments=()):
            result = original(cursor, statement, arguments)
            if statement == f"CALL DOLT_MERGE('--ff-only', '{replica.ORIGIN_MAIN}')":
                raise pymysql.OperationalError(2013, "isolated lost reply after successful fast-forward")
            return result

        with patch("ledger.server.cursor_rows", side_effect=lost_reply):
            result = replica.sync(self.mirror)
        self.assertTrue(result["changed"])
        self.assertEqual(replica.status(self.mirror)["ledger_commit"], result["ledger_commit"])


class OriginTests(unittest.TestCase):
    def test_the_mirror_takes_only_the_dolthub_repository_form_publish_takes(self):
        with tempfile.TemporaryDirectory() as root, patch.object(replica.service, "start") as started:
            for origin in ("https://doltremoteapi.dolthub.com/", "https://doltremoteapi.dolthub.com/a/b/c",
                           "https://doltremoteapi.dolthub.com/a/b?x=1", "https://user@doltremoteapi.dolthub.com/a/b"):
                with self.subTest(origin=origin):
                    caught = refused(replica.start, Path(root), Path(root), Path(root), origin, 0, Path(root),
                                     Path(root))
                self.assertEqual(caught.code, "USAGE_ERROR")
            started.assert_not_called()


class SyncRefusalTests(unittest.TestCase):
    def test_a_sync_refusal_printed_after_a_warning_line_is_the_error_it_shows(self):
        printed = Refusal("ORIGIN_UNAVAILABLE", "DoltHub did not answer").as_dict()
        stderr = "warning: a launcher line\n" + json.dumps(printed, indent=2) + "\n"
        sync = replica.Sync(type("Profile", (), {"name": "mirror"})())
        with patch("ledger.replica.subprocess.run",
                   return_value=replica.subprocess.CompletedProcess([], 1, stdout="", stderr=stderr)):
            sync.request()
            until = time.monotonic() + 5
            while sync.state["state"] == "syncing" and time.monotonic() < until:
                time.sleep(.01)
        self.assertEqual(sync.state, {"state": "error", "error": printed})


class HandlerTests(unittest.TestCase):
    def test_transfer_encoding_and_duplicate_or_nonzero_content_length_are_refused(self):
        from http.server import ThreadingHTTPServer

        sync = MagicMock()
        sync.request.return_value = {"state": "syncing"}
        srv = ThreadingHTTPServer(("127.0.0.1", 0), replica.handler(sync, frozenset({"mirror:8766"})))
        threading.Thread(target=srv.serve_forever, args=(0.01,), daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        cases = (
            ("te-chunked", "Transfer-Encoding: chunked\r\n", b"5\r\nhello\r\n0\r\n\r\n"),
            ("te-empty-then-chunked", "Transfer-Encoding:\r\nTransfer-Encoding: chunked\r\n", b"2\r\n{}\r\n0\r\n\r\n"),
            ("dup-cl", "Content-Length: 0\r\nContent-Length: 100\r\n", b"x" * 100),
            ("nonzero-cl", "Content-Length: 5\r\n", b"hello"),
        )
        for label, header, body in cases:
            with self.subTest(label=label), socket.create_connection(srv.server_address, timeout=5) as raw:
                payload = (
                    f"POST /api/research/sync HTTP/1.1\r\nHost: mirror:8766\r\n"
                    f"Sec-Fetch-Site: same-origin\r\nConnection: close\r\n{header}\r\n"
                ).encode() + body
                raw.sendall(payload)
                raw.shutdown(socket.SHUT_WR)
                reply = b""
                while chunk := raw.recv(4096):
                    reply += chunk
                self.assertTrue(reply.startswith((b"HTTP/1.0 400 ", b"HTTP/1.1 400 ")),
                                f"{label}: {reply[:120]!r}")
        sync.request.assert_not_called()
        with socket.create_connection(srv.server_address, timeout=5) as raw:
            raw.sendall(
                b"POST /api/research/sync HTTP/1.1\r\nHost: mirror:8766\r\n"
                b"Sec-Fetch-Site: same-origin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            raw.shutdown(socket.SHUT_WR)
            reply = b""
            while chunk := raw.recv(4096):
                reply += chunk
            self.assertTrue(reply.startswith((b"HTTP/1.0 202 ", b"HTTP/1.1 202 ")), f"valid: {reply[:120]!r}")
        sync.request.assert_called_once_with()
