"""Deployment control tests use temporary files and stand-ins, never an active ledger or engine."""

import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy.release import GitSource, Release
from deploy.paper_host import PAPER
from deploy.release_host import (AGENT, AHEAD, KEPT_RELEASES, WEB, Config, DockerHost, ahead, revision,
                                 route_config, route_name, route_owner)


A, B, C, D = (letter * 40 for letter in "abcd")
TARGET = {"revision": B, "image": "ghcr.io/qoeop/trade-ide@sha256:" + "e" * 64,
          "service": "ghcr.io/qoeop/trade-service@sha256:" + "e" * 64,
          "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "e" * 64}


class Crash(BaseException):
    pass


class Host:
    def __init__(self, state):
        self.state = state
        self.disk = self.live = WEB + A
        self.containers = {WEB + A: True, AGENT + D: True}
        self.calls = []
        self.fail = None
        self.rollback_fails = False
        self.protected_identity = {"paper-worker": {"id": "original", "started": "original"}}
        self.owners = {}  # an owner written with a route; none means the Web's own control

    def checked(self, name, prefix=WEB):
        revision(name, prefix)
        return self.inspect(name)

    def inspect(self, name):
        return {
            "running": self.containers[name],
            "revision": name.removesuffix(AHEAD).rsplit("-", 1)[-1],
            "image": TARGET["image"],
        }

    def exists(self, name):
        return name in self.containers

    def requires_live(self, name):
        return False

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

    def pull(self, sha, image):
        if getattr(self, "on_pull", None):
            self.on_pull()
        return image

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

    def warm(self, name, protected, agent=True):
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

    def disk_owner(self):
        return self.owners.get("disk") or revision(self.disk)

    def live_owner(self):
        return self.owners.get("live") or revision(self.live)

    def switch(self, name, owner):
        self.calls.append(("route", name))
        self.owners["live"] = owner
        if self.rollback_fails and name == WEB + A:
            raise RuntimeError("router unavailable")
        self.live = name
        if self.fail == "crash" and name == WEB + B:
            raise Crash()

    def persist_route(self, name, owner):
        self.disk = name
        self.owners["disk"] = owner

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
        self.release = Release(self.host, self.github)

    def test_success_switches_only_after_readiness_and_commits_disk_route(self):
        before = self.host.protected()
        self.release.apply(TARGET)
        self.assertEqual(self.host.live, WEB + B)
        self.assertEqual(self.host.disk, WEB + B)
        self.assertFalse(self.release.transaction.exists())
        self.assertTrue(self.host.containers[WEB + A], "keep previous Web alive during and after observation")
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
        Release(self.host, self.github).recover()
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
        self.github.ensure.side_effect = [None, RuntimeError("eligibility withdrawn")]
        with self.assertRaisesRegex(RuntimeError, "withdrawn"):
            self.release.apply(TARGET)
        self.assertEqual((self.host.disk, self.host.live), (WEB + A, WEB + A))
        self.assertNotIn(("route", WEB + B), self.host.calls)
        self.assertEqual(self.host.agent(), AGENT + D)


class InstallTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.host = Host(Path(temporary.name))
        self.host.containers = {}
        self.github = Mock()
        self.github.approved.return_value = TARGET
        self.paper = Mock()
        self.paper.router = self.host.state / "paper-router"
        self.paper.pull.return_value = B
        patcher = patch.object(Release, "paper", return_value=Mock(host=self.paper))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.release = Release(self.host, self.github)

    def test_a_new_host_gets_the_admitted_builds_controller_web_and_agent_with_routes(self):
        order = []
        self.paper.persist_route.side_effect = lambda name: order.append(("paper route", name))
        self.paper.create.side_effect = lambda name, *args: order.append(("paper create", name))
        self.release.install()
        self.assertEqual(order, [("paper route", PAPER + B), ("paper create", PAPER + B)],
                         "the controller reads its own route to know it is active")
        self.paper.create.assert_called_once_with(PAPER + B, TARGET["service"], TARGET["runtime"])
        self.github.require_runtime.assert_called_once_with(B, B)
        self.assertEqual(self.host.containers, {WEB + B: True, AGENT + B: True})
        self.assertEqual((self.host.disk, self.host.owners["disk"]), (WEB + B, None))

    def test_install_refuses_an_installed_host_live_or_an_unadmitted_build(self):
        (self.host.state / "router").mkdir()
        (self.host.state / "router" / "active.json").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.release.install()
        (self.host.state / "router" / "active.json").unlink()
        self.github.approved.return_value = {**TARGET, "image": None, "service": None, "runtime": None}
        with self.assertRaisesRegex(RuntimeError, "not admitted"):
            self.release.install()
        with self.assertRaisesRegex(RuntimeError, "Live"):
            Release(self.host, self.github, live=Mock()).install()
        self.assertEqual(self.host.calls, [])
        self.paper.create.assert_not_called()


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
        with patch.object(DockerHost, "registry_serves", side_effect=lambda image: image != gone) as serves:
            host.prune((WEB,), set(), set(), {kept})
        self.assertEqual(host.removed_images(), [old])
        self.assertEqual([call.args[0] for call in serves.call_args_list], [old, gone], "a last copy stays")

    def test_a_failed_candidate_never_takes_the_place_of_a_good_release(self):
        rows = self.rows()  # 0 is the oldest; the three newest failed.
        host = FakeDocker(rows, [], [])
        host.prune((WEB,), {self.NAMES[3]}, set(self.NAMES[4:]))
        self.assertEqual(sorted(host.removed()), sorted([self.NAMES[0], self.NAMES[4], self.NAMES[5]]))

    def test_failed_records_name_the_containers_of_their_kind(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "failed").mkdir()
            (root / "failed" / B).write_text("")
            (root / "paper-failed").mkdir()
            (root / "paper-failed" / C).write_text("")
            (root / "paper-router").mkdir()
            from deploy.paper_host import route_config as paper_route

            (root / "paper-router" / "active.json").write_text(json.dumps(paper_route(PAPER + A)))
            host = Mock(state=root, config=Config(state=root))
            host.disk_route.return_value = WEB + A
            host.managed.return_value = [PAPER + A]
            runtime = "ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64
            host.docker.return_value = json.dumps(["python", "-m", "cli.main", "paper", "serve", f"--runtime={runtime}"])
            Release(host, Mock()).prune()
            self.assertEqual(host.prune.call_args.args[:2], ((WEB, AGENT, PAPER), {WEB + A, PAPER + A}))
            self.assertEqual(host.prune.call_args.args[2], {WEB + B, WEB + B + AHEAD, AGENT + B, PAPER + C})
            self.assertEqual(host.prune.call_args.args[3], {runtime}, "the Paper controller's runtime stays")

    def test_settled_tick_prunes_and_a_failure_changes_nothing(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper") as paper:
            host = Mock(state=Path(directory))
            host.disk_route.return_value = WEB + A
            host.managed.return_value = []
            paper.return_value.host.disk_route.return_value = PAPER + A
            release = Release(host, Mock())
            release.prune()
            host.prune.assert_called_once_with((WEB, AGENT, PAPER), {WEB + A, PAPER + A}, set(), set())
            host.prune.side_effect = RuntimeError("docker rm failed")
            release.prune()

    def test_a_tick_prunes_only_after_it_settled(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper"):
            host = Mock(state=Path(directory))
            host.managed.return_value = []
            host.disk_route.return_value = WEB + A
            host.requires_live.return_value = False
            github = Mock()
            github.choose.return_value = None
            Release(host, github).tick()
            host.prune.assert_called_once()
            host.prune.reset_mock()
            github.choose.side_effect = RuntimeError("git failed")
            with self.assertRaises(RuntimeError):
                Release(host, github).tick()
            host.prune.assert_not_called()

    def test_retired_live_controllers_go_except_the_owners_and_those_of_remaining_webs(self):
        from deploy.live_host import LIVE

        with tempfile.TemporaryDirectory() as directory, patch.object(Release, "paper") as paper:
            root = Path(directory)
            (root / "failed").mkdir()
            (root / "failed" / D).write_text("")
            host = Mock(state=root)
            host.disk_route.return_value = WEB + B
            paper.return_value.host.disk_route.return_value = PAPER + A
            host.disk_owner.return_value, host.live_owner.return_value = A, A  # Web-only beside A's control
            host.managed.side_effect = lambda prefix: [WEB + B, WEB + C + AHEAD] if prefix == WEB else []
            host.mounted_sockets.return_value = {root / "live" / A / "socket"}
            live = Mock()
            live.runtimes.return_value = {"ghcr.io/qoeop/trade-runtime@sha256:" + "f" * 64}
            Release(host, Mock(), live=live).prune()
            prefixes, active, failed, runtimes = host.prune.call_args.args
            self.assertEqual(runtimes, live.runtimes.return_value)
            self.assertEqual(prefixes, (WEB, AGENT, PAPER, LIVE))
            self.assertEqual(active, {WEB + B, PAPER + A, LIVE + A, LIVE + B, LIVE + C})
            self.assertIn(LIVE + D, failed)
            live.prune.assert_called_once_with({A, B, C})

            host.reset_mock()
            live.reset_mock()
            host.live_owner.side_effect = RuntimeError("router unavailable")
            with patch("deploy.release.report_failure") as reported:
                Release(host, Mock(), live=live).prune()
            reported.assert_called_once()
            self.assertEqual(host.prune.call_args.args[0], (WEB, AGENT, PAPER))  # the rest is still pruned
            live.prune.assert_not_called()

    def test_live_directories_go_with_their_controllers(self):
        from deploy.live_host import LIVE, LiveHost

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "live"
            for sha in (A, B, C, D):
                (root / sha / "socket").mkdir(parents=True)
                (root / sha / "configuration.json").write_text(json.dumps({"runtime": "r-" + sha[0]}))
            (root / "configuration.json").write_text("{}")  # the installed declaration
            (root / ".configuration-backup").write_text("{}")
            web = Mock(state=Path(directory))
            web.managed.return_value = [LIVE + B]
            custody = Path(directory) / "custody"
            (custody / "runs" / "live-1" / "inputs").mkdir(parents=True)
            (custody / "runs" / "live-1" / "inputs" / "manifest.json").write_text(json.dumps({"runtime": {"image_ref": "r-run"}}))
            live = LiveHost(web, Mock())
            with patch.object(LiveHost, "declaration_value", return_value={"root": str(custody)}):
                self.assertEqual(live.runtimes(), {"r-a", "r-b", "r-c", "r-d", "r-run"}, "a Live run never pulls again")
            LiveHost(web, Mock()).prune({A})
            web.managed.assert_called_once_with(LIVE)
            self.assertEqual(sorted(path.name for path in root.iterdir()),
                             sorted([".configuration-backup", "configuration.json", A, B]))

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

    def test_a_web_ahead_of_its_control_selects_its_own_revision_again(self):
        with tempfile.TemporaryDirectory() as root:
            source = self.source(root, TARGET)
            failed = Path(root) / "failed"
            self.assertEqual(source.choose(B, failed, again=True), TARGET)
            failed.mkdir()
            (failed / B).write_text("uncommitted")
            self.assertIsNone(source.choose(B, failed, again=True))

    def test_the_protocol_is_one_declared_line_none_when_absent_and_never_a_guess(self):
        with tempfile.TemporaryDirectory() as root:
            source = GitSource(Path(root))

            def tree(text, listed="live/protocol.py\n"):
                return lambda *args, **kwargs: listed if args[0] == "ls-tree" else text

            source.git = Mock(side_effect=tree('"""Doc."""\n\nPROTOCOL = 3\n'))
            self.assertEqual(source.protocol(B), 3)
            self.assertEqual([call.args for call in source.git.call_args_list],
                             [("ls-tree", "--name-only", B, "--", "live/protocol.py"), ("show", f"{B}:live/protocol.py")])
            source.git = Mock(side_effect=tree("", listed=""))
            self.assertIsNone(source.protocol(B), "a revision without the file declares none")
            for text in ("", "PROTOCOL = 0\n", "PROTOCOL = 1\nPROTOCOL = 2\n", "PROTOCOL = 2  # x\n"):
                source.git = Mock(side_effect=tree(text))
                with self.assertRaises(ValueError, msg=text):
                    source.protocol(B)
            source.git = Mock(side_effect=RuntimeError("git failed"))
            with self.assertRaisesRegex(RuntimeError, "git failed"):
                source.protocol(B)  # a failed read is not an undeclared protocol
            with self.assertRaisesRegex(RuntimeError, "invalid"):
                source.protocol("main")

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
        for changed in ("deploy/Dockerfile", "ide/agent/src/chat.ts", "ledger/db.py", "uv.lock"):
            source.git.return_value = changed
            self.assertTrue(source.agent_changed(A, B))

    def test_control_is_unchanged_only_by_paths_it_never_loads(self):
        source = GitSource(Path("/unused"))
        source.ancestor = Mock(return_value=True)
        for paths in ("ide/web/src/App.tsx\nide/web/package.json", "docs/plans/x.zh.md", "tests/live/test_x.py",
                      ".github/workflows/ide-image.yml", ".agents/skills/x/SKILL.md", "deploy/remote/README.md",
                      "deploy/README.md", "deploy/compose.yaml", "AGENTS.md", "ide/overview/src/main.ts",
                      "ide/agent/src/chat.ts", ""):
            source.git = Mock(return_value=paths)
            self.assertFalse(source.control_changed(A, B), paths)
        for changed in ("ide/research_graph/live_proxy.py", "ide/ide.py", "ide/README.md", "live/release.py",
                        "deploy/release.py", "deploy/Dockerfile", "deploy/entrypoint.sh", "uv.lock", "pyproject.toml",
                        ".dockerignore", "engine/x.py", "new-top-level/x", "ide/web/src/a.ts\ncli/main.py"):
            source.git = Mock(return_value=changed)
            self.assertTrue(source.control_changed(A, B), changed)
        source.ancestor.return_value = False
        with self.assertRaisesRegex(RuntimeError, "not an ancestor"):
            source.control_changed(A, B)

    def test_route_carries_only_an_owner_other_than_its_own_web(self):
        own = route_config(WEB + B, B)
        self.assertEqual(own, route_config(WEB + B, None))
        self.assertNotIn("@id", own["apps"]["http"]["servers"]["ide"]["routes"][0])
        self.assertEqual(route_owner(own), B)
        moved = route_config(WEB + B, A)
        self.assertEqual(moved["apps"]["http"]["servers"]["ide"]["routes"][0]["@id"], "live-" + A)
        self.assertEqual((route_name(moved), route_owner(moved)), (WEB + B, A))
        moved["apps"]["http"]["servers"]["ide"]["routes"][0]["@id"] = "live-unknown"
        with self.assertRaisesRegex(RuntimeError, "Live owner"):
            route_owner(moved)
        with self.assertRaisesRegex(RuntimeError, "owner revision"):
            route_config(WEB + B, "not-a-revision")

    def test_a_web_ahead_of_its_control_keeps_its_revision_and_routes_with_its_owner(self):
        name = WEB + B + AHEAD
        self.assertLessEqual(len(name), 63, "Caddy dials the container name as one DNS label")
        self.assertEqual(revision(name), B)
        self.assertTrue(ahead(name))
        self.assertFalse(ahead(WEB + B))
        for wrong in (WEB + B + "-post", WEB + "x" + AHEAD, AGENT + B + AHEAD):
            self.assertFalse(ahead(wrong))
        with self.assertRaises(RuntimeError):
            revision(AGENT + B + AHEAD, AGENT)
        config = route_config(name, A)
        self.assertEqual((route_name(config), route_owner(config)), (name, A))
        host = DockerHost(Config())
        host.docker = Mock(return_value="\n".join([WEB + A, name, WEB + B + "-post", AGENT + B + AHEAD]))
        self.assertEqual(host.managed(WEB), [WEB + A, name])
        self.assertEqual(host.managed(AGENT), [])

    def test_the_host_domain_and_data_root_come_from_the_installed_env_file(self):
        def compose(stdout, code=0):
            return Mock(return_value=Mock(returncode=code, stdout=stdout, stderr="no such flag"))
        env = Path("/etc/trade/remote.env")
        run = compose("HOME=/root\nTRADE_DOMAIN=www.trade.test\nTRADE_DATA=/data/trade\nX=a=b\n")
        config = Config.installed(env, run)
        self.assertEqual((config.domain, config.data), ("www.trade.test", Path("/data/trade")))
        self.assertEqual(run.call_args.args[0][:4], ["docker", "compose", "--env-file", str(env)])
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

    def test_router_state_and_docker_lifecycle_reject_non_web_or_non_agent_names(self):
        self.assertEqual(route_name(route_config(WEB + A, None)), WEB + A)
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
        lines = [{"bundle": "old", "versions": ["v1"], "created_at": 1},
                 {"bundle": "new", "versions": ["v2"], "created_at": 2}]
        runs = {"runs": [{"candidate": "v1", "state": "running"}]}
        host.probe = Mock(side_effect=lambda name, path: {"lines": lines} if path == "/api/lines" else runs)
        self.assertEqual(host.lines(WEB + B), ["old"])
        runs = {"runs": [{"candidate": "from-an-earlier-ledger", "state": "running"}]}
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
        host.probe = Mock(return_value={"runs": []})
        host.live_route = Mock(side_effect=[WEB + B, WEB + C])
        with self.assertRaisesRegex(RuntimeError, "authentication probe"):
            host.observe(WEB + B, [], {})

    def test_observation_requires_existing_paper_data_to_keep_advancing(self):
        host = DockerHost(Config(observe_seconds=0))
        host.ensure_protected = Mock()
        host.health = Mock()
        host.auth_denied = Mock()
        host.live_route = Mock(return_value=WEB + B)
        before = {"runs": [{"id": 3, "state": "running", "last": 100}]}
        host.probe = Mock(return_value=before)
        with self.assertRaisesRegex(RuntimeError, "did not advance"):
            host.observe(WEB + B, [], {})
        host.probe = Mock(side_effect=[before, {"runs": [{"id": 3, "state": "running", "last": 101}]}])
        host.observe(WEB + B, [], {})


if __name__ == "__main__":
    unittest.main()
