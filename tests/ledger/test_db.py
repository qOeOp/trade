"""Ledger base on a throwaway Dolt 2.4.2 service: init, accounts, connections, pinned reads, writes."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import patch

import pymysql

from ledger import db
from ledger.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service


def bundle_insert(name: str, wait=None):
    def insert(conn, op):
        conn.rows("INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, '2000-01-01')", (name, op))
        conn.rows("INSERT INTO evidence (bundle, path, content) VALUES (%s, 'a.txt', %s)", (name, name.encode()))
        if wait is not None:
            wait()
        return {"bundle": name}
    return insert


@unittest.skipUnless(BINARY, SKIP)
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
        tables = {name: kind for name, kind in self.service.sql(profile, "SHOW FULL TABLES")}
        for table in ("candidate", "evidence_bundle", "evidence", "trial", "registration_attempt", "run", "run_sealed",
                      "run_return", "run_cycle", "validation_registration", "validation_binding", "judgment",
                      "judgment_subject", "witness", "ledger_head", "ledger_schema"):
            self.assertEqual(tables.get(table), "BASE TABLE", table)
        for view in ("v_candidates", "v_trials", "v_runs", "v_judgments", "v_evidence", "v_validations"):
            self.assertEqual(tables.get(view), "VIEW", view)
        self.assertEqual(self.service.sql(profile, "SELECT version FROM ledger_schema"), [(db.SCHEMA_VERSION,)])
        self.assertEqual(self.service.sql(profile, "SELECT singleton, op_id FROM ledger_head")[0], (1, "schema"))
        tests = dict(self.service.sql(profile, "SELECT test_name, test_group FROM dolt_tests"))
        self.assertEqual(set(tests.values()), {"commit"})
        self.assertIn("witnesses_stamp_validation_registrations", tests)
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
        self.assertEqual(self.code(lambda: db.init("live", "live", db.REPOSITORY / "never-created", "active",
                                                   dolt_binary=BINARY)), "ISOLATION_BREACH")
        self.assertFalse((self.service.root / "live").exists())
        self.assertFalse((db.REPOSITORY / "never-created").exists())
        active = self.service.home / "prod.json"
        active.write_text(json.dumps({"name": "prod", "holds": "research", "kind": "active", "database": "research",
                                      "service": "/nonexistent", "research_branch": "main", "backup": None}))
        self.addCleanup(active.unlink)
        self.assertEqual(self.code(lambda: db.init("copy", "research", self.profile.service_root, "isolated",
                                                   dolt_binary=BINARY)), "ISOLATION_BREACH")
        self.assertEqual(self.code(lambda: db.init("second", "second", db.REPOSITORY / "never-created", "active",
                                                   backup_root=db.REPOSITORY / "never-backup", dolt_binary=BINARY)),
                         "LEDGER_EXISTS")

    # connect

    def test_connect_refusals(self):
        self.assertEqual(self.code(lambda: db.connect(self.profile, "admin")), "INVALID_ROLE")
        market = db.LedgerProfile(**{**self.profile.__dict__, "holds": "market"})
        self.assertEqual(self.code(lambda: db.connect(market, "reader")), "LEDGER_KIND")
        self.assertEqual(self.code(lambda: db.connect(self.profile, "writer", branch="side")), "BRANCH_FORBIDDEN")
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
        with patch.object(db, "SCHEMA_VERSION", 2):
            self.assertEqual(self.code(lambda: db.connect(self.profile, "reader")), "SCHEMA_MISMATCH")

    def test_connections_carry_their_role_and_branch(self):
        with db.connect(self.profile, "writer") as writer, db.connect(self.profile, "reader") as reader:
            self.assertEqual((writer.role, writer.branch, writer.database, writer.schema_version),
                             ("writer", "main", self.profile.database, db.SCHEMA_VERSION))
            self.assertEqual(reader.role, "reader")

    def test_the_writer_may_only_insert_and_bump_the_head_on_the_research_branch(self):
        writer = db.connect(self.profile, "writer")
        self.addCleanup(writer.close)
        for statement in ("UPDATE candidate SET description = 'x'", "DELETE FROM evidence_bundle",
                          "REPLACE INTO evidence_bundle VALUES ('b', 'o', NOW())", "TRUNCATE trial",
                          "DROP TABLE run", "UPDATE ledger_schema SET version = 2", "DELETE FROM ledger_head",
                          "CALL DOLT_RESET('--hard', 'HEAD~1')", "CALL DOLT_TAG('x')", "CALL DOLT_BRANCH('x')",
                          "CALL DOLT_CHECKOUT('-b', 'y')", "ALTER TABLE run ADD COLUMN x INT",
                          "DELETE FROM dolt_branch_control"):
            with self.subTest(statement=statement):
                self.assertEqual(self.code(lambda: writer.rows(statement)), "LEDGER_PERMISSION")
        reader = db.connect(self.profile, "reader")
        self.addCleanup(reader.close)
        self.assertEqual(self.code(lambda: reader.rows(
            "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('r', 'r', NOW())")), "LEDGER_PERMISSION")
        self.service.sql(self.profile, "CALL DOLT_BRANCH('side', 'main')")
        config = db._service(self.profile.service_root)
        account = config["databases"][self.profile.database]["writer"]
        raw = pymysql.connect(unix_socket=config["socket"], user=account["user"], password=account["password"],
                              database=f"{self.profile.database}/side", autocommit=True)
        self.addCleanup(raw.close)
        with self.assertRaises(pymysql.MySQLError), raw.cursor() as cursor:
            cursor.execute("INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('s', 's', NOW())")

    def test_the_writer_cannot_overwrite_through_upserts_or_generated_hashes(self):
        with db.connect(self.profile, "writer") as writer:
            db.write(writer, "probe", {"bundle": "upsert"}, "evidence_bundle", bundle_insert("upsert"))
            self.assertEqual(self.code(lambda: writer.rows(
                "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('upsert', 'u', NOW()) "
                "ON DUPLICATE KEY UPDATE op_id = 'hijacked'")), "LEDGER_PERMISSION")

            def forged_hash(conn, op):
                conn.rows("INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('forged', %s, NOW())", (op,))
                conn.rows("INSERT INTO evidence (bundle, path, content, sha256) VALUES ('forged', 'a', 'x', %s)",
                          ("0" * 64,))
                return {}

            self.assertEqual(self.code(lambda: db.write(writer, "probe", {"forged": 1}, "evidence_bundle",
                                                        forged_hash)), "DOLT_SQL_ERROR")
        (stored,), = self.service.sql(self.profile, "SELECT op_id FROM evidence_bundle WHERE bundle = 'upsert'")
        self.assertTrue(stored.startswith("probe:"))
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM evidence_bundle WHERE bundle = 'forged'"),
                         [(0,)])

    def test_run_rows_keep_reports_and_open_positions_consistent(self):
        with db.connect(self.profile, "writer") as writer:

            def run(status, failure_reasons, fingerprints, cycle_closed=None, open_unrealized=None):
                def insert(conn, op):
                    conn.rows("INSERT INTO trial (purpose, source_sha256, image_ref, instruments, input_start, "
                              "trade_start, trade_end, op_id, created_at) VALUES ('explore', %s, %s, '[]', "
                              "'2026-01-01', '2026-01-02', '2026-02-01', %s, NOW())",
                              ("e" * 64, "img@sha256:" + "a" * 64, op))
                    conn.rows("INSERT INTO run (trial_id, status, failure_reasons, audit, fingerprints, op_id, "
                              "created_at) VALUES (LAST_INSERT_ID(), %s, %s, '{}', %s, %s, NOW())",
                              (status, failure_reasons, fingerprints, op))
                    (run_id,), = conn.rows("SELECT LAST_INSERT_ID()")
                    conn.rows("INSERT INTO run_cycle (run_id, seq, instrument_id, side, ts_opened_ns, ts_closed_ns, "
                              "commissions, funding, open_unrealized) VALUES (%s, 1, 'A', 'long', 1, %s, 0, 0, %s)",
                              (run_id, cycle_closed, open_unrealized))
                    return {}
                return db.write(writer, "probe", {"run": [status, fingerprints, cycle_closed, open_unrealized]},
                                "trial", insert)

            self.assertEqual(run("passed", None, '{"orders": 1}', cycle_closed=None, open_unrealized="1.5")
                             ["write_status"], "written")
            for arguments in (("invalid", '["A1"]', '{"orders": 1}'), ("passed", None, None, 2, "1.5")):
                with self.subTest(arguments=arguments):
                    self.assertEqual(self.code(lambda: run(*arguments)), "DOLT_SQL_ERROR")

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
                "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('n', 'n', NOW())")),
                "LEDGER_PERMISSION")
        with db.read_as_of(self.profile, "main") as branch:
            self.assertEqual(branch.ref, "main")

    def test_read_as_of_refusals(self):
        for ref in ("", "a;DROP TABLE run", "../x", "x y"):
            with self.subTest(ref=ref):
                self.assertEqual(self.code(lambda: db.read_as_of(self.profile, ref)), "INVALID_REF")
        self.assertEqual(self.code(lambda: db.read_as_of(self.profile, "nosuchtag")), "UNKNOWN_REF")
        self.assertEqual(self.code(lambda: db.read_as_of(self.profile, "a" * 32)), "UNKNOWN_REF")
        with patch.object(db, "READABLE_VERSIONS", frozenset({7})):
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

            def unpublished_research_trial(conn, op):
                conn.rows("INSERT INTO trial (purpose, source_sha256, image_ref, instruments, input_start, "
                          "trade_start, trade_end, op_id, created_at) VALUES ('research', %s, %s, '[]', "
                          "'2026-01-01', '2026-01-02', '2026-02-01', %s, NOW())",
                          ("f" * 64, "img@sha256:" + "a" * 64, op))
                return {}

            with self.assertRaises(Refusal) as caught:
                db.write(writer, "probe", {"t": 1}, "trial", unpublished_research_trial)
            self.assertEqual(caught.exception.code, "COMMIT_CHECK_FAILED")
            self.assertIn("research_and_validation_trials_have_published_sources", caught.exception.missing)
            self.assertIn("research_trials_follow_their_registration", caught.exception.missing)

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
        self.service.sql(profile, "INSERT INTO evidence_bundle (bundle, op_id, created_at) "
                                  "VALUES ('stray', 's', NOW())")
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

    def test_history_shows_only_additions_on_the_normal_path(self):
        with db.connect(self.profile, "writer") as writer:
            db.write(writer, "probe", {"bundle": "history"}, "evidence_bundle", bundle_insert("history"))
        for table in ("evidence_bundle", "evidence"):
            kinds = {kind for (kind,) in self.service.sql(self.profile,
                                                          f"SELECT DISTINCT diff_type FROM dolt_diff_{table}")}
            self.assertEqual(kinds, {"added"}, table)


@unittest.skipUnless(BINARY, SKIP)
class CommitChecksGuardTests(unittest.TestCase):
    """Its own service: the verification group is service-wide."""

    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.addClassCleanup(cls.service.close)
        cls.profile = cls.service.ledger("guard")

    def head(self) -> tuple:
        return (self.service.sql(self.profile, "SELECT seq FROM ledger_head")[0][0],
                self.service.sql(self.profile, "SELECT COUNT(*) FROM dolt_log")[0][0])

    def test_a_switched_off_verification_group_stops_writes_and_connections(self):
        writer = db.connect(self.profile, "writer")
        self.addCleanup(writer.close)
        restore = "SET PERSIST dolt_commit_verification_groups = 'commit'"
        self.addCleanup(self.service.sql, self.profile, restore)
        with db.connect(self.profile, "reader") as reader:
            reader.rows("SET PERSIST dolt_commit_verification_groups = ''")
        before = self.head()
        with self.assertRaises(Refusal) as caught:
            db.write(writer, "probe", {"bundle": "unchecked"}, "evidence_bundle", bundle_insert("unchecked"))
        self.assertEqual((caught.exception.code, caught.exception.write_status),
                         ("COMMIT_CHECKS_DISABLED", "not_written"))
        self.assertEqual(self.head(), before)
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM dolt_status"), [(0,)])
        for role in ("writer", "reader"):
            with self.subTest(role=role), self.assertRaises(Refusal) as caught:
                db.connect(self.profile, role)
            self.assertEqual(caught.exception.code, "COMMIT_CHECKS_DISABLED")
        self.service.sql(self.profile, restore)
        written = db.write(writer, "probe", {"bundle": "checked"}, "evidence_bundle", bundle_insert("checked"))
        self.assertEqual(written["write_status"], "written")
        with db.connect(self.profile, "writer") as fresh:
            self.assertEqual(fresh.role, "writer")


if __name__ == "__main__":
    unittest.main()
