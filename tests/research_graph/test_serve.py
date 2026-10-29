"""If these fail, the served research graph no longer follows the ledger: a page asking for a graph gets
it once it is drawn, an open page is told when the head moves and gets the latest graph only, a
rewritten public copy stops the pulling instead of being reset, another site cannot make the
browser fetch graphs, and only the page itself, with its token, can start a paper run. The product is a stand-in; no ledger or network is used."""

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
sys.path.insert(0, str(ROOT / "services/ide"))

from research_graph import serve  # noqa: E402
from tests.research_graph.test_research_graph import GRAPH  # noqa: E402


class FakeProduct:
    """`commit` answers the head (or a ref named in `refs`); `graph` waits for `release` when it is set."""

    ledger = "copy"

    def __init__(self):
        self.head = "a" * 32
        self.refs: dict[str, str] = {}
        self.drawn: list[str] = []
        self.release: threading.Event | None = None

    def commit(self, ref=None):
        if ref is None:
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

    def test_the_first_graph_waits_for_the_market_copy_to_sync(self):
        self.hub.pull = "/pull"
        calls = []

        def run(argv, **options):
            calls.append(argv[1])
            return mock.Mock(returncode=1 if argv[1] == "market" else 0,
                             stdout="", stderr="market unavailable" if argv[1] == "market" else "")

        with mock.patch.object(serve.subprocess, "run", side_effect=run):
            code, body = self.hub.view(None, None, None)
        self.assertEqual((code, body.get("code")), (503, "PULL_FAILED"))
        self.assertEqual(calls, ["ledger", "market"])
        self.assertEqual(self.product.drawn, [], "no graph is drawn from an unsynchronized first market copy")
        with mock.patch.object(serve.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="", stderr="")):
            self.hub.refresh(wait=True)
        until(lambda: self.hub.view(None, None, None)[0] == 200)
        self.assertEqual(self.product.drawn, ["a" * 32], "a successful retry allows the first graph")

    def test_a_slow_pull_does_not_hold_a_page(self):
        until(lambda: self.hub.view(None, None, None)[0] == 200)
        pulling, release = threading.Event(), threading.Event()

        def run(argv, **options):
            pulling.set()
            release.wait(5)
            return mock.Mock(returncode=0, stdout="", stderr="")
        self.hub.pull = "/pull"
        self.product.head = "b" * 32
        with mock.patch.object(serve.subprocess, "run", side_effect=run):
            threading.Thread(target=self.hub.refresh, daemon=True).start()
            pulling.wait(5)
            time.sleep(0.1)  # the head was read longer than `poll` ago
            started = time.monotonic()
            status, view = self.hub.view(None, None, None)
            self.assertLess(time.monotonic() - started, 1, "the page does not wait for the pull")
            self.assertEqual((status, view["scope"]["ledger_commit"]), (200, "a" * 32), "it gets the last view")
            release.set()
            until(lambda: self.hub.view(None, None, None)[1].get("scope", {}).get("ledger_commit") == "b" * 32)

    def test_an_open_page_hears_the_new_head_while_the_market_is_pulled(self):
        client = serve.Client(None, None, None)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        release = threading.Event()

        def run(argv, **options):
            if argv[1] == "market":
                release.wait(5)
            return mock.Mock(returncode=0, stdout="", stderr="")
        self.hub.pull = "/pull"
        self.product.head = "b" * 32
        with mock.patch.object(serve.subprocess, "run", side_effect=run):
            threading.Thread(target=self.hub.refresh, daemon=True).start()
            until(lambda: client.sent == {"state": "pulling", "ledger_commit": "b" * 32})
            self.assertEqual(self.hub.view(None, None, None)[1]["scope"]["ledger_commit"], "a" * 32,
                             "the last view is still served")
            release.set()
            until(lambda: client.sent == {"state": "ready", "ledger_commit": "b" * 32})

    def test_a_failed_refresh_is_told_over_the_last_view(self):
        client = serve.Client(None, None, None)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        until(lambda: client.sent == {"state": "ready", "ledger_commit": "a" * 32})
        self.hub.pull = "/pull"
        failing = mock.Mock(returncode=1, stdout="", stderr="network down")
        with mock.patch.object(serve.subprocess, "run", return_value=failing):
            self.hub.refresh(wait=True)
        self.assertEqual((client.sent["state"], client.sent["ledger_commit"], client.sent["error"]["code"]),
                         ("error", "a" * 32, "PULL_FAILED"))
        self.assertEqual(self.hub.view(None, None, None)[0], 200, "the last view is kept")
        with mock.patch.object(serve.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="", stderr="")):
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

    def test_a_rewritten_public_copy_stops_pulling(self):
        calls = []

        def run(argv, **options):
            calls.append(argv[1])
            return mock.Mock(returncode=serve.REWRITTEN, stdout="", stderr="non-fast-forward")
        client = serve.Client(None, None, None)
        self.hub.refresh(wait=True)
        self.hub.join(client)
        until(lambda: client.sent["state"] == "ready")
        self.hub.pull = "/pull"
        with mock.patch.object(serve.subprocess, "run", side_effect=run):
            self.hub.refresh(wait=True)
            self.hub.refresh(wait=True)
        self.assertEqual(calls, ["ledger"], "nothing is pulled after a rewritten history")
        self.assertEqual(client.sent["error"]["code"], "REMOTE_REWRITTEN", "even with the last view drawn")
        self.assertEqual(self.hub.view(None, None, None), (503, self.hub.rewritten))


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
