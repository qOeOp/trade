"""The DoltHub button can sync only the configured replica through the existing page/CSRF boundary."""
import http.client
from contextlib import closing
import json
import re
import threading
import unittest
from unittest import mock

from tests.research_graph.test_serve import FakeProduct, POLL, serve
from cli import replica


class ResearchSyncTests(unittest.TestCase):
    def setUp(self):
        self.sync = mock.Mock()
        self.sync.status.return_value = {"state": "idle", "ledger_commit": "a" * 32}
        self.sync.request.return_value = {"state": "syncing"}
        self.upstream = serve.Server(("127.0.0.1", 0), replica.handler(self.sync, frozenset()))
        host = "127.0.0.1:%d" % self.upstream.server_port
        self.upstream.RequestHandlerClass = replica.handler(self.sync, frozenset({host}))
        threading.Thread(target=self.upstream.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.upstream.server_close)
        self.addCleanup(self.upstream.shutdown)
        with mock.patch.object(serve, "_page", return_value=b"<html><head></head></html>"):
            self.http = serve.Server(("127.0.0.1", 0), serve.handler(
                serve.Hub(FakeProduct(), "build"), frozenset({"ide.test"}), research=f"http://{host}"))
        threading.Thread(target=self.http.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.http.server_close)
        self.addCleanup(self.http.shutdown)

    def call(self, method, path, body=None, **headers):
        with closing(http.client.HTTPConnection(*self.http.server_address, timeout=5)) as connection:
            connection.request(method, path, body, headers={"Host": "ide.test", **headers})
            response = connection.getresponse()
            return response.status, response.read()

    def test_the_mirror_syncs_on_its_own_until_stopped(self):
        stop, calls = threading.Event(), []
        sync = mock.Mock()
        sync.request.side_effect = lambda: calls.append(1) or (stop.set() if len(calls) == 3 else None)
        worker = threading.Thread(target=replica.keep_synced, args=(sync, stop, 0.01), daemon=True)
        worker.start()
        worker.join(5)
        self.assertFalse(worker.is_alive(), "the loop ends once stopped")
        self.assertEqual(len(calls), 3, "a sync at start and one per interval, none after stop")

    def test_a_mirror_head_comes_from_the_controller_and_a_page_follows_it_with_no_product_read(self):
        address = "http://127.0.0.1:%d" % self.upstream.server_port
        product = FakeProduct()
        hub = serve.Hub(product, "build", mirror=serve.mirror_head(address))
        hub.refresh(wait=True)
        self.assertEqual(hub.head, "a" * 32)
        self.sync.status.return_value = {"state": "ready", "ledger_commit": "b" * 32}
        hub.refresh(wait=True)
        self.assertEqual(hub.head, "b" * 32)
        self.assertFalse(product.reading.is_set(), "no product process per read")

    def test_without_a_head_from_the_controller_the_product_answers(self):
        address = "http://127.0.0.1:%d" % self.upstream.server_port
        self.sync.status.side_effect = replica.refuse("REPLICA_REQUIRED", "the mirror is not intact")
        product = FakeProduct()
        hub = serve.Hub(product, "build", mirror=serve.mirror_head(address))
        hub.refresh(wait=True)
        self.assertEqual(hub.head, product.head)
        self.assertTrue(product.reading.is_set())
        product.failure = {"code": "LEDGER_UNAVAILABLE", "message": "down"}
        hub.refresh(wait=True)
        self.assertEqual(hub.fault, product.failure, "the product's refusal reaches the page")

    def test_sync_requires_the_page_token_and_does_not_accept_a_target(self):
        page = self.call("GET", "/")[1].decode()
        self.assertIn('name="trade-research-sync"', page)
        token = re.search(r'name="trade-paper-token" content="([^"]+)"', page)[1]
        path = "/api/research/sync"
        self.assertEqual(self.call("GET", path)[0], 200)
        for site, value in [("same-origin", "wrong"), ("same-site", token), ("cross-site", token)]:
            self.assertEqual(self.call("POST", path, **{"Sec-Fetch-Site": site, serve.PAPER_TOKEN: value})[0], 403)
        self.sync.request.assert_not_called()
        headers = {"Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: token}
        self.assertEqual(self.call("POST", path, b'{"origin":"file:///other"}', **headers)[0], 413)
        self.assertEqual(self.call("POST", path + "?origin=other", **headers)[0], 404)
        status, body = self.call("POST", path, **headers)
        self.assertEqual((status, json.loads(body)), (202, {"state": "syncing"}))
        self.sync.request.assert_called_once_with()
