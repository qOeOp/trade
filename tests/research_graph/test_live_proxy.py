"""Live traffic cannot bypass the login router using a copied browser nonce."""

import http.client
import json
from pathlib import Path
import re
import socket
import socketserver
import tempfile
import threading
import unittest
from unittest.mock import patch

from tests.research_graph.test_serve import FakeProduct, POLL, serve
from research_graph import live_proxy


class LiveProxyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="live-proxy-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / "control.sock"
        self.seen = []
        seen = self.seen

        class Control(serve.BaseHTTPRequestHandler):
            def answer(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                seen.append((self.command, self.path, body, dict(self.headers)))
                payload = b'{"ok":true,"data":{"accepted":true}}'
                self.send_response(202 if self.command == "POST" else 200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            do_GET = do_POST = answer

            def log_message(self, *args):
                pass

        control = socketserver.ThreadingUnixStreamServer(str(path), Control)
        threading.Thread(target=control.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(control.server_close)
        self.addCleanup(control.shutdown)
        with patch.object(serve, "_page", return_value=b"<html><head></head></html>"):
            self.server = serve.Server(("127.0.0.1", 0), serve.handler(
                serve.Hub(FakeProduct(), "build"), frozenset({"here:1"}),
                live_socket=path, live_router="ide-router"))
        threading.Thread(target=self.server.serve_forever, args=(POLL,), daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.router_address = "127.0.0.1"
        lookup = patch.object(live_proxy.socket, "getaddrinfo", side_effect=self.resolve)
        lookup.start()
        self.addCleanup(lookup.stop)

    def resolve(self, host, port, *args, **kwargs):
        # Do not replace the HTTP client's ordinary localhost resolution.
        if host == "ide-router":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (self.router_address, 0))]
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (host, port))]

    def call(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        self.addCleanup(connection.close)
        connection.request(method, path, body=body, headers={"Host": "here:1", **(headers or {})})
        return connection.getresponse()

    def token(self):
        page = self.call("GET", "/").read().decode()
        return re.search(r'name="trade-paper-token" content="([^"]+)"', page)[1]

    def test_router_and_page_can_forward_once_without_forwarding_browser_credentials(self):
        body = b'{"request_id":"one","confirm_real_orders":"example"}'
        result = self.call("POST", "/api/live/runs/example/start", body, {
            "Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: self.token(),
            "Cookie": "not-a-real-cookie", "Authorization": "fake-browser-auth"})
        self.assertEqual(result.status, 202)
        self.assertEqual(result.getheader("Cache-Control"), "no-store")
        self.assertTrue(json.loads(result.read())["ok"])
        self.assertEqual(len(self.seen), 1)
        _, _, received, headers = self.seen[0]
        self.assertEqual(received, body)
        for forbidden in ("Cookie", "Authorization", serve.PAPER_TOKEN, "Sec-Fetch-Site"):
            self.assertNotIn(forbidden, headers)

    def test_backend_peer_with_real_nonce_and_forged_headers_is_refused_for_reads_and_writes(self):
        token = self.token()
        self.router_address = "192.0.2.55"
        for method in ("GET", "POST"):
            result = self.call(method, "/api/live", b"{}" if method == "POST" else None, {
                "Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: token,
                "X-Forwarded-For": self.router_address, "X-Forwarded-User": "operator"})
            self.assertEqual(result.status, 403)
            self.assertIsNone(result.getheader(serve.PAPER_TOKEN))
            self.assertEqual(json.loads(result.read())["error"]["code"], "LIVE_ACCESS")
        self.assertEqual(self.seen, [])

    def test_nonce_renewal_is_only_before_forwarding_for_trusted_router(self):
        result = self.call("POST", "/api/live/credentials", b"{}", {
            "Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: "old-nonce"})
        self.assertEqual(result.status, 403)
        self.assertEqual(result.getheader(serve.PAPER_TOKEN), self.token())
        result.read()
        self.assertEqual(self.seen, [])

    def test_dns_failure_and_changed_address_do_not_reuse_old_authority(self):
        self.assertTrue(live_proxy.router_peer("127.0.0.1", "ide-router"))
        self.router_address = "192.0.2.60"
        self.assertFalse(live_proxy.router_peer("127.0.0.1", "ide-router"))
        with patch.object(live_proxy.socket, "getaddrinfo", side_effect=OSError("private diagnostic")):
            self.assertFalse(live_proxy.router_peer("127.0.0.1", "ide-router"))

    def test_unknown_response_does_not_replay_or_expose_internal_exception(self):
        with patch.object(live_proxy.UnixConnection, "getresponse", side_effect=OSError("secret-sentinel")):
            result = self.call("POST", "/api/live/runs/example/start", b"{}", {
                "Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: self.token()})
            self.assertEqual(result.status, 502)
            body = result.read().decode()
        self.assertNotIn("secret-sentinel", body)
        self.assertIn("LIVE_RESPONSE_UNKNOWN", body)
        self.assertLessEqual(len(self.seen), 1)

    def test_invalid_or_excessive_body_length_never_reaches_control(self):
        token = self.token()
        for length in ("-1", str(live_proxy.MAX_BODY + 1)):
            result = self.call("POST", "/api/live/credentials", b"", {
                "Content-Length": length, "Sec-Fetch-Site": "same-origin", serve.PAPER_TOKEN: token})
            self.assertIn(result.status, (400, 413))
            result.read()
        self.assertEqual(self.seen, [])
