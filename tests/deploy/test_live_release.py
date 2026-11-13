"""Paired releases use fake Docker and isolated custody; no venue or active ledger is touched."""

import copy
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy.live_configuration import DECLARATION
from deploy.live_host import LIVE, OPERATOR_FIELDS, LiveBusy, LiveHost
from deploy.release import Release
from deploy.release_host import AGENT, AHEAD, FRONTEND, RUNTIME_REF, SERVICE_REF, SOURCE, WEB, Config, DockerHost
from tests.deploy.test_release import A, B, C, Host, Crash, TARGET


SERVICE = "ghcr.io/qoeop/trade-service@sha256:" + "d" * 64
RUNTIME = "ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64
PAIR = {**TARGET, "service": SERVICE, "runtime": RUNTIME}


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
        self.lock = state / "custody/account.lock"
        self.lock.parent.mkdir(mode=0o700)
        self.lock.touch(mode=0o600)
        self.containers[LIVE + A] = True
        self.controls = []
        self.inspect_hook = None
        self.inspected = []
        self.adopt_flags = []  # whether each inspection was asked for the busy runs' runtimes
        self.runtimes = []  # the runtime build revisions a busy account's runs answer with --adopt
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
            self.adopt_flags.append("--adopt" in args)
            if self.inspect_hook:
                self.inspect_hook()
            if self.inspect_failure:
                raise RuntimeError("docker run failed: usage: cli.main live release-inspect")
            if "--adopt" in args and self.idle == "busy":
                return json.dumps({"state": "busy", "runtimes": self.runtimes})
            return json.dumps({"state": self.idle})
        raise AssertionError(args)

    def persist_route(self, name, owner):
        transaction = self.state / "transaction.json"
        if not (transaction.exists() and "candidate_owner" in json.loads(transaction.read_text())):
            self.assert_locked()  # a paired commit or rollback; a Web-only one leaves the account alone
        super().persist_route(name, owner)

    def mounted_sockets(self, names):
        return {self.socket_mounts[name] for name in names if name in self.socket_mounts}


class PairLive(LiveHost):
    """Only container machinery is doubled; the production fd/lock/idle boundary is exercised."""
    def __init__(self, host, source):
        super().__init__(host, source)
        self.configs = {WEB + A: {**dict.fromkeys(OPERATOR_FIELDS), "root": str(host.lock.parent)}}
        self.created = []
        self.health_failure = False
        self.declared = None

    def prepare(self, owner, target):
        self.source.require_runtime(A, target["revision"])
        self.configs[WEB + target["revision"]] = dict(self.declaration_value())

    def declaration_value(self):
        return self.declared or self.configs[WEB + A]

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
            if name != WEB + self.web.disk_owner() and self.web.containers.get(self.name(name)):
                self.web.controls.append(("drain", name))
                self.web.containers[self.name(name)] = False


class PairedReleaseTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.host = PairHost(Path(directory.name).resolve())
        self.source = Mock()
        self.source.agent_changed.return_value = False
        self.source.control_changed.return_value = True
        self.source.protocol.return_value = None  # undeclared: a busy account keeps the pair
        self.live = PairLive(self.host, self.source)
        self.release = Release(self.host, self.source, live=self.live)
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

    def test_missing_installation_cannot_turn_a_committed_live_web_into_web_only(self):
        with self.assertRaisesRegex(RuntimeError, "configuration is missing"):
            Release(self.host, self.source).apply(PAIR)
        self.assertFalse(self.release.transaction.exists())

    def test_lock_missing_symlink_or_replaced_inode_is_not_a_new_lock(self):
        self.live.configs[WEB + B] = {**dict.fromkeys(OPERATOR_FIELDS), "root": str(self.host.lock.parent)}
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
        self.live.configs[WEB + B] = {**dict.fromkeys(OPERATOR_FIELDS), "root": str(self.host.lock.parent)}
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


class WebOnlyReleaseTests(unittest.TestCase):
    """A candidate that changes nothing the owner control runs moves the Web alone, busy or not."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.host = PairHost(Path(directory.name).resolve())
        self.host.idle = "busy"
        self.host.inspect_hook = lambda: self.fail("a Web-only release inspected the account")
        self.source = Mock()
        self.source.agent_changed.return_value = False
        self.source.control_changed.return_value = False
        self.source.protocol.return_value = None
        self.live = PairLive(self.host, self.source)
        self.release = Release(self.host, self.source, live=self.live)
        self.journals = []
        journal = self.release.journal
        self.release.journal = lambda *args: self.journals.append(args) or journal(*args)

    def test_web_moves_beside_a_busy_account_and_the_owner_keeps_it(self):
        self.release.apply(PAIR)
        self.release.apply({**PAIR, "revision": C})
        self.assertEqual((self.host.disk, self.host.live), (WEB + C, WEB + C))
        self.assertEqual((self.host.disk_owner(), self.host.live_owner()), (A, A))
        self.assertEqual(self.source.control_changed.call_args_list[-1].args, (A, C))
        socket = self.host.state / "live" / A / "socket"
        self.assertEqual(self.host.socket_mounts, {WEB + B: socket, WEB + C: socket})
        self.assertEqual(self.live.created, [])
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertFalse(any(action == "drain" for action, _ in self.host.controls))
        self.assertEqual(self.journals[-1][3], {"candidate_owner": A})
        self.assertFalse(self.release.transaction.exists())

    def test_failure_or_crash_returns_the_web_and_never_the_account(self):
        self.host.fail = "crash"
        with self.assertRaises(Crash):
            self.release.apply(PAIR)
        self.assertTrue(self.release.transaction.exists())
        self.host.fail = None
        self.release.recover()
        self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + A, WEB + A, A))
        self.assertFalse(self.release.transaction.exists())
        self.host.fail = "observe"
        with self.assertRaises(RuntimeError):
            self.release.apply({**PAIR, "revision": C})
        self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + A, WEB + A, A))
        self.assertTrue(self.release.failed.joinpath(C).exists())
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertEqual(self.live.created, [])

    def test_a_changed_control_from_a_web_only_state_pairs_from_the_owner(self):
        self.release.apply(PAIR)
        self.source.control_changed.return_value = True
        self.host.inspect_hook = None
        self.release.apply({**PAIR, "revision": C})
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + B, A), "a busy account keeps the pair")
        self.host.idle = "idle"
        prepared = []
        prepare = self.live.prepare
        self.live.prepare = lambda owner, target: prepared.append(owner) or prepare(owner, target)
        self.release.apply({**PAIR, "revision": C})
        self.assertEqual(prepared, [A])
        self.assertEqual(self.journals[-1][3], {"previous_owner": A})
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + C, C))
        self.assertEqual(self.live.created, [(WEB + C, SERVICE)])
        self.assertIn(("drain", WEB + A), self.host.controls)

    def test_a_changed_declaration_pairs_a_new_control_once_live_is_idle(self):
        self.release.apply(PAIR)
        self.host.inspect_hook = None
        self.live.declared = {**self.live.configs[WEB + A], "research_at": "b" * 32}
        self.release.apply({**PAIR, "revision": C})
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + B, A), "a busy account keeps the pair")
        self.host.idle = "idle"
        self.release.apply({**PAIR, "revision": C})
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + C, C))
        self.assertEqual(self.live.created, [(WEB + C, SERVICE)])
        # The owner's control refuses inspection against a changed declaration; only the candidate's answers.
        self.assertEqual(set(self.host.inspected), {C})
        self.assertEqual(self.live.configs[WEB + C]["research_at"], "b" * 32)
        self.assertEqual(self.live.configs[WEB + A]["research_at"], None, "the old control keeps its inputs")

    def test_paired_rollback_from_a_web_only_state_restores_the_owner(self):
        self.release.apply(PAIR)
        self.source.control_changed.return_value = True
        self.host.idle = "idle"
        self.host.inspect_hook = None
        self.host.fail = "observe"
        with self.assertRaises(RuntimeError):
            self.release.apply({**PAIR, "revision": C})
        self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + B, WEB + B, A))
        self.assertTrue(self.host.containers[LIVE + A])

    def test_rollback_with_an_agent_change_restores_the_owner_route(self):
        self.source.agent_changed.return_value = True
        for idle, change in (("busy", False), ("idle", True)):
            self.host.idle = idle
            self.host.inspect_hook = None
            self.source.control_changed.return_value = change
            self.host.fail = "observe"
            with self.assertRaises(RuntimeError):
                self.release.apply(PAIR)
            self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + A, WEB + A, A))
            self.assertFalse(self.release.transaction.exists())
            self.release.failed.joinpath(B).unlink()

    def test_no_headroom_or_an_unhealthy_owner_keeps_the_web_without_a_failure_mark(self):
        self.host.memory_available = lambda: False
        self.release.apply(PAIR)
        self.host.memory_available = lambda: True
        self.live.health = Mock(side_effect=RuntimeError("control unavailable"))
        with self.assertRaisesRegex(RuntimeError, "control unavailable"):
            self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + A)
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())

    def test_a_replaced_owner_control_is_not_committed_over(self):
        self.host.on_observe = lambda: setattr(self.live, "checked", lambda name: {"id": "replaced", "running": True})
        with self.assertRaisesRegex(RuntimeError, "owner control changed"):
            self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + A, A))


class WebFirstReleaseTests(unittest.TestCase):
    """A candidate that changes the control, while Live is busy, serves its Web beside the owner's control
    when both declare one browser protocol; its own control pairs once Live is idle."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.host = PairHost(Path(directory.name).resolve())
        self.host.idle = "busy"
        self.source = Mock()
        self.source.agent_changed.return_value = False
        self.source.control_changed.return_value = True
        self.source.protocol.return_value = 1
        self.live = PairLive(self.host, self.source)
        self.release = Release(self.host, self.source, live=self.live)
        self.journals = []
        journal = self.release.journal
        self.release.journal = lambda *args: self.journals.append(args) or journal(*args)
        self.prepared, self.pulled = [], []
        prepare, pull = self.live.prepare, self.host.pull
        self.live.prepare = lambda owner, target: self.prepared.append(owner) or prepare(owner, target)
        self.host.pull = lambda *args: self.pulled.append(args) or pull(*args)

    def test_the_web_serves_ahead_of_a_busy_owner_and_its_control_pairs_once_idle(self):
        self.release.apply(PAIR)
        self.assertEqual(self.prepared, [], "serving ahead prepares no control for the candidate")
        ahead = WEB + B + AHEAD
        self.assertEqual((self.host.disk, self.host.live), (ahead, ahead))
        self.assertEqual((self.host.disk_owner(), self.host.live_owner()), (A, A))
        self.assertEqual(self.host.socket_mounts, {ahead: self.host.state / "live" / A / "socket"})
        self.assertEqual(self.journals[-1][:2] + self.journals[-1][3:], (ahead, WEB + A, {"candidate_owner": A}))
        self.assertEqual(self.live.created, [])
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertFalse(any(action == "drain" for action, _ in self.host.controls))
        self.assertEqual({call.args for call in self.source.protocol.call_args_list}, {(A,), (B,)})

        journals, pulled = len(self.journals), len(self.pulled)
        self.release.apply(PAIR)  # its own record again while Live stays busy
        self.assertEqual((self.host.disk, len(self.journals)), (ahead, journals))
        self.assertEqual((self.prepared, len(self.pulled)), ([], pulled), "waiting asks the owner and nothing more")

        self.host.idle = "idle"
        self.release.apply(PAIR)
        self.assertEqual(self.prepared, [A])
        self.assertEqual(self.journals[-1][:2] + self.journals[-1][3:], (WEB + B, ahead, {"previous_owner": A}))
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + B, B))
        self.assertEqual(self.live.created, [(WEB + B, SERVICE)])
        self.assertEqual(self.host.socket_mounts[WEB + B], self.host.state / "live" / B / "socket")
        self.assertIn(("drain", WEB + A), self.host.controls)
        self.release.apply(PAIR)
        self.assertEqual(self.live.created, [(WEB + B, SERVICE)], "a paired Web is not released again")

    def test_an_undeclared_malformed_or_different_protocol_keeps_the_pair(self):
        def malformed(sha):
            raise ValueError("not one plain line")

        for protocols in ({A: None, B: 1}, {A: 1, B: None}, {A: 1, B: 2}, None):
            with self.subTest(protocols=protocols):
                self.source.protocol.side_effect = protocols.get if protocols else malformed
                before = dict(self.host.containers)
                self.release.apply(PAIR)
                self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + A, A))
                self.assertEqual(before, self.host.containers)
                self.assertFalse(self.release.transaction.exists())
                self.assertFalse(self.release.failed.exists())

    def test_failure_or_crash_ahead_returns_the_web_and_never_the_account(self):
        def crash():
            raise Crash()

        self.host.on_observe = crash  # after the switch, before the commit
        with self.assertRaises(Crash):
            self.release.apply(PAIR)
        self.assertTrue(self.release.transaction.exists())
        self.host.on_observe = None
        self.release.recover()
        self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + A, WEB + A, A))
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertFalse(self.release.transaction.exists())
        self.host.fail = "observe"
        with self.assertRaises(RuntimeError):
            self.release.apply({**PAIR, "revision": C})
        self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + A, WEB + A, A))
        self.assertTrue(self.release.failed.joinpath(C).exists())
        self.assertFalse(self.host.containers[WEB + C + AHEAD])
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertEqual(self.live.created, [])

    def test_a_held_account_lock_is_not_a_busy_account(self):
        fd = os.open(self.host.lock, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_SH)  # a reader, as the browser's listing holds it
            self.release.apply(PAIR)
        finally:
            os.close(fd)
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + A, A))
        self.assertEqual((self.journals, self.pulled, self.prepared), ([], [], []))
        self.source.protocol.assert_not_called()
        self.assertFalse(self.release.failed.exists())

    def test_live_turning_busy_after_the_owner_answered_idle_keeps_the_pair_for_the_next_tick(self):
        self.host.idle = "idle"
        answers = iter(("idle", "busy"))
        self.host.inspect_hook = lambda: setattr(self.host, "idle", next(answers))
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + A, A))
        self.assertEqual((self.journals, self.live.created), ([], []))
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())
        self.host.inspect_hook = None
        self.release.apply(PAIR)  # still busy: now the Web goes first
        self.assertEqual(self.host.disk, WEB + B + AHEAD)

    def test_a_web_ahead_has_no_control_of_its_own(self):
        for call in (self.live.directory, self.live.name):
            with self.assertRaisesRegex(RuntimeError, "no control of its own"):
                call(WEB + B + AHEAD)

    def test_no_headroom_keeps_the_web_without_a_failure_mark(self):
        self.host.memory_available = lambda: False
        self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + A)
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists())


class AdoptReleaseTests(unittest.TestCase):
    """A candidate that changes the control pairs over a busy account when its control takes over the running
    runners: the same declaration, ADOPT_INSPECT declared, and each busy run's runtime build revision declaring the
    candidate's runner contract (docs/plans/live-continuous-step6-adopt-20261113.zh.md)."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.host = PairHost(Path(directory.name).resolve())
        self.host.idle = "busy"
        self.built = "e" * 40  # the runtime revision the busy run was built from
        self.host.runtimes = [self.built]
        self.source = Mock()
        self.source.agent_changed.return_value = False
        self.source.control_changed.return_value = True
        self.source.protocol.return_value = 1
        self.source.adopts.return_value = True
        self.contracts = {B: 1, C: 1, self.built: 1}
        self.source.runner_contract.side_effect = lambda sha: self.contracts.get(sha)
        self.live = PairLive(self.host, self.source)
        self.release = Release(self.host, self.source, live=self.live)

    def test_a_busy_account_pairs_and_its_runners_pass_to_the_candidate_control(self):
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + B, WEB + B, B))
        self.assertFalse(self.release.transaction.exists())
        self.assertEqual(self.live.created, [(WEB + B, SERVICE)])
        self.assertEqual(self.host.controls, [("start", WEB + B), ("drain", WEB + A)])
        # The owner's control is asked as before; the candidate's lists the runtimes, once to write the
        # transaction and once inside the commit.
        self.assertEqual(list(zip(self.host.inspected, self.host.adopt_flags, strict=True)), [(A, False), (B, True), (B, True)])
        self.assertEqual({call.args for call in self.source.runner_contract.call_args_list}, {(B,), (self.built,)})

    def test_a_different_missing_or_unreadable_runner_contract_lets_only_the_web_go_first(self):
        def unreadable(sha):
            raise ValueError("not one plain line")

        for case in ("different", "no revision", "undeclared", "unreadable"):
            with self.subTest(case=case):
                self.setUp()
                if case == "different":
                    self.contracts[self.built] = 2
                elif case == "no revision":
                    self.host.runtimes = [self.built, None]
                elif case == "undeclared":
                    del self.contracts[self.built]  # a runtime built before RUNNER_CONTRACT
                else:
                    self.source.runner_contract.side_effect = unreadable
                self.release.apply(PAIR)
                self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + B + AHEAD, A))
                self.assertEqual(self.live.created, [])
                self.assertTrue(self.host.containers[LIVE + A])
                self.assertFalse(any(action == "drain" for action, _ in self.host.controls))
                self.assertFalse(self.release.failed.exists())

    def test_without_adopt_inspect_or_with_a_changed_declaration_a_busy_account_needs_idle_as_before(self):
        self.source.adopts.return_value = False  # an older candidate has no --adopt option
        self.release.apply(PAIR)
        self.assertEqual(self.host.disk, WEB + B + AHEAD)
        self.assertNotIn(True, self.host.adopt_flags)
        self.setUp()
        self.live.declared = {**self.live.configs[WEB + A], "research_at": "b" * 32}
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + A, A))
        self.assertEqual(self.host.adopt_flags, [False], "a changed declaration asks the candidate for idle only")
        self.assertFalse(self.release.transaction.exists())

    def test_a_failing_inspection_is_an_unavailable_account_and_fails_no_tick(self):
        self.host.inspect_failure = True
        self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.disk_owner()), (WEB + B + AHEAD, A))
        self.assertFalse(self.release.failed.exists())

    def test_runners_that_cannot_pass_at_commit_roll_back(self):
        self.host.on_observe = lambda: self.contracts.update({self.built: 2})  # after the switch, before the commit
        with self.assertRaises(LiveBusy):
            self.release.apply(PAIR)
        self.assertEqual((self.host.disk, self.host.live, self.host.disk_owner()), (WEB + A, WEB + A, A))
        self.assertTrue(self.host.containers[LIVE + A])
        self.assertFalse(self.host.containers[LIVE + B])
        self.assertFalse(self.release.transaction.exists())
        self.assertTrue(self.release.failed.joinpath(B).exists())


class LiveHostBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / "custody"
        self.root.mkdir(mode=0o700)
        (self.root / "account.lock").touch(mode=0o600)
        self.inputs = [self.base / name for name in ("reader.json", "universe.json")]
        for path in self.inputs:
            path.write_text("{}")
        self.declared = {"format": DECLARATION, "root": str(self.root), "research_ledger": str(self.inputs[0]),
                         "research_at": "a" * 32, "universe_file": str(self.inputs[1]),
                         "sources": [{"source_id": "example"}],
                         "defaults": {}, "memory": "2g", "market_root": str(self.base)}
        self.web = DockerHost(Config(state=self.base / "release"))
        self.web.docker = Mock()
        self.web.requires_live = Mock(return_value=False)
        self.web.pull = Mock(return_value=A)
        self.web.exists = Mock(return_value=False)
        # Owners follow the routes unless a test sets one; the routed Webs mount no socket unless set.
        self.web.disk_owner = lambda: self.web.disk_route().removeprefix(WEB)
        self.web.live_owner = lambda: self.web.live_route().removeprefix(WEB)
        self.web.mounted_sockets = Mock(return_value=set())
        self.source = Mock()
        self.live = LiveHost(self.web, self.source)
        write(self.live.declaration, self.declared)
        self.live.prepare(None, PAIR)

    def test_declaration_has_no_runtime_socket_and_a_change_reaches_only_a_new_control(self):
        value = self.live.snapshot(WEB + B)
        self.assertEqual(value["runtime"], RUNTIME)
        self.assertEqual(value["socket"], str(self.live.socket(WEB + B) / "control.sock"))
        self.assertEqual(value["sources"], [{"source_id": "example"}])
        with patch.object(self.live, "checked") as checked:
            self.live.prepare(B, {**PAIR, "revision": C})
        checked.assert_called_once_with(WEB + B)
        self.web.requires_live.assert_not_called()  # the owner's own Web may be pruned after Web-only releases
        self.assertTrue(self.live.current(B))
        changed = {**self.declared, "research_at": "b" * 32}
        write(self.live.declaration, changed)
        self.assertFalse(self.live.current(B))
        with self.live.barrier(WEB + B) as held:
            held()  # the owner stays inspectable: its custody is unchanged
        with patch.object(self.live, "checked"):
            self.live.prepare(B, {**PAIR, "revision": A})
        self.assertEqual(self.live.snapshot(WEB + A)["research_at"], "b" * 32)
        self.assertEqual(self.live.snapshot(WEB + B)["research_at"], "a" * 32)
        moved = self.base / "moved"
        moved.mkdir(mode=0o700)
        write(self.live.declaration, {**changed, "root": str(moved)})
        with self.assertRaisesRegex(RuntimeError, "custody root changed"):
            self.live.prepare(B, {**PAIR, "revision": C})
        with self.assertRaisesRegex(RuntimeError, "different custody authority"):
            with self.live.barrier(WEB + B):
                pass

    def test_a_snapshot_without_a_control_follows_the_declaration_and_one_with_a_control_is_kept(self):
        changed = {**self.declared, "research_at": "b" * 32}
        write(self.live.declaration, changed)
        self.live.prepare(None, PAIR)  # the earlier attempt at B created no control
        self.assertEqual(self.live.snapshot(WEB + B)["research_at"], "b" * 32)
        write(self.live.declaration, self.declared)
        self.web.exists.return_value = True
        with self.assertRaisesRegex(RuntimeError, "binds different inputs"):
            self.live.prepare(None, PAIR)
        self.assertEqual(self.live.snapshot(WEB + B)["research_at"], "b" * 32)
        write(self.live.declaration, {**self.declared, "runtime": RUNTIME})
        with self.assertRaisesRegex(RuntimeError, "without runtime or socket"):
            self.live.prepare(B, {**PAIR, "revision": C})

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

    def test_the_owner_and_a_control_the_routed_web_mounts_are_never_drained(self):
        self.web.exists.return_value = True
        self.web.disk_route = Mock(return_value=WEB + C)
        self.web.live_route = Mock(return_value=WEB + C)
        running = {"id": "owner-id", "running": True}
        # After a Web-only release the route names Web C and owner B.
        self.web.disk_owner = self.web.live_owner = lambda: B
        with patch.object(self.live, "checked", return_value=running):
            with self.assertRaisesRegex(RuntimeError, "still selected"):
                self.live.drain(WEB + B)
        # A route written without its owner still cannot take STOP away: Web C mounts B's socket.
        self.web.disk_owner = self.web.live_owner = lambda: C
        self.web.mounted_sockets.return_value = {self.live.socket(WEB + B)}
        with patch.object(self.live, "checked", return_value=running):
            with self.assertRaisesRegex(RuntimeError, "still selected"):
                self.live.drain(WEB + B)
        self.web.mounted_sockets.assert_called_with({WEB + C})
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
