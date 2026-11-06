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
                    "paper_heartbeat": self.server.heartbeat(),
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
        self.progress = 0
        self.stop = threading.Event()
        self.addCleanup(self.stop.set)
        self.worker = threading.Thread(target=self.heartbeat, daemon=True)
        self.worker.start()
        self.servers = []
        for version in ("blue", "green"):
            server = ThreadingHTTPServer(("127.0.0.1", 0), Backend)
            server.daemon_threads = True
            server.version, server.failed, server.stop = version, False, self.stop
            server.heartbeat = lambda: self.progress
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

    def heartbeat(self):
        while not self.stop.wait(0.02):
            self.progress += 1

    def close_caddy(self):
        self.stop.set()
        self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()

    def config(self, index):
        config = route_config(WEB + "a" * 40)
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

    def test_hot_switch_and_failed_candidate_rollback_keep_http_streams_and_execution_progress(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.public, timeout=3)
        self.addCleanup(connection.close)
        connection.request("GET", "/stream")
        stream = connection.getresponse()
        self.assertEqual(stream.readline().strip(), b"data: blue")
        before = self.progress
        self.reload(self.config(1))
        self.assertEqual(self.get("/")[1]["version"], "green")
        # The old SSE does not die when configuration is unloaded.
        stream.readline()
        self.assertEqual(stream.readline().strip(), b"data: blue")
        self.servers[1].failed = True
        self.assertEqual(self.get("/health")[0], 500)
        self.reload(self.config(0))
        self.assertEqual(self.get("/health")[1]["version"], "blue")
        self.assertGreater(self.progress, before)

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

        before = self.progress
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
        self.assertGreater(self.progress, before)

    def test_invalid_reload_keeps_the_last_loaded_working_configuration(self):
        config = self.config(1)
        config["apps"]["http"]["servers"]["ide"]["routes"][0]["handle"][0]["handler"] = "not_a_module"
        self.assertNotEqual(self.reload(config, check=False).returncode, 0)
        self.assertEqual(self.get("/")[1]["version"], "blue")


if __name__ == "__main__":
    unittest.main()
