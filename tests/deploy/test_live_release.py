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

from deploy.live_host import CONTROL, DECLARATION, LIVE, LiveBusy, LiveHost
from deploy.release import Release
from deploy.release_host import AGENT, RUNTIME_REF, SERVICE_REF, SOURCE, WEB, Config, DockerHost, route_config
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
            if self.inspect_hook:
                self.inspect_hook()
            return json.dumps({"state": self.idle})
        raise AssertionError(args)

    def persist_route(self, name):
        self.assert_locked()
        super().persist_route(name)


class PairLive(LiveHost):
    """Only container machinery is doubled; the production fd/lock/idle boundary is exercised."""
    def __init__(self, host, source):
        super().__init__(host, source)
        self.configs = {WEB + A: {"root": str(host.lock.parent)}}
        self.created = []
        self.health_failure = False

    def prepare(self, previous, target):
        self.source.require_runtime(A, target["revision"])
        self.configs[WEB + target["revision"]] = {"root": str(self.web.lock.parent)}

    def snapshot(self, name):
        return self.configs[name]

    def common(self, name, helper=False):
        return []

    def checked(self, name):
        return {"image": SERVICE, "running": self.web.containers[self.name(name)]}

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
        self.live.configs[WEB + B] = {"root": str(self.host.lock.parent)}
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
        self.live.configs[WEB + B] = {"root": str(self.host.lock.parent)}
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


class LiveHostBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.root = self.base / "custody"
        self.root.mkdir(mode=0o700)
        (self.root / "account.lock").touch(mode=0o600)
        self.inputs = [self.base / name for name in ("reader.json", "universe.json", "source.py")]
        for path in self.inputs:
            path.write_text("{}")
        self.declared = {"format": DECLARATION, "root": str(self.root), "research_ledger": str(self.inputs[0]),
                         "research_at": "a" * 32, "universe_file": str(self.inputs[1]), "symbols": ["BTCUSDT"],
                         "sources": [{"strategy_file": str(self.inputs[2]), "single_order_source_reviewed": False}],
                         "defaults": {}, "memory": "2g"}
        self.web = DockerHost(Config(state=self.base / "release"))
        self.web.docker = Mock()
        self.web.requires_live = Mock(return_value=False)
        self.web.pull_execution = Mock(return_value=A)
        self.web.exists = Mock(return_value=False)
        self.source = Mock()
        self.live = LiveHost(self.web, self.source)
        write(self.live.declaration, self.declared)
        self.live.prepare(WEB + A, PAIR)

    def test_declaration_has_no_runtime_socket_and_committed_values_cannot_be_overridden(self):
        value = self.live.snapshot(WEB + B)
        self.assertEqual(value["runtime"], RUNTIME)
        self.assertEqual(value["socket"], str(self.live.socket(WEB + B) / "control.sock"))
        self.assertIs(value["sources"][0]["single_order_source_reviewed"], False)
        self.web.requires_live.return_value = True
        with patch.object(self.live, "checked"):
            self.live.prepare(WEB + B, {**PAIR, "revision": C})
        changed = {**self.declared, "research_at": "b" * 32}
        write(self.live.declaration, changed)
        with self.assertRaisesRegex(RuntimeError, "operator inputs changed"):
            self.live.prepare(WEB + B, {**PAIR, "revision": C})
        write(self.live.declaration, {**self.declared, "runtime": RUNTIME})
        with self.assertRaisesRegex(RuntimeError, "without runtime or socket"):
            self.live.prepare(WEB + B, {**PAIR, "revision": C})

    def test_control_and_inspector_mount_scopes_and_immutable_image_pair(self):
        self.web.pull_execution.assert_any_call(SERVICE, SERVICE_REF, B)
        self.web.pull_execution.assert_any_call(RUNTIME, RUNTIME_REF)
        self.source.require_runtime.assert_called_once_with(A, B)
        with patch("deploy.live_host.DOCKER_SOCKET", self.root / "account.lock"), patch.object(self.live, "checked"):
            self.live.create(WEB + B, SERVICE)
            control = self.web.docker.call_args.args
            inspector = self.live.common(WEB + B, helper=True)
        self.assertIn(f"type=bind,src={self.root},dst={self.root}", control)
        self.assertIn(f"type=bind,src={self.root},dst={self.root},readonly", inspector)
        self.assertIn(f"type=bind,src={self.live.state},dst={self.live.state},readonly", control)
        self.assertIn(f"type=bind,src={self.live.socket(WEB + B)},dst={self.live.socket(WEB + B)}", control)
        self.assertNotIn(self.web.config.frontend, control)
        self.assertNotIn("--publish", control)
        self.assertIn(SERVICE, control)
        self.assertIn("--release-web", control)

    def test_execution_image_admission_checks_actual_platform_source_revision_and_digest(self):
        image = {"Architecture": "amd64", "RepoDigests": [SERVICE], "Config": {"Labels": {
            "org.opencontainers.image.revision": B, "org.opencontainers.image.source": SOURCE}}}
        host = DockerHost(self.web.config)
        host.docker = Mock(side_effect=lambda *args, **kwargs: json.dumps(image) if args[0] == "image" else "")
        self.assertEqual(host.pull_execution(SERVICE, SERVICE_REF, B), B)
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
                    host.pull_execution(SERVICE, SERVICE_REF, B)

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
            self.live.prepare(WEB + A, PAIR)
        path.rmdir()
        path.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "private release binding"):
            self.live.prepare(WEB + A, PAIR)

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

    def test_identity_change_between_retirement_checks_cannot_signal_replacement(self):
        self.web.exists.return_value = True
        self.web.disk_route = Mock(return_value=WEB + C)
        self.web.live_route = Mock(return_value=WEB + C)
        with patch.object(self.live, "checked", side_effect=[{"id": "old", "running": True},
                                                            {"id": "new", "running": True}]):
            with self.assertRaisesRegex(RuntimeError, "identity changed"):
                self.live.drain(WEB + B)
        self.web.docker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
