"""Graceful control retirement retains accepted local work; no Docker or venue access."""

import fcntl
import hashlib
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

from live import state
from tests.live.authority_fixture import install


CHILD = """
import json, os, sys, time
from pathlib import Path
work = Path(sys.argv[1])
(work / 'child-pid').write_text(str(os.getpid()))
while not (work / 'release').exists():
    time.sleep(.01)
(work / 'child-finished').touch()
print(json.dumps({'ok': True, 'data': {}}))
"""

PARENT = """
import json, subprocess, sys, time
from pathlib import Path
from live import authority, release, serve
config, work, mode = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
original = serve.Server.serve_forever
def ready(self, *args, **kwargs):
    (work / 'ready').touch()
    return original(self, *args, **kwargs)
serve.Server.serve_forever = ready
if mode == 'handler':
    def command(*args, **kwargs):
        completed = subprocess.run([sys.executable, '-c', sys.argv[4], str(work)], capture_output=True, check=True)
        return 200, json.loads(completed.stdout)
    serve.command = command
else:
    def maintain(*args, **kwargs):
        (work / 'maintaining').touch()
        while not (work / 'release').exists():
            time.sleep(.01)
        (work / 'maintenance-finished').touch()
    serve.maintain_existing = maintain
authority.STATE = work / "i"
serve.serve(config, binding=release.Binding(authority.STATE, "trade-release-web-" + "a" * 40))
"""


class ControlShutdownTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ld-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        source = self.work / "source.py"
        source.write_text("class Example: pass\n")
        self.socket = self.work / "socket" / "control.sock"
        self.config = self.work / "configuration.json"
        self.config.write_bytes(state.encode({
            "format": "live-control-v1", "root": str(self.work / "custody"), "socket": str(self.socket),
            "research_ledger": str(self.work / "unused-reader.json"), "research_at": "a" * 32,
            "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64,
            "universe_file": str(self.work / "universe.json"), "symbols": ["BTCUSDT"], "memory": "2g",
            "defaults": {"budget_usdt": "90", "max_notional_per_order": "90", "max_loss_usdt": "2",
                         "duration_seconds": 8100},
            "sources": [{"source_id": "example", "candidate": "example@1", "strategy_file": str(source),
                         "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "entry_class": "Example",
                         "purpose": "controlled", "single_order_source_reviewed": True}]}))
        fixture = install(self, self.work / "custody", state.read(self.config), release_state=self.work / "i")
        self.config, self.socket = fixture.file, fixture.config.socket

    def wait_for(self, predicate):
        deadline = time.monotonic() + 10
        while not predicate():
            self.assertLess(time.monotonic(), deadline, "test control did not reach its synchronization point")
            time.sleep(.01)

    def start(self, mode):
        process = subprocess.Popen([sys.executable, "-c", PARENT, str(self.config), str(self.work), mode, CHILD],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def cleanup():
            (self.work / "release").touch()
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
            process.communicate(timeout=15)

        self.addCleanup(cleanup)
        self.wait_for(lambda: (self.work / "ready").exists() or process.poll() is not None)
        self.assertIsNone(process.poll())
        return process

    def test_signals_and_client_disconnect_preserve_accepted_child_and_lease_until_completion(self):
        process = self.start("handler")
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(client.close)
        client.connect(str(self.socket))
        payload = b'{"request_id":"fake-stop-request"}'
        client.sendall(b"POST /api/live/runs/example/stop HTTP/1.1\r\nHost: live-control\r\nContent-Length: "
                       + str(len(payload)).encode() + b"\r\n\r\n" + payload)
        self.wait_for(lambda: (self.work / "child-pid").exists())
        child = int((self.work / "child-pid").read_text())
        client.close()
        process.send_signal(signal.SIGTERM)

        def closed():
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                try:
                    probe.connect(str(self.socket))
                    return False
                except ConnectionRefusedError:
                    return True

        self.wait_for(closed)
        process.send_signal(signal.SIGTERM)  # A second signal while server_close waits is also harmless.
        self.assertIsNone(process.poll())
        os.kill(child, 0)
        self.assertFalse((self.work / "child-finished").exists())
        with (self.socket.parent / "listener.lock").open("r+") as lease:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (self.work / "release").touch()
        _, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, stderr.decode())
        self.assertTrue((self.work / "child-finished").exists())
        self.assertFalse(self.socket.exists())

    def test_shutdown_waits_for_the_existing_maintenance_call(self):
        process = self.start("maintenance")
        self.wait_for(lambda: (self.work / "maintaining").exists())
        process.send_signal(signal.SIGTERM)
        # The signal starts shutdown; the maintenance call still owns its completion.
        time.sleep(.1)
        self.assertIsNone(process.poll())
        self.assertFalse((self.work / "maintenance-finished").exists())
        (self.work / "release").touch()
        _, stderr = process.communicate(timeout=10)
        self.assertEqual(process.returncode, 0, stderr.decode())
        self.assertTrue((self.work / "maintenance-finished").exists())
        self.assertFalse(self.socket.exists())
