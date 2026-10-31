"""If these fail, the served research graph no longer follows the ledger: a page asking for a graph gets
it once it is drawn, an open page is told when the head moves and gets the latest graph only, a
slow or failed head read never takes the last view away, another site cannot make the browser fetch graphs, and only the page itself, with its token, can start a paper run. The product is a stand-in; no ledger or network is used."""

import copy
import http.client
import json
import re
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ide"))

from research_graph import serve  # noqa: E402
from tests.research_graph.test_research_graph import GRAPH  # noqa: E402


class FakeProduct:
    """`commit` answers the head (or a ref named in `refs`), waiting for `hold` when it is set and refusing
    with `failure` when that is; `graph` waits for `release` when it is set."""

    ledger = "copy"

    def __init__(self):
        self.head = "a" * 32
        self.refs: dict[str, str] = {}
        self.drawn: list[str] = []
        self.release: threading.Event | None = None
        self.hold: threading.Event | None = None
        self.reading = threading.Event()
        self.failure: dict | None = None

    def commit(self, ref=None):
        if ref is None:
            self.reading.set()
            if self.hold is not None:
                self.hold.wait(5)
            if self.failure is not None:
                raise serve.ProductError(self.failure)
            return self.head
        if ref not in self.refs:
            raise serve.ProductError({"code": "UNKNOWN_REF", "message": ref})
        return self.refs[ref]

    def lines(self, commit):
        return {"ledger_commit": commit, "lines": [{"bundle": "historical", "closed": True},
                                                   {"bundle": "current", "closed": False}]}

    def graph(self, commit, line, since):
        if self.release is not None:
            self.release.wait(5)
        self.drawn.append(commit)
        graph = copy.deepcopy(GRAPH)
        graph["scope"] = {**graph["scope"], "ledger_commit": commit}
        if line is not None:
            graph["line"]["bundle"] = line
        return graph


def until(condition, seconds=5.0):
    deadline = time.monotonic() + seconds
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("not reached in time")
        time.sleep(0.01)


class HubTests(unittest.TestCase):
    def setUp(self):
        self.product = FakeProduct()
        self.hub = serve.Hub(self.product, "build", poll=0.05)
        threading.Thread(target=self.hub.work, daemon=True).start()

    def states(self, client):
        found = []
        while (message := client.take(0)) is not None:
            found.append(message)
        return found

    def test_a_page_gets_its_graph_once_it_is_drawn(self):
        status, body = self.hub.view(None, None, None)
        self.assertEqual(status, 202)
        self.assertIn(body["state"], ("queued", "computing", "ready"))
        until(lambda: self.hub.view(None, None, None)[0] == 200)
        status, view = self.hub.view(None, None, None)
        self.assertEqual(view["scope"]["ledger_commit"], "a" * 32)
        self.assertEqual(self.product.drawn, ["a" * 32], "a cached view is not drawn again")

    def test_a_slow_head_read_does_not_hold_a_page(self):
        until(lambda: self.hub.view(None, None, None)[0] == 200)
        self.product.hold, self.product.head = threading.Event(), "b" * 32
        self.addCleanup(self.product.hold.set)
        self.product.reading.clear()
        threading.Thread(target=self.hub.refresh, daemon=True).start()
        self.product.reading.wait(5)
        time.sleep(0.1)  # the head was read longer than `poll` ago
        started = time.monotonic()
        status, view = self.hub.view(None, None, None)
        self.assertLess(time.monotonic() - started, 1, "the page does not wait for the head read")
        self.assertEqual((status, view["scope"]["ledger_commit"]), (200, "a" * 32), "it gets the last view")
        self.product.hold.set()
        until(lambda: self.hub.view(None, None, None)[1].get("scope", {}).get("ledger_commit") == "b" * 32)

    def test_a_completed_graph_is_available_while_the_new_head_is_still_drawing(self):
        first, latest = threading.Event(), threading.Event()
        draw = self.product.graph

        def graph(commit, line, since):
            (first if commit == "a" * 32 else latest).wait(5)
            return draw(commit, line, since)

        self.product.graph = graph
        self.addCleanup(latest.set)
        self.addCleanup(first.set)
        self.hub.refresh(wait=True)
        client = serve.Client("line-a", None, None)
        self.hub.join(client)
        until(lambda: self.hub.running == self.hub.key("a" * 32, "line-a", None))
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        first.set()
        until(lambda: self.hub.running == self.hub.key("b" * 32, "line-a", None))
        status, view = self.hub.view("line-a", None, None)
        self.assertEqual(status, 200, "new pages can show the completed graph instead of waiting for a moving head")
        self.assertEqual(view["scope"]["ledger_commit"], "a" * 32)
        self.assertEqual(view["line"]["bundle"], "line-a")
        self.assertEqual(client.sent, {"state": "computing", "ledger_commit": "b" * 32,
                                       "available_commit": "a" * 32})
        latest.set()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "b" * 32})
        self.assertEqual(self.hub.view("line-a", None, None)[1]["scope"]["ledger_commit"], "b" * 32)

    def test_live_fallback_never_changes_line_scope_or_explicit_snapshot(self):
        until(lambda: self.hub.view("line-a", None, None)[0] == 200)
        self.product.release = threading.Event()
        self.addCleanup(self.product.release.set)
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        self.assertEqual(self.hub.view("line-a", None, None)[0], 200)
        self.assertEqual(self.hub.view("line-b", None, None)[0], 202)
        self.assertEqual(self.hub.view("line-a", "s" * 32, None)[0], 202)
        self.assertEqual(self.hub.view("line-a", None, "b" * 32)[0], 202)
        self.assertEqual(self.hub.view(None, None, None)[0], 202, "an unnamed default may have changed lines")

    def test_a_busy_line_does_not_starve_a_pending_line_when_the_head_moves(self):
        first, later = threading.Event(), threading.Event()
        started = []
        draw = self.product.graph

        def graph(commit, line, since):
            started.append((commit, line))
            (first if commit == "a" * 32 else later).wait(5)
            return draw(commit, line, since)

        self.product.graph = graph
        self.addCleanup(later.set)
        self.addCleanup(first.set)
        self.hub.refresh(wait=True)
        self.hub.join(serve.Client("busy", None, None))
        until(lambda: len(started) == 1)
        self.hub.join(serve.Client("new-line", None, None))
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        self.product.head = "c" * 32
        self.hub.refresh(wait=True)
        first.set()
        until(lambda: len(started) == 2)
        self.assertEqual(started[1], ("c" * 32, "new-line"), "keep the pending line's place while coalescing heads")

    def test_hot_line_versions_do_not_evict_every_other_line(self):
        until(lambda: self.hub.view("quiet", None, None)[0] == 200)
        for n in range(serve.CACHED + 2):
            self.product.head = f"{n:032x}"
            self.hub.refresh(wait=True)
            until(lambda: self.hub.view("busy", None, None)[0] == 200
                  and self.hub.view("busy", None, None)[1]["scope"]["ledger_commit"] == self.product.head)
        code, view = self.hub.view("quiet", None, None)
        self.assertEqual(code, 200, "switching back still has that line's last completed graph")
        self.assertEqual(view["scope"]["ledger_commit"], "a" * 32)
        self.assertLessEqual(len(self.hub.views), serve.CACHED)

    def test_reading_or_drawing_a_pinned_old_snapshot_does_not_rewind_live_fallback(self):
        until(lambda: self.hub.view("line-a", None, None)[0] == 200)
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: self.hub.view("line-a", None, None)[1].get("scope", {}).get("ledger_commit") == "b" * 32)
        self.assertEqual(self.hub.view("line-a", None, "a" * 32)[0], 200)
        until(lambda: self.hub.view("line-a", None, "0" * 32)[0] == 200)
        self.product.release = threading.Event()
        self.addCleanup(self.product.release.set)
        self.product.head = "c" * 32
        self.hub.refresh(wait=True)
        self.assertEqual(self.hub.view("line-a", None, None)[1]["scope"]["ledger_commit"], "b" * 32)

    def test_a_failed_refresh_is_told_over_the_last_view(self):
        client = serve.Client(None, None, None)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.failure = {"code": "LEDGER_UNAVAILABLE", "message": "the service does not answer"}
        self.hub.refresh(wait=True)
        self.assertEqual((client.sent["state"], client.sent["ledger_commit"], client.sent["error"]["code"]),
                         ("error", "a" * 32, "LEDGER_UNAVAILABLE"))
        self.assertEqual(self.hub.view(None, None, None)[0], 200, "the last view is kept")
        self.product.failure = None
        self.hub.refresh(wait=True)
        self.assertEqual(client.sent, {"state": "ready", "ledger_commit": "a" * 32}, "a good refresh clears it")

    def test_an_open_page_follows_the_head_and_gets_only_the_latest_graph(self):
        client = serve.Client(None, None, None)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.product.release = threading.Event()
        self.product.head = "b" * 32
        self.hub.refresh(wait=True)
        until(lambda: self.hub.running is not None)
        self.product.head = "c" * 32  # two more commits while b is drawn
        self.hub.refresh(wait=True)
        self.product.head = "d" * 32
        self.hub.refresh(wait=True)
        self.product.release.set()
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "d" * 32})
        self.assertEqual(self.product.drawn, ["a" * 32, "b" * 32, "d" * 32], "c is skipped for the latest head")

    def test_a_page_at_a_commit_keeps_it(self):
        self.product.refs["line/x"] = "e" * 32
        _, at = self.hub.resolve(None, None, "line/x")
        client = serve.Client(None, None, at)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "e" * 32})
        self.product.head = "f" * 32
        self.hub.refresh(wait=True)
        self.assertEqual(client.sent["ledger_commit"], "e" * 32)
        with self.assertRaises(serve.ProductError):
            self.hub.resolve(None, "nowhere", None)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.hub = serve.Hub(FakeProduct(), "build", poll=0.05)
        threading.Thread(target=self.hub.work, daemon=True).start()
        with mock.patch.object(serve, "_page", return_value=b"<html>page</html>"):
            self.server = serve.Server(("127.0.0.1", 0), serve.handler(self.hub, frozenset({"here:1"})))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def get(self, path, **headers):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request("GET", path, headers={"Host": "here:1", **headers})
        return conn.getresponse()

    def test_only_the_page_itself_reads_graphs(self):
        self.assertEqual(self.get("/").read(), b"<html>page</html>")
        self.assertEqual(self.get("/api/view", Host="elsewhere:1").status, 403)
        self.assertEqual(self.get("/api/view", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        response = self.get("/api/view")
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertIn(response.status, (200, 202))
        self.assertEqual(self.get("/api/view?since=nowhere").status, 400)

    def test_the_line_index_includes_closed_lines_and_honors_the_snapshot(self):
        self.hub.product.refs["before"] = "b" * 32
        response = self.get("/api/lines?at=before")
        self.assertEqual(response.status, 200)
        body = json.loads(response.read())
        self.assertEqual(body["ledger_commit"], "b" * 32)
        self.assertEqual([item["closed"] for item in body["lines"]], [True, False])
        self.assertEqual(self.get("/api/lines?at=missing").status, 400)
        self.assertEqual(self.get("/api/lines", Host="elsewhere:1").status, 403)
        self.assertEqual(self.get("/api/lines", **{"Sec-Fetch-Site": "cross-site"}).status, 403)

    def test_the_events_start_with_the_current_state(self):
        response = self.get("/api/events")
        self.assertEqual(response.headers["Content-Type"], "text/event-stream")
        first = json.loads(response.fp.readline().decode().removeprefix("data: "))
        self.assertIn(first["state"], ("fetching", "queued", "computing", "ready"))

    def test_line_navigation_is_warmed_and_reuses_the_snapshot_index(self):
        with mock.patch.object(self.hub.line_index, "read", wraps=self.hub.product.lines) as read:
            self.hub.refresh(wait=True)
            self.assertEqual(read.call_count, 1, "the index is ready before a first graph can be shown")
            for _ in range(3):
                response = self.get("/api/lines")
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())["ledger_commit"], "a" * 32)
            self.assertEqual(read.call_count, 1)
            self.hub.product.head = "b" * 32
            self.hub.refresh(wait=True)
            self.assertEqual(read.call_count, 2)
            self.assertEqual(json.loads(self.get("/api/lines").read())["ledger_commit"], "b" * 32)
            self.assertEqual(read.call_count, 2)

    def test_an_index_failure_does_not_block_a_valid_graph(self):
        with mock.patch.object(self.hub.line_index, "read", side_effect=serve.ProductError(
                {"code": "LINE_CORRUPT", "message": "an unrelated line is unreadable"})):
            until(lambda: self.hub.view("valid-line", None, None)[0] == 200)
            response = self.get("/api/lines")
            self.assertEqual(response.status, 400)
            self.assertEqual(json.loads(response.read())["code"], "LINE_CORRUPT")

    def test_without_a_chat_service_there_is_no_agent(self):
        self.assertEqual(self.get("/api/agent/health").status, 404)


class AgentForwardTests(unittest.TestCase):
    """A stand-in chat service records what reaches it and streams its answer in two pieces."""

    def setUp(self):
        self.seen: list[dict] = []
        seen = self.seen
        release = self.release = threading.Event()

        class Agent(serve.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self):  # noqa: N802
                body = self.rfile.read(int(self.headers["Content-Length"]))
                seen.append({"path": self.path, "host": self.headers["Host"], "body": body})
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                for piece in (b"data: one\n\n", b"data: two\n\n"):
                    self.wfile.write(b"%x\r\n%s\r\n" % (len(piece), piece))
                    self.wfile.flush()
                    release.wait(5)
                self.wfile.write(b"0\r\n\r\n")

            def log_message(self, *args):
                pass
        self.agent = serve.Server(("127.0.0.1", 0), Agent)
        threading.Thread(target=self.agent.serve_forever, daemon=True).start()
        self.addCleanup(self.agent.server_close)
        self.addCleanup(self.agent.shutdown)
        hub = serve.Hub(FakeProduct(), "build")
        url = "http://%s:%d" % self.agent.server_address
        with mock.patch.object(serve, "_page", return_value=b"<html>page</html>"):
            self.server = serve.Server(("127.0.0.1", 0), serve.handler(hub, frozenset({"here:1"}), url))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, path, body, **headers):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request("POST", path, body=body, headers={"Host": "here:1", "Content-Type": "application/json", **headers})
        return conn.getresponse()

    def test_a_chat_request_reaches_the_service_and_its_answer_streams_back(self):
        response = self.post("/api/agent/chat", b'{"q": 1}')
        self.assertEqual(response.status, 200)
        self.assertEqual(response.fp.readline(), b"data: one\n", "the first piece arrives before the answer ends")
        self.release.set()
        self.assertEqual(response.read(), b"\ndata: two\n\n")
        self.assertEqual(self.seen, [{"path": "/api/agent/chat", "host": "%s:%d" % self.agent.server_address, "body": b'{"q": 1}'}])

    def test_another_site_cannot_reach_the_service(self):
        self.assertEqual(self.post("/api/agent/chat", b"{}", **{"Sec-Fetch-Site": "cross-site"}).status, 403)
        self.assertEqual(self.post("/api/agent/chat", b"{}", Host="elsewhere:1").status, 403)
        self.assertEqual(self.post("/api/view", b"{}").status, 404, "only agent paths take a body")
        self.assertEqual(self.seen, [])


class PaperForwardTests(unittest.TestCase):
    """A stand-in paper daemon records what reaches it."""

    def setUp(self):
        self.seen: list[dict] = []
        seen = self.seen

        class Paper(serve.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def answer(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                seen.append({"method": self.command, "path": self.path, "body": body,
                             "token": self.headers.get(serve.PAPER_TOKEN)})
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            do_GET = do_POST = answer  # noqa: N815

            def log_message(self, *args):
                pass
        self.paper = serve.Server(("127.0.0.1", 0), Paper)
        threading.Thread(target=self.paper.serve_forever, daemon=True).start()
        self.addCleanup(self.paper.server_close)
        self.addCleanup(self.paper.shutdown)
        url = "http://%s:%d" % self.paper.server_address
        with mock.patch.object(serve, "_page", return_value=b"<html><head></head>page</html>"):
            self.server = serve.Server(("127.0.0.1", 0), serve.handler(
                serve.Hub(FakeProduct(), "build"), frozenset({"here:1"}), None, url))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method, path, body=None, **headers):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(conn.close)
        conn.request(method, path, body=body, headers={"Host": "here:1", "Content-Type": "application/json", **headers})
        return conn.getresponse()

    def token(self) -> str:
        page = self.call("GET", "/").read().decode()
        return re.search(r'name="trade-paper-token" content="([^"]+)"', page)[1]

    def test_only_the_page_with_its_token_starts_a_run(self):
        token = self.token()
        refused = [self.call("POST", "/api/paper/runs", b"{}", **{"Sec-Fetch-Site": "same-origin"}),
                   self.call("POST", "/api/paper/runs", b"{}", **{"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: "x"}),
                   self.call("POST", "/api/paper/runs", b"{}", **{"Sec-Fetch-Site": "same-site", serve.PAPER_TOKEN: token})]
        self.assertEqual([response.status for response in refused], [403, 403, 403])
        self.assertEqual(self.seen, [])
        sent = self.call("POST", "/api/paper/runs", b'{"candidate": "a@1"}',
                         **{"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: token})
        self.assertEqual(sent.status, 200)
        self.assertEqual(self.call("GET", "/api/paper/runs").status, 200)
        self.assertEqual(self.seen, [{"method": "POST", "path": "/api/paper/runs", "body": b'{"candidate": "a@1"}', "token": None},
                                     {"method": "GET", "path": "/api/paper/runs", "body": b"", "token": None}])


if __name__ == "__main__":
    unittest.main()
