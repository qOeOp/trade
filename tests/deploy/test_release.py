"""Deployment control tests use temporary files and stand-ins, never an active ledger or engine."""

from contextlib import contextmanager, redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from deploy.live_host import LIVE, LiveBusy
from deploy.notices import Notices
from deploy import generation
from deploy import release
from deploy import release_host
from deploy import services
from deploy.release import Release, failure_summary
from deploy.services import FOLLOW_RETRY_SECONDS
from deploy.source import GitSource
from deploy.paper_host import CONTROLLER_PROBE, PAPER, PaperHost
from deploy.paper_host import route_config as paper_route
from deploy.paper_release import PaperRelease
from deploy.release_host import (AGENT, DEFINITION, DOCKER_API, DOCKER_API_REF, KEPT_RELEASES, LEDGER, MARKET_IMPORT, WEB, Config,
                                 PROBE, DockerHost, HostCondition, ReaderFailure, Registry,
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

IMAGES = {**TARGET, "service": "ghcr.io/qoeop/trade-service@sha256:" + "1" * 64,
          "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "2" * 64}


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


BASE = "https://doltremoteapi.dolthub.com/owner/research"


class Host:
    def __init__(self, state):
        self.state = state
        self.config = Config(state=state)  # names no TRADE_RESEARCH_ORIGIN: nothing to compare a version's line with
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
        if self.containers.get(name):  # DockerHost.discard_failed removes only a stopped one of this revision
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

    def test_rollback_starts_a_stopped_previous_web_before_the_route_returns_to_it(self):
        self.release.journal(WEB + B, WEB + A, AGENT + D)
        self.host.containers.update({WEB + A: False, WEB + B: True})
        self.host.disk = self.host.live = WEB + B
        self.release.recover()
        self.assertTrue(self.host.containers[WEB + A])
        self.assertLess(self.host.calls.index(("start", WEB + A)), self.host.calls.index(("route", WEB + A)))
        self.assertEqual(self.host.live, WEB + A)

    def test_rollback_keeps_the_journal_when_the_previous_web_is_not_the_recorded_one_or_serves_without_login(self):
        for step in ("checked", "auth_denied"):
            with self.subTest(step):
                self.release.journal(WEB + B, WEB + A, AGENT + D)
                self.host.containers.update({WEB + A: True, WEB + B: True})
                self.host.disk = self.host.live = WEB + B
                routed = len(self.host.calls)
                with patch.object(self.host, step, side_effect=RuntimeError(step)), \
                        self.assertRaisesRegex(RuntimeError, step):
                    self.release.recover()
                self.assertTrue(self.release.transaction.exists())
                if step == "checked":
                    self.assertEqual(self.host.calls[routed:], [], "nothing is touched before the previous Web is checked")
                self.release.transaction.unlink()

    def test_failed_rollback_or_independent_route_change_preserves_journal_and_candidate(self):
        self.release.journal(WEB + B, WEB + A, AGENT + D)
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
        self.release.journal(WEB + B, WEB + A, AGENT + D)
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
        self.release = Release(self.host, self.github, live=IdleLive(self.host), paper=paper_release(self.host))
        self.paper = self.release.paper()
        self.controller = self.paper.host

    def settled(self, version):
        self.assertEqual((self.host.disk, self.host.live), (WEB + version, WEB + version))
        self.assertEqual((self.controller.disk, self.controller.live), (paper_route(PAPER + version),) * 2)
        self.assertTrue(self.controller.running[PAPER + version])
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.paper.transaction.exists())

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
                if refuse in summaries:  # a host condition: the version waits (doctors 20261116-05, 20261122-31)
                    self.release.apply(TARGET)
                    [text] = self.release.waits.values()
                    self.assertIn(summaries[refuse], text)
                else:
                    with self.assertRaises(RuntimeError):
                        self.release.apply(TARGET)
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
        self.release = Release(self.host, self.github, live=IdleLive(self.host), paper=paper_release(self.host))
        self.controller = self.release.paper().host
        self.host.config = Config(state=self.host.state, research_origin=BASE)
        self.host.docker = Mock()  # only the faked version() below reads it
        self.wanted = {"origin": BASE, "line": "v0.6", "main": True, "research": 2, "paper": 1}
        self.where = {"remote": BASE, "tracked": ["main"], "line": "v0.5", "head": "h" * 32}
        for patched in (patch.object(generation, "version", side_effect=lambda *_: self.wanted),
                        patch.object(release.Generation, "where", side_effect=lambda *_: self.where)):
            patched.start()
            self.addCleanup(patched.stop)

    def waiting(self):
        """The images one apply pulled, as keys of IMAGES; its waits are the release's."""
        pulled = []

        def pull(reference, pattern, sha=None):
            pulled.append(reference)
            return sha

        self.release.waits = {}
        with patch.object(self.host, "pull", side_effect=pull), patch.object(self.controller, "pull", side_effect=pull):
            self.release.apply(IMAGES)
        return [next(key for key in ("image", "service", "runtime") if IMAGES[key] == item) for item in pulled]

    def test_a_version_waiting_for_its_generation_pulls_only_the_image_that_answers(self):
        # qOeOp/trade#3494: each tick pulled the IDE and runtime images before it asked whether the version waits.
        self.host.docker.return_value = "trade-paper-runner-1"  # a Paper run still runs
        self.assertEqual(self.waiting(), ["service"])
        self.assertEqual(list(self.release.waits), [f"wait:generation:{B}:paper"])
        with patch.object(generation, "place", return_value="unpublished"):
            self.assertEqual(self.waiting(), ["service"])
        self.assertEqual(list(self.release.waits), [f"wait:generation:{B}:mirror"])

    def test_a_cutover_or_move_changes_nothing_until_the_version_is_ready(self):
        self.host.docker.return_value = ""  # no Paper run
        for how in ("cutover", "move"):
            with self.subTest(how), patch.object(generation, "place", return_value=how), \
                    patch.object(release.Generation, "held", return_value=True), \
                    patch.object(release.Generation, "hold") as hold:
                with patch.object(self.controller, "memory_available", return_value=False):
                    self.assertEqual(self.waiting(), ["service", "image"])
                self.assertEqual([key.split(":")[1] for key in self.release.waits], ["host"])
                hold.assert_not_called()
                self.assertEqual(self.waiting(), ["service", "image", "runtime"])
                hold.assert_called_once()

    def cut_over(self):
        (self.host.state / "generation.json").write_text(json.dumps(
            {"kind": "cutover", "line": "v0.6", "revision": B, "service": TARGET["service"],
             "archive": "20261123T000000Z-" + B[:12], "phase": "done", "market": "running"}))

    def settled_tick(self):
        self.github.ancestor.side_effect = lambda before, after: before in (after, D)  # the Agent's D too
        self.github.choose.return_value = None
        fresh = Release(self.host, self.github, live=IdleLive(self.host), paper=self.release.paper())
        with patch.object(release, "running", return_value=B), patch.object(Release, "handoff", return_value=False), \
                patch.object(Release, "follow"), patch.object(Release, "prune"), patch.object(Release, "settle"):
            fresh.tick()

    def test_after_a_cutover_a_rollback_does_not_wait_for_the_previous_version_to_read_the_ledger(self):
        """The previous version cannot read a new generation's ledger: once a cutover is done, a failed release still
        rolls back (and marks the version) instead of keeping its journal for the operator."""
        def cannot_read(name):
            if name == WEB + A:
                raise RuntimeError("SCHEMA_MISMATCH")

        self.host.on_warm = cannot_read
        self.host.fail = "observe"
        self.where = {**self.where, "line": "v0.6"}
        with self.assertRaisesRegex(RuntimeError, "SCHEMA_MISMATCH"):
            self.release.apply(TARGET)  # control: without a cutover the rollback checks the previous Web
        self.assertTrue(self.release.transaction.exists())
        self.setUp()
        self.host.on_warm = cannot_read
        self.host.fail = "observe"
        self.where = {**self.where, "line": "v0.6"}
        self.cut_over()
        with self.assertRaisesRegex(RuntimeError, "failed after switch"):
            self.release.apply(TARGET)
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertFalse(self.release.transaction.exists())
        self.assertTrue((self.release.failed / B).exists())
        self.settled_tick()
        self.assertTrue((self.host.state / "generation.json").exists(), "kept until a version commits on it")
        self.release.failed.joinpath(B).unlink()
        self.host.fail = self.host.on_warm = None
        self.release.apply(TARGET)
        self.assertEqual(self.host.disk, WEB + B)
        self.settled_tick()
        self.assertFalse((self.host.state / "generation.json").exists())

    def test_a_release_interrupted_after_its_web_commit_still_ends_the_cutover(self):
        """A journal left `done` would let a later release's rollback skip its checks of the previous version."""
        self.where = {**self.where, "line": "v0.6"}
        self.cut_over()
        with patch.object(PaperRelease, "commit", side_effect=Crash()), self.assertRaises(Crash):
            self.release.apply(TARGET)
        self.assertEqual(self.host.disk, WEB + B)
        self.assertTrue((self.host.state / "generation.json").exists())
        self.settled_tick()  # recovers Paper
        self.settled_tick()
        self.assertFalse((self.host.state / "generation.json").exists())

    def test_a_tick_finishes_an_interrupted_cutover_before_it_recovers_anything(self):
        self.host.state.joinpath("control").mkdir()
        with patch.object(release, "running", return_value=B), \
                patch.object(Release, "handoff", return_value=False), \
                patch.object(release.Generation, "resume", return_value=True) as resume, \
                patch.object(Release, "recover") as recover:
            self.assertFalse(self.release.tick())
        resume.assert_called_once_with(B)
        recover.assert_not_called()

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


class HostConditionTests(unittest.TestCase):
    """Doctor 20261122-31: a protected container that restarted, or a Live run started during a release, rolled the
    version back and wrote failed/<revision>, so a host event blocked that version for good."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = Host(Path(temporary.name))
        self.github = Mock()
        self.live = IdleLive(self.host)
        self.release = Release(self.host, self.github, live=self.live, paper=paper_release(self.host))

    def rolled_back(self):
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertEqual(self.host.agent(), AGENT + D)
        self.assertFalse(self.release.transaction.exists())
        self.assertFalse(self.release.paper().transaction.exists())

    def test_a_protected_container_that_restarts_during_the_release_waits_and_marks_nothing(self):
        def restarted(name=WEB + B):
            if name == WEB + B:  # not the previous Web's warm-up in the rollback
                raise HostCondition("protected container changed during release: trade-ide-ledger-1")

        for phase in ("on_warm", "on_observe"):
            with self.subTest(phase=phase):
                self.setUp()
                setattr(self.host, phase, restarted)
                self.release.apply(TARGET)
                self.rolled_back()
                self.assertFalse(self.release.failed.exists(), "a host event is no verdict on the version")
                self.assertEqual(list(self.release.waits), [f"wait:host:{B}:protected container changed"])
                setattr(self.host, phase, None)
                self.release.apply(TARGET)  # the next tick tries again
                self.assertEqual(self.host.disk, WEB + B)

    def test_a_live_run_started_during_the_release_waits_and_marks_nothing(self):
        calls = []
        barrier = self.live.barrier

        @contextmanager
        def busy_at_commit(name, service=None, *, idle=False, wait_for_lock=False):
            calls.append(wait_for_lock)
            if idle and wait_for_lock and name == WEB + B:  # the final account admission
                raise LiveBusy("Live is active or unresolved; keep the current Web/control pair")
            with barrier(name, service, idle=idle, wait_for_lock=wait_for_lock) as held:
                yield held

        self.live.barrier = busy_at_commit
        self.release.apply(TARGET)
        self.rolled_back()
        self.assertFalse(self.release.failed.exists())
        self.assertEqual(list(self.release.waits), [f"wait:host:{B}:Live account admission unavailable"])

    def test_a_product_failure_still_marks_the_version_failed(self):
        self.host.fail = "observe"
        with self.assertRaises(RuntimeError):
            self.release.apply(TARGET)
        self.rolled_back()
        self.assertTrue((self.release.failed / B).exists())
        self.assertEqual(self.release.waits, {})

    def test_a_journal_found_at_the_start_of_a_tick_still_marks_the_version_failed(self):
        with patch.object(Release, "clear", side_effect=Crash()), self.assertRaises(Crash):
            self.release.apply(TARGET)
        self.release.recover()
        self.assertTrue((self.release.failed / B).exists(), "an interrupted release is not known to be the host's")


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
        self.paper.create_controller.side_effect = lambda name, *args: order.append(("paper create", name))
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
        self.paper.create_controller.assert_called_once_with(PAPER + B, TARGET["service"], TARGET["runtime"])
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
        self.paper.create_controller.assert_not_called()
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
        if args[:2] == ("image", "rm"):
            return f"Untagged: {args[2]}"
        if args[0] == "rm":
            return args[1]
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
        host = self.host(services)
        before = host.protected()
        self.assertEqual(sorted(before), sorted(services))
        host.ensure_protected(before)
        with self.assertRaisesRegex(HostCondition, "changed during release: trade-ide-ledger-1"):  # restarted since
            host.ensure_protected({**before, services[0]: {**before[services[0]], "restarts": 1}})
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
        self.assertEqual(sorted(host.removed()), sorted(prefix + letter * 40 for prefix in (WEB, AGENT, PAPER)
                                                        for letter in "0123"[:4 - KEPT_RELEASES]))

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

    def test_the_images_of_a_waiting_version_stay(self):
        # qOeOp/trade#3494: no container of it exists, so each tick removed what the next one pulled.
        ide, service, runtime = IMAGES["image"], IMAGES["service"], IMAGES["runtime"]
        superseded = [image.replace(image[-64:], "f" * 64) for image in (ide, service, runtime)]
        host = FakeDocker({}, [ide, service, runtime, *superseded], [])
        with patch.object(Registry, "serves", return_value=True):
            host.prune((WEB,), set(), set(), set(), frozenset(), frozenset({ide, service, runtime}))
        self.assertEqual(host.removed_images(), superseded)

    def test_a_tick_spares_the_images_of_the_version_it_left_waiting(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper"):
            host = Mock(state=Path(directory))
            host.managed.return_value = []
            host.disk_route.return_value = WEB + A
            github = Mock()
            github.choose.return_value = IMAGES
            with patch("deploy.release.running", return_value=A), patch.object(Release, "handoff", return_value=False), \
                    patch.object(Release, "apply"):
                Release(host, github, live=IdleLive(host)).tick()
            self.assertEqual(host.prune.call_args.args[5], {IMAGES[key] for key in ("image", "service", "runtime")})

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
        self.assertEqual(sorted(host.removed()), sorted([*self.NAMES[:4 - KEPT_RELEASES], self.NAMES[4], self.NAMES[5]]))

    def test_a_failed_candidate_older_than_the_routed_version_goes_entirely(self):
        host = FakeDocker(self.rows(), [], [])
        removed = host.prune((WEB,), {self.NAMES[3]}, set(self.NAMES[4:]), set(), frozenset({self.NAMES[6]}))
        self.assertEqual(sorted(removed), sorted(self.NAMES[index] for index in (0, 1, 4, 6)),
                         "the routed version and the previous good one stay, and the newest failed one not older")

    def test_markers_of_failed_versions_older_than_the_routed_one_go_with_their_containers(self):
        # Doctor 20261122-34: failed/ only grew, and the newest failed container of a version long
        # superseded stayed for good.
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper") as paper:
            root = Path(directory)
            for sha in (B, C, D):
                (root / "failed").mkdir(exist_ok=True)
                (root / "failed" / sha).write_text("")
            host = Mock(state=root)
            host.disk_route.return_value = WEB + A
            host.prune.return_value = [WEB + B]
            host.managed.side_effect = lambda prefix, running_only=False: [WEB + D] if prefix == WEB else []
            paper.return_value.host.disk_route.return_value = PAPER + A
            paper.return_value.host.managed.return_value = []
            github = Mock()
            github.ancestor.side_effect = lambda before, after: after == A and before in (B, D)  # C is newer
            checked = Release(host, github, live=IdleLive(host))
            checked.prune()
            self.assertEqual(host.prune.call_args.args[4], frozenset(prefix + sha for sha in (B, D)
                                                                     for prefix in (WEB, AGENT, PAPER, LIVE)))
            self.assertEqual(sorted(path.name for path in (root / "failed").iterdir()), [C, D],
                             "a newer failed version stays blocked; one whose container stays keeps its marker")
            self.assertEqual(checked.cleaned, [WEB + B, f"failed/{B}"])

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
            host.prune.assert_called_once_with((WEB, AGENT, PAPER, LIVE), {WEB + A, PAPER + A}, set(), set(),
                                               frozenset(), frozenset())
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
            with patch("deploy.release.running", return_value=A), patch.object(Release, "settle"):
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
            prefixes, active, failed, runtimes, *_ = host.prune.call_args.args
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


def running(image, created, definition=None):
    """FollowHost's facts of a running compose service; `definition` names the service whose version definition it
    was created from (the stand-in for compose's configuration hash), None for an older one."""
    return {"image": image, "created": moment(created), "hash": definition, "mounts": {}}


def wanted(service=TARGET["service"], proxy=PROXY):
    """Follow.definitions of version A, as compose would create each service: the stand-in hash is its name."""
    images = {"ledger": service, "market-import": service, "docker-api": proxy, "ide-router": "caddy",
              "paper-router": "caddy", "oauth2": "oauth2-proxy", "edge": "caddy"}
    return {name: {"image": image, "hash": name, "configs": {}} for name, image in images.items()}


def hours_after_web(hours):
    """A Docker creation time `hours` after the routed Web's, and the clock reading at it."""
    return (moment(f"2026-11-15T{10 + int(hours):02d}:{int(hours % 1 * 60):02d}:00.1Z"),
            services.epoch(moment(WEB_CREATED)) + hours * 3600 + 0.1)


class FollowHost(Host):
    """The settled host of version A: Web, Paper controller and the compose services the release may move."""

    def __init__(self, state):
        super().__init__(state)
        self.services = {LEDGER: running(OLD_SERVICE, BEFORE), MARKET_IMPORT: running(OLD_SERVICE, BEFORE),
                         DOCKER_API: running(PROXY, BEFORE, "docker-api")}  # already on A's pin and definition
        self.environments = []
        self.pulls = []  # whether each recreate let compose pull a third-party image
        self.on_recreate = {}  # container -> what its new container does once created
        self.denied = 0  # public authentication probes
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

    def recreate(self, service, name, image, healthy, files, env, pull=False):
        assert files == COMPOSE, "the active version's own compose files"
        if self.during:
            self.during()
        self.recreated.append((service, image, healthy))
        self.environments.append(env)
        self.pulls.append(pull)
        # What compose creates from the version's files: its definition when on the version's image.
        wanted = {OLD_SERVICE: None, OLD_PROXY: None}.get(image, service)
        self.services[name] = {"image": image, "created": self.stamp, "hash": wanted, "mounts": {}}
        if name in self.on_recreate:
            self.on_recreate[name]()
        if self.after_move is not None:
            self.runs = self.after_move.pop(0) if isinstance(self.after_move, list) else self.after_move
        if service in self.broken and image in self.broken:
            raise RuntimeError("compose service did not start on its image: " + service)

    def auth_denied(self):
        self.denied += 1

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
        sleep = patch("deploy.services.time.sleep")
        sleep.start()
        self.addCleanup(sleep.stop)
        self.now = services.epoch(moment(AFTER)) + 1  # just after what a move or its undo created
        clock = patch("deploy.services.time.time", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)
        self.wanted = wanted()
        for name, stand_in in (("definitions", lambda host, files, env: self.wanted),
                               ("follows", lambda host, container, found, want: (found["image"], found["hash"])
                                == (want["image"], want["hash"]))):
            definition = patch.object(services, name, stand_in)
            definition.start()
            self.addCleanup(definition.stop)

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
        self.assertEqual(self.host.environments, [{"TRADE_SERVICE_IMAGE": TARGET["service"],
                                                   "TRADE_DOCKER_API_IMAGE": PROXY}] * 3)
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
        self.assertEqual(self.host.environments[3]["TRADE_DOCKER_API_IMAGE"], OLD_PROXY, "put back by its variable")
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

        with patch("deploy.services.until_ready", side_effect=ready):
            self.release.follow(WEB + A)
        self.assertEqual(polled, [True], "the move waits for the controller's retry before the tick's notices")
        self.assertEqual(len(self.host.recreated), 2)
        self.host.services = {LEDGER: running(OLD_SERVICE, BEFORE)}
        self.host.recreated.clear()
        self.host.after_move = failing  # a recovery failure that lasts: reported by the tick's notices, not undone
        with patch("deploy.services.until_ready", side_effect=lambda check, *args, **kwargs: check()):
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
        with patch("deploy.services.until_ready", side_effect=lambda check, *args, **kwargs: check()):
            self.release.follow(WEB + A)
        self.assertEqual([image for _, image, _ in self.host.recreated], [TARGET["service"]] * 2, "nothing undone")
        self.assertEqual(self.host.readers, [(WEB + A, True, False)])

    def test_unreadable_readers_after_the_move_put_the_services_back(self):
        self.controller.controller_health = Mock(side_effect=RuntimeError("Paper controller cannot read its database"))
        with patch("deploy.services.until_ready", side_effect=lambda check, *args, **kwargs: check()):
            with self.assertRaises(RuntimeError):
                self.release.follow(WEB + A)
        self.assertEqual([image for _, image, _ in self.host.recreated][-2:], [OLD_SERVICE, OLD_SERVICE])


class DefinitionFollowTests(unittest.TestCase):
    """Doctor 20261122-32: only an image change moved a service, so a version that changed the Caddyfile, OAuth2
    Proxy's settings or a router's definition needed the operator's `--force-recreate`, and OAuth2 Proxy and edge kept
    mounting files of a control directory the handoff had removed."""

    unfrozen = FollowTests.unfrozen

    def setUp(self):
        FollowTests.setUp(self)
        self.host.services = {LEDGER: running(TARGET["service"], BEFORE, "ledger"),
                              MARKET_IMPORT: running(TARGET["service"], BEFORE, "market-import"),
                              DOCKER_API: running(PROXY, BEFORE, "docker-api"),
                              "trade-ide-ide-router-1": running("caddy", BEFORE, "ide-router"),
                              "trade-ide-paper-router-1": running("caddy", BEFORE, "paper-router"),
                              "trade-ide-oauth2-1": running("oauth2-proxy", BEFORE, None),  # an older definition
                              "trade-ide-edge-1": running("caddy", BEFORE, None)}

    def test_a_service_whose_definition_changed_is_recreated_under_the_same_conditions(self):
        seen = []
        self.host.during = lambda: seen.append((self.controller.live, list(self.live.held)))
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [("oauth2", "oauth2-proxy", False), ("edge", "caddy", False)])
        self.assertEqual(self.host.pulls, [True, True], "an image the definition pins by digest")
        self.assertEqual(seen, [(paper_route(PAPER + A, "all"), [(WEB + A, True)])] * 2)
        self.assertEqual(self.host.denied, 1, "the public boundary through edge and OAuth2 Proxy is read after")
        self.unfrozen()
        self.host.recreated.clear()
        self.release.follow(WEB + A)
        self.assertEqual(self.host.recreated, [], "a service on the version's definition stays")

    def test_a_new_paper_router_is_paused_again_for_the_rest_of_the_move(self):
        self.host.services["trade-ide-paper-router-1"]["hash"] = None
        self.host.services[LEDGER]["hash"] = None
        router = "trade-ide-paper-router-1"
        # A new router loads the unpaused route from disk.
        self.host.on_recreate[router] = lambda: setattr(self.controller, "live", self.controller.disk)
        seen = []
        self.host.during = lambda: seen.append(self.controller.live)
        self.release.follow(WEB + A)
        self.assertEqual([name for name, _, _ in self.host.recreated][:2], ["ledger", "paper-router"])
        self.assertEqual(seen[-1], paper_route(PAPER + A, "all"), "Paper writes still wait after the new router")
        self.unfrozen()

    def test_a_failed_definition_move_is_not_put_back_and_fails_the_tick(self):
        self.host.services[LEDGER]["image"] = OLD_SERVICE  # the image moves too, and is put back
        self.host.broken = {"edge", "caddy"}
        with self.assertRaises(RuntimeError) as raised:
            self.release.follow(WEB + A)
        self.assertEqual(failure_summary(raised.exception), "service move failed and was undone")
        self.assertEqual(self.host.recreated, [("ledger", TARGET["service"], True), ("oauth2", "oauth2-proxy", False),
                                               ("edge", "caddy", False), ("ledger", OLD_SERVICE, True)],
                         "a definition cannot be put back; an image a variable names can")
        self.unfrozen()


class DefinitionTests(unittest.TestCase):
    """Follow.definitions and Follow.follows on what compose prints and Docker holds."""

    CADDYFILE = "/var/lib/trade-release/control/" + A + "/deploy/remote/Caddyfile"
    MARKET = '{"name": "market", "holds": "market", "kind": null, "root": "/srv/trade/market"}\n'

    def follow(self, held):
        host = Mock()
        project = {"services": {"edge": {"image": "caddy", "configs": [{"source": "remote-caddy",
                                                                       "target": "/etc/caddy/Caddyfile"}]},
                                "market-import": {"image": TARGET["service"], "configs": [{"source": "market"}]}},
                   "configs": {"remote-caddy": {"file": self.CADDYFILE}, "market": {"content": self.MARKET}}}

        def compose(files, *args, env):
            self.assertEqual(env, RecreateTests.ENV)
            return "edge 1111\nmarket-import 2222\n" if "--hash" in args else json.dumps(project)

        def docker(*args, binary=False, **kwargs):
            self.assertEqual(args[:2], ("cp", "trade-ide-market-import-1:/market"))
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode="w") as out:
                data = held.encode()
                info = tarfile.TarInfo("market")
                info.size = len(data)
                out.addfile(info, io.BytesIO(data))
            return archive.getvalue()

        host.compose, host.docker = compose, docker
        return host

    def test_compose_hash_config_file_and_inline_content_are_each_compared(self):
        host = self.follow(self.MARKET)
        wanted = services.definitions(host, COMPOSE, RecreateTests.ENV)
        self.assertEqual(wanted["edge"], {"image": "caddy", "hash": "1111",
                                          "configs": {"/etc/caddy/Caddyfile": {"file": self.CADDYFILE}}})
        edge = {"image": "caddy", "hash": "1111", "mounts": {"/etc/caddy/Caddyfile": self.CADDYFILE}}
        self.assertTrue(services.follows(host, "trade-ide-edge-1", edge, wanted["edge"]))
        self.assertFalse(services.follows(host, "trade-ide-edge-1", {**edge, "hash": "0000"}, wanted["edge"]))
        moved = {"/etc/caddy/Caddyfile": "/opt/trade-app/deploy/remote/Caddyfile"}  # an earlier checkout's file
        self.assertFalse(services.follows(host, "trade-ide-edge-1", {**edge, "mounts": moved}, wanted["edge"]))
        market = {"image": TARGET["service"], "hash": "2222", "mounts": {}}
        self.assertTrue(services.follows(host, "trade-ide-market-import-1", market, wanted["market-import"]))
        stale = self.follow(self.MARKET.replace("/srv/trade", "/srv/other"))
        self.assertFalse(services.follows(stale, "trade-ide-market-import-1", market, wanted["market-import"]))


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
            controller.controller_health(PAPER + A)
        self.assertEqual(failure_summary(raised.exception), "Paper controller unhealthy at /api/paper/runs: URLError")
        answers["/api/paper/runs"] = {"status": 200, "runs": True}
        answers["/api/paper/health"] = {"status": 200, "runtime": "another", "active": True}
        controller.runtime = Mock(return_value=TARGET["runtime"])
        with self.assertRaises(RuntimeError) as raised:
            controller.controller_health(PAPER + A)
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
        test.controller.controller_health = Mock(side_effect=ReaderFailure("Paper controller", "/api/paper/runs", "HTTP 500"))
        output = io.StringIO()
        with patch("deploy.services.until_ready", side_effect=lambda check, *args, **kwargs: check()), \
                redirect_stderr(output), self.assertRaises(RuntimeError) as raised:
            test.release.follow(WEB + A)
        self.assertEqual(failure_summary(raised.exception), "service move failed and was undone")
        self.assertIn("Compose service move failed: Paper controller unhealthy at /api/paper/runs: HTTP 500",
                      output.getvalue())


class RecreateTests(unittest.TestCase):
    ENV = {"TRADE_SERVICE_IMAGE": TARGET["service"], "TRADE_DOCKER_API_IMAGE": PROXY}

    def test_compose_recreates_one_service_from_the_host_definition_with_the_digests_in_its_environment(self):
        host = DockerHost(Config(state=Path(tempfile.mkdtemp())))
        self.addCleanup(shutil.rmtree, host.state)
        done = subprocess.CompletedProcess([], 0, "", "")
        with patch("deploy.release_host.subprocess.run", return_value=done) as run, \
                patch.object(DockerHost, "inspect", return_value={"image": TARGET["service"], "running": True,
                                                                  "restarts": 0}), \
                patch.object(DockerHost, "condition", return_value={"health": "healthy"}):
            host.recreate("ledger", LEDGER, TARGET["service"], True, COMPOSE, self.ENV)
        command, env = run.call_args.args[0], run.call_args.kwargs["env"]
        self.assertEqual((env["TRADE_SERVICE_IMAGE"], env["TRADE_DOCKER_API_IMAGE"]), (TARGET["service"], PROXY))
        self.assertEqual(command[:5], ["docker", "--config", str(host.state / "docker"), "--host",
                                       "unix:///var/run/docker.sock"])
        self.assertEqual(command[5:8], ["compose", "--env-file", "/etc/trade/remote.env"])
        self.assertEqual([command[i + 1] for i, arg in enumerate(command) if arg == "-f"], COMPOSE)
        self.assertEqual(command[-1], "ledger")
        for flag in ("--no-deps", "--wait", "--detach", "--force-recreate"):  # a config file's change too
            self.assertIn(flag, command)
        self.assertEqual(command[command.index("--pull") + 1], "never", "the release pulled and checked it")
        with patch("deploy.release_host.subprocess.run", return_value=done), \
                patch("deploy.release_host.time.sleep"), \
                patch.object(DockerHost, "inspect", return_value={"image": OLD_SERVICE, "running": True,
                                                                  "restarts": 0}):
            with self.assertRaisesRegex(RuntimeError, "did not start"):
                host.recreate("market-import", MARKET_IMPORT, TARGET["service"], False, COMPOSE, self.ENV)

    def test_a_service_not_healthy_after_compose_s_wait_did_not_start(self):
        # Compose's wait can time out and exit 0.
        host = DockerHost(Config(state=Path(tempfile.mkdtemp())))
        self.addCleanup(shutil.rmtree, host.state)
        started = {"image": TARGET["service"], "running": True, "restarts": 0}
        with patch("deploy.release_host.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "", "")), \
                patch("deploy.release_host.time.sleep"), patch.object(DockerHost, "inspect", return_value=started), \
                patch.object(DockerHost, "condition") as condition:
            for health in ("starting", "unhealthy"):
                condition.return_value = {"health": health}
                with self.subTest(health=health), self.assertRaises(RuntimeError) as raised:
                    host.recreate("ledger", LEDGER, TARGET["service"], True, COMPOSE, self.ENV)
                self.assertEqual(failure_summary(raised.exception), f"ledger is {health} after its wait")
            condition.return_value = {"health": "unhealthy"}  # market-import's says the data lags, not that it failed
            host.recreate("market-import", MARKET_IMPORT, TARGET["service"], False, COMPOSE, self.ENV)
            condition.return_value = {"health": None}  # no health check
            host.recreate("ledger", LEDGER, TARGET["service"], True, COMPOSE, self.ENV)

    def test_a_third_party_image_pinned_by_the_definition_is_pulled_by_compose(self):
        host = DockerHost(Config(state=Path(tempfile.mkdtemp())))
        self.addCleanup(shutil.rmtree, host.state)
        done = subprocess.CompletedProcess([], 0, "", "")
        with patch("deploy.release_host.subprocess.run", return_value=done) as run, \
                patch("deploy.release_host.time.sleep"), \
                patch.object(DockerHost, "inspect", return_value={"image": "caddy", "running": True, "restarts": 0}):
            host.recreate("edge", "trade-ide-edge-1", "caddy", False, COMPOSE, self.ENV, pull=True)
        command = run.call_args.args[0]
        self.assertEqual((command[command.index("--pull") + 1], command[-1]), ("missing", "edge"))

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
    """Every compose service against the active version's definition, once the release no longer moves it (doctors
    20261116-04 and 20261122-33)."""

    def setUp(self):
        FollowTests.setUp(self)
        self.host.services = {LEDGER: running(TARGET["service"], BEFORE, "ledger"),
                              DOCKER_API: running(PROXY, BEFORE, "docker-api"),
                              "trade-ide-edge-1": running("caddy", BEFORE, "edge")}

    def drift(self):
        return services.drift(self.host, self.github)

    def test_services_on_the_version_say_nothing(self):
        self.assertEqual(self.drift(), {})
        self.assertEqual(self.host.definitions, [], "nothing recreated since the Web: nothing to compare")

    def test_a_service_the_release_no_longer_moves_is_named_once_per_version(self):
        for name, image in ((DOCKER_API, OLD_PROXY), ("trade-ide-edge-1", "caddy")):
            with self.subTest(name=name):
                service = name.removeprefix("trade-ide-").removesuffix("-1")
                self.host.services[name] = running(image, BEFORE, None)
                self.assertEqual(self.drift(), {}, "the next settled tick moves it (Release.follow)")
                self.host.services[name]["created"] = moment(AFTER)  # a move undone, or the operator's recreate
                self.assertEqual(self.drift(), {}, "the release tries it again")
                self.host.services[name]["created"] = hours_after_web(2.5)[0]  # the third undone move
                self.now = hours_after_web(3)[1]
                facts = self.drift()
                self.assertEqual(list(facts), [f"drift:{service}:{A}"])
                self.assertIn(f"{service} runs {OLD_PROXY}, but the active version {A[:12]} runs {PROXY}"
                              if image == OLD_PROXY else
                              f"{service} differs from the definition of the active version {A[:12]}",
                              facts[f"drift:{service}:{A}"])
                self.host.services[name] = running(wanted()[service]["image"], AFTER, service)
                self.assertEqual(self.drift(), {}, "recreated by hand from the version's files")
                self.now = services.epoch(moment(AFTER)) + 1

    def test_a_newer_admitted_version_leaves_drift_to_its_release(self):
        self.host.services[LEDGER] = running(OLD_SERVICE, BEFORE, None)
        self.host.services[LEDGER]["created"] = hours_after_web(2.5)[0]
        self.now = hours_after_web(3)[1]
        self.assertIn(f"drift:ledger:{A}", self.drift())
        self.github.approved.return_value = TARGET  # B, not yet released or failed: its own notices say so
        self.assertEqual(self.drift(), {})


class SettledHost:
    """The release containers and compose services of version A as Docker reports them, its Web routed."""

    def __init__(self, state: Path):
        image, service = TARGET["image"], TARGET["service"]
        self.state = state
        self.containers = {WEB + A: [True, A, image], AGENT + A: [True, A, image], PAPER + A: [True, A, service],
                           LIVE + A: [True, A, service], WEB + D: [False, D, image], LIVE + D: [False, D, service]}
        self.services = {}
        for container in (LEDGER, MARKET_IMPORT, DOCKER_API, "trade-ide-edge-1"):
            name = container.removeprefix("trade-ide-").removesuffix("-1")
            self.services[container] = running(wanted()[name]["image"], BEFORE, name)
        self.routed, self.about = WEB + A, {"status": 200, "version": "0.5.0"}
        self.unlike = []  # DockerHost.installed: what install-release.sh installed unlike the version's copies

    def disk_route(self):
        return WEB + A

    def live_route(self):
        return self.routed

    def exists(self, name):
        return name in self.containers

    def inspect(self, name):
        running, revision, image = self.containers[name]
        return {"running": running, "revision": revision, "image": image}

    def agent(self):
        [name] = [name for name, (running, _, _) in self.containers.items() if name.startswith(AGENT) and running]
        return name

    def managed(self, prefix, running_only=False):
        return [name for name, (running, _, _) in self.containers.items()
                if name.startswith(prefix) and (running or not running_only)]

    def follower(self, name):
        return self.services.get(name)

    def definition(self, service, sha):
        assert (service, sha) == (TARGET["service"], A), "the routed version's own compose files"
        return COMPOSE

    def probe(self, name, path, routed=False):
        assert (name, path, routed) == (WEB + A, "/api/about", True)
        return self.about

    def installed(self, service, sha):
        assert (service, sha) == (TARGET["service"], A)
        return self.unlike


class SettledTests(unittest.TestCase):
    """Doctor 20261122-33: a release reported nothing once it committed, so a host left partly on the old version
    (a compose service on an old definition, a stopped Live control) went unseen until something broke."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = SettledHost(Path(temporary.name))
        self.github = Mock()
        self.github.approved.return_value = {**TARGET, "revision": A}
        self.github.docker_api.return_value = PROXY
        self.paper = Mock()
        self.paper.disk_route.return_value = self.paper.live_route.return_value = PAPER + A
        self.release = Mock(host=self.host, github=self.github, failed=self.host.state / "failed",
                            live=IdleLive(self.host))
        self.release.paper.return_value.host = self.paper
        for name, stand_in in (("definitions", lambda host, files, env: wanted()),
                               ("follows", lambda host, container, found, want: (found["image"], found["hash"])
                                == (want["image"], want["hash"]))):
            definition = patch.object(services, name, stand_in)
            definition.start()
            self.addCleanup(definition.stop)

    def settled(self, cleaned=()):
        return services.settled(self.release, list(cleaned))

    def test_a_host_on_the_routed_version_is_reported_live_once_with_what_stays(self):
        self.release.failed.mkdir()
        (self.release.failed / C).write_text("")
        facts = self.settled([WEB + "0" * 40, "ghcr.io/qoeop/trade-service@sha256:" + "0" * 64])
        self.assertEqual(facts, {f"settled:{A}": (
            f"v0.5.0 live: 8/8 services on {A[:12]} (Web, Agent, Paper controller, Live control, ledger, "
            f"market-import, docker-api, edge). Kept for a return by hand: {D[:12]}. Cleaned this tick: "
            f"trade-release-web-{'0' * 12}, trade-service@{'0' * 12}. Failed markers: {C[:12]}.")})
        self.assertEqual(list(self.settled()), [f"settled:{A}"], "the same fact: sent once (deploy/notices.py)")

    def test_an_agent_of_another_version_is_named(self):
        del self.host.containers[AGENT + A]
        self.host.containers[AGENT + D] = [True, D, "ghcr.io/qoeop/trade-ide@sha256:" + "d" * 64]
        self.assertIn(f"Agent runs {D[:12]}, not this version's", self.settled()[f"settled:{A}:diverged"])

    def test_each_part_off_the_version_is_named(self):
        cases = {
            "Web is not routed": lambda: setattr(self.host, "routed", WEB + D),
            f"Paper controller runs {OLD_SERVICE}": lambda: self.host.containers[PAPER + A].__setitem__(2, OLD_SERVICE),
            "Paper controller is not routed": lambda: setattr(self.paper.live_route, "return_value", PAPER + D),
            "Live control is stopped": lambda: self.host.containers[LIVE + A].__setitem__(0, False),
            "Live control is not routed": lambda: self.host.containers[LIVE + D].__setitem__(0, True),
            f"Agent carries revision {D}": lambda: self.host.containers[AGENT + A].__setitem__(1, D),
            "edge differs from the version's definition":
                lambda: self.host.services["trade-ide-edge-1"].__setitem__("hash", None),
            "ledger differs from the version's definition":
                lambda: self.host.services[LEDGER].__setitem__("image", OLD_SERVICE),
        }
        for said, change in cases.items():
            with self.subTest(said):
                self.setUp()
                change()
                [(key, text)] = self.settled().items()
                self.assertEqual(key, f"settled:{A}:diverged")
                self.assertIn(said, text)
                self.assertIn("v0.5.0 is routed, but 1 of 8 services do not match its admitted record", text)

    def test_a_launcher_or_unit_unlike_the_versions_copy_is_named_beside_the_live_notice(self):
        # Doctor 20261122-34: the release service cannot write /opt or /etc, and nothing said a version changed them.
        self.host.unlike = ["/etc/systemd/system/trade-release.service"]
        facts = self.settled()
        self.assertEqual(sorted(facts), [f"settled:{A}", f"settled:{A}:installed"])
        self.assertIn("The installed /etc/systemd/system/trade-release.service differ from v0.5.0's own copies",
                      facts[f"settled:{A}:installed"])
        self.assertIn("install-release.sh control", facts[f"settled:{A}:installed"])

    def test_installed_compares_the_launcher_and_units_with_the_versions_copies(self):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, root)
        installed = tuple((name, root / "host" / Path(name).name) for name, _ in release_host.INSTALLED)

        class Copies(DockerHost):
            CODE = root / "control" / A / "deploy"

            def definition(self, service, sha):
                return []

        for name, path in installed:
            (Copies.CODE / name).parent.mkdir(parents=True, exist_ok=True)
            (Copies.CODE / name).write_text(f"# {name}\n")
            path.parent.mkdir(exist_ok=True)
            path.write_text(f"# {name}\n")
        host = Copies(Config(state=root))
        with patch.object(release_host, "INSTALLED", installed):
            self.assertEqual(host.installed(TARGET["service"], A), [])
            installed[0][1].write_text("# an older launcher\n")
            installed[2][1].unlink()
            self.assertEqual(host.installed(TARGET["service"], A), [str(installed[0][1]), str(installed[2][1])])

    def test_an_unread_version_names_the_revision_and_a_newer_admitted_version_says_nothing(self):
        self.host.about = {"status": 502}
        self.assertIn(f"{A[:12]} live: 8/8 services on {A[:12]}", self.settled()[f"settled:{A}"])
        self.github.approved.return_value = TARGET  # B is on its way, or failed: its own notices say so
        self.assertEqual(self.settled(), {})

    def test_the_tick_sends_the_settled_notice_once_and_keeps_it_through_an_unread_tick(self):
        sent = []
        notices = Notices(self.host.state, call=lambda token, method, body: sent.append(body["text"]),
                          log=lambda line: None)
        notices._token = lambda: ("token", 1)
        settled = [{"settled:x": "live"}, None, {"settled:x": "live"}]

        def tick(self):
            self.settled = settled.pop(0)
            return False

        self.host.condition = Mock(return_value=None)
        with patch.object(Release, "tick", tick), patch.object(release, "drift", return_value={}), \
                patch.object(Notices, "watch"):
            for _ in range(3):
                release.tick(self.host, notices)
                self.assertEqual(notices.found["settled"], {"settled:x": "live"})
        self.assertEqual(sent, ["live"], "sent once while it lasts")

    def test_a_settled_check_that_cannot_read_leaves_the_notice_as_it_was(self):
        with patch.object(release, "settled", side_effect=RuntimeError("docker inspect failed")), \
                redirect_stderr(io.StringIO()) as said:
            checked = Release(self.host, self.github, live=IdleLive(self.host), paper=Mock())
            checked.settle()
        self.assertIsNone(checked.settled)
        self.assertIn("Settled check skipped", said.getvalue())
