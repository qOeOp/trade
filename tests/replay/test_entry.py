"""The replay entry with a stand-in runtime: explorations and prechecks keep their directories,
sealed research replays become runs, and every failure is recorded rather than hidden."""

from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from ledger import db, execution, metrics, trials
from ledger.errors import Refusal
from registration import inputs as registration_inputs, precheck, seams as registration_seams
from replay import entry, seams
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_COMMIT, SKIP, source
from tests.registration.world import LINE_WINDOW, RUNNER_ARGV
from tests.replay.world import DEFAULT_FINGERPRINT, ReplayWorld, inspect, registered_grid


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


class ExecutionBindingTests(unittest.TestCase):
    """The execution binding every replay writes is the one the real runner reads (engine.run)."""

    def test_the_runner_accepts_the_binding_the_entry_writes_from_its_probe(self):
        from engine import config as engine_config, run as engine_run
        workdir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, workdir, True)
        (workdir / entry.SOURCE).mkdir()
        argv = ["--market-root", "/inputs/market", "--market-commit", "c" * 32, "--symbols", "AAAUSDT",
                "--start", "2026-01-01T00:00:00Z", "--end", "2026-01-02T00:00:00Z"]
        inspection = engine_config.describe(engine_config.parse_configuration(["--describe", *argv]))
        options = entry._strategy_argv(workdir, IDENTITY, inspection, "Fixture", "a" * 64)
        binding = options[options.index("--execution-binding") + 1]
        self.assertEqual(binding, f"{entry.STRATEGY_DIR}/{entry.EXECUTION_BINDING}")
        written = workdir / entry.SOURCE / entry.EXECUTION_BINDING
        local = [*options[:options.index("--execution-binding")], "--execution-binding", str(written), "--output",
                 str(workdir / "reports")]
        config = engine_config.parse_configuration([*argv, *local])
        self.assertEqual(engine_run.execution_metadata(config)["effective_config_sha256"],
                         inspection["effective_config_sha256"])
        other = engine_config.parse_configuration([*argv[:-1], "2026-01-03T00:00:00Z", *local])
        with self.assertRaisesRegex(Exception, "EXECUTION_BINDING_MISMATCH: .* in end"):
            engine_run.execution_metadata(other)


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
        self.assertEqual(explored["metrics"]["populations"]["fills"], 2)
        capture = execution.read_capture(self.world.conn, explored["trial_id"])
        self.assertEqual((capture["status"], capture["purpose"], capture["stages"]["audit"]["exit_code"]),
                         ("captured", "explore", 0))
        self.assertNotIn("reports/fills.csv", capture["files"], "an exploration's reports stay a working copy")
        runner, auditor = (next(spec for spec in reversed(self.world.commands) if spec["module"] == kind)
                           for kind in ("runner", "audit"))
        self.assertEqual(runner["mounts"]["/reports"], str(Path(explored["path"]) / "reports"))
        self.assertNotIn("/strategy", auditor["mounts"], "the auditor never sees the source")
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM run WHERE trial_id = %s",
                                                (explored["trial_id"],))[0][0], 0)

    def test_an_exploration_is_refused_before_any_trial_or_process(self):
        trials_before, commands = self.count("trial"), len(self.world.commands)
        existing = self.world.output("exists")
        existing.mkdir()
        cases = [({"runner_argv": ONE + ["--output", "/x"]}, "RUNNER_OPTION_RESERVED"),
                 ({"runner_argv": ONE + ["--market-root=/x"]}, "RUNNER_OPTION_RESERVED"),
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
        def interrupt(command, stdout, stderr, timeout):
            raise KeyboardInterrupt
        trials_before = self.count("trial")
        with seams.use(run=interrupt), self.assertRaises(KeyboardInterrupt):
            self.explore("interrupted")
        (trial_id,), = self.world.service.sql(self.world.profile, "SELECT MAX(trial_id) FROM trial")[0:1]
        self.assertEqual(self.count("trial"), trials_before + 1)
        capture = execution.read_capture(self.world.conn, trial_id)
        self.assertEqual((capture["outcome"]["kind"], capture["stages"]["native"]["state"]), ("interrupted", "started"))
        self.assertTrue(self.world.output("interrupted").is_dir())
        name = entry.container_name(self.world.profile, trial_id, "native")
        self.assertEqual((self.world.stopped[-1], self.world.commands[-1]["name"]), (name, name),
                         "the interrupted container is stopped by its name")

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
        runner = next(spec for spec in reversed(self.world.commands) if spec["module"] == "runner")
        self.assertEqual(runner["argv"][runner["argv"].index("--execution-binding") + 1],
                         f"{entry.STRATEGY_DIR}/{entry.EXECUTION_BINDING}", "a precheck loads as a sealed replay")
        review = precheck.record_review(self.world.profile, self.world.review_body(checked["trial_id"]), "reviewer-b")
        self.assertEqual(precheck.require_precheck(self.world.conn, review["bundle"], published["source_sha256"],
                                                   checked["image_ref"], checked["input_key"]), checked["trial_id"])

    def test_precheck_reports_window_exposure_before_execution_without_refusing_long_windows(self):
        for end, eligible in (("2026-01-08T00:00:00Z", True), ("2026-01-08T00:01:00Z", False)):
            with self.subTest(end=end):
                published = self.world.publish(f"exposure-{end}", parent=None)
                argv = ONE.copy()
                argv[argv.index("--end") + 1] = end
                stderr = io.StringIO()
                execute = entry.execute

                def observed_execution(*args, **kwargs):
                    self.assertIn("exposure exemption permits at most 7 trading days", stderr.getvalue())
                    return execute(*args, **kwargs)

                with contextlib.redirect_stderr(stderr), patch.object(entry, "execute", observed_execution):
                    checked = entry.precheck(self.world.profile, self.world.market, MARKET_COMMIT,
                                             published["candidate"], None, argv,
                                             self.world.output(f"exposure-{eligible}"))
                self.assertEqual(checked["status"], "passed", "exposure advice is not a new refusal")
                self.assertIs(checked["exposure_exemption"]["within_window_limit"], eligible)
                self.assertEqual(checked["exposure_exemption"]["maximum_exempt_days"], precheck.PRECHECK_MAX_DAYS)
                if not eligible:
                    self.assertIn("prevents its first research registration", stderr.getvalue())


@unittest.skipUnless(BINARY, SKIP)
class SealedReplayTests(unittest.TestCase):
    """Root grid points, each consumed by one sealed research replay."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("sealed")
        cls.addClassCleanup(world.close)
        cls.refs, cls.bundle_of = [], {}
        for bundle, tags in (("registration-grid", range(1, 6)), ("registration-grid-b", range(6, 11)),
                             ("registration-grid-c", range(11, 14)), ("registration-grid-d", range(14, 15)),
                             ("registration-grid-e", range(15, 16)), ("registration-grid-f", range(16, 18))):
            refs = registered_grid(world, [f"g{index}" for index in tags], bundle)
            cls.refs += refs
            cls.bundle_of.update(dict.fromkeys(refs, bundle))

    def setUp(self):
        self.world = self.__class__.world
        self.world.scenario = {}

    def run_ref(self, ref: str, **overrides):
        arguments = {"ledger": self.world.profile, "market": self.world.market, "at": MARKET_COMMIT, "strategy": ref,
                     "runtime": None, "runner_argv": RUNNER_ARGV, "hypothesis": self.bundle_of[ref], **overrides}
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
        self.assertEqual((status, json.loads(audit), json.loads(fingerprints)),
                         ("passed", {"ran": True, "findings": []}, DEFAULT_FINGERPRINT))
        capture = execution.read_capture(self.world.conn, stored["trial_id"])
        self.assertEqual(capture["stages"]["fingerprint"], {"state": "exited", "exit_code": 0})
        # Each fact once: the source is the candidate's, the coverage receipt the start receipt's, the
        # fingerprint the run row's and the reports a working copy; the capture keeps their hashes.
        hashed = ("source/strategy.py", "input-coverage.json", "fingerprint/fingerprint.json", "reports/fills.csv")
        self.assertEqual({path: capture["statuses"][path] for path in hashed}, dict.fromkeys(hashed, "hashed"))
        self.assertEqual(self.rows("SELECT path FROM evidence WHERE bundle = %s ORDER BY path",
                                   (f"trial-{stored['trial_id']}-execution-start",)),
                         [("execution.json",), ("input-coverage.json",)])
        (revision, report), = self.rows("SELECT metrics_revision, report FROM run_sealed WHERE run_id = %s",
                                        (stored["run_id"],))
        self.assertEqual(("metrics_revision" in json.loads(report), json.loads(report)["populations"]["fills"]),
                         (False, 2))
        loaded = metrics.load_run(self.world.conn, stored["run_id"])
        self.assertEqual(metrics.latest_sealed(self.world.conn, stored["run_id"], loaded["sealed"])["metrics_revision"],
                         revision)
        self.assertEqual(self.rows("SELECT COUNT(*) FROM run_return WHERE run_id = %s", (stored["run_id"],)),
                         [(31,)])
        self.assertEqual(self.rows("SELECT instrument_id, realized_pnl, price_pnl FROM run_cycle WHERE run_id = %s",
                                   (stored["run_id"],)),
                         [("AAAUSDT-PERP.BINANCE", metrics.Decimal("9.8"), metrics.Decimal("10"))])
        self.assertEqual(self.rows("SELECT registration_bundle FROM registration_attempt WHERE trial_id = %s",
                                   (stored["trial_id"],)), [("registration-grid",)])
        self.assertEqual(self.kept(), before)
        start = capture["start"]
        with self.assertRaises(Refusal) as caught:
            trials.ingest_run(self.world.conn, stored["trial_id"], Path(start["workdir"]), start["input_identity"],
                              checkout=self.world.checkout)
        self.assertEqual(caught.exception.code, "RUN_ALREADY_INGESTED")

    def ingest(self, trial_id: int, workdir: Path | None = None) -> dict:
        capture = execution.read_capture(self.world.conn, trial_id)
        start = capture["start"]
        return trials.ingest_run(self.world.conn, trial_id, workdir or Path(start["workdir"]), start["input_identity"],
                                 checkout=self.world.checkout)

    @contextlib.contextmanager
    def keeps_directory(self, note: str = "replay directory kept for diagnosis: "):
        """The replay entry says on stderr which directory it keeps; held back here and checked."""
        with contextlib.redirect_stderr(io.StringIO()) as said:
            yield
        self.assertIn(note, said.getvalue())

    def interrupted_before_ingest(self, ref: str) -> tuple[int, Path]:
        """A research replay whose capture is sealed and whose ingest is interrupted: no run, directory kept."""
        with self.keeps_directory(), patch.object(entry.trials, "ingest_run", side_effect=KeyboardInterrupt), \
                self.assertRaises(KeyboardInterrupt):
            self.run_ref(ref)
        (trial_id,), = self.rows("SELECT MAX(trial_id) FROM trial")
        self.assertEqual(self.rows("SELECT COUNT(*) FROM run WHERE trial_id = %s", (trial_id,)), [(0,)])
        workdir = Path(execution.read_capture(self.world.conn, trial_id)["start"]["workdir"])
        self.assertIn(workdir, self.kept())
        return trial_id, workdir

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

    def test_a_replay_whose_fingerprint_stage_fails_is_stored_invalid(self):
        self.world.fingerprint = None
        try:
            stored = self.run_ref(self.refs[13])
        finally:
            self.world.fingerprint = DEFAULT_FINGERPRINT
        self.assertEqual((stored["status"], codes(stored["failure_reasons"])), ("invalid", ["FINGERPRINT_FAILED"]))

    def test_a_failed_replay_is_stored_invalid_with_every_reason_and_consumes_its_point(self):
        self.world.scenario = {"native_exit": 2, "summary": {"source_sha256": "0" * 64}}
        stored = self.run_ref(self.refs[1])
        self.assertEqual(stored["status"], "invalid")
        self.assertEqual(sorted(codes(stored["failure_reasons"])), ["NATIVE_EXIT_NONZERO", "SOURCE_MISMATCH"])
        self.assertEqual(self.rows("SELECT COUNT(*) FROM run_sealed WHERE run_id = %s", (stored["run_id"],)), [(0,)])
        before = self.kept()
        with self.assertRaises(Refusal) as caught:
            self.run_ref(self.refs[1])
        self.assertEqual(caught.exception.code, "GRID_ALREADY_ATTEMPTED")
        self.assertEqual(self.kept(), before, "a refusal before any container leaves no directory")

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

    def test_a_kept_directory_is_stored_only_as_it_was_sealed(self):
        with self.keeps_directory(), \
                patch.object(entry.trials, "ingest_run", side_effect=RuntimeError("host lost the ledger")), \
                self.assertRaises(RuntimeError):
            self.run_ref(self.refs[3])
        (trial_id,), = self.rows("SELECT MAX(trial_id) FROM trial")
        workdir = Path(execution.read_capture(self.world.conn, trial_id)["start"]["workdir"])
        self.assertIn(workdir, self.kept())
        audit, fills = workdir / "audit" / "audit.json", workdir / "reports" / "fills.csv"
        saved = audit.read_bytes()
        audit.unlink()
        self.assertEqual(self.refused(lambda: self.ingest(trial_id)), "EXECUTION_IDENTITY")
        audit.write_bytes(saved)
        fills.rename(workdir / "fills.csv")
        self.assertEqual(self.refused(lambda: self.ingest(trial_id)), "EXECUTION_IDENTITY")
        (workdir / "fills.csv").rename(workdir / "fills-target.csv")
        fills.symlink_to(workdir / "fills-target.csv")
        self.assertEqual(self.refused(lambda: self.ingest(trial_id)), "EXECUTION_IDENTITY", "a link is no report")
        fills.unlink()
        (workdir / "fills-target.csv").rename(fills)
        copy = Path(tempfile.mkdtemp(dir=self.world.tmp)) / "copy"
        shutil.copytree(workdir, copy)
        self.assertEqual(self.refused(lambda: self.ingest(trial_id, copy)), "EXECUTION_IDENTITY")
        stored = self.ingest(trial_id)
        self.assertEqual((stored["status"], stored["failure_reasons"]), ("passed", []))
        again = self.ingest(trial_id)
        self.assertEqual((again["run_id"], again["replayed"]), (stored["run_id"], True))
        precheck_trial = self.rows("SELECT MIN(trial_id) FROM trial WHERE purpose = 'precheck'")[0][0]
        self.assertEqual(self.refused(lambda: trials.ingest_run(self.world.conn, precheck_trial, workdir, {})),
                         "TRIAL_PURPOSE_INVALID")

    def refused(self, call) -> str:
        with self.assertRaises(Refusal) as caught:
            call()
        return caught.exception.code

    def test_ingest_takes_its_verdict_from_the_sealed_capture_only(self):
        # A failed audit, then the kept directory rewritten to look passed: the rewrite is refused.
        self.world.scenario = {"audit_passed": False, "findings": ["order O-2 naked: no stop"]}
        trial_id, workdir = self.interrupted_before_ingest(self.refs[5])
        (workdir / "audit" / "audit.json").write_text(json.dumps({"passed": True, "findings": []}))
        self.assertEqual(self.refused(lambda: self.ingest(trial_id)), "EXECUTION_IDENTITY")
        # Runtime failures and a failed integrity flag the caller never mentions still make the run invalid.
        self.world.scenario = {"summary": {"integrity_passed": False}, "runtime_failures": json.dumps(
            {"stage": "on_bar", "exception_type": "KeyError", "instrument_id": "AAAUSDT"}) + "\n"}
        trial_id, _ = self.interrupted_before_ingest(self.refs[6])
        stored = self.ingest(trial_id)
        self.assertEqual((stored["status"], sorted(codes(stored["failure_reasons"]))),
                         ("invalid", ["RUNNER_INTEGRITY_FAILED", "RUNTIME_FAILURE_RECORDED"]))

    def test_a_capture_refused_for_size_spends_the_point_as_an_invalid_run(self):
        self.world.scenario = {"audit_passed": False, "findings": ["lookahead"]}
        with self.keeps_directory("replay directory kept for diagnosis (capture refused for size): "), \
                patch.object(execution, "CAPTURE_LIMIT", 64):
            stored = self.run_ref(self.refs[7])
        self.assertEqual((stored["status"], codes(stored["failure_reasons"])), ("invalid", ["EXECUTION_CAPTURE_LIMIT"]))
        trial_id = stored["trial_id"]
        capture = execution.read_capture(self.world.conn, trial_id)
        self.assertEqual(capture["status"], "missing")
        recovery = self.rows("SELECT path FROM evidence WHERE bundle = %s ORDER BY path",
                             (f"trial-{trial_id}-recovery",))
        self.assertEqual(recovery, [("host-error.json",), ("recovery.json",)])
        workdir = Path(capture["start"]["workdir"])
        (workdir / "native.stdout.txt").unlink()
        (workdir / "audit" / "audit.json").write_text(json.dumps({"passed": True, "findings": []}))
        recorded = json.loads((workdir / execution.PROCESS).read_text())
        self.assertEqual(self.refused(lambda: execution.seal_capture(
            self.world.profile, trial_id, workdir, recorded["stages"], {"kind": "completed", "detail": None})),
            "BUNDLE_EXISTS")
        self.assertEqual(self.refused(lambda: self.ingest(trial_id)), "RUN_ALREADY_INGESTED")
        self.assertEqual(self.refused(lambda: self.run_ref(self.refs[7])), "GRID_ALREADY_ATTEMPTED")
        shutil.rmtree(workdir)

    def test_what_the_runner_wrote_but_the_report_cannot_read_makes_the_run_invalid(self):
        cases = [({"summary": {"market_commit": "z" * 32}}, "COVERAGE_MISMATCH"),
                 ({"corrupt_exposures": True}, "NATIVE_REPORT_UNREADABLE"),
                 ({"summary": {"final_equity_usdt": None}}, "SUMMARY_INCOMPLETE"),
                 ({"summary": {"period_start_utc": "the first of January"}}, "METRICS_UNREADABLE"),
                 # the summary's bars are not the effective configuration's execution bars
                 ({"summary": {"data_interval_minutes": 5}}, "CONFIG_MISMATCH"),
                 # the summary's hash is not the hash of the start receipt's configuration
                 ({"summary": {"effective_config_sha256": "0" * 64}}, "CONFIG_MISMATCH")]
        for (scenario, code), ref in zip(cases, [*self.refs[8:12], self.refs[14], self.refs[15]], strict=True):
            self.world.scenario = scenario
            with self.subTest(code=code):
                stored = self.run_ref(ref)
                self.assertEqual((stored["status"], codes(stored["failure_reasons"])), ("invalid", [code]))
                self.assertEqual(self.refused(lambda: self.run_ref(ref)), "GRID_ALREADY_ATTEMPTED")

    def test_ingest_takes_the_configuration_hash_from_the_sealed_receipt_not_from_the_probe(self):
        def misreporting(identity, runner_argv, inputs):
            found = inspect(identity, runner_argv, inputs)
            # the runner hashes the configuration itself and writes that into its summary
            self.world.scenario = {"summary": {"effective_config_sha256": found["effective_config_sha256"]}}
            return {**found, "effective_config_sha256": "0" * 64}
        with registration_seams.use(inspect_runtime=misreporting):
            stored = self.run_ref(self.refs[16])
        self.assertEqual((stored["status"], stored["failure_reasons"]), ("passed", []))

    def test_a_timeout_stops_the_container_and_is_sealed_as_interrupted(self):
        def slow(command, stdout, stderr, timeout):
            raise subprocess.TimeoutExpired(command, timeout)
        exported = registration_inputs.market_inputs(self.world.market, MARKET_COMMIT, LINE_WINDOW, {"universe": True},
                                                     None, True)
        with self.keeps_directory(), db.connect(self.world.profile, "writer") as conn, seams.use(run=slow), \
                self.assertRaises(entry.ReplayTimeout):
            revision = __import__("ledger.strategies", fromlist=["x"]).read_candidate(conn, self.refs[12])
            entry.seal(self.world.profile, conn, revision, None, exported, RUNNER_ARGV, self.bundle_of[self.refs[12]],
                       None, timeout=60)
        (trial_id,), = self.rows("SELECT MAX(trial_id) FROM trial")
        capture = execution.read_capture(self.world.conn, trial_id)
        self.assertEqual((capture["outcome"]["kind"], capture["stages"]["native"]["state"]), ("interrupted", "started"))
        self.assertEqual(self.world.stopped[-1], entry.container_name(self.world.profile, trial_id, "native"))


class StageLogTests(unittest.TestCase):
    def test_a_long_stage_log_keeps_its_first_and_last_lines_and_says_what_it_left_out(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root, True)
        log = root / "native.stderr.txt"
        lines = [b"first failure\n", *(f"[ERROR] Python on_bar failed: bar {index}\n".encode() for index in range(60_000)),
                 b"verdict line\n"]
        log.write_bytes(b"".join(lines))
        with patch.object(entry, "LOG_HEAD", 4096), patch.object(entry, "LOG_TAIL", 1024):
            entry.bound_log(log)
            kept = log.read_bytes()
            entry.bound_log(log)  # a bounded log stays as it is
        self.assertEqual(log.read_bytes(), kept)
        found = kept.splitlines(keepends=True)
        note = next(line for line in found if line.startswith(b"[replay entry: "))
        head, tail = found[:found.index(note)], found[found.index(note) + 1:]
        self.assertEqual(head, lines[:len(head)])
        self.assertEqual(tail, lines[len(lines) - len(tail):])
        self.assertLessEqual(len(b"".join(head)), 4096)
        self.assertLessEqual(len(b"".join(tail)), 1024)
        omitted = lines[len(head):len(lines) - len(tail)]
        self.assertEqual(note, f"[replay entry: {len(b''.join(omitted))} bytes in {len(omitted)} lines left out of "
                               "this log]\n".encode())
        small = root / "audit.stdout.txt"
        small.write_bytes(b"short\n")
        entry.bound_log(small)
        self.assertEqual(small.read_bytes(), b"short\n")


if __name__ == "__main__":
    unittest.main()
