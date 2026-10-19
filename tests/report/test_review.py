"""The whole-ledger review, export and backup, the out-of-sample report and the cross-image comparison
on throwaway ledgers, including ledgers tampered with through the administrator account the way
the review exists to find. Never the active ledger."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from ledger import admin, db, trials, witness
from ledger.errors import Refusal
from registration import validation
from replay import entry
from report import comparison, reproduce, review, seams, status
from tests.ledger.dolt import BINARY, MARKET_COMMIT, RUNTIME, SKIP, attempt_binder, context, sha, source
from tests.ledger.tsa import LocalAuthority
from tests.registration.world import DESIGN, LINE_WINDOW, RUNNER_ARGV, World
from tests.replay.world import ReplayWorld, registered_grid


FINGERPRINT = {"fills": {"rows": 2, "sha256": "1" * 64}}


def refused(function, *args, **kwargs) -> Refusal:
    try:
        function(*args, **kwargs)
    except Refusal as exc:
        return exc
    raise AssertionError("no refusal")


def codes(found: dict) -> list[str]:
    return sorted({item["code"] for item in found["findings"]})


@unittest.skipUnless(BINARY and shutil.which("openssl"), SKIP)
class TamperTests(unittest.TestCase):
    """A registration world: fixture runs without captures, an attempt outside its grid, two
    validation registrations (one unwitnessed), a backup, and then the administrator's tampering."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = World("tamper")
        cls.addClassCleanup(world.close)
        cls.authority = LocalAuthority()
        cls.addClassCleanup(cls.authority.close)
        roots = patch.object(witness, "_roots", lambda tsa_roots: cls.authority.roots)
        roots.start()
        cls.addClassCleanup(roots.stop)
        world.judge("review_cadence", cadence=50)
        world.register("registration-root", world.body(["rsi@1"], {"rsi@1": world.prechecked(source("root"))}))
        cls.fixture_run = world.seal_run(world.research_trial("registration-root", source("root")))
        other = world.publish("other", parent=None)
        trial_id = trials.open_trial(world.conn, "research", sha(other["source"]), RUNTIME,
                                     {"identity": world.plan("registration-root")["execution"]["input_identity"],
                                      "input_coverage": b'{"format": "x"}'}, LINE_WINDOW,
                                     context(other["source"], "/tmp/outside-grid"),
                                     attempt_binder("registration-root", sha(other["source"])))["trial_id"]
        cls.outside_trial = trial_id
        cls.blank_run = world.seal_run(trial_id)
        window = (datetime(2030, 1, 1, tzinfo=UTC), datetime(2030, 2, 1, tzinfo=UTC))
        arguments = {"window_start": window[0], "window_end": window[1], "universe_rule": "pool-v1",
                     "market": MARKET_COMMIT, "design": DESIGN, "retry_of": None, "market_profile": world.market,
                     "tsa_roots": cls.authority.roots}
        with patch.object(witness, "_post", side_effect=cls.authority.respond):
            cls.witnessed = validation.validation_register(world.profile, "rsi@1", op_id="v:witnessed", **arguments)
        with patch.object(witness, "_post", side_effect=OSError("offline")):
            cls.unwitnessed = validation.validation_register(world.profile, other["candidate"], op_id="v:unwitnessed",
                                                             **arguments)
        cls.backups = Path(tempfile.mkdtemp(prefix="backups-", dir="/tmp"))
        cls.addClassCleanup(shutil.rmtree, cls.backups, True)
        cls.profile = replace(world.profile, backup_root=cls.backups / "export")

    def setUp(self):
        self.world = self.__class__.world

    def reader(self):
        return db.connect(self.profile, "reader")

    def admin_sql(self, *statements: str) -> None:
        conn = self.world.service.admin(self.world.profile)
        try:
            with conn.cursor() as cursor:
                for statement in statements:
                    cursor.execute(statement)
        finally:
            conn.close()

    def test_1_the_review_reports_what_the_records_lack_and_the_export_writes_the_manifest(self):
        with self.reader() as conn:
            found = review.review_all(conn)
        self.assertEqual(found["history"]["status"], "no_backup")
        self.assertEqual(codes(found), ["CAPTURE_MISSING", "FINGERPRINT_MISSING", "SEALED_RESULT_MISSING",
                                        "SOURCE_NOT_IN_GRID", "WITNESS_MISSING"])
        self.assertTrue(found["tests_run"] >= 7)
        missing = [item for item in found["findings"] if item["code"] == "WITNESS_MISSING"]
        self.assertEqual([item["record_id"] for item in missing], [str(self.unwitnessed["registration_id"])])
        with db.connect(self.profile, "writer") as writer:
            self.assertEqual(refused(review.review_all, writer).code, "LEDGER_PERMISSION")
        exported = admin.export_history(self.profile, self.profile.backup_root, run_ids=[self.fixture_run])
        manifest = json.loads(Path(exported["manifest_path"]).read_text())
        self.assertEqual((manifest["ledger_name"], manifest["commit"], len(manifest["runs"])),
                         (self.profile.name, exported["commit"], 1))
        self.assertEqual(manifest["runs"][0]["registration_bundle"], "registration-root")
        self.assertTrue((Path(exported["backup_path"])).is_dir())
        self.assertTrue((self.profile.backup_root / "reproduce" / "candidates" / "rsi@1.py").is_file())
        with self.reader() as conn:
            self.assertEqual(review.review_all(conn)["history"]["status"], "ancestor")
        again = admin.export_history(self.profile, self.profile.backup_root, run_ids=[self.fixture_run],
                                     with_backup=False)
        self.assertEqual(again["runs"], 1, "an earlier export of this ledger is refreshed")

    def test_2_an_export_goes_outside_checkouts_and_names_only_sealed_runs(self):
        inside = db.REPOSITORY / "export-here"
        self.assertEqual(refused(admin.export_history, self.profile, inside).code, "EXPORT_PATH_INVALID")
        foreign = self.backups / "foreign"
        foreign.mkdir()
        self.assertEqual(refused(admin.export_history, self.profile, foreign).code, "EXPORT_PATH_INVALID")
        self.assertEqual(refused(admin.export_history, self.profile, self.backups / "new", run_ids=[999],
                                 with_backup=False).code, "UNKNOWN_RUN")
        broken = self.backups / "broken"
        admin.export_history(self.profile, broken, run_ids=[self.fixture_run], with_backup=False)
        (broken / "backup").write_text("not a backup directory")
        self.assertEqual(refused(admin.export_history, self.profile, broken, run_ids=[self.fixture_run]).code,
                         "DOLT_BACKUP")

    def test_3_the_out_of_sample_report_lists_the_registration_family_and_no_verdict(self):
        found = comparison.validation_report(self.profile, self.witnessed["registration_id"])
        self.assertEqual(found["registration"]["candidate"], "rsi@1")
        self.assertTrue(found["witness"]["verified"])
        self.assertEqual((found["binding"], found["metrics"], found["single"]), (None, None, None))
        self.assertTrue(any(item.startswith("UNBOUND") for item in found["limitations"]))
        self.assertEqual([member["registration_id"] for member in found["family"]["members"]],
                         [self.witnessed["registration_id"], self.unwitnessed["registration_id"]])
        self.assertEqual(found["family"]["interval_coverage"], 1 - DESIGN["alpha"] / 2)
        self.assertEqual([item["status"] for item in found["same_candidate_registrations"]], ["unbound"])
        unwitnessed = comparison.validation_report(self.profile, self.unwitnessed["registration_id"])
        self.assertFalse(unwitnessed["witness"]["verified"])
        self.assertEqual(refused(comparison.validation_report, self.profile, 999).code, "REGISTRATION_UNKNOWN")

    def test_4_a_run_without_its_recorded_identity_cannot_be_compared_by_identity(self):
        exc = refused(status.affected_runs, self.profile, {"runtime": {"image_digest": "sha256:" + "c" * 64}})
        self.assertEqual(exc.code, "RUN_IDENTITY_MISSING")

    def test_5_tampering_through_the_administrator_is_found(self):
        self.admin_sql("UPDATE candidate SET description = 'rewritten' WHERE strategy_id = 'rsi' AND revision = 1",
                       "CALL DOLT_COMMIT('-a', '-m', 'tamper: change a row')")
        admin.export_history(self.profile, self.profile.backup_root, run_ids=[self.fixture_run])  # backs up this head
        self.admin_sql("CALL DOLT_COMMIT('--amend', '--allow-empty', '-m', 'tamper: amend the backed-up head')")
        self.admin_sql("INSERT INTO trial (purpose, source_sha256, image_ref, instruments, input_start, trade_start, "
                       "trade_end, op_id, created_at) VALUES ('research', REPEAT('9', 64), "
                       f"'{RUNTIME['image_ref']}', '[]', '2026-01-01', '2026-01-02', '2026-01-03', 'tamper', "
                       "UTC_TIMESTAMP(6))",
                       "CALL DOLT_COMMIT('-a', '-m', 'tamper: an unpublished source', '--skip-verification')")
        with self.reader() as conn:
            found = review.review_all(conn)
        self.assertIn("ROW_CHANGED", codes(found))
        self.assertIn("COMMIT_TEST_FAILED", codes(found))
        self.assertEqual((found["history"]["status"], "HISTORY_REWRITTEN" in codes(found)), ("not_ancestor", True))
        changed = next(item for item in found["findings"] if item["code"] == "ROW_CHANGED")
        self.assertEqual((changed["table"], changed["record_id"]), ("candidate", "rsi/1"))
        self.admin_sql("SET FOREIGN_KEY_CHECKS = 0",
                       f"INSERT INTO registration_attempt VALUES ('registration-root', '{'8' * 64}', 9999)",
                       "CALL DOLT_COMMIT('-a', '-m', 'tamper: a dangling attempt', '--skip-verification')")
        self.assertEqual(refused(status.research_status, self.profile).code, "REFERENTIAL_GAP")


@unittest.skipUnless(BINARY, SKIP)
class CrossImageTests(unittest.TestCase):
    """Two passed runs of one source on the same inputs: a retry of an attempt without economic evidence."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("cross")
        cls.addClassCleanup(world.close)
        (ref,) = registered_grid(world, ["same"], "registration-r1")
        cls.first = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                              hypothesis="registration-r1")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.first["trial_id"]}])
        body = world.plan("registration-r1")["body"]
        world.qualification.unavailable.add(cls.first["run_id"])  # the stand-in registration sees no evidence
        world.register("registration-r2", {**body, "retry_of": "registration-r1"})
        world.fingerprint = FINGERPRINT
        cls.second = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                               hypothesis="registration-r2")
        world.qualification.unavailable.clear()
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.second["trial_id"]}])
        (other,) = registered_grid(world, ["other"], "registration-other")
        cls.other = entry.run(world.profile, world.market, MARKET_COMMIT, other, None, RUNNER_ARGV,
                              hypothesis="registration-other")

    def setUp(self):
        self.world = self.__class__.world
        self.calls = []

    def fake_reproduce(self, complete: bool):
        def reproduce_run(run_id, output, ledger):
            self.calls.append(run_id)
            (output / "reports").mkdir(parents=True)
            for name in ("summary.json", "orders.csv", "fills.csv", "positions.csv", "account.csv",
                         "returns_series.csv", "order_events.jsonl.gz")[:None if complete else 3]:
                (output / "reports" / name).write_text("{}")
            return {"directory": str(output), "run_id": run_id, "fingerprints_match": True}
        return reproduce_run

    def test_two_reproduced_runs_go_to_the_engine_comparison(self):
        compared = []
        with seams.use(reproduce=self.fake_reproduce(True),
                       compare_reports=lambda left, right: compared.append((left.name, right.name)) or {"passed": True}):
            found = reproduce.compare_runs(self.world.profile, self.first["run_id"], self.second["run_id"])
        self.assertEqual((found["passed"], self.calls, compared), (True, [self.first["run_id"], self.second["run_id"]],
                                                                    [("reports", "reports")]))
        self.assertEqual(found["reference"]["run_id"], self.first["run_id"])
        with seams.use(reproduce=self.fake_reproduce(False)):
            self.assertEqual(refused(reproduce.compare_runs, self.world.profile, self.first["run_id"],
                                     self.second["run_id"]).code, "EXPORT_INCOMPLETE")

    def test_the_cross_image_comparison_needs_two_passed_runs_of_the_same_inputs(self):
        profile = self.world.profile
        self.assertEqual(refused(reproduce.compare_runs, profile, 1, 1).code, "SAME_RUN")
        self.assertEqual(refused(reproduce.compare_runs, profile, self.first["run_id"], 999).code, "UNKNOWN_RUN")
        self.assertEqual(refused(reproduce.compare_runs, profile, self.first["run_id"], self.other["run_id"]).code,
                         "PAIR_INPUT_MISMATCH")
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.other["trial_id"]}])
        self.world.scenario = {"audit_exit": 1}
        (bad,) = registered_grid(self.world, ["bad"], "registration-bad")
        invalid = entry.run(profile, self.world.market, MARKET_COMMIT, bad, None, RUNNER_ARGV,
                            hypothesis="registration-bad")
        self.world.scenario = {}
        self.assertEqual(refused(reproduce.compare_runs, profile, self.first["run_id"], invalid["run_id"]).code,
                         "RUN_INCOMPLETE")


if __name__ == "__main__":
    unittest.main()
