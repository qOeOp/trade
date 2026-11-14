"""Graceful control retirement retains accepted local work; no Docker or venue access."""

import fcntl
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

from tests.live.authority_fixture import install


CHILD = """
import json, os, sys, time
from pathlib import Path
work = Path(sys.argv[1])
(work / 'child-pid.part').write_text(str(os.getpid()))
(work / 'child-pid.part').rename(work / 'child-pid')  # the parent reads it once it exists
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
authority.STATE = work  # the release state, whose live-root the fixture installed
serve.serve(config, binding=release.Binding(authority.STATE, "trade-release-web-" + "a" * 40))
"""


class ControlShutdownTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ld-", dir="/tmp")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        fixture = install(self, self.work / "live-root")
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
