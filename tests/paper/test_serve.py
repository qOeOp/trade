"""If this fails, the Paper panel misleads or is open to other pages: a page of another site or port can
start or delete a paper run, a run's live readings differ from what its seal computes from the same journal, a
run's stream drops lines, mixes in other contracts' bars or never ends once the run is sealed, the
Account view's stream misses a contract's closes, or the exceptions its strategy raised (while it runs
or once sealed) never reach the page."""

from __future__ import annotations

from contextlib import redirect_stderr
from datetime import UTC, datetime

import gzip
import http.client
import json
import io
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

from ledger import db, paper as records, run_journal, strategies
from shared.errors import Refusal
from paper import runs, serve
from replay import comparison
from tests.ledger.dolt import BINARY, SKIP, Service, sha, source
from tests.ledger.test_paper import ROW, journal, line, snapshot, START, MINUTE
from tests.helpers import refused


HOST = "paper.test:8767"
FAILURE = {"format": "runtime-failure", "stage": "on_bar", "exception_type": "AttributeError",
           "instrument_id": "BTCUSDT-PERP.BINANCE", "code": None, "message": "no attribute 'is_flat'",
           "traceback": "Traceback (most recent call last):\n", "count": 4}


def server(daemon) -> tuple[serve.Server, int]:
    found = serve.Server(("127.0.0.1", 0), serve.handler(daemon, frozenset({HOST})))
    threading.Thread(target=found.serve_forever, args=(0.01,), daemon=True).start()
    return found, found.server_address[1]


def request(port: int, method: str, path: str, body: bytes | None = None, **headers) -> tuple[int, dict]:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request(method, path, body=body, headers={"Host": HOST, **headers})
    response = conn.getresponse()
    found = json.loads(response.read() or b"null")
    conn.close()
    return response.status, found


def write(path: Path, lines: list[dict], tail: str = "") -> None:
    with path.open("a", encoding="utf-8") as stream:
        stream.write("".join(json.dumps(item) + "\n" for item in lines) + tail)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.daemon = mock.Mock(profile=SimpleNamespace(database="paper"))
        self.daemon.start.return_value = {"paper_id": 1}
        self.server, self.port = server(self.daemon)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_only_the_ides_own_page_reaches_it(self):
        self.assertEqual(request(self.port, "GET", "/api/paper/health")[0], 200)
        refused = [request(self.port, "GET", "/api/paper/health", Host="evil.test:8767"),
                   request(self.port, "POST", "/api/paper/runs", b'{"candidate": "a@1"}',
                           **{"Content-Type": "application/json", "Sec-Fetch-Site": "same-site"}),
                   request(self.port, "POST", "/api/paper/runs", b'{"candidate": "a@1"}',
                           **{"Content-Type": "application/json", "Sec-Fetch-Site": "cross-site"}),
                   request(self.port, "POST", "/api/paper/runs", b'{"candidate": "a@1"}',
                           **{"Content-Type": "text/plain"})]
        self.assertEqual([status for status, _ in refused], [403, 403, 403, 415])
        self.daemon.start.assert_not_called()
        status, found = request(self.port, "POST", "/api/paper/runs", b'{"candidate": "a@1"}',
                                **{"Content-Type": "application/json", "Sec-Fetch-Site": "same-origin"})
        self.assertEqual((status, found), (200, {"paper_id": 1}))

    def test_a_length_that_is_not_plain_digits_is_refused_before_the_daemon(self):
        oversized = b'{"x": "' + b"a" * serve.BODY_LIMIT + b'"}'  # -1 would read it all, past BODY_LIMIT
        for length, body in (("-1", oversized), ("abc", b"{}"), ("+2", b"{}"), ("9" * 5000, b"{}")):
            with self.subTest(length), socket.create_connection(("127.0.0.1", self.port), timeout=5) as raw:
                raw.sendall(f"POST /api/paper/runs HTTP/1.1\r\nHost: {HOST}\r\nContent-Type: application/json\r\n"
                            f"Connection: close\r\nContent-Length: {length}\r\n\r\n".encode() + body)
                raw.shutdown(socket.SHUT_WR)
                self.assertTrue(raw.makefile("rb").read().startswith(b"HTTP/1.1 400 "))
        self.daemon.start.assert_not_called()

    def test_a_refused_start_answers_by_kind_and_logs_its_code(self):
        json_body = {"Content-Type": "application/json"}
        for code, status in (("PAPER_MEMORY_FULL", 409), ("USAGE_ERROR", 400),
                             ("RUNTIME_UNAVAILABLE", 503), ("PAPER_FAILED", 500)):
            with self.subTest(code):
                self.daemon.start.side_effect = Refusal(code, "4 paper runs are running; stop one first",
                                                       write_status="not_written")
                with mock.patch("sys.stderr", new_callable=io.StringIO) as logged:
                    answer = request(self.port, "POST", "/api/paper/runs", b'{"candidate": "a@1"}', **json_body)
                self.assertEqual(answer, (status, {"code": code, "message": "4 paper runs are running; stop one first",
                                                   "missing": [], "write_status": "not_written"}))
                self.assertIn(f"{status} {code}: 4 paper runs are running", logged.getvalue())

    def test_a_start_that_failed_after_its_declaration_says_what_it_wrote(self):
        """The command line's refusal reaches the page whole, past a line a launcher printed before it: PAPER_START_FAILED
        was written and names its capture."""
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.ledger, daemon.product = None, Path(".")
        printed = Refusal("PAPER_START_FAILED", "paper run 7 did not start and was sealed with START_FAILED",
                          missing=("paper-7-capture",), write_status="written").as_dict()
        warning = "warning: `VIRTUAL_ENV=/opt/venv` does not match the project environment path `.venv`\n"
        done = subprocess.CompletedProcess([], 1, stdout="", stderr=warning + json.dumps(printed, indent=2) + "\n")
        with mock.patch.object(serve.subprocess, "run", return_value=done):
            caught = refused(daemon.cli, "start", "--candidate", "a@1", error=serve.Failure)
        self.assertEqual((caught.status, caught.body), (409, {
            "code": "PAPER_START_FAILED", "message": "paper run 7 did not start and was sealed with START_FAILED",
            "missing": ["paper-7-capture"], "write_status": "written"}))

    def test_a_resumed_stream_names_all_three_parameters_as_integers(self):
        for query in ("lines=3", "lines=3&last=1&bars=x", "lines=-1&last=1&bars=0"):
            self.assertEqual(request(self.port, "GET", f"/api/paper/runs/1/stream?{query}"), (400, mock.ANY))

    def test_a_comparison_starts_and_is_read_through_the_daemon(self):
        self.daemon.compare.return_value = {"paper_id": 3, "state": "comparing"}
        self.daemon.compared.return_value = {"paper_id": 3, "state": "none"}
        json_body = {"Content-Type": "application/json"}
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/3/compare", b"{}", **json_body),
                         (202, {"paper_id": 3, "state": "comparing"}))
        self.daemon.compare.assert_called_once_with(3, False)
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/3/compare", b'{"preliminary": true}', **json_body),
                         (202, {"paper_id": 3, "state": "comparing"}))
        self.daemon.compare.assert_called_with(3, True)
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/3/compare", b'{"preliminary": 1}', **json_body),
                         (400, mock.ANY))
        self.assertEqual(request(self.port, "GET", "/api/paper/runs/3/compare"), (200, {"paper_id": 3, "state": "none"}))

    def test_a_delete_reaches_the_daemon(self):
        self.daemon.delete.return_value = {"paper_id": 3, "write_status": "written"}
        json_body = {"Content-Type": "application/json"}
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/3/delete", b"{}", **json_body),
                         (200, {"paper_id": 3, "write_status": "written"}))
        self.daemon.delete.assert_called_once_with(3)

    def test_a_start_names_a_candidate_and_binance_symbols(self):
        daemon = serve.Daemon.__new__(serve.Daemon)
        for body in ({}, {"candidate": "a@1", "symbols": ["btc usdt"]}, {"candidate": "a@1", "symbols": []},
                     {"candidate": "a@1", "universe": "all"}):
            with self.subTest(body):
                caught = refused(daemon.start, body, error=serve.Failure)
            self.assertEqual(caught.body["code"], "USAGE_ERROR")
        # A non-ASCII coin is a contract as replay takes it (market.sources.SYMBOL): it reaches the candidate read.
        daemon.research_profile = "research"
        with mock.patch.object(serve.db, "read_as_of", side_effect=RuntimeError("read")), \
                self.assertRaisesRegex(RuntimeError, "read"):
            daemon.start({"candidate": "a@1", "symbols": ["币安人生USDT"]})


class ListenTests(unittest.TestCase):
    """Loopback only on a host; inside a container (compose) on its own address, with TMPDIR a host
    directory mounted at its own path, since the containers it starts are mounted by host path."""

    def test_a_host_daemon_listens_on_loopback_only(self):
        with mock.patch.object(serve, "CONTAINER_MARK", Path("/nonexistent/.dockerenv")):
            self.assertEqual(refused(lambda: serve.serve(None, None, "0.0.0.0", 0, [], Path("."))).code, "USAGE_ERROR")

    def test_in_a_container_it_needs_a_usable_tmpdir(self):
        with tempfile.TemporaryDirectory() as root:
            mark = Path(root, ".dockerenv")
            mark.touch()
            shared = Path(root, "tmp")
            shared.mkdir()
            with mock.patch.object(serve, "CONTAINER_MARK", mark), mock.patch.object(serve.tempfile, "tempdir", None):
                for given in ({}, {"TMPDIR": str(Path(root, "missing"))}):
                    with self.subTest(given), mock.patch.dict("os.environ", given, clear=False):
                        if "TMPDIR" not in given:
                            os.environ.pop("TMPDIR", None)
                        self.assertEqual(refused(lambda: serve.serve(None, None, "0.0.0.0", 0, [], Path("."))).code,
                                         "USAGE_ERROR")
                with mock.patch.dict("os.environ", {"TMPDIR": str(shared)}):
                    serve.shared_tmpdir()


class JournalTests(unittest.TestCase):
    def test_readings_are_what_the_seal_computes_from_the_same_journal(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root, "events.jsonl")
            write(path, journal(), '{"kind": "snapshot", "wall')
            found = serve.Journal()
            found.read(path)
        self.assertEqual((found.bars, found.last_bar_ns), (1, START + MINUTE - 10**6))
        self.assertFalse(any(item["kind"] == "bar" for item in found.lines))
        with mock.patch.object(run_journal, "equity_path", wraps=run_journal.equity_path) as computed:
            live = serve.readings(ROW, found)
        self.assertEqual(computed.call_count, 1, "CF-24: the readings and the drawn path share one equity path")
        sealed = run_journal.readings(ROW, journal(), 0, None, None, None)
        self.assertEqual((live["total_return"], live["max_drawdown"], live["fills"]),
                         (sealed["total_return"], sealed["max_drawdown"], sealed["fills"]))
        self.assertEqual([minute for minute, _ in live["equity"]], [START, START + MINUTE, START + 2 * MINUTE])
        self.assertAlmostEqual(live["equity"][-1][1], 100009.9)  # 99990 + 20 open, less 0.1 funding

    def test_late_bars_count_the_runs_own_delay_after_binance_sent_each_bar_as_the_seal_does(self):
        """User 2026-11-18: a bar is late when received (ts_init) more than 2 s after Binance sent it (its kline_event,
        engine.kline_events), Binance's own delay aside; neither line kind is listed for the page."""
        iid, late = "BTCUSDT-PERP.BINANCE", 2 * 10**9
        closes = [START + i * MINUTE - 10**6 for i in (1, 2, 3, 4)]
        sent = [close + 10**6 + 3 * 10**9 for close in closes]  # Binance sent every bar 3 s after its close
        lines = [line("started", START, source_sha256="s"),
                 line("bar", 0, instrument_id=iid, ts_event=closes[0], ts_init=sent[0] + late),  # on time
                 line("kline_event", 0, instrument_id=iid, ts_event=closes[0], event_ns=sent[0]),
                 line("kline_event", 0, instrument_id=iid, ts_event=closes[1], event_ns=sent[1]),  # before its bar
                 line("bar", 0, instrument_id=iid, ts_event=closes[1], ts_init=sent[1] + late + 1),  # late
                 line("bar", 0, instrument_id=iid, ts_event=closes[2], ts_init=sent[2] + late + 1),  # unknown
                 line("bar", 0, instrument_id=iid, ts_event=closes[3], ts_init=sent[3] + late + 1),
                 line("kline_event", 0, instrument_id=iid, ts_event=closes[3], event_ns=sent[3])]  # late
        with tempfile.TemporaryDirectory() as root:
            path = Path(root, "events.jsonl")
            write(path, lines)
            found = serve.Journal()
            found.read(path)
        self.assertEqual([item["kind"] for item in found.lines], ["started"])
        self.assertEqual((serve.readings(ROW, found)["late_bars"], run_journal.readings(ROW, lines, 0, None, None, None)["late_bars"]),
                         (2, 2))
        self.assertEqual([item["kind"] for item in lines if serve._wanted(item, iid)], ["started", "bar", "bar", "bar", "bar"])
        # A page holding the one listed line and the bars resumes with nothing new.
        self.assertEqual([item for item in serve.resumed(lines, serve.Resume(1, START, closes[3])) or [None]
                          if serve._wanted(item, iid)], [])

    def test_waiting_input_boundary_is_derived_from_the_existing_journal(self):
        found = serve.Journal(lines=[line("started", START, input_start_ns=START + 1440 * MINUTE),
                                     line("waiting", START, until_ns=START + 1440 * MINUTE)])
        live = serve.readings(ROW, found)
        self.assertEqual(live["input_start_ns"], START + 1440 * MINUTE)
        self.assertEqual((live["bars"], live["last_bar_ns"], live["equity"]), (0, None, []))
        self.assertIsNone(live["final_equity_usdt"])
        self.assertIsNone(serve.readings(ROW, serve.Journal())["input_start_ns"])
        normal = serve.Journal(lines=[line("started", START, input_start_ns=START + MINUTE)])
        self.assertIsNone(serve.readings(ROW, normal)["input_start_ns"], "a minute-boundary start is not a daily warm-up")
        before = {**live, "input_start_ns": None, "exceptions": 0}
        self.assertNotEqual(serve._changed(before), serve._changed({**before, "input_start_ns": START}),
                            "the stream announces warm-up even before any bars arrive")

    def test_failure_records_skip_a_line_the_capture_tail_cut(self):
        record = json.dumps(FAILURE).encode()
        self.assertEqual(serve.failure_records(record[40:] + b"\n" + record + b"\n" + record[:30]), [FAILURE])



class OrphanTests(unittest.TestCase):
    def test_a_runs_age_reads_its_naive_created_at_as_utc_whatever_the_hosts_zone(self):
        created = datetime(2026, 11, 8, 14, 0)  # the ledger's UTC_TIMESTAMP, read back naive
        start = created.replace(tzinfo=UTC).timestamp()
        zone = os.environ.get("TZ")
        try:
            for name in ("Asia/Tokyo", "America/New_York", "UTC"):
                os.environ["TZ"] = name
                time.tzset()
                for age, orphan in ((599, False), (601, True)):
                    with self.subTest(zone=name, age=age):
                        self.assertIs(serve.orphaned({"state": "unsealed", "created_at": created}, start + age), orphan)
                self.assertFalse(serve.orphaned({"state": "running", "created_at": created}, start + 601))
        finally:
            if zone is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = zone
            time.tzset()


class RestartTests(unittest.TestCase):
    def daemon(self, root):
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.profile, daemon.stopping = SimpleNamespace(database="paper"), {5}
        daemon.release_route = daemon.release_name = None
        daemon.market = None
        daemon.recovery_failures = {}
        daemon.runs = mock.Mock(return_value={"runs": [
            {"paper_id": i, "state": "sealed" if i == 4 else "running" if i == 6 else "ended"}
            for i in range(1, 7)]})
        daemon.cli = mock.Mock()
        daemon.start = mock.Mock()
        daemon.write_months = mock.Mock()
        return daemon

    def test_interruptions_resume_same_run_and_only_explicit_ends_seal(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            daemon.market = "/market"
            for i in (1, 2, 3):
                (root / str(i) / "out").mkdir(parents=True)
            (root / "1/out/summary.json").write_text(json.dumps({"stop_reason": "SIGTERM"}))
            paused(root / "1/out")
            (root / "2/out/STOP").touch()
            (root / "3/out/summary.json").write_text(json.dumps({"stop_reason": "DURATION"}))
            with mock.patch.object(runs, "run_dir", side_effect=lambda _, i: root / str(i)):
                daemon.seal_found()
            self.assertEqual([call.args for call in daemon.cli.call_args_list], [
                ("resume", "--paper-id", "1", "--market", "/market"), ("seal", "--paper-id", "2"),
                ("seal", "--paper-id", "3")])
            daemon.start.assert_not_called()
            self.assertEqual([call.args[0]["paper_id"] for call in daemon.write_months.call_args_list], [6])

    def test_the_automatic_resume_names_the_market_the_daemon_was_configured_with(self):
        """`paper resume` reads the market's contract terms: without --market it fails LEDGER_UNKNOWN and the run
        stays ended until someone resumes it by hand (the manual path passes it)."""
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            daemon.market = "/data/market"
            daemon.runs.return_value = {"runs": [{"paper_id": 1, "state": "ended"}]}
            (root / "1" / "out").mkdir(parents=True)
            with mock.patch.object(runs, "run_dir", side_effect=lambda _, i: root / str(i)):
                daemon.seal_found()
                daemon.resume_run(1)
            self.assertEqual([call.args for call in daemon.cli.call_args_list],
                             [("resume", "--paper-id", "1", "--market", "/data/market")] * 2)

    def test_a_sealed_run_that_left_containers_or_its_directory_is_sealed_again_to_collect_them(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            daemon.runs.return_value = {"runs": [{"paper_id": i, "state": "sealed", "containers": ["runner"] if i == 2 else []}
                                                 for i in (1, 2, 3)]}  # run 2 left its stopped runner
            (root / "1" / "out").mkdir(parents=True)  # run 1 its directory
            with mock.patch.object(runs, "run_dir", side_effect=lambda _, i: root / str(i)):
                daemon.seal_found()
                self.assertEqual([call.args for call in daemon.cli.call_args_list],
                                 [("seal", "--paper-id", "1"), ("seal", "--paper-id", "2")])
                daemon.cli.reset_mock()
                daemon.cli.side_effect = serve.Failure(500, "PAPER_FAILED", "docker-api unavailable")
                with redirect_stderr(io.StringIO()) as err:
                    daemon.seal_found()
                    daemon.seal_found()
            self.assertEqual(daemon.cli.call_count, 4, "a failed removal is tried again")
            self.assertEqual(err.getvalue().count("docker-api unavailable"), 2, "and reported once per run")

    def test_missing_or_dirty_checkpoint_retains_the_run_and_exposes_failure(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            daemon.runs.return_value = {"runs": [{"paper_id": 1, "state": "ended"}]}
            daemon.cli.side_effect = serve.Failure(409, "PAPER_RECOVERY_UNAVAILABLE", "journal has a tail")
            with mock.patch.object(runs, "run_dir", return_value=root), redirect_stderr(io.StringIO()):
                daemon.seal_found()
            daemon.cli.assert_called_once_with("resume", "--paper-id", "1")  # no market configured: none passed
            daemon.start.assert_not_called()
            self.assertEqual(daemon.recovery_failures[1]["code"], "PAPER_RECOVERY_UNAVAILABLE")

    def test_a_command_that_times_out_or_cannot_run_is_that_run_s_failure(self):
        with tempfile.TemporaryDirectory() as name:
            daemon = self.daemon(Path(name))
            del daemon.cli  # the real one
            daemon.ledger, daemon.product = "isolated", Path(name)
            daemon.runs.return_value = {"runs": [{"paper_id": i, "state": "ended"} for i in (1, 2)]}
            for error in (subprocess.TimeoutExpired(["paper", "--secret"], 1), OSError("no process")):
                with self.subTest(error=error), redirect_stderr(io.StringIO()), \
                        mock.patch.object(runs, "run_dir", return_value=Path(name)), \
                        mock.patch.object(serve.subprocess, "run", side_effect=error) as command:
                    daemon.seal_found()
                    self.assertEqual(command.call_count, 2, "the second run is tried too")
                    self.assertEqual(daemon.recovery_failures[1], {
                        "code": "PAPER_FAILED", "message": f"paper resume failed: {type(error).__name__}"})

    def test_a_failed_pass_does_not_end_the_sealing_thread(self):
        with tempfile.TemporaryDirectory() as name:
            daemon = self.daemon(Path(name))
            daemon.runs.side_effect = OSError("no connection")
            with redirect_stderr(io.StringIO()) as err, \
                    mock.patch.object(serve.time, "sleep", side_effect=[None, None, KeyboardInterrupt]), \
                    self.assertRaises(KeyboardInterrupt):
                daemon.seal_ended()
            self.assertEqual(err.getvalue().count("paper sealing: OSError"), 2)

    def test_the_runs_listing_carries_a_failed_recovery_on_ended_and_unsealed_runs_only(self):
        """The release tick's probe reads `recovery: {code, message}` from /api/paper/runs (#2628)."""
        failure = {"code": "PAPER_RECOVERY_UNAVAILABLE", "message": "journal has a tail"}
        daemon = self.daemon(Path("/nonexistent"))
        daemon.stopping, daemon.starting, daemon.journals, daemon.listed = set(), set(), {}, None
        daemon.recovery_failures = {paper_id: failure for paper_id in (1, 2, 3, 4)}
        daemon.journal = mock.Mock(return_value=serve.Journal())
        listed = {"runs": [{"paper_id": 1, "state": "ended"}, {"paper_id": 2, "state": "unsealed"},
                           {"paper_id": 3, "state": "running"}, {"paper_id": 4, "state": "sealed"}]}
        with tempfile.TemporaryDirectory() as name, \
                mock.patch.object(runs, "listing", return_value=listed), \
                mock.patch.object(runs, "run_dir", return_value=Path(name)), \
                mock.patch.object(serve, "readings", side_effect=lambda row, journal: {}):
            found = {run["paper_id"]: run for run in serve.Daemon._runs(daemon)["runs"]}
        self.assertEqual(found[1]["recovery"], failure)
        self.assertEqual(found[2]["recovery"], failure)
        self.assertNotIn("recovery", found[3], "a running run has recovered")
        self.assertNotIn("recovery", found[4], "a sealed run is done")
        self.assertIsNone(found[3]["recovery_declared"], "no `started` line yet")

    def test_the_listing_says_whether_the_source_declares_recovery_as_its_runner_journalled_it(self):
        """The Paper page marks a running run that an interruption ends: the runner's verdict on the `started` line
        (engine.paper_session.declares_recovery); nothing before that line, nor for a line without the key."""
        for lines, expected in (([{"kind": "waiting"}], None),
                                ([{"kind": "started"}], None),
                                ([{"kind": "started", "recovery_declared": False}], False),
                                ([{"kind": "started", "recovery_declared": True}], True)):
            daemon = self.daemon(Path("/nonexistent"))
            daemon.stopping, daemon.starting, daemon.journals, daemon.listed = set(), set(), {}, None
            daemon.recovery_failures = {}
            daemon.journal = mock.Mock(return_value=serve.Journal(lines=list(lines)))
            with self.subTest(lines=lines), tempfile.TemporaryDirectory() as name, \
                    mock.patch.object(runs, "listing", return_value={"runs": [{"paper_id": 1, "state": "running"}]}), \
                    mock.patch.object(runs, "run_dir", return_value=Path(name)), \
                    mock.patch.object(serve, "readings", side_effect=lambda row, journal: {}):
                self.assertIs(serve.Daemon._runs(daemon)["runs"][0]["recovery_declared"], expected)

    def test_the_listing_names_a_held_runs_positions_without_a_working_stop_until_they_close(self):
        """User 2026-11-17 (keep it held, notify at once): a position whose `protection_gap` was journalled after the
        held start and which has not closed since is unprotected; a gap before it, a closed position and a source
        that declares recovery are not."""
        gap = lambda key, at: {"kind": "protection_gap", "wall_ns": at, "position_id": key,  # noqa: E731
                               "instrument_id": "BTCUSDT-PERP.BINANCE", "since_ns": at - 5}
        lines = [gap("P-0", 10), {"kind": "resumed", "wall_ns": 20},
                 gap("P-1", 30), gap("P-2", 31),
                 {"kind": "position", "wall_ns": 40, "position_id": "P-2", "type": "PositionClosed"},
                 {"kind": "position", "wall_ns": 41, "position_id": "P-1", "type": "PositionChanged",
                  "side": "LONG", "quantity": "0.5"}]
        for declared, since, named in ((False, 20, ["P-1"]), (True, None, [])):
            daemon = self.daemon(Path("/nonexistent"))
            daemon.stopping, daemon.starting, daemon.journals, daemon.listed = set(), set(), {}, None
            daemon.recovery_failures = {}
            journalled = [{"kind": "started", "recovery_declared": declared}, *lines]
            daemon.journal = mock.Mock(return_value=serve.Journal(lines=journalled))
            with tempfile.TemporaryDirectory() as name, \
                    mock.patch.object(runs, "listing", return_value={"runs": [{"paper_id": 1, "state": "running"}]}), \
                    mock.patch.object(runs, "run_dir", return_value=Path(name)), \
                    mock.patch.object(serve, "readings", side_effect=lambda row, journal: {}):
                run = serve.Daemon._runs(daemon)["runs"][0]
            self.assertEqual(run["held_since"], since)
            self.assertEqual([item["position_id"] for item in run["unprotected"]], named)
        self.assertEqual(serve.unprotected(lines, 20)[0], {"position_id": "P-1", "instrument_id": "BTCUSDT-PERP.BINANCE",
                                                           "since_ns": 25})

    def test_only_a_pause_or_a_missing_summary_resumes_every_other_end_seals(self):
        """A runner refusal (TERMS_CHANGED, a breach, a failed restore) or a node that stopped on its own leaves a
        dirty checkpoint that resume refuses; sealing captures its recovery originals instead of retrying forever."""
        reasons = ["SIGINT", None, "TERMS_CHANGED", "PAPER_EXEC_CLIENT_NOT_SANDBOX", "PAPER_RECOVERY_UNAVAILABLE",
                   "node_stopped"]
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            daemon.stopping = set()
            daemon.runs.return_value = {"runs": [{"paper_id": i, "state": "ended"} for i in range(1, 7)]}
            for i, reason in enumerate(reasons, 1):
                (root / str(i) / "out").mkdir(parents=True)
                if reason:
                    (root / str(i) / "out/summary.json").write_text(json.dumps({"stop_reason": reason}))
            paused(root / "1/out")
            with mock.patch.object(runs, "run_dir", side_effect=lambda _, i: root / str(i)):
                daemon.seal_found()
            self.assertEqual([call.args[0] for call in daemon.cli.call_args_list],
                             ["resume", "resume", "seal", "seal", "seal", "seal"])

    def test_a_signal_end_without_a_clean_checkpoint_is_sealed_not_resumed_forever(self):
        """A source without PAPER_RECOVERY cancels its orders on SIGTERM and cuts no checkpoint, so `resume` refuses
        it before counting an attempt; it was retried every tick and never sealed (finding 20261117-04). A pause
        that published its checkpoint still resumes."""
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            daemon.stopping = set()
            daemon.runs.return_value = {"runs": [{"paper_id": i, "state": "ended"} for i in range(1, 5)]}
            for i in range(1, 5):
                (root / str(i) / "out").mkdir(parents=True)
                (root / str(i) / "out/summary.json").write_text(json.dumps({"stop_reason": "SIGTERM"}))
            paused(root / "1/out")  # the recovery source's pause: a published cut, no marker
            (root / "3/out/recovery").mkdir()  # no recovery protocol: the marker and no cut
            (root / "3/out/recovery/dirty").touch()
            paused(root / "4/out")  # an earlier cut, then a callback the stop did not checkpoint
            (root / "4/out/recovery/dirty").touch()
            with mock.patch.object(runs, "run_dir", side_effect=lambda _, i: root / str(i)):
                daemon.seal_found()
            self.assertEqual([call.args[:3] for call in daemon.cli.call_args_list],
                             [("resume", "--paper-id", "1"), ("seal", "--paper-id", "2"),
                              ("seal", "--paper-id", "3"), ("seal", "--paper-id", "4")])


def paused(output: Path) -> None:
    """What the runner leaves when it pauses: a published checkpoint and no dirty marker (paper_checkpoint)."""
    (output / "recovery").mkdir(parents=True, exist_ok=True)
    (output / "recovery/current.json").write_text("{}")


def events(response) -> tuple[str, object]:
    kind = data = None
    while True:
        raw = response.fp.readline().decode().rstrip("\n")
        if raw.startswith("event: "):
            kind = raw[7:]
        elif raw.startswith("data: "):
            data = json.loads(raw[6:])
        elif raw == "" and kind:
            return kind, data


class CompareOutputTests(unittest.TestCase):
    """The temporary directory is a host directory that outlives the daemon: only the output read is kept."""

    def daemon(self, root):
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.profile, daemon.market = SimpleNamespace(database="paper"), None
        daemon.lock, daemon.comparing, daemon.journals, daemon.stopping = threading.Lock(), {}, {}, set()
        daemon.compare_root = lambda: root
        return daemon

    def compare(self, daemon, stamp, fails=None):
        def cli(*args, **kwargs):
            output = Path(args[args.index("--output") + 1])
            output.mkdir()
            (output / "replay").mkdir()
            if fails:
                raise fails
            (output / "comparison.json").write_text(json.dumps({"format": comparison.FORMAT, "output": output.name}))
        daemon.cli = mock.Mock(side_effect=cli)
        thread = mock.Mock(side_effect=lambda target, daemon: SimpleNamespace(start=target))
        with mock.patch.object(db, "connect"), mock.patch.object(records, "read_paper_run"), \
                mock.patch.object(records, "seal_of", return_value={"status": "valid"}), \
                mock.patch.object(serve.threading, "Thread", thread), \
                mock.patch.object(serve.time, "strftime", return_value=stamp):
            daemon.compare(3)

    def test_a_comparison_keeps_only_the_latest_output_and_a_delete_removes_it(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            (root / "3-20261108T000000Z").mkdir()  # left by an interrupted daemon
            (root / "31-20261108T000000Z").mkdir()  # another run's
            self.compare(daemon, "20261109T000001Z")
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["3-20261109T000001Z", "31-20261108T000000Z"])
            self.assertEqual(daemon.compared(3)["result"], {"format": comparison.FORMAT, "output": "3-20261109T000001Z"})
            (root / "3-20261109T000001Z" / "comparison.json").write_text(json.dumps({"format": "run-reconcile@2026-11-12"}))
            self.assertEqual(daemon.compared(3)["state"], "none", "an older format is replayed again")
            (root / "3-20261109T000001Z" / "comparison.json").write_text(json.dumps({"format": comparison.FORMAT}))

            self.compare(daemon, "20261109T000002Z", fails=serve.Failure(500, "PAPER_FAILED", "TimeoutExpired"))
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["3-20261109T000001Z", "31-20261108T000000Z"])

            blocked = root / "blocked"
            blocked.write_text("")  # a root that cannot be made, as on a full disk
            daemon.compare_root = lambda: blocked
            with self.assertRaises(FileExistsError):
                self.compare(daemon, "20261109T000003Z")
            blocked.unlink()
            daemon.compare_root = lambda: root
            self.assertNotEqual(daemon.compared(3)["state"], "comparing", "it can be asked again")

            daemon.cli = mock.Mock(return_value={"paper_id": 3})
            daemon.delete(3)
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["31-20261108T000000Z"])


class ResumeTests(unittest.TestCase):
    def test_a_resume_leaves_out_the_lines_and_bars_the_page_holds(self):
        whole = journal()
        held = [item for item in whole if item["kind"] != "bar"][:3]
        resume = serve.Resume(3, held[-1]["wall_ns"], START + MINUTE - 10**6)
        rest = serve.resumed(whole, resume)
        after = whole.index(held[-1])
        self.assertEqual(rest, [item for at, item in enumerate(whole)
                                if (item["ts_event"] > resume.bars if item["kind"] == "bar" else at > after)])
        self.assertLess(len(rest), len(whole))
        self.assertEqual([item["kind"] for item in serve.resumed(whole, serve.Resume(0, 0, 0))], [item["kind"] for item in whole])

    def test_a_page_whose_journal_differs_gets_none(self):
        whole, last = journal(), [item for item in journal() if item["kind"] != "bar"][2]["wall_ns"]
        self.assertIsNone(serve.resumed(whole, serve.Resume(99, last, 0)))
        self.assertIsNone(serve.resumed(whole, serve.Resume(3, last + 5_000, 0)))
        # The page's times are doubles: 256 ns off is still its journal.
        self.assertIsNotNone(serve.resumed(whole, serve.Resume(3, last - 256, 0)))


@unittest.skipUnless(BINARY, SKIP)
class EquityTailTests(unittest.TestCase):
    def test_a_streams_readings_carry_only_the_equity_points_it_has_not_sent(self):
        minute = [[START + index * MINUTE, 100_000.0 + index] for index in range(4320)]  # three days
        first = serve.equity_tail(None, {"fills": 0, "equity": minute[:-1]})
        self.assertEqual((first["equity_from"], first["equity"]), (0, minute[:-1]))
        later = serve.equity_tail(minute[:-1], {"fills": 0, "equity": minute})
        self.assertEqual((later["equity_from"], later["equity"], later["fills"]), (4319, minute[-1:], 0))
        self.assertLess(len(json.dumps(later)), 100, "a minute sends its point, not the whole path")
        settled = [*minute[:-2], [minute[-2][0], 99_000.0], minute[-1]]  # funding journalled after its snapshot
        self.assertEqual(serve.equity_tail(minute[:-1], {"equity": settled})["equity_from"], 4318)


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        research = self.service.ledger("research")
        self.profile = self.service.ledger("paper", holds="paper")
        strategies.publish_candidate(research, source("start"), "start", "Fixture", "template root")
        with db.connect(research, "reader") as published:
            records.copy_source(self.profile, published, "start@1")
        with db.connect(self.profile, "writer") as conn:
            self.row = records.open_paper_run(conn, sha(source("start")), "ghcr.io/x/y@sha256:" + "0" * 64,
                                              ["BTCUSDT", "ETHUSDT"], "2026-03-01", {"candidate": "start@1"}, "p:1")
        self.out = runs.run_dir(self.profile, self.row["paper_id"]) / "out"
        self.out.mkdir(parents=True)
        patcher = mock.patch.object(runs, "containers", return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.daemon = serve.Daemon("paper", None, Path("."), research="research")
        self.server, self.port = server(self.daemon)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def test_a_stream_follows_the_journal_for_one_contract_and_ends_at_the_seal(self):
        eth = line("bar", START + MINUTE, instrument_id="ETHUSDT-PERP.BINANCE", ts_event=START + MINUTE - 10**6)
        write(self.out / "events.jsonl", [*journal(), eth])
        (self.out / "state.json").write_text(json.dumps({"positions": [], "orders": []}), encoding="utf-8")
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request("GET", f"/api/paper/runs/{self.row['paper_id']}/stream?symbol=BTCUSDT", headers={"Host": HOST})
        response = conn.getresponse()
        self.addCleanup(conn.close)
        kind, first = events(response)
        self.assertEqual((kind, first), ("lines", journal()))
        self.assertEqual(events(response), ("state", {"positions": [], "orders": []}))
        kind, live = events(response)
        self.assertEqual((kind, live["fills"], len(live["equity"]), live["equity_from"]), ("readings", 1, 3, 0))
        later = [snapshot(START + 3 * MINUTE, "99990", "25"), eth]
        write(self.out / "events.jsonl", later)
        self.assertEqual(events(response), ("lines", later[:1]))
        capture = "".join(json.dumps(item) + "\n" for item in [*journal(), eth, *later]).encode()
        with db.connect(self.profile, "writer") as writer:
            records.seal_paper_run(writer, self.row["paper_id"], {
                "seal.json": b'{"status": "complete"}', "events/2026-10-25.jsonl.gz": gzip.compress(capture, mtime=0)})
        self.daemon.listed = None
        self.assertEqual(events(response), ("lines", []), "nothing the stream had not sent")
        self.assertEqual(events(response), ("failures", []))
        self.assertEqual(events(response)[0], "readings")
        self.assertEqual(events(response), ("end", {"status": "complete"}))

    def test_a_stream_sealed_after_its_directory_went_sends_the_sealed_tail_before_the_end(self):
        write(self.out / "events.jsonl", journal())
        response = self.stream()
        self.assertEqual(events(response), ("lines", [item for item in journal() if item["kind"] != "bar"]))
        self.assertEqual(events(response)[0], "closes")
        self.assertEqual(events(response)[0], "readings")
        later = [snapshot(START + 3 * MINUTE, "99990", "25"),
                 line("bar", START + 3 * MINUTE, instrument_id="BTCUSDT-PERP.BINANCE", ts_event=START + 3 * MINUTE,
                      close="99990")]
        capture = "".join(json.dumps(item) + "\n" for item in [*journal(), *later]).encode()
        with db.connect(self.profile, "writer") as writer:  # the run's last lines reached only its capture
            records.seal_paper_run(writer, self.row["paper_id"], {
                "seal.json": b'{"status": "complete"}', "events/2026-10-25.jsonl.gz": gzip.compress(capture, mtime=0)})
        (self.out / "events.jsonl").unlink()
        self.daemon.listed = None
        self.assertEqual(events(response), ("lines", later[:1]))
        self.assertEqual(events(response), ("closes", {"BTCUSDT": [[START + 3 * MINUTE, 99990.0]]}))
        self.assertEqual(events(response), ("failures", []))
        kind, readings = events(response)
        self.assertEqual((kind, readings["last_bar_ns"]), ("readings", START + 3 * MINUTE))
        self.assertEqual(events(response), ("end", {"status": "complete"}))

    def test_a_run_deleted_while_the_daemon_lists_is_read_once(self):
        with db.connect(self.profile, "writer") as writer:
            records.seal_paper_run(writer, self.row["paper_id"], {"seal.json": b'{"status": "complete"}'})
        listing = runs.listing

        def listed_then_deleted(profile):
            found = listing(profile)
            records.delete_paper_run(profile, self.row["paper_id"])
            return found

        with mock.patch.object(runs, "listing", side_effect=listed_then_deleted):
            found = self.daemon.runs()
        self.assertEqual([(run["paper_id"], run["seal"]) for run in found["runs"]],
                         [(self.row["paper_id"], {"status": "complete"})])

    def test_the_account_streams_every_contracts_closes_then_the_new_ones(self):
        bar = lambda symbol, minute, close: line("bar", START + minute * MINUTE, instrument_id=f"{symbol}-PERP.BINANCE",
                                                 ts_event=START + minute * MINUTE - 10**6, close=close)
        write(self.out / "events.jsonl", [*journal(), bar("BTCUSDT", 1, "100000.5"), bar("ETHUSDT", 1, "3900")])
        response = self.stream()
        kind, first = events(response)
        self.assertEqual((kind, [item["kind"] for item in first].count("bar")), ("lines", 0))
        self.assertEqual(events(response), ("closes", {"BTCUSDT": [[START + MINUTE - 10**6, 100000.5]],
                                                      "ETHUSDT": [[START + MINUTE - 10**6, 3900.0]]}))
        write(self.out / "events.jsonl", [bar("ETHUSDT", 2, "3901.25")])
        kind, found = events(response)
        while kind != "closes":
            kind, found = events(response)
        self.assertEqual(found, {"ETHUSDT": [[START + 2 * MINUTE - 10**6, 3901.25]]})

    def test_a_refusal_once_the_stream_has_begun_ends_it_without_a_second_response(self):
        write(self.out / "events.jsonl", journal())
        response = self.stream()
        self.assertEqual(events(response)[0], "lines")
        with mock.patch.object(self.daemon, "runs", side_effect=Refusal("LEDGER_UNKNOWN", "no accounts", write_status="not_written")):
            rest = response.read()
        self.assertNotIn(b"HTTP/1.1", rest)

    def test_a_resumed_stream_sends_only_what_follows_what_the_page_holds(self):
        write(self.out / "events.jsonl", journal())
        held = [item for item in journal() if item["kind"] != "bar"]
        later = [snapshot(START + 3 * MINUTE, "99990", "25"), line("bar", START + 3 * MINUTE, instrument_id="BTCUSDT-PERP.BINANCE", ts_event=START + 3 * MINUTE)]
        write(self.out / "events.jsonl", later)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        bars = START + MINUTE - 10**6
        conn.request("GET", f"/api/paper/runs/{self.row['paper_id']}/stream?symbol=BTCUSDT&lines={len(held)}&last={held[-1]['wall_ns']}&bars={bars}",
                     headers={"Host": HOST})
        self.addCleanup(conn.close)
        response = conn.getresponse()
        self.assertEqual(events(response), ("resumed", {"lines": len(held), "bars": bars}))
        self.assertEqual(events(response), ("lines", later))

    def stream(self) -> http.client.HTTPResponse:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request("GET", f"/api/paper/runs/{self.row['paper_id']}/stream", headers={"Host": HOST})
        self.addCleanup(conn.close)
        return conn.getresponse()

    def test_sealed_stream_preserves_its_observed_bar_count_and_cutoff(self):
        lines = journal()
        capture = "".join(json.dumps(item) + "\n" for item in lines).encode()
        with db.connect(self.profile, "writer") as writer:
            records.seal_paper_run(writer, self.row["paper_id"], {
                "seal.json": b'{"status": "complete"}', "events/2026-10-25.jsonl.gz": gzip.compress(capture, mtime=0)})
        response = self.stream()
        self.assertEqual(events(response)[0], "lines")
        self.assertEqual(events(response)[0], "closes")
        self.assertEqual(events(response), ("failures", []))
        kind, readings = events(response)
        self.assertEqual((kind, readings["bars"], readings["last_bar_ns"]),
                         ("readings", 1, START + MINUTE - 10**6))
        self.assertEqual(events(response), ("end", {"status": "complete"}))

    def test_the_listing_leaves_the_equity_path_to_the_stream(self):
        write(self.out / "events.jsonl", journal())
        status, listed = request(self.port, "GET", "/api/paper/runs")
        self.assertEqual(status, 200)
        live = listed["runs"][0]["readings"]
        self.assertNotIn("equity", live)
        self.assertEqual(live["fills"], 1)
        self.assertEqual(len(live["outline"]), 3)
        self.assertIsNone(live["held"], "no state.json yet")
        self.assertEqual(len(self.daemon.runs()["runs"][0]["readings"]["equity"]), 3, "the stream still reads it")

    def test_the_listing_carries_the_runners_open_positions(self):
        write(self.out / "events.jsonl", journal())
        position = {"position_id": "P-1", "instrument_id": "BTCUSDT-PERP.BINANCE", "signed_qty": "0.002",
                    "avg_px_open": "100000", "mark": "100100", "unrealized_pnl": "0.2", "realized_pnl": "-0.04"}
        (self.out / "state.json").write_text(json.dumps({"minute_ns": START, "positions": [position], "orders": []}),
                                             encoding="utf-8")
        _, listed = request(self.port, "GET", "/api/paper/runs")
        self.assertEqual(listed["runs"][0]["readings"]["held"], {"minute_ns": START, "positions": [position], "orders": []})

    def test_an_outline_keeps_the_ends_and_at_most_its_points(self):
        path = [[minute, float(minute)] for minute in range(1000)]
        found = serve.outline(path)
        self.assertEqual((len(found), found[0], found[-1]), (serve.OUTLINE, path[0], path[-1]))
        self.assertEqual(serve.outline(path[:5]), path[:5])

    def test_the_strategys_exceptions_stream_while_it_runs_and_from_the_seal(self):
        write(self.out / "events.jsonl", journal())
        (self.out / serve.FAILURES).write_text(json.dumps(FAILURE) + "\n", encoding="utf-8")
        self.assertEqual(self.daemon.runs()["runs"][0]["readings"]["exceptions"], 4)
        response = self.stream()
        self.assertEqual(events(response)[0], "lines")
        self.assertEqual(events(response), ("closes", {}))
        self.assertEqual(events(response), ("failures", [FAILURE]))
        self.assertEqual(events(response)[1]["exceptions"], 4)
        with db.connect(self.profile, "writer") as writer:
            records.seal_paper_run(writer, self.row["paper_id"], {
                "seal.json": b'{"status": "invalid"}', serve.FAILURES: (json.dumps(FAILURE) + "\n").encode(),
                "recovery/dump.rdb": b"the recovery dump", "runner.log": b"the runner's log"})
        read: list[str] = []

        def reading(*arguments):
            found = paper_files(*arguments)
            read.extend(found)
            return found
        paper_files = records.paper_files
        with mock.patch.object(records, "paper_files", side_effect=reading):
            response = self.stream()
            self.assertEqual(events(response)[0], "lines")
        self.assertEqual(read, [serve.FAILURES], "CF-24: the sealed stream reads the journal and failures alone")
        response = self.stream()
        self.assertEqual(events(response)[0], "lines")
        self.assertEqual(events(response), ("closes", {}))
        self.assertEqual(events(response), ("failures", [FAILURE]))
        kind, readings = events(response)
        self.assertEqual((kind, readings["exceptions"]), ("readings", 4))
        self.assertEqual(events(response), ("end", {"status": "invalid"}))
