"""The release control handoff: temporary state directories and a stand-in Docker, never a host."""

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from deploy.control import CONTROLS, CURRENT, EXTRACTOR, HANDOFF, IMAGE_DEPLOY, hand_off, running
from deploy.paper_release import PaperRelease
from deploy.release import Release, failure_summary
from deploy.release_host import JOURNAL_FORMAT, SOURCE, Config, DockerHost

A, B, C = (letter * 40 for letter in "abc")
SERVICE = "ghcr.io/qoeop/trade-service@sha256:" + "e" * 64
TARGET = {"revision": B, "image": "ghcr.io/qoeop/trade-ide@sha256:" + "e" * 64, "service": SERVICE,
          "runtime": "ghcr.io/qoeop/trade-runtime@sha256:" + "e" * 64}
LAUNCHER = Path(__file__).resolve().parents[2] / "deploy/remote/trade-release-tick"
# What the admitted service image holds at /opt/trade/deploy: the control modules beside files that are not.
MODULES = {"__init__.py": "", "release.py": "VERSION = 'b'\n", "control.py": "HANDOFF = 3\n"}


class Docker(DockerHost):
    """Answers what a handoff asks of Docker; it can create a container but never starts one."""

    def __init__(self, state: Path, modules: dict | None = None, revision: str = B):
        super().__init__(Config(state=state))
        self.modules = MODULES if modules is None else modules
        self.labels = {"org.opencontainers.image.source": SOURCE, "org.opencontainers.image.revision": revision}
        self.calls: list[tuple] = []

    def docker(self, *args, check=True, timeout=120):
        self.calls.append(args)
        if args[0] in {"pull", "rm"}:
            return ""
        if args[:2] == ("image", "inspect"):
            return json.dumps({"Architecture": "amd64", "Config": {"Labels": self.labels}, "RepoDigests": [args[-1]]})
        if args[0] == "create":
            return "container-id"
        if args[0] == "cp":
            assert args[1] == f"{EXTRACTOR}:{IMAGE_DEPLOY}"
            target = Path(args[2])
            target.mkdir()
            for name, text in self.modules.items():
                (target / name).write_text(text)
            (target / "entrypoint.sh").write_text("#!/bin/sh\n")
            (target / "docker-api").mkdir()
            (target / "linked.py").symlink_to("/etc/hosts")
            return ""
        raise AssertionError(f"a handoff does not run docker {args[0]}")

    def verbs(self) -> list[str]:
        return [" ".join(call[:2]) if call[0] == "image" else call[0] for call in self.calls]


class HandOffTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.state = Path(directory.name)
        self.controls = self.state / CONTROLS

    def install(self, sha: str) -> None:
        (self.controls / sha / "deploy").mkdir(parents=True)
        os.symlink(sha, self.controls / CURRENT)

    def current(self) -> str | None:
        link = self.controls / CURRENT
        return os.readlink(link) if os.path.islink(link) else None

    def test_the_admitted_image_control_is_copied_without_running_it_and_becomes_current(self):
        self.install(A)
        (self.controls / C).mkdir()  # an older control: neither current nor running
        (self.controls / f"{C}.new").mkdir()  # an interrupted handoff's copy
        docker = Docker(self.state)
        hand_off(docker, TARGET, A)
        self.assertEqual(self.current(), B)
        installed = self.controls / B / "deploy"
        self.assertEqual({path.name: path.read_text() for path in installed.iterdir()}, MODULES)
        self.assertEqual(sorted(path.name for path in self.controls.iterdir()), [A, B, CURRENT])
        self.assertEqual(docker.verbs(), ["pull", "image inspect", "rm", "create", "cp", "rm"])
        self.assertNotIn("start", [call[0] for call in docker.calls])
        self.assertIn(("create", "--name", EXTRACTOR, "--network", "none", SERVICE, "true"), docker.calls)

    def test_an_image_whose_labels_differ_from_admission_is_refused(self):
        self.install(A)
        docker = Docker(self.state, revision=C)
        with self.assertRaisesRegex(RuntimeError, "differs from admission"):
            hand_off(docker, TARGET, A)
        docker.labels = {"org.opencontainers.image.revision": B}  # another repository's image
        with self.assertRaisesRegex(RuntimeError, "differs from admission"):
            hand_off(docker, TARGET, A)
        self.assertEqual(self.current(), A)
        self.assertEqual(docker.verbs(), ["pull", "image inspect"] * 2)
        self.assertFalse((self.controls / B).exists())

    def test_a_control_that_does_not_import_with_the_host_python_is_not_switched_to(self):
        self.install(A)
        for broken in ({**MODULES, "release.py": "match = (\n"}, {"__init__.py": "", "release.py": ""}):
            with self.subTest(modules=sorted(broken)), self.assertRaisesRegex(RuntimeError, "does not import"):
                hand_off(Docker(self.state, broken), TARGET, A)
            self.assertEqual(self.current(), A)
            self.assertFalse((self.controls / B).exists())

    def test_the_bootstrap_copy_hands_over_and_an_installer_run_again_changes_nothing(self):
        docker = Docker(self.state)
        hand_off(docker, TARGET, None)
        self.assertEqual(self.current(), B)
        docker.calls.clear()
        hand_off(docker, TARGET, None)
        self.assertEqual(docker.calls, [])

    def test_the_running_revision_is_the_name_of_the_control_directory(self):
        self.install(A)
        code = self.controls / A / "deploy/control.py"
        self.assertEqual(running(self.state, code), A)
        self.assertEqual(running(self.state, self.controls / CURRENT / "deploy/control.py"), A)
        self.assertIsNone(running(self.state, Path("/opt/trade-release/deploy/control.py")))
        self.assertIsNone(running(self.state))  # this checkout is a bootstrap copy


class TickTests(unittest.TestCase):
    """Release.tick decides between a handoff and a release; routes and release containers are Docker's."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.state = Path(directory.name)
        self.docker = Docker(self.state)
        self.github = Mock()
        self.github.approved.return_value = TARGET
        self.github.ancestor.return_value = True
        paper = patch.object(Release, "paper")
        self.paper = paper.start()
        self.addCleanup(paper.stop)

    def tick(self, control: str | None) -> bool:
        with patch("deploy.release.running", return_value=control):
            return Release(self.docker, self.github).tick()

    def test_a_settled_tick_hands_a_different_admitted_revision_its_own_control_and_releases_nothing(self):
        self.assertTrue(self.tick(A))
        self.assertEqual(os.readlink(self.state / CONTROLS / CURRENT), B)
        self.assertEqual(self.docker.verbs(), ["pull", "image inspect", "rm", "create", "cp", "rm"])
        self.assertFalse((self.state / "router").exists())
        self.assertFalse((self.state / "profiles").exists(), "the host is prepared by the control that runs next")
        self.github.choose.assert_not_called()
        self.paper.return_value.tick.assert_not_called()

    def test_a_control_that_fails_to_prepare_or_recover_still_hands_over_to_the_newer_one(self):
        # Doctor 20261116-06, the user 2026-11-16: a defective control must not keep out the version that fixes it.
        (self.state / "transaction.json").write_text("{}")
        with patch.object(Docker, "prepare", side_effect=RuntimeError("defective")), \
                patch.object(Release, "recover", side_effect=RuntimeError("defective")):
            self.assertTrue(self.tick(A))
        self.assertEqual(os.readlink(self.state / CONTROLS / CURRENT), B)
        self.assertTrue((self.state / "transaction.json").exists(), "the newer control recovers it next")

    def test_a_pending_transaction_is_recovered_by_the_newest_control_and_that_tick_goes_no_further(self):
        for control in (A, B):  # the control that wrote it, or the newer one it handed over to
            for journal in ("transaction.json", "paper-transaction.json"):
                with self.subTest(control=control, journal=journal):
                    self.github.approved.return_value = {**TARGET, "revision": control}
                    (self.state / journal).write_text("{}")
                    settle = lambda *_: (self.state / journal).unlink(missing_ok=True)  # noqa: E731
                    with patch.object(Release, "recover", side_effect=settle) as recover:
                        self.assertFalse(self.tick(control))
                    recover.assert_called_once()
                    self.assertFalse((self.state / journal).exists())
                    self.github.choose.assert_not_called()
                    self.assertEqual(self.docker.calls, [])
                    self.assertFalse((self.state / CONTROLS).exists())

    def test_a_journal_not_in_the_recovering_controls_format_is_refused_and_left_in_place(self):
        web = {"candidate": "trade-release-web-" + A, "previous": "trade-release-web-" + C}
        for name, value in (("transaction.json", {**web, "agent": "trade-release-agent-" + C}),
                            ("transaction.json", {"candidate": web["candidate"]}),
                            ("transaction.json", {**web, "previous": 7}),
                            ("paper-transaction.json", {**web, "agent_before": "trade-release-agent-" + C}),
                            ("paper-transaction.json", ["not", "an", "object"])):
            with self.subTest(name=name, value=value):
                path = self.state / name
                path.write_text(json.dumps(value))
                recovering = (Release(self.docker, self.github, live=Mock()) if name == "transaction.json"
                              else PaperRelease(Mock(state=self.state), self.github))
                with self.assertRaisesRegex(RuntimeError, re.escape(JOURNAL_FORMAT)) as raised:
                    recovering.recover()
                self.assertEqual(failure_summary(raised.exception), "pending journal not in this control's format")
                self.assertEqual(json.loads(path.read_text()), value)
                self.assertEqual(self.docker.calls, [])
                path.unlink()

    def test_the_bootstrap_copy_recovers_nothing_and_only_hands_over(self):
        (self.state / "transaction.json").write_text("{}")
        self.github.approved.return_value = {**TARGET, "image": None}
        with self.assertRaisesRegex(RuntimeError, "waits for an admitted control"):
            self.tick(None)
        self.paper.return_value.recover.assert_not_called()
        self.assertEqual(self.docker.calls, [])
        self.github.approved.return_value = TARGET
        self.assertTrue(self.tick(None))  # the admitted control recovers the pending transaction
        self.paper.return_value.recover.assert_not_called()
        self.assertEqual(os.readlink(self.state / CONTROLS / CURRENT), B)

    def test_the_same_revision_no_admitted_image_or_an_older_one_hands_nothing_over(self):
        release = Release(self.docker, self.github)
        with patch("deploy.release.hand_off") as handed:
            self.assertFalse(release.handoff(B))
            self.github.approved.return_value = {**TARGET, "image": None}
            self.assertFalse(release.handoff(A))
            self.assertFalse(release.handoff(None))
            self.github.approved.return_value = TARGET
            self.github.ancestor.return_value = False  # deploy-ready never moves back; nor does the control
            self.assertFalse(release.handoff(C))
        handed.assert_not_called()


class LauncherTests(unittest.TestCase):
    """The fixed launcher of trade-release.service, with its paths moved into a temporary directory."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.state, self.bootstrap = self.root / "state", self.root / "bootstrap"
        self.bootstrap.mkdir()
        (self.state / CONTROLS / B).mkdir(parents=True)
        self.log = self.root / "log"
        python = self.root / "python3"
        # Each run logs where it ran and exits with the next status in `statuses`.
        python.write_text(f'#!/bin/sh\necho "$(pwd -P) $*" >> {self.log}\n'
                          f'n=$(wc -l < {self.log})\nexit $(sed -n "${{n}}p" {self.root / "statuses"})\n')
        python.chmod(0o755)
        text = LAUNCHER.read_text()
        for name, value in (("state", self.state), ("bootstrap", self.bootstrap), ("python", python)):
            text, count = re.subn(rf"^{name}=.*$", f"{name}={value}", text, flags=re.M)
            self.assertEqual(count, 1, name)
        self.launcher = self.root / "trade-release-tick"
        self.launcher.write_text(text)
        self.launcher.chmod(0o755)

    def run_launcher(self, *statuses: int) -> tuple[int, list[str]]:
        (self.root / "statuses").write_text("".join(f"{status}\n" for status in statuses))
        self.log.unlink(missing_ok=True)
        status = subprocess.run([str(self.launcher)], check=False, timeout=30).returncode
        return status, self.log.read_text().splitlines()

    def test_a_handoff_runs_the_tick_once_more_and_never_twice(self):
        tick = f"{self.bootstrap} -m deploy.release tick"
        self.assertEqual(self.run_launcher(0), (0, [tick]))
        self.assertEqual(self.run_launcher(1), (1, [tick]))
        self.assertEqual(self.run_launcher(HANDOFF, 0), (0, [tick, tick]))
        self.assertEqual(self.run_launcher(HANDOFF, 1), (1, [tick, tick]))
        self.assertEqual(self.run_launcher(HANDOFF, HANDOFF, 0), (0, [tick, tick]))

    def test_it_runs_the_current_control_resolved_and_the_bootstrap_copy_only_without_one(self):
        os.symlink(B, self.state / CONTROLS / CURRENT)
        self.assertEqual(self.run_launcher(0), (0, [f"{self.state / CONTROLS / B} -m deploy.release tick"]))


if __name__ == "__main__":
    unittest.main()
