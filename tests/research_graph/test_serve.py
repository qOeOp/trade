"""If these fail, the served research graph no longer follows the ledger: a page asking for a graph gets
it once it is drawn, an open page is told when the head moves and gets the latest graph only, a
rewritten public copy stops the pulling instead of being reset, and another site cannot make the
browser fetch graphs. The product is a stand-in; no ledger or network is used."""

import copy
import http.client
import json
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/research-graph"))

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
            self.server = serve.ThreadingHTTPServer(("127.0.0.1", 0), serve.handler(self.hub, frozenset({"here:1"})))
        self.server.daemon_threads = True
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

    def test_the_events_start_with_the_current_state(self):
        response = self.get("/api/events")
        self.assertEqual(response.headers["Content-Type"], "text/event-stream")
        first = json.loads(response.fp.readline().decode().removeprefix("data: "))
        self.assertIn(first["state"], ("fetching", "queued", "computing", "ready"))


if __name__ == "__main__":
    unittest.main()
