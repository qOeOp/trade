"""Execution captures: sealing what a working directory holds, the capacity refusal, recovery material
that never replaces the capture, and coverage at ingest read only from the original capture."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from ledger import coverage, db, evidence, execution, problems, strategies, trials
from shared.errors import Refusal
from tests.ledger import dolt
from tests.ledger.dolt import ACCOUNT, BINARY, IDENTITY, MARKET_DAY, RUNTIME, SKIP, SYMBOLS, Service, sha, source


EXITED = {"native": {"state": "exited", "exit_code": 0}, "audit": None}
DONE = {"kind": "completed", "detail": None}
ARGV = ["--start", "2026-01-01"]
CONFIG = {"runtime_contract": IDENTITY["runtime_contract"], "start": "2026-01-01T00:00:00Z",
          "trade_start": "2026-01-02T00:00:00Z", "end": "2026-02-01T00:00:00Z", "symbols": SYMBOLS,
          "account": ACCOUNT}


def coverage_receipt(**identity) -> dict:
    """A coverage receipt whose export receipts cover each symbol; `identity` overrides input_identity keys."""
    symbols = identity.get("symbols", SYMBOLS)
    return json.loads(dolt.coverage(effective_config=CONFIG, receipts={
        symbol: {"pieces": [{"instrument_id": symbol}]} for symbol in symbols}, **identity))


COVERAGE = json.dumps(coverage_receipt()).encode()


def native_summary(**changes) -> dict:
    summary = {"input_start_utc": "2026-01-01T00:00:00Z", "period_end_utc": "2026-02-01T00:00:00Z",
               "market_day": MARKET_DAY,
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
        for name, data in {"source/strategy.py": self.data, problems.COVERAGE: COVERAGE, **files}.items():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_bytes(data)
        return root

    def trial(self, workdir: Path, purpose: str = "explore") -> int:
        return trials.open_trial(self.conn, purpose, sha(self.data), RUNTIME, COVERAGE, dolt.window(),
                                 {"argv": ARGV, "workdir": str(workdir), "source_bytes": self.data})["trial_id"]

    def seal(self, trial_id: int, workdir: Path, stages: dict = EXITED, outcome: dict = DONE) -> dict:
        process(workdir, trial_id, stages)
        return execution.seal_capture(self.conn, trial_id, workdir, stages, outcome)

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
        again = execution.seal_capture(self.conn, trial_id, workdir, EXITED, DONE)
        self.assertEqual((again["replayed"], again["files"]), (True, sealed["files"]))
        self.assertEqual(sealed["files"], {"native.stdout.txt": sha(b"ran\n")})
        (workdir / "native.stdout.txt").write_bytes(b"rewritten later\n")
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, workdir, EXITED, DONE)),
                         "BUNDLE_EXISTS")

    def test_a_batched_read_refuses_only_the_trial_whose_stored_bytes_fail_their_hash(self):
        kept, broken = (self.workdir({"native.stdout.txt": text}) for text in (b"kept\n", b"broken\n"))
        kept_id, broken_id = self.trial(kept), self.trial(broken)
        self.seal(kept_id, kept)
        self.seal(broken_id, broken)
        admin = self.service.admin(self.profile)
        try:
            with admin.cursor() as cursor:
                cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
                cursor.execute("UPDATE evidence_content SET content = %s WHERE sha256 = %s",
                               (b"rewritten\n", sha(b"broken\n")))
                cursor.execute("CALL DOLT_COMMIT('-a', '-m', 'tamper: stored bytes')")
        finally:
            admin.close()
        read = execution.read_captures(self.conn, [kept_id, broken_id])
        self.assertEqual(read[kept_id], execution.read_capture(self.conn, kept_id))
        self.assertIsInstance(read[broken_id], Refusal)
        self.assertEqual((read[broken_id].code, self.refused(lambda: execution.read_capture(self.conn, broken_id))),
                         ("LEDGER_CORRUPT", "LEDGER_CORRUPT"))

    def test_a_listing_read_reads_only_the_bytes_an_availability_reading_needs(self):
        """E3: the start receipt, the runtime failures and the audit result; every other captured file by its
        stored hash. The bytes it reads are still hash checked."""
        failures = json.dumps({"stage": "load", "code": "X"}).encode() + b"\n"
        kept, broken = (self.workdir({"native.stdout.txt": b"ran\n", problems.RUNTIME_ERRORS: failures + extra})
                        for extra in (b"", b"\n"))
        kept_id, broken_id = self.trial(kept), self.trial(broken)
        self.seal(kept_id, kept)
        self.seal(broken_id, broken)
        admin = self.service.admin(self.profile)
        try:
            with admin.cursor() as cursor:
                cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
                cursor.execute("UPDATE evidence_content SET content = %s WHERE sha256 = %s",
                               (b"tampered after the seal\n", sha(failures + b"\n")))
                cursor.execute("CALL DOLT_COMMIT('-a', '-m', 'tamper: stored bytes')")
        finally:
            admin.close()
        read = execution.read_captures(self.conn, [kept_id, broken_id], listing=True)
        self.assertEqual((read[broken_id].code), "LEDGER_CORRUPT", "a file a listing reads is read with its bytes or refused")
        full, listed = execution.read_capture(self.conn, kept_id), read[kept_id]
        self.assertEqual(set(listed["files"]), {problems.RUNTIME_ERRORS})
        self.assertEqual(listed["listed"]["native.stdout.txt"], {"status": "captured", "sha256": sha(b"ran\n")})
        for key in ("status", "stages", "outcome", "statuses", "runtime_failures", "start", "input_coverage",
                    "input_coverage_bytes", "table_hashes"):
            self.assertEqual(listed[key], full[key], key)

    def test_the_source_and_the_coverage_receipt_are_stored_once_and_the_capture_hashes_them(self):
        workdir = self.workdir({"native.stdout.txt": b"ran\n"})
        trial_id = self.trial(workdir)
        self.seal(trial_id, workdir)
        read = execution.read_capture(self.conn, trial_id)
        self.assertEqual({path: (read["statuses"][path], read["listed"][path]["sha256"])
                          for path in (execution.CAPTURED_SOURCE, problems.COVERAGE)},
                         {execution.CAPTURED_SOURCE: ("hashed", sha(self.data)),
                          problems.COVERAGE: ("hashed", sha(COVERAGE))})
        self.assertEqual((problems.COVERAGE in read["files"], read["input_coverage_bytes"]), (False, COVERAGE))
        self.assertNotIn(execution.SOURCE, evidence.load_bundle(self.conn, f"trial-{trial_id}-start")["files"],
                         "a published source is the candidate's")
        self.assertEqual(self.service.sql(self.profile, "SELECT path, status, sha256, length FROM trial_file WHERE "
                                                        "trial_id = %s AND path = %s", (trial_id, problems.COVERAGE)),
                         [(problems.COVERAGE, "hashed", sha(COVERAGE), len(COVERAGE))])
        draft = source("unpublished draft")
        drafted = self.workdir({execution.CAPTURED_SOURCE: draft})
        draft_id = trials.open_trial(self.conn, "explore", sha(draft), RUNTIME, COVERAGE, dolt.window(),
                                     {"argv": ARGV, "workdir": str(drafted), "source_bytes": draft})["trial_id"]
        start = evidence.load_bundle(self.conn, f"trial-{draft_id}-start")["files"]
        self.assertEqual(start[execution.SOURCE], draft, "an unpublished source is kept by its start receipt")
        (drafted / execution.CAPTURED_SOURCE).write_bytes(self.data)  # the container read another source
        self.seal(draft_id, drafted)
        self.assertEqual(self.refused(lambda: execution.read_capture(self.conn, draft_id)), "EXECUTION_IDENTITY")

    def test_a_capture_needs_a_start_receipt_and_well_formed_stages(self):
        workdir = self.workdir({})
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, 9999, workdir, EXITED, DONE)),
                         "EXECUTION_START_MISSING")
        trial_id = self.trial(workdir)
        for stages, outcome in (({"native": {"state": "started", "exit_code": 0}, "audit": None}, DONE),
                                ({"native": {"state": "exited", "exit_code": None}, "audit": None}, DONE),
                                ({**EXITED, "fingerprint": {"state": "not_available", "exit_code": None}}, DONE),
                                (EXITED, {"kind": "crashed"})):
            with self.subTest(stages=stages, outcome=outcome):
                self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, workdir, stages,
                                                                             outcome)), "EXECUTION_IDENTITY")

    def test_a_capture_is_sealed_only_from_the_directory_its_trial_started_in(self):
        started = self.workdir({"native.stdout.txt": b"ran\n"})
        trial_id = self.trial(started)
        other = self.workdir({"native.stdout.txt": b"ran\n"})
        process(other, trial_id, EXITED)
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, other, EXITED, DONE)),
                         "EXECUTION_IDENTITY")
        marker = json.loads((started / execution.WORKDIR_MARKER).read_bytes())
        (other / execution.WORKDIR_MARKER).write_text(json.dumps({**marker, "op_id": "trial:another-start"}))
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, other, EXITED, DONE)),
                         "EXECUTION_IDENTITY")
        self.assertEqual(execution.read_capture(self.conn, trial_id)["status"], "missing")
        self.seal(trial_id, started)
        self.assertEqual(execution.read_capture(self.conn, trial_id)["status"], "captured")

    def test_the_stages_must_be_the_process_record_and_its_command_the_start_argv(self):
        workdir = self.workdir({"native.stdout.txt": b"failed\n"})
        trial_id = self.trial(workdir)
        failed = {"native": {"state": "exited", "exit_code": 1}, "audit": None}
        process(workdir, trial_id, failed)
        chosen = {"native": {"state": "exited", "exit_code": 0}, "audit": None}
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, workdir, chosen, DONE)),
                         "EXECUTION_IDENTITY")
        record = json.loads((workdir / execution.PROCESS).read_text())
        record["commands"]["native"] = ["docker", "run", "image", "-m", "native", "--start", "2025-01-01"]
        (workdir / execution.PROCESS).write_text(json.dumps(record))
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, workdir, failed, DONE)),
                         "EXECUTION_IDENTITY")
        self.assertEqual(execution.read_capture(self.conn, trial_id)["status"], "missing")

    def test_the_sealed_coverage_receipt_is_the_start_receipts(self):
        for receipt in (json.dumps(coverage_receipt(), indent=1).encode(),
                        json.dumps(coverage_receipt(export_content_sha256="0" * 64)).encode()):
            workdir = self.workdir({})
            trial_id = self.trial(workdir)
            (workdir / problems.COVERAGE).write_bytes(receipt)
            process(workdir, trial_id, EXITED)
            with self.subTest(receipt=receipt[:40]):
                self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, workdir, EXITED,
                                                                             DONE)), "COVERAGE_MISMATCH")

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
            self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, oversized_id, oversized, EXITED,
                                                                         DONE)), "EXECUTION_CAPTURE_LIMIT")
        self.assertEqual(execution.read_capture(self.conn, oversized_id)["status"], "missing")

    def recovery_case(self, native_exit: int = 1, reports: dict | None = None) -> tuple[int, Path, Path]:
        stages = {"native": {"state": "exited", "exit_code": native_exit}, "audit": None}
        workdir = self.workdir({"native.stdout.txt": b"y" * 64, **(reports or {})})
        trial_id = self.trial(workdir, "precheck")
        process(workdir, trial_id, stages)
        with patch.object(execution, "PRECHECK_CAPTURE_LIMIT", 32), self.assertRaises(Refusal) as caught:
            execution.seal_capture(self.conn, trial_id, workdir, stages, DONE)
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
        self.assertEqual(self.refused(lambda: execution.seal_capture(self.conn, trial_id, workdir, chosen, DONE)),
                         "BUNDLE_EXISTS")
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
        self.assertEqual(coverage.verify_coverage(coverage_receipt(), native_summary()), ())

    def test_the_receipt_and_summary_must_agree(self):
        unreceipted = coverage_receipt()
        del unreceipted["export_receipts"][SYMBOLS[1]]
        cases = [({**coverage_receipt(), "format": "v0"}, native_summary(), "COVERAGE_RECEIPT_INVALID"),
                 (unreceipted, native_summary(), "COVERAGE_RECEIPT_INVALID"),
                 (coverage_receipt(), native_summary(per_coin=native_summary()["per_coin"][:1]),
                  "COVERAGE_MISMATCH"),
                 (coverage_receipt(), native_summary(market_day="n" * 32), "COVERAGE_MISMATCH"),
                 (coverage_receipt(), native_summary(input_start_utc="2026-01-02T00:00:00Z"),
                  "COVERAGE_MISMATCH"),
                 (coverage_receipt(), native_summary(per_coin=[
                     {"instrument": symbol, "counts": {"instrument_close": 1}} for symbol in SYMBOLS]),
                  "LIFECYCLE_BUNDLE_MISSING"),
                 (coverage_receipt(), native_summary(per_coin=[
                     {"instrument": symbol, "counts": {"instrument_status": -1}} for symbol in SYMBOLS]),
                  "LIFECYCLE_NATIVE_COUNT_INVALID")]
        for receipt, summary, code in cases:
            with self.subTest(code=code), self.assertRaises(Refusal) as caught:
                coverage.verify_coverage(receipt, summary)
            self.assertEqual(caught.exception.code, code)


@unittest.skipUnless(BINARY, SKIP)
class OriginalCoverageTests(LedgerCase):
    """Ingest trusts only the coverage receipt and summary of the trial's original capture."""

    def sealed(self) -> int:
        workdir = self.workdir({"reports/summary.json": json.dumps(native_summary()).encode()})
        trial_id = self.trial(workdir)
        self.seal(trial_id, workdir, {"native": {"state": "exited", "exit_code": 0},
                                      "audit": {"state": "exited", "exit_code": 0}})
        return trial_id

    def test_coverage_is_rebuilt_from_the_original_capture_only(self):
        sealed = self.sealed()
        self.assertEqual(coverage.original_coverage(execution.read_capture(self.conn, sealed), sealed), ())
        unsealed = self.trial(self.workdir({}))
        self.assertEqual(self.refused(lambda: coverage.original_coverage(
            execution.read_capture(self.conn, unsealed), unsealed)), "CAPTURE_INCOMPLETE")

