"""If this fails, the Paper panel misleads or is open to other pages: a page of another site or port can
start or delete a paper run, a run's live readings differ from what its seal computes from the same journal, a
run's stream drops lines, mixes in other contracts' bars or never ends once the run is sealed, the
Account view's stream misses a contract's closes, or the exceptions its strategy raised (while it runs
or once sealed) never reach the page."""

from __future__ import annotations

from contextlib import redirect_stderr

import gzip
import http.client
import json
import io
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

from ledger import db, paper as records, strategies
from shared.errors import Refusal
from paper import reconcile, runs, serve
from tests.ledger.dolt import BINARY, SKIP, Service, sha, source
from tests.ledger.test_paper import ROW, journal, line, snapshot, START, MINUTE


HOST = "paper.test:8767"
FAILURE = {"format": "runtime-failure-v2", "stage": "on_bar", "exception_type": "AttributeError",
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
        """The command line's refusal reaches the page whole: PAPER_START_FAILED was written and names its capture."""
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.ledger, daemon.product = None, Path(".")
        printed = Refusal("PAPER_START_FAILED", "paper run 7 did not start and was sealed with START_FAILED",
                          missing=("paper-7-capture",), write_status="written").as_dict()
        done = subprocess.CompletedProcess([], 1, stdout="", stderr=json.dumps(printed))
        with mock.patch.object(serve.subprocess, "run", return_value=done), self.assertRaises(serve.Failure) as caught:
            daemon.cli("start", "--candidate", "a@1")
        self.assertEqual((caught.exception.status, caught.exception.body), (409, {
            "code": "PAPER_START_FAILED", "message": "paper run 7 did not start and was sealed with START_FAILED",
            "missing": ["paper-7-capture"], "write_status": "written"}))

    def test_a_resumed_stream_names_all_three_parameters_as_integers(self):
        for query in ("lines=3", "lines=3&last=1&bars=x", "lines=-1&last=1&bars=0"):
            self.assertEqual(request(self.port, "GET", f"/api/paper/runs/1/stream?{query}"), (400, mock.ANY))

    def test_a_reconciliation_starts_and_is_read_through_the_daemon(self):
        self.daemon.reconcile.return_value = {"paper_id": 3, "state": "reconciling"}
        self.daemon.reconciliation.return_value = {"paper_id": 3, "state": "none"}
        json_body = {"Content-Type": "application/json"}
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/3/reconcile", b"{}", **json_body),
                         (202, {"paper_id": 3, "state": "reconciling"}))
        self.daemon.reconcile.assert_called_once_with(3)
        self.assertEqual(request(self.port, "GET", "/api/paper/runs/3/reconcile"), (200, {"paper_id": 3, "state": "none"}))

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
            with self.subTest(body), self.assertRaises(serve.Failure) as caught:
                daemon.start(body)
            self.assertEqual(caught.exception.body["code"], "USAGE_ERROR")


class ListenTests(unittest.TestCase):
    """Loopback only on a host; inside a container (compose) on its own address, with TMPDIR a host
    directory mounted at its own path, since the containers it starts are mounted by host path."""

    def refused(self, call) -> str:
        with self.assertRaises(Refusal) as caught:
            call()
        return caught.exception.code

    def test_a_host_daemon_listens_on_loopback_only(self):
        with mock.patch.object(serve, "CONTAINER_MARK", Path("/nonexistent/.dockerenv")):
            self.assertEqual(self.refused(lambda: serve.serve(None, None, "0.0.0.0", 0, [], Path("."))), "USAGE_ERROR")

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
                        self.assertEqual(self.refused(lambda: serve.serve(None, None, "0.0.0.0", 0, [], Path("."))),
                                         "USAGE_ERROR")
                with mock.patch.dict("os.environ", {"TMPDIR": str(shared)}):
                    serve.shared_tmpdir()


class JournalTests(unittest.TestCase):
    def test_live_readings_are_what_the_seal_computes_from_the_same_journal(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root, "events.jsonl")
            write(path, journal(), '{"kind": "snapshot", "wall')
            found = serve.Journal()
            found.read(path)
        self.assertEqual((found.bars, found.last_bar_ns), (1, START + MINUTE - 10**6))
        self.assertFalse(any(item["kind"] == "bar" for item in found.lines))
        live = serve.live_readings(ROW, found)
        sealed = records.readings(ROW, journal(), 0, None, None, None)
        self.assertEqual((live["total_return"], live["max_drawdown"], live["fills"]),
                         (sealed["total_return"], sealed["max_drawdown"], sealed["fills"]))
        self.assertEqual([minute for minute, _ in live["equity"]], [START, START + MINUTE, START + 2 * MINUTE])
        self.assertAlmostEqual(live["equity"][-1][1], 100009.9)  # 99990 + 20 open, less 0.1 funding

    def test_waiting_input_boundary_is_derived_from_the_existing_journal(self):
        found = serve.Journal(lines=[line("started", START, input_start_ns=START + 1440 * MINUTE),
                                     line("waiting", START, until_ns=START + 1440 * MINUTE)])
        live = serve.live_readings(ROW, found)
        self.assertEqual(live["input_start_ns"], START + 1440 * MINUTE)
        self.assertEqual((live["bars"], live["last_bar_ns"], live["equity"]), (0, None, []))
        self.assertIsNone(live["final_equity_usdt"])
        self.assertIsNone(serve.live_readings(ROW, serve.Journal())["input_start_ns"])
        normal = serve.Journal(lines=[line("started", START, input_start_ns=START + MINUTE)])
        self.assertIsNone(serve.live_readings(ROW, normal)["input_start_ns"], "a minute-boundary start is not a daily warm-up")
        before = {**live, "input_start_ns": None, "exceptions": 0}
        self.assertNotEqual(serve._changed(before), serve._changed({**before, "input_start_ns": START}),
                            "the stream announces warm-up even before any bars arrive")

    def test_failure_records_skip_a_line_the_capture_tail_cut(self):
        record = json.dumps(FAILURE).encode()
        self.assertEqual(serve.failure_records(record[40:] + b"\n" + record + b"\n" + record[:30]), [FAILURE])



class RestartTests(unittest.TestCase):
    def daemon(self, root):
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.profile, daemon.stopping = SimpleNamespace(database="paper"), {5}
        daemon.recovery_failures = {}
        daemon.runs = mock.Mock(return_value={"runs": [
            {"paper_id": i, "state": "sealed" if i == 4 else "running" if i == 6 else "ended"}
            for i in range(1, 7)]})
        daemon.cli = mock.Mock()
        daemon.start = mock.Mock()
        return daemon

    def test_interruptions_resume_same_run_and_only_explicit_ends_seal(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            for i in (1, 2, 3):
                (root / str(i) / "out").mkdir(parents=True)
            (root / "1/out/summary.json").write_text(json.dumps({"stop_reason": "SIGTERM"}))
            (root / "2/out/STOP").touch()
            (root / "3/out/summary.json").write_text(json.dumps({"stop_reason": "DURATION"}))
            with mock.patch.object(runs, "run_dir", side_effect=lambda _, i: root / str(i)):
                daemon.seal_found()
            self.assertEqual([call.args for call in daemon.cli.call_args_list], [
                ("resume", "--paper-id", "1"), ("seal", "--paper-id", "2"), ("seal", "--paper-id", "3")])
            daemon.start.assert_not_called()

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
            daemon.cli.assert_called_once_with("resume", "--paper-id", "1")
            daemon.start.assert_not_called()
            self.assertEqual(daemon.recovery_failures[1]["code"], "PAPER_RECOVERY_UNAVAILABLE")

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
            with mock.patch.object(runs, "run_dir", side_effect=lambda _, i: root / str(i)):
                daemon.seal_found()
            self.assertEqual([call.args[0] for call in daemon.cli.call_args_list],
                             ["resume", "resume", "seal", "seal", "seal", "seal"])


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


class ReconcileOutputTests(unittest.TestCase):
    """The temporary directory is a host directory that outlives the daemon: only the output read is kept."""

    def daemon(self, root):
        daemon = serve.Daemon.__new__(serve.Daemon)
        daemon.profile, daemon.market = SimpleNamespace(database="paper"), None
        daemon.lock, daemon.reconciling, daemon.journals, daemon.stopping = threading.Lock(), {}, {}, set()
        daemon.reconcile_root = lambda: root
        return daemon

    def reconcile(self, daemon, stamp, fails=None):
        def cli(*args, **kwargs):
            output = Path(args[args.index("--output") + 1])
            output.mkdir()
            (output / "replay").mkdir()
            if fails:
                raise fails
            (output / "reconcile.json").write_text(json.dumps({"format": reconcile.FORMAT, "output": output.name}))
        daemon.cli = mock.Mock(side_effect=cli)
        thread = mock.Mock(side_effect=lambda target, daemon: SimpleNamespace(start=target))
        with mock.patch.object(db, "connect"), mock.patch.object(records, "read_paper_run"), \
                mock.patch.object(records, "seal_of", return_value={"status": "valid"}), \
                mock.patch.object(serve.threading, "Thread", thread), \
                mock.patch.object(serve.time, "strftime", return_value=stamp):
            daemon.reconcile(3)

    def test_a_reconciliation_keeps_only_the_latest_output_and_a_delete_removes_it(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            daemon = self.daemon(root)
            (root / "3-20261108T000000Z").mkdir()  # left by an interrupted daemon
            (root / "31-20261108T000000Z").mkdir()  # another run's
            self.reconcile(daemon, "20261109T000001Z")
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["3-20261109T000001Z", "31-20261108T000000Z"])
            self.assertEqual(daemon.reconciliation(3)["result"], {"format": reconcile.FORMAT, "output": "3-20261109T000001Z"})
            (root / "3-20261109T000001Z" / "reconcile.json").write_text(json.dumps({"format": "paper-reconcile@2026-10-26"}))
            self.assertEqual(daemon.reconciliation(3)["state"], "none", "an older format is replayed again")
            (root / "3-20261109T000001Z" / "reconcile.json").write_text(json.dumps({"format": reconcile.FORMAT}))

            self.reconcile(daemon, "20261109T000002Z", fails=subprocess.TimeoutExpired("paper reconcile", 1))
            self.assertEqual(sorted(path.name for path in root.iterdir()), ["3-20261109T000001Z", "31-20261108T000000Z"])

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
class StreamTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("paper")
        strategies.publish_candidate(self.profile, source("start"), "start", "Fixture", "template root")
        with db.connect(self.profile, "writer") as conn:
            self.row = records.open_paper_run(conn, sha(source("start")), "ghcr.io/x/y@sha256:" + "0" * 64,
                                              ["BTCUSDT", "ETHUSDT"], "c" * 32, {"candidate": "start@1"}, "p:1")
        self.out = runs.run_dir(self.profile, self.row["paper_id"]) / "out"
        self.out.mkdir(parents=True)
        patcher = mock.patch.object(runs, "containers", return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)
        with mock.patch("ledger.db.profile", return_value=self.profile):
            self.daemon = serve.Daemon("paper", None, Path("."))
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
        self.assertEqual((kind, live["fills"], len(live["equity"])), ("readings", 1, 3))
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
        live = listed["runs"][0]["live"]
        self.assertNotIn("equity", live)
        self.assertEqual(live["fills"], 1)
        self.assertEqual(len(live["outline"]), 3)
        self.assertIsNone(live["held"], "no state.json yet")
        self.assertEqual(len(self.daemon.runs()["runs"][0]["live"]["equity"]), 3, "the stream still reads it")

    def test_the_listing_carries_the_runners_open_positions(self):
        write(self.out / "events.jsonl", journal())
        position = {"position_id": "P-1", "instrument_id": "BTCUSDT-PERP.BINANCE", "signed_qty": "0.002",
                    "avg_px_open": "100000", "mark": "100100", "unrealized_pnl": "0.2", "realized_pnl": "-0.04"}
        (self.out / "state.json").write_text(json.dumps({"minute_ns": START, "positions": [position], "orders": []}),
                                             encoding="utf-8")
        _, listed = request(self.port, "GET", "/api/paper/runs")
        self.assertEqual(listed["runs"][0]["live"]["held"], {"minute_ns": START, "positions": [position], "orders": []})

    def test_an_outline_keeps_the_ends_and_at_most_its_points(self):
        path = [[minute, float(minute)] for minute in range(1000)]
        found = serve.outline(path)
        self.assertEqual((len(found), found[0], found[-1]), (serve.OUTLINE, path[0], path[-1]))
        self.assertEqual(serve.outline(path[:5]), path[:5])

    def test_the_strategys_exceptions_stream_while_it_runs_and_from_the_seal(self):
        write(self.out / "events.jsonl", journal())
        (self.out / serve.FAILURES).write_text(json.dumps(FAILURE) + "\n", encoding="utf-8")
        self.assertEqual(self.daemon.runs()["runs"][0]["live"]["exceptions"], 4)
        response = self.stream()
        self.assertEqual(events(response)[0], "lines")
        self.assertEqual(events(response), ("closes", {}))
        self.assertEqual(events(response), ("failures", [FAILURE]))
        self.assertEqual(events(response)[1]["exceptions"], 4)
        with db.connect(self.profile, "writer") as writer:
            records.seal_paper_run(writer, self.row["paper_id"], {
                "seal.json": b'{"status": "invalid"}', serve.FAILURES: (json.dumps(FAILURE) + "\n").encode()})
        response = self.stream()
        self.assertEqual(events(response)[0], "lines")
        self.assertEqual(events(response), ("closes", {}))
        self.assertEqual(events(response), ("failures", [FAILURE]))
        kind, readings = events(response)
        self.assertEqual((kind, readings["exceptions"]), ("readings", 4))
        self.assertEqual(events(response), ("end", {"status": "invalid"}))


if __name__ == "__main__":
    unittest.main()
