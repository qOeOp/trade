"""Replay stage containers run only the layout's modules, with existing read-only inputs and one writable /reports."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from shared.errors import Refusal
from replay import entry, seams
from runtime import container


IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/arm64", "runtime_contract": "replay-contract@v8"}


class StageCommandTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for name in ("reports", "audit"):
            (self.root / name).mkdir()
        self.layout = seams.current.layout("replay-contract@v8")

    def command(self, mounts, module=None, argv=("--run", "/native/reports")):
        return seams.current.container_command(IDENTITY, mounts, module or self.layout["audit_module"], list(argv),
                                               "replay-x-trial-1-audit")

    def test_each_stage_refusal(self):
        reports = (self.root / "audit", "/reports", False)
        cases = [({"module": "engine.other"}, [reports], "MODULE_NOT_IN_LAYOUT"),
                 ({}, [(Path("relative"), "/inputs/x", True), reports], "MOUNT_HOST_PATH_INVALID"),
                 ({}, [(self.root / "missing", "/inputs/x", True), reports], "MOUNT_HOST_PATH_INVALID"),
                 ({}, [(self.root / "reports", "/tmp/x", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "//tmp", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/opt/trade/engine", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/opt", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/native/", True), (self.root / "reports", "/native", True), reports],
                  "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/reports/.", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/reports", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "inputs", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/native/reports", False), reports], "MOUNT_WRITABLE_NOT_REPORTS"),
                 ({}, [(self.root / "reports", "/native/reports", True)], "REPORTS_MOUNT_MISSING"),
                 ({"argv": ["--run", 1]}, [reports], "ARGV_INVALID")]
        for options, mounts, code in cases:
            with self.subTest(code=code, mounts=mounts), self.assertRaises(Refusal) as caught:
                self.command(mounts, **options)
            self.assertEqual(caught.exception.code, code)


    def test_a_stage_has_its_memory_limit_without_swap_and_is_kept_for_its_exit_state(self):
        command = self.command([(self.root / "audit", "/reports", False)])
        self.assertEqual(command[:4], ["docker", "run", "--name", "replay-x-trial-1-audit"])
        memory = command.index("--memory")
        self.assertEqual(command[memory:memory + 4], ["--memory", "24g", "--memory-swap", "24g"])
        self.assertNotIn("--rm", command)


class MemoryLimitTests(unittest.TestCase):
    """seams._run reads the kept container's exit state, removes it and raises MemoryLimit when the kernel killed
    it at its limit."""

    def run_stage(self, oom_killed: str):
        calls = []

        def docker(argv, **kwargs):
            calls.append(argv[:2])
            return subprocess.CompletedProcess(argv, 0, stdout=oom_killed + "\n", stderr="")
        sink = type("Sink", (), {"write": lambda self, chunk: None})()
        # a stand-in client exiting as a SIGKILLed container does; the arguments after -c reach only sys.argv
        command = [sys.executable, "-c", "raise SystemExit(137)", "--name", "replay-x-trial-1-audit"]
        with patch.object(seams.subprocess, "run", side_effect=docker):
            try:
                return seams._run(command, sink, sink, None), calls
            except seams.MemoryLimit as exc:
                return exc, calls

    def test_a_container_killed_at_its_limit_raises_and_is_removed(self):
        raised, calls = self.run_stage("true")
        self.assertIsInstance(raised, seams.MemoryLimit)
        self.assertEqual((raised.exit_code, calls), (137, [["docker", "inspect"], ["docker", "rm"]]))

    def test_any_other_exit_is_returned_and_the_container_removed(self):
        self.assertEqual(self.run_stage("false"), (137, [["docker", "inspect"], ["docker", "rm"]]))


def _runtime_image() -> str | None:
    """A local runtime image's digest reference, when Docker answers; the real-container test needs one."""
    if shutil.which("docker") is None:
        return None
    try:
        found = subprocess.run(["docker", "image", "ls", "--digests", "--format", "{{json .}}",
                                "ghcr.io/qoeop/trade-runtime"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    for line in found.stdout.splitlines() if found.returncode == 0 else ():
        row = json.loads(line)
        if row.get("Digest", "").startswith("sha256:"):
            return f"{row['Repository']}@{row['Digest']}"
    return None


IMAGE = _runtime_image()


@unittest.skipUnless(IMAGE, "needs Docker and a local ghcr.io/qoeop/trade-runtime image")
class RealContainerMemoryLimitTests(unittest.TestCase):
    def test_a_real_stage_over_a_low_limit_is_killed_at_it_and_removed(self):
        platform = subprocess.run(["docker", "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", IMAGE],
                                  capture_output=True, text=True, check=True).stdout.strip()
        identity = {**IDENTITY, "image_ref": IMAGE, "image_digest": IMAGE.split("@")[1], "platform": platform}
        with tempfile.TemporaryDirectory() as folder, patch.object(container, "STAGE_MEMORY", "64m"):
            root = Path(folder)
            (root / "audit").mkdir()
            name = f"replay-memory-limit-test-{root.name}".lower()
            command = seams.current.container_command(identity, [(root / "audit", "/reports", False)],
                                                      seams.current.layout(identity["runtime_contract"])["audit_module"],
                                                      [], name)
            self.assertIn("64m", command)
            # the stage's own options and image; a workload that holds 512 MiB instead of the module
            command = command[:command.index(IMAGE) + 1] + ["-c", "x = bytearray(512 << 20); x[::4096] = b'1' * len(x[::4096])"]
            with self.assertRaises(seams.MemoryLimit) as caught:
                entry._stage(command, name, root, "audit", None, None)
            self.assertEqual(caught.exception.exit_code, 137)
            gone = subprocess.run(["docker", "inspect", name], capture_output=True, text=True)
            self.assertNotEqual(gone.returncode, 0, "the stage container is removed")


if __name__ == "__main__":
    unittest.main()
