"""If this fails, a paper run's record no longer says what happened: its readings miss the funding Sandbox
does not settle, a crashed or foreign run reads as complete, the journal is not kept by UTC day with
stable bytes, a declared run cannot be sealed exactly once, a run starts from a source the research
ledger never published, Paper records reach the research ledger, or the user's deletion of a sealed run
takes more than that run."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from ledger import db, paper, strategies
from shared.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service, sha, source


SOURCE = "a" * 64
DAY = 86_400 * 10**9
START = int(datetime(2026, 10, 25, 23, 58, tzinfo=UTC).timestamp()) * 10**9
MINUTE = 60 * 10**9


def line(kind: str, wall_ns: int, **fields) -> dict:
    return {"kind": kind, "wall_ns": wall_ns, **fields}


def snapshot(minute_ns: int, balance: str, unrealized: str | None) -> dict:
    return line("snapshot", minute_ns + MINUTE, minute_ns=minute_ns, balance_total=f"{balance} USDT",
                balance_free=f"{balance} USDT", unrealized_pnl=unrealized)


def summary(**overrides) -> dict:
    found = {"identity": {"source_sha256": SOURCE}, "account": {"starting_balance_usdt": "100000", "default_leverage": "3"},
             "stop_reason": "SIGTERM", "runtime_failures": 0, "started_ns": START, "stopped_ns": START + 4 * MINUTE,
             "balance_total": "99990.00000000 USDT",
             "positions_at_stop": [{"signed_qty": "0.01", "unrealized_pnl": "30.00000000 USDT"}],
             "limitations": ["paper-bars: aggregated bars skip the first incomplete one"]}
    found.update(overrides)
    return found


def journal() -> list[dict]:
    """Two minutes before 00:00 UTC, a long 0.01 opened, a settlement just after midnight at +0.0001 and
    MARK 100000."""
    return [
        line("started", START, source_sha256=SOURCE),
        line("bar", START + MINUTE, instrument_id="BTCUSDT-PERP.BINANCE", ts_event=START + MINUTE - 10**6),
        line("order", START + MINUTE, type="OrderSubmitted"),
        line("order", START + MINUTE, type="OrderFilled"),
        snapshot(START, "100000", "0"),
        snapshot(START + MINUTE, "99990", "10"),
        line("funding_settlement", START + 2 * MINUTE + 30 * 10**9, settlement_ns=START + 2 * MINUTE + 30 * 10**9,
             stream_rate="0.0001",
             mark="100000", positions=[{"signed_qty": "0.01"}]),
        snapshot(START + 2 * MINUTE, "99990", "20"),
        line("data_gap", START + 3 * MINUTE, missing_bars=2),
    ]


ROW = {"paper_id": 7, "source_sha256": SOURCE, "config": {"leverage": "3"}}


class ReadingTests(unittest.TestCase):
    def test_a_summary_with_another_leverage_than_declared_is_invalid(self):
        account = {"starting_balance_usdt": "100000", "default_leverage": "5"}
        found = paper.readings(ROW, journal(), 0, summary(account=account), 0, b"")
        self.assertEqual((found["status"], found["reasons"]), ("invalid", ["LEVERAGE_MISMATCH"]))

    def test_a_clean_run_adds_the_funding_sandbox_does_not_settle(self):
        found = paper.readings(ROW, journal(), 0, summary(), 0, b"1 ALLOW 10.0.0.2 'CONNECT fapi.binance.com:443 HTTP/1.1'\n")
        self.assertEqual((found["status"], found["reasons"]), ("complete", []))
        self.assertEqual(Decimal(found["funding_usdt"]), Decimal("-0.1"))  # a long pays 0.01 x 100000 x 0.0001
        self.assertEqual(Decimal(found["final_equity_usdt"]), Decimal("100019.9"))
        self.assertAlmostEqual(found["max_drawdown"], 0.0)
        self.assertEqual([day for day, _ in found["daily_returns"]], ["2026-10-25", "2026-10-26"])
        self.assertAlmostEqual(found["daily_returns"][0][1], 0.0)  # the minute before midnight is flat
        self.assertAlmostEqual(found["total_return"], 0.000199)
        self.assertEqual((found["fills"], found["orders_submitted"], found["missing_bars"], found["bars"]), (1, 1, 2, 1))

    def test_a_drop_below_the_peak_is_the_drawdown(self):
        lines = journal()[:5] + [snapshot(START + MINUTE, "100000", "1000"), snapshot(START + 2 * MINUTE, "100000", "-100")]
        found = paper.readings(ROW, lines, 0, summary(balance_total="100000 USDT", positions_at_stop=[]), 0, None)
        self.assertAlmostEqual(found["max_drawdown"], 1100 / 101000)

    def test_a_run_that_did_not_end_cleanly_keeps_its_reasons_and_is_invalid_only_for_untrusted_evidence(self):
        cases = {
            "no summary, container gone": (journal(), None, None, None, {"SUMMARY_MISSING", "RUNNER_EXIT_UNKNOWN"}, "complete"),
            "crashed": (journal(), None, 1, None, {"SUMMARY_MISSING", "RUNNER_EXIT_NONZERO"}, "complete"),
            "runtime failure": (journal(), summary(runtime_failures=2), 0, None, {"RUNTIME_FAILURES"}, "complete"),
            "node stopped itself": (journal(), summary(stop_reason="node_stopped"), 0, None, {"STOPPED:node_stopped"},
                                    "complete"),
            "refused": (journal() + [line("refusal", START + 4 * MINUTE, code="PAPER_EXEC_CLIENT_NOT_SANDBOX")],
                        summary(), 0, None, {"REFUSED:PAPER_EXEC_CLIENT_NOT_SANDBOX"}, "complete"),
            "another source": (journal(), summary(identity={"source_sha256": "b" * 64}), 0, None, {"SOURCE_MISMATCH"},
                               "invalid"),
            "egress denied": (journal(), summary(), 0, b"1 DENY 10.0.0.2 'CONNECT example.com:443 HTTP/1.1'\n",
                              {"EGRESS_DENIED"}, "invalid"),
            "nothing at all": ([], None, None, None, {"JOURNAL_MISSING", "SUMMARY_MISSING", "RUNNER_EXIT_UNKNOWN"},
                               "invalid"),
        }
        for name, (lines, found_summary, exit_code, egress, reasons, status) in cases.items():
            with self.subTest(name):
                found = paper.readings(ROW, lines, 0, found_summary, exit_code, egress)
                self.assertEqual((found["status"], set(found["reasons"])), (status, reasons))
        never = paper.readings(ROW, [], 0, None, None, None, start_failed=True)
        self.assertEqual((never["status"], set(never["reasons"])),
                         ("complete", {"START_FAILED", "JOURNAL_MISSING", "SUMMARY_MISSING", "RUNNER_EXIT_UNKNOWN"}))

    def test_a_runner_killed_from_outside_ends_as_a_stop_with_what_it_journaled(self):
        found = paper.readings(ROW, journal(), 0, None, 137, None)
        self.assertEqual((found["status"], found["reasons"], found["stop_reason"]), ("complete", [], "KILLED"))
        self.assertEqual(Decimal(found["final_equity_usdt"]), Decimal("100009.9"))  # 99990 + 20 open, less 0.1 funding
        self.assertEqual(found["stopped_ns"], START + 3 * MINUTE)
        self.assertIn("Killed from outside", found["limitations"][-1])
        asked = journal() + [line("stop_requested", START + 4 * MINUTE, reason="STOP_FILE")]
        waiting = [line("started", START, source_sha256=SOURCE), line("waiting", START, until_ns=START + DAY)]
        cases = {
            "at its memory limit": (journal(), True, 0, {"SUMMARY_MISSING", "RUNNER_EXIT_NONZERO", "OUT_OF_MEMORY"}),
            "after the STOP file asked it to stop": (asked, False, 0, {"SUMMARY_MISSING", "RUNNER_EXIT_NONZERO"}),
            "with runtime failures written": (journal(), False, 2, {"RUNTIME_FAILURES"}),
            "before its first bar": (waiting, False, 0, {"STOPPED_BEFORE_START"}),
        }
        for name, (lines, oom, failures, reasons) in cases.items():
            with self.subTest(name):
                found = paper.readings(ROW, lines, 0, None, 137, None, oom_killed=oom, failures=failures)
                self.assertEqual((found["status"], set(found["reasons"])), ("complete", reasons))

    def test_native_capture_keeps_the_exact_cut_and_interrupted_tail_without_a_second_copy(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / "recovery").mkdir()
            raw = b'{ "kind": "bar", "wall_ns": 1793000000000000000 }\n{"partial":'
            (root / "events.jsonl").write_bytes(raw)
            (root / "recovery/current.json").write_bytes(b'{}')
            (root / "recovery/cache.rdb").write_bytes(b'native original')
            files = paper.capture(ROW, root, root / "missing", None, 1)
            journals = {key: value for key, value in files.items() if key.startswith("events/")}
            self.assertEqual(list(journals), ["events/native.jsonl.gz"])
            self.assertEqual(gzip.decompress(journals["events/native.jsonl.gz"]), raw)
            self.assertEqual(files["recovery/cache.rdb"], b'native original')
            self.assertEqual(json.loads(files["seal.json"])["unreadable_journal_lines"], 1)

    def test_the_capture_keeps_the_journal_by_utc_day_with_the_same_bytes_each_time(self):
        with tempfile.TemporaryDirectory() as root:
            out, egress = Path(root, "out"), Path(root, "egress.log")
            out.mkdir()
            lines = journal()
            (out / "events.jsonl").write_text("".join(json.dumps(item) + "\n" for item in lines) + '{"kind": "bar", "wa',
                                              encoding="utf-8")
            (out / "summary.json").write_text(json.dumps(summary()), encoding="utf-8")
            first = paper.capture(ROW, out, egress, b"log", 0)
            again = paper.capture(ROW, out, egress, b"log", 0)
        self.assertEqual(first, again)
        self.assertEqual(sorted(first), ["events/2026-10-25.jsonl.gz", "events/2026-10-26.jsonl.gz", "runner.log",
                                         "seal.json", "summary.json"])
        kept = [json.loads(raw) for name in sorted(first) if name.startswith("events/")
                for raw in gzip.decompress(first[name]).splitlines()]
        self.assertEqual(kept, lines)
        self.assertEqual(json.loads(first["seal.json"])["unreadable_journal_lines"], 1)


@unittest.skipUnless(BINARY, SKIP)
class RecordTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.research = self.service.ledger("research")
        self.profile = self.service.ledger("paper", holds="paper")
        strategies.publish_candidate(self.research, source("start"), "start", "Fixture", "template root")
        with db.connect(self.research, "reader") as research:
            self.copied = paper.copy_source(self.profile, research, "start@1")
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def open(self, op_id: str = "paper-start:1", source_sha256: str | None = None) -> dict:
        return paper.open_paper_run(self.conn, source_sha256 or sha(source("start")), "ghcr.io/x/y@sha256:" + "0" * 64,
                                    ["BTCUSDT"], "c" * 32, {"execution": "paper-bars"}, op_id)

    def test_the_paper_database_is_its_own_and_profiles_name_what_they_hold(self):
        self.assertEqual(self.copied["source_sha256"], sha(source("start")))
        self.assertEqual(paper.read_source(self.conn, self.copied["source_sha256"])["source"], source("start"))
        with db.connect(self.research, "reader") as research:
            self.assertEqual(paper.copy_source(self.profile, research, "start@1")["source_sha256"],
                             self.copied["source_sha256"], "a second copy of the same source writes nothing")
            tables = {name for (name,) in research.rows("SHOW TABLES")}
        self.assertFalse({"paper_run", "paper_seal", "paper_file", "paper_source"} & tables)
        self.assertEqual(db.profile(None, holds="paper"), self.profile)
        for name, holds in (("paper", "research"), ("research", "paper")):
            with self.subTest(name), self.assertRaises(Refusal) as caught:
                db.profile(name, holds=holds)
            self.assertEqual(caught.exception.code, "LEDGER_KIND")
        grants = " ".join(row[0] for row in self.service.sql(self.research, "SHOW GRANTS FOR "
                                                              f"'{db._account_name(self.research.database, 'writer')}'@'%'"))
        self.assertNotIn("DELETE", grants, "the research writer never deletes")

    def test_a_declared_run_is_sealed_once_and_listed_with_its_readings(self):
        opened = self.open()
        self.assertEqual(self.open()["paper_id"], opened["paper_id"], "a retried start is the same run")
        files = {"seal.json": json.dumps({"status": "complete"}).encode(), "summary.json": b"{}"}
        sealed = paper.seal_paper_run(self.conn, opened["paper_id"], files)
        self.assertEqual(paper.paper_files(self.conn, opened["paper_id"]), files)
        self.assertEqual(sealed["write_status"], "written")
        self.assertEqual(paper.seal_paper_run(self.conn, opened["paper_id"], files)["write_status"], "replayed")
        with self.assertRaises(Refusal) as caught:
            paper.seal_paper_run(self.conn, opened["paper_id"], {**files, "summary.json": b'{"other": 1}'})
        self.assertEqual(caught.exception.code, "OP_ID_CONFLICT")
        second = self.open("paper-start:2")
        listed = paper.paper_runs(self.conn)
        self.assertEqual([(run["paper_id"], run["symbols"], run["seal"]) for run in listed],
                         [(opened["paper_id"], ["BTCUSDT"], {"status": "complete"}), (second["paper_id"], ["BTCUSDT"], None)])

    def test_a_reader_takes_only_the_sealed_files_it_names(self):
        """CF-24: a log or the journal is read without the rest of the capture (its recovery dump above all)."""
        opened = self.open("paper-start:files")
        files = {"seal.json": b'{"status": "complete"}', "events/2026-01-01.jsonl.gz": b"one",
                 "events/2026-01-02.jsonl.gz": b"two", "runner.log": b"log", "runtime_failures.jsonl": b"",
                 "recovery/dump.rdb": b"dump", "eventsless.txt": b"not under events/"}
        paper.seal_paper_run(self.conn, opened["paper_id"], files)
        self.assertEqual(paper.paper_files(self.conn, opened["paper_id"]), files, "no name reads every file")
        self.assertEqual(paper.paper_files(self.conn, opened["paper_id"], "events/", "runner.log"),
                         {name: files[name] for name in ("events/2026-01-01.jsonl.gz", "events/2026-01-02.jsonl.gz",
                                                         "runner.log")})
        self.assertEqual(paper.paper_files(self.conn, opened["paper_id"], "egress.log"), {})

    def test_only_copied_sources_run_and_only_declared_runs_seal(self):
        with self.assertRaises(Refusal) as caught:
            self.open(source_sha256="f" * 64)
        self.assertEqual(caught.exception.code, "UNKNOWN_CANDIDATE")
        with self.assertRaises(Refusal) as caught:
            paper.seal_paper_run(self.conn, 99, {"seal.json": b"{}"})
        self.assertEqual(caught.exception.code, "PAPER_RUN_UNKNOWN")

    def test_a_deleted_run_leaves_only_its_own_rows(self):
        first, second, open_run = self.open(), self.open("paper-start:2"), self.open("paper-start:3")
        shared = b'{"limitations": []}'
        paper.seal_paper_run(self.conn, first["paper_id"], {"seal.json": b'{"status": "invalid"}', "summary.json": shared})
        paper.seal_paper_run(self.conn, second["paper_id"], {"seal.json": b'{"status": "complete"}', "summary.json": shared})
        self.conn.close()
        deleted = paper.delete_paper_run(self.profile, first["paper_id"])
        self.assertEqual(deleted["files_deleted"], 2)
        with db.connect(self.profile, "reader") as reader:
            self.assertEqual([(run["paper_id"], run["seal"]) for run in paper.paper_runs(reader)],
                             [(2, {"status": "complete"}), (3, None)])
            self.assertEqual(paper.paper_files(reader, second["paper_id"])["summary.json"], shared)
            self.assertEqual(paper.read_source(reader, self.copied["source_sha256"])["source"], source("start"))
        for paper_id, code in ((first["paper_id"], "PAPER_RUN_UNKNOWN"), (open_run["paper_id"], "PAPER_RUN_ACTIVE")):
            with self.subTest(code), self.assertRaises(Refusal) as caught:
                paper.delete_paper_run(self.profile, paper_id)
            self.assertEqual(caught.exception.code, code)


if __name__ == "__main__":
    unittest.main()
