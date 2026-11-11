"""Fault injection uses stand-ins and temporary release state; no ledger or native run is modified."""

from contextlib import contextmanager
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from deploy.paper_host import PAPER, PaperHost, route_config, route_name
from deploy.paper_release import PaperRelease
from deploy.release_host import LEDGER, Config

A, B, C = (letter * 40 for letter in "abc")
TARGET = {
    "revision": B,
    "service": "ghcr.io/qoeop/trade-service@sha256:" + "e" * 64,
    "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64,
}


class Crash(BaseException):
    pass


class Host:
    def __init__(self, root):
        self.state = root
        self.disk = self.live = route_config(PAPER + A)
        self.running = {PAPER + A: True}
        self.calls = []
        self.locked = False
        self.failure = None
        self.web = Mock()
        self.web.disk_route.return_value = "trade-release-web-" + B
        self.web.observe.side_effect = self.observe

    def exists(self, name):
        return name in self.running

    def checked(self, name):
        return self.inspect(name)

    def inspect(self, name):
        return {"running": self.running[name], "image": TARGET["service"]}

    def disk_route(self):
        return route_name(self.disk)

    def live_route(self):
        return route_name(self.live)

    def memory_available(self):
        return True

    def protected(self):
        return {"native-runner": {"id": "same", "started": "same", "image": "original"}}

    def ensure_protected(self, before):
        assert before == self.protected()

    def pull(self, *args):
        return A

    def known(self, names):
        if self.disk_route() not in names or self.live_route() not in names:
            raise RuntimeError("independent change")

    def pending(self, candidate, previous):
        self.known({candidate, previous})
        if route_config(candidate) in (self.live, self.disk):
            raise RuntimeError("independent unfreeze")

    def phase(self, name, live_freeze, disk_freeze):
        if self.live != route_config(name, live_freeze) or self.disk != route_config(name, disk_freeze):
            raise RuntimeError("independent change during handoff")

    def create(self, name, *args):
        self.running[name] = False

    def start(self, name):
        assert name.startswith(PAPER)
        self.running[name] = True

    def stop(self, name):
        assert self.locked, "must drain acknowledged lifecycle operations before stopping the controller"
        assert name.startswith(PAPER), "never stop a strategy"
        self.calls.append(("stop", name))
        self.running[name] = False

    def warm(self, name, protected):
        if self.failure == "warm" and name == PAPER + B:
            raise RuntimeError("incompatible old format")

    def compatible(self, name):
        pass

    def switch(self, name, freeze=None):
        self.live = route_config(name, freeze)
        self.calls.append(("switch", name, freeze))
        if self.failure == "crash" and name == PAPER + B:
            raise Crash()

    def persist_route(self, name, freeze=None):
        self.disk = route_config(name, freeze)

    def normalize(self):
        self.known({self.disk_route()})
        self.live = self.disk = route_config(self.disk_route())

    def health(self, name):
        assert self.running[name]

    def observe(self, *args):
        assert self.live == route_config(PAPER + B, "starts"), "new runtime starts must wait until commit"
        if self.failure == "observe":
            raise RuntimeError("bad observation")

    @contextmanager
    def barrier(self, service):
        self.locked = True

        def held():
            assert self.locked
            self.calls.append(("held",))
            if self.failure == "lock":
                raise RuntimeError("lock lost")

        try:
            yield held
        finally:
            self.locked = False


class PaperReleaseTests(unittest.TestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.host = Host(Path(root.name))
        self.source = Mock()
        self.source.ancestor.return_value = True
        self.release = PaperRelease(self.host, self.source)

    def test_success_drains_controller_only_and_unfreezes_starts_after_commit(self):
        before = self.host.protected()
        self.release.apply(TARGET)
        self.assertEqual(self.host.live, route_config(PAPER + B))
        self.assertFalse(self.host.running[PAPER + A])
        self.assertTrue(self.host.running[PAPER + B])
        self.assertFalse(self.release.transaction.exists())
        self.assertEqual(self.host.protected(), before)
        self.assertIn(("switch", PAPER + A, "all"), self.host.calls)
        self.assertGreater(sum(c[0] == "held" for c in self.host.calls), 1)
        self.source.require_runtime.assert_called_once_with(A, B)

    def test_mismatched_retained_pair_is_refused_before_handoff_or_candidate_creation(self):
        before = self.host.protected()
        self.source.require_runtime.side_effect = RuntimeError("runtime build inputs differ")
        with self.assertRaisesRegex(RuntimeError, "build inputs"):
            self.release.apply(TARGET)
        self.source.require_runtime.assert_called_once_with(A, B)
        self.assertEqual(self.host.running, {PAPER + A: True})
        self.assertEqual(self.host.live, route_config(PAPER + A))
        self.assertEqual(self.host.calls, [])
        self.assertFalse(self.release.transaction.exists())
        self.assertEqual(self.host.protected(), before)

    def test_pre_and_post_cutover_failures_restore_previous_without_new_runtime_starts(self):
        for failure in ("warm", "observe"):
            with self.subTest(failure=failure):
                self.setUp()
                self.host.failure = failure
                with self.assertRaises(RuntimeError):
                    self.release.apply(TARGET)
                self.assertEqual(self.host.live, route_config(PAPER + A))
                self.assertTrue(self.host.running[PAPER + A])
                self.assertFalse(self.host.running[PAPER + B])
                self.assertTrue((self.release.failed / B).exists())
                self.assertFalse(self.release.transaction.exists())

    def test_crash_keeps_frozen_starts_until_recovery(self):
        self.host.failure = "crash"
        with self.assertRaises(Crash):
            self.release.apply(TARGET)
        self.assertTrue(self.release.transaction.exists())
        self.assertEqual(self.host.disk, route_config(PAPER + B, "starts"))
        self.host.failure = None
        self.release.recover()
        self.assertEqual(self.host.live, route_config(PAPER + A))
        self.assertFalse(self.release.transaction.exists())

    def test_unknown_route_and_lost_barrier_preserve_transaction(self):
        self.host.failure = "crash"
        with self.assertRaises(Crash):
            self.release.apply(TARGET)
        self.host.live = route_config(PAPER + C)
        with self.assertRaisesRegex(RuntimeError, "independent"):
            self.release.recover()
        self.assertTrue(self.release.transaction.exists())
        self.setUp()
        self.host.failure = "lock"
        with self.assertRaisesRegex(RuntimeError, "lock lost"):
            self.release.apply(TARGET)
        self.assertTrue(self.host.running[PAPER + A])
        self.assertTrue(self.release.transaction.exists())

    def test_commit_before_unfreeze_is_repaired_without_rolling_back_a_new_runtime(self):
        self.host.live = self.host.disk = route_config(PAPER + B, "starts")
        self.host.running[PAPER + B] = True
        self.release.recover()
        self.assertEqual(self.host.disk, route_config(PAPER + B))
        self.assertFalse(any(c[0] == "stop" for c in self.host.calls))

    def test_independent_route_change_during_compatibility_check_is_not_overwritten(self):
        self.host.compatible = lambda _: setattr(self.host, "live", route_config(PAPER + C))
        with self.assertRaisesRegex(RuntimeError, "independent"):
            self.release.apply(TARGET)
        self.assertEqual(self.host.live, route_config(PAPER + C))
        self.assertTrue(self.host.running[PAPER + A])
        self.assertFalse(any(call[0] == "stop" for call in self.host.calls))
        self.assertTrue(self.release.transaction.exists())

    def test_uncommitted_candidate_independently_unfrozen_must_not_be_stopped_or_rolled_back(self):
        self.host.failure = "crash"
        with self.assertRaises(Crash):
            self.release.apply(TARGET)
        self.host.live = route_config(PAPER + B)
        before = list(self.host.calls)
        with self.assertRaisesRegex(RuntimeError, "independent unfreeze"):
            self.release.recover()
        self.assertEqual(self.host.calls, before)
        self.assertTrue(self.host.running[PAPER + B])
        self.assertTrue(self.release.transaction.exists())

    def test_real_boundary_rejects_all_native_strategy_names(self):
        host = PaperHost(Config())
        host.docker = Mock()
        for name in ("trade-paper-x-3-runner", "trade-paper-x-3-egress", "trade-ide-ledger-1"):
            with self.assertRaises(RuntimeError):
                host.stop(name)
        host.docker.assert_not_called()

    def test_controllers_take_the_ledgers_numeric_user(self):
        host = PaperHost(Config())
        host.docker = Mock(return_value="1000:1000")
        common = host.common()
        self.assertEqual(common[:2], ["--user", "1000:1000"])
        host.docker.assert_called_once_with("inspect", "--format", "{{.Config.User}}", LEDGER)
        host.docker.return_value = "root"
        with self.assertRaisesRegex(RuntimeError, "numeric unprivileged"):
            host.common()

    def test_controllers_get_the_deployments_paper_memory_budget_only_when_set(self):
        for memory, expected in (("4g", ["TRADE_PAPER_MEMORY=4g"]), ("", [])):
            with self.subTest(memory=memory), tempfile.TemporaryDirectory() as root:
                host = PaperHost(Config(state=Path(root), paper_memory=memory))
                host.docker = Mock(return_value="1000:1000")
                host.exists = Mock(return_value=False)
                host.create(PAPER + B, TARGET["service"], TARGET["runtime"])
                create = next(call.args for call in host.docker.call_args_list if call.args[0] == "create")
                env = [create[i + 1] for i, arg in enumerate(create) if arg == "--env"]
                self.assertEqual([value for value in env if value.startswith("TRADE_PAPER_MEMORY=")], expected)
