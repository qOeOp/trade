"""Paired releases use fake Docker and isolated custody; no venue or active ledger is touched."""

import copy
import dataclasses
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy.live_configuration import CONTROL
from deploy.live_host import LIVE, LiveBusy, LiveHost
from deploy.release import Release
from deploy.release_host import AGENT, FRONTEND, RUNTIME_REF, SERVICE_REF, SOURCE, WEB, Config, DockerHost
from tests.deploy.test_release import A, B, C, Host, Crash, TARGET, paper_release


SERVICE = "ghcr.io/qoeop/trade-service@sha256:" + "d" * 64
RUNTIME = "ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64
PAIR = {**TARGET, "service": SERVICE, "runtime": RUNTIME}
OWNER = (os.getuid(), os.getgid())  # root's on a host (LiveHost.owner); this test's own here


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


class PairHost(Host):
    def __init__(self, state):
        super().__init__(state)
        self.config = Config(state=state)
        self.live_web = {WEB + A}
        self.socket_mounts = {}
        self.idle = "idle"
        self.lock = state / "live-root/account.lock"  # as A's pairing created it (LiveHost.ensure_root)
        self.lock.parent.mkdir(mode=0o700)
        self.lock.touch(mode=0o600)
        for path in (self.lock.parent, self.lock):
            os.chown(path, *OWNER)  # the owner's group, not the directory's
        self.containers[LIVE + A] = True
        self.controls = []
        self.inspect_hook = None
        self.inspected = []
        self.inspect_failure = False

    def requires_live(self, name):
        return name in self.live_web

    def create(self, name, image, agent=False, live_socket=None):
        super().create(name, image, agent, live_socket)
        if live_socket:
            self.live_web.add(name)
            self.socket_mounts[name] = live_socket

    def assert_locked(self):
        descriptor = os.open(self.lock, os.O_RDONLY)
        try:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            raise AssertionError("metadata writer does not hold the original account lock")
        finally:
            os.close(descriptor)

    def docker(self, *args, **kwargs):
        if args[0] == "run" and "release-inspect" in args:
            self.assert_locked()
            self.inspected.append(Path(args[args.index("--configuration") + 1]).parent.name)
            if self.inspect_hook:
                self.inspect_hook()
            if self.inspect_failure:
                raise RuntimeError("docker run failed: usage: cli.main live release-inspect")
            return json.dumps({"state": self.idle})
        raise AssertionError(args)

    def persist_route(self, name):
        self.assert_locked()  # a paired commit or rollback
        super().persist_route(name)


class PairLive(LiveHost):
    """Only container machinery is doubled; the production fd/lock/idle boundary is exercised."""
    def __init__(self, host, source):
        super().__init__(host, source)
        self.configs = {WEB + A: self.facts()}
        self.created = []
        self.health_failure = False

    def owner(self):
        return OWNER

    def prepare(self, owner, target):
        self.ensure_root()
        self.source.require_runtime(A, target["revision"])
        self.configs[WEB + target["revision"]] = self.facts()

    def snapshot(self, name):
        return self.configs[name]

    def common(self, name, helper=False):
        return []

    def checked(self, name):
        return {"id": "control-" + name, "image": SERVICE, "running": self.web.containers[self.name(name)]}

    def create(self, name, service):
        self.created.append((name, service))
        self.web.containers[self.name(name)] = False

    def start(self, name):
        self.web.controls.append(("start", name))
        self.web.containers[self.name(name)] = True

    def health(self, name):
        if self.health_failure and name != WEB + A:
            raise RuntimeError("control unavailable")

    warm = health

    def retire(self):
        if self.web.disk != self.web.live or (self.state / "transaction.json").exists():
            raise AssertionError("retirement before settled pair")
        for name in self.configs:
            if name != self.web.disk and self.web.containers.get(self.name(name)):
                self.web.controls.append(("drain", name))
                self.web.containers[self.name(name)] = False


class PairedReleaseTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.host = PairHost(Path(directory.name).resolve())
        self.source = Mock()
        self.source.agent_changed.return_value = False
        self.live = PairLive(self.host, self.source)
        self.release = Release(self.host, self.source, live=self.live, paper=paper_release(self.host))
        original = self.release.journal

        def journal(*args, **kwargs):
            self.host.assert_locked()
            return original(*args, **kwargs)

        self.release.journal = journal
        clear = self.release.clear

        def checked_clear():
            self.host.assert_locked()
            clear()

        self.release.clear = checked_clear

    def test_two_releases_keep_their_companion_and_socket_without_agent_mounts(self):
        self.release.apply(PAIR)
        self.release.apply({**PAIR, "revision": C})
        self.assertEqual(self.host.disk, WEB + C)
        self.assertEqual(self.host.live, WEB + C)
        self.assertEqual(self.live.created, [(WEB + B, SERVICE), (WEB + C, SERVICE)])
        self.assertEqual(self.host.socket_mounts, {
            WEB + B: self.host.state / "live" / B / "socket",
            WEB + C: self.host.state / "live" / C / "socket"})
        self.assertFalse(any(name.startswith(AGENT) for name in self.host.socket_mounts))
        self.assertEqual(self.host.controls, [("start", WEB + B), ("drain", WEB + A),
                                             ("start", WEB + C), ("drain", WEB + B)])

    def test_busy_unavailable_or_existing_operation_defers_without_failure_or_container_changes(self):
        for status in ("busy", "unavailable"):
            with self.subTest(status=status):
                self.host.idle = status
                before = dict(self.host.containers)
                self.release.apply(PAIR)
                self.assertEqual(before, self.host.containers)
                self.assertFalse(self.release.transaction.exists())
                self.assertFalse(self.release.failed.exists())
        self.host.idle = "idle"
        fd = os.open(self.host.lock, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            self.release.apply(PAIR)
            self.assertFalse(self.release.transaction.exists())
        finally:
            os.close(fd)
        self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + B)

    def test_late_independent_cli_or_unknown_state_rolls_back_without_requiring_idle(self):
        self.host.on_observe = lambda: setattr(self.host, "idle", "busy")
        with self.assertRaises(LiveBusy):
            self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertFalse(self.host.containers[LIVE + B])
        self.assertFalse(self.release.transaction.exists())

    def test_failure_and_crash_restore_both_sides_and_never_retire_current_control(self):
        self.host.fail = "crash"
        with self.assertRaises(Crash):
            self.release.apply(PAIR)
        self.assertTrue(self.release.transaction.exists())
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertTrue(self.host.containers[LIVE + B])
        self.host.fail = None
        self.release.recover()
        self.assertEqual(self.host.disk, WEB + A)
        self.assertEqual(self.host.controls, [("start", WEB + B), ("start", WEB + A), ("drain", WEB + B)])

    def test_disk_commit_before_clear_crash_rolls_back_but_after_clear_never_does(self):
        clear = self.release.clear
        self.release.clear = Mock(side_effect=Crash())
        with self.assertRaises(Crash):
            self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + B)
        self.assertTrue(self.release.transaction.exists())
        self.release.clear = clear
        self.release.recover()
        self.assertEqual(self.host.disk, WEB + A)
        self.release.failed.joinpath(B).unlink()
        del self.host.containers[WEB + B]
        del self.host.containers[LIVE + B]
        self.live.retire = Mock(side_effect=Crash())
        with self.assertRaises(Crash):
            self.release.apply(PAIR)
        self.assertFalse(self.release.transaction.exists())
        self.release.recover()
        self.assertEqual(self.host.disk, WEB + B)

    def test_withdrawal_and_runtime_mismatch_prevent_any_switch(self):
        self.source.require_runtime.side_effect = RuntimeError("runtime inputs differ")
        with self.assertRaises(RuntimeError):
            self.release.apply(PAIR)
        self.assertFalse(self.release.transaction.exists())
        self.assertEqual(self.host.disk, WEB + A)
        self.source.require_runtime.side_effect = None
        self.host.on_warm = lambda _: setattr(self.source.ensure, "side_effect", RuntimeError("main changed"))
        with self.assertRaises(RuntimeError):
            self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + A)
        self.assertTrue(self.host.containers[LIVE + A])

    def test_a_web_without_a_control_gets_one_and_the_custody_root_with_no_operator_step(self):
        # A host released before Live was installed everywhere: its routed Web has no --live-socket.
        shutil.rmtree(self.live.root)
        self.host.live_web.clear()
        del self.host.containers[LIVE + A], self.live.configs[WEB + A]
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.live), (WEB + B, WEB + B))
        # No owner to ask: the candidate's control answers on the new root, at its journal and at its commit.
        self.assertEqual(self.host.inspected, [B, B])
        self.assertEqual(self.host.socket_mounts, {WEB + B: self.host.state / "live" / B / "socket"})
        self.assertEqual(self.host.controls, [("start", WEB + B)])
        root, lock = self.live.root.lstat(), self.host.lock.lstat()
        self.assertEqual((root.st_mode & 0o777, lock.st_mode & 0o777), (0o700, 0o600))
        self.assertEqual({(root.st_uid, root.st_gid), (lock.st_uid, lock.st_gid)}, {(os.getuid(), os.getgid())})
        self.assertFalse(os.path.lexists(self.host.state / "live-root.new"))
        self.release.apply({**PAIR, "revision": C})  # the next release pairs as any other, on the same root
        self.assertEqual((self.host.disk, self.host.inspected), (WEB + C, [B, B, B, C, C]))
        self.assertEqual(self.host.lock.lstat().st_ino, lock.st_ino)

    def test_lock_missing_symlink_or_replaced_inode_is_not_a_new_lock(self):
        self.live.configs[WEB + B] = self.live.facts()
        self.host.lock.unlink()
        with self.assertRaises(FileNotFoundError):
            with self.live.barrier(WEB + B, SERVICE, idle=True):
                self.fail("missing lock was accepted")
        self.assertFalse(self.host.lock.exists())
        other = self.host.lock.with_name("other")
        other.touch(mode=0o600)
        self.host.lock.symlink_to(other)
        with self.assertRaises(OSError):
            with self.live.barrier(WEB + B, SERVICE):
                self.fail("symlink lock was accepted")
        self.host.lock.unlink()
        self.host.lock.touch(mode=0o600)
        with self.assertRaisesRegex(RuntimeError, "identity changed"):
            with self.live.barrier(WEB + B, SERVICE) as held:
                self.host.lock.unlink()
                self.host.lock.touch(mode=0o600)
                held()

    def test_host_keeps_lock_after_read_only_inspector_returns_until_metadata_is_written(self):
        self.live.configs[WEB + B] = self.live.facts()
        code = ("import fcntl,os,sys; f=os.open(sys.argv[1],os.O_RDONLY); print('waiting',flush=True);"
                "fcntl.flock(f,fcntl.LOCK_EX); print('acquired',flush=True)")
        with self.live.barrier(WEB + B, SERVICE, idle=True):
            child = subprocess.Popen([sys.executable, "-c", code, str(self.host.lock)],
                                     stdout=subprocess.PIPE, text=True)
            self.assertEqual(child.stdout.readline().strip(), "waiting")
            with self.assertRaises(subprocess.TimeoutExpired):
                child.wait(timeout=.1)
            self.release.journal(WEB + B, WEB + A)
        self.assertEqual(child.communicate(timeout=5)[0].strip(), "acquired")
        self.assertEqual(child.returncode, 0)


    def test_a_held_account_lock_is_not_a_busy_account(self):
        fd = os.open(self.host.lock, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_SH)  # a reader, as the browser's listing holds it
            self.release.apply(PAIR)
        finally:
            os.close(fd)
        self.assertEqual((self.host.disk, self.host.inspected, self.live.created), (WEB + A, [], []))
        self.assertFalse(self.release.failed.exists())

    def test_busy_live_waits_and_asks_only_the_owner_each_tick(self):
        self.host.idle = "busy"
        for _ in range(2):
            self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.inspected, self.live.created), (WEB + A, [A, A], []))
        self.assertFalse(self.release.transaction.exists())
        self.host.idle = "idle"
        self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + B)

    def test_live_turning_busy_after_the_owner_answered_idle_keeps_the_pair_for_the_next_tick(self):
        answers = iter(("idle", "busy"))
        self.host.inspect_hook = lambda: setattr(self.host, "idle", next(answers))
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.inspected), (WEB + A, [A, B]))
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())

    def test_a_live_busy_or_account_lock_wait_journals_neither_side(self):
        from deploy.paper_host import PAPER, route_config

        def owner_busy():
            self.host.idle = "busy"

        def candidate_busy():
            answers = iter(("idle", "busy"))
            self.host.inspect_hook = lambda: setattr(self.host, "idle", next(answers))

        for wait in (owner_busy, candidate_busy):
            with self.subTest(wait=wait.__name__):
                self.setUp()
                paper = self.release.paper()
                wait()
                self.release.apply(PAIR)
                self.assertFalse(self.release.transaction.exists())
                self.assertFalse(paper.transaction.exists())
                self.assertEqual(paper.host.live, route_config(PAPER + A))
                self.assertNotIn(PAPER + B, paper.host.running)
                self.assertFalse(self.release.failed.exists())
        self.setUp()
        paper = self.release.paper()
        fd = os.open(self.host.lock, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_SH)
            self.release.apply(PAIR)
        finally:
            os.close(fd)
        self.assertFalse(paper.transaction.exists())
        self.assertNotIn(PAPER + B, paper.host.running)
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, paper.host.disk), (WEB + B, route_config(PAPER + B)))

    def test_a_failing_inspection_is_an_unavailable_account_and_fails_no_tick(self):
        self.host.inspect_failure = True
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.live.created), (WEB + A, []))
        self.assertFalse(self.release.failed.exists())

    def test_a_changed_market_directory_pairs_a_new_control_once_live_is_idle(self):
        self.live.configs[WEB + A] = {**self.live.facts(), "market_root": "/earlier/market"}
        self.host.idle = "busy"
        self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + A, "a busy account keeps the pair")
        self.host.idle = "idle"
        self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + B)
        # Only the candidate's control reads the host's current inputs, so only its inspection answers.
        self.assertEqual(set(self.host.inspected), {B})
        self.assertEqual(self.live.configs[WEB + B]["market_root"], str(self.host.config.data / "market"))
        self.assertEqual(self.live.configs[WEB + A]["market_root"], "/earlier/market", "the old control keeps its inputs")


class LiveHostBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.market = self.base / "data/market"
        self.market.mkdir(parents=True)
        self.web = DockerHost(Config(state=self.base / "release", data=self.base / "data"))
        self.web.state.mkdir(mode=0o700)
        self.web.docker = Mock()
        self.web.requires_live = Mock(return_value=False)
        self.web.pull = Mock(return_value=A)
        self.web.exists = Mock(return_value=False)
        self.source = Mock()
        self.live = LiveHost(self.web, self.source)
        self.live.owner = Mock(return_value=OWNER)
        self.root = self.web.state / "live-root"
        self.live.prepare(None, PAIR)

    def write_snapshot(self, name, **changes):
        path = self.live.configuration(name)
        path.write_text(json.dumps({**json.loads(path.read_text()), **changes}))

    def test_the_snapshot_is_the_hosts_inputs_and_a_changed_market_reaches_only_a_new_control(self):
        self.assertEqual(self.live.snapshot(WEB + B), {
            "format": CONTROL, "root": str(self.root),
            "research_ledger": str(self.web.state / "profiles/research.json"), "market_root": str(self.market),
            "runtime": RUNTIME, "socket": str(self.live.socket(WEB + B) / "control.sock")})
        self.assertEqual(self.live.configuration(WEB + B).stat().st_mode & 0o777, 0o600)
        with patch.object(self.live, "checked") as checked:
            self.live.prepare(B, {**PAIR, "revision": C})
        checked.assert_called_once_with(WEB + B)
        self.web.requires_live.assert_not_called()
        self.assertTrue(self.live.current(B))
        moved = self.base / "moved/market"
        moved.mkdir(parents=True)
        self.web.config = dataclasses.replace(self.web.config, data=moved.parent)
        self.assertFalse(self.live.current(B))
        with self.live.barrier(WEB + B) as held:
            held()  # the owner stays inspectable: its custody is unchanged
        with patch.object(self.live, "checked"):
            self.live.prepare(B, {**PAIR, "revision": A})
        self.assertEqual(self.live.snapshot(WEB + A)["market_root"], str(moved))
        self.assertEqual(self.live.snapshot(WEB + B)["market_root"], str(self.market))

    def test_a_snapshot_names_only_its_own_states_root_and_reader_in_the_current_format(self):
        for changes in ({"root": str(self.base / "custody")},
                        {"research_ledger": str(self.base / "reader.json")},
                        {"format": "live-control-v1"},
                        {"sources": []},
                        {"market_root": "relative/market"}):
            with self.subTest(changes=changes):
                original = self.live.configuration(WEB + B).read_bytes()
                self.write_snapshot(WEB + B, **changes)
                with self.assertRaisesRegex(RuntimeError, "does not match its release|absolute bind paths"):
                    self.live.prepare(B, {**PAIR, "revision": C})
                with self.assertRaisesRegex(RuntimeError, "does not match its release|absolute bind paths"):
                    with self.live.barrier(WEB + B):
                        pass
                self.live.configuration(WEB + B).write_bytes(original)

    def test_a_snapshot_without_a_control_follows_the_host_and_one_with_a_control_is_kept(self):
        self.web.config = dataclasses.replace(self.web.config, data=self.base / "moved")
        (self.base / "moved/market").mkdir(parents=True)
        self.live.prepare(None, PAIR)  # the earlier attempt at B created no control
        self.assertEqual(self.live.snapshot(WEB + B)["market_root"], str(self.base / "moved/market"))
        self.web.config = dataclasses.replace(self.web.config, data=self.base / "data")
        self.web.exists.return_value = True
        with self.assertRaisesRegex(RuntimeError, "binds different inputs"):
            self.live.prepare(None, PAIR)
        self.assertEqual(self.live.snapshot(WEB + B)["market_root"], str(self.base / "moved/market"))

    def test_the_first_pairing_creates_the_root_and_lock_once_for_their_owner(self):
        root, lock = self.root.lstat(), (self.root / "account.lock").lstat()
        self.assertEqual((root.st_mode & 0o7777, lock.st_mode & 0o7777), (0o700, 0o600))
        self.assertEqual({(root.st_uid, root.st_gid), (lock.st_uid, lock.st_gid)}, {(os.getuid(), os.getgid())})
        self.live.prepare(None, PAIR)
        self.assertEqual((self.root / "account.lock").lstat().st_ino, lock.st_ino, "never created again")
        self.assertEqual(LiveHost.owner(self.live), (0, 0), "on a host, root's")
        # The owner's group, even where the release state's directory would give another.
        other = next((gid for gid in os.getgroups() if gid != os.getgid()), None)
        if other is None:
            self.skipTest("this user belongs to one group only")
        shutil.rmtree(self.root)
        self.live.owner.return_value = (os.getuid(), other)
        self.live.prepare(None, PAIR)
        for path in (self.root, self.root / "account.lock"):
            self.assertEqual((path.lstat().st_uid, path.lstat().st_gid), (os.getuid(), other))

    def test_an_existing_root_that_differs_is_refused_and_never_repaired(self):
        lock = self.root / "account.lock"

        def refused():
            with self.assertRaisesRegex(RuntimeError, "differs from its product installation"):
                self.live.prepare(None, PAIR)

        self.live.owner.return_value = (os.getuid(), os.getgid() + 4242)  # another owner
        refused()
        self.assertEqual((self.root.lstat().st_gid, lock.lstat().st_gid), (os.getgid(), os.getgid()))
        self.live.owner.return_value = OWNER
        for mode, path in ((0o750, self.root), (0o640, lock)):
            path.chmod(mode)
            refused()
            self.assertEqual(path.lstat().st_mode & 0o777, mode)
            path.chmod(mode & 0o700)
        lock.unlink()
        refused()
        self.assertFalse(os.path.lexists(lock), "a missing lock is never recreated in an existing root")
        self.root.rmdir()
        elsewhere = self.base / "elsewhere"
        elsewhere.mkdir(mode=0o700)
        (elsewhere / "account.lock").touch(mode=0o600)
        self.root.symlink_to(elsewhere, target_is_directory=True)
        refused()
        self.assertTrue(self.root.is_symlink())

    def test_an_unfinished_creation_is_started_again_and_no_other_state_is_touched(self):
        shutil.rmtree(self.root)
        staged = self.web.state / "live-root.new"
        staged.mkdir(mode=0o700)
        (staged / "account.lock").touch(mode=0o600)
        (staged / "stray").write_text("")
        self.live.prepare(None, PAIR)
        self.assertEqual(sorted(path.name for path in self.root.iterdir()), ["account.lock"])
        self.assertFalse(os.path.lexists(staged))

    def test_prune_and_runtimes_without_any_paired_control(self):
        shutil.rmtree(self.web.state / "live")
        shutil.rmtree(self.root)
        self.web.managed = Mock(return_value=[])
        self.live.prune(set())
        self.assertEqual(self.live.runtimes(), set())
        self.assertFalse(os.path.lexists(self.web.state / "live"))

    def test_control_and_inspector_mount_scopes_and_immutable_image_pair(self):
        self.web.pull.assert_any_call(SERVICE, SERVICE_REF, B)
        self.web.pull.assert_any_call(RUNTIME, RUNTIME_REF)
        self.source.require_runtime.assert_called_once_with(A, B)
        with patch("deploy.live_host.DOCKER_SOCKET", self.root / "account.lock"), patch.object(self.live, "checked"):
            self.live.create(WEB + B, SERVICE)
            control = self.web.docker.call_args.args
            inspector = self.live.common(WEB + B, helper=True)
        self.assertIn(f"type=bind,src={self.root},dst={self.root}", control)
        self.assertIn(f"type=bind,src={self.root},dst={self.root},readonly", inspector)
        self.assertIn(f"type=bind,src={self.market},dst={self.market},readonly", control)
        self.assertFalse(any("research.json" in arg for arg in control), "the state mount holds the reader profile")
        self.assertIn(f"type=bind,src={self.live.state},dst={self.live.state},readonly", control)
        self.assertIn(f"type=bind,src={self.live.socket(WEB + B)},dst={self.live.socket(WEB + B)}", control)
        self.assertNotIn(FRONTEND, control)
        self.assertNotIn("--publish", control)
        self.assertIn(SERVICE, control)
        self.assertIn("--release-web", control)

    def test_execution_image_admission_checks_actual_platform_source_revision_and_digest(self):
        image = {"Architecture": "amd64", "RepoDigests": [SERVICE], "Config": {"Labels": {
            "org.opencontainers.image.revision": B, "org.opencontainers.image.source": SOURCE}}}
        host = DockerHost(self.web.config)
        host.docker = Mock(side_effect=lambda *args, **kwargs: json.dumps(image) if args[0] == "image" else "")
        self.assertEqual(host.pull(SERVICE, SERVICE_REF, B), B)
        variants = []
        for field, value in (("Architecture", "arm64"), ("RepoDigests", [])):
            changed = copy.deepcopy(image)
            changed[field] = value
            variants.append(changed)
        for field, value in (("org.opencontainers.image.revision", A),
                             ("org.opencontainers.image.source", "https://example.com/other")):
            changed = copy.deepcopy(image)
            changed["Config"]["Labels"][field] = value
            variants.append(changed)
        for changed in variants:
            with self.subTest(image=changed):
                host.docker.side_effect = lambda *args, **kwargs: json.dumps(changed) if args[0] == "image" else ""
                with self.assertRaisesRegex(RuntimeError, "differs from admission"):
                    host.pull(SERVICE, SERVICE_REF, B)

    def test_retained_control_requires_bound_command_and_read_only_release_metadata(self):
        name = WEB + B
        value = self.live.snapshot(name)
        command = ["python", "-m", "cli.main", "live", "serve", "--configuration",
                   str(self.live.configuration(name)), "--release-state", str(self.live.state), "--release-web", name]
        mounts = [{"Type": "bind", "Source": path, "Destination": path, "RW": writable}
                  for path, writable in ((value["root"], True), (str(self.live.state), False),
                                         (str(self.live.socket(name)), True))]
        self.web.checked = Mock(return_value={"id": "control-id", "image": SERVICE, "running": True})
        self.web.docker.side_effect = lambda *args, **kwargs: json.dumps(command if "Cmd" in args[2] else mounts)
        self.assertEqual(self.live.checked(name)["id"], "control-id")
        mounts[1]["RW"] = True
        with self.assertRaisesRegex(RuntimeError, "mounts differ"):
            self.live.checked(name)
        mounts[1]["RW"] = False
        command[-1] = WEB + A
        with self.assertRaisesRegex(RuntimeError, "command or image"):
            self.live.checked(name)

    def test_existing_socket_directory_cannot_redirect_the_binding_or_expose_it(self):
        path = self.live.socket(WEB + B)
        path.chmod(0o755)
        with self.assertRaisesRegex(RuntimeError, "private release binding"):
            self.live.prepare(None, PAIR)
        path.rmdir()
        path.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "private release binding"):
            self.live.prepare(None, PAIR)

    def test_web_mount_is_read_only_and_agent_cannot_receive_socket(self):
        self.web.docker.reset_mock()
        self.web.create(WEB + B, TARGET["image"], live_socket=self.live.socket(WEB + B))
        command = self.web.docker.call_args_list[0].args
        self.assertIn(f"type=bind,src={self.live.socket(WEB + B)},dst=/run/trade-live,readonly", command)
        self.assertIn("--live-socket=/run/trade-live/control.sock", command)
        self.assertIn("--live-router=ide-router", command)
        self.assertFalse(any(str(self.root) in arg for arg in command))
        self.assertFalse(any("docker.sock" in arg for arg in command))
        with self.assertRaisesRegex(RuntimeError, "Agent"):
            self.web.create(AGENT + B, TARGET["image"], agent=True, live_socket=self.live.socket(WEB + B))

    def test_drain_only_signals_the_exact_retired_id_and_keeps_unfinished_process(self):
        self.web.exists.return_value = True
        self.web.disk_route = Mock(return_value=WEB + C)
        self.web.live_route = Mock(return_value=WEB + C)
        with patch.object(self.live, "checked", return_value={"id": "original-id", "running": True}):
            self.assertFalse(self.live.drain(WEB + B))
        self.assertEqual(self.web.docker.call_args_list[-2].args, ("update", "--restart=no", "original-id"))
        self.assertEqual(self.web.docker.call_args_list[-1].args, ("kill", "--signal", "SIGTERM", "original-id"))
        self.assertFalse(any(call.args[0] in {"stop", "rm"} for call in self.web.docker.call_args_list))
        self.web.disk_route.return_value = WEB + B
        self.web.docker.reset_mock()
        with patch.object(self.live, "checked", return_value={"id": "original-id", "running": True}):
            with self.assertRaisesRegex(RuntimeError, "still selected"):
                self.live.drain(WEB + B)
        self.web.docker.assert_not_called()

    def test_the_control_of_the_committed_or_loaded_web_is_never_drained(self):
        self.web.exists.return_value = True
        running = {"id": "owner-id", "running": True}
        for disk, loaded in ((WEB + B, WEB + C), (WEB + C, WEB + B)):
            self.web.disk_route = Mock(return_value=disk)
            self.web.live_route = Mock(return_value=loaded)
            with patch.object(self.live, "checked", return_value=running):
                with self.assertRaisesRegex(RuntimeError, "still selected"):
                    self.live.drain(WEB + B)
        self.web.docker.assert_not_called()

    def test_identity_change_between_retirement_checks_cannot_signal_replacement(self):
        self.web.exists.return_value = True
        self.web.disk_route = Mock(return_value=WEB + C)
        self.web.live_route = Mock(return_value=WEB + C)
        with patch.object(self.live, "checked", side_effect=[{"id": "old", "running": True},
                                                            {"id": "new", "running": True}]):
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                self.live.drain(WEB + B)
        self.web.docker.assert_not_called()
