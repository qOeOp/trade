"""If this fails, the Dolt service compose runs (`ledger service run`) no longer comes up as it should:
on first start it bootstraps the ledger from its public copy (here a local file remote) into empty
directories only, with every branch, root reachable from beyond localhost, the accounts `ledger
init` makes, a socketless service.json and the ledger profile, the separate Paper database beside it, never a
market; a bootstrap that fails or is
refused leaves nothing it made; every later start checks the service before serving and first removes
what an interrupted Dolt transfer left; the service collects unreachable chunks by itself; the host
reaches such a service over TCP and never stops it; while it runs it publishes what origin lacks. Throwaway
services only, never the active ledger."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import pymysql

from cli import service
from ledger import admin, db, publish, strategies
from shared import profiles
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service, source


@unittest.skipUnless(BINARY, SKIP)
class RunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """One source service whose research ledger is published to a file remote, with a candidate and a
        second branch."""
        cls.source = Service()
        try:
            cls.remotes = Path(tempfile.mkdtemp(prefix="or-", dir="/tmp"))
            ledger = cls.source.ledger("research")
            strategies.publish_candidate(ledger, source("cloned"), "cloned", "Fixture", "published before the clone")
            cls.origin = (cls.remotes / "research").as_uri()
            conn = db._admin(db._service(ledger.service_root), database=ledger.database)
            with conn.cursor() as cursor:
                cursor.execute("CALL DOLT_BRANCH('legacy-x')")
            conn.close()
            publish.set_remote(ledger, cls.origin)
            publish.publish(ledger)
            conn = db._admin(db._service(ledger.service_root), database=ledger.database)
            with conn.cursor() as cursor:
                cursor.execute("CALL DOLT_PUSH('origin', 'legacy-x')")
            conn.close()
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.source.close()
        shutil.rmtree(getattr(cls, "remotes", "/nonexistent"), ignore_errors=True)

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="sv-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.service_root, self.data, self.backups = self.root / "s", self.root / "data", self.root / "backups"
        self.credentials = self.root / "user" / ".dolt"
        (self.credentials / "creds").mkdir(parents=True)
        (self.credentials / "config_global.json").write_text(json.dumps({"user.creds": "k1"}), encoding="utf-8")
        (self.credentials / "creds" / "k1.jwk").write_bytes(b'{"key": "fixture"}')
        environment = patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(self.root / "profiles")})
        environment.start()
        self.addCleanup(environment.stop)
        listen = patch.object(service, "LISTEN", "127.0.0.1")
        listen.start()
        self.addCleanup(listen.stop)
        self.port = db._free_port()
        self.log = open(self.root / "server.log", "ab")
        self.addCleanup(self.log.close)

    def start(self, origin: str | None = None, credentials: Path | None = None, readers: Path | None = None,
              controllers: Path | None = None):
        server, config = service.start(self.service_root, self.data, self.backups,
                                       self.credentials if credentials is None else credentials,
                                       origin or self.origin, self.port, BINARY, "isolated", self.log, readers,
                                       controllers=controllers)
        self.addCleanup(service._stop, server)
        return server, config

    def code(self, function, *arguments, **options) -> str:
        with self.assertRaises(Refusal) as caught:
            function(*arguments, **options)
        return caught.exception.code

    def test_a_first_start_bootstraps_the_ledger_from_its_public_copy(self):
        server, config = self.start()
        written = db._service(self.service_root)
        self.assertNotIn("socket", written)
        self.assertTrue(db.managed(written))
        self.assertEqual(written["port"], self.port)
        self.assertEqual(sorted(written["databases"]), ["paper", "research"])
        ledger = db.load_profile("research")
        self.assertEqual(sorted(path.name for path in profiles.home().glob("*.json")), ["paper.json", "research.json"],
                         "no market profile")
        execution = db.load_profile("paper")
        self.assertEqual((execution.holds, execution.kind, ledger.holds), ("paper", "isolated", "research"))
        with db.connect(execution, "reader") as conn:
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM paper_run"), [(0,)])
        self.assertEqual((ledger.database, ledger.kind, ledger.backup_root), ("research", "isolated",
                                                                             self.backups / "research"))
        with db.connect(ledger, "writer") as conn:
            self.assertIsNone(conn.raw.unix_socket, "the host reaches a service compose runs over TCP")
        with db.read_as_of(ledger) as conn:
            self.assertEqual(conn.rows("SELECT strategy_id FROM candidate"), [("cloned",)],
                             "the published history comes with the clone")
        research = db._admin(config, database="research")
        self.addCleanup(research.close)
        with research.cursor() as cursor:
            cursor.execute("SELECT url FROM dolt_remotes WHERE name = 'origin'")
            self.assertEqual(cursor.fetchall(), ((self.origin,),), "the public copy stays the origin")
        with research.cursor() as cursor:
            cursor.execute("SELECT name FROM dolt_branches ORDER BY name")
            self.assertEqual([name for (name,) in cursor.fetchall()], ["legacy-x", "main"],
                             "every remote branch becomes a local one")
            cursor.execute("SELECT host FROM mysql.user WHERE user = 'root' ORDER BY host")
            self.assertEqual([host for (host,) in cursor.fetchall()], ["%", "localhost"])
            cursor.execute("SELECT host, permissions FROM dolt_branch_control WHERE user = 'root' ORDER BY host")
            self.assertEqual([tuple(row) for row in cursor.fetchall()], [("%", "admin"), ("localhost", "admin")])
        self.assertEqual(
            (self.service_root / "home" / ".dolt" / "creds" / "k1.jwk").read_bytes(), b'{"key": "fixture"}')
        with db.read_as_of(ledger) as conn:
            self.assertEqual(service.check(ledger), {"action": "check", "running": True,
                                                     "ledger_commit": conn.resolved_commit})
        self.assertEqual(db.start_service(self.service_root)["pid"], None, "the host only waits for it")
        self.assertEqual(self.code(db.stop_service, self.service_root), "SERVICE_MANAGED")
        self.assertIsNone(server.poll(), "and never stops it")

    def test_every_later_start_checks_the_service_before_serving(self):
        server, _ = self.start()
        service._stop(server)
        server, _ = self.start()
        self.assertIsNone(server.poll(), "a checked service serves")
        service._stop(server)
        config = db._service(self.service_root)
        profiles.private_write(self.service_root / "service.json",
                          {**config, "databases": {**config["databases"], "gone": config["databases"]["research"]}})
        self.assertEqual(self.code(self.start), "SERVICE_CHECK_FAILED")
        profiles.private_write(self.service_root / "service.json", {**config, "socket": str(self.root / "x.sock")})
        self.assertEqual(self.code(self.start), "SERVICE_CHECK_FAILED", "a service the host runs is not served here")

    def test_disk_dolt_no_longer_needs_is_reclaimed(self):
        server, config = self.start()
        service._stop(server)
        left = self.data / ".dolt" / "tmp" / "buffered_file_byte_sink_1974208896"
        left.parent.mkdir(parents=True, exist_ok=True)
        left.write_bytes(b"x" * 4096)
        ledger = db.load_profile("research")
        self.start()
        self.assertFalse(left.exists(), "a later start removes what an interrupted transfer left")
        self.assertTrue(left.parent.is_dir())
        with db.read_as_of(ledger) as conn:
            self.assertEqual(conn.rows("SELECT strategy_id FROM candidate"), [("cloned",)], "the ledger is untouched")
        conn = db._admin(config)
        self.addCleanup(conn.close)
        with conn.cursor() as cursor:
            cursor.execute("SELECT @@GLOBAL.dolt_auto_gc_enabled")
            self.assertEqual(cursor.fetchall(), ((1,),), "the service collects unreachable chunks by itself")

    def test_the_reader_only_service_file_reads_and_holds_nothing_that_writes(self):
        readers = self.root / "readers"
        server, config = self.start(readers=readers)
        written = json.loads((readers / "service.json").read_text(encoding="utf-8"))
        self.assertEqual(written, {"port": self.port, "databases": {
            name: {"reader": accounts["reader"]} for name, accounts in config["databases"].items()}})
        self.assertEqual(sorted(written["databases"]), ["paper", "research"])
        ledger = db.LedgerProfile(name="research", database="research", service_root=readers, kind=None)
        with db.read_as_of(ledger) as conn:
            self.assertEqual(conn.rows("SELECT strategy_id FROM candidate"), [("cloned",)])
        self.assertEqual(self.code(db.connect, ledger, "writer"), "LEDGER_UNKNOWN")
        for administrator in (admin._admin, publish._admin):
            self.assertEqual(self.code(administrator, ledger), "LEDGER_UNKNOWN", "nor the service administrator")
        with db.read_as_of(ledger) as conn:
            for statement in (f"SELECT strategy_id FROM candidate INTO OUTFILE '{self.root / 'cloned.txt'}'",
                              f"SELECT LOAD_FILE('{self.service_root / 'service.json'}')"):
                with self.subTest(statement=statement), self.assertRaises(pymysql.MySQLError), \
                        conn.raw.cursor() as cursor:
                    cursor.execute(statement)
        self.assertFalse((self.root / "cloned.txt").exists(), "nor a server file")
        service._stop(server)
        (readers / "service.json").unlink()
        self.start(readers=readers)
        self.assertEqual(json.loads((readers / "service.json").read_text(encoding="utf-8")), written,
                         "every later start writes it again")

    def test_the_paper_controller_files_hold_paper_accounts_and_the_research_reader_only(self):
        """Item 8: the paper container mounts this directory, never the service directory."""
        controllers = self.root / "controllers"
        server, config = self.start(controllers=controllers)
        written = json.loads((controllers / "service.json").read_text(encoding="utf-8"))
        self.assertEqual(written, {"port": self.port, "databases": {
            "research": {"reader": config["databases"]["research"]["reader"]}, "paper": config["databases"]["paper"]}})
        self.assertTrue((controllers / "paper").is_dir(), "the mountpoint of the writable run directory")
        self.assertEqual(sorted(path.name for path in controllers.iterdir()),
                         ["paper", "paper.json", "research.json", "service.json"])
        research = db.LedgerProfile(name="research", database="research", service_root=controllers, kind=None)
        with db.read_as_of(research) as conn:
            self.assertEqual(conn.rows("SELECT strategy_id FROM candidate"), [("cloned",)])
        self.assertEqual(self.code(db.connect, research, "writer"), "LEDGER_UNKNOWN")
        for administrator in (admin._admin, publish._admin):
            self.assertEqual(self.code(administrator, research), "LEDGER_UNKNOWN", "nor the service administrator")
        execution = db.LedgerProfile(name="paper", database="paper", service_root=controllers, kind="isolated",
                                     holds="paper")
        with db.connect(execution, "writer") as conn:
            self.assertEqual(conn.role, "writer")
        service._stop(server)
        self.assertEqual(self.code(self.start, controllers=self.service_root), "USAGE_ERROR")

    def test_readers_never_replace_the_service_file(self):
        server, _ = self.start()
        service._stop(server)
        before = (self.service_root / "service.json").read_bytes()
        self.assertEqual(self.code(self.start, readers=self.service_root), "USAGE_ERROR")
        self.assertEqual((self.service_root / "service.json").read_bytes(), before)

    def test_a_bootstrap_refused_or_failed_leaves_nothing_it_made(self):
        self.data.mkdir()
        (self.data / "keep").write_text("someone's", encoding="utf-8")
        self.assertEqual(self.code(self.start), "BOOTSTRAP_REFUSED")
        self.assertEqual([path.name for path in self.data.iterdir()], ["keep"], "nothing was touched")
        self.assertFalse(self.service_root.exists())
        (self.data / "keep").unlink()
        self.assertEqual(self.code(self.start, credentials=self.root / "none"), "DOLTHUB_CREDENTIALS")
        self.assertFalse(self.service_root.exists(), "the key is checked before anything is made")
        (self.service_root / "paper").mkdir(parents=True)  # compose's mount of the paper run directory
        not_a_copy = self.root / "not-a-copy"
        not_a_copy.write_text("not a Dolt remote", encoding="utf-8")
        self.assertEqual(self.code(self.start, origin=not_a_copy.as_uri()), "BOOTSTRAP_FAILED")
        self.assertEqual([path.name for path in self.service_root.iterdir()], ["paper"],
                         "an empty directory counts as empty and stays")
        self.assertEqual(list(self.data.iterdir()), [])
        self.assertEqual(list(profiles.home().glob("*.json")), [])
        server, _ = self.start()
        self.assertIsNone(server.poll(), "the next start bootstraps again")

    def test_an_empty_copy_starts_a_new_ledger_published_there(self):
        origin = self.remotes / f"new-{self.port}"
        origin.mkdir()
        self.addCleanup(shutil.rmtree, origin, True)
        self.start(origin=origin.as_uri())
        profile = db.load_profile("research")
        self.assertEqual(profile.kind, "isolated")
        with db.read_as_of(profile) as conn:
            head = conn.resolved_commit
        self.assertFalse(publish.unpublished(profile), "the new ledger is on its copy before anything writes")
        self.assertEqual(publish.set_remote(profile, origin.as_uri())["added"], False, "the copy stays its origin")
        (self.remotes / f"clone-{self.port}").mkdir()
        self.addCleanup(shutil.rmtree, self.remotes / f"clone-{self.port}", True)
        cloned = subprocess.run([BINARY, "clone", origin.as_uri(), "copy"], cwd=self.remotes / f"clone-{self.port}",
                                env={**os.environ, "DOLT_ROOT_PATH": str(self.service_root / "home"),
                                     "DOLT_DISABLE_EVENT_FLUSH": "true"}, capture_output=True, text=True)
        self.assertEqual(cloned.returncode, 0, cloned.stderr)
        self.assertIn(head, subprocess.run([BINARY, "log", "-n", "1"], cwd=self.remotes / f"clone-{self.port}" / "copy",
                                           env={**os.environ, "DOLT_ROOT_PATH": str(self.service_root / "home"),
                                                "DOLT_DISABLE_EVENT_FLUSH": "true", "NO_COLOR": "1"},
                                           capture_output=True, text=True, check=True).stdout)

    def test_a_running_service_publishes_what_origin_lacks_with_no_write_command(self):
        origin = self.remotes / f"behind-{self.port}"
        origin.mkdir()
        self.addCleanup(shutil.rmtree, origin, True)
        server, _ = self.start(origin=origin.as_uri())
        answers = []
        with patch.object(service, "start", return_value=(server, {})), patch.object(service, "PUBLISH_RETRY", 0.05), \
                patch.object(service.signal, "signal"):
            running = threading.Thread(target=lambda: answers.append(service.run(
                self.service_root, self.data, self.backups, self.credentials, None, self.port)))
            running.start()
            profile = db.load_profile("research")
            strategies.publish_candidate(profile, source("behind"), "behind", "Fixture", "a commit no command published")
            deadline = time.monotonic() + 60
            while publish.unpublished(profile) and time.monotonic() < deadline:
                time.sleep(0.05)
            caught_up = not publish.unpublished(profile)
            service._stop(server)
            running.join(60)
        self.assertTrue(caught_up, "the service published it")
        self.assertEqual(answers[0][1], 0, "the retry does not hold up the service's exit")

    def test_a_new_ledger_its_copy_refuses_leaves_nothing_it_made(self):
        origin = self.remotes / f"refusing-{self.port}"
        origin.mkdir()
        self.addCleanup(shutil.rmtree, origin, True)
        with patch.object(publish, "_push", side_effect=publish.refuse("PUBLISH_FAILED", "the key cannot write")):
            self.assertEqual(self.code(self.start, origin=origin.as_uri()), "PUBLISH_FAILED")
        self.assertEqual(list(self.data.iterdir()), [])
        self.assertEqual(list(profiles.home().glob("*.json")), [])
        self.assertFalse((self.service_root / "service.json").exists())

    def test_a_read_only_mirror_never_makes_a_ledger_from_an_empty_copy(self):
        origin = self.remotes / f"mirror-{self.port}"
        origin.mkdir()
        self.addCleanup(shutil.rmtree, origin, True)
        self.assertEqual(self.code(service.start, self.service_root, self.data, self.backups, None, origin.as_uri(),
                                   self.port, BINARY, None, self.log), "BOOTSTRAP_FAILED")

    def test_a_first_start_without_an_origin_says_what_to_set(self):
        with self.assertRaises(Refusal) as caught:
            service.start(self.service_root, self.data, self.backups, self.credentials, "", self.port, BINARY,
                          "isolated", self.log)
        self.assertEqual(caught.exception.code, "USAGE_ERROR")
        self.assertIn("TRADE_RESEARCH_ORIGIN", str(caught.exception))

    def test_a_copy_that_is_no_ledger_is_named_as_that(self):
        work = self.root / "unrelated"
        work.mkdir()
        environment = {**os.environ, "DOLT_ROOT_PATH": str(self.root / "copy-home")}
        db.dolt_home(self.root / "copy-home", {"user.name": "elsewhere", "user.email": "elsewhere@example.invalid"})
        for command in (("init",), ("sql", "-q", "CREATE TABLE t (a INT PRIMARY KEY)"), ("add", "."),
                        ("commit", "-m", "another project")):
            subprocess.run([BINARY, *command], cwd=work, env=environment, check=True, capture_output=True)
        other = self.root / "other"
        subprocess.run([BINARY, "remote", "add", "other", other.as_uri()], cwd=work, env=environment, check=True,
                       capture_output=True)
        subprocess.run([BINARY, "push", "other", "main"], cwd=work, env=environment, check=True, capture_output=True)
        with self.assertRaises(Refusal) as caught:
            self.start(origin=other.as_uri())
        self.assertEqual(caught.exception.code, "BOOTSTRAP_FAILED")
        self.assertIn("does not hold a research ledger", caught.exception.message)
        self.assertEqual(list(self.data.iterdir()), [], "nothing is kept")
        self.assertEqual(list(profiles.home().glob("*.json")), [])

    def test_a_copy_this_code_cannot_read_is_not_bootstrapped(self):
        work = self.root / "copy"
        environment = {**os.environ, "DOLT_ROOT_PATH": str(self.root / "copy-home")}
        db.dolt_home(self.root / "copy-home", {"user.name": "elsewhere", "user.email": "elsewhere@example.invalid"})
        subprocess.run([BINARY, "clone", self.origin, str(work)], env=environment, check=True,
                       capture_output=True)
        subprocess.run([BINARY, "sql", "-q", "UPDATE ledger_schema SET version = 99"], cwd=work, env=environment,
                       check=True, capture_output=True)
        subprocess.run([BINARY, "commit", "-Am", "future", "--skip-verification"], cwd=work, env=environment,
                       check=True, capture_output=True)
        newer = self.root / "newer"
        subprocess.run([BINARY, "remote", "add", "newer", newer.as_uri()], cwd=work, env=environment, check=True,
                       capture_output=True)
        subprocess.run([BINARY, "push", "newer", "main"], cwd=work, env=environment, check=True, capture_output=True)
        self.assertEqual(self.code(self.start, origin=newer.as_uri()), "SERVICE_CHECK_FAILED")
        self.assertEqual(list(self.data.iterdir()), [], "nothing is kept")
        self.assertEqual(list(profiles.home().glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
