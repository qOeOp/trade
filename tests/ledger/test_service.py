"""If this fails, the Dolt service compose runs (`ledger service run`) no longer comes up as it should:
on first start it bootstraps from the public copies (here local file remotes) into empty directories
only, with every branch and tag, root reachable from beyond localhost, the accounts `ledger init` and
`market init` make, a socketless service.json and the two profiles; a bootstrap that fails or is
refused leaves nothing it made; every later start checks the service before serving; the host
reaches such a service over TCP and never stops it. Throwaway services only, never the active ledger."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from cli import main as cli
from cli import service
from ledger import admin, db, publish
from ledger.errors import Refusal
from market import store
from tests.ledger.dolt import BINARY, SKIP, Service
from tests.market.dolt import TemporaryMarket, seed


@unittest.skipUnless(BINARY, SKIP)
class RunTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """One source service whose research ledger and market database are published to file remotes,
        with a tag on the ledger and a second branch on the market."""
        cls.source = TemporaryMarket("market_src")
        try:
            cls.remotes = Path(tempfile.mkdtemp(prefix="or-", dir="/tmp"))
            seed(cls.source.profile, month="2026-01", through="2026-01-28", terms=[], bars={})
            ledger, market = cls.source.ledger, db.LedgerProfile.from_json(cls.source.profile)
            cls.origins = {service.LEDGER: (cls.remotes / "research").as_uri(),
                           service.MARKET: (cls.remotes / "market").as_uri()}
            cls.source.admin(cls.source.profile, "CALL DOLT_BRANCH('legacy-x')")
            conn = db._admin(db._service(ledger.service_root), database=ledger.database)
            with conn.cursor() as cursor:
                cursor.execute("CALL DOLT_TAG('t1', 'main')")
            conn.close()
            for profile, name in ((ledger, service.LEDGER), (market, service.MARKET)):
                publish.set_remote(profile, cls.origins[name])
                publish.publish(profile, "main")
            cls.source.admin(cls.source.profile, "CALL DOLT_PUSH('origin', 'legacy-x')")
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
        self.log = open(self.root / "server.log", "ab")  # noqa: SIM115
        self.addCleanup(self.log.close)

    def start(self, origins: dict | None = None, credentials: Path | None = None, readers: Path | None = None):
        server, config = service.start(self.service_root, self.data, self.backups,
                                       self.credentials if credentials is None else credentials,
                                       self.origins if origins is None else origins, self.port, BINARY, "isolated",
                                       self.log, readers)
        self.addCleanup(service._stop, server)
        return server, config

    def code(self, function, *arguments, **options) -> str:
        with self.assertRaises(Refusal) as caught:
            function(*arguments, **options)
        return caught.exception.code

    def test_a_first_start_bootstraps_both_databases_from_their_public_copies(self):
        server, config = self.start()
        written = db._service(self.service_root)
        self.assertNotIn("socket", written)
        self.assertTrue(db.managed(written))
        self.assertEqual(written["port"], self.port)
        self.assertEqual(sorted(written["databases"]), ["market", "research"])
        ledger = db.load_profile("research")
        market = cli.market_profile("market")
        self.assertEqual((ledger.database, ledger.kind, ledger.backup_root), ("research", "isolated",
                                                                             self.backups / "research"))
        with db.connect(ledger, "writer") as conn:
            self.assertIsNone(conn.raw.unix_socket, "the host reaches a service compose runs over TCP")
        with db.read_as_of(ledger) as conn:
            self.assertEqual(conn.rows("SELECT tag_name FROM dolt_tags"), [("t1",)], "tags come with the clone")
        research = db._admin(config, database="research")
        self.addCleanup(research.close)
        with research.cursor() as cursor:
            cursor.execute("SELECT url FROM dolt_remotes WHERE name = 'origin'")
            self.assertEqual(cursor.fetchall(), ((self.origins[service.LEDGER],),), "the public copy stays the origin")
        with store.connect(market, "import") as conn:
            self.assertEqual(conn.version, store.SCHEMA_VERSION)
        admin = db._admin(config, database="market")
        self.addCleanup(admin.close)
        with admin.cursor() as cursor:
            cursor.execute("SELECT name FROM dolt_branches ORDER BY name")
            self.assertEqual([name for (name,) in cursor.fetchall()], ["legacy-x", "main"],
                             "every remote branch becomes a local one")
            cursor.execute("SELECT host FROM mysql.user WHERE user = 'root' ORDER BY host")
            self.assertEqual([host for (host,) in cursor.fetchall()], ["%", "localhost"])
            cursor.execute("SELECT host, permissions FROM dolt_branch_control WHERE user = 'root' ORDER BY host")
            self.assertEqual([tuple(row) for row in cursor.fetchall()], [("%", "admin"), ("localhost", "admin")])
        self.assertEqual(
            (self.service_root / "home" / ".dolt" / "creds" / "k1.jwk").read_bytes(), b'{"key": "fixture"}')
        checked = service.check(ledger, market)
        self.assertEqual(checked["market_schema"], store.SCHEMA_VERSION)
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
        db._private_write(self.service_root / "service.json",
                          {**config, "databases": {**config["databases"], "gone": config["databases"]["market"]}})
        self.assertEqual(self.code(self.start), "SERVICE_CHECK_FAILED")
        db._private_write(self.service_root / "service.json", {**config, "socket": str(self.root / "x.sock")})
        self.assertEqual(self.code(self.start), "SERVICE_CHECK_FAILED", "a service the host runs is not served here")

    def test_the_reader_only_service_file_reads_and_holds_nothing_that_writes(self):
        readers = self.root / "readers"
        server, config = self.start(readers=readers)
        written = json.loads((readers / "service.json").read_text(encoding="utf-8"))
        self.assertEqual(written, {"port": self.port, "databases": {
            name: {"reader": accounts["reader"]} for name, accounts in config["databases"].items()}})
        self.assertEqual(sorted(written["databases"]), ["market", "research"])
        ledger = db.LedgerProfile(name="research", database="research", service_root=readers, kind=None)
        market = {"name": "market", "kind": "market", "database": "market", "service": str(readers)}
        with db.read_as_of(ledger) as conn:
            self.assertEqual(conn.rows("SELECT tag_name FROM dolt_tags"), [("t1",)])
        with store.connect(market, "reader") as conn:
            self.assertEqual(conn.version, store.SCHEMA_VERSION)
        self.assertEqual(self.code(db.connect, ledger, "writer"), "LEDGER_UNKNOWN")
        for administrator in (admin._admin, publish._admin):
            self.assertEqual(self.code(administrator, ledger), "LEDGER_UNKNOWN", "nor the service administrator")
        with self.assertRaises(store.MarketError) as caught:
            store.connect(market, "import")
        self.assertEqual(caught.exception.code, "MARKET_UNREACHABLE")
        service._stop(server)
        (readers / "service.json").unlink()
        self.start(readers=readers)
        self.assertEqual(json.loads((readers / "service.json").read_text(encoding="utf-8")), written,
                         "every later start writes it again")

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
        missing = {**self.origins, service.MARKET: (self.remotes / "missing").as_uri()}
        self.assertEqual(self.code(self.start, origins=missing), "BOOTSTRAP_FAILED")
        self.assertEqual([path.name for path in self.service_root.iterdir()], ["paper"],
                         "an empty directory counts as empty and stays")
        self.assertEqual(list(self.data.iterdir()), [])
        self.assertEqual(list(db.home().glob("*.json")), [])
        server, _ = self.start()
        self.assertIsNone(server.poll(), "the next start bootstraps again")

    def test_a_copy_this_code_cannot_read_is_not_bootstrapped(self):
        work = self.root / "copy"
        environment = {**os.environ, "DOLT_ROOT_PATH": str(self.root / "copy-home")}
        for setting in (("user.name", "elsewhere"), ("user.email", "elsewhere@example.invalid")):
            subprocess.run([BINARY, "config", "--global", "--add", *setting], env=environment, check=True,
                           capture_output=True)
        subprocess.run([BINARY, "clone", self.origins[service.LEDGER], str(work)], env=environment, check=True,
                       capture_output=True)
        subprocess.run([BINARY, "sql", "-q", "UPDATE ledger_schema SET version = 99"], cwd=work, env=environment,
                       check=True, capture_output=True)
        subprocess.run([BINARY, "commit", "-Am", "future", "--skip-verification"], cwd=work, env=environment,
                       check=True, capture_output=True)
        newer = self.root / "newer"
        subprocess.run([BINARY, "remote", "add", "newer", newer.as_uri()], cwd=work, env=environment, check=True,
                       capture_output=True)
        subprocess.run([BINARY, "push", "newer", "main"], cwd=work, env=environment, check=True, capture_output=True)
        origins = {**self.origins, service.LEDGER: newer.as_uri()}
        self.assertEqual(self.code(self.start, origins=origins), "SERVICE_CHECK_FAILED")
        self.assertEqual(list(self.data.iterdir()), [], "nothing is kept")
        self.assertEqual(list(db.home().glob("*.json")), [])


@unittest.skipUnless(BINARY, SKIP)
class TakeoverTests(unittest.TestCase):
    def test_a_service_the_host_ran_is_taken_over_in_place(self):
        """The switch-over: the host's service, stopped, its socket dropped from service.json, served by
        `ledger service run` on its own data with root then reachable from beyond localhost."""
        existing = Service()
        self.addCleanup(existing.close)
        profile = existing.ledger("research")
        root = existing.service_root
        # After the server stops: Service.close stops only a service this host runs.
        self.addCleanup(lambda: (root / "service.json").unlink(missing_ok=True))
        config = db._service(root)
        db.stop_service(root)
        db._private_write(root / "service.json", {key: value for key, value in config.items() if key != "socket"})
        listen = patch.object(service, "LISTEN", "127.0.0.1")
        listen.start()
        self.addCleanup(listen.stop)
        with open(existing.root / "server.log", "ab") as log:
            server, _ = service.start(root, root / "data", existing.root / "backups", None, {}, config["port"], BINARY,
                                      "isolated", log)
        self.addCleanup(service._stop, server)
        with db.read_as_of(profile) as conn:
            self.assertEqual(conn.rows("SELECT version FROM ledger_schema"), [(db.SCHEMA_VERSION,)])
        admin = db._admin(db._service(root), database=profile.database)
        self.addCleanup(admin.close)
        with admin.cursor() as cursor:
            cursor.execute("SELECT host FROM mysql.user WHERE user = 'root' ORDER BY host")
            self.assertEqual([host for (host,) in cursor.fetchall()], ["%", "localhost"])
            cursor.execute("SELECT permissions FROM dolt_branch_control WHERE user = 'root' AND host = '%'")
            self.assertEqual(cursor.fetchall(), (("admin",),))


if __name__ == "__main__":
    unittest.main()
