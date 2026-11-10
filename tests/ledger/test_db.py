"""Ledger base on a throwaway Dolt 2.7.2 service: init, accounts, connections, pinned reads, writes."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import json
from pathlib import Path
import shutil
import socket
import stat
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import pymysql

from ledger import db
from shared import paths, profiles as profile_directory
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service


def bundle_insert(name: str, wait=None):
    def insert(conn, op):
        conn.rows("INSERT INTO evidence_bundle (bundle, kind, op_id, created_at) VALUES (%s, 'agent', %s, '2000-01-01')",
                  (name, op))
        conn.rows("INSERT INTO evidence_content (content) VALUES (%s)", (name.encode(),))
        conn.rows("INSERT INTO evidence (bundle, path, sha256) VALUES (%s, 'a.txt', %s)",
                  (name, hashlib.sha256(name.encode()).hexdigest()))
        if wait is not None:
            wait()
        return {"bundle": name}
    return insert


def trial_insert(conn, op, purpose="explore", source_sha256="e" * 64) -> int:
    """A trial row written directly (ledger.open_trial derives these columns from a coverage receipt)."""
    conn.rows("INSERT INTO trial (purpose, source_sha256, image_ref, runtime_contract, platform, market_commit, "
              "universe_rule, export_sha256, comparable_config_sha256, execution, starting_balance, input_start, "
              "trade_start, trade_end, runner_argv, op_id) VALUES (%s, %s, %s, 'replay-contract@v7', 'linux/arm64', "
              "%s, 'pool-v1', %s, %s, 'bars', 100000, '2026-01-01', '2026-01-02', '2026-02-01', '[]', %s)",
              (purpose, source_sha256, "img@sha256:" + "a" * 64, "m" * 32, "e" * 64, "c" * 64, op))
    (trial_id,), = conn.rows("SELECT LAST_INSERT_ID()")
    return trial_id


@unittest.skipUnless(BINARY, SKIP)
class DoltBinaryTests(unittest.TestCase):
    """No Dolt: stand-in executables."""

    def executable(self, body: str) -> Path:
        directory = Path(tempfile.mkdtemp(prefix="dolt-standin-"))
        self.addCleanup(shutil.rmtree, directory, True)
        path = directory / "dolt"
        path.write_text("#!/bin/sh\n" + body, encoding="utf-8")
        path.chmod(0o755)
        return path

    def test_a_failing_version_check_is_refused_with_its_exit_code_and_stderr(self):
        binary = self.executable("echo 'Failed to load the global config.' >&2\nexit 1\n")
        with self.assertRaises(Refusal) as caught:
            db._binary(binary)
        self.assertEqual(caught.exception.code, "DOLT_BINARY")
        self.assertIn("exit 1: Failed to load the global config.", caught.exception.message)

    def test_the_version_check_runs_in_its_own_quiet_home_and_directory_and_removes_them(self):
        binary = self.executable(f"""[ "$(pwd -P)" = "$(cd "$DOLT_ROOT_PATH" && pwd -P)" ] || exit 3
[ "$DOLT_DISABLE_EVENT_FLUSH" = true ] || exit 4
grep -q '"versioncheck.disabled": "true"' "$DOLT_ROOT_PATH/.dolt/config_global.json" || exit 5
grep -q '"metrics.disabled": "true"' "$DOLT_ROOT_PATH/.dolt/config_global.json" || exit 6
echo "$DOLT_ROOT_PATH" > "$(dirname "$0")/home"
echo 'dolt version {db.DOLT_VERSION}'
""")
        self.assertEqual(db._binary(binary), str(binary.resolve()))
        home = Path((binary.parent / "home").read_text(encoding="utf-8").strip())
        self.assertNotEqual(home, Path.home())
        self.assertFalse(home.exists())


class LedgerBaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.addClassCleanup(cls.service.close)
        cls.profile = cls.service.ledger("base")

    def code(self, call) -> str:
        with self.assertRaises(Refusal) as caught:
            call()
        return caught.exception.code

    def seq(self, profile=None) -> int:
        return self.service.sql(profile or self.profile, "SELECT seq FROM ledger_head")[0][0]

    # init

    def test_init_creates_the_whole_schema_its_guards_and_private_accounts(self):
        profile = self.service.ledger("fresh")
        tables = {name for name, _ in self.service.sql(profile, "SHOW FULL TABLES")}
        created = {statement.split()[2] for statement in db._statements(db.SCHEMA.read_text(encoding="utf-8"))
                   if statement.startswith("CREATE TABLE")}
        self.assertLessEqual({"trial", "run", "run_reading", "research_registration", "line_close"}, created)
        self.assertLessEqual(created, tables)
        triggers = {name for (name,) in self.service.sql(profile, "SELECT trigger_name FROM "
                                                                  "information_schema.triggers")}
        self.assertLessEqual({"trial_created", "run_sealed", "run_reading_recomputed"}, triggers)
        self.assertEqual(self.service.sql(profile, "SELECT version FROM ledger_schema"), [(db.SCHEMA_VERSION,)])
        self.assertEqual(self.service.sql(profile, "SELECT singleton, op_id FROM ledger_head")[0], (1, "schema"))
        for path in (self.service.home / "fresh.json", profile.service_root / "service.json"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600, path)
        with db.connect(profile, "reader") as conn:
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM dolt_status"), [(0,)])

    def test_init_result_holds_no_password(self):
        result = db.init("nopass", "test_nopass", self.profile.service_root, "isolated", dolt_binary=BINARY)
        config = db._service(self.profile.service_root)
        secrets = {config["root_password"], *(item["password"] for item in config["databases"]["test_nopass"].values())}
        dumped = json.dumps(result, default=str) + json.dumps(db.load_profile("nopass").as_json())
        self.assertFalse(any(secret in dumped for secret in secrets))

    def test_long_database_names_have_distinct_private_accounts(self):
        profiles = [db.init(f"long-{suffix}", "x" * 63 + suffix, self.profile.service_root, "isolated",
                            dolt_binary=BINARY)["profile"] for suffix in ("a", "b")]
        config = db._service(self.profile.service_root)
        names = [config["databases"][profile.database][role]["user"]
                 for profile in profiles for role in db.ROLES]
        self.assertEqual(len(set(names)), 4)
        self.assertTrue(all(len(name) <= 32 for name in names))
        self.assertEqual(config["databases"][self.profile.database]["writer"]["user"],
                         db._account_name(self.profile.database, "writer"))
        for profile, other in ((profiles[0], profiles[1]), (profiles[1], profiles[0])):
            with db.connect(profile, "writer") as writer:
                self.assertEqual(db.write(writer, "probe", {"bundle": "long"}, "evidence_bundle",
                                          bundle_insert("long"))["write_status"], "written")
            for role in db.ROLES:
                with db.connect(profile, role) as conn:
                    self.assertEqual(conn.rows("SELECT version FROM ledger_schema"), [(db.SCHEMA_VERSION,)])
                    with self.assertRaises(Refusal):
                        conn.rows(f"SELECT version FROM `{other.database}`.ledger_schema")

    def test_init_refusals(self):
        for name, database in (("bad name", "ok"), ("ok", "bad-database")):
            with self.subTest(name=name):
                self.assertEqual(self.code(lambda: db.init(name, database, self.profile.service_root, "isolated",
                                                           dolt_binary=BINARY)), "INVALID_NAME")
        self.assertEqual(self.code(lambda: db.init("x", "x", self.profile.service_root, "eternal", dolt_binary=BINARY)),
                         "INVALID_NAME")
        self.assertEqual(self.code(lambda: db.init("base", "other", self.profile.service_root, "isolated",
                                                   dolt_binary=BINARY)), "LEDGER_EXISTS")
        self.assertEqual(self.code(lambda: db.init("again", self.profile.database, self.profile.service_root,
                                                   "isolated", dolt_binary=BINARY)), "LEDGER_EXISTS")
        self.assertEqual(self.code(lambda: db.init("nobin", "nobin", self.profile.service_root, "isolated",
                                                   dolt_binary=Path("/bin/echo"))), "DOLT_BINARY")
        deep = self.service.root / ("d" * 120)
        self.assertEqual(self.code(lambda: db.init("deep", "deep", deep, "isolated", dolt_binary=BINARY)),
                         "LEDGER_START")
        self.assertFalse(deep.exists())

    def test_the_active_ledger_is_unique_and_lives_outside_temporary_roots(self):
        backup = self.service.root / "backup"
        self.assertEqual(self.code(lambda: db.init("live", "live", self.service.root / "live", "active",
                                                   backup_root=backup, dolt_binary=BINARY)), "ISOLATION_BREACH")
        self.assertEqual(self.code(lambda: db.init("live", "live", paths.REPOSITORY / "never-created", "active",
                                                   dolt_binary=BINARY)), "ISOLATION_BREACH")
        self.assertFalse((self.service.root / "live").exists())
        self.assertFalse((paths.REPOSITORY / "never-created").exists())
        active = self.service.home / "prod.json"
        active.write_text(json.dumps({"name": "prod", "kind": "active", "database": "research",
                                      "service": "/nonexistent", "backup": None}))
        self.addCleanup(active.unlink)
        self.assertEqual(self.code(lambda: db.init("copy", "research", self.profile.service_root, "isolated",
                                                   dolt_binary=BINARY)), "ISOLATION_BREACH")
        self.assertEqual(self.code(lambda: db.init("second", "second", paths.REPOSITORY / "never-created", "active",
                                                   backup_root=paths.REPOSITORY / "never-backup", dolt_binary=BINARY)),
                         "LEDGER_EXISTS")

    # connect

    def test_connect_refusals(self):
        self.assertEqual(self.code(lambda: db.connect(self.profile, "admin")), "INVALID_ROLE")
        unknown = db.LedgerProfile(**{**self.profile.__dict__, "database": "test_missing"})
        self.assertEqual(self.code(lambda: db.connect(unknown, "reader")), "LEDGER_UNKNOWN")
        with self.assertRaises(Refusal) as caught:
            db.load_profile("nope")
        self.assertEqual(caught.exception.code, "LEDGER_UNKNOWN")
        stopped = Path(tempfile.mkdtemp(prefix="lgx-", dir="/tmp"))
        self.addCleanup(__import__("shutil").rmtree, stopped, ignore_errors=True)
        config = db._service(self.profile.service_root)
        (stopped / "service.json").write_text(json.dumps({**config, "socket": str(stopped / "none.sock")}))
        self.assertEqual(self.code(lambda: db.connect(db.LedgerProfile(**{**self.profile.__dict__,
                                                                           "service_root": stopped}), "reader")),
                         "LEDGER_UNAVAILABLE")
        wrong = json.loads(json.dumps(config))
        wrong["databases"][self.profile.database]["reader"]["password"] = "wrong"
        (stopped / "service.json").write_text(json.dumps(wrong))
        self.assertEqual(self.code(lambda: db.connect(db.LedgerProfile(**{**self.profile.__dict__,
                                                                           "service_root": stopped}), "reader")),
                         "LEDGER_PERMISSION")
        with patch.dict(db.SCHEMAS, research=(db.SCHEMA, db.SCHEMA_VERSION + 1)):
            self.assertEqual(self.code(lambda: db.connect(self.profile, "reader")), "SCHEMA_MISMATCH")

    def test_statements_keep_their_read_timeout_after_the_short_handshake(self):
        with db.connect(self.profile, "reader") as conn:
            self.assertEqual(conn.raw._read_timeout, 600)
            self.assertEqual(conn.rows("SELECT 1"), [(1,)])
        root = db._admin(db._service(self.profile.service_root))
        self.addCleanup(root.close)
        self.assertIsNone(root._read_timeout)

    def test_the_writer_may_only_insert_and_bump_the_head_on_the_research_branch(self):
        writer = db.connect(self.profile, "writer")
        self.addCleanup(writer.close)
        for statement in ("UPDATE candidate SET description = 'x'", "DELETE FROM evidence_bundle",
                          "REPLACE INTO evidence_bundle (bundle, kind, op_id) VALUES ('b', 'agent', 'o')", "TRUNCATE trial",
                          "DROP TABLE run", "UPDATE ledger_schema SET version = 2", "DELETE FROM ledger_head",
                          "CALL DOLT_RESET('--hard', 'HEAD~1')", "CALL DOLT_TAG('x')", "CALL DOLT_BRANCH('x')",
                          "CALL DOLT_CHECKOUT('-b', 'y')", "ALTER TABLE run ADD COLUMN x INT",
                          "DELETE FROM dolt_branch_control"):
            with self.subTest(statement=statement):
                self.assertEqual(self.code(lambda: writer.rows(statement)), "LEDGER_PERMISSION")
        reader = db.connect(self.profile, "reader")
        self.addCleanup(reader.close)
        self.assertEqual(self.code(lambda: reader.rows(
            "INSERT INTO evidence_bundle (bundle, kind, op_id) VALUES ('r', 'agent', 'r')")), "LEDGER_PERMISSION")
        self.service.sql(self.profile, "CALL DOLT_BRANCH('side', 'main')")
        config = db._service(self.profile.service_root)
        account = config["databases"][self.profile.database]["writer"]
        raw = pymysql.connect(unix_socket=config["socket"], user=account["user"], password=account["password"],
                              database=f"{self.profile.database}/side", autocommit=True)
        self.addCleanup(raw.close)
        # evidence_bundle has a BEFORE INSERT trigger, evidence_content none
        for statement in ("INSERT INTO evidence_content (content) VALUES ('s')",
                          "INSERT INTO evidence_bundle (bundle, kind, op_id) VALUES ('s', 'agent', 's')",
                          "CALL DOLT_COMMIT('-a', '-m', 'side')"):
            with self.subTest(branch="side", statement=statement), self.assertRaises(pymysql.MySQLError), \
                    raw.cursor() as cursor:
                cursor.execute(statement)

    def test_no_account_reads_or_writes_a_server_file(self):
        out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, out)
        for role in ("reader", "writer"):
            with db.connect(self.profile, role) as conn:
                for statement in (f"SELECT version FROM ledger_schema INTO OUTFILE '{out / role}.txt'",
                                  f"SELECT version FROM ledger_schema INTO DUMPFILE '{out / role}.bin'",
                                  f"SELECT LOAD_FILE('{self.profile.service_root / 'service.json'}')"):
                    with self.subTest(role=role, statement=statement), self.assertRaises(pymysql.MySQLError), \
                            conn.raw.cursor() as cursor:
                        cursor.execute(statement)
        self.assertEqual(list(out.iterdir()), [])

    def test_the_writer_cannot_overwrite_through_upserts_or_generated_hashes(self):
        with db.connect(self.profile, "writer") as writer:
            db.write(writer, "probe", {"bundle": "upsert"}, "evidence_bundle", bundle_insert("upsert"))
            self.assertEqual(self.code(lambda: writer.rows(
                "INSERT INTO evidence_bundle (bundle, kind, op_id) VALUES ('upsert', 'agent', 'u') "
                "ON DUPLICATE KEY UPDATE op_id = 'hijacked'")), "LEDGER_PERMISSION")

            def forged(statement):
                def insert(conn, op):
                    conn.rows("INSERT INTO evidence_bundle (bundle, kind, op_id) VALUES ('forged', 'agent', %s)",
                              (op,))
                    conn.rows(statement, ("0" * 64,))
                    return {}
                return insert

            # The ledger derives a content's hash, and a bundle file can only name a stored content.
            for number, statement in enumerate(("INSERT INTO evidence_content (content, sha256) VALUES ('x', %s)",
                                                "INSERT INTO evidence (bundle, path, sha256) VALUES ('forged', 'a', %s)")):
                self.assertEqual(self.code(lambda: db.write(writer, "probe", {"forged": number}, "evidence_bundle",
                                                            forged(statement))), "DOLT_SQL_ERROR")
        (stored,), = self.service.sql(self.profile, "SELECT op_id FROM evidence_bundle WHERE bundle = 'upsert'")
        self.assertTrue(stored.startswith("probe:"))
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM evidence_bundle WHERE bundle = 'forged'"),
                         [(0,)])

    def test_run_rows_keep_reports_and_open_positions_consistent(self):
        with db.connect(self.profile, "writer") as writer:

            def run(failure_reasons, fingerprints, cycle_closed=None, open_unrealized=None):
                def insert(conn, op):
                    trial_id = trial_insert(conn, op)
                    conn.rows("INSERT INTO run (trial_id, failure_reasons, fingerprints, op_id) VALUES (%s, %s, %s, %s)",
                              (trial_id, failure_reasons, fingerprints, op))
                    conn.rows("INSERT INTO run_cycle (trial_id, seq, instrument_id, side, ts_opened_ns, ts_closed_ns, "
                              "realized_pnl, commissions, funding, open_unrealized) VALUES (%s, 1, 'A', 'long', 1, %s, "
                              "0, 0, 0, %s)", (trial_id, cycle_closed, open_unrealized))
                    return {"trial_id": trial_id}
                return db.write(writer, "probe", {"run": [failure_reasons, fingerprints, cycle_closed, open_unrealized]},
                                "trial", insert)

            passed = run(None, '{"orders": 1}', cycle_closed=None, open_unrealized="1.5")
            invalid = run('["A1"]', None, cycle_closed=2)
            for arguments in (('["A1"]', '{"orders": 1}'), (None, None), ('{"code": "A1"}', None),
                              (None, '{"orders": 1}', 2, "1.5")):
                with self.subTest(arguments=arguments):
                    self.assertEqual(self.code(lambda: run(*arguments)), "DOLT_SQL_ERROR")
        statuses = dict(self.service.sql(self.profile, "SELECT trial_id, status FROM run WHERE trial_id IN (%s, %s)",
                                         (passed["record"]["trial_id"], invalid["record"]["trial_id"])))
        self.assertEqual(statuses, {passed["record"]["trial_id"]: "passed", invalid["record"]["trial_id"]: "invalid"})

    # read_as_of

    def test_read_as_of_pins_an_exact_commit_and_reads_its_state(self):
        with db.connect(self.profile, "writer") as writer:
            before = db.head_commit(writer)
            written = db.write(writer, "probe", {"bundle": "pinned"}, "evidence_bundle", bundle_insert("pinned"))
        with db.read_as_of(self.profile, before) as old, db.read_as_of(self.profile) as new:
            self.assertEqual(old.resolved_commit, before)
            self.assertEqual(new.resolved_commit, written["commit"])
            self.assertEqual(old.rows("SELECT COUNT(*) FROM evidence_bundle WHERE bundle = 'pinned'"), [(0,)])
            self.assertEqual(new.rows("SELECT COUNT(*) FROM evidence_bundle WHERE bundle = 'pinned'"), [(1,)])
            self.assertEqual(self.code(lambda: db.write(new, "x", {}, "evidence_bundle", bundle_insert("never"))),
                             "READ_ONLY_CONNECTION")
            self.assertEqual(self.code(lambda: new.rows(
                "INSERT INTO evidence_bundle (bundle, kind, op_id) VALUES ('n', 'agent', 'n')")),
                "LEDGER_PERMISSION")
        with db.read_as_of(self.profile, "main") as branch:
            self.assertEqual(branch.resolved_commit, written["commit"])

    def test_read_as_of_refusals(self):
        for ref in ("", "a;DROP TABLE run", "../x", "x y"):
            with self.subTest(ref=ref):
                self.assertEqual(self.code(lambda: db.read_as_of(self.profile, ref)), "INVALID_REF")
        self.assertEqual(self.code(lambda: db.read_as_of(self.profile, "nosuchbranch")), "UNKNOWN_REF")
        self.assertEqual(self.code(lambda: db.read_as_of(self.profile, "a" * 32)), "UNKNOWN_REF")
        with patch.dict(db.SCHEMAS, research=(db.SCHEMA, db.SCHEMA_VERSION + 1)):
            self.assertEqual(self.code(lambda: db.read_as_of(self.profile)), "SCHEMA_MISMATCH")

    # write

    def test_a_write_is_one_commit_and_a_retry_returns_the_original(self):
        start = self.seq()
        with db.connect(self.profile, "writer") as writer:
            first = db.write(writer, "probe", {"bundle": "once"}, "evidence_bundle", bundle_insert("once"))
            again = db.write(writer, "probe", {"bundle": "once"}, "evidence_bundle", bundle_insert("once"))
        self.assertEqual((first["write_status"], again["write_status"], again["replayed"]),
                         ("written", "replayed", True))
        self.assertEqual((again["commit"], again["op_id"]), (first["commit"], first["op_id"]))
        self.assertEqual(self.seq(), start + 1)
        self.assertEqual(self.service.sql(self.profile, "SELECT op_id FROM ledger_head")[0][0], first["op_id"])
        message, = self.service.sql(self.profile, "SELECT message FROM dolt_log LIMIT 1")[0]
        self.assertEqual(message, f"probe:{first['op_id']}")
        (created,), = self.service.sql(self.profile, "SELECT created_at FROM evidence_bundle WHERE bundle = 'once'")
        self.assertLess(abs(created - datetime.now(UTC).replace(tzinfo=None)), timedelta(minutes=1))

    def test_write_refusals_leave_nothing_behind(self):
        start = self.seq()
        with db.connect(self.profile, "reader") as reader:
            self.assertEqual(self.code(lambda: db.write(reader, "x", {}, "evidence_bundle", bundle_insert("r"))),
                             "READ_ONLY_CONNECTION")
        with db.connect(self.profile, "writer") as writer:

            def unpublished_trial(purpose):
                def insert(conn, op):
                    trial_insert(conn, op, purpose, "f" * 64)
                    return {}
                return insert

            for purpose in ("precheck", "research"):
                with self.subTest(purpose=purpose):
                    self.assertEqual(self.code(lambda: db.write(writer, "probe", {"t": purpose}, "trial",
                                                                unpublished_trial(purpose))), "DOLT_SQL_ERROR")

            def update(conn, op):
                conn.rows("UPDATE candidate SET description = 'edited'")
                return {}

            self.assertEqual(self.code(lambda: db.write(writer, "probe", {"u": 1}, "candidate", update)),
                             "LEDGER_PERMISSION")

            def duplicate(conn, op):
                conn.rows("INSERT INTO ledger_schema VALUES (1, 1)")
                return {}

            self.assertEqual(self.code(lambda: db.write(writer, "probe", {"d": 1}, "evidence_bundle", duplicate)),
                             "DOLT_SQL_ERROR")
            self.assertEqual(writer.rows("SELECT COUNT(*) FROM trial WHERE source_sha256 = %s", ("f" * 64,)), [(0,)])
        self.assertEqual(self.seq(), start)
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM dolt_status"), [(0,)])

    def test_a_dirty_working_set_is_never_committed_under_another_operation(self):
        profile = self.service.ledger("dirty")
        self.service.sql(profile, "INSERT INTO evidence_bundle (bundle, kind, op_id) VALUES ('stray', 'agent', 's')")
        with db.connect(profile, "writer") as writer:
            self.assertEqual(self.code(lambda: db.write(writer, "probe", {"b": 1}, "evidence_bundle",
                                                        bundle_insert("mine"))), "DIRTY_WORKING_SET")
        self.assertEqual(self.seq(profile), 0)

    def test_concurrent_writes_are_refused_not_merged(self):
        barrier, outcomes = threading.Barrier(2), {}

        def race(label):
            with db.connect(self.profile, "writer") as writer:
                try:
                    outcomes[label] = db.write(writer, "race", {"bundle": label}, "evidence_bundle",
                                               bundle_insert(label, lambda: barrier.wait(timeout=20)))["write_status"]
                except Refusal as exc:
                    outcomes[label] = exc.code

        threads = [threading.Thread(target=race, args=(label,)) for label in ("race-a", "race-b")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(outcomes.values()), ["CONCURRENT_WRITE", "written"])
        stored = {name for (name,) in self.service.sql(self.profile, "SELECT bundle FROM evidence_bundle")}
        self.assertEqual(len(stored & {"race-a", "race-b"}), 1)
        loser = next(label for label, value in outcomes.items() if value == "CONCURRENT_WRITE")
        with db.connect(self.profile, "writer") as writer:
            retried = db.write(writer, "race", {"bundle": loser}, "evidence_bundle", bundle_insert(loser))
        self.assertEqual(retried["write_status"], "written")

    def test_a_write_allowed_attempts_reruns_after_a_concurrent_write(self):
        barrier, outcomes, calls = threading.Barrier(2), {}, {"race-c": 0, "race-d": 0}

        def wait_once(label):
            def wait():
                calls[label] += 1
                if calls[label] == 1:
                    barrier.wait(timeout=20)
            return wait

        def race(label):
            with db.connect(self.profile, "writer") as writer:
                outcomes[label] = db.write(writer, "race", {"bundle": label}, "evidence_bundle",
                                           bundle_insert(label, wait_once(label)), attempts=3)["write_status"]

        threads = [threading.Thread(target=race, args=(label,)) for label in calls]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(outcomes, {"race-c": "written", "race-d": "written"})
        self.assertEqual(sorted(calls.values()), [1, 2])
        stored = {name for (name,) in self.service.sql(self.profile, "SELECT bundle FROM evidence_bundle")}
        self.assertLessEqual({"race-c", "race-d"}, stored)


@unittest.skipUnless(BINARY, SKIP)
class OverTcpTests(unittest.TestCase):
    """TRADE_DOLT_HOST: a container that cannot reach the service's socket connects over TCP, to that host on
    the service's own port, with every account the paper daemon's commands use."""

    def test_every_account_reaches_the_service_on_its_own_port(self):
        service = Service()
        self.addCleanup(service.close)
        ledger = service.ledger("research")
        config = db._service(service.service_root)
        with patch.dict("os.environ", {db.DOLT_HOST: "127.0.0.1"}):
            with db.connect(ledger, "writer") as writer:
                self.assertEqual((writer.raw.unix_socket, writer.raw.port), (None, config["port"]))
                db.write(writer, "tcp", {"bundle": "tcp"}, "evidence_bundle", bundle_insert("tcp"))
            with db.connect(ledger, "reader") as reader:
                self.assertEqual(reader.rows("SELECT bundle FROM evidence_bundle"), [("tcp",)])
            root = db._admin(config)
            self.addCleanup(root.close)
            self.assertEqual((root.unix_socket, root.port), (None, config["port"]))
            with root.cursor() as cursor:
                cursor.execute("SELECT CURRENT_USER()")
                self.assertEqual(cursor.fetchone()[0], "root@localhost")


class UnansweredServiceTests(unittest.TestCase):
    """A service that accepts connections but never sends its greeting (stalled by a long write, or a hung
    process, container or Docker host): every connection fails within the handshake timeout, not the 600 s
    statement budget, says the service is running but did not answer rather than not running, and advises one
    rerun before a restart. No Dolt: a listening socket that nobody accepts from is enough."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="lgh-", dir="/tmp"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.accounts = {"probe": {"reader": {"user": "r", "password": "p"}, "writer": {"user": "w", "password": "p"}}}
        self.profile = db.LedgerProfile(name="probe", database="probe", service_root=self.root)
        patcher = patch.object(db, "HANDSHAKE_TIMEOUT", 0.5)
        patcher.start()
        self.addCleanup(patcher.stop)

    def listener(self, family=socket.AF_INET, path: Path | None = None) -> socket.socket:
        server = socket.socket(family, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        server.bind(str(path) if path else ("127.0.0.1", 0))
        server.listen(8)
        return server

    def service(self, **config) -> None:
        (self.root / "service.json").write_text(json.dumps({**config, "root_password": "p", "databases": self.accounts}))

    def refused(self, call) -> tuple[Refusal, float]:
        started = time.monotonic()
        with self.assertRaises(Refusal) as caught:
            call()
        return caught.exception, time.monotonic() - started

    def assert_hung(self, refusal: Refusal, elapsed: float, endpoint: str) -> None:
        self.assertEqual(refusal.code, "LEDGER_UNAVAILABLE")
        self.assertIn(f"the ledger service at {endpoint} accepts connections but did not answer within 0.5 s",
                      refusal.message)
        self.assertNotIn("not running", refusal.message)
        self.assertIn("a long write such as an import can stall it", refusal.message)
        self.assertIn("rerun the same command once after a minute or two", refusal.next_actions[0])
        self.assertIn("a restart rolls back a write in progress", refusal.next_actions[0])
        self.assertIn("docker ps", refusal.next_actions[0])
        self.assertLess(elapsed, 5)

    def test_a_compose_service_that_accepts_but_never_answers_is_reported_hung_at_once(self):
        port = self.listener().getsockname()[1]
        self.service(port=port)
        for role in ("reader", "writer"):
            refusal, elapsed = self.refused(lambda role=role: db.connect(self.profile, role))
            self.assert_hung(refusal, elapsed, f"127.0.0.1:{port}")
        with patch.dict("os.environ", {db.DOLT_HOST: "127.0.0.1"}):
            refusal, elapsed = self.refused(lambda: db.connect(self.profile, "reader"))
        self.assert_hung(refusal, elapsed, f"127.0.0.1:{port}")
        refusal, elapsed = self.refused(lambda: db.start_service(self.root))
        self.assertEqual(refusal.code, "LEDGER_START")
        self.assertIn("accepts connections but did not answer", refusal.message)
        self.assertIn("rerun after a minute or two", refusal.expected)
        self.assertLess(elapsed, 5)

    def test_a_socket_service_that_accepts_but_never_answers_is_reported_hung_at_once(self):
        path = self.root / "mysql.sock"
        self.listener(socket.AF_UNIX, path)
        self.service(socket=str(path), port=0)
        refusal, elapsed = self.refused(lambda: db.connect(self.profile, "reader"))
        self.assert_hung(refusal, elapsed, str(path))

    def test_a_closed_port_is_still_a_service_that_is_not_running(self):
        closed = self.listener()
        port = closed.getsockname()[1]
        closed.close()
        self.service(port=port)
        refusal, _ = self.refused(lambda: db.connect(self.profile, "reader"))
        self.assertEqual(refusal.code, "LEDGER_UNAVAILABLE")
        self.assertIn("not running", refusal.message)


@unittest.skipUnless(BINARY, SKIP)
class InitRecoveryTests(unittest.TestCase):
    """A service per test, so that a failing first init is also the one that secures the service."""

    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)

    def admin(self, statement: str, params=None, database: str | None = None) -> list[tuple]:
        conn = db._admin(db._service(self.service.service_root), database=database)
        try:
            with conn.cursor() as cursor:
                cursor.execute(statement, params)
                return list(cursor.fetchall())
        finally:
            conn.close()

    def left(self, database: str, profile: str) -> dict:
        """What the service, its configuration and the profile directory hold of `database`. The
        service-wide dolt_branch_control is read with a database selected, an empty one of the test's."""
        self.admin("CREATE DATABASE IF NOT EXISTS lookout")
        databases = {name for (name,) in self.admin("SHOW DATABASES")}
        accounts = {db._account_name(database, role) for role in db.ROLES}
        users = {user for (user,) in self.admin("SELECT user FROM mysql.user") if user in accounts}
        grants = self.admin("SELECT * FROM dolt_branch_control WHERE `database` = %s", (database,), "lookout")
        return {"database": database in databases, "users": users, "grants": grants,
                "recorded": database in db._service(self.service.service_root)["databases"],
                "profile": (self.service.home / f"{profile}.json").exists()}

    def init(self, name: str, database: str) -> dict:
        return db.init(name, database, self.service.service_root, "isolated", dolt_binary=BINARY)

    def test_a_failed_init_removes_what_it_created_and_the_same_name_can_be_made_again(self):
        nothing = {"database": False, "users": set(), "grants": [], "recorded": False, "profile": False}
        real_tables, real_write = db._ledger_tables, profile_directory.private_write

        def tables_then_fail(*args):
            real_tables(*args)  # the tables, both accounts, their grants and the branch grant exist
            raise RuntimeError("forced after the branch grant")

        def profile_write_fails(path, value):
            if path.parent == self.service.home:
                raise OSError("forced at the profile")
            real_write(path, value)

        for name, failure in (("first", patch.object(db, "_ledger_tables", tables_then_fail)),
                              ("late", patch.object(profile_directory, "private_write", profile_write_fails))):
            with self.subTest(failure=name):
                database = f"test_{name}"
                with failure, self.assertRaises((RuntimeError, OSError)):
                    self.init(name, database)
                self.assertEqual(self.left(database, name), nothing)
                self.init(name, database)
                with db.connect(db.load_profile(name), "writer") as writer:
                    written = db.write(writer, "probe", {"bundle": name}, "evidence_bundle", bundle_insert(name))
                self.assertEqual(written["write_status"], "written")

    def test_a_database_dropped_by_the_administrator_is_rebuilt_under_the_same_name(self):
        name = database = "rebuilt"
        self.init(name, database)
        old = db._service(self.service.service_root)["databases"][database]
        self.admin(f"DROP DATABASE `{database}`")
        (self.service.home / f"{name}.json").rename(self.service.home / f"{name}.archived")
        self.assertTrue(self.left(database, name)["users"])
        self.assertTrue(self.left(database, name)["grants"])
        self.init(name, database)
        state = self.left(database, name)
        self.assertEqual(len(state["grants"]), 1)
        self.assertEqual(state["users"], {db._account_name(database, role) for role in db.ROLES})
        new = db._service(self.service.service_root)["databases"][database]
        self.assertNotEqual(old["writer"]["password"], new["writer"]["password"])
        with db.connect(db.load_profile(name), "writer") as writer:
            written = db.write(writer, "probe", {"bundle": "again"}, "evidence_bundle", bundle_insert("again"))
        self.assertEqual(written["write_status"], "written")

    def test_a_name_the_service_holds_in_another_case_is_refused_and_kept(self):
        self.init("cased", "test_cased")
        with self.assertRaises(Refusal) as caught:
            self.init("upper", "TEST_CASED")
        self.assertEqual(caught.exception.code, "LEDGER_EXISTS")
        self.assertEqual(self.left("test_cased", "cased")["database"], True)
        with db.connect(db.load_profile("cased"), "reader") as reader:
            self.assertEqual(reader.rows("SELECT version FROM ledger_schema"), [(db.SCHEMA_VERSION,)])


if __name__ == "__main__":
    unittest.main()
