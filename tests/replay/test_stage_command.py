"""Replay stage containers run the modules of the layout the image reports, with existing read-only inputs and
one writable /reports."""

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ledger.errors import Refusal
from registration import seams as registration_seams
from replay import seams
from research.records.runtime import BACKTEST_LAYOUT, ENGINE_LAYOUT


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
        self.layout = seams.current.layout("r1-native-v5", ENGINE_LAYOUT["source_paths"])

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

    def test_the_image_reported_layout_picks_the_stage_modules_and_the_key_names(self):
        inputs = {"root": str(self.root / "reports"), "membership_file": str(self.root / "coverage.json"),
                  "symbols": ["BTCUSDT"], "identity": {"market_commit": "c" * 32}}
        for layout, runner, fingerprint, account in ((BACKTEST_LAYOUT, "backtest.run", None, "native_account"),
                                                     (ENGINE_LAYOUT, "engine.run", "engine.compare", "account")):
            with self.subTest(runner=runner):
                found = seams.current.layout("r1-native-v5", dict(layout["source_paths"]))
                self.assertEqual((found["runner_module"], found["fingerprint_module"]), (runner, fingerprint))
                native = {"symbols": ["BTCUSDT"], account: {"venue": "BINANCE"}}
                stand_in = {"runtime_contract": "r1-native-v5", "source_file_paths": dict(layout["source_paths"]),
                            "effective_config": native}
                with patch("research.records.runtime.inspect_runtime", return_value=stand_in):
                    inspection = registration_seams.DEFAULT.inspect_runtime(IDENTITY, ["--start", "x"], inputs)
                self.assertEqual(inspection["effective_config"]["account"], {"venue": "BINANCE"})
                self.assertEqual(inspection["native_effective_config"], native)
                self.command([(self.root / "audit", "/reports", False)], module=found["audit_module"])
        with self.assertRaises(Refusal) as caught:
            seams.current.layout("r1-native-v5", {"runner_source_sha256": "elsewhere/run.py"})
        self.assertEqual(caught.exception.code, "RUNTIME_PROBE_INVALID")


if __name__ == "__main__":
    unittest.main()
