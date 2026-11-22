"""Deployment control tests use temporary files and stand-ins, never an active ledger or engine."""

from contextlib import contextmanager, redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from deploy.live_host import LIVE, LiveBusy
from deploy.notices import Notices
from deploy import release
from deploy.release import FOLLOW_RETRY_SECONDS, Release, failure_summary
from deploy.source import GitSource
from deploy.paper_host import CONTROLLER_PROBE, PAPER, PaperHost
from deploy.paper_host import route_config as paper_route
from deploy.paper_release import PaperRelease
from deploy.release_host import (AGENT, DEFINITION, DOCKER_API, DOCKER_API_REF, KEPT_RELEASES, LEDGER, MARKET_IMPORT, WEB, Config,
                                 PROBE, DockerHost, ReaderFailure, Registry,
                                 moment, revision, route_config, route_name)
from tests.deploy.test_paper_release import Host as PaperStandIn

# The keys of a `line list` entry DockerHost.lines reads besides `candidates` (graph.line_list), written out: the
# release controller's tests run on the host's system Python, which cannot import the ledger.
# tests/ledger/test_lines.py holds them within ledger.lines.LISTED.
HOST_LINE_KEYS = ("name", "created_at")


A, B, C, D = (letter * 40 for letter in "abcd")
TARGET = {"revision": B, "image": "ghcr.io/qoeop/trade-ide@sha256:" + "e" * 64,
          "service": "ghcr.io/qoeop/trade-service@sha256:" + "e" * 64,
          "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "e" * 64}


class Crash(BaseException):
    pass


def paper_release(web):
    """The real Paper side of a release over a stand-in controller host that shares the Web's state directory
    and reads the Web's route, as PaperHost does on the host."""
    host = PaperStandIn(web.state)
    host.web = web
    return PaperRelease(host, Mock())


class IdleLive:
    """A Live control that is always idle; every release pairs one (tests/deploy/test_live_release.py covers it)."""

    def __init__(self, host):
        self.host = host

    def current(self, owner):
        return True

    def prepare(self, owner, target):
        pass

    @contextmanager
    def barrier(self, name, service=None, *, idle=False, wait_for_lock=False):
        yield lambda: None

    def create(self, *args):
        pass

    start = warm = health = restore = create

    def socket(self, name):
        return self.host.state / "live" / revision(name) / "socket"

    def stop_others(self, kept):
        pass

    def runtimes(self):
        return set()

    def prune(self, kept):
        pass


class Host:
    def __init__(self, state):
        self.state = state
        self.routes = state / DockerHost.ROUTES
        self.disk = self.live = WEB + A
        self.containers = {WEB + A: True, AGENT + D: True}
        self.calls = []
        self.fail = None
        self.rollback_fails = False
        self.protected_identity = {"paper-worker": {"id": "original", "started": "original"}}

    def prepare(self):
        pass

    def checked(self, name, prefix=WEB):
        revision(name, prefix)
        return self.inspect(name)

    def inspect(self, name):
        return {
            "running": self.containers[name],
            "revision": name.rsplit("-", 1)[-1],
            "image": TARGET["image"],
        }

    def exists(self, name):
        return name in self.containers

    def managed(self, prefix, running_only=False):
        return [
            name
            for name, running in self.containers.items()
            if name.startswith(prefix) and (running or not running_only)
        ]

    def agent(self):
        names = [name for name, running in self.containers.items() if running and name.startswith(AGENT)]
        if len(names) > 1:
            raise AssertionError("two Agent writers")
        return names[0] if names else None

    def protected(self):
        return json.loads(json.dumps(self.protected_identity))

    def ensure_protected(self, before):
        assert self.protected() == before

    def memory_available(self):
        return True

    def disk_route(self):
        return self.disk

    def live_route(self):
        return self.live

    def pull(self, reference, pattern, sha=None):
        if getattr(self, "on_pull", None):
            self.on_pull()
        return sha

    def definition(self, service, sha):
        return []

    def create(self, name, image, agent=False, live_socket=None):
        if name in self.containers:
            raise RuntimeError("retained identity is not reusable")
        self.calls.append(("create", name))
        self.containers[name] = False

    def start(self, name):
        self.calls.append(("start", name))
        self.containers[name] = True
        self.agent()  # assert the single-writer invariant at every process transition

    def stop(self, name):
        self.calls.append(("stop", name))
        if name.startswith(AGENT):
            assert (self.state / "transaction.json").exists(), "must journal before any Agent mutation"
        self.containers[name] = False

    def lines(self, name):
        return ["active-paper-line"]

    def warm(self, name, protected):
        if getattr(self, "on_warm", None):
            self.on_warm(name)
        if self.fail == "warm" and name == WEB + B:
            raise RuntimeError("bad candidate")
        if self.fail == "protected" and name == WEB + B:
            raise RuntimeError("protected identity changed")
        return self.lines(name)

    def health(self, name, lines, routed=False):
        pass

    def auth_denied(self):
        pass

    def switch(self, name):
        self.calls.append(("route", name))
        if self.rollback_fails and name == WEB + A:
            raise RuntimeError("router unavailable")
        self.live = name
        if self.fail == "crash" and name == WEB + B:
            raise Crash()

    def persist_route(self, name):
        self.disk = name

    def observe(self, name, lines, protected):
        if getattr(self, "on_observe", None):
            self.on_observe()
        if self.fail == "observe":
            raise RuntimeError("failed after switch")


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = Host(Path(temporary.name))
        self.github = Mock()
        self.github.agent_changed.return_value = True
        self.release = Release(self.host, self.github, live=IdleLive(self.host), paper=paper_release(self.host))

    def test_success_switches_only_after_readiness_and_commits_disk_route(self):
        before = self.host.protected()
        running = []
        self.host.on_observe = lambda: running.append(self.host.containers[WEB + A])
        self.release.apply(TARGET)
        self.assertEqual(self.host.live, WEB + B)
        self.assertEqual(self.host.disk, WEB + B)
        self.assertFalse(self.release.transaction.exists())
        self.assertEqual(running, [True], "keep the previous Web alive during observation")
        self.assertFalse(self.host.containers[WEB + A], "stop the previous Web once the candidate committed")
        self.assertEqual(self.host.agent(), AGENT + B)
        self.assertEqual(self.host.protected(), before)
        self.assertTrue(all(name.startswith((WEB, AGENT)) for _, name in self.host.calls))

    def test_failure_before_or_after_switch_restores_agent_and_web_and_blocks_retry(self):
        for failure in ("warm", "observe", "protected"):
            with self.subTest(failure=failure):
                self.setUp()
                self.host.fail = failure
                with self.assertRaises(RuntimeError):
                    self.release.apply(TARGET)
                self.assertEqual(self.host.disk, WEB + A)
                self.assertEqual(self.host.live, WEB + A)
                self.assertEqual(self.host.agent(), AGENT + D, "old Agent need not have the previous Web revision")
                self.assertFalse(self.host.containers[WEB + B])
                self.assertTrue((self.release.failed / B).exists())
                self.assertFalse(self.release.transaction.exists())
                with self.assertRaisesRegex(RuntimeError, "blocked"):
                    self.release.apply(TARGET)

    def test_crash_after_switch_keeps_journal_and_restart_recovers_both_planes(self):
        self.host.fail = "crash"
        with self.assertRaises(Crash):
            self.release.apply(TARGET)
        journal = json.loads(self.release.transaction.read_text())
        self.assertEqual(journal, {"candidate": WEB + B, "previous": WEB + A, "agent_before": AGENT + D})
        self.assertEqual(self.host.live, WEB + B)
        self.assertEqual(self.host.disk, WEB + A)
        self.host.fail = None
        Release(self.host, self.github, live=self.release.live, paper=self.release.paper()).recover()
        self.assertEqual((self.host.disk, self.host.live, self.host.agent()), (WEB + A, WEB + A, AGENT + D))
        self.assertFalse(self.release.transaction.exists())

    def test_crash_after_disk_commit_but_before_journal_removal_rolls_back_conservatively(self):
        self.release.journal(WEB + B, WEB + A)
        self.host.containers[WEB + B] = True
        self.host.disk = self.host.live = WEB + B
        self.release.recover()
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))

    def test_failed_rollback_or_independent_route_change_preserves_journal_and_candidate(self):
        self.release.journal(WEB + B, WEB + A)
        self.host.containers[WEB + B] = True
        self.host.live = WEB + B
        self.host.rollback_fails = True
        with self.assertRaisesRegex(RuntimeError, "router unavailable"):
            self.release.recover()
        self.assertTrue(self.release.transaction.exists())
        self.assertTrue(self.host.containers[WEB + B])
        self.host.live = WEB + C
        before = list(self.host.calls)
        with self.assertRaisesRegex(RuntimeError, "independent change"):
            self.release.recover()
        self.assertEqual(self.host.calls, before)

    def test_web_only_update_does_not_touch_agent(self):
        self.github.agent_changed.return_value = False
        self.release.apply(TARGET)
        self.assertEqual(self.host.agent(), AGENT + D)
        self.assertFalse(any(name.startswith(AGENT) for _, name in self.host.calls))

    def test_independent_agent_replacement_during_image_pull_is_not_overwritten(self):
        def replace():
            self.host.containers[AGENT + D] = False
            self.host.containers[AGENT + C] = True

        self.host.on_pull = replace
        with self.assertRaisesRegex(RuntimeError, "independent change"):
            self.release.apply(TARGET)
        self.assertEqual(self.host.agent(), AGENT + C)
        self.assertFalse(self.host.containers[AGENT + B])
        self.assertTrue(self.release.transaction.exists())

    def test_independent_routes_during_recovery_warmup_or_final_observation_are_preserved(self):
        self.release.journal(WEB + B, WEB + A)
        self.host.containers[WEB + B] = True
        self.host.live = WEB + B
        self.host.on_warm = lambda _: setattr(self.host, "live", WEB + C)
        with self.assertRaisesRegex(RuntimeError, "independent change"):
            self.release.recover()
        self.assertEqual(self.host.live, WEB + C)
        self.assertTrue(self.release.transaction.exists())
        self.setUp()
        self.host.on_observe = lambda: setattr(self.host, "live", WEB + C)
        with self.assertRaisesRegex(RuntimeError, "independent change"):
            self.release.apply(TARGET)
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + C))
        self.assertTrue(self.release.transaction.exists())

    def test_withdrawal_during_warmup_rolls_back_before_switch(self):
        self.github.ensure.side_effect = [None, None, RuntimeError("eligibility withdrawn")]  # after the journal
        with self.assertRaisesRegex(RuntimeError, "withdrawn"):
            self.release.apply(TARGET)
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertNotIn(("route", WEB + B), self.host.calls)
        self.assertEqual(self.host.agent(), AGENT + D)


class JointReleaseTests(unittest.TestCase):
    """A version moves Web and the Paper controller together or neither (doctor 20261114-19): 0.x keeps no
    compatibility between versions, so Web N never settles beside a Paper controller N-1."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = Host(Path(temporary.name))
        self.github = Mock()
        self.github.agent_changed.return_value = True
        self.release = Release(self.host, self.github, live=IdleLive(self.host), paper=paper_release(self.host))
        self.paper = self.release.paper()
        self.controller = self.paper.host

    def settled(self, version):
        self.assertEqual((self.host.disk, self.host.live), (WEB + version, WEB + version))
        self.assertEqual((self.controller.disk, self.controller.live), (paper_route(PAPER + version),) * 2)
        self.assertTrue(self.controller.running[PAPER + version])
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.paper.transaction.exists())

    def test_a_version_commits_web_and_the_paper_controller(self):
        self.release.apply(TARGET)
        self.settled(B)
        self.assertFalse(self.controller.running[PAPER + A])
        self.assertEqual(self.host.agent(), AGENT + B)
        self.assertFalse(self.release.failed.exists())

    def test_the_web_warms_and_observes_against_the_paper_controller_of_its_version(self):
        seen = []
        self.host.on_warm = lambda name: seen.append(self.controller.live)
        self.host.on_observe = lambda: seen.append(self.controller.live)
        self.release.apply(TARGET)
        self.assertEqual(seen, [paper_route(PAPER + B, "starts")] * 2, "new starts wait for the commit")

    def test_a_paper_failure_rolls_the_web_back_and_marks_the_version_failed(self):
        self.controller.failure = "warm"
        with self.assertRaisesRegex(RuntimeError, "never became ready"):
            self.release.apply(TARGET)
        self.settled(A)
        self.assertFalse(self.controller.running[PAPER + B])
        self.assertFalse(self.host.containers[WEB + B])
        self.assertEqual(self.host.agent(), AGENT + D)
        self.assertTrue((self.release.failed / B).exists())
        self.assertFalse((self.host.state / "paper-failed").exists(), "one marker per version")

    def test_a_web_failure_after_the_paper_switch_rolls_the_paper_controller_back(self):
        for failure in ("warm", "observe", "protected"):
            with self.subTest(failure=failure):
                self.setUp()
                self.host.fail = failure
                with self.assertRaises(RuntimeError):
                    self.release.apply(TARGET)
                self.assertIn(("switch", PAPER + B, "starts"), self.controller.calls)
                self.settled(A)
                self.assertFalse(self.controller.running[PAPER + B])
                self.assertTrue((self.release.failed / B).exists())

    def test_a_crash_after_the_web_commit_rolls_the_paper_controller_forward(self):
        with patch.object(PaperRelease, "commit", side_effect=Crash()), self.assertRaises(Crash):
            self.release.apply(TARGET)
        self.assertEqual(self.host.disk, WEB + B)
        self.assertFalse(self.release.transaction.exists())
        self.assertTrue(self.paper.transaction.exists())
        self.assertEqual(self.controller.disk, paper_route(PAPER + B, "starts"))
        Release(self.host, self.github, live=self.release.live, paper=self.paper).recover()
        self.settled(B)
        self.assertFalse(self.release.failed.exists())

    def test_a_crash_before_the_web_journal_is_removed_rolls_both_back(self):
        clear = self.release.clear
        self.release.clear = Mock(side_effect=Crash())
        with self.assertRaises(Crash):
            self.release.apply(TARGET)
        self.assertEqual(self.host.disk, WEB + B, "Web's route is on disk, its journal still open")
        self.release.clear = clear
        self.release.recover()
        self.settled(A)
        self.assertTrue((self.release.failed / B).exists())

    def test_a_paper_refusal_before_the_journal_changes_nothing_and_marks_nothing_failed(self):
        def low_memory():
            self.controller.memory_available = lambda: False

        def mismatched_runtime():
            self.paper.source.require_runtime.side_effect = RuntimeError("runtime build inputs differ")

        def low_web_memory():
            self.host.memory_available = lambda: False

        summaries = {low_memory: "host memory below the 2 GiB a standby Paper controller needs; the release waits",
                     low_web_memory: "host memory below the 2 GiB a candidate Web needs; the release waits"}
        for refuse in (low_memory, mismatched_runtime, low_web_memory):
            with self.subTest(refusal=refuse.__name__):
                self.setUp()
                refuse()
                with self.assertRaises(RuntimeError) as raised:
                    self.release.apply(TARGET)
                if refuse in summaries:  # what the tick's notice says (doctor 20261116-05)
                    self.assertEqual(failure_summary(raised.exception), summaries[refuse])
                self.settled(A)
                self.assertNotIn(WEB + B, self.host.containers)
                self.assertNotIn(PAPER + B, self.controller.running)
                self.assertFalse(self.release.failed.exists())


class GenerationTests(unittest.TestCase):
    """Doctor 20261122-30: a version whose code does not read the host ledger's schema generation warmed for 30
    minutes, rolled back and wrote failed/<revision>; the owner's ledger move could never release it."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = Host(Path(temporary.name))
        self.github = Mock()
        self.github.agent_changed.return_value = True
        self.release = Release(self.host, self.github, live=IdleLive(self.host), paper=paper_release(self.host))
        self.controller = self.release.paper().host

    def test_a_version_that_does_not_read_the_host_ledger_waits_before_its_journal(self):
        self.controller.unread = {"research": "2"}
        self.release.apply(TARGET)
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertNotIn(WEB + B, self.host.containers)
        self.assertNotIn(PAPER + B, self.controller.running)
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.failed.exists(), "a host condition, not a failed version")
        [(key, text)] = self.release.waits.items()
        self.assertEqual(key, f"wait:generation:{B}:research")
        self.assertIn("the research database (its code reads generation 2)", text)
        self.assertIn("A version that needs a new ledger generation", text)
        self.controller.unread = {}  # the owner moved the host to the new generation
        self.release.apply(TARGET)
        self.assertEqual(self.host.disk, WEB + B)

    def test_the_tick_sends_the_wait_once_and_clears_it_when_the_version_releases(self):
        sent = []
        notices = Notices(self.host.state, call=lambda token, method, body: sent.append(body["text"]),
                                  log=lambda line: None)
        notices._token = lambda: ("token", 1)
        waits = [{"wait:generation:x:research": "waits"}, {"wait:generation:x:research": "waits"}, {}]

        def tick(self):
            self.waits = waits.pop(0)
            return False

        self.host.condition = Mock(return_value=None)
        with patch.object(Release, "tick", tick), patch.object(release, "drift", return_value={}), \
                patch.object(Notices, "watch"):
            for _ in range(3):
                release.tick(self.host, notices)
        self.assertEqual(sent, ["waits"], "sent once while it lasts")
        self.assertEqual(notices.found["wait"], {})


class InstallTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = Host(Path(temporary.name))
        self.host.containers = {}
        self.github = Mock()
        self.github.approved.return_value = TARGET
        self.paper = Mock(spec=PaperHost)  # a spec: an attribute PaperHost lacks fails here, as on a host
        self.paper.routes = self.host.state / PaperHost.ROUTES
        self.paper.pull.return_value = B
        patcher = patch.object(Release, "paper", return_value=Mock(host=self.paper))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.live = Mock()
        self.live.socket.side_effect = IdleLive(self.host).socket
        self.release = Release(self.host, self.github, live=self.live)

    def test_a_new_host_gets_the_admitted_builds_controller_live_control_web_and_agent_with_routes(self):
        order = []
        self.paper.persist_route.side_effect = lambda name: order.append(("paper route", name))
        self.paper.create.side_effect = lambda name, *args: order.append(("paper create", name))
        self.paper.start.side_effect = lambda name: order.append(("paper start", name))
        for step in ("prepare", "create", "start", "warm"):
            getattr(self.live, step).side_effect = lambda *args, step=step: order.append((f"live {step}", *args))
        created = self.host.create

        def create(name, image, agent=False, live_socket=None):
            order.append(("create", name, live_socket))
            created(name, image, agent, live_socket)

        self.host.create = create
        self.host.start = lambda name: order.append(("start", name)) or self.host.containers.update({name: True})
        self.release.install()
        socket = self.host.state / "live" / B / "socket"
        self.assertEqual(order, [("live prepare", None, TARGET),  # creates the custody root
                                 ("paper route", PAPER + B), ("paper create", PAPER + B),
                                 ("live create", WEB + B, TARGET["service"]), ("create", WEB + B, socket),
                                 ("create", AGENT + B, None), ("paper start", PAPER + B),
                                 ("live start", WEB + B), ("live warm", WEB + B),
                                 ("start", WEB + B), ("start", AGENT + B)],
                         "the controller reads its own route to know it is active; the Web reaches a ready control")
        self.paper.create.assert_called_once_with(PAPER + B, TARGET["service"], TARGET["runtime"])
        self.github.require_runtime.assert_called_once_with(B, B)
        self.assertEqual(self.host.containers, {WEB + B: True, AGENT + B: True})
        self.assertEqual(self.host.disk, WEB + B)

    def test_install_refuses_an_installed_host_or_an_unadmitted_build(self):
        (self.host.state / "router").mkdir()
        (self.host.state / "router" / "active.json").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.release.install()
        (self.host.state / "router" / "active.json").unlink()
        self.paper.routes.mkdir()
        (self.paper.routes / "active.json").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.release.install()
        (self.paper.routes / "active.json").unlink()
        self.github.approved.return_value = {**TARGET, "image": None, "service": None, "runtime": None}
        with self.assertRaisesRegex(RuntimeError, "not admitted"):
            self.release.install()
        self.assertEqual(self.host.calls, [])
        self.paper.create.assert_not_called()
        self.live.prepare.assert_not_called()


class FakeDocker(DockerHost):
    """Answers the commands prune issues; the real Docker refusal for a used image is modelled too."""

    def __init__(self, rows, images, used):
        super().__init__(Config(state=Path("/nonexistent")))
        self.rows, self.images, self.used, self.calls = rows, images, used, []

    def docker(self, *args, check=True, timeout=120):
        self.calls.append(args)
        if args[0] == "ps" and "--no-trunc" in args:
            return "\n".join(self.used)
        if args[0] == "ps":
            return "\n".join(self.rows)
        if args[0] == "inspect":
            return json.dumps(self.rows[args[-1]])
        if args[0] == "images":
            return "\n".join(self.images)
        if args[:2] == ("image", "rm") or args[0] == "rm":
            return ""
        raise AssertionError(args)

    def removed(self):
        return [call[1] for call in self.calls if call[0] == "rm"]

    def removed_images(self):
        return [call[2] for call in self.calls if call[:2] == ("image", "rm")]


class ProtectedTests(unittest.TestCase):
    def host(self, names):
        host = DockerHost(Config(state=Path("/nonexistent")))

        def docker(*args, check=True, timeout=120):
            if args[0] == "ps":
                return "" if "--filter" in args else "\n".join(names)
            if args[0] == "inspect" and args[-1] in names:
                return json.dumps({"id": args[-1], "running": True, "started": "t", "oom": False, "restarts": 0})
            raise RuntimeError(f"docker {args[0]} failed: no such object")

        host.docker = docker
        return host

    def test_the_ledger_and_docker_api_are_protected_and_required(self):
        services = ["trade-ide-ledger-1", "trade-ide-docker-api-1"]
        self.assertEqual(sorted(self.host(services).protected()), sorted(services))
        with self.assertRaises(RuntimeError):  # the ledger and docker-api stay required
            self.host(["trade-ide-docker-api-1"]).protected()


class GenerationCheckTests(unittest.TestCase):
    """PaperHost.generations runs the candidate's own read-only `ledger service check` on each database."""

    def host(self, answers):
        host = PaperHost(Config(state=Path("/nonexistent")))
        host.runs = []

        def docker(*args, check=True, timeout=120, env=None):
            if args[0] == "inspect":
                return "1000:1000"  # the ledger's service identity (PaperHost.common)
            assert args[0] == "run"
            host.runs.append(args)
            answer = answers[args[-1]]
            if answer is not None:
                raise release.DockerFailure("run", 1, "Traceback?\n" + json.dumps(answer, indent=2) + "\n")
            return json.dumps({"action": "check", "running": True, "ledger_commit": "c"})

        host.docker = docker
        return host

    def test_each_database_the_version_refuses_as_another_generation_is_named(self):
        mismatch = {"code": "SCHEMA_MISMATCH", "message": "research schema version 1, this code expects 2",
                    "expected": "2", "next_actions": []}
        host = self.host({"research": mismatch, "paper": None})
        self.assertEqual(host.generations(TARGET["service"]), {"research": "2"})
        for run in host.runs:
            self.assertIn("--read-only", run)
            self.assertEqual(run[run.index(TARGET["service"]):][:6],
                             (TARGET["service"], "python", "-m", "cli.main", "ledger", "service"))
        self.assertEqual([run[-1] for run in host.runs], ["research", "paper"])
        self.assertEqual(self.host({"research": None, "paper": None}).generations(TARGET["service"]), {})

    def test_any_other_failure_of_the_check_fails_the_tick(self):
        for answer in ({"code": "LEDGER_UNREACHABLE", "message": "no answer", "expected": None}, "not json"):
            with self.subTest(answer=answer):
                with self.assertRaises(release.DockerFailure):
                    self.host({"research": answer, "paper": None}).generations(TARGET["service"])


class PruneTests(unittest.TestCase):
    NAMES = [WEB + letter * 40 for letter in "0123456"]

    def rows(self):
        return {name: [f"2026-11-0{index + 1}T00:00:00Z", False] for index, name in enumerate(self.NAMES)}

    def test_keeps_the_newest_and_removes_older_stopped_containers(self):
        host = FakeDocker(self.rows(), [], [])
        host.prune((WEB,), {self.NAMES[-1]}, set())
        self.assertEqual(sorted(host.removed()), sorted(self.NAMES[:-KEPT_RELEASES]))

    def test_never_removes_a_running_or_active_container_however_old(self):
        rows = self.rows()
        rows[self.NAMES[0]][1] = True
        host = FakeDocker(rows, [], [])
        host.prune((WEB,), {self.NAMES[1]}, set())
        self.assertEqual(sorted(host.removed()), sorted(self.NAMES[2:-KEPT_RELEASES]))

    def test_each_kind_of_container_has_its_own_limit(self):
        rows = {prefix + letter * 40: [f"2026-11-0{index + 1}T00:00:00Z", False]
                for prefix in (WEB, AGENT, PAPER) for index, letter in enumerate("0123")}
        host = FakeDocker(rows, [], [])
        host.prune((WEB, AGENT, PAPER), set(), set())
        self.assertEqual(sorted(host.removed()), sorted(prefix + "0" * 40 for prefix in (WEB, AGENT, PAPER)))

    def test_leaves_names_it_does_not_manage(self):
        rows = {name: ["2026-11-01T00:00:00Z", False] for name in
                [f"trade-release-retained-web-{'0' * 8}", "trade-ide-ide-1", "trade-header-probe", WEB + "not-a-revision"]}
        host = FakeDocker(rows, [], [])
        host.prune((WEB,), set(), set())
        self.assertEqual(host.removed(), [])

    def test_removes_only_unused_ide_and_service_images(self):
        ide, used_ide = ("ghcr.io/qoeop/trade-ide@sha256:" + c * 64 for c in "ab")
        service = "ghcr.io/qoeop/trade-service@sha256:" + "c" * 64
        runtime = "ghcr.io/qoeop/trade-runtime@sha256:" + "d" * 64
        proxy = "ghcr.io/qoeop/trade-docker-api@sha256:" + "e" * 64  # left by a docker-api recreate
        host = FakeDocker({}, [ide, used_ide, service, runtime, proxy, "caddy@<none>", "ghcr.io/qoeop/trade-ide@<none>"],
                          [used_ide])
        host.prune((WEB,), set(), set())
        self.assertEqual(host.removed_images(), [ide, service, proxy], "no runtime image without a list of kept ones")
        self.assertTrue(all(call[:3] != ("image", "rm", "--force") for call in host.calls))

    def test_a_runtime_image_goes_only_when_unused_unnamed_and_still_in_the_registry(self):
        old, kept, used, gone = ("ghcr.io/qoeop/trade-runtime@sha256:" + c * 64 for c in "defa")
        host = FakeDocker({}, [old, kept, used, gone], [used])
        with patch.object(Registry, "serves", side_effect=lambda image: image != gone) as serves:
            host.prune((WEB,), set(), set(), {kept})
        self.assertEqual(host.removed_images(), [old])
        self.assertEqual([call.args[0] for call in serves.call_args_list], [old, gone], "a last copy stays")

    def test_a_failed_candidate_never_takes_the_place_of_a_good_release(self):
        rows = self.rows()  # 0 is the oldest; the three newest failed.
        host = FakeDocker(rows, [], [])
        host.prune((WEB,), {self.NAMES[3]}, set(self.NAMES[4:]))
        self.assertEqual(sorted(host.removed()), sorted([self.NAMES[0], self.NAMES[4], self.NAMES[5]]))

    def test_failed_records_name_the_containers_of_their_kind(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper") as paper:
            root = Path(directory)
            (root / "failed").mkdir()
            (root / "failed" / B).write_text("")
            host = Mock(state=root)
            host.disk_route.return_value = WEB + A
            paper.return_value.host.disk_route.return_value = PAPER + A
            paper.return_value.host.managed.return_value = [PAPER + A]
            runtime = "ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64
            paper.return_value.host.runtime.return_value = runtime
            host.managed.return_value = []
            Release(host, Mock(), live=IdleLive(host)).prune()
            paper.return_value.host.runtime.assert_called_once_with(PAPER + A)
            self.assertEqual(host.prune.call_args.args[:2], ((WEB, AGENT, PAPER, LIVE), {WEB + A, PAPER + A}))
            self.assertEqual(host.prune.call_args.args[2], {WEB + B, AGENT + B, PAPER + B, LIVE + B})
            self.assertEqual(host.prune.call_args.args[3], {runtime}, "the Paper controller's runtime stays")

    def test_settled_tick_prunes_and_a_failure_changes_nothing(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper") as paper:
            host = Mock(state=Path(directory))
            host.disk_route.return_value = WEB + A
            host.managed.return_value = []
            paper.return_value.host.disk_route.return_value = PAPER + A
            release = Release(host, Mock(), live=IdleLive(host))
            release.prune()
            host.prune.assert_called_once_with((WEB, AGENT, PAPER, LIVE), {WEB + A, PAPER + A}, set(), set())
            host.prune.side_effect = RuntimeError("docker rm failed")
            release.prune()

    def test_a_tick_prunes_only_after_it_settled(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper"):
            host = Mock(state=Path(directory))
            host.managed.return_value = []
            host.disk_route.return_value = WEB + A
            host.follower.return_value = None  # no compose service of the service image to move
            github = Mock()
            github.approved.return_value = {"revision": A, "image": TARGET["image"], "service": TARGET["service"]}
            github.choose.return_value = None  # the running control's version is the admitted one
            with patch("deploy.release.running", return_value=A):
                self.assertFalse(Release(host, github, live=IdleLive(host)).tick())
            host.prune.assert_called_once()
            host.prune.reset_mock()
            github.choose.side_effect = RuntimeError("git failed")
            with self.assertRaises(RuntimeError), patch("deploy.release.running", return_value=A):
                Release(host, github, live=IdleLive(host)).tick()
            host.prune.assert_not_called()

    def test_retired_live_controllers_go_except_those_of_remaining_webs(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper") as paper:
            root = Path(directory)
            (root / "failed").mkdir()
            (root / "failed" / D).write_text("")
            host = Mock(state=root)
            host.disk_route.return_value = WEB + B
            paper.return_value.host.disk_route.return_value = PAPER + A
            host.managed.side_effect = lambda prefix: [WEB + B, WEB + C] if prefix == WEB else []
            live = Mock()
            live.runtimes.return_value = {"ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64}
            Release(host, Mock(), live=live).prune()
            prefixes, active, failed, runtimes = host.prune.call_args.args
            self.assertEqual(runtimes, live.runtimes.return_value)
            self.assertEqual(prefixes, (WEB, AGENT, PAPER, LIVE))
            self.assertEqual(active, {WEB + B, PAPER + A, LIVE + B, LIVE + C})
            self.assertIn(LIVE + D, failed)
            live.prune.assert_called_once_with({B, C})

    def test_live_directories_go_with_their_controllers(self):
        from deploy.live_host import LiveHost

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "live"
            for sha in (A, B, C, D):
                (root / sha / "socket").mkdir(parents=True)
                (root / sha / "configuration.json").write_text(json.dumps({"runtime": "r-" + sha[0]}))
            (root / ".configuration-backup").write_text("{}")
            web = Mock(state=Path(directory))
            web.managed.return_value = [LIVE + B]
            custody = Path(directory) / "live-root"  # the custody root, beside live/: no revision's directory
            (custody / "runs" / "live-1" / "inputs").mkdir(parents=True)
            (custody / "runs" / "live-1" / "inputs" / "manifest.json").write_text(json.dumps({"runtime": {"image_ref": "r-run"}}))
            live = LiveHost(web, Mock())
            self.assertEqual(live.runtimes(), {"r-a", "r-b", "r-c", "r-d", "r-run"}, "a Live run never pulls again")
            live.prune({A})
            web.managed.assert_called_once_with(LIVE)
            self.assertEqual(sorted(path.name for path in root.iterdir()), sorted([".configuration-backup", A, B]))
            self.assertTrue((custody / "runs" / "live-1" / "inputs" / "manifest.json").exists())

    def test_open_transactions_block_pruning(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ("transaction.json", "paper-transaction.json"):
                host = Mock(state=Path(directory))
                release = Release(host, Mock())
                path = Path(directory) / name
                path.write_text("{}")
                release.prune()
                host.prune.assert_not_called()
                path.unlink()


class SelectionTests(unittest.TestCase):
    def source(self, root, record):
        source = GitSource(Path(root))
        source.refresh = Mock()
        source.ancestor = Mock(return_value=True)
        source.git = Mock(side_effect=lambda *args: json.dumps(record) if args[0] == "show" else C)
        return source

    def test_only_fresh_admitted_main_descendants_are_selected(self):
        with tempfile.TemporaryDirectory() as root:
            source = self.source(root, TARGET)
            failed = Path(root) / "failed"
            self.assertEqual(source.choose(A, failed), TARGET)
            self.assertIsNone(source.choose(B, failed))
            source.ancestor.side_effect = lambda before, after: before != A
            self.assertIsNone(source.choose(A, failed))
            failed.mkdir()
            (failed / B).write_text("uncommitted")
            source.ancestor.side_effect = None
            self.assertIsNone(source.choose(A, failed))

    def test_withdrawn_malformed_or_stale_channel_cannot_use_a_cached_approval(self):
        with tempfile.TemporaryDirectory() as root:
            for record in ({**TARGET, "image": "mutable:main"}, {**TARGET, "extra": True},
                           {"revision": B, "image": TARGET["image"]}, {**TARGET, "runtime": None}):
                source = self.source(root, record)
                with self.assertRaises(RuntimeError):
                    source.approved()
            source = self.source(root, {"revision": B, "image": None, "service": None, "runtime": None})
            self.assertIsNone(source.choose(A, Path(root) / "failed"))
            with self.assertRaisesRegex(RuntimeError, "withdrawn"):
                source.ensure(TARGET)
            source.refresh.side_effect = RuntimeError("fetch failed")
            source.git.reset_mock()
            with self.assertRaisesRegex(RuntimeError, "fetch failed"):
                source.approved()
            source.git.assert_not_called()

    def test_agent_runtime_dependency_changes_include_its_base_image(self):
        source = GitSource(Path("/unused"))
        source.ancestor = Mock(return_value=True)
        source.git = Mock(return_value="ide/web/src/App.tsx")
        self.assertFalse(source.agent_changed(A, B))
        for unchanged in ("tests/ledger/test_db.py", ".agents/skills/x/SKILL.md", "README.md", "deploy/release.py"):
            source.git.return_value = unchanged
            self.assertFalse(source.agent_changed(A, B), unchanged)
        for changed in ("deploy/Dockerfile", "ide/agent/src/chat.ts", "ledger/db.py", "uv.lock"):
            source.git.return_value = changed
            self.assertTrue(source.agent_changed(A, B))

    def test_the_host_domain_and_data_root_come_from_the_installed_env_file(self):
        def compose(stdout, code=0):
            return Mock(return_value=Mock(returncode=code, stdout=stdout, stderr="no such flag"))
        env = Path("/etc/trade/remote.env")
        run = compose("HOME=/root\nTRADE_DOMAIN=www.trade.test\nTRADE_DATA=/data/trade\nX=a=b\n")
        config = Config.installed(env, run)
        self.assertEqual((config.domain, config.data, config.paper_memory), ("www.trade.test", Path("/data/trade"), ""))
        self.assertEqual(run.call_args.args[0][:4], ["docker", "compose", "--env-file", str(env)])
        base = "TRADE_DOMAIN=x.test\nTRADE_DATA=/data\n"
        for memory in ("", "3584m", "4g"):
            self.assertEqual(Config.installed(env, compose(f"{base}TRADE_PAPER_MEMORY={memory}\n")).paper_memory, memory)
        for memory in ("4G", "0m", "4gb", "4 g"):
            with self.assertRaisesRegex(RuntimeError, "TRADE_PAPER_MEMORY"):
                Config.installed(env, compose(f"{base}TRADE_PAPER_MEMORY={memory}\n"))
        for stdout in ("TRADE_DATA=/data/trade\n", "TRADE_DOMAIN=x.test\nTRADE_DATA=relative\n",
                       "TRADE_DOMAIN=a.test/evil\nTRADE_DATA=/data\n"):
            with self.assertRaisesRegex(RuntimeError, "must set TRADE_DOMAIN"):
                Config.installed(env, compose(stdout))
        with self.assertRaisesRegex(RuntimeError, "Compose 2.28 or newer"):
            Config.installed(env, compose("", 1))

    @unittest.skipUnless(shutil.which("docker"), "needs Docker Compose")
    def test_compose_resolves_the_env_file_quotes_and_comments(self):
        with tempfile.TemporaryDirectory() as root:
            env = Path(root) / "remote.env"
            env.write_text("# TRADE_DOMAIN=commented.test\nTRADE_DOMAIN=www.trade.test # the public name\n"
                           "TRADE_DATA='/data/trade'\n")
            with patch.dict(os.environ, {}, clear=False) as values:
                values.pop("TRADE_DOMAIN", None), values.pop("TRADE_DATA", None)
                config = Config.installed(env)
        self.assertEqual((config.domain, config.data), ("www.trade.test", Path("/data/trade")))

    @unittest.skipUnless(shutil.which("docker"), "needs Docker Compose")
    def test_the_workstation_paper_service_gets_the_paper_memory_budget_from_the_env_file(self):
        compose = Path(__file__).resolve().parents[2] / "deploy/compose.yaml"
        with tempfile.TemporaryDirectory() as root:
            for memory in ("4g", ""):
                env = Path(root) / "trade.env"
                env.write_text("TRADE_SERVICE_IMAGE=s\nTRADE_IDE_IMAGE=i\nTRADE_RUNTIME_IMAGE=r\nTRADE_UID=1\n"
                               f"TRADE_GID=1\nTRADE_DATA=/data\nTRADE_PAPER_MEMORY={memory}\n")
                with patch.dict(os.environ, {}, clear=False) as values:
                    values.pop("TRADE_PAPER_MEMORY", None)
                    result = subprocess.run(["docker", "compose", "--env-file", str(env), "-f", str(compose),
                                             "config", "--format", "json", "paper"],
                                            capture_output=True, text=True, timeout=60, check=True)
                # Empty reaches paper/runs.py budget() as "", which keeps its default.
                self.assertEqual(json.loads(result.stdout)["services"]["paper"]["environment"]["TRADE_PAPER_MEMORY"],
                                 memory)

    def test_router_state_and_docker_lifecycle_reject_non_web_or_non_agent_names(self):
        self.assertEqual(route_name(route_config(WEB + A)), WEB + A)
        host = DockerHost(Config())
        host.docker = Mock()
        for name in ("trade-ide-paper-1", "trade-paper-runner", "trade-ide-ledger-1", WEB + "invalid"):
            with self.assertRaises(RuntimeError):
                host.stop(name)
        host.docker.assert_not_called()

    def test_real_start_boundary_refuses_another_agent(self):
        host = DockerHost(Config())
        states = {AGENT + B: False, AGENT + C: True}
        host.exists = lambda name: name in states
        host.inspect = lambda name: {
            "running": states[name],
            "revision": name.rsplit("-", 1)[-1],
            "image": TARGET["image"],
        }
        host.managed = lambda prefix, running_only=False: [
            name for name, running in states.items() if name.startswith(prefix) and (running or not running_only)
        ]
        host.docker = Mock()
        with self.assertRaisesRegex(RuntimeError, "another Agent"):
            host.start(AGENT + B)
        host.docker.assert_not_called()

    def test_readiness_draws_the_lines_of_active_runs_the_newest_or_none_on_an_empty_ledger(self):
        host = DockerHost(Config())
        def listed(name, version, created_at):  # a `line list` entry (graph.line_list over lines.list_lines)
            return dict(zip(HOST_LINE_KEYS, (name, created_at), strict=True), candidates=[version])

        lines = [listed("old", "v1", "2026-01-01T00:00:00"), listed("new", "v2", "2026-02-01T00:00:00")]
        runs = {"status": 200, "runs": [{"candidate": "v1", "state": "running"}]}
        host.probe = Mock(side_effect=lambda name, path, routed=False:
                          {"status": 200, "lines": lines} if path == "/api/lines" else runs)
        self.assertEqual(host.lines(WEB + B), ["old"])
        runs = {"status": 200, "runs": [{"candidate": "from-an-earlier-ledger", "state": "running"}]}
        self.assertEqual(host.lines(WEB + B), ["new"])
        lines = []
        self.assertEqual(host.lines(WEB + B), [], "a new ledger has no graph to warm")
        host.probe = Mock(side_effect=RuntimeError("docker exec failed"))
        with self.assertRaises(RuntimeError):  # an unreadable ledger is not an empty one
            host.lines(WEB + B)

    def test_observation_rechecks_after_the_potentially_slow_auth_probe(self):
        host = DockerHost(Config(observe_seconds=0))
        host.ensure_protected = Mock()
        host.health = Mock()
        host.auth_denied = Mock()
        host.probe = Mock(return_value={"status": 200, "runs": []})
        host.live_route = Mock(side_effect=[WEB + B, WEB + C])
        with self.assertRaisesRegex(RuntimeError, "authentication probe"):
            host.observe(WEB + B, [], {})

    def test_observation_requires_existing_paper_data_to_keep_advancing(self):
        host = DockerHost(Config(observe_seconds=0))
        host.ensure_protected = Mock()
        host.health = Mock()
        host.auth_denied = Mock()
        host.live_route = Mock(return_value=WEB + B)
        before = {"status": 200, "runs": [{"id": 3, "state": "running", "last": 100}]}
        host.probe = Mock(return_value=before)
        with self.assertRaisesRegex(RuntimeError, "did not advance"):
            host.observe(WEB + B, [], {})
        host.probe = Mock(side_effect=[before, {"status": 200, "runs": [{"id": 3, "state": "running", "last": 101}]}])
        host.observe(WEB + B, [], {})


class RetryTests(unittest.TestCase):
    """Deleting a failed marker retries the revision: what the earlier attempt left must not refuse it."""

    def host(self, found):
        host = DockerHost(Config())
        removed = []

        def docker(*args, **kwargs):
            if args[:2] == ("ps", "-a"):
                return "\n".join(found)
            if args[0] == "rm":
                removed.append(args[1])
                return ""
            raise AssertionError(args)

        host.docker = docker  # type: ignore[method-assign]
        host.inspect = lambda name: found[name]  # type: ignore[method-assign]
        return host, removed

    def test_a_stopped_candidate_of_the_same_revision_is_removed_before_it_is_created_again(self):
        host, removed = self.host({WEB + B: {"revision": B, "running": False}})
        host.discard_failed(WEB + B, WEB)
        self.assertEqual(removed, [WEB + B])

    def test_a_paper_controller_left_by_a_failed_attempt_is_removed(self):
        host, removed = self.host({PAPER + B: {"revision": B, "running": False}})
        host.discard_failed(PAPER + B, PAPER)
        self.assertEqual(removed, [PAPER + B])

    def test_a_running_container_or_one_of_another_revision_still_refuses(self):
        for found in ({"revision": B, "running": True}, {"revision": C, "running": False}):
            host, removed = self.host({WEB + B: found})
            with self.assertRaisesRegex(RuntimeError, "already retained"):
                host.discard_failed(WEB + B, WEB)
            self.assertEqual(removed, [])

    def test_nothing_to_remove_creates_as_before(self):
        host, removed = self.host({})
        host.discard_failed(WEB + B, WEB)
        self.assertEqual(removed, [])


OLD_SERVICE = "ghcr.io/qoeop/trade-service@sha256:" + "0" * 64
COMPOSE = ["/var/lib/trade-release/control/" + A + "/deploy/compose.yaml"]  # what DockerHost.definition gives
PROXY, OLD_PROXY = ("ghcr.io/qoeop/trade-docker-api@sha256:" + digit * 64 for digit in "34")
WEB_CREATED, BEFORE, AFTER = ("2026-11-15T10:00:00Z", "2026-11-11T08:00:00.5Z", "2026-11-15T10:00:00.1Z")


def hours_after_web(hours):
    """A Docker creation time `hours` after the routed Web's, and the clock reading at it."""
    return (moment(f"2026-11-15T{10 + int(hours):02d}:{int(hours % 1 * 60):02d}:00.1Z"),
            release.epoch(moment(WEB_CREATED)) + hours * 3600 + 0.1)


class FollowHost(Host):
    """The settled host of version A: Web, Paper controller and the compose services the release may move."""

    def __init__(self, state):
        super().__init__(state)
        self.services = {LEDGER: {"image": OLD_SERVICE, "created": moment(BEFORE)},
                         MARKET_IMPORT: {"image": OLD_SERVICE, "created": moment(BEFORE)},
                         DOCKER_API: {"image": PROXY, "created": moment(BEFORE)}}  # already on A's pin
        self.variables = []
        self.definitions = []  # the versions whose compose files a follow read
        self.pulled = []
        self.runs = {"starting": 0, "runs": [{"id": 1, "state": "sealed", "containers": 0, "recovery": None}]}
        self.after_move = None  # the listing once the services moved, when it differs
        self.recreated = []
        self.broken = set()
        self.during = None
        self.stamp = moment(AFTER)  # the creation time of what recreate makes
        self.live_locked = False  # whether the release holds the Live account lock
        self.readers = []

    def created(self, name):
        assert name == WEB + A
        return moment(WEB_CREATED)

    def follower(self, name):
        return self.services.get(name)

    def definition(self, service, sha):
        self.definitions.append((service, sha))
        return COMPOSE

    def pull(self, reference, pattern, sha=None):
        self.pulled.append((reference, pattern.pattern, sha))
        return sha

    def recreate(self, service, name, image, healthy, files, pull=False, variable="TRADE_SERVICE_IMAGE"):
        assert files == COMPOSE, "the active version's own compose files"
        if self.during:
            self.during()
        self.recreated.append((service, image, healthy))
        self.variables.append(variable)
        self.services[name] = {"image": image, "created": self.stamp}
        if self.after_move is not None:
            self.runs = self.after_move.pop(0) if isinstance(self.after_move, list) else self.after_move
        if service in self.broken and image in self.broken:
            raise RuntimeError("compose service did not start on its image: " + service)

    def probe(self, name, path, routed=False):
        assert (name, path, routed) == (WEB + A, "/api/paper/runs", True)
        return json.loads(json.dumps(self.runs))

    def health(self, name, lines, routed=False, live=True):
        # The Web's /api/live lists under the Live account lock (live/state.py reading): while the release holds it
        # (RecordingLive.barrier) that read waits until the probe times out, as on the host (doctor 20261117-02).
        if routed and live and self.live_locked:
            raise ReaderFailure("routed Web", "/api/live", "TimeoutError")
        self.readers.append((name, routed, live))


class RecordingLive(IdleLive):
    def __init__(self, host):
        super().__init__(host)
        self.held = []
        self.busy = False

    @contextmanager
    def barrier(self, name, service=None, *, idle=False, wait_for_lock=False):
        if self.busy:
            raise LiveBusy("Live has a running run")
        self.held.append((name, idle))
        self.host.live_locked = True
        try:
            yield lambda: None
        finally:
            self.host.live_locked = False
        self.held.append("released")


class FollowTests(unittest.TestCase):
    """A version moves the ledger mirror and market-import to its service image, only while Paper and Live are idle
    (doctor 20261115-06): without it they stay on the image of the host's install."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = FollowHost(Path(temporary.name))
        self.github = Mock()
        self.github.approved.return_value = {**TARGET, "revision": A}  # version A is the committed one
        self.github.docker_api.return_value = PROXY  # what A's deploy/compose.yaml pins
        self.live = RecordingLive(self.host)
        self.release = Release(self.host, self.github, live=self.live, paper=paper_release(self.host))
        self.controller = self.release.paper().host
        sleep = patch("deploy.release.time.sleep")
        sleep.start()
        self.addCleanup(sleep.stop)
        self.now = release.epoch(moment(AFTER)) + 1  # just after what a move or its undo created
        clock = patch("deploy.release.time.time", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def unfrozen(self):
        self.assertEqual((self.controller.disk, self.controller.live), (paper_route(PAPER + A),) * 2)

    def test_both_services_move_to_the_version_service_digest_with_paper_frozen_and_live_held(self):
        seen = []
        self.host.during = lambda: seen.append((self.controller.live, list(self.live.held)))
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [("ledger", TARGET["service"], True),
                                               ("market-import", TARGET["service"], False)])
        self.assertEqual(self.host.definitions, [(TARGET["service"], A)], "the committed version's own files")
        frozen = paper_route(PAPER + A, "all")
        self.assertEqual(seen, [(frozen, [(WEB + A, True)])] * 2, "Paper writes wait and Live is held idle")
        self.assertIn(("held",), self.controller.calls, "lifecycle operations already admitted drained first")
        self.assertEqual(self.live.held[-1], "released")
        self.unfrozen()
        self.host.recreated.clear()
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [], "nothing moves twice")

    def test_docker_api_moves_to_the_pin_of_the_version_under_the_same_conditions(self):
        # Doctor 20261116-04, the user 2026-11-16: a version whose Paper controller passes runtime options its own
        # proxy allows must not wait for a pull request to move docker-api on the host.
        self.host.services[DOCKER_API]["image"] = OLD_PROXY
        seen = []
        self.host.during = lambda: seen.append((self.controller.live, list(self.live.held)))
        self.release.follow(WEB + A)
        self.github.docker_api.assert_called_with(A)
        self.assertEqual(self.host.recreated, [("ledger", TARGET["service"], True),
                                               ("market-import", TARGET["service"], False),
                                               ("docker-api", PROXY, False)])
        self.assertEqual(self.host.variables, ["TRADE_SERVICE_IMAGE"] * 2 + ["TRADE_DOCKER_API_IMAGE"])
        self.assertIn((PROXY, DOCKER_API_REF.pattern, None), self.host.pulled, "checked, then --pull never")
        self.assertEqual(seen, [(paper_route(PAPER + A, "all"), [(WEB + A, True)])] * 3)
        self.unfrozen()
        self.host.recreated.clear()
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [], "nothing moves twice")

    def test_a_failed_docker_api_move_puts_every_service_back(self):
        self.host.services[DOCKER_API]["image"] = OLD_PROXY
        self.host.broken = {"docker-api", PROXY}
        with self.assertRaises(RuntimeError) as raised:
            self.release.follow(WEB + A)
        self.assertEqual(failure_summary(raised.exception), "service move failed and was undone")
        self.assertEqual(self.host.recreated[3:], [("docker-api", OLD_PROXY, False),
                                                   ("market-import", OLD_SERVICE, False), ("ledger", OLD_SERVICE, True)])
        self.assertEqual(self.host.variables[3], "TRADE_DOCKER_API_IMAGE")
        self.unfrozen()

    def test_open_paper_runs_and_their_containers_do_not_hold_the_move_back(self):
        # The user, 2026-11-16 (「放宽」): runners never reach the ledger, so only a Paper operation in progress waits.
        self.host.runs = {"starting": 0, "runs": [
            {"id": 1, "state": "running", "containers": 2, "recovery": None},
            {"id": 2, "state": "sealed", "containers": 1, "recovery": None}]}
        self.release.follow(WEB + A)
        self.assertEqual([service for service, _, _ in self.host.recreated], ["ledger", "market-import"])
        self.unfrozen()

    def test_a_paper_operation_in_progress_or_an_unreadable_listing_waits(self):
        for runs in ({"starting": 1, "runs": []},
                     *({"starting": 0, "runs": [{"id": 1, "state": state, "containers": 2, "recovery": None}]}
                       for state in ("stopping", "ended", "unsealed")),
                     {"runs": []}):
            with self.subTest(runs=runs):
                self.host.runs = runs
                self.release.follow(WEB + A)
                self.assertEqual(self.host.recreated, [])
                self.assertEqual(self.live.held, [])
                self.unfrozen()

    def test_a_recovery_failure_from_the_restart_is_waited_out_and_a_lasting_one_does_not_undo_the_move(self):
        failing = {"starting": 0, "runs": [{"id": 1, "state": "ended", "containers": 2, "recovery": "LEDGER_START"}]}
        cleared = {"starting": 0, "runs": [{"id": 1, "state": "running", "containers": 2, "recovery": None}]}
        self.host.after_move = failing  # the restart failed a resume of a run that ended meanwhile
        polled = []

        def ready(check, *args, **kwargs):
            if check.__name__ != "cleared":
                return check()
            with self.assertRaises(RuntimeError):  # what the tick's notices would report as a lost run
                check()
            polled.append(True)
            self.host.runs = cleared  # the controller's next round resumes it
            return check()

        with patch("deploy.release.until_ready", side_effect=ready):
            self.release.follow(WEB + A)
        self.assertEqual(polled, [True], "the move waits for the controller's retry before the tick's notices")
        self.assertEqual(len(self.host.recreated), 2)
        self.host.services = {LEDGER: {"image": OLD_SERVICE, "created": moment(BEFORE)}}
        self.host.recreated.clear()
        self.host.after_move = failing  # a recovery failure that lasts: reported by the tick's notices, not undone
        with patch("deploy.release.until_ready", side_effect=lambda check, *args, **kwargs: check()):
            self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [("ledger", TARGET["service"], True)])

    def test_busy_live_waits_and_unfreezes_paper(self):
        self.live.busy = True
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [])
        self.unfrozen()

    def test_only_the_committed_version_moves_them_and_never_a_service_recreated_since_or_not_running(self):
        self.github.approved.return_value = TARGET  # B is admitted but not released yet: it moves them later
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [])
        self.github.approved.return_value = {**TARGET, "revision": A}
        self.host.services[LEDGER]["created"] = moment(AFTER)  # a move undone, or the operator's recreate
        del self.host.services[MARKET_IMPORT]  # the operator does not run it
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [])
        self.assertEqual(self.live.held, [])

    def test_a_failed_move_puts_back_every_service_it_touched_and_fails_the_tick_once(self):
        self.host.broken = {"market-import", TARGET["service"]}
        with self.assertRaises(RuntimeError) as raised:
            self.release.follow(WEB + A)
        self.assertEqual(failure_summary(raised.exception), "service move failed and was undone")
        self.assertEqual(self.host.recreated, [("ledger", TARGET["service"], True),
                                               ("market-import", TARGET["service"], False),
                                               ("market-import", OLD_SERVICE, False), ("ledger", OLD_SERVICE, True)])
        self.unfrozen()
        self.host.recreated.clear()
        self.release.follow(WEB + A)  # both are now newer than the active Web: no outage every tick
        self.assertEqual(self.host.recreated, [])

    def test_an_undone_move_is_tried_again_an_hour_later_at_most_three_times_per_version(self):
        # Doctor 20261117-02: the undo recreates both services after the routed Web, which read as the operator's
        # recreation, so 0.4.1 never moved them again.
        self.host.broken = {"ledger", TARGET["service"]}
        del self.host.services[MARKET_IMPORT]  # untouched by a move that failed first on ledger
        attempts = []
        for hours in (0, 1, 2):
            self.host.stamp, self.now = hours_after_web(hours + 0.01)
            with self.assertRaises(RuntimeError) as raised:
                self.release.follow(WEB + A)
            self.assertEqual(failure_summary(raised.exception), "service move failed and was undone")
            attempts.append(self.host.recreated[:])
            self.host.recreated.clear()
            self.now += FOLLOW_RETRY_SECONDS - 60
            self.release.follow(WEB + A)
            self.assertEqual(self.host.recreated, [], "not again within the hour: no outage every tick")
            self.now += 120
        self.assertEqual([moves[0] for moves in attempts], [("ledger", TARGET["service"], True)] * 3)
        self.assertEqual(self.host.services[LEDGER]["image"], OLD_SERVICE)
        self.now += 24 * 3600
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [], "three attempts, then the next version")
        self.host.broken = set()  # an operator's recreation on its own image within the window moves like an undo
        self.host.services[LEDGER]["created"], self.now = hours_after_web(0.5)
        self.now += FOLLOW_RETRY_SECONDS
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated[0], ("ledger", TARGET["service"], True))

    def test_the_readers_after_the_move_do_not_wait_on_the_live_lock_the_move_holds(self):
        # Doctor 20261117-02: 0.4.1 and 0.4.2 both undid this move after 180 s of "routed Web /api/live: TimeoutError".
        with patch("deploy.release.until_ready", side_effect=lambda check, *args, **kwargs: check()):
            self.release.follow(WEB + A)
        self.assertEqual([image for _, image, _ in self.host.recreated], [TARGET["service"]] * 2, "nothing undone")
        self.assertEqual(self.host.readers, [(WEB + A, True, False)])

    def test_unreadable_readers_after_the_move_put_the_services_back(self):
        self.controller.health = Mock(side_effect=RuntimeError("Paper controller cannot read its database"))
        with patch("deploy.release.until_ready", side_effect=lambda check, *args, **kwargs: check()):
            with self.assertRaises(RuntimeError):
                self.release.follow(WEB + A)
        self.assertEqual([image for _, image, _ in self.host.recreated][-2:], [OLD_SERVICE, OLD_SERVICE])

    def test_a_release_tick_leaves_the_services_to_the_next_tick(self):
        self.github.choose.return_value = TARGET
        with patch("deploy.release.running", return_value=A), patch.object(Release, "apply") as apply, \
                patch.object(Release, "follow") as follow, patch.object(Release, "prune"), \
                patch.object(Release, "recover"):
            Release(self.host, self.github, live=self.live).tick()
            apply.assert_called_once_with(TARGET)
            follow.assert_not_called()
            self.github.choose.return_value = None
            Release(self.host, self.github, live=self.live).tick()
            follow.assert_called_once_with(WEB + A)


class ReaderDiagnosisTests(unittest.TestCase):
    """Doctor 20261117-02: a reader that failed after a service move left only "unclassified runtime failure
    (RuntimeError at deploy/release_host.py:239)". It names the reader, the path and the HTTP status or error class,
    never a response body or what docker printed."""

    SECRET = "fake-paper-token-in-a-body"

    def run_probe(self, script, argv, urlopen):
        out = io.StringIO()
        with patch("urllib.request.urlopen", urlopen), patch.object(sys, "argv", ["-c", *argv]), \
                redirect_stdout(out):
            exec(script, {})
        self.assertNotIn(self.SECRET, out.getvalue())
        return json.loads(out.getvalue())

    def test_probes_give_the_status_or_error_class_of_a_reader_that_did_not_answer_200(self):
        def refused(request, timeout):
            raise HTTPError(request.full_url, 502, self.SECRET, {}, io.BytesIO(self.SECRET.encode()))

        def hung(request, timeout):
            raise TimeoutError(self.SECRET)

        for script, argv in ((PROBE, ["/api/paper/health", "trade.example.com", "ide-router"]),
                             (CONTROLLER_PROBE, ["/api/paper/runs"])):
            with self.subTest(argv=argv):
                self.assertEqual(self.run_probe(script, argv, refused), {"status": 502})
                self.assertEqual(self.run_probe(script, argv, hung), {"status": None, "error": "TimeoutError"})

    def test_the_runs_probe_passes_unprotected_position_ids_and_a_seals_end_only(self):
        seal = {"stop_reason": "PAPER_CACHE_UNAVAILABLE", "stopped_ns": 5, "reasons": ["STOPPED:PAPER_CACHE_UNAVAILABLE"],
                "daily_returns": [["2026-11-20", 0.01]], "status": "complete"}
        listing = {"runs": [{"paper_id": 3, "candidate": "c@1", "state": "running", "seal": None, "unprotected": [
            {"position_id": "P-1", "instrument_id": "BTCUSDT-PERP.BINANCE", "since_ns": 1}]},
                            {"paper_id": 4, "candidate": None, "state": "sealed", "seal": seal}], "starting": []}

        class Reply(io.BytesIO):
            status = 200

        def answered(request, timeout):
            return Reply(json.dumps(listing).encode())

        found = self.run_probe(PROBE, ["/api/paper/runs", "trade.example.com", "ide-router"], answered)
        self.assertEqual([run["unprotected"] for run in found["runs"]], [["P-1"], []])
        self.assertEqual([[run[key] for key in ("stop_reason", "stopped_ns", "reasons")] for run in found["runs"]],
                         [[None, None, None], ["PAPER_CACHE_UNAVAILABLE", 5, ["STOPPED:PAPER_CACHE_UNAVAILABLE"]]])
        self.assertNotIn("daily_returns", found["runs"][1])

    def test_a_routed_web_health_failure_names_the_reader_path_and_status(self):
        host = DockerHost(Config())
        host.agent = Mock()
        host.probe = Mock(side_effect=lambda name, path, routed=False:
                          {"status": 503} if path == "/api/agent/health" else {"status": 200, "ok": True})
        with self.assertRaises(RuntimeError) as raised:
            host.health(WEB + A, [], routed=True)
        self.assertEqual(failure_summary(raised.exception), "routed Web unhealthy at /api/agent/health: HTTP 503")

    def test_a_paper_controller_failure_names_its_path_and_error_class(self):
        controller = PaperHost(Config(state=Path(tempfile.mkdtemp())))
        self.addCleanup(shutil.rmtree, controller.state)
        answers = {"/api/paper/runs": {"status": None, "error": "URLError"}}
        controller.docker = Mock(side_effect=lambda *args, **kwargs: json.dumps(answers[args[-1]]))
        with self.assertRaises(RuntimeError) as raised:
            controller.health(PAPER + A)
        self.assertEqual(failure_summary(raised.exception), "Paper controller unhealthy at /api/paper/runs: URLError")
        answers["/api/paper/runs"] = {"status": 200, "runs": True}
        answers["/api/paper/health"] = {"status": 200, "runtime": "another", "active": True}
        controller.runtime = Mock(return_value=TARGET["runtime"])
        with self.assertRaises(RuntimeError) as raised:
            controller.health(PAPER + A)
        self.assertEqual(failure_summary(raised.exception),
                         "Paper controller unhealthy at /api/paper/health: another runtime")

    def test_a_failed_docker_command_names_its_subcommand_status_and_caller_without_stderr(self):
        host = DockerHost(Config(state=Path(tempfile.mkdtemp())))
        self.addCleanup(shutil.rmtree, host.state)
        failed = subprocess.CompletedProcess([], 1, "", self.SECRET)
        with patch("deploy.release_host.subprocess.run", return_value=failed):
            try:
                host.exists(LEDGER)
            except RuntimeError as error:  # assertRaises drops the traceback the caller's line is read from
                summary = failure_summary(error)
        self.assertNotIn(self.SECRET, summary)
        self.assertRegex(summary, r"\Adocker ps exited 1 \(called at deploy/release_host\.py:\d+\)\Z")

    def test_an_undone_move_reports_which_reader_failed(self):
        test = FollowTests()
        test.setUp()
        self.addCleanup(test.doCleanups)
        test.controller.health = Mock(side_effect=ReaderFailure("Paper controller", "/api/paper/runs", "HTTP 500"))
        output = io.StringIO()
        with patch("deploy.release.until_ready", side_effect=lambda check, *args, **kwargs: check()), \
                redirect_stderr(output), self.assertRaises(RuntimeError) as raised:
            test.release.follow(WEB + A)
        self.assertEqual(failure_summary(raised.exception), "service move failed and was undone")
        self.assertIn("Compose service move failed: Paper controller unhealthy at /api/paper/runs: HTTP 500",
                      output.getvalue())


class RecreateTests(unittest.TestCase):
    def test_compose_recreates_one_service_from_the_host_definition_with_the_digest_in_its_environment(self):
        host = DockerHost(Config(state=Path(tempfile.mkdtemp())))
        self.addCleanup(shutil.rmtree, host.state)
        done = subprocess.CompletedProcess([], 0, "", "")
        with patch("deploy.release_host.subprocess.run", return_value=done) as run, \
                patch.object(DockerHost, "inspect", return_value={"image": TARGET["service"], "running": True,
                                                                  "restarts": 0}):
            host.recreate("ledger", LEDGER, TARGET["service"], True, COMPOSE)
        command, env = run.call_args.args[0], run.call_args.kwargs["env"]
        self.assertEqual(env["TRADE_SERVICE_IMAGE"], TARGET["service"])
        self.assertEqual(command[:5], ["docker", "--config", str(host.state / "docker"), "--host",
                                       "unix:///var/run/docker.sock"])
        self.assertEqual(command[5:8], ["compose", "--env-file", "/etc/trade/remote.env"])
        self.assertEqual([command[i + 1] for i, arg in enumerate(command) if arg == "-f"], COMPOSE)
        self.assertEqual(command[-1], "ledger")
        for flag in ("--no-deps", "--wait", "--detach"):
            self.assertIn(flag, command)
        self.assertEqual(command[command.index("--pull") + 1], "never", "the release pulled and checked it")
        with patch("deploy.release_host.subprocess.run", return_value=done), \
                patch("deploy.release_host.time.sleep"), \
                patch.object(DockerHost, "inspect", return_value={"image": OLD_SERVICE, "running": True,
                                                                  "restarts": 0}):
            with self.assertRaisesRegex(RuntimeError, "did not start"):
                host.recreate("market-import", MARKET_IMPORT, TARGET["service"], False, COMPOSE)

    def test_docker_api_takes_the_pin_in_its_own_variable(self):
        host = DockerHost(Config(state=Path(tempfile.mkdtemp())))
        self.addCleanup(shutil.rmtree, host.state)
        done = subprocess.CompletedProcess([], 0, "", "")
        with patch("deploy.release_host.subprocess.run", return_value=done) as run, \
                patch("deploy.release_host.time.sleep"), \
                patch.object(DockerHost, "inspect", return_value={"image": PROXY, "running": True, "restarts": 0}):
            host.recreate("docker-api", DOCKER_API, PROXY, False, COMPOSE, variable="TRADE_DOCKER_API_IMAGE")
        self.assertEqual(run.call_args.kwargs["env"]["TRADE_DOCKER_API_IMAGE"], PROXY)
        self.assertNotIn("TRADE_SERVICE_IMAGE", {key for key in run.call_args.kwargs["env"]
                                                 if run.call_args.kwargs["env"][key] == PROXY})
        self.assertEqual(run.call_args.args[0][-1], "docker-api")

    def test_the_compose_definition_is_read_once_from_the_running_versions_service_image(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root)
        image = {name: f"# {name}\n" for name in DEFINITION}

        class Extracting(DockerHost):
            CODE = root / "control" / A / "deploy"

            def __init__(self):
                super().__init__(Config(state=root))
                self.calls = []

            def pull(self, reference, pattern, sha=None):
                self.calls.append(("pull", reference, sha))
                return sha

            def docker(self, *args, check=True, timeout=120, env=None):
                self.calls.append(args[:1])
                if args[0] == "cp":
                    for name, text in image.items():
                        (Path(args[2]) / name).parent.mkdir(parents=True, exist_ok=True)
                        (Path(args[2]) / name).write_text(text)
                return ""

        Extracting.CODE.mkdir(parents=True)
        host = Extracting()
        files = host.definition(TARGET["service"], A)
        self.assertEqual(files, [str(Extracting.CODE / name) for name in
                                 ("compose.yaml", "remote/compose.yaml", "remote/cd.compose.yaml",
                                  "remote/paper-cd.compose.yaml")])
        for name in DEFINITION:
            self.assertEqual((Extracting.CODE / name).read_text(), image[name])
        self.assertEqual(host.calls, [("pull", TARGET["service"], A), ("rm",), ("create",), ("cp",), ("rm",)])
        self.assertFalse((root / "control" / A / "definition.new").exists())
        host.calls.clear()
        self.assertEqual(host.definition(TARGET["service"], A), files)
        self.assertEqual(host.calls, [], "read once")
        with self.assertRaisesRegex(RuntimeError, "running control is not the version"):
            host.definition(TARGET["service"], B)
        (Extracting.CODE / "remote/Caddyfile").unlink()
        del image["remote/Caddyfile"]
        with self.assertRaisesRegex(RuntimeError, "holds no compose definition"):
            host.definition(TARGET["service"], A)

    def test_creation_times_compare_whatever_fraction_docker_trims(self):
        self.assertLess(moment("2026-11-15T10:00:00Z"), moment("2026-11-15T10:00:00.1Z"))
        self.assertLess(moment("2026-11-15T10:00:00.45Z"), moment("2026-11-15T10:00:00.5Z"))
        self.assertLess(moment("2026-11-11T08:00:00.999999999Z"), moment("2026-11-15T10:00:00Z"))


class DriftTests(unittest.TestCase):
    """docker-api and the compose services against the active version, read from a real local Git repository."""

    PIN = "ghcr.io/qoeop/trade-docker-api@sha256:" + "1" * 64
    FILES = {"deploy/compose.yaml": f"services:\n  docker-api:\n    image: {PIN}  # moved only by a pull request\n"}

    def setUp(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root)
        self.checkout, self.source = root / "checkout", GitSource(root / "state")
        for path, text in self.FILES.items():
            (self.checkout / path).parent.mkdir(parents=True, exist_ok=True)
            (self.checkout / path).write_text(text)
        env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false",
               "--git-dir", str(self.source.repo), "--work-tree", str(self.checkout)]
        subprocess.run(["git", "init", "-q", "--bare", str(self.source.repo)], env=env, check=True)
        subprocess.run([*git, "add", "-A"], env=env, check=True)
        subprocess.run([*git, "commit", "-qm", "version"], env=env, check=True)
        self.sha = subprocess.run([*git, "rev-parse", "HEAD"], env=env, check=True, capture_output=True,
                                  text=True).stdout.strip()
        self.host = Mock()
        self.host.disk_route.return_value = WEB + self.sha
        self.host.inspect.return_value = {"image": self.PIN}
        self.host.follower.return_value = None  # no compose service, unless a test runs one
        self.source.approved = Mock(return_value={**TARGET, "revision": self.sha})
        clock = patch("deploy.release.time.time", return_value=hours_after_web(3)[1])
        clock.start()
        self.addCleanup(clock.stop)

    def drift(self):
        return release.drift(self.host, self.source)

    def test_a_docker_api_that_follows_the_active_version_says_nothing(self):
        self.assertEqual(self.drift(), {})
        self.host.inspect.assert_called_once_with("trade-ide-docker-api-1")

    def test_a_docker_api_the_release_no_longer_moves_is_named_and_one_it_will_move_is_not(self):
        running = "ghcr.io/qoeop/trade-docker-api@sha256:" + "2" * 64
        self.host.inspect.return_value = {"image": running}
        created = {WEB + self.sha: moment(WEB_CREATED), "trade-ide-docker-api-1": moment(BEFORE)}
        self.host.created.side_effect = created.get
        self.assertEqual(self.drift(), {}, "the next settled tick moves it (Release.follow)")
        created["trade-ide-docker-api-1"] = moment(AFTER)  # a move undone, or the operator's recreate
        self.assertEqual(self.drift(), {}, "the release tries it again")
        created["trade-ide-docker-api-1"] = hours_after_web(2.5)[0]  # the third undone move: retries spent
        facts = self.drift()
        self.assertEqual(list(facts), [f"drift:docker-api:{self.PIN}"])
        self.assertIn(f"docker-api runs {running}, but the active version {self.sha[:12]} pins {self.PIN}",
                      facts[f"drift:docker-api:{self.PIN}"])

    def test_a_service_whose_retries_are_spent_is_named_once_per_version_image(self):
        services = {LEDGER: {"image": OLD_SERVICE, "created": moment(AFTER)}}
        self.host.follower.side_effect = services.get
        self.host.created.return_value = moment(WEB_CREATED)
        self.assertEqual(self.drift(), {}, "an undone move is tried again (Release.follow)")
        services[LEDGER]["created"] = hours_after_web(2.5)[0]
        facts = self.drift()
        self.assertEqual(list(facts), [f"drift:ledger:{TARGET['service']}"])
        self.assertIn(f"ledger runs {OLD_SERVICE}, but the active version {self.sha[:12]} runs {TARGET['service']}",
                      facts[f"drift:ledger:{TARGET['service']}"])
        services[LEDGER]["image"] = TARGET["service"]  # moved by hand: nothing to say
        self.assertEqual(self.drift(), {})
