"""Exercise the exact native Caddy hot-reload boundary with isolated HTTP stand-ins.

No live exchange, account, ledger, login, token or engine is used. The independent heartbeat represents
the execution plane; real Paper continuity is checked separately by container identity on deployment.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

from deploy.release_host import WEB, route_config


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Backend(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(500 if self.path == "/health" and self.server.failed else 200)
        if self.path == "/stream":
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                while not self.server.stop.wait(0.05):
                    self.wfile.write(f"data: {self.server.version}\n\n".encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            data = json.dumps(
                {
                    "version": self.server.version,
                    "host": self.headers.get("Host"),
                }
            ).encode()
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    do_POST = do_GET


@unittest.skipUnless(os.environ.get("RESEARCH_CADDY_BINARY"), "needs the pinned native Caddy binary")
class ReleaseProxyTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.stop = threading.Event()
        self.addCleanup(self.stop.set)
        self.servers = []
        for version in ("blue", "green"):
            server = ThreadingHTTPServer(("127.0.0.1", 0), Backend)
            server.daemon_threads = True
            server.version, server.failed, server.stop = version, False, self.stop
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.servers.append(server)
        self.public, self.admin = port(), port()
        self.path = Path(self.root.name) / "caddy.json"
        self.path.write_text(json.dumps(self.config(0)))
        self.log = tempfile.TemporaryFile()
        self.addCleanup(self.log.close)
        self.process = subprocess.Popen(
            [os.environ["RESEARCH_CADDY_BINARY"], "run", "--config", str(self.path)], stdout=self.log, stderr=self.log
        )
        self.addCleanup(self.close_caddy)
        for _ in range(100):
            try:
                if self.get("/")[0] == 200:
                    return
            except OSError:
                pass
            if self.process.poll() is not None:
                self.log.seek(0)
                self.fail(self.log.read().decode())
            time.sleep(0.03)
        self.fail("Caddy readiness timed out")

    def close_caddy(self):
        self.stop.set()
        self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()

    def config(self, index):
        config = route_config(WEB + "a" * 40, None)
        config["admin"]["listen"] = f"127.0.0.1:{self.admin}"
        server = config["apps"]["http"]["servers"]["ide"]
        server["listen"] = [f"127.0.0.1:{self.public}"]
        handler = server["routes"][0]["handle"][0]
        handler["upstreams"][0]["dial"] = f"127.0.0.1:{self.servers[index].server_port}"
        handler["stream_close_delay"] = 2_000_000_000
        return config

    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.public, timeout=3)
        try:
            conn.request("GET", path)
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def reload(self, config, check=True):
        self.path.write_text(json.dumps(config))
        return subprocess.run(
            [
                os.environ["RESEARCH_CADDY_BINARY"],
                "reload",
                "--address",
                f"127.0.0.1:{self.admin}",
                "--config",
                str(self.path),
            ],
            capture_output=True,
            check=check,
            timeout=10,
        )

    def test_hot_switch_and_failed_candidate_rollback_keep_http_streams(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.public, timeout=3)
        self.addCleanup(connection.close)
        connection.request("GET", "/stream")
        stream = connection.getresponse()
        self.assertEqual(stream.readline().strip(), b"data: blue")
        self.reload(self.config(1))
        self.assertEqual(self.get("/")[1]["version"], "green")
        # The old SSE does not die when configuration is unloaded.
        stream.readline()
        self.assertEqual(stream.readline().strip(), b"data: blue")
        self.servers[1].failed = True
        self.assertEqual(self.get("/health")[0], 500)
        self.reload(self.config(0))
        self.assertEqual(self.get("/health")[1]["version"], "blue")

    def test_paper_handoff_pauses_mutations_then_only_starts_until_commit(self):
        from deploy.paper_host import PAPER, route_config as paper_config

        def config(index, freeze=None):
            value = paper_config(PAPER + "a" * 40, freeze)
            value["admin"]["listen"] = f"127.0.0.1:{self.admin}"
            server = value["apps"]["http"]["servers"]["paper"]
            server["listen"] = [f"127.0.0.1:{self.public}"]
            server["routes"][-1]["handle"][0]["upstreams"][0]["dial"] = f"127.0.0.1:{self.servers[index].server_port}"
            return value

        def post(path):
            conn = http.client.HTTPConnection("127.0.0.1", self.public, timeout=3)
            try:
                conn.request("POST", path, body=b"{}")
                response = conn.getresponse()
                return response.status, json.loads(response.read())
            finally:
                conn.close()

        self.reload(config(0, "all"))
        self.assertEqual(self.get("/")[1]["host"], "paper:8767")
        self.assertEqual(self.get("/")[0], 200)
        self.assertEqual(post("/api/paper/runs/3/stop")[0], 503)
        self.reload(config(1, "starts"))
        self.assertEqual(self.get("/")[1]["version"], "green")
        self.assertEqual(post("/api/paper/runs")[0], 503)
        self.assertEqual(post("/api/paper/runs/3/stop")[0], 200)
        self.reload(config(1))
        self.assertEqual(post("/api/paper/runs")[1]["version"], "green")

    def test_invalid_reload_keeps_the_last_loaded_working_configuration(self):
        config = self.config(1)
        config["apps"]["http"]["servers"]["ide"]["routes"][0]["handle"][0]["handler"] = "not_a_module"
        self.assertNotEqual(self.reload(config, check=False).returncode, 0)
        self.assertEqual(self.get("/")[1]["version"], "blue")


@unittest.skipUnless(os.environ.get("RESEARCH_CADDY_BINARY"), "needs the pinned native Caddy binary")
class EdgeRedirectTests(unittest.TestCase):
    """The deployed Caddyfile itself, on local ports and a local CA instead of ACME."""

    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.https = port()
        config = Path(root.name) / "Caddyfile"
        config.write_text(
            f"{{\n admin off\n local_certs\n skip_install_trust\n http_port {port()}\n https_port {self.https}\n}}\n"
            + Path("deploy/remote/Caddyfile").read_text()
        )
        self.log = (Path(root.name) / "caddy.log").open("w")
        self.addCleanup(self.log.close)
        process = subprocess.Popen(
            [os.environ["RESEARCH_CADDY_BINARY"], "run", "--config", str(config), "--adapter", "caddyfile"],
            env={**os.environ, "TRADE_DOMAIN": "www.vibe-trading.info", "TRADE_DOMAIN_ALIASES": "vibe-trading.info",
                 "HOME": root.name, "XDG_DATA_HOME": root.name, "XDG_CONFIG_HOME": root.name},
            stdout=self.log, stderr=self.log,
        )
        self.addCleanup(process.wait)
        self.addCleanup(process.terminate)

    def get(self, host, target):
        context = ssl.create_default_context()
        context.check_hostname, context.verify_mode = False, ssl.CERT_NONE
        deadline = time.monotonic() + 30
        while True:
            try:
                with socket.create_connection(("127.0.0.1", self.https), timeout=5) as raw:
                    with context.wrap_socket(raw, server_hostname=host) as sock:
                        sock.sendall(f"GET {target} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
                        response = http.client.HTTPResponse(sock)
                        response.begin()
                        self.headers = response.headers
                        return response.status, response.getheader("Location")
            except (OSError, http.client.HTTPException):
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.2)

    def test_an_alias_redirects_to_the_domain_and_the_domain_is_not_redirected(self):
        self.assertEqual(
            self.get("vibe-trading.info", "/a/b?c=1"), (301, "https://www.vibe-trading.info/a/b?c=1")
        )
        self.assertEqual(self.get("www.vibe-trading.info", "/"), (502, None))  # proxied; no oauth2 here

    def test_every_answer_carries_hsts_and_a_policy_that_forbids_framing(self):
        for host in ("www.vibe-trading.info", "vibe-trading.info"):
            with self.subTest(host=host):
                self.get(host, "/")
                self.assertEqual(self.headers["Strict-Transport-Security"], "max-age=31536000")
                self.assertIn("frame-ancestors 'none'", self.headers["Content-Security-Policy"])
                self.assertEqual(self.headers["X-Content-Type-Options"], "nosniff")
