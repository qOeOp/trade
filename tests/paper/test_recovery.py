"""Same-run recovery refuses changed originals and never creates a replacement account."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock

from engine import paper_checkpoint as checkpoint
from ledger import db, paper as records
from shared.errors import Refusal
from paper import recovery, runs
from tests.ledger.dolt import BINARY, SKIP, Service


class ResumePolicyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for child in ("inputs", "out"):
            (self.root / child).mkdir()
        source = b"# original strategy\n"
        self.row = {"paper_id": 8, "op_id": "start:8", "source_sha256": hashlib.sha256(source).hexdigest(),
                    "image_ref": "ghcr.io/example/runtime@sha256:" + "b" * 64,
                    "symbols": ["BTCUSDT"], "market_day": "c" * 32, "config": {"execution": "paper-bars"}}
        (self.root / "inputs/strategy.py").write_bytes(source)
        (self.root / "inputs/universe.json").write_bytes(b'{"membership":{}}')
        (self.root / "out/events.jsonl").write_bytes(b'{}\n')
        rdb = self.root / "cache.rdb"
        rdb.write_bytes(b"isolated policy fixture; native decoding is verified by the runtime")
        checkpoint.dirty(self.root / "out")
        checkpoint.publish(self.root / "out", recovery.identity(self.row, b'{"membership":{}}'), rdb)
        self.profile = SimpleNamespace(service_root=self.root, database="test")
        @contextmanager
        def connection(*args, **kwargs):
            yield mock.Mock()
        patches = [mock.patch.object(db, "connect", connection),
                   mock.patch.object(records, "read_paper_run", return_value=self.row),
                   mock.patch.object(records, "seal_of", return_value=None),
                   mock.patch.object(records, "paper_runs", return_value=[self.row]),
                   mock.patch.object(runs, "run_dir", return_value=self.root),
                   mock.patch.object(runs, "_running", return_value=False),
                   mock.patch.object(runs, "containers", return_value=[]),
                   mock.patch.object(runs, "limits", return_value=768),
                   mock.patch.object(runs, "_host_available", return_value=None),
                   mock.patch.object(runs, "_docker", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(
                       {"Image": self.row["image_ref"]}).encode())), mock.patch.object(runs, "_checked")]
        self.started = []
        for patch in patches:
            self.started.append(patch.start())
            self.addCleanup(patch.stop)
        self.docker = self.started[-1]

    def resume(self):
        # Policy tests isolate the lifecycle body. A separate real-Dolt test verifies the decorator lock.
        return recovery.resume.__wrapped__(self.profile, 8)

    def refused(self):
        with self.assertRaises(Refusal) as caught:
            self.resume()
        self.assertEqual(caught.exception.code, "PAPER_RECOVERY_UNAVAILABLE")
        self.docker.assert_not_called()

    def test_valid_resume_starts_original_container_and_keeps_same_id(self):
        found = self.resume()
        self.assertEqual(found, {"paper_id": 8, "state": "resuming", "write_status": "written"})
        self.assertEqual([call.args for call in self.docker.call_args_list],
                         [("start", runs.names(self.profile, 8)["egress"]),
                          ("start", runs.names(self.profile, 8)["runner"])])
        self.assertEqual([item["action"] for item in recovery.launches(self.root / "out/launches.jsonl")], ["resume"])

    def test_already_running_is_idempotent(self):
        self.started[5].return_value = True
        self.assertEqual(self.resume()["write_status"], "replayed")
        self.docker.assert_not_called()
        self.assertFalse((self.root / "out/launches.jsonl").exists())

    def test_sealed_and_user_stopped_runs_refuse(self):
        self.started[2].return_value = {"status": "complete"}
        self.refused()
        self.started[2].return_value = None
        (self.root / "out/STOP").touch()
        self.refused()

    def test_changed_source_or_pinned_container_refuses(self):
        original = (self.root / "inputs/strategy.py").read_bytes()
        (self.root / "inputs/strategy.py").write_bytes(original + b"# changed\n")
        self.refused()
        (self.root / "inputs/strategy.py").write_bytes(original)
        self.started[-2].return_value = SimpleNamespace(returncode=0, stdout=b'{"Image":"another-image"}')
        self.refused()

    def test_dirty_and_partial_tail_are_retained_and_refuse(self):
        checkpoint.dirty(self.root / "out")
        self.refused()
        (self.root / "out/recovery/dirty").unlink()
        with (self.root / "out/events.jsonl").open("ab") as stream:
            stream.write(b'{"interrupted":')
        before = (self.root / "out/events.jsonl").read_bytes()
        self.refused()
        self.assertEqual((self.root / "out/events.jsonl").read_bytes(), before)

    def test_failed_docker_starts_consume_attempts_before_any_runner_journal(self):
        self.docker.side_effect = RuntimeError("fixture Docker failure")
        for _ in range(recovery.CRASH_RESTARTS):
            with self.assertRaisesRegex(RuntimeError, "fixture Docker"):
                self.resume()
        self.docker.reset_mock()
        self.refused()
        self.assertEqual(len(recovery.launches(self.root / "out/launches.jsonl")), recovery.CRASH_RESTARTS)

    def test_a_resume_takes_back_its_memory_or_is_refused_before_docker(self):
        with mock.patch.dict("os.environ", {runs.BUDGET_ENV: "512m"}):
            with self.assertRaises(Refusal) as caught:
                self.resume()
        self.assertEqual(caught.exception.code, "PAPER_MEMORY_FULL")
        self.docker.assert_not_called()
        self.assertFalse((self.root / "out/launches.jsonl").exists())

    def test_partial_administrative_attempt_is_preserved(self):
        path = self.root / "out/launches.jsonl"
        path.write_bytes(b'{"action":"res')
        self.resume()
        self.assertTrue(path.read_bytes().startswith(b'{"action":"res\n'))
        self.assertEqual(len(recovery.launches(path)), 1)


@unittest.skipUnless(BINARY, SKIP)
class LifecycleLockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.profile = cls.service.ledger("paper_lock")

    @classmethod
    def tearDownClass(cls):
        cls.service.close()

    def test_lifecycle_lock_is_server_wide_and_nested_operations_do_not_deadlock(self):
        entered, release, second = threading.Event(), threading.Event(), threading.Event()
        errors = []
        def first():
            try:
                with recovery.operation(self.profile), recovery.operation(self.profile):
                    entered.set()
                    if not release.wait(5):
                        raise AssertionError("fixture release timed out")
            except BaseException as exc:
                errors.append(exc)
        def other():
            try:
                with recovery.operation(self.profile):
                    second.set()
            except BaseException as exc:
                errors.append(exc)
        one = threading.Thread(target=first)
        two = threading.Thread(target=other)
        one.start()
        try:
            self.assertTrue(entered.wait(5))
            two.start()
            time.sleep(.1)
            self.assertFalse(second.is_set())
        finally:
            release.set()
            one.join(5)
            if two.ident is not None:
                two.join(5)
        self.assertFalse(errors, errors)
        self.assertTrue(second.is_set())
