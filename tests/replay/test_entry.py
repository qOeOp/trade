"""The replay entry with a stand-in runtime: explorations and prechecks keep their directories,
sealed research replays become runs, and every failure is recorded rather than hidden."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ledger import db, execution, metrics, trials
from ledger.errors import Refusal
from registration import inputs as registration_inputs, precheck, seams as registration_seams
from replay import entry, seams
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_COMMIT, SKIP, source
from tests.registration.world import LINE_WINDOW, RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid


ONE = RUNNER_ARGV + ["--symbols", "AAAUSDT"]


def codes(reasons) -> list[str]:
    return [reason["code"] for reason in reasons]


class ProblemTests(unittest.TestCase):
    """Invalidity reasons come from exit codes, files and structured fields, each listed on its own."""

    def directory(self, audit=None, failures: str | None = None) -> Path:
        root = Path(tempfile.mkdtemp())
        self.addCleanup(__import__("shutil").rmtree, root, True)
        (root / "audit").mkdir()
        (root / "reports").mkdir()
        if audit is not None:
            (root / "audit" / "audit.json").write_text(audit if isinstance(audit, str) else json.dumps(audit))
        if failures is not None:
            (root / "reports" / "runtime_failures.jsonl").write_text(failures)
        return root

    def test_audit_problems_list_every_failure_without_reading_logs(self):
        reasons, audit = entry.audit_problems(self.directory(), 3, None)
        self.assertEqual((codes(reasons), audit), (["NATIVE_EXIT_NONZERO", "AUDIT_NOT_RUN", "AUDIT_RESULT_MISSING"], None))
        reasons, _ = entry.audit_problems(self.directory("{not json"), 0, 1)
        self.assertEqual(codes(reasons), ["AUDIT_EXIT_NONZERO", "AUDIT_RESULT_UNREADABLE"])
        reasons, audit = entry.audit_problems(self.directory({"passed": False, "findings": ["fill F-1 unmatched",
                                                                                            "order O-2 naked"]}), 0, 1)
        self.assertEqual([reason["locator"] for reason in reasons if reason["code"] == "AUDIT_FINDINGS"],
                         ["fill F-1 unmatched", "order O-2 naked"])
        self.assertEqual(audit["passed"], False)
        self.assertEqual(entry.audit_problems(self.directory({"passed": True, "findings": []}), 0, 0)[0], [])

    def test_runtime_failure_receipts_invalidate_even_a_clean_exit(self):
        passed = {"passed": True, "findings": []}
        structured = json.dumps({"stage": "on_bar", "exception_type": "KeyError", "instrument_id": "AAAUSDT-PERP"})
        reasons, _ = entry.audit_problems(self.directory(passed, structured + "\n"), 0, 0)
        self.assertEqual([(reason["code"], reason["locator"]) for reason in reasons],
                         [("RUNTIME_FAILURE_RECORDED", "on_bar:AAAUSDT-PERP")])
        self.assertEqual(codes(entry.audit_problems(self.directory(passed, '{"callback": "on_bar"}\n'), 0, 0)[0]),
                         ["RUNTIME_FAILURE_MALFORMED"])
        self.assertEqual(codes(entry.audit_problems(self.directory(passed, "Traceback ...\n"), 0, 0)[0]),
                         ["RUNTIME_FAILURE_UNREADABLE"])

    def test_the_native_summary_must_carry_the_trial_identity(self):
        identity = dict(IDENTITY)
        good = {"source_sha256": "a" * 64, "runtime_identity": identity, "effective_config_sha256": "c" * 64,
                "integrity_passed": True}
        self.assertEqual(entry.summary_problems(good, "a" * 64, identity, "c" * 64), [])
        self.assertEqual(codes(entry.summary_problems(None, "a" * 64, identity, "c" * 64)), ["SUMMARY_MISSING"])
        other = {**good, "source_sha256": "b" * 64, "runtime_identity": {**identity, "image_digest": "x"},
                 "effective_config_sha256": None, "integrity_passed": False}
        reasons = entry.summary_problems(other, "a" * 64, identity, "c" * 64)
        self.assertEqual(codes(reasons), ["SOURCE_MISMATCH", "RUNTIME_MISMATCH", "CONFIG_MISMATCH",
                                          "RUNNER_INTEGRITY_FAILED"])
        self.assertEqual(reasons[1]["locator"], "image_digest")


@unittest.skipUnless(BINARY, SKIP)
class ExploreAndPrecheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = ReplayWorld("explore")
        cls.addClassCleanup(cls.world.close)

    def setUp(self):
        self.world = self.__class__.world
        self.world.scenario = {}

    def count(self, table: str) -> int:
        return self.world.service.sql(self.world.profile, f"SELECT COUNT(*) FROM {table}")[0][0]

    def explore(self, name: str, **overrides):
        arguments = {"ledger": self.world.profile, "market": self.world.market, "at": MARKET_COMMIT,
                     "strategy_file": self.world.strategy_file(source(name), f"{name}.py"), "strategy_class": "Fixture",
                     "output": self.world.output(name), "runtime": None, "runner_argv": ONE, **overrides}
        return entry.explore(**arguments)

    def test_an_exploration_keeps_its_reports_and_the_ledger_its_trial_and_capture(self):
        explored = self.explore("draft")
        self.assertEqual((explored["purpose"], explored["status"], explored["problems"]), ("explore", "passed", []))
        self.assertTrue((Path(explored["path"]) / "reports" / "fills.csv").is_file())
        self.assertEqual(explored["metrics"]["metrics"]["populations"]["fills"], 2)
        capture = execution.read_capture(self.world.conn, explored["trial_id"])
        self.assertEqual((capture["status"], capture["purpose"], capture["stages"]["audit"]["exit_code"]),
                         ("captured", "explore", 0))
        self.assertNotIn("reports/fills.csv", capture["statuses"])
        runner = self.world.commands[-2]
        self.assertEqual(runner["mounts"]["/reports"], str(Path(explored["path"]) / "reports"))
        self.assertNotIn("/strategy", self.world.commands[-1]["mounts"], "the auditor never sees the source")
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM run WHERE trial_id = %s",
                                                (explored["trial_id"],))[0][0], 0)

    def test_an_exploration_is_refused_before_any_trial_or_process(self):
        trials_before, commands = self.count("trial"), len(self.world.commands)
        existing = self.world.output("exists")
        existing.mkdir()
        cases = [({"runner_argv": ONE + ["--output", "/x"]}, "RUNNER_OPTION_RESERVED"),
                 ({"runner_argv": ONE + ["--pool=/x"]}, "RUNNER_OPTION_RESERVED"),
                 ({"output": Path.home() / "not-a-temporary-output"}, "NOT_TEMPORARY_PATH"),
                 ({"output": existing}, "PATH_EXISTS"),
                 ({"strategy_class": "Not A Class"}, "ENTRY_CLASS_INVALID")]
        for overrides, code in cases:
            with self.subTest(code=code), self.assertRaises(Refusal) as caught:
                self.explore("refused", **overrides)
            self.assertEqual(caught.exception.code, code)
        self.assertEqual((self.count("trial"), len(self.world.commands)), (trials_before, commands))

    def test_a_runner_without_reports_is_recorded_and_the_auditor_never_starts(self):
        self.world.scenario = {"skip_reports": True, "native_exit": 3}
        explored = self.explore("broken")
        self.assertEqual(explored["status"], "invalid")
        self.assertEqual(codes(explored["problems"]), ["NATIVE_EXIT_NONZERO", "AUDIT_NOT_RUN", "AUDIT_RESULT_MISSING"])
        capture = execution.read_capture(self.world.conn, explored["trial_id"])
        self.assertEqual((capture["stages"]["native"]["exit_code"], capture["stages"]["audit"],
                          capture["statuses"]["audit/audit.json"]), (3, None, "not_started"))

    def test_an_interrupted_replay_is_sealed_as_interrupted_and_reraised(self):
        def interrupt(command, stdout, stderr):
            raise KeyboardInterrupt
        trials_before = self.count("trial")
        with seams.use(run=interrupt), self.assertRaises(KeyboardInterrupt):
            self.explore("interrupted")
        (trial_id,), = self.world.service.sql(self.world.profile, "SELECT MAX(trial_id) FROM trial")[0:1]
        self.assertEqual(self.count("trial"), trials_before + 1)
        capture = execution.read_capture(self.world.conn, trial_id)
        self.assertEqual((capture["outcome"]["kind"], capture["stages"]["native"]["state"]), ("interrupted", "started"))
        self.assertTrue(self.world.output("interrupted").is_dir())

    def test_a_precheck_needs_a_ci_build_of_the_candidate_contract(self):
        def precheck_call(**overrides):
            arguments = {"ledger": self.world.profile, "market": self.world.market, "at": MARKET_COMMIT,
                         "candidate": "rsi@1", "runtime": None, "runner_argv": ONE,
                         "output": self.world.output("refused-precheck"), **overrides}
            return entry.precheck(**arguments)
        with seams.use(build_revision=lambda identity: None), self.assertRaises(Refusal) as caught:
            precheck_call()
        self.assertEqual(caught.exception.code, "RUNTIME_NOT_CI_BUILT")
        other = {**IDENTITY, "runtime_contract": "r0-other"}
        with registration_seams.use(resolve_runtime=lambda ref: dict(other)), self.assertRaises(Refusal) as caught:
            precheck_call()
        self.assertEqual(caught.exception.code, "RUNTIME_CONTRACT_MISMATCH")
        with self.assertRaises(Refusal) as caught:
            precheck_call(candidate="rsi@99")
        self.assertEqual(caught.exception.code, "UNKNOWN_CANDIDATE")

    def test_a_passed_precheck_seals_its_reports_and_a_review_of_it_admits_the_source(self):
        published = self.world.publish("prechecked", parent=None)
        checked = entry.precheck(self.world.profile, self.world.market, MARKET_COMMIT, published["candidate"], None,
                                 ONE, self.world.output("precheck"))
        self.assertEqual((checked["status"], checked["problems"]), ("passed", []))
        capture = execution.read_capture(self.world.conn, checked["trial_id"])
        self.assertIn("reports/fills.csv", capture["files"])
        review = precheck.record_review(self.world.profile, self.world.review_body(checked["trial_id"]), "reviewer-b")
        self.assertEqual(precheck.require_precheck(self.world.conn, review["bundle"], published["source_sha256"],
                                                   checked["image_ref"], checked["input_key"]), checked["trial_id"])


@unittest.skipUnless(BINARY, SKIP)
class SealedReplayTests(unittest.TestCase):
    """Five root grid points, each consumed by one sealed research replay."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("sealed")
        cls.addClassCleanup(world.close)
        cls.refs = registered_grid(world, ["g1", "g2", "g3", "g4", "g5"])

    def setUp(self):
        self.world = self.__class__.world
        self.world.scenario = {}

    def run_ref(self, ref: str, **overrides):
        arguments = {"ledger": self.world.profile, "market": self.world.market, "at": MARKET_COMMIT, "strategy": ref,
                     "runtime": None, "runner_argv": RUNNER_ARGV, "hypothesis": "registration-grid", **overrides}
        return entry.run(**arguments)

    def rows(self, statement: str, params=()) -> list[tuple]:
        return self.world.service.sql(self.world.profile, statement, params)

    def kept(self) -> list[Path]:
        return sorted(self.world.tmp.glob("replay-run-*"))

    def test_a_research_replay_is_stored_as_a_run_and_its_directory_removed(self):
        before = self.kept()
        stored = self.run_ref(self.refs[0])
        self.assertEqual((stored["purpose"], stored["status"], stored["failure_reasons"]), ("research", "passed", []))
        (status, audit, fingerprints), = self.rows("SELECT status, audit, fingerprints FROM run WHERE run_id = %s",
                                                   (stored["run_id"],))
        self.assertEqual((status, json.loads(audit), fingerprints), ("passed", {"ran": True, "findings": []}, None))
        (revision, report), = self.rows("SELECT metrics_revision, report FROM run_sealed WHERE run_id = %s",
                                        (stored["run_id"],))
        self.assertEqual((json.loads(report)["metrics_revision"], json.loads(report)["populations"]["fills"]),
                         (revision, 2))
        self.assertEqual(self.rows("SELECT COUNT(*) FROM run_return WHERE run_id = %s", (stored["run_id"],)),
                         [(31,)])
        self.assertEqual(self.rows("SELECT instrument_id, realized_pnl, price_pnl FROM run_cycle WHERE run_id = %s",
                                   (stored["run_id"],)),
                         [("AAAUSDT-PERP.BINANCE", metrics.Decimal("9.8"), metrics.Decimal("10"))])
        self.assertEqual(self.rows("SELECT registration_bundle FROM registration_attempt WHERE trial_id = %s",
                                   (stored["trial_id"],)), [("registration-grid",)])
        self.assertEqual(self.kept(), before)
        with self.assertRaises(Refusal) as caught:
            trials.ingest_run(self.world.conn, stored["trial_id"], self.world.tmp, [{"code": "LATE"}], {}, {}, {})
        self.assertEqual(caught.exception.code, "RUN_ALREADY_INGESTED")

    def test_a_sealed_replay_names_exactly_one_registration(self):
        for overrides in ({"hypothesis": None}, {"validation": 1}):
            with self.subTest(overrides=overrides), self.assertRaises(Refusal) as caught:
                self.run_ref(self.refs[1], **overrides)
            self.assertEqual(caught.exception.code, "REGISTRATION_REQUIRED")

    def test_a_validation_replay_needs_a_fresh_checkout_before_any_export(self):
        stale = Path(tempfile.mkdtemp(dir=self.world.tmp))
        before, exports = self.rows("SELECT COUNT(*) FROM trial"), self.world.market.exports
        with registration_seams.use(checkout=lambda: stale), self.assertRaises(Refusal) as caught:
            self.run_ref(self.refs[4], hypothesis=None, validation=1)
        self.assertEqual((caught.exception.code, self.rows("SELECT COUNT(*) FROM trial"), self.world.market.exports),
                         ("STALE_CHECKOUT", before, exports))

    def test_a_failed_replay_is_stored_invalid_with_every_reason_and_consumes_its_point(self):
        self.world.scenario = {"native_exit": 2, "summary": {"strategy_source_sha256": "0" * 64}}
        stored = self.run_ref(self.refs[1])
        self.assertEqual(stored["status"], "invalid")
        self.assertEqual(sorted(codes(stored["failure_reasons"])), ["NATIVE_EXIT_NONZERO", "SOURCE_MISMATCH"])
        self.assertEqual(self.rows("SELECT COUNT(*) FROM run_sealed WHERE run_id = %s", (stored["run_id"],)), [(0,)])
        with self.assertRaises(Refusal) as caught:
            self.run_ref(self.refs[1])
        self.assertEqual(caught.exception.code, "GRID_ALREADY_ATTEMPTED")

    def test_inputs_changed_during_the_replay_make_it_invalid(self):
        self.world.scenario = {"tamper_export": True}
        stored = self.run_ref(self.refs[2])
        self.assertEqual(codes(stored["failure_reasons"]), ["INPUTS_CHANGED"])

    def test_inputs_changed_before_execution_refuse_without_a_trial(self):
        exported = registration_inputs.market_inputs(self.world.market, MARKET_COMMIT, LINE_WINDOW, {"universe": True},
                                                     None, True)
        exported["identity"] = {**exported["identity"], "export_content_sha256": "0" * 64}
        before = self.rows("SELECT COUNT(*) FROM trial")
        with db.connect(self.world.profile, "writer") as conn, self.assertRaises(Refusal) as caught:
            revision = __import__("ledger.strategies", fromlist=["x"]).read_candidate(conn, self.refs[3])
            entry.seal(self.world.profile, conn, revision, None, exported, RUNNER_ARGV, "registration-grid", None)
        self.assertEqual((caught.exception.code, self.rows("SELECT COUNT(*) FROM trial")),
                         ("EXPORT_CHANGED_BEFORE_EXECUTION", before))

    def test_a_kept_directory_is_stored_only_with_its_audit_and_reports(self):
        real = trials.ingest_run
        with patch.object(entry.trials, "ingest_run", side_effect=RuntimeError("host lost the ledger")), \
                self.assertRaises(RuntimeError):
            self.run_ref(self.refs[3])
        (trial_id,), = self.rows("SELECT MAX(trial_id) FROM trial")
        start = execution.read_capture(self.world.conn, trial_id)["start"]
        workdir, identity = Path(start["workdir"]), start["input_identity"]
        self.assertIn(workdir, self.kept())
        audit = workdir / "audit" / "audit.json"
        saved = audit.read_bytes()
        audit.unlink()
        with self.assertRaises(Refusal) as caught:
            real(self.world.conn, trial_id, workdir, [], {}, {}, identity)
        self.assertEqual(caught.exception.code, "AUDIT_RESULT_INCONSISTENT")
        audit.write_bytes(saved)
        fills = workdir / "reports" / "fills.csv"
        fills.rename(workdir / "fills.csv")
        with self.assertRaises(Refusal) as caught:
            real(self.world.conn, trial_id, workdir, [], {}, {}, identity)
        self.assertEqual(caught.exception.code, "REPORT_MISSING")
        (workdir / "fills.csv").rename(fills)
        stored = real(self.world.conn, trial_id, workdir, [], {}, {}, identity)
        self.assertEqual(stored["status"], "passed")
        again = real(self.world.conn, trial_id, workdir, [], {}, {}, identity)
        self.assertEqual((again["run_id"], again["replayed"]), (stored["run_id"], True))
        explore_trial = self.rows("SELECT MIN(trial_id) FROM trial WHERE purpose = 'precheck'")[0][0]
        with self.assertRaises(Refusal) as caught:
            real(self.world.conn, explore_trial, workdir, [], {}, {}, identity)
        self.assertEqual(caught.exception.code, "TRIAL_PURPOSE_INVALID")


if __name__ == "__main__":
    unittest.main()
