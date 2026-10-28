"""If this fails, a paper run's record no longer says what happened: its readings miss the funding Sandbox
does not settle, a crashed or foreign run reads as complete, the journal is not kept by UTC day with
stable bytes, a declared run cannot be sealed exactly once, an Agent can write into its capture, or the
user's deletion of a sealed run takes more than that run (or a content another run still names), reads as
tampering in the whole-ledger review, or lets another removal pass as one."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from ledger import db, evidence, paper, strategies
from ledger.errors import Refusal
from report import review
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
    found = {"identity": {"source_sha256": SOURCE}, "account": {"starting_balance_usdt": "100000"},
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


ROW = {"paper_id": 7, "source_sha256": SOURCE}


class ReadingTests(unittest.TestCase):
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

    def test_a_run_that_did_not_end_cleanly_is_invalid_with_its_reasons(self):
        cases = {
            "no summary, container gone": (journal(), None, None, None, {"SUMMARY_MISSING", "RUNNER_EXIT_UNKNOWN"}),
            "crashed": (journal(), None, 137, None, {"SUMMARY_MISSING", "RUNNER_EXIT_NONZERO"}),
            "runtime failure": (journal(), summary(runtime_failures=2), 0, None, {"RUNTIME_FAILURES"}),
            "node stopped itself": (journal(), summary(stop_reason="node_stopped"), 0, None, {"STOPPED:node_stopped"}),
            "another source": (journal(), summary(identity={"source_sha256": "b" * 64}), 0, None, {"SOURCE_MISMATCH"}),
            "egress denied": (journal(), summary(), 0, b"1 DENY 10.0.0.2 'CONNECT example.com:443 HTTP/1.1'\n",
                              {"EGRESS_DENIED"}),
            "refused": (journal() + [line("refusal", START + 4 * MINUTE, code="PAPER_EXEC_CLIENT_NOT_SANDBOX")],
                        summary(), 0, None, {"REFUSED:PAPER_EXEC_CLIENT_NOT_SANDBOX"}),
            "nothing at all": ([], None, None, None, {"JOURNAL_MISSING", "SUMMARY_MISSING", "RUNNER_EXIT_UNKNOWN"}),
        }
        for name, (lines, found_summary, exit_code, egress, reasons) in cases.items():
            with self.subTest(name):
                found = paper.readings(ROW, lines, 0, found_summary, exit_code, egress)
                self.assertEqual((found["status"], set(found["reasons"])), ("invalid", reasons))

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
        self.profile = self.service.ledger("paper")
        strategies.publish_candidate(self.profile, source("start"), "start", "Fixture", "template root")
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def open(self, op_id: str = "paper-start:1", source_sha256: str | None = None) -> dict:
        return paper.open_paper_run(self.conn, source_sha256 or sha(source("start")), "ghcr.io/x/y@sha256:" + "0" * 64,
                                    ["BTCUSDT"], "c" * 32, {"execution": "paper-bars"}, op_id)

    def test_a_declared_run_is_sealed_once_and_listed_with_its_readings(self):
        opened = self.open()
        self.assertEqual(self.open()["paper_id"], opened["paper_id"], "a retried start is the same run")
        files = {"seal.json": json.dumps({"status": "complete"}).encode(), "summary.json": b"{}"}
        sealed = paper.seal_paper_run(self.conn, opened["paper_id"], files)
        self.assertEqual(sealed["bundle"], f"paper-{opened['paper_id']}-capture")
        self.assertEqual(paper.seal_paper_run(self.conn, opened["paper_id"], files)["write_status"], "replayed")
        with self.assertRaises(Refusal) as caught:
            paper.seal_paper_run(self.conn, opened["paper_id"], {**files, "summary.json": b'{"other": 1}'})
        self.assertEqual(caught.exception.code, "BUNDLE_EXISTS")
        second = self.open("paper-start:2")
        listed = paper.paper_runs(self.conn)
        self.assertEqual([(run["paper_id"], run["symbols"], run["seal"]) for run in listed],
                         [(opened["paper_id"], ["BTCUSDT"], {"status": "complete"}), (second["paper_id"], ["BTCUSDT"], None)])

    def test_only_published_sources_run_and_only_the_product_writes_a_capture(self):
        with self.assertRaises(Refusal) as caught:
            self.open(source_sha256="f" * 64)
        self.assertEqual(caught.exception.code, "UNKNOWN_CANDIDATE")
        with self.assertRaises(Refusal) as caught:
            paper.seal_paper_run(self.conn, 99, {"seal.json": b"{}"})
        self.assertEqual(caught.exception.code, "PAPER_RUN_UNKNOWN")
        with tempfile.TemporaryDirectory() as root:
            Path(root, "seal.json").write_text("{}", encoding="utf-8")
            with self.assertRaises(Refusal) as caught:
                evidence.add_bundle(self.conn, "paper-1-capture", [Path(root, "seal.json")])
        self.assertEqual(caught.exception.code, "RESERVED_BUNDLE")

    def test_upgrade_adds_the_table_to_a_ledger_without_it(self):
        for statement in ("DROP TRIGGER paper_run_created", "DROP TABLE paper_run",
                          "CALL DOLT_COMMIT('-A', '-m', 'a ledger from before paper_run')"):
            self.service.sql(self.profile, statement)
        self.assertEqual(paper.paper_runs(self.conn), [])
        with self.assertRaises(Refusal) as caught:
            self.open()
        self.assertEqual(caught.exception.code, "LEDGER_UPGRADE_REQUIRED")
        self.assertEqual(db.upgrade(self.profile)["created"], ["paper_run", "paper_run_created"])
        self.assertEqual(self.open()["paper_id"], 1)


    def changed(self) -> list[tuple[str, str]]:
        with db.connect(self.profile, "reader") as reader:
            found = review.review_all(reader, tables=["paper_run", "evidence_bundle", "evidence", "evidence_content"])
        return sorted((item["table"], item["record_id"]) for item in found["findings"] if item["code"] == "ROW_CHANGED")

    def test_a_deleted_run_leaves_only_its_own_rows_and_the_review_accepts_exactly_that(self):
        first, second, open_run = self.open(), self.open("paper-start:2"), self.open("paper-start:3")
        shared = b'{"limitations": []}'
        paper.seal_paper_run(self.conn, first["paper_id"], {"seal.json": b'{"status": "invalid"}', "summary.json": shared})
        paper.seal_paper_run(self.conn, second["paper_id"], {"seal.json": b'{"status": "complete"}', "summary.json": shared})
        self.conn.close()
        deleted = paper.delete_paper_run(self.profile, first["paper_id"])
        self.assertEqual((deleted["bundle"], deleted["contents_deleted"]), ("paper-1-capture", 1))
        with db.connect(self.profile, "reader") as reader:
            self.assertEqual([(run["paper_id"], run["seal"]) for run in paper.paper_runs(reader)],
                             [(2, {"status": "complete"}), (3, None)])
            self.assertEqual(evidence.load_bundle(reader, "paper-2-capture")["files"]["summary.json"], shared)
        for paper_id, code in ((first["paper_id"], "PAPER_RUN_UNKNOWN"), (open_run["paper_id"], "PAPER_RUN_ACTIVE")):
            with self.subTest(code), self.assertRaises(Refusal) as caught:
                paper.delete_paper_run(self.profile, paper_id)
            self.assertEqual(caught.exception.code, code)
        self.assertEqual(self.changed(), [])
        # a removal under any other message, or of another run under a deletion's message, is still found
        self.service.sql(self.profile, "DELETE FROM paper_run WHERE paper_id = 3")
        self.service.sql(self.profile, "CALL DOLT_COMMIT('-a', '-m', 'paper_delete:2')")
        self.service.sql(self.profile, "DELETE FROM evidence WHERE bundle = 'paper-2-capture' AND path = 'seal.json'")
        self.service.sql(self.profile, "CALL DOLT_COMMIT('-a', '-m', 'tamper')")
        self.assertEqual(self.changed(), [("evidence", "paper-2-capture/seal.json"), ("paper_run", "3")])


if __name__ == "__main__":
    unittest.main()
