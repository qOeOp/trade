"""The research ledger on a throwaway Dolt 2.4.2 service: rounds, privileges, writes, verdicts, audit."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import pymysql

from research.records import db, ledger, records, trials
from research.records.analysis import load_dir
from research.records.audit import audit
from research.records.common import RecordError
from tests.records.dolt import BINARY, SKIP, TemporaryLedger
from tests.records.fixtures import reports


SOURCE = b"from nautilus_trader.trading import Strategy\n\n\nclass Fixture(Strategy):\n    pass\n"
IMAGE = "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64
INSPECTION = {"runtime_contract": "r1-native-v4", "nautilus_version": "fixture", "dependency_lock_sha256": "c" * 64,
              "platform": "linux/arm64", "source_files_sha256": {}, "source_file_paths": {}}


def goal(goal_id: str, window: dict, **targets) -> dict:
    return {"goal_id": goal_id, "max_drawdown": targets.get("max_drawdown", 0.2),
            "min_annual_return": targets.get("min_annual_return", 0.05),
            "min_plan_win_rate": targets.get("min_plan_win_rate", 0.6),
            "drawdown_measure": "native MARK equity at available observation times",
            "window": {"start": window["trade_start"], "end": window["end"]}, "known_exposure": "none"}


@unittest.skipUnless(BINARY, SKIP)
class LedgerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ledger = TemporaryLedger("records-test")
        cls.profile = cls.ledger.profile
        cls.rounds = 0

    @classmethod
    def tearDownClass(cls):
        cls.ledger.close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # The timestamp authority is faked: tokens name their commit, and their time is self.stamp_time.
        self.stamp_time = datetime.now(UTC).replace(tzinfo=None)
        for name, fake in (("_request_token", lambda commit: ("https://tsa.invalid", b"token:" + commit.encode())),
                           ("token_time", lambda token, commit: self.check_token(token, commit))):
            stub = patch(f"research.records.witness.{name}", side_effect=fake)
            stub.start()
            self.addCleanup(stub.stop)

    def check_token(self, token, commit):
        if token != b"token:" + commit.encode():
            raise RecordError("token does not stamp this commit", code="WITNESS_INVALID")
        return self.stamp_time

    def open_round(self, **targets):
        LedgerTests.rounds += 1
        name = f"G{LedgerTests.rounds}"
        self.window = reports.write(Path(self.temp.name) / f"{name}-dev", plans=120)  # the goal window
        ledger.open_round(self.profile, goal(name, self.window, **targets))
        self.addCleanup(ledger.close_round, self.profile)
        records.publish_strategy(self.profile, source=SOURCE + name.encode(), strategy_id="fixture", entry_class="Fixture",
                                 description="synthetic", parent=None, difference=None, op=None)
        self.sha = hashlib.sha256(SOURCE + name.encode()).hexdigest()
        return name

    def sealed_run(self, window: dict | None = None, problems=(), **shape) -> int:
        directory = Path(tempfile.mkdtemp(dir=self.temp.name))
        written = reports.write(directory / "reports", **shape)
        window = window or written
        trial = trials.report_trial(self.profile, mode="sealed", strategy_source_sha256=self.sha, coins=["AAA", "BBB"],
                                    start=window["start"], trade_start=window["trade_start"], end=window["end"],
                                    image_ref=IMAGE)
        stored = trials.hand_off_run(self.profile, trial_id=trial, reports=load_dir(directory / "reports"),
                                     problems=list(problems), inspection=INSPECTION, image_revision="a" * 40,
                                     effective_config={"coins": ["AAA", "BBB"], "native_account": {"venue": "X"}},
                                     input_identity={"fixture": True})
        return stored["run_id"]

    def freeze(self, run_id, failed_part=None, **extra):
        return records.freeze(self.profile, run_id=run_id, source_bundle=extra.get("bundle"), failed_part=failed_part,
                              note="synthetic", op=extra.get("op"), check_image=False, check_fresh=False)

    def query(self, statement, params=None, branch=None):
        conn = db.connect(self.profile, "admin", branch=branch)
        try:
            return db.rows(conn, statement, params)
        finally:
            conn.close()

    # Rounds and privileges

    def test_round_writes_land_on_its_branch_and_closing_tags_it_read_only(self):
        name = self.open_round()
        self.assertEqual(self.query("SELECT COUNT(*) FROM goal", branch="main"), [(0,)])
        self.assertEqual(self.query("SELECT goal_id FROM goal", branch=f"round/{name}"), [(name,)])
        closed = ledger.close_round(self.profile)
        self.assertEqual(closed["tag"], f"closed/{name}")
        with self.assertRaises(RecordError) as caught:
            records.publish_strategy(self.profile, source=SOURCE + b"#late", strategy_id="late", entry_class="Fixture",
                                     description="x", parent=None, difference=None, op=None)
        self.assertEqual(caught.exception.code, "NO_ACTIVE_ROUND")
        writer = db.connect(self.profile, "writer", branch=f"round/{name}")
        with self.assertRaisesRegex(RecordError, "may not"):
            db.rows(writer, "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('x', 'x', NOW())")
        writer.close()
        self.assertEqual(self.query("SELECT goal_id FROM goal AS OF 'closed/" + name + "'"), [(name,)])
        with self.assertRaisesRegex(RecordError, "a changed goal is a new goal_id"):
            ledger.open_round(self.profile, goal(name, self.window))
        ledger.open_round(self.profile, goal(name + "b", self.window))  # closed by the cleanup

    def test_writer_can_only_insert_and_bump_the_head(self):
        name = self.open_round()
        writer = db.connect(self.profile, "writer", branch=f"round/{name}")
        self.addCleanup(writer.close)
        for statement in ("UPDATE goal SET known_exposure = 'x'", "DELETE FROM strategy_revision",
                          "REPLACE INTO evidence_bundle VALUES ('b', 'o', NOW())", "TRUNCATE trial",
                          "DROP TABLE run", "CALL DOLT_RESET('--hard', 'HEAD~1')", "CALL DOLT_TAG('x')",
                          "CALL DOLT_BRANCH('x')", "CALL DOLT_CHECKOUT('main')"):
            with self.subTest(statement=statement), self.assertRaisesRegex(RecordError, "may not"):
                db.rows(writer, statement)
        main = db.connect(self.profile, "writer", branch="main")
        self.addCleanup(main.close)
        with self.assertRaisesRegex(RecordError, "may not"):
            db.rows(main, "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('m', 'm', NOW())")
        reader = db.connect(self.profile, "reader", branch=f"round/{name}")
        self.addCleanup(reader.close)
        with self.assertRaisesRegex(RecordError, "may not"):
            db.rows(reader, "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES ('r', 'r', NOW())")

    def test_created_at_is_server_time_whatever_the_client_sends(self):
        name = self.open_round()
        (created,), = self.query("SELECT created_at FROM goal", branch=f"round/{name}")
        self.assertLess(abs(created - datetime.now(UTC).replace(tzinfo=None)), timedelta(minutes=1))

    def test_a_retry_returns_the_original_and_a_race_is_refused_not_merged(self):
        name = self.open_round()
        first = records.add_evidence(self.profile, "notes", [self.note("a")], None)
        again = records.add_evidence(self.profile, "notes", [self.note("a")], None)
        self.assertEqual((first["replayed"], again["replayed"], again["files"]), (False, True, first["files"]))
        with self.assertRaises(RecordError) as caught:
            records.add_evidence(self.profile, "notes", [self.note("b")], None)
        self.assertEqual(caught.exception.code, "BUNDLE_EXISTS")
        barrier, outcomes = threading.Barrier(2), {}

        def race(label):
            def insert(conn):
                db.rows(conn, "INSERT INTO evidence_bundle (bundle, op_id, created_at) VALUES (%s, %s, NOW())",
                        (label, label))
                barrier.wait(timeout=10)
                return {}
            try:
                outcomes[label] = db.write(self.profile, kind="race", op=label, table="evidence_bundle", insert=insert)
            except RecordError as exc:
                outcomes[label] = exc.code

        threads = [threading.Thread(target=race, args=(label,)) for label in ("race-a", "race-b")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(str(value) if isinstance(value, str) else "written" for value in outcomes.values()),
                         ["CONCURRENT_WRITE", "written"])
        bundles = {bundle for (bundle,) in self.query("SELECT bundle FROM evidence_bundle", branch=f"round/{name}")}
        self.assertEqual(len(bundles & {"race-a", "race-b"}), 1)

    def note(self, text) -> Path:
        directory = Path(tempfile.mkdtemp(dir=self.temp.name))
        (directory / "claims.json").write_text(json.dumps({"claims": [{"quote": text}]}))
        return directory

    def test_evidence_refuses_empty_files_and_media_and_exports_exact_bytes(self):
        self.open_round()
        directory = self.note("x")
        (directory / "empty.txt").write_bytes(b"")
        with self.assertRaisesRegex(RecordError, "empty evidence"):
            records.add_evidence(self.profile, "with-empty", [directory], None)
        (directory / "empty.txt").unlink()
        (directory / "source.mp4").write_bytes(b"video")
        with self.assertRaisesRegex(RecordError, "media files are not kept"):
            records.add_evidence(self.profile, "with-media", [directory], None)
        (directory / "source.mp4").unlink()
        records.add_evidence(self.profile, "kept", [directory], None)
        target = Path(self.temp.name) / "restored"
        with db.reading(self.profile) as conn:
            records.export_evidence(conn, "kept", target)
        self.assertEqual((target / "claims.json").read_bytes(), (directory / "claims.json").read_bytes())

    # Runs and verdicts

    def test_a_sealed_run_is_stored_whole_with_its_readings(self):
        self.open_round()
        run_id = self.sealed_run(plans=120, wins=90)
        report = records.run_report(self.profile, run_id)
        self.assertEqual((report["status"], report["plans_closed"], report["plans_won"], report["plan_win_rate"]),
                         ("passed", 120, 90, 0.75))
        self.assertEqual(report["strategy"], "fixture@1")
        self.assertEqual(report["cost_basis"]["native_account"], {"venue": "X"})
        self.assertEqual(report["closed_by_year"], {"2026": {"closed_trades": 120, "price_pnl_usdt": "2100.00000000",
                                                             "fill_commissions_usdt": "0.00000000",
                                                             "reported_funding_usdt": "0.00000000"}})
        counts = self.query("SELECT (SELECT COUNT(*) FROM run_order WHERE run_id=%s), (SELECT COUNT(*) FROM run_fill "
                            "WHERE run_id=%s), (SELECT COUNT(*) FROM run_position WHERE run_id=%s)",
                            (run_id, run_id, run_id), branch=f"round/{self.goal_id()}")
        self.assertEqual(counts, [(240, 240, 120)])

    def goal_id(self):
        return f"G{LedgerTests.rounds}"

    def test_an_invalid_run_keeps_only_its_reasons(self):
        self.open_round()
        run_id = self.sealed_run(problems=["independent native audit found problems"])
        report = records.run_report(self.profile, run_id)
        self.assertEqual((report["status"], report["failure_reasons"], report["plans_closed"]),
                         ("invalid", ["independent native audit found problems"], None))
        self.assertEqual(self.query("SELECT COUNT(*) FROM run_order WHERE run_id=%s", (run_id,),
                                    branch=f"round/{self.goal_id()}"), [(0,)])
        frozen = self.freeze(run_id, bundle=None)
        self.assertEqual(frozen["result"], "invalid")

    def test_the_freeze_verdict_comes_from_the_goal_and_the_readings(self):
        self.open_round()
        passing = self.sealed_run(window=self.window_for(plans=120), plans=120, wins=90)
        with self.assertRaisesRegex(RecordError, "failed part is required exactly when it fails"):
            self.freeze(passing, failed_part="cost")
        frozen = self.freeze(passing)
        self.assertEqual((frozen["result"], frozen["distinct_sources"]), ("passed", 1))
        self.assertTrue(all(gate["passed"] for gate in frozen["gates"].values()))
        self.assertEqual((frozen["witness"]["status"], frozen["witness"]["commit"]), ("witnessed", frozen["commit"]))
        self.assertEqual(self.query("SELECT COUNT(*) FROM witness WHERE commit_hash = %s", (frozen["commit"],),
                                    branch=f"round/{self.goal_id()}"), [(1,)])
        losing = self.sealed_run(window=self.window_for(plans=120), plans=120, wins=50)
        with self.assertRaisesRegex(RecordError, "failed part is required"):
            self.freeze(losing)
        failed = self.freeze(losing, failed_part="gross_edge")
        self.assertEqual(failed["result"], "failed")
        self.assertFalse(failed["gates"]["plan_win_rate"]["passed"])
        self.assertTrue(self.freeze(losing, failed_part="gross_edge")["replayed"])
        status = records.round_status(self.profile)
        self.assertEqual((status["failed_freezes"], status["distinct_sources_since_last_freeze"]), (1, 0))

    def window_for(self, plans):
        return reports.write(Path(tempfile.mkdtemp(dir=self.temp.name)), plans=plans)

    def test_a_freeze_needs_the_goal_window(self):
        self.open_round()
        other = reports.write(Path(tempfile.mkdtemp(dir=self.temp.name)), plans=10)
        run_id = self.sealed_run(window={**other, "end": "2026-02-01T00:00:00Z"}, plans=10, wins=5)
        with self.assertRaises(RecordError) as caught:
            self.freeze(run_id, failed_part="frequency")
        self.assertEqual(caught.exception.code, "WINDOW_MISMATCH")

    def test_trials_of_other_sources_count_toward_the_freeze(self):
        self.open_round()
        for index in range(3):
            trials.report_trial(self.profile, mode="explore", strategy_source_sha256=f"{index:064x}", coins=["AAA"],
                                start=self.window["start"], trade_start=self.window["trade_start"],
                                end=self.window["end"], image_ref=IMAGE)
        trials.report_trial(self.profile, mode="explore", strategy_source_sha256="f" * 64, coins=["AAA"],
                            start="2020-01-01T00:00:00Z", trade_start="2020-01-02T00:00:00Z",
                            end="2020-02-01T00:00:00Z", image_ref=IMAGE)  # outside the goal window
        run_id = self.sealed_run(window=self.window_for(plans=120), plans=120, wins=50)
        self.assertEqual(self.freeze(run_id, failed_part="gross_edge")["distinct_sources"], 4)

    def test_confirmation_needs_a_future_window_a_witness_and_the_frozen_source(self):
        self.open_round()
        frozen = self.freeze(self.sealed_run(window=self.window_for(plans=120), plans=120, wins=90))
        with self.assertRaises(RecordError) as caught:
            records.confirm_plan(self.profile, freeze_id=frozen["freeze_id"], window_start="2026-01-01T00:00:00Z",
                                 window_end="2026-06-01T00:00:00Z", op=None, check_fresh=False)
        self.assertEqual(caught.exception.code, "WINDOW_NOT_FUTURE")
        start = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
        plan = records.confirm_plan(self.profile, freeze_id=frozen["freeze_id"], window_start=start.isoformat(),
                                    window_end=(start + timedelta(days=200)).isoformat(), op=None, check_fresh=False)
        self.assertEqual(plan["witness"]["status"], "witnessed")
        future = reports.write(Path(tempfile.mkdtemp(dir=self.temp.name)) / "reports", plans=120, wins=100,
                               start=start - timedelta(days=1))
        run_id = self.sealed_run(window=future, plans=120, wins=100, start=start - timedelta(days=1))
        verdict = records.confirm_verdict(self.profile, plan_id=plan["plan_id"], run_id=run_id, failed_part=None,
                                          note="synthetic", op=None, check_image=False, check_fresh=False)
        self.assertEqual(verdict["result"], "passed")
        corrected = records.correct(self.profile, freeze_id=None, verdict_id=verdict["verdict_id"], result="invalid",
                                    failed_part=None, note="a defect found later", op=None)
        self.assertEqual(self.query("SELECT result, correction_id FROM verdict_latest",
                                    branch=f"round/{self.goal_id()}"), [("invalid", corrected["correction_id"])])

    def test_a_plan_witnessed_after_its_window_began_cannot_confirm(self):
        self.open_round()
        frozen = self.freeze(self.sealed_run(window=self.window_for(plans=120), plans=120, wins=90))
        start = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
        self.stamp_time = (start + timedelta(days=1)).replace(tzinfo=None)  # the timestamp lands late
        plan = records.confirm_plan(self.profile, freeze_id=frozen["freeze_id"], window_start=start.isoformat(),
                                    window_end=(start + timedelta(days=200)).isoformat(), op=None, check_fresh=False)
        run_id = self.sealed_run(window=reports.write(Path(tempfile.mkdtemp(dir=self.temp.name)), plans=120,
                                                      start=start - timedelta(days=1)),
                                 plans=120, wins=100, start=start - timedelta(days=1))
        with self.assertRaises(RecordError) as caught:
            records.confirm_verdict(self.profile, plan_id=plan["plan_id"], run_id=run_id, failed_part=None,
                                    note="synthetic", op=None, check_image=False, check_fresh=False)
        self.assertEqual(caught.exception.code, "NOT_WITNESSED_IN_TIME")

    def test_every_command_uses_one_connection(self):
        self.open_round()
        run_id = self.sealed_run(window=self.window_for(plans=120), plans=120, wins=90)
        real = pymysql.connect
        opened = []

        def counting(*args, **kwargs):
            opened.append(1)
            return real(*args, **kwargs)

        with patch("pymysql.connect", side_effect=counting):
            for label, command in (("freeze with its timestamp", lambda: self.freeze(run_id)),
                                   ("run report", lambda: records.run_report(self.profile, run_id)),
                                   ("round status", lambda: records.round_status(self.profile)),
                                   ("a trial, then a run stored (two calls)", lambda: self.sealed_run(plans=3, wins=2))):
                opened.clear()
                command()
                with self.subTest(command=label):
                    self.assertEqual(len(opened), 2 if "two calls" in label else 1)

    # Audit, export, backup

    def test_audit_finds_rows_changed_outside_the_write_path(self):
        name = self.open_round()
        run_id = self.sealed_run(window=self.window_for(plans=120), plans=120, wins=90)
        self.freeze(run_id)
        self.assertEqual(audit(self.profile, None)["findings"], [])
        unstamped = self.freeze(self.sealed_run(window=self.window_for(plans=120), plans=120, wins=50),
                                failed_part="gross_edge", op="freeze:unstamped")
        self.assertEqual(unstamped["witness"]["status"], "witnessed")
        conn = db.connect(self.profile, "admin", branch=f"round/{name}")
        db.rows(conn, "UPDATE run SET max_drawdown = 0.001 WHERE run_id = %s", (run_id,))
        db.rows(conn, "CALL DOLT_COMMIT('-a', '-m', 'edit', '--skip-verification')")
        conn.close()
        findings = audit(self.profile, None)["findings"]
        self.assertTrue(any("run: 1 rows were modified" in item for item in findings), findings)
        self.assertTrue(any("stored max_drawdown" in item for item in findings), findings)

    def test_export_writes_parquet_and_sql_reads_across_runs(self):
        import pyarrow.parquet as pq
        name = self.open_round()
        first, second = self.sealed_run(plans=3, wins=2), self.sealed_run(plans=5, wins=1)
        found = ledger.sql(self.profile, "SELECT run_id, COUNT(*) AS orders FROM run_order GROUP BY run_id ORDER BY run_id",
                           None, 10)["rows"]
        self.assertEqual(found, [{"run_id": first, "orders": 6}, {"run_id": second, "orders": 10}])
        with self.assertRaisesRegex(RecordError, "may not"):
            ledger.sql(self.profile, "DELETE FROM run_order", None, 10)
        exported = ledger.export(self.profile, f"round/{name}", Path(self.temp.name) / "parquet")
        table = pq.read_table(Path(self.temp.name) / "parquet" / "run_order.parquet")
        self.assertEqual((table.num_rows, exported["rows"]["run_order"]), (16, 16))
        self.assertEqual(pq.read_table(Path(self.temp.name) / "parquet" / "strategy_revision.parquet")
                         .column("source").to_pylist()[0][:20], SOURCE[:20])

    def test_backup_syncs_every_branch(self):
        self.open_round()
        result = ledger.backup(self.profile)
        self.assertTrue(Path(result["backup"], "manifest").exists())
        self.assertIn(f"round/{self.goal_id()}", result["branches"])


@unittest.skipUnless(BINARY, SKIP)
class LedgerProfileTests(unittest.TestCase):
    def test_isolated_ledgers_may_not_reuse_the_active_database_name(self):
        fixture = TemporaryLedger("active-one", role="active")
        self.addCleanup(fixture.close)
        with self.assertRaises(RecordError) as caught:
            ledger.init(name="copy", database=fixture.profile["database"], service_root=fixture.root / "s2",
                        binary=BINARY, port=1, role="isolated", backup_root=None)
        self.assertEqual(caught.exception.code, "ISOLATION_BREACH")
        with self.assertRaisesRegex(RecordError, "already active"):
            ledger.init(name="second", database="other", service_root=fixture.root / "s3", binary=BINARY, port=1,
                        role="active", backup_root=None)
        with self.assertRaisesRegex(RuntimeError, "holds an active ledger"):
            TemporaryLedger("nested")
        status = ledger.status()["ledgers"]
        self.assertEqual([(item["name"], item["running"]) for item in status], [("active-one", True)])

    def test_the_research_cli_defaults_to_the_research_ledger_beside_a_market_database(self):
        fixture = TemporaryLedger("research-one", role="active")
        self.addCleanup(fixture.close)
        market = {"name": "market-one", "kind": "market", "role": "active", "service": str(fixture.root / "m"),
                  "database": "market_one", "backup": None}
        (ledger.home() / "market-one.json").write_text(json.dumps(market))
        self.assertEqual(ledger.profile(None)["name"], "research-one")
        self.assertEqual(ledger.profile(None, of="market")["name"], "market-one")
        with self.assertRaises(RecordError) as caught:
            ledger.profile("market-one")
        self.assertEqual(caught.exception.code, "LEDGER_KIND")
        status = {item["name"]: item for item in ledger.status()["ledgers"]}
        self.assertEqual(status["market-one"]["kind"], "market")
        self.assertFalse({"open_round", "closed_rounds"} & set(status["market-one"]))
        self.assertIn("open_round", status["research-one"])

    def test_a_temporary_ledger_is_gone_after_its_command(self):
        home = Path(tempfile.mkdtemp(prefix="lh-", dir="/tmp"))
        self.addCleanup(lambda: __import__("shutil").rmtree(home, ignore_errors=True))
        marker = home / "seen.json"
        script = ("import json,os,sys; from research.records import ledger; "
                  f"open({str(marker)!r},'w').write(json.dumps(ledger.status()))")
        with patch.dict(os.environ, {"TRADE_LEDGER_HOME": str(home / "ledgers")}):
            code = ledger.temporary("probe", [os.sys.executable, "-c", script], BINARY, _port())
            self.assertEqual((code, ledger.profiles()), (0, {}))
        seen = json.loads(marker.read_text())["ledgers"]
        self.assertEqual([(item["name"], item["role"], item["running"]) for item in seen], [("probe", "temporary", True)])
        self.assertFalse(Path(seen[0]["service"]).exists())


def _port():
    from tests.records.dolt import _free_port
    return _free_port()


class LedgerRulesTests(unittest.TestCase):
    """Refusals decided before any connection."""

    def test_a_checkout_behind_origin_main_cannot_freeze_or_confirm(self):
        import subprocess
        work = Path(tempfile.mkdtemp())
        self.addCleanup(__import__("shutil").rmtree, work, ignore_errors=True)

        def git(cwd, *argv):
            subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *argv], cwd=cwd,
                           check=True, capture_output=True)

        git(work, "init", "--bare", "-b", "main", "origin.git")
        git(work, "clone", "origin.git", "checkout")
        checkout, other = work / "checkout", work / "other"
        git(checkout, "commit", "--allow-empty", "-m", "first")
        git(checkout, "push", "origin", "HEAD:main")
        git(work, "clone", "origin.git", "other")
        git(other, "commit", "--allow-empty", "-m", "newer on main")
        git(other, "push", "origin", "HEAD:main")
        with patch.object(records, "ROOT", checkout):
            with self.assertRaises(RecordError) as caught:
                records.require_fresh()
            self.assertEqual(caught.exception.code, "STALE_CHECKOUT")
            git(checkout, "pull", "--ff-only", "origin", "main")
            records.require_fresh()

    def test_goal_files_carry_exactly_the_user_targets(self):
        window = {"start": "2026-01-01T00:00:00Z", "trade_start": "2026-01-01T00:00:00Z", "end": "2026-06-01T00:00:00Z"}
        self.assertEqual(records.validate_goal(goal("G-1", window))["drawdown_measure"], "native_mark_equity_5m")
        for broken in ({**goal("G-1", window), "risk_budget": 0.01}, {**goal("G-1", window), "max_drawdown": 1.5},
                       {**goal("G-1", window), "window": {"start": "2026-06-01T00:00:00Z", "end": "2026-01-01T00:00:00Z"}}):
            with self.subTest(broken=broken), self.assertRaises(RecordError):
                records.validate_goal(broken)

    def test_strategy_sources_parse_without_running(self):
        records.check_source(SOURCE, "Fixture")
        for source, entry in ((b"", "Fixture"), (b"class A:\n  pass\nclass A:\n  pass\n", "A"),
                              (b"def broken(:\n", "Fixture"), (SOURCE, "Missing")):
            with self.subTest(source=source), self.assertRaises(RecordError):
                records.check_source(source, entry)

    def test_gates_use_two_thirds_of_the_drawdown_budget_on_development_data(self):
        target = {"max_drawdown": records.Decimal("0.3"), "min_annual_return": records.Decimal("0.15"),
                  "min_plan_win_rate": records.Decimal("0.6")}
        run = {"plans_closed": 100, "plan_win_rate": 0.61, "max_drawdown": 0.2, "annual_return": 0.15,
               "return_drawdown": 0.75, "status": "passed"}
        self.assertTrue(all(gate["passed"] for gate in records.gates(target, run, development=True).values()))
        for key, value in (("plans_closed", 99), ("plan_win_rate", 0.6), ("max_drawdown", 0.21),
                           ("return_drawdown", 0.74), ("annual_return", 0.149), ("plan_win_rate", None)):
            with self.subTest(key=key):
                self.assertEqual(records._result({**run, key: value}, records.gates(target, {**run, key: value},
                                                                                    development=True), "tail"), "failed")
        self.assertTrue(records.gates(target, {**run, "max_drawdown": 0.29}, development=False)["max_drawdown"]["passed"])
        self.assertEqual(records._result({**run, "status": "invalid"}, records.gates(target, run, development=True), None),
                         "invalid")


if __name__ == "__main__":
    unittest.main()
