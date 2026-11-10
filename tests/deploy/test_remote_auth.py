"""Pinned OAuth2 Proxy acceptance with only loopback fake GitHub and upstream endpoints.

Set RESEARCH_OAUTH2_PROXY_BINARY to the binary extracted from the pinned image; this test uses no
real identity, credential, exchange, ledger or public network. Normal unit runs skip the native probe.
"""
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from urllib.parse import parse_qs, urlencode, urlsplit


ORG, TEAM = "trade-ops", "operators"
# Each token's GitHub identity: login, organizations and (organization, team slug) memberships.
PEOPLE = {
    "allowed": ("qOeOp", [ORG], [(ORG, "readers"), (ORG, TEAM)]),
    "outside-team": ("org-member", [ORG], [(ORG, "readers")]),
    "same-slug-elsewhere": ("other-org-member", ["other-org"], [("other-org", TEAM)]),
    "denied": ("somebody-else", [], []),
}


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        form = parse_qs(self.rfile.read(int(self.headers.get("Content-Length", "0"))).decode())
        self.reply({"access_token": form.get("code", ["denied"])[0], "token_type": "Bearer"})

    def do_GET(self):
        url = urlsplit(self.path)
        path, first = url.path, parse_qs(url.query).get("page", ["1"]) == ["1"]
        user, orgs, teams = PEOPLE.get((self.headers.get("Authorization") or "-").split()[-1], PEOPLE["denied"])
        if path.endswith("/user"):
            self.reply({"id": 1, "login": user, "email": f"{user}@example.test"})
        elif path.endswith("/user/emails"):
            self.reply([{"email": f"{user}@example.test", "primary": True, "verified": True}])
        elif path.endswith("/user/orgs"):
            self.reply([{"login": org} for org in orgs] if first else [])
        elif path.endswith("/user/teams"):
            self.reply([{"slug": slug, "organization": {"login": org}} for org, slug in teams] if first else [])
        elif path == "/api/events":
            self.server.hits.append(path)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b"event: ready\ndata: {}\n\n")
            self.wfile.flush()
            time.sleep(1)
        elif path.startswith("/api/") or path == "/":
            self.server.hits.append(path)
            self.reply({"upstream": True, "host": self.headers.get("Host")})
        else:
            self.reply([])


@unittest.skipUnless(os.environ.get("RESEARCH_OAUTH2_PROXY_BINARY"), "needs the pinned OAuth2 Proxy binary")
class RemoteAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.root.cleanup)
        root = Path(cls.root.name)
        (root / "client").write_text("isolated-dummy-client-secret")
        (root / "cookie").write_bytes(b"0123456789abcdef0123456789abcdef")
        cls.web = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        cls.web.daemon_threads = True
        cls.web.hits = []
        cls.addClassCleanup(cls.web.server_close)
        cls.addClassCleanup(cls.web.shutdown)
        threading.Thread(target=cls.web.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{cls.web.server_port}"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            cls.port = probe.getsockname()[1]
        cls.log = tempfile.TemporaryFile()
        cls.addClassCleanup(cls.log.close)
        config = Path(__file__).resolve().parents[2] / "deploy/remote/oauth2-proxy.cfg"
        cls.proxy = subprocess.Popen([
            os.environ["RESEARCH_OAUTH2_PROXY_BINARY"], f"--config={config}",
            f"--http-address=127.0.0.1:{cls.port}", f"--upstream={base}/",
            "--client-id=isolated-dummy-client", f"--client-secret-file={root / 'client'}",
            f"--cookie-secret-file={root / 'cookie'}", f"--login-url={base}/authorize",
            f"--redeem-url={base}/token", f"--validate-url={base}/", "--cookie-expire=3s",
            "--cookie-refresh=0s", "--redirect-url=https://www.vibe-trading.info/oauth2/callback",
        ], stdout=cls.log, stderr=cls.log,
            # The names deploy/remote/compose.yaml sets: one team of one organization, no username list.
            env={**os.environ, "OAUTH2_PROXY_GITHUB_ORG": ORG, "OAUTH2_PROXY_GITHUB_TEAM": TEAM})
        cls.addClassCleanup(cls.stop_proxy)
        for _ in range(100):
            try:
                if cls.get("/ping")[0] == 200:
                    return
            except OSError:
                pass
            if cls.proxy.poll() is not None:
                cls.log.seek(0)
                raise AssertionError(cls.log.read().decode())
            time.sleep(.05)
        raise AssertionError("isolated OAuth2 Proxy did not start")

    @classmethod
    def stop_proxy(cls):
        cls.proxy.terminate()
        try:
            cls.proxy.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proxy.kill()
            cls.proxy.wait(timeout=5)

    @classmethod
    def get(cls, path, cookie=""):
        conn = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=5)
        try:
            conn.request("GET", path, headers={"Host": "www.vibe-trading.info", "X-Forwarded-Proto": "https", "Cookie": cookie})
            response = conn.getresponse()
            return response.status, response.getheaders(), response.read()
        finally:
            conn.close()

    def login(self, code):
        status, headers, _ = self.get("/oauth2/start?rd=%2F")
        self.assertEqual(status, 302)
        location = next(v for k, v in headers if k.lower() == "location")
        state = parse_qs(urlsplit(location).query)["state"][0]
        csrf = SimpleCookie()
        for k, v in headers:
            if k.lower() == "set-cookie":
                csrf.load(v)
        cookie = "; ".join(f"{k}={v.value}" for k, v in csrf.items())
        status, headers, body = self.get("/oauth2/callback?" + urlencode({"code": code, "state": state}), cookie)
        session = SimpleCookie()
        for k, v in headers:
            if k.lower() == "set-cookie":
                session.load(v)
        return status, "; ".join(f"{k}={v.value}" for k, v in session.items()), body

    def test_unauthenticated_page_api_and_event_stream_never_reach_upstream(self):
        before = len(self.web.hits)
        self.assertEqual(self.get("/")[0], 302)
        for path in ("/api/view", "/api/paper/runs", "/api/events", "/api/agent/agents"):
            self.assertEqual(self.get(path)[0], 401, path)
        self.assertEqual(len(self.web.hits), before)

    def test_team_member_reaches_upstream_with_public_host(self):
        status, cookie, body = self.login("allowed")
        self.assertEqual(status, 302, body)
        status, _, body = self.get("/api/paper/runs", cookie)
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)["host"], "www.vibe-trading.info")

    def test_anyone_outside_the_team_cannot_reach_upstream(self):
        before = len(self.web.hits)
        for token in ("denied", "outside-team", "same-slug-elsewhere"):
            status, cookie, _ = self.login(token)
            # Pinned GitHub restriction failures abort session enrichment (HTTP 500),
            # rather than issuing a session. Verify the denied upstream, not a guessed status.
            self.assertEqual(status, 500, token)
            self.assertEqual(self.get("/api/paper/runs", cookie)[0], 401, token)
        self.assertEqual(len(self.web.hits), before)

    def test_expired_session_is_401(self):
        status, cookie, body = self.login("allowed")
        self.assertEqual(status, 302, body)
        time.sleep(4)
        self.assertEqual(self.get("/api/paper/runs", cookie)[0], 401)

    def test_sse_is_delivered_before_upstream_finishes(self):
        status, cookie, body = self.login("allowed")
        self.assertEqual(status, 302, body)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            started = time.monotonic()
            conn.request("GET", "/api/events", headers={"Host": "www.vibe-trading.info", "X-Forwarded-Proto": "https", "Cookie": cookie})
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.readline(), b"event: ready\n")
            self.assertLess(time.monotonic() - started, .8)
            response.read()
        finally:
            conn.close()
