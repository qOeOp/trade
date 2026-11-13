"""Release role and old-run compatibility checks never write a ledger or touch native accounts."""

from contextlib import contextmanager
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from deploy.paper_host import PAPER, route_config
from engine.config import RUNTIME_CONTRACT
from ledger import db, paper as records
from paper import release, serve
from tests.paper.test_serve import request, server
from tests.ledger.dolt import BINARY, SKIP, Service


class ReleaseRoleTests(unittest.TestCase):
    def test_standby_rejects_writes_and_does_not_run_lifecycle_maintenance(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "active.json"
            name = PAPER + "a" * 40
            path.write_text(json.dumps(route_config(PAPER + "b" * 40)))
            daemon = serve.Daemon.__new__(serve.Daemon)
            daemon.release_route, daemon.release_name = path, name
            daemon.profile = SimpleNamespace(database="paper")
            daemon.start = Mock(return_value={"paper_id": 9})
            daemon.runs = Mock()
            http, port = server(daemon)
            self.addCleanup(http.server_close)
            self.addCleanup(http.shutdown)
            self.assertEqual(
                request(
                    port, "POST", "/api/paper/runs", b'{"candidate":"x@1"}', **{"Content-Type": "application/json"}
                )[0],
                503,
            )
            daemon.start.assert_not_called()
            daemon.seal_found()
            daemon.runs.assert_not_called()
            path.write_text(json.dumps(route_config(name, "starts")))
            self.assertTrue(daemon.active())
            self.assertEqual(
                request(
                    port, "POST", "/api/paper/runs", b'{"candidate":"x@1"}', **{"Content-Type": "application/json"}
                )[0],
                200,
            )
            path.write_text("corrupt")
            self.assertFalse(daemon.active())

    def test_compatibility_keeps_old_image_and_rejects_unsupported_native_checkpoint(self):
        with tempfile.TemporaryDirectory() as root:
            profile = SimpleNamespace(service_root=Path(root), database="isolated")
            old = {"paper_id": 3, "seal": None, "image_ref": "old@sha256:" + "a" * 64}

            @contextmanager
            def conn(*_):
                yield Mock()

            identity = {"image_ref": "new@sha256:" + "b" * 64, "runtime_contract": RUNTIME_CONTRACT}
            with (
                patch.object(db, "connect", conn),
                patch.object(records, "paper_runs", return_value=[old]),
                patch.object(release.image, "resolve", return_value=identity) as resolve,
            ):
                result = release.compatible(profile, identity["image_ref"])
                self.assertEqual(result["runs"], [3])
                resolve.assert_any_call(old["image_ref"])
                directory = release.runs.run_dir(profile, 3)
                (directory / "out/recovery").mkdir(parents=True)
                (directory / "inputs").mkdir()
                (directory / "inputs/universe.json").write_text("{}")
                (directory / "out/recovery/current.json").write_text('{"format":"unknown","identity":"original"}')
                with (
                    patch.object(release.recovery, "identity", return_value="original"),
                    self.assertRaisesRegex(RuntimeError, "checkpoint format"),
                ):
                    release.compatible(profile, identity["image_ref"])
                self.assertEqual(old["image_ref"], "old@sha256:" + "a" * 64)

    def test_empty_or_partial_first_journal_line_is_not_an_incompatible_format(self):
        with tempfile.TemporaryDirectory() as root:
            profile = SimpleNamespace(service_root=Path(root), database="isolated")
            row = {"paper_id": 3, "seal": None, "image_ref": "original"}
            output = release.runs.run_dir(profile, 3) / "out"
            output.mkdir(parents=True)

            @contextmanager
            def conn(*_):
                yield Mock()

            identity = {"image_ref": "new", "runtime_contract": RUNTIME_CONTRACT}
            with (
                patch.object(db, "connect", conn),
                patch.object(records, "paper_runs", return_value=[row]),
                patch.object(release.image, "resolve", return_value=identity),
            ):
                for data in (b"", b'{"kind":'):
                    (output / "events.jsonl").write_bytes(data)
                    self.assertEqual(release.compatible(profile, "new")["runs"], [3])
                (output / "events.jsonl").write_bytes(b"invalid complete line\n")
                with self.assertRaisesRegex(RuntimeError, "native journal"):
                    release.compatible(profile, "new")

    def test_barrier_heartbeats_detect_a_lost_database_lock(self):
        import io

        @contextmanager
        def held(_):
            yield SimpleNamespace(rows=Mock(return_value=[(0,)]))

        with (
            patch.object(release.recovery, "operation", held),
            patch("sys.stdin", io.StringIO("held\n")),
            patch.object(release.select, "select", return_value=([1], [], [])),
            patch("sys.stdout", io.StringIO()),
            self.assertRaisesRegex(RuntimeError, "lock was lost"),
        ):
            release.barrier(SimpleNamespace(database="isolated"))


@unittest.skipUnless(BINARY, SKIP)
class LifecycleHandoffTests(unittest.TestCase):
    def test_real_database_lock_waits_for_accepted_work_and_eof_releases_the_barrier(self):
        import select
        import subprocess
        import sys
        import threading
        from paper import recovery

        service = Service()
        self.addCleanup(service.close)
        profile = service.ledger("release")
        entered, finish, completed = threading.Event(), threading.Event(), threading.Event()

        def old_start():
            with recovery.operation(profile):
                entered.set()
                finish.wait(10)
            completed.set()

        worker = threading.Thread(target=old_start)
        worker.start()
        self.addCleanup(worker.join, 12)
        self.addCleanup(finish.set)
        self.assertTrue(entered.wait(5))
        proc = subprocess.Popen(
            [sys.executable, "-m", "paper.release", "barrier", "--ledger=release"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        def close():
            if proc.poll() is None:
                proc.stdin.close()
                proc.stdin = None
            try:
                proc.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.communicate()

        self.addCleanup(close)
        self.assertFalse(
            select.select([proc.stdout], [], [], 0.2)[0], "barrier skipped an in-flight lifecycle operation"
        )
        finish.set()
        self.assertTrue(select.select([proc.stdout], [], [], 10)[0])
        self.assertEqual(proc.stdout.readline().strip(), "locked")
        self.assertTrue(completed.wait(3))
        proc.stdin.write("held\n")
        proc.stdin.flush()
        self.assertTrue(select.select([proc.stdout], [], [], 3)[0])
        self.assertEqual(proc.stdout.readline().strip(), "held")
        proc.stdin.close()
        proc.stdin = None
        _, err = proc.communicate(timeout=10)
        self.assertEqual(proc.returncode, 0, err)
        with recovery.operation(profile):
            pass  # actual lock can be acquired again after stdin EOF
