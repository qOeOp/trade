"""The liquidation recorder: its spool lines and days, one connection's frames, pongs and close against a local
WebSocket server, a replaced connection overlapping its successor, Bybit's subscriptions and the healthcheck; no
real network."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from websockets.sync.server import ServerConnection, serve

from market import record

DAY_MS = 86_400_000


def lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def every(root: Path, venue: str) -> list[dict]:
    return [line for path in sorted((root / venue).glob("*.jsonl")) for line in lines(path)]


class Server:
    """A local WebSocket endpoint: sends `frames` to each connection, answers pings, records what it receives."""

    def __init__(self, frames=()):
        self.frames = list(frames)
        self.received: list[str] = []
        self.connections: list[ServerConnection] = []

    def handler(self, connection: ServerConnection) -> None:
        self.connections.append(connection)
        for frame in self.frames:
            connection.send(frame)
        for message in connection:
            self.received.append(message if isinstance(message, str) else message.decode())

    def __enter__(self):
        self.server = serve(self.handler, "127.0.0.1", 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"ws://127.0.0.1:{self.server.socket.getsockname()[1]}"
        return self

    def __exit__(self, *exc):
        self.server.shutdown()


def until(condition, seconds=10.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.05)
    return False


class SpoolTests(unittest.TestCase):
    def test_lines_carry_both_clocks_and_go_to_the_utc_day_of_their_arrival(self):
        with tempfile.TemporaryDirectory() as root:
            spool = record.Spool(Path(root), "binance")
            midnight = 1_793_577_600_000  # 2026-11-02T00:00Z
            with patch.object(record, "_now", side_effect=[(midnight - 1, 5), (midnight, 6)]):
                spool.write("binance-1", "frame", '{"e":"forceOrder"}')
                spool.write("binance-1", "pong")
            spool.close()
            self.assertEqual(lines(Path(root) / "binance" / "2026-11-01.jsonl"),
                             [{"at": midnight - 1, "mono": 5, "conn": "binance-1", "event": "frame",
                               "text": '{"e":"forceOrder"}'}])
            self.assertEqual(lines(Path(root) / "binance" / "2026-11-02.jsonl"),
                             [{"at": midnight, "mono": 6, "conn": "binance-1", "event": "pong"}])

    def test_a_line_is_readable_as_soon_as_it_is_written(self):
        with tempfile.TemporaryDirectory() as root:
            spool = record.Spool(Path(root), "bybit")
            spool.write("bybit-1", "open", "wss://x")
            self.assertEqual([line["event"] for line in every(Path(root), "bybit")], ["open"])
            spool.close()


class HoldTests(unittest.TestCase):
    def test_frames_verbatim_a_pong_per_ping_and_a_close_when_stopped(self):
        frame = '{"e":"forceOrder","o":{"s":"BTCUSDT","q":"0.010"}}'
        with tempfile.TemporaryDirectory() as root, Server([frame]) as server, patch.object(record, "PING", 0.2):
            spool, stop, opened = record.Spool(Path(root), "binance"), threading.Event(), threading.Event()
            thread = threading.Thread(target=record.hold, args=(server.url, spool, "binance-1", stop.is_set, opened))
            thread.start()
            self.assertTrue(until(lambda: sum(line["event"] == "pong" for line in every(Path(root), "binance")) >= 2))
            stop.set()
            thread.join(10)
            spool.close()
            found = every(Path(root), "binance")
        self.assertTrue(opened.is_set())
        self.assertEqual(found[0]["event"], "open")
        self.assertIn({"event": "frame", "text": frame}, [{k: line[k] for k in ("event", "text")} for line in found
                                                          if line["event"] == "frame"])
        self.assertEqual((found[-1]["event"], found[-1]["text"]), ("close", "stopped"))

    def test_a_connection_the_server_ends_closes_with_its_reason(self):
        with tempfile.TemporaryDirectory() as root, Server() as server:
            spool, opened = record.Spool(Path(root), "binance"), threading.Event()
            thread = threading.Thread(target=record.hold, args=(server.url, spool, "binance-1", lambda: False, opened))
            thread.start()
            self.assertTrue(until(lambda: bool(server.connections)))
            server.connections[0].close()
            thread.join(10)
            spool.close()
            last = every(Path(root), "binance")[-1]
        self.assertFalse(thread.is_alive())
        self.assertEqual(last["event"], "close")
        self.assertNotEqual(last["text"], "stopped")

    def test_an_unreachable_venue_leaves_a_close_and_no_open(self):
        with tempfile.TemporaryDirectory() as root:
            spool, opened = record.Spool(Path(root), "binance"), threading.Event()
            record.hold("ws://127.0.0.1:9", spool, "binance-1", lambda: False, opened)
            spool.close()
            self.assertEqual([line["event"] for line in every(Path(root), "binance")], ["close"])
        self.assertFalse(opened.is_set())


class KeepTests(unittest.TestCase):
    def test_a_connection_is_replaced_by_one_opened_before_it_closes(self):
        with (tempfile.TemporaryDirectory() as root, Server() as server, patch.object(record, "ROTATE", 1),
              patch.object(record, "OVERLAP", 0.5)):
            spool, stop = record.Spool(Path(root), "binance"), threading.Event()
            thread = threading.Thread(target=record.keep, args=("binance", server.url, spool, stop))
            thread.start()
            self.assertTrue(until(lambda: any(line["event"] == "close" for line in every(Path(root), "binance"))))
            stop.set()
            thread.join(15)
            spool.close()
            found = [(line["conn"], line["event"]) for line in every(Path(root), "binance")
                     if line["event"] in ("open", "close")]
        # the second opens before the first closes
        self.assertEqual(found[:3], [("binance-1", "open"), ("binance-2", "open"), ("binance-1", "close")])

    def test_a_failed_connection_is_retried(self):
        with (tempfile.TemporaryDirectory() as root, patch.object(record, "BACKOFF", (0.1, 0.2))):
            spool, stop = record.Spool(Path(root), "binance"), threading.Event()
            thread = threading.Thread(target=record.keep, args=("binance", "ws://127.0.0.1:9", spool, stop))
            thread.start()
            self.assertTrue(until(lambda: {line["conn"] for line in every(Path(root), "binance")} >= {"binance-2"}))
            stop.set()
            thread.join(15)
            spool.close()


class BybitTests(unittest.TestCase):
    def test_contracts_go_ten_a_request_each_written_before_it_is_sent_and_only_once(self):
        sent: list[str] = []
        written: list[tuple[str, str | None]] = []
        lines_at_send: list[int] = []

        class Socket:
            def send(self, text):
                sent.append(text)
                lines_at_send.append(len(written))

        class Lines:
            def write(self, conn, event, text=None):
                written.append((event, text))

        bybit = record.Bybit([f"C{i}USDT" for i in range(23)])
        held: set[str] = set()
        requests = [0]
        bybit.subscribe(Socket(), Lines(), "bybit-1", held, requests)  # type: ignore[arg-type]
        bybit.subscribe(Socket(), Lines(), "bybit-1", held, requests)  # type: ignore[arg-type]
        self.assertEqual([len(json.loads(text)["args"]) for text in sent], [10, 10, 3])
        self.assertEqual([json.loads(text)["req_id"] for text in sent], ["bybit-1-1", "bybit-1-2", "bybit-1-3"])
        self.assertEqual(written, [("subscribe", text) for text in sent])
        self.assertEqual(lines_at_send, [1, 2, 3])
        self.assertEqual(json.loads(sent[0])["args"][0], "allLiquidation.C0USDT")

    def test_a_listing_with_no_contract_is_refused(self):
        body = json.dumps({"result": {"list": []}}).encode()

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self, *args):
                return body

        with patch.object(record.urllib.request, "urlopen", return_value=Response()):
            with self.assertRaises(ValueError):
                record.Bybit().refresh()


class CheckTests(unittest.TestCase):
    def test_healthy_only_while_every_venue_wrote_a_line_lately(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(record.check(Path(root)), 1)
            for venue in record.VENUES:
                spool = record.Spool(Path(root), venue)
                spool.write(f"{venue}-1", "pong")
                spool.close()
            self.assertEqual(record.check(Path(root)), 0)
            self.assertEqual(record.check(Path(root), now=time.time() + record.STALE + 1), 1)


if __name__ == "__main__":
    unittest.main()
