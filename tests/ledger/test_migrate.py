"""`ledger migrate`: a generation-1 ledger becomes generation 2 with every record kept, once."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

from ledger import db, evidence, metrics, migrate
from ledger.errors import Refusal
from ledger.refusals import refuse
from tests.ledger.dolt import BINARY, SKIP, Service


V1 = Path(__file__).with_name("schema_v1.sql")
IMAGE = "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64
SHARED = b'{"format":"execution-input-coverage-v1","symbols":["AAAUSDT-PERP.BINANCE"]}\n' * 40
REPORT = {"drawdown": {"mark_max_drawdown@2": {"value": 0.125, "population": "bars"}},
          "activity": {"returns_compound_to_equity@1": {"final_equity": "101234.56780000", "passed": True}},
          "populations": {"cycles": 2}}


def v1_ledger(service: Service, name: str) -> db.LedgerProfile:
    with patch.object(db, "SCHEMA", V1), patch.object(db, "SCHEMA_VERSION", 1):
        return service.ledger(name)


def populate(service: Service, profile: db.LedgerProfile) -> None:
    """Generation-1 records in the shapes the active ledger holds (sources, receipts with repeated
    content, a sealed run with cycles and returns, superseded judgments), committed by the administrator."""
    conn = service.admin(profile)
    try:
        with conn.cursor() as cursor:
            def run(statement, params=None):
                cursor.execute(statement, params)
            run("INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES "
                "('research-line-1', 'o1', NOW()), ('registration-a', 'o2', NOW()), "
                "('trial-1-execution-start', 'o3', NOW()), ('trial-2-execution-start', 'o4', NOW()), "
                "('notes-1', 'o5', NOW())")
            files = [("research-line-1", "line.json", b'{"universe_rule":"pool-v1"}'),
                     ("registration-a", "research-plan.json", b'{"body":{}}'),
                     ("trial-1-execution-start", "input-coverage.json", SHARED),
                     ("trial-1-execution-start", "execution.json", b'{"trial":1}'),
                     ("trial-2-execution-start", "input-coverage.json", SHARED),
                     ("trial-2-execution-start", "execution.json", b'{"trial":2}'),
                     ("notes-1", "paper.pdf", bytes(range(256)) * 400), ("notes-1", "copy/line.json",
                                                                          b'{"universe_rule":"pool-v1"}')]
            cursor.executemany("INSERT INTO evidence (bundle, path, content) VALUES (%s, %s, %s)", files)
            for revision, parent, contract in ((1, None, "r1-native-v6"), (2, 1, "r1-native-v6"),
                                               (3, 2, "replay-contract@v6")):
                run("INSERT INTO candidate (strategy_id, revision, source, entry_class, runtime_contract, "
                    "description, parent_strategy_id, parent_revision, difference, op_id, created_at) "
                    "VALUES ('ema', %s, %s, 'Ema', %s, 'd', %s, %s, %s, %s, NOW())",
                    (revision, b"class Ema: pass\n# " + str(revision).encode() * 5000, contract,
                     "ema" if parent else None, parent, "changed" if parent else None, f"c{revision}"))
            sources = [hashlib.sha256(b"class Ema: pass\n# " + str(revision).encode() * 5000).hexdigest()
                       for revision in (1, 2, 3)]
            for trial_id, purpose, source in ((1, "research", sources[0]), (2, "explore", sources[1]),
                                              (3, "precheck", sources[2])):
                run("INSERT INTO trial (trial_id, purpose, source_sha256, image_ref, instruments, input_start, "
                    "trade_start, trade_end, op_id, created_at) VALUES (%s, %s, %s, %s, '[\"AAAUSDT-PERP.BINANCE\"]', "
                    "'2026-01-01', '2026-01-02', '2026-02-01', %s, NOW())",
                    (trial_id, purpose, source, IMAGE, f"t{trial_id}"))
            run("INSERT INTO registration_attempt VALUES ('registration-a', %s, 1)", (sources[0],))
            run("INSERT INTO run (run_id, trial_id, status, audit, fingerprints, op_id, created_at) VALUES "
                "(1, 1, 'passed', '{\"ran\":true,\"findings\":[]}', '{\"orders\":\"x\"}', 'r1', NOW())")
            run("INSERT INTO run_sealed VALUES (1, %s, %s, 'r1', NOW())", ("a" * 40, json.dumps(REPORT)))
            cursor.executemany("INSERT INTO run_return VALUES (1, %s, %s, %s)",
                               [(day * 86_400 * 10**9, 0.001 * day, "1000.5") for day in range(1, 31)])
            run("INSERT INTO run_cycle (run_id, seq, instrument_id, side, ts_opened_ns, ts_closed_ns, realized_pnl, "
                "commissions, funding, open_unrealized, plan_tag, closing_order_type, closing_order_tag) VALUES "
                "(1, 1, 'AAAUSDT-PERP.BINANCE', 'long', 1, 5, '10.12345678', '0.25000000', '-0.12500001', NULL, "
                "'plan:a', 'MARKET', NULL), "
                "(1, 2, 'AAAUSDT-PERP.BINANCE', 'short', 6, NULL, NULL, '0.10000000', '0', '-3.5', 'plan:b', NULL, "
                "NULL)")
            run("INSERT INTO judgment (judgment_id, kind, line_bundle, based_on_commit, body, supersedes, op_id, "
                "created_at) VALUES (1, 'recommendation', 'research-line-1', %s, 'first', NULL, 'j1', NOW()), "
                "(2, 'recommendation', 'research-line-1', %s, 'second', 1, 'j2', NOW()), "
                "(3, 'interpretation', 'research-line-1', %s, 'about the run', NULL, 'j3', NOW())",
                ("h" * 32, "h" * 32, "h" * 32))
            run("INSERT INTO judgment_subject VALUES (1, 1, 'recommended', 'ema', 1, NULL, NULL), "
                "(2, 1, 'recommended', 'ema', 2, NULL, NULL), (3, 1, 'about', NULL, NULL, 1, NULL), "
                "(3, 2, 'about', NULL, NULL, NULL, 'registration-a')")
            run("UPDATE ledger_head SET seq = seq + 1, op_id = 'populate' WHERE singleton = 1")
            run("CALL DOLT_COMMIT('-A', '-m', 'populate')")
    finally:
        conn.close()


def tables(service: Service, profile: db.LedgerProfile) -> dict[str, str]:
    """Every table and view's definition with its generated constraint names removed."""
    found = {}
    for name, kind in service.sql(profile, "SHOW FULL TABLES"):
        if name.startswith("dolt_"):
            continue
        created = service.sql(profile, f"SHOW CREATE {'VIEW' if kind == 'VIEW' else 'TABLE'} `{name}`")[0][1]
        found[name] = re.sub(r"CONSTRAINT `[^`]+` | AUTO_INCREMENT=[0-9]+", "", created)
    return found


@unittest.skipUnless(BINARY, SKIP)
class MigrateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.fresh = cls.service.ledger("fresh")

    @classmethod
    def tearDownClass(cls):
        cls.service.close()

    def setUp(self):
        self.profile = v1_ledger(self.service, f"old{self.service.count + 1}")
        populate(self.service, self.profile)
        self.backup = self.service.root / f"backup-{self.profile.name}"

    def sql(self, statement, params=None):
        return self.service.sql(self.profile, statement, params)

    def test_every_record_is_kept_and_the_schema_is_a_new_ledgers(self):
        with self.assertRaises(Refusal) as caught:
            db.connect(self.profile, "reader")
        self.assertEqual(caught.exception.code, "SCHEMA_MISMATCH")
        cycles = self.sql("SELECT run_id, seq, realized_pnl, price_pnl FROM run_cycle ORDER BY seq")
        digests = self.sql("SELECT trial_id, image_digest FROM trial ORDER BY trial_id")
        done = migrate.migrate(self.profile, self.backup)
        self.assertEqual((done["schema_version"], done["migrated"], done["renamed_runtime_contracts"]), (2, True, 2))
        self.assertEqual((done["evidence_files"], done["evidence_contents"]), (8, 6))
        self.assertEqual(done["evidence_bytes"]["files"] - done["evidence_bytes"]["stored_once"],
                         len(SHARED) + len(b'{"universe_rule":"pool-v1"}'))
        self.assertEqual(done["rows"]["candidate"], 3)
        self.assertEqual(self.sql("SELECT version FROM ledger_schema"), [(2,)])
        self.assertEqual(self.sql("SELECT COUNT(*) FROM dolt_status"), [(0,)])
        self.assertEqual(self.sql("SELECT message FROM dolt_log LIMIT 1"), [("schema:2",)])
        self.assertEqual(self.sql("SELECT DISTINCT runtime_contract FROM candidate"), [("replay-contract@v6",)])
        self.assertEqual(tables(self.service, self.profile), tables(self.service, self.fresh))
        self.assertEqual(self.sql("SELECT * FROM dolt_tests ORDER BY test_name"),
                         self.service.sql(self.fresh, "SELECT * FROM dolt_tests ORDER BY test_name"))
        self.assertEqual(self.sql(f"SELECT run_id, seq, realized_pnl, {metrics.PRICE_PNL} FROM run_cycle ORDER BY seq"),
                         cycles)
        self.assertEqual(self.sql(f"SELECT trial_id, {db.IMAGE_DIGEST} FROM trial ORDER BY trial_id"), digests)
        self.assertEqual(admin_head(self.profile, self.backup), done["previous_commit"])

        with db.read_as_of(self.profile) as conn:
            self.assertEqual(evidence.load_bundle(conn, "trial-2-execution-start")["files"]["input-coverage.json"],
                             SHARED)
            history = conn.dicts("SELECT strategy_id, revision, mark_max_drawdown, final_equity, cycles, "
                                 "current_judgments FROM v_run_history")
            chain = conn.rows("SELECT judgment_id, chain_root, depth, superseded_by, is_current FROM v_judgment_chain "
                              "ORDER BY judgment_id")
            lineage = conn.rows("SELECT revision, root_revision, depth, trials, passed_research_runs FROM "
                                "v_candidate_lineage ORDER BY revision")
            subjects = conn.rows("SELECT judgment_id, strategy_id, revision, run_id, is_current FROM "
                                 "v_judgment_subjects ORDER BY judgment_id, seq")
        self.assertEqual(history, [{"strategy_id": "ema", "revision": 1, "mark_max_drawdown": 0.125,
                                    "final_equity": metrics.Decimal("101234.56780000"), "cycles": 2,
                                    "current_judgments": 1}])
        self.assertEqual(chain, [(1, 1, 0, 2, 0), (2, 1, 1, None, 1), (3, 3, 0, None, 1)])
        self.assertEqual(lineage, [(1, 1, 0, 1, 1), (2, 1, 1, 1, 0), (3, 1, 2, 1, 0)])
        self.assertEqual(subjects, [(1, "ema", 1, None, 0), (2, "ema", 2, None, 1), (3, "ema", 1, 1, 1),
                                    (3, None, None, None, 1)])
        with self.assertRaises(Refusal) as caught:
            with db.read_as_of(self.profile, done["previous_commit"]):
                pass
        self.assertEqual(caught.exception.code, "SCHEMA_MISMATCH")

        again = migrate.migrate(self.profile, self.backup)
        self.assertEqual((again["migrated"], again["ledger_commit"]), (False, done["ledger_commit"]))

        # The writer stores a repeated content once.
        with db.connect(self.profile, "writer") as conn:
            db.write(conn, "product_bundle", {"bundle": "notes-2"}, "evidence_bundle",
                     lambda c, op: evidence.write_files(c, "notes-2", {"a.json": SHARED, "b.txt": b"new"}, op))
        self.assertEqual(self.sql("SELECT COUNT(*) FROM evidence_content"), [(7,)])
        self.assertEqual(self.sql("SELECT path FROM evidence WHERE bundle = 'notes-2' ORDER BY path"),
                         [("a.json",), ("b.txt",)])

    def test_a_failed_check_resets_everything(self):
        head = self.sql("SELECT DOLT_HASHOF('HEAD')")
        with patch.object(migrate, "_check", side_effect=refuse("MIGRATION_CHECK_FAILED", "injected")):
            with self.assertRaises(Refusal):
                migrate.migrate(self.profile, self.backup)
        self.assertEqual(self.sql("SELECT DOLT_HASHOF('HEAD')"), head)
        self.assertEqual(self.sql("SELECT COUNT(*) FROM dolt_status"), [(0,)])
        self.assertEqual(self.sql("SELECT version FROM ledger_schema"), [(1,)])
        self.assertEqual(self.sql("SELECT COUNT(*) FROM evidence WHERE byte_length > 0"), [(8,)])

    def test_it_runs_alone_and_needs_a_backup(self):
        config = db._service(self.profile.service_root)
        reader = config["databases"][self.profile.database]["reader"]
        other = db.service_connection(config["socket"], user=reader["user"], password=reader["password"],
                                      database=self.profile.database)
        try:
            with self.assertRaises(Refusal) as caught:
                migrate.migrate(self.profile, self.backup)
            self.assertEqual(caught.exception.code, "MIGRATION_BUSY")
        finally:
            other.close()
        with self.assertRaises(Refusal) as caught:
            migrate.migrate(self.profile)
        self.assertEqual(caught.exception.code, "BACKUP_TARGET_UNSET")
        self.assertEqual(self.sql("SELECT version FROM ledger_schema"), [(1,)])


def admin_head(profile: db.LedgerProfile, backup: Path) -> str | None:
    from ledger import admin
    return admin.backup_head(profile, admin.backup_path(profile, backup))


if __name__ == "__main__":
    unittest.main()
