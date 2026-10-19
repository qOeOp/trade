"""Replay stage containers run only the layout's modules, with existing read-only inputs and one writable /reports."""

from pathlib import Path
import tempfile
import unittest

from ledger.errors import Refusal
from replay import seams


IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/arm64", "runtime_contract": "r1-native-v5"}


class StageCommandTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for name in ("reports", "audit"):
            (self.root / name).mkdir()
        (self.root / "coverage.json").write_text("{}")
        self.layout = seams.current.layout("r1-native-v5")

    def command(self, mounts, module=None, argv=("--run", "/native/reports")):
        return seams.current.container_command(IDENTITY, mounts, module or self.layout["audit_module"], list(argv),
                                               "replay-x-trial-1-audit")

    def test_the_audit_stage_reads_the_reports_and_the_receipt_and_writes_only_reports(self):
        command = self.command([(self.root / "reports", "/native/reports", True),
                                (self.root / "coverage.json", "/native/input-coverage.json", True),
                                (self.root / "audit", "/reports", False)])
        mounts = [command[index + 1] for index, value in enumerate(command) if value == "--mount"]
        self.assertEqual([value.endswith(",readonly") for value in mounts], [True, True, False])
        self.assertEqual(command[:4], ["docker", "run", "--name", "replay-x-trial-1-audit"])
        self.assertEqual(command[-4:], ["-m", self.layout["audit_module"], "--run", "/native/reports"])

    def test_each_stage_refusal(self):
        reports = (self.root / "audit", "/reports", False)
        cases = [({"module": "engine.other"}, [reports], "MODULE_NOT_IN_LAYOUT"),
                 ({}, [(Path("relative"), "/inputs/x", True), reports], "MOUNT_HOST_PATH_INVALID"),
                 ({}, [(self.root / "missing", "/inputs/x", True), reports], "MOUNT_HOST_PATH_INVALID"),
                 ({}, [(self.root / "reports", "/tmp/x", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/reports", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "inputs", True), reports], "MOUNT_TARGET_INVALID"),
                 ({}, [(self.root / "reports", "/native/reports", False), reports], "MOUNT_WRITABLE_NOT_REPORTS"),
                 ({}, [(self.root / "reports", "/native/reports", True)], "REPORTS_MOUNT_MISSING"),
                 ({"argv": ["--run", 1]}, [reports], "ARGV_INVALID")]
        for options, mounts, code in cases:
            with self.subTest(code=code, mounts=mounts), self.assertRaises(Refusal) as caught:
                self.command(mounts, **options)
            self.assertEqual(caught.exception.code, code)


if __name__ == "__main__":
    unittest.main()
