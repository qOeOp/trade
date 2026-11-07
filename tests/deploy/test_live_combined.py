"""Temporary combined-candidate verification; real files/locks, no Docker or venue calls."""

from contextlib import redirect_stderr, redirect_stdout
import fcntl
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

from cli import main as cli
from deploy.live_host import LiveBusy, LiveHost
from deploy.release import Release
from deploy.release_host import WEB, DockerHost, durable_json
from engine.live_errors import LiveRefusal
from live import authority, control, runs, state
from tests.deploy.test_live_lock_wait import Clock
from tests.deploy.test_live_release import PAIR, PairHost, PairLive
from tests.deploy.test_release import A, B
from tests.live.authority_fixture import install
from tests.live.test_authority import prepared


class InstalledPairLive(PairLive):
    """Keep fake container operations but use the shared installed configuration parser."""

    declaration_value = LiveHost.declaration_value
    snapshot = LiveHost.snapshot

    def prepare(self, previous, target):
        self.fixture.snapshot(WEB + target["revision"])
        self.configs[WEB + target["revision"]] = {}


class CombinedLiveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="combined-live-")
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.host = PairHost(self.work)
        self.root = self.host.lock.parent
        self.fixture = install(self, self.root, release_state=self.work, mock_inventory=False)
        self.source = Mock()
        self.source.agent_changed.return_value = False
        self.live = InstalledPairLive(self.host, self.source)
        self.live.fixture = self.fixture
        self.release = Release(self.host, self.source, live=self.live)
        self.scope = authority.operator(self.root, WEB + A)
        self.ids = self.enterContext(patch.object(runs, "_checked", return_value=""))
        self.enterContext(patch.object(runs, "_credentials", side_effect=AssertionError("credential read")))
        self.enterContext(patch.object(runs, "_launch_locked", side_effect=AssertionError("venue launch")))
        self.errors = io.StringIO()
        self.enterContext(redirect_stderr(self.errors))
        self.enterContext(redirect_stdout(io.StringIO()))
        self.clock = Clock()
        self.reader = None
        self.addCleanup(self.release_reader)
        self.inspections = []

        def inspect(*args, **kwargs):
            self.assertEqual(args[0], "run")
            self.assertIn("release-inspect", args)
            self.host.assert_locked()
            file = Path(args[args.index("--configuration") + 1])
            parsed = cli._parser().parse_args(["live", "release-inspect", "--configuration", str(file)])
            result, code = cli._dispatch(parsed, [])
            self.assertEqual(code, 0)
            self.inspections.append(result["state"])
            return json.dumps(result)

        self.host.docker = inspect

        def persist(name):
            DockerHost.persist_route(self.host, name)
            self.host.disk = name

        self.host.persist_route = persist
        self.host.disk_route = lambda: DockerHost.disk_route(self.host)

    def fake_clock(self):
        self.enterContext(patch("deploy.live_host.time.monotonic", self.clock.monotonic))
        self.enterContext(patch("deploy.live_host.time.sleep", self.clock.sleep))

    def hold_reader(self):
        self.reader = state.reading(self.root)
        self.reader.__enter__()

    def release_reader(self):
        if self.reader is not None:
            self.reader.__exit__(None, None, None)
            self.reader = None

    def change_declaration(self):
        file = self.work / "live/configuration.json"
        value = state.read(file)
        durable_json(file, {**value, "defaults": {**value["defaults"], "budget_usdt": "91"}})

    def test_web_listing_shared_lock_waits_then_commits_with_original_stop_available(self):
        self.fake_clock()
        directory, _ = prepared(self.root)
        entered, finish = threading.Event(), threading.Event()
        observed, failures = [], []

        def view(*args, **kwargs):
            entered.set()
            if not finish.wait(5):
                raise AssertionError("test reader was not released")
            return {"run_id": "original"}

        def listing():
            try:
                observed.append(control.listing(self.fixture.config, binding=self.fixture.binding))
            except Exception as error:
                failures.append(error)

        reader = threading.Thread(target=listing)

        def start():
            reader.start()
            self.assertTrue(entered.wait(5))

        def end():
            finish.set()
            reader.join(5)
            self.assertFalse(reader.is_alive())

        self.host.on_observe = start
        self.clock.after_sleep = end
        try:
            with patch.object(control, "run_view", side_effect=view):
                self.release.apply(PAIR)
        finally:
            finish.set()
            if reader.ident is not None:
                reader.join(5)
        self.assertEqual(failures, [])
        self.assertEqual(self.clock.sleeps, [.1])
        self.assertFalse(observed[0]["write_enabled"])
        self.assertTrue(observed[0]["maintenance_enabled"])
        self.assertEqual(self.inspections, ["idle", "idle"])
        self.assertEqual(self.host.disk_route(), WEB + B)
        self.assertFalse(self.release.transaction.exists())
        with self.assertRaises(LiveRefusal):
            self.scope.admit_locked(self.root)
        authority.operator(self.root, WEB + B).admit_locked(self.root)
        status, result = control.execute(self.fixture.config, "stop", "original",
                                         {"request_id": "retired-stop"}, binding=self.fixture.binding)
        self.assertEqual(status, 200, result)
        self.assertTrue((directory / "out/STOP").exists())

    def test_initial_installed_reader_defers_without_waiting_or_creating_transaction(self):
        self.fake_clock()
        self.hold_reader()
        self.release.apply(PAIR)
        self.assertEqual(self.clock.sleeps, [])
        self.assertEqual(self.inspections, [])
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.live.created)

    def test_changed_installed_declaration_during_wait_preserves_pending_transaction(self):
        self.fake_clock()
        self.host.on_observe = self.hold_reader
        self.clock.after_sleep = lambda: (self.change_declaration(), self.release_reader())
        with self.assertRaisesRegex(RuntimeError, "different custody authority"):
            self.release.apply(PAIR)
        self.assertEqual(self.inspections, ["idle"])
        self.assertEqual(self.host.disk_route(), WEB + A)
        self.assertTrue(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())
        self.assertIn("Primary Web release failure:", self.errors.getvalue())
        self.assertIn("Web release recovery failure:", self.errors.getvalue())

    def test_shared_parser_does_not_hide_same_lock_in_replaced_root_during_wait(self):
        self.fake_clock()
        self.live.prepare(WEB + A, PAIR)
        self.hold_reader()
        lock = self.host.lock.stat()

        def replace():
            original = self.root.with_name("original-custody")
            self.root.rename(original)
            self.root.mkdir(mode=0o700)
            (original / "account.lock").rename(self.host.lock)
            self.release_reader()

        self.clock.after_sleep = replace
        with self.assertRaisesRegex(RuntimeError, "custody path changed"):
            with self.live.barrier(WEB + B, idle=True, wait_for_lock=True):
                self.fail("replacement root accepted")
        self.assertEqual((self.host.lock.stat().st_dev, self.host.lock.stat().st_ino),
                         (lock.st_dev, lock.st_ino))
        self.assertEqual(self.inspections, [])

    def test_final_held_rechecks_installed_authority_before_real_metadata_write(self):
        ensure = self.host.ensure_protected
        changed = []

        def check(before):
            ensure(before)
            descriptor = os.open(self.host.lock, os.O_RDONLY)
            try:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
                except BlockingIOError:
                    self.change_declaration()
                    changed.append(True)
            finally:
                os.close(descriptor)

        self.host.ensure_protected = check
        original = (self.work / "router/active.json").read_bytes()
        with patch.object(self.release, "recover") as recover, \
                self.assertRaisesRegex(RuntimeError, "custody authority changed"):
            self.release.apply(PAIR)
        recover.assert_called_once_with()
        self.assertEqual(changed, [True])
        self.assertEqual((self.work / "router/active.json").read_bytes(), original)
        self.assertTrue(self.release.transaction.exists())

    def test_foreign_execution_seen_after_wait_blocks_commit_but_not_old_pair_recovery(self):
        self.fake_clock()
        foreign = self.work / "foreign"
        with state.serialized(foreign):
            pass
        directory, _ = prepared(foreign)
        state.append(directory / "lifecycle.jsonl", "launch_requested", "original", mode="preflight",
                     container="foreign-runner", credentials_path="/fake-never-read")
        state.append(directory / "lifecycle.jsonl", "container_started", "original", mode="preflight",
                     container="foreign-runner", container_id="c" * 64)
        found = {"Id": "c" * 64, "Name": "/foreign-runner",
                 "Config": {"Labels": {"trade.live.run": "original", "trade.live.role": "runner"}},
                 "Mounts": [{"Type": "bind", "Destination": "/reports",
                             "Source": str(directory / "out"), "RW": True}],
                 "State": {"Running": True, "Status": "running", "ExitCode": None}}
        self.host.on_observe = self.hold_reader
        self.clock.after_sleep = lambda: (setattr(self.ids, "return_value", "c" * 64), self.release_reader())
        with patch.object(runs, "_inspect", return_value=found), patch.object(runs, "_runner", return_value=found):
            with self.assertRaises(LiveBusy):
                self.release.apply(PAIR)
            with self.assertRaises(LiveRefusal) as refused:
                self.scope.admit_locked(self.root)
        self.assertEqual(refused.exception.code, "LIVE_ACCOUNT_OWNED")
        self.assertEqual(self.inspections, ["idle", "unavailable"])
        self.assertEqual((self.host.disk_route(), self.host.live_route()), (WEB + A, WEB + A))
        self.assertFalse(self.release.transaction.exists())
        self.assertTrue(self.release.failed.joinpath(B).exists())
        self.assertTrue((directory / "lifecycle.jsonl").exists())

    def test_recovery_held_rechecks_installed_authority_before_real_metadata_write(self):
        self.live.prepare(WEB + A, PAIR)
        self.release.journal(WEB + B, WEB + A)
        self.host.live = WEB + B
        self.host.persist_route(WEB + B)
        original = (self.work / "router/active.json").read_bytes()
        ensure = self.host.ensure_protected

        def change(before):
            ensure(before)
            self.host.assert_locked()
            self.change_declaration()

        self.host.ensure_protected = change
        with self.assertRaisesRegex(RuntimeError, "custody authority changed"):
            self.release.recover()
        self.assertEqual(self.inspections, [])
        self.assertEqual((self.work / "router/active.json").read_bytes(), original)
        self.assertTrue(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())
