"""Execution captures: sealing what a working directory holds, the capacity refusal, recovery material
that never replaces the capture, and coverage at ingest read only from the original capture."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from ledger import coverage, db, evidence, execution, strategies, trials
from ledger.errors import Refusal
from tests.ledger.dolt import BINARY, RUNTIME, SKIP, Service, inputs, sha, source, window


EXITED = {"native": {"state": "exited", "exit_code": 0}, "audit": None}
DONE = {"kind": "completed", "detail": None}
SYMBOLS = ["AAAUSDT-PERP.BINANCE", "BBBUSDT-PERP.BINANCE"]
ARGV = ["--start", "2026-01-01"]


def coverage_receipt(identity: dict) -> dict:
    return {"format": coverage.FORMAT, "input_identity": identity,
            "effective_config": {"start": "2026-01-01T00:00:00Z", "end": "2026-02-01T00:00:00Z"},
            "export_receipts": {symbol: {"pieces": [{"instrument_id": symbol}]} for symbol in identity["symbols"]}}


COVERAGE = json.dumps(coverage_receipt(inputs()["identity"])).encode()


def native_summary(**changes) -> dict:
    summary = {"input_start_utc": "2026-01-01T00:00:00Z", "period_end_utc": "2026-02-01T00:00:00Z",
               "market_commit": inputs()["identity"]["market_commit"],
               "per_coin": [{"instrument": symbol, "counts": {"last": 1}} for symbol in SYMBOLS]}
    summary.update(changes)
    return summary


def process(workdir: Path, trial_id: int, stages: dict) -> None:
    """The process record the replay entry writes: the stage facts and one command per started stage."""
    commands = {name: ["docker", "run", "image", "-m", name, *(ARGV if name == "native" else [])]
                for name, stage in stages.items() if stage is not None}
    (workdir / execution.PROCESS).write_text(json.dumps({"trial_id": trial_id, "stages": stages,
                                                         "commands": commands}))


class LedgerCase(unittest.TestCase):
    """A throwaway ledger with one published source, and trials opened on it."""

    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.addClassCleanup(cls.service.close)
        cls.profile = cls.service.ledger("capture")
        cls.data = source("prechecked")
        strategies.publish_candidate(cls.profile, cls.data, "pre", "Fixture", "a precheck source")

    def setUp(self):
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def seq(self) -> int:
        return self.service.sql(self.profile, "SELECT seq FROM ledger_head")[0][0]

    def workdir(self, files: dict[str, bytes]) -> Path:
        root = Path(tempfile.mkdtemp(prefix="capture-", dir=self.service.root))
        for name, data in {"source/strategy.py": self.data, execution.COVERAGE: COVERAGE, **files}.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_bytes(data)
        return root

    def trial(self, workdir: Path, purpose: str = "explore", identity: dict | None = None) -> int:
        given = {**inputs(), "input_coverage": COVERAGE}
        if identity is not None:
            given = {**given, "identity": identity}
        return trials.open_trial(self.conn, purpose, sha(self.data), RUNTIME, given, window(),
                                 {"argv": ARGV, "mounts": [], "workdir": str(workdir),
                                  "source_bytes": self.data})["trial_id"]

    def seal(self, trial_id: int, workdir: Path, stages: dict = EXITED, outcome: dict = DONE) -> dict:
        process(workdir, trial_id, stages)
        return execution.seal_capture(self.profile, trial_id, workdir, stages, outcome, self.conn)

    def refused(self, call) -> str:
        seq = self.seq()
        with self.assertRaises(Refusal) as caught:
            call()
        self.assertEqual(self.seq(), seq, "a refused call writes nothing")
        return caught.exception.code


@unittest.skipUnless(BINARY, SKIP)
class CaptureTests(LedgerCase):
    def test_a_capture_seals_the_bytes_that_exist_and_reads_them_back(self):
        workdir = self.workdir({"native.stdout.txt": b"ran\n", "native.stderr.txt": b""})
        trial_id = self.trial(workdir)
        sealed = self.seal(trial_id, workdir)
        read = execution.read_capture(self.conn, trial_id)
        self.assertEqual(read["status"], "captured")
        self.assertEqual((read["statuses"]["native.stdout.txt"], read["statuses"]["native.stderr.txt"],
                          read["statuses"]["reports/summary.json"], read["statuses"]["audit/audit.json"]),
                         ("captured", "captured_empty", "missing", "not_started"))
        self.assertEqual((read["files"]["native.stdout.txt"], read["stages"], read["outcome"]),
                         (b"ran\n", {**EXITED, "fingerprint": None}, DONE))
        again = execution.seal_capture(self.profile, trial_id, workdir, EXITED, DONE, self.conn)
        self.assertEqual((again["replayed"], again["manifest_sha256"]), (True, sealed["manifest_sha256"]))
        (workdir / "native.stdout.txt").write_bytes(b"rewritten later\n")
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, trial_id, workdir, EXITED, DONE,
                                                                     self.conn)), "BUNDLE_EXISTS")

    def test_the_source_and_the_coverage_receipt_are_stored_once_and_the_capture_hashes_them(self):
        workdir = self.workdir({"native.stdout.txt": b"ran\n"})
        trial_id = self.trial(workdir)
        self.seal(trial_id, workdir)
        read = execution.read_capture(self.conn, trial_id)
        self.assertEqual({path: (read["statuses"][path], read["listed"][path]["sha256"])
                          for path in (execution.CAPTURED_SOURCE, execution.COVERAGE)},
                         {execution.CAPTURED_SOURCE: ("hashed", sha(self.data)),
                          execution.COVERAGE: ("hashed", sha(COVERAGE))})
        self.assertEqual((execution.COVERAGE in read["files"], read["input_coverage_bytes"]), (False, COVERAGE))
        self.assertNotIn(execution.SOURCE, evidence.load_bundle(self.conn, f"trial-{trial_id}-execution-start")["files"],
                         "a published source is the candidate's")
        draft = source("unpublished draft")
        drafted = self.workdir({execution.CAPTURED_SOURCE: draft})
        draft_id = trials.open_trial(self.conn, "explore", sha(draft), RUNTIME, {**inputs(), "input_coverage": COVERAGE},
                                     window(), {"argv": ARGV, "mounts": [], "workdir": str(drafted),
                                                "source_bytes": draft})["trial_id"]
        start = evidence.load_bundle(self.conn, f"trial-{draft_id}-execution-start")["files"]
        self.assertEqual(start[execution.SOURCE], draft, "an unpublished source is kept by its start receipt")
        (drafted / execution.CAPTURED_SOURCE).write_bytes(self.data)  # the container read another source
        self.seal(draft_id, drafted)
        self.assertEqual(self.refused(lambda: execution.read_capture(self.conn, draft_id)), "EXECUTION_IDENTITY")

    def test_a_capture_needs_a_start_receipt_and_well_formed_stages(self):
        workdir = self.workdir({})
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, 9999, workdir, EXITED, DONE,
                                                                     self.conn)), "EXECUTION_START_MISSING")
        trial_id = self.trial(workdir)
        for stages, outcome in (({"native": {"state": "started", "exit_code": 0}, "audit": None}, DONE),
                                ({"native": {"state": "exited", "exit_code": None}, "audit": None}, DONE),
                                ({**EXITED, "fingerprint": {"state": "not_available", "exit_code": None}}, DONE),
                                (EXITED, {"kind": "crashed"})):
            with self.subTest(stages=stages, outcome=outcome):
                self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, trial_id, workdir, stages,
                                                                             outcome, self.conn)), "EXECUTION_IDENTITY")

    def test_the_stages_must_be_the_process_record_and_its_command_the_start_argv(self):
        workdir = self.workdir({"native.stdout.txt": b"failed\n"})
        trial_id = self.trial(workdir)
        failed = {"native": {"state": "exited", "exit_code": 1}, "audit": None}
        process(workdir, trial_id, failed)
        chosen = {"native": {"state": "exited", "exit_code": 0}, "audit": None}
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, trial_id, workdir, chosen, DONE,
                                                                     self.conn)), "EXECUTION_IDENTITY")
        record = json.loads((workdir / execution.PROCESS).read_text())
        record["commands"]["native"] = ["docker", "run", "image", "-m", "native", "--start", "2025-01-01"]
        (workdir / execution.PROCESS).write_text(json.dumps(record))
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, trial_id, workdir, failed, DONE,
                                                                     self.conn)), "EXECUTION_IDENTITY")
        self.assertEqual(execution.read_capture(self.conn, trial_id)["status"], "missing")

    def test_the_sealed_coverage_receipt_is_the_start_receipts(self):
        identity = inputs()["identity"]
        for receipt in (json.dumps(coverage_receipt(identity), indent=1).encode(),
                        json.dumps(coverage_receipt({**identity, "export_content_sha256": "0" * 64})).encode()):
            workdir = self.workdir({})
            trial_id = self.trial(workdir)
            (workdir / execution.COVERAGE).write_bytes(receipt)
            process(workdir, trial_id, EXITED)
            with self.subTest(receipt=receipt[:40]):
                self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, trial_id, workdir, EXITED,
                                                                             DONE, self.conn)), "COVERAGE_MISMATCH")

    def test_an_interrupted_replay_is_sealed_as_interrupted_with_what_it_left(self):
        workdir = self.workdir({"native.stdout.txt": b"half\n"})
        trial_id = self.trial(workdir)
        started = {"native": {"state": "started", "exit_code": None}, "audit": None}
        self.seal(trial_id, workdir, started, {"kind": "interrupted", "detail": "SIGINT"})
        read = execution.read_capture(self.conn, trial_id)
        self.assertEqual((read["outcome"]["kind"], read["stages"]["native"]["state"]), ("interrupted", "started"))

    def test_a_precheck_keeps_every_report_a_run_hashes_them_and_an_oversized_capture_writes_nothing(self):
        reports = {"reports/orders.csv": b"client_order_id\nO-1\n", "reports/summary.json": b"{}"}
        explored = self.workdir(reports)
        explore_id = self.trial(explored)
        self.seal(explore_id, explored)
        read = execution.read_capture(self.conn, explore_id)
        self.assertNotIn("reports/orders.csv", read["files"])
        self.assertEqual((read["statuses"]["reports/orders.csv"], read["listed"]["reports/orders.csv"]["sha256"],
                          read["statuses"]["reports/fills.csv"]),
                         ("hashed", sha(reports["reports/orders.csv"]), "missing"))
        prechecked = self.workdir(reports)
        precheck_id = self.trial(prechecked, "precheck")
        self.seal(precheck_id, prechecked)
        self.assertEqual(execution.read_capture(self.conn, precheck_id)["files"]["reports/orders.csv"],
                         reports["reports/orders.csv"])
        oversized = self.workdir({"native.stdout.txt": b"x" * 64})
        oversized_id = self.trial(oversized)
        process(oversized, oversized_id, EXITED)
        with patch.object(execution, "CAPTURE_LIMIT", 32):
            self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, oversized_id, oversized, EXITED,
                                                                         DONE, self.conn)), "EXECUTION_CAPTURE_LIMIT")
        self.assertEqual(execution.read_capture(self.conn, oversized_id)["status"], "missing")

    def recovery_case(self, native_exit: int = 1, reports: dict | None = None) -> tuple[int, Path, Path]:
        stages = {"native": {"state": "exited", "exit_code": native_exit}, "audit": None}
        workdir = self.workdir({"native.stdout.txt": b"y" * 64, **(reports or {})})
        trial_id = self.trial(workdir, "precheck")
        process(workdir, trial_id, stages)
        with patch.object(execution, "PRECHECK_CAPTURE_LIMIT", 32), self.assertRaises(Refusal) as caught:
            execution.seal_capture(self.profile, trial_id, workdir, stages, DONE, self.conn)
        receipt = workdir / execution.HOST_ERROR
        receipt.write_text(json.dumps(caught.exception.as_dict()))
        return trial_id, workdir, receipt

    def test_recovered_bytes_are_appended_apart_and_the_capture_stays_missing(self):
        trial_id, workdir, receipt = self.recovery_case()
        recovered = execution.recover_capture(self.profile, trial_id, workdir, receipt)
        self.assertEqual((recovered["bundle"], recovered["original_capture"]), (f"trial-{trial_id}-recovery", "missing"))
        self.assertEqual(execution.read_capture(self.conn, trial_id)["status"], "missing")
        stored = self.service.sql(self.profile, "SELECT path FROM evidence WHERE bundle = %s ORDER BY path",
                                  (recovered["bundle"],))
        self.assertIn(("native.stdout.txt",), stored)

    def test_after_recovery_the_trial_is_never_sealed(self):
        trial_id, workdir, receipt = self.recovery_case(native_exit=1)
        execution.recover_capture(self.profile, trial_id, workdir, receipt)
        (workdir / "native.stdout.txt").unlink()
        chosen = {"native": {"state": "exited", "exit_code": 0}, "audit": None}
        process(workdir, trial_id, chosen)
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.profile, trial_id, workdir, chosen, DONE,
                                                                     self.conn)), "BUNDLE_EXISTS")
        self.assertEqual(execution.read_capture(self.conn, trial_id)["status"], "missing")

    def test_recovery_applies_only_to_a_refused_precheck_with_its_originals(self):
        trial_id, workdir, receipt = self.recovery_case()
        captured = self.workdir({})
        captured_id = self.trial(captured, "precheck")
        self.seal(captured_id, captured)
        self.assertEqual(self.refused(lambda: execution.recover_capture(self.profile, captured_id, captured, receipt)),
                         "RECOVERY_NOT_APPLICABLE")
        other = self.workdir({})
        self.assertEqual(self.refused(lambda: execution.recover_capture(self.profile, trial_id, other, receipt)),
                         "RECOVERY_NOT_APPLICABLE")
        wrong = workdir / "other-error.json"
        wrong.write_text(json.dumps({"code": "LEDGER_UNAVAILABLE"}))
        self.assertEqual(self.refused(lambda: execution.recover_capture(self.profile, trial_id, workdir, wrong)),
                         "RECOVERY_INCOMPLETE")
        exited_ok, ok_dir, ok_receipt = self.recovery_case(native_exit=0)
        self.assertEqual(self.refused(lambda: execution.recover_capture(self.profile, exited_ok, ok_dir, ok_receipt)),
                         "RECOVERY_INCOMPLETE")
        (workdir / "source" / "strategy.py").write_bytes(b"# another source\n")
        self.assertEqual(self.refused(lambda: execution.recover_capture(self.profile, trial_id, workdir, receipt)),
                         "EXECUTION_IDENTITY")
        shutil.rmtree(other)


class VerifyCoverageTests(unittest.TestCase):
    def test_a_receipt_that_agrees_with_the_summary_gives_no_lifecycle_events(self):
        self.assertEqual(coverage.verify_coverage(coverage_receipt(inputs()["identity"]), native_summary()), ())

    def test_the_receipt_and_summary_must_agree(self):
        identity = inputs()["identity"]
        unreceipted = coverage_receipt(identity)
        del unreceipted["export_receipts"][SYMBOLS[1]]
        cases = [({**coverage_receipt(identity), "format": "v0"}, native_summary(), "COVERAGE_RECEIPT_INVALID"),
                 (unreceipted, native_summary(), "COVERAGE_RECEIPT_INVALID"),
                 (coverage_receipt(identity), native_summary(per_coin=native_summary()["per_coin"][:1]),
                  "COVERAGE_MISMATCH"),
                 (coverage_receipt(identity), native_summary(market_commit="n" * 32), "COVERAGE_MISMATCH"),
                 (coverage_receipt(identity), native_summary(input_start_utc="2026-01-02T00:00:00Z"),
                  "COVERAGE_MISMATCH"),
                 (coverage_receipt(identity), native_summary(per_coin=[
                     {"instrument": symbol, "counts": {"instrument_close": 1}} for symbol in SYMBOLS]),
                  "LIFECYCLE_BUNDLE_MISSING"),
                 (coverage_receipt(identity), native_summary(per_coin=[
                     {"instrument": symbol, "counts": {"instrument_status": -1}} for symbol in SYMBOLS]),
                  "LIFECYCLE_NATIVE_COUNT_INVALID")]
        for receipt, summary, code in cases:
            with self.subTest(code=code), self.assertRaises(Refusal) as caught:
                coverage.verify_coverage(receipt, summary)
            self.assertEqual(caught.exception.code, code)
        with self.assertRaises(Refusal) as caught:
            coverage.verify_coverage(coverage_receipt(identity), native_summary(),
                                     ("2026-01-01T00:00:00Z", "2026-01-15T00:00:00Z"))
        self.assertEqual(caught.exception.code, "COVERAGE_MISMATCH")


@unittest.skipUnless(BINARY, SKIP)
class OriginalCoverageTests(LedgerCase):
    """Ingest trusts only the coverage receipt and summary of the trial's original capture."""

    def sealed(self, audit_exit: int | None = 0) -> int:
        workdir = self.workdir({"reports/summary.json": json.dumps(native_summary()).encode()})
        trial_id = self.trial(workdir)
        stages = {"native": {"state": "exited", "exit_code": 0},
                  "audit": None if audit_exit is None else {"state": "exited", "exit_code": audit_exit}}
        self.seal(trial_id, workdir, stages)
        return trial_id

    def test_coverage_is_rebuilt_from_the_original_capture_only(self):
        identity = inputs()["identity"]
        self.assertEqual(coverage.original_coverage(self.conn, self.sealed(), identity), ())
        unsealed = self.trial(self.workdir({}))
        self.assertEqual(self.refused(lambda: coverage.original_coverage(self.conn, unsealed, identity)),
                         "CAPTURE_INCOMPLETE")
        failed, passed = self.sealed(audit_exit=1), self.sealed()
        self.assertEqual(self.refused(lambda: coverage.original_coverage(self.conn, failed, identity)), "PHASE_FAILED")
        self.assertEqual(self.refused(lambda: coverage.original_coverage(
            self.conn, passed, {**identity, "export_content_sha256": "0" * 64})), "INPUT_IDENTITY_MISMATCH")


if __name__ == "__main__":
    unittest.main()
