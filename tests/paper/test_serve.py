"""If this fails, the Paper panel misleads or is open to other pages: a page of another site or port can
start a paper run, a run's live readings differ from what its seal computes from the same journal, a
run's stream drops lines, mixes in other contracts' bars or never ends once the run is sealed, the
Account view's stream misses a contract's closes, or the exceptions its strategy raised (while it runs
or once sealed) never reach the page."""

from __future__ import annotations

import http.client
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

from ledger import db, paper as records, strategies
from ledger.errors import Refusal
from paper import runs, serve
from tests.ledger.dolt import BINARY, SKIP, Service, sha, source
from tests.ledger.test_paper import ROW, journal, line, snapshot, START, MINUTE


HOST = "paper.test:8767"
FAILURE = {"format": "runtime-failure-v2", "stage": "on_bar", "exception_type": "AttributeError",
           "instrument_id": "BTCUSDT-PERP.BINANCE", "code": None, "message": "no attribute 'is_flat'",
           "traceback": "Traceback (most recent call last):\n", "count": 4}


def server(daemon) -> tuple[serve.ThreadingHTTPServer, int]:
    found = serve.ThreadingHTTPServer(("127.0.0.1", 0), serve.handler(daemon, frozenset({HOST})))
    found.daemon_threads = True
    threading.Thread(target=found.serve_forever, daemon=True).start()
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

    def test_a_reconciliation_starts_only_from_the_ides_own_page(self):
        self.daemon.reconcile.return_value = {"paper_id": 3, "state": "reconciling"}
        self.daemon.reconciliation.return_value = {"paper_id": 3, "state": "none"}
        json_body = {"Content-Type": "application/json"}
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/3/reconcile", b"{}",
                                 **json_body, **{"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.daemon.reconcile.assert_not_called()
        self.assertEqual(request(self.port, "POST", "/api/paper/runs/3/reconcile", b"{}", **json_body),
                         (202, {"paper_id": 3, "state": "reconciling"}))
        self.daemon.reconcile.assert_called_once_with(3)
        self.assertEqual(request(self.port, "GET", "/api/paper/runs/3/reconcile"), (200, {"paper_id": 3, "state": "none"}))

    def test_a_start_names_a_candidate_and_binance_symbols(self):
        daemon = serve.Daemon.__new__(serve.Daemon)
        for body in ({}, {"candidate": "a@1", "symbols": ["btc usdt"]}, {"candidate": "a@1", "symbols": []},
                     {"candidate": "a@1", "universe": "all"}):
            with self.subTest(body), self.assertRaises(serve.Failure) as caught:
                daemon.start(body)
            self.assertEqual(caught.exception.body["code"], "USAGE_ERROR")


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

    def test_failure_records_skip_a_line_the_capture_tail_cut(self):
        record = json.dumps(FAILURE).encode()
        self.assertEqual(serve.failure_records(record[40:] + b"\n" + record + b"\n" + record[:30]), [FAILURE])


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
        with mock.patch("cli.main.ledger_profile", return_value=self.profile):
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
        with db.connect(self.profile, "writer") as writer:
            records.seal_paper_run(writer, self.row["paper_id"], {"seal.json": b'{"status": "complete"}'})
        self.daemon.listed = None
        self.assertEqual(events(response), ("end", {"status": "complete"}))

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

    def stream(self) -> http.client.HTTPResponse:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request("GET", f"/api/paper/runs/{self.row['paper_id']}/stream", headers={"Host": HOST})
        self.addCleanup(conn.close)
        return conn.getresponse()

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
