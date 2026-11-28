"""If this fails, the Dolt service compose runs (`ledger service run`) no longer comes up as it should:
on first start it bootstraps the ledger from its public copy's `main` (here a local file remote) into empty
directories only, with no archived line's branch or data, or, when `main` holds an earlier line's ledger, archives
that `main` under its line's name (checked, never forced) before a new ledger takes `main` (a real force push), root
reachable from beyond localhost, the accounts `ledger init` makes, a socketless service.json and the ledger profile, the separate Paper database beside it, never a
market; a bootstrap that fails or is
refused leaves nothing it made; every later start checks the service before serving and first removes
what an interrupted Dolt transfer left; the service collects unreachable chunks by itself; the host
reaches such a service over TCP and never stops it; while it runs it publishes what origin lacks. Throwaway
services only, never the active ledger."""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import pymysql

from ledger import admin, db, publish, server, service, strategies
from shared import profiles
from tests.ledger.dolt import BINARY, SKIP, Service, source
from tests.helpers import refused, tempdir


# A first start of line v9 in its own process, which kills itself at one point: argv is that point, then
# service.start's. Its Dolt server is in the same process group, killed by the test (a container takes it along).
KILLED = """
import os, signal, sys
from pathlib import Path
from ledger import db, publish, service
from shared import profiles

point, service_root, data, backups, credentials, origin, port, binary = sys.argv[1:]
publish.LINE, publish.TAG, db.line_tag = "v9", "line/v9", lambda: "line/v9"
service.LISTEN = "127.0.0.1"


def die():
    os.kill(os.getpid(), signal.SIGKILL)


push, write = publish._push, profiles.private_write


def pushing(cursor, profile, url, ref, force=False):
    if point == ("before main" if force else "before tag"):
        die()
    push(cursor, profile, url, ref, force)
    if force and point == "after main":
        die()


def writing(path, value):
    write(path, value)
    if point == "after profile" and Path(path).name == "research.json":
        die()


publish._push, profiles.private_write = pushing, writing
service.start(Path(service_root), Path(data), Path(backups), Path(credentials), origin, int(port), binary, "isolated")
"""


@unittest.skipUnless(BINARY, SKIP)
class RunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """One source service whose research ledger is published to a file remote's main, with a candidate, and an
        archived line's branch beside it."""
        cls.source = Service()
        try:
            cls.remotes = Path(tempfile.mkdtemp(prefix="or-", dir="/tmp"))
            ledger = cls.source.ledger("research")
            strategies.publish_candidate(ledger, source("cloned"), "cloned", "Fixture", "published before the clone")
            cls.origin = (cls.remotes / "research").as_uri()
            conn = server.connect_root(server.service_config(ledger.service_root), database=ledger.database)
            with conn.cursor() as cursor:
                cursor.execute("CALL DOLT_BRANCH('other-line')")
                cursor.execute("CALL DOLT_CHECKOUT('other-line')")
                cursor.execute("CALL DOLT_COMMIT('--allow-empty', '-m', 'only on another line')")
                cursor.execute("SELECT DOLT_HASHOF('other-line')")
                (cls.other,), = cursor.fetchall()
            conn.close()
            publish.set_remote(ledger, cls.origin)
            cls.published = publish.publish(ledger)["head"]
            conn = server.connect_root(server.service_config(ledger.service_root), database=ledger.database)
            with conn.cursor() as cursor:
                cursor.execute("CALL DOLT_PUSH('origin', 'other-line:v0.0')")
            conn.close()
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.source.close()
        shutil.rmtree(getattr(cls, "remotes", "/nonexistent"), ignore_errors=True)

    def setUp(self):
        self.root = tempdir(self.addCleanup, prefix="sv-", dir="/tmp")
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
        self.port = server.free_port()
        self.log = open(self.root / "server.log", "ab")  # noqa: SIM115 (closed by its owner)
        self.addCleanup(self.log.close)

    def start(self, origin: str | None = None, credentials: Path | None = None, readers: Path | None = None,
              controllers: Path | None = None):
        process, config = service.start(self.service_root, self.data, self.backups,
                                       self.credentials if credentials is None else credentials,
                                       origin or self.origin, self.port, BINARY, "isolated", self.log, readers,
                                       controllers=controllers)
        self.addCleanup(server.stop, process)
        return process, config

    def test_a_first_start_bootstraps_the_ledger_from_its_public_copy(self):
        process, config = self.start()
        written = server.service_config(self.service_root)
        self.assertNotIn("socket", written)
        self.assertTrue(server.managed(written))
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
        research = server.connect_root(config, database="research")
        self.addCleanup(research.close)
        with research.cursor() as cursor:
            cursor.execute("SELECT url FROM dolt_remotes WHERE name = 'origin'")
            self.assertEqual(cursor.fetchall(), ((self.origin,),), "the public copy stays the origin")
        with research.cursor() as cursor:
            cursor.execute("SELECT name FROM dolt_branches ORDER BY name")
            self.assertEqual([name for (name,) in cursor.fetchall()], ["main"], "the line's branch as main, alone")
            cursor.execute("SELECT name FROM dolt_remote_branches ORDER BY name")
            self.assertEqual([name for (name,) in cursor.fetchall()], [publish.TRACKING])
            with self.assertRaises(pymysql.MySQLError, msg="another line's commits are never fetched"):
                cursor.execute("CALL DOLT_BRANCH('probe', %s)", (self.other,))
            cursor.execute("SELECT host FROM mysql.user WHERE user = 'root' ORDER BY host")
            self.assertEqual([host for (host,) in cursor.fetchall()], ["%", "localhost"])
            cursor.execute("SELECT host, permissions FROM dolt_branch_control WHERE user = 'root' ORDER BY host")
            self.assertEqual([tuple(row) for row in cursor.fetchall()], [("%", "admin"), ("localhost", "admin")])
        self.assertEqual(
            (self.service_root / "home" / ".dolt" / "creds" / "k1.jwk").read_bytes(), b'{"key": "fixture"}')
        with db.read_as_of(ledger) as conn:
            self.assertEqual(service.check(ledger), {"action": "check", "running": True,
                                                     "ledger_commit": conn.resolved_commit})
        self.assertEqual(server.start_service(self.service_root)["pid"], None, "the host only waits for it")
        self.assertEqual(refused(server.stop_service, self.service_root).code, "SERVICE_MANAGED")
        self.assertIsNone(process.poll(), "and never stops it")

    def test_every_later_start_checks_the_service_before_serving(self):
        process, _ = self.start()
        server.stop(process)
        process, _ = self.start()
        self.assertIsNone(process.poll(), "a checked service serves")
        server.stop(process)
        config = server.service_config(self.service_root)
        profiles.private_write(self.service_root / "service.json",
                          {**config, "databases": {**config["databases"], "gone": config["databases"]["research"]}})
        self.assertEqual(refused(self.start).code, "SERVICE_CHECK_FAILED")
        profiles.private_write(self.service_root / "service.json", {**config, "socket": str(self.root / "x.sock")})
        self.assertEqual(refused(self.start).code, "SERVICE_CHECK_FAILED", "a service the host runs is not served here")

    def test_a_database_without_its_profile_here_is_not_served_unchecked(self):
        """A moved data directory (#3695): the profile still names the old service directory, so the schema check
        must not pass over its database."""
        def mirror():
            process, _ = service.start(self.service_root, self.data, self.backups, None, self.origin, self.port,
                                       BINARY, None, self.log)
            self.addCleanup(server.stop, process)
            return process

        process = mirror()
        conn = server.connect_root(server.service_config(self.service_root), database="research")
        try:
            with conn.cursor() as cursor:
                cursor.execute("UPDATE ledger_schema SET version = 99")
                cursor.execute("CALL DOLT_COMMIT('-Am', 'another schema', '--skip-verification')")
        finally:
            conn.close()
        server.stop(process)
        self.assertEqual(refused(mirror).code, "SERVICE_CHECK_FAILED", "control: its profile names this directory")
        path = profiles.home() / "research.json"
        stored = json.loads(path.read_text(encoding="utf-8"))
        profiles.private_write(path, {**stored, "service": str(self.root / "old" / "s")})
        self.assertEqual(refused(mirror).code, "SERVICE_CHECK_FAILED", "its profile names the old directory")
        path.unlink()
        self.assertEqual(refused(mirror).code, "SERVICE_CHECK_FAILED", "it has no profile")

    def test_disk_dolt_no_longer_needs_is_reclaimed(self):
        process, config = self.start()
        server.stop(process)
        left = self.data / ".dolt" / "tmp" / "buffered_file_byte_sink_1974208896"
        left.parent.mkdir(parents=True, exist_ok=True)
        left.write_bytes(b"x" * 4096)
        ledger = db.load_profile("research")
        self.start()
        self.assertFalse(left.exists(), "a later start removes what an interrupted transfer left")
        self.assertTrue(left.parent.is_dir())
        with db.read_as_of(ledger) as conn:
            self.assertEqual(conn.rows("SELECT strategy_id FROM candidate"), [("cloned",)], "the ledger is untouched")
        conn = server.connect_root(config)
        self.addCleanup(conn.close)
        with conn.cursor() as cursor:
            cursor.execute("SELECT @@GLOBAL.dolt_auto_gc_enabled")
            self.assertEqual(cursor.fetchall(), ((1,),), "the service collects unreachable chunks by itself")

    def test_the_reader_only_service_file_reads_and_holds_nothing_that_writes(self):
        readers = self.root / "readers"
        process, config = self.start(readers=readers)
        written = json.loads((readers / "service.json").read_text(encoding="utf-8"))
        self.assertEqual(written, {"port": self.port, "databases": {
            name: {"reader": accounts["reader"]} for name, accounts in config["databases"].items()}})
        self.assertEqual(sorted(written["databases"]), ["paper", "research"])
        ledger = db.LedgerProfile(name="research", database="research", service_root=readers, kind=None)
        with db.read_as_of(ledger) as conn:
            self.assertEqual(conn.rows("SELECT strategy_id FROM candidate"), [("cloned",)])
        self.assertEqual(refused(db.connect, ledger, "writer").code, "LEDGER_UNKNOWN")
        for administrator in (server.admin, lambda profile: admin.sync_backup(profile, self.root / "backup", "")):
            self.assertEqual(refused(administrator, ledger).code, "LEDGER_UNKNOWN", "nor the service administrator")
        with db.read_as_of(ledger) as conn:
            for statement in (f"SELECT strategy_id FROM candidate INTO OUTFILE '{self.root / 'cloned.txt'}'",
                              f"SELECT LOAD_FILE('{self.service_root / 'service.json'}')"):
                with self.subTest(statement=statement), self.assertRaises(pymysql.MySQLError), \
                        conn.raw.cursor() as cursor:
                    cursor.execute(statement)
        self.assertFalse((self.root / "cloned.txt").exists(), "nor a server file")
        server.stop(process)
        (readers / "service.json").unlink()
        self.start(readers=readers)
        self.assertEqual(json.loads((readers / "service.json").read_text(encoding="utf-8")), written,
                         "every later start writes it again")

    def test_the_paper_controller_files_hold_paper_accounts_and_the_research_reader_only(self):
        """Item 8: the paper container mounts this directory, never the service directory."""
        controllers = self.root / "controllers"
        process, config = self.start(controllers=controllers)
        written = json.loads((controllers / "service.json").read_text(encoding="utf-8"))
        self.assertEqual(written, {"port": self.port, "databases": {
            "research": {"reader": config["databases"]["research"]["reader"]}, "paper": config["databases"]["paper"]}})
        self.assertTrue((controllers / "paper").is_dir(), "the mountpoint of the writable run directory")
        self.assertEqual(sorted(path.name for path in controllers.iterdir()),
                         ["paper", "paper.json", "research.json", "service.json"])
        research = db.LedgerProfile(name="research", database="research", service_root=controllers, kind=None)
        with db.read_as_of(research) as conn:
            self.assertEqual(conn.rows("SELECT strategy_id FROM candidate"), [("cloned",)])
        self.assertEqual(refused(db.connect, research, "writer").code, "LEDGER_UNKNOWN")
        for administrator in (server.admin, lambda profile: admin.sync_backup(profile, self.root / "backup", "")):
            self.assertEqual(refused(administrator, research).code, "LEDGER_UNKNOWN", "nor the service administrator")
        execution = db.LedgerProfile(name="paper", database="paper", service_root=controllers, kind="isolated",
                                     holds="paper")
        with db.connect(execution, "writer") as conn:
            self.assertEqual(conn.role, "writer")
        server.stop(process)
        self.assertEqual(refused(self.start, controllers=self.service_root).code, "USAGE_ERROR")

    def test_readers_never_replace_the_service_file(self):
        process, _ = self.start()
        server.stop(process)
        before = (self.service_root / "service.json").read_bytes()
        self.assertEqual(refused(self.start, readers=self.service_root).code, "USAGE_ERROR")
        self.assertEqual((self.service_root / "service.json").read_bytes(), before)

    def test_a_bootstrap_refused_or_failed_leaves_nothing_it_made(self):
        self.data.mkdir()
        (self.data / "keep").write_text("someone's", encoding="utf-8")
        self.assertEqual(refused(self.start).code, "BOOTSTRAP_REFUSED")
        self.assertEqual([path.name for path in self.data.iterdir()], ["keep"], "nothing was touched")
        self.assertFalse(self.service_root.exists())
        (self.data / "keep").unlink()
        self.assertEqual(refused(self.start, credentials=self.root / "none").code, "DOLTHUB_CREDENTIALS")
        self.assertFalse(self.service_root.exists(), "the key is checked before anything is made")
        (self.service_root / "paper").mkdir(parents=True)  # compose's mount of the paper run directory
        not_a_copy = self.root / "not-a-copy"
        not_a_copy.write_text("not a Dolt remote", encoding="utf-8")
        self.assertEqual(refused(self.start, origin=not_a_copy.as_uri()).code, "BOOTSTRAP_FAILED")
        self.assertEqual([path.name for path in self.service_root.iterdir()], ["paper"],
                         "an empty directory counts as empty and stays")
        self.assertEqual(list(self.data.iterdir()), [])
        self.assertEqual(list(profiles.home().glob("*.json")), [])
        process, _ = self.start()
        self.assertIsNone(process.poll(), "the next start bootstraps again")

    def copy(self, name: str) -> Path:
        origin = self.remotes / f"{name}-{self.port}"
        shutil.copytree(self.remotes / "research", origin)
        self.addCleanup(shutil.rmtree, origin, True)
        return origin

    def remote(self, origin: Path) -> dict:
        """The branches (name: head) and tags (name: commit) of file remote `origin`, read from a full clone."""
        environment = {**os.environ, "DOLT_ROOT_PATH": str(self.root / "reader"), "DOLT_DISABLE_EVENT_FLUSH": "true"}
        server.dolt_home(self.root / "reader", {"user.name": "reader", "user.email": "reader@example.invalid"})
        copy = self.root / f"read-{len(list(self.root.glob('read-*')))}"
        subprocess.run([BINARY, "clone", origin.as_uri(), str(copy)], env=environment, check=True, capture_output=True)

        def rows(statement: str) -> dict:
            found = subprocess.run([BINARY, "sql", "-r", "csv", "-q", statement], cwd=copy, env=environment,
                                   check=True, capture_output=True, text=True).stdout.split()[1:]
            return dict(line.split(",") for line in found)

        return {"branches": {name.removeprefix("remotes/origin/"): head for name, head in rows(
                    "SELECT name, hash FROM dolt_remote_branches").items()},
                "tags": rows("SELECT tag_name, tag_hash FROM dolt_tags")}

    def later(self, line: str = "v9"):
        """This code as a version of `line`: the ledgers it makes carry that line's tag."""
        patches = [patch.object(publish, "LINE", line), patch.object(publish, "TAG", f"line/{line}"),
                   patch.object(db, "line_tag", return_value=f"line/{line}")]
        for each in patches:
            each.start()
            self.addCleanup(each.stop)

    def test_a_later_line_archives_main_under_the_old_line_and_takes_main_in_its_place(self):
        origin = self.copy("bump")
        before = self.remote(origin)
        self.assertEqual(before["branches"], {"main": self.published, "v0.0": self.other})
        self.assertIn(db.line_tag(), before["tags"], "a ledger carries its line's tag from its first commit")
        self.later()
        self.assertEqual(refused(service.start, self.service_root, self.data, self.backups, None, origin.as_uri(),
                                 self.port, BINARY, None, self.log).code, "BOOTSTRAP_FAILED",
                         "a mirror never makes a ledger")
        self.assertEqual(self.remote(origin)["branches"], before["branches"], "and changes nothing")
        process, _ = self.start(origin=origin.as_uri())
        profile = db.load_profile("research")
        with db.read_as_of(profile) as conn:
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM candidate"), [(0,)], "a new, empty ledger")
            head = conn.resolved_commit
        self.assertFalse(publish.unpublished(profile))
        self.assertEqual(publish.where(profile) | {"remote": None}, {"remote": None, "head": head, "tracked": ["main"],
                                                                     "line": "v9"})
        after = self.remote(origin)
        old = before["tags"]
        self.assertEqual(after["branches"], {"main": head, "v0.0": self.other,
                                             publish.line(publish.product_version()): self.published},
                         "the old line's main is kept as its branch; main is the new ledger")
        self.assertEqual(set(after["tags"]), {*old, "line/v9"})
        server.stop(process)
        # A later start publishes on main without force, and the archive stays as it is.
        process, _ = self.start(origin=origin.as_uri())
        strategies.publish_candidate(profile, source("new-line"), "new-line", "Fixture", "on the new line")
        published = publish.publish(profile)["head"]
        self.assertEqual(self.remote(origin)["branches"][publish.line(publish.product_version())], self.published)
        self.assertEqual(self.remote(origin)["branches"]["main"], published)

    def came_up(self, origin: Path) -> None:
        """A first start brings up a ledger of line v9 that is `main` of `origin`, with the old line's main archived."""
        process, _ = self.start(origin=origin.as_uri())
        profile = db.load_profile("research")
        with db.read_as_of(profile) as conn:
            head = conn.resolved_commit
        self.assertEqual(publish.publish(profile)["head"], head)
        self.assertEqual(self.remote(origin)["branches"], {
            "main": head, "v0.0": self.other, publish.line(publish.product_version()): self.published})
        server.stop(process)

    def test_a_later_line_killed_midway_is_never_served_and_comes_up_once_emptied(self):
        """Killed around its push, a first start left service.json and a profile: later starts then served a ledger
        that could never publish."""
        self.later()
        for point in ("before tag", "before main", "after main", "after profile"):
            with self.subTest(killed=point):
                origin = self.copy(point.replace(" ", "-"))
                child = subprocess.Popen(
                    [sys.executable, "-c", KILLED, point, *map(str, (
                        self.service_root, self.data, self.backups, self.credentials, origin.as_uri(), self.port,
                        BINARY))], start_new_session=True, stdout=self.log, stderr=self.log,
                    cwd=Path(service.__file__).parents[1])
                try:
                    child.wait(120)
                finally:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
                self.assertEqual(child.returncode, -signal.SIGKILL, "it got to that point")
                after = self.remote(origin)["branches"]
                self.assertEqual(after[publish.line(publish.product_version())], self.published, "archived first")
                self.assertEqual(after["main"] != self.published, point.startswith("after"))
                self.assertFalse((self.service_root / "service.json").exists())
                self.assertEqual(refused(self.start, origin=origin.as_uri()).code, "BOOTSTRAP_REFUSED")
                self.assertEqual(self.remote(origin)["branches"], after, "refused before anything is pushed")
                self.reset()
                self.came_up(origin)
                if point.startswith("after"):
                    self.assertEqual(self.remote(origin)["branches"]["main"], after["main"], "fetched, not made again")
                self.reset()

    def reset(self) -> None:
        """The documented reset (deploy/README.md, First start)."""
        for directory in (self.service_root, self.data, profiles.home()):
            shutil.rmtree(directory, True)  # a killed start may not have made it

    def test_a_later_line_whose_push_fails_is_not_healthy_meanwhile_and_the_next_start_resumes(self):
        self.later()
        push = publish._push
        for point in ("tag", "main", "after main"):
            with self.subTest(failed=point):
                origin = self.copy(f"failing-{point.replace(' ', '-')}")

                def failing(cursor, profile, url, ref, force=False):
                    self.assertEqual(refused(db.load_profile, "research").code, "LEDGER_UNKNOWN", "check fails")
                    self.assertFalse((self.service_root / "service.json").exists())
                    if point == "after main" or (point == "main" and not force):
                        push(cursor, profile, url, ref, force)
                    if point == "tag" or force:
                        raise publish.refuse("PUBLISH_FAILED", "the network is gone")

                with patch.object(publish, "_push", failing):
                    self.assertEqual(refused(self.start, origin=origin.as_uri()).code, "PUBLISH_FAILED")
                self.assertEqual(list(self.data.iterdir()), [])
                self.came_up(origin)
                self.reset()

    def test_a_mirror_of_a_replaced_main_holds_the_new_line_alone(self):
        origin = self.copy("fresh")
        self.later()
        first, _ = self.start(origin=origin.as_uri())
        server.stop(first)
        mirror = self.root / "mirror"
        with patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(mirror / "profiles")}):
            process, config = service.start(mirror / "s", mirror / "data", mirror / "backups", None, origin.as_uri(),
                                            server.free_port(), BINARY, None, self.log)
        self.addCleanup(server.stop, process)
        conn = server.connect_root(config, database="research")
        self.addCleanup(conn.close)
        with conn.cursor() as cursor:
            cursor.execute("SELECT name FROM dolt_remote_branches")
            self.assertEqual([name for (name,) in cursor.fetchall()], [publish.TRACKING], "main alone")
            cursor.execute("SELECT tag_name FROM dolt_tags")
            self.assertEqual([name for (name,) in cursor.fetchall()], ["line/v9"], "only its own line's tag")
            cursor.execute("SELECT COUNT(*) FROM candidate")
            self.assertEqual(cursor.fetchall(), ((0,),))
            for commit in (self.published, self.other):
                with self.assertRaises(pymysql.MySQLError, msg="no archived line's commits are fetched"):
                    cursor.execute("CALL DOLT_BRANCH('probe', %s)", (commit,))

    def test_an_archive_branch_holding_other_history_stops_the_new_line_before_main_changes(self):
        origin = self.copy("diverged")
        environment = {**os.environ, "DOLT_ROOT_PATH": str(self.root / "pusher"), "DOLT_DISABLE_EVENT_FLUSH": "true"}
        server.dolt_home(self.root / "pusher", {"user.name": "pusher", "user.email": "pusher@example.invalid"})
        work = self.root / "pusher-copy"
        subprocess.run([BINARY, "clone", origin.as_uri(), str(work)], env=environment, check=True, capture_output=True)
        old_line = publish.line(publish.product_version())
        subprocess.run([BINARY, "push", "origin", f"{self.other}:{old_line}"], cwd=work, env=environment, check=True,
                       capture_output=True)
        before = self.remote(origin)["branches"]
        self.later()
        caught = refused(self.start, origin=origin.as_uri())
        self.assertEqual(caught.code, "BOOTSTRAP_FAILED")
        self.assertEqual(self.remote(origin)["branches"], before, "main is not replaced; the archive is not rewritten")
        self.assertEqual(list(self.data.iterdir()), [], "nothing is kept")

    def test_main_of_another_or_no_line_is_never_replaced(self):
        origin = self.copy("guard")
        before = self.remote(origin)["branches"]
        self.later("v0.0")  # main holds a later line than this code's
        self.assertEqual(refused(self.start, origin=origin.as_uri()).code, "BOOTSTRAP_FAILED")
        self.assertEqual(self.remote(origin)["branches"], before)
        self.assertEqual(list(self.data.iterdir()), [], "nothing is kept")

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
        process, _ = self.start(origin=origin.as_uri())
        answers = []
        with patch.object(service, "start", return_value=(process, {})), patch.object(service, "PUBLISH_RETRY", 0.05), \
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
            server.stop(process)
            running.join(60)
        self.assertTrue(caught_up, "the service published it")
        self.assertEqual(answers[0][1], 0, "the retry does not hold up the service's exit")

    def test_the_paper_backup_follows_paper_s_head(self):
        """U2: Paper's containers hold no administrator, so the service syncs Paper's backup when its head moves."""
        _, config = self.start()
        execution = db.load_profile("paper")
        target = admin.backup_path(execution)
        synced: dict = {}

        def head():
            with db.read_as_of(execution) as conn:
                return db.head_commit(conn)

        service._back_up_paper(synced)
        self.assertEqual(admin.backup_head(target), head())
        conn = server.connect_root(config, database="paper")
        with conn.cursor() as cursor:
            cursor.execute("CALL DOLT_COMMIT('--allow-empty', '-m', 'a stop')")
        conn.close()
        self.assertNotEqual(admin.backup_head(target), head())
        with patch.object(admin, "sync_backup", wraps=admin.sync_backup) as syncing:
            service._back_up_paper(synced)
            self.assertEqual(admin.backup_head(target), head(), "the moved head is copied")
            service._back_up_paper(synced)
        self.assertEqual(syncing.call_count, 1, "an unchanged head is not synced again")

    def test_a_first_paper_backup_that_failed_partway_is_made_again(self):
        self.start()
        execution = db.load_profile("paper")
        target = admin.backup_path(execution)
        with db.read_as_of(execution) as conn:
            head = db.head_commit(conn)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.parent.chmod(0o500)
        failed = refused(admin.sync_backup, execution, target, head)
        target.parent.chmod(0o700)
        self.assertEqual(failed.code, "DOLT_BACKUP")
        self.assertIn("permission denied", failed.message, "the reason Dolt gave")
        # What Dolt leaves when its first sync fails: files, no manifest.
        partial = target.with_name("backup.partial")
        (partial / "oldgen").mkdir(parents=True)
        for path in (partial / "LOCK", partial / "oldgen" / "LOCK"):
            path.touch()
        with patch.object(admin, "backup_head", wraps=admin.backup_head) as reading:
            admin.sync_backup(execution, target, head)
        reading.assert_called_once_with(target)
        self.assertEqual(admin.backup_head(target), head)
        self.assertFalse(partial.exists())

    def test_a_new_ledger_its_copy_refuses_leaves_nothing_it_made(self):
        origin = self.remotes / f"refusing-{self.port}"
        origin.mkdir()
        self.addCleanup(shutil.rmtree, origin, True)
        with patch.object(publish, "_push", side_effect=publish.refuse("PUBLISH_FAILED", "the key cannot write")):
            self.assertEqual(refused(self.start, origin=origin.as_uri()).code, "PUBLISH_FAILED")
        self.assertEqual(list(self.data.iterdir()), [])
        self.assertEqual(list(profiles.home().glob("*.json")), [])
        self.assertFalse((self.service_root / "service.json").exists())

    def test_a_read_only_mirror_never_makes_a_ledger_from_an_empty_copy(self):
        origin = self.remotes / f"mirror-{self.port}"
        origin.mkdir()
        self.addCleanup(shutil.rmtree, origin, True)
        self.assertEqual(refused(service.start, self.service_root, self.data, self.backups, None, origin.as_uri(),
                                 self.port, BINARY, None, self.log).code, "BOOTSTRAP_FAILED")

    def test_a_first_start_without_an_origin_says_what_to_set(self):
        caught = refused(service.start, self.service_root, self.data, self.backups, self.credentials, "", self.port,
                         BINARY, "isolated", self.log)
        self.assertEqual(caught.code, "USAGE_ERROR")
        self.assertIn("TRADE_RESEARCH_ORIGIN", str(caught))

    def test_a_copy_that_is_no_ledger_is_named_as_that(self):
        work = self.root / "unrelated"
        work.mkdir()
        environment = {**os.environ, "DOLT_ROOT_PATH": str(self.root / "copy-home")}
        server.dolt_home(self.root / "copy-home", {"user.name": "elsewhere", "user.email": "elsewhere@example.invalid"})
        for command in (("init",), ("sql", "-q", "CREATE TABLE t (a INT PRIMARY KEY)"), ("add", "."),
                        ("commit", "-m", "another project")):
            subprocess.run([BINARY, *command], cwd=work, env=environment, check=True, capture_output=True)
        other = self.root / "other"
        subprocess.run([BINARY, "remote", "add", "other", other.as_uri()], cwd=work, env=environment, check=True,
                       capture_output=True)
        subprocess.run([BINARY, "push", "other", "main:main"], cwd=work, env=environment, check=True,
                       capture_output=True)
        caught = refused(self.start, origin=other.as_uri())
        self.assertEqual(caught.code, "BOOTSTRAP_FAILED")
        self.assertIn("not a ledger of line", caught.message)
        self.assertEqual(list(self.data.iterdir()), [], "nothing is kept")
        self.assertEqual(list(profiles.home().glob("*.json")), [])

    def test_a_copy_this_code_cannot_read_is_not_bootstrapped(self):
        work = self.root / "copy"
        environment = {**os.environ, "DOLT_ROOT_PATH": str(self.root / "copy-home")}
        server.dolt_home(self.root / "copy-home", {"user.name": "elsewhere", "user.email": "elsewhere@example.invalid"})
        subprocess.run([BINARY, "clone", "--branch", "main", self.origin, str(work)], env=environment, check=True,
                       capture_output=True)
        subprocess.run([BINARY, "sql", "-q", "UPDATE ledger_schema SET version = 99"], cwd=work, env=environment,
                       check=True, capture_output=True)
        subprocess.run([BINARY, "commit", "-Am", "future", "--skip-verification"], cwd=work, env=environment,
                       check=True, capture_output=True)
        newer = self.root / "newer"
        subprocess.run([BINARY, "remote", "add", "newer", newer.as_uri()], cwd=work, env=environment, check=True,
                       capture_output=True)
        for ref in (db.line_tag(), "main:main"):  # a branch push carries no tag
            subprocess.run([BINARY, "push", "newer", ref], cwd=work, env=environment, check=True, capture_output=True)
        self.assertEqual(refused(self.start, origin=newer.as_uri()).code, "SERVICE_CHECK_FAILED")
        self.assertEqual(list(self.data.iterdir()), [], "nothing is kept")
        self.assertEqual(list(profiles.home().glob("*.json")), [])
