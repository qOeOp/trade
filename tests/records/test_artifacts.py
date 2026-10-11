"""Replay orchestration: inputs, exploration and a sealed run stored in a throwaway ledger."""

from __future__ import annotations

from argparse import Namespace
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from research.records import artifacts, ledger, records
from research.records.artifacts import ArtifactError, _check_inputs, create_input_identity
from research.records.runtime import LAYOUTS
from tests.records.dolt import BINARY, SKIP, TemporaryLedger
from tests.records.fixtures import reports


SOURCE = b"from nautilus_trader.trading import Strategy\n\n\nclass Fixture(Strategy):\n    pass\n"
REAL_RUN = subprocess.run
IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64, "image_digest": "sha256:" + "b" * 64,
            "platform": "linux/arm64", "runtime_contract": "r1-native-v4"}


def probe(window: dict) -> dict:
    paths = LAYOUTS["r1-native-v4"]["source_paths"]
    return {"runtime_contract": "r1-native-v4", "nautilus_version": "fixture", "python_version": "fixture",
            "dependency_lock_sha256": "c" * 64, "source_files_sha256": {field: "d" * 64 for field in paths},
            "source_file_paths": dict(paths), "audit_source_sha256": "e" * 64, "platform": "linux/arm64",
            "effective_config": {"coins": ["AAA", "BBB"], "start": window["start"], "trade_start": window["trade_start"],
                                 "end": window["end"], "native_account": {"venue": "BINANCE"}}}


class Workspace(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        for name in ("minute", "daily"):
            (self.workspace / name).mkdir()
        self.quantity = self.workspace / "quantity.csv"
        self.quantity.write_text("fixture")
        self.argv = ["--catalog-root", str(self.workspace / "minute"), "--daily-root", str(self.workspace / "daily"),
                     "--quantity-csv", str(self.quantity), "--coins", "AAA", "BBB"]

    def native(self, *, passed=True, audit_passed=True, plans=120, wins=90, start=reports.START):
        """A subprocess.run stand-in: the runner writes reconciling reports, the audit writes audit.json."""
        def execute(command, **kwargs):
            if command[0] != "docker":
                return REAL_RUN(command, **kwargs)
            out = kwargs["cwd"].parent / "reports"
            if "backtest.run" in command and passed:
                reports.write(out, plans=plans, wins=wins, start=start)
                summary = json.loads((out / "summary.json").read_text())
                summary["strategy_source_sha256"] = command[command.index("--strategy-sha256") + 1]
                (out / "summary.json").write_text(json.dumps(summary))
            if "backtest.checks.audit" in command:
                (out / "audit.json").write_text(json.dumps({"passed": audit_passed,
                                                            "findings": [] if audit_passed else ["naked position"]}))
            return subprocess.CompletedProcess(command, 0 if passed else 23)
        return execute


class InputIdentityTests(Workspace):
    def test_new_input_identity_detects_catalog_mutation(self):
        minute = self.workspace / "minute" / "BTC" / "minute"
        daily = self.workspace / "daily" / "BTC" / "daily"
        minute.mkdir(parents=True)
        daily.mkdir(parents=True)
        (minute / "bars.parquet").write_bytes(b"minute")
        (daily / "bars.parquet").write_bytes(b"daily")
        output = self.workspace / "identity.json"
        create_input_identity(catalog_root=self.workspace / "minute", daily_root=self.workspace / "daily",
                              quantity_csv=self.quantity, coins=["BTC"], output=output)
        replay = Namespace(catalog_root=self.workspace / "minute", daily_root=self.workspace / "daily",
                           quantity_csv=self.quantity, coins=["BTC"])
        identity = json.loads(output.read_text())
        self.assertEqual(len(_check_inputs(identity, replay)), 1)
        (minute / "bars.parquet").write_bytes(b"changed")
        with self.assertRaisesRegex(ArtifactError, "bytes differ"):
            _check_inputs(identity, replay)


class ExploreTests(Workspace):
    def test_exploration_reports_one_trial_and_replays_in_the_pinned_sandbox(self):
        draft = self.workspace / "draft.py"
        draft.write_bytes(SOURCE)
        output = Path(tempfile.mkdtemp(prefix="trade-explore-test-")) / "run"
        self.addCleanup(shutil.rmtree, output.parent)
        window = reports.write(self.workspace / "window", plans=1)
        with patch("research.records.runtime.resolve", return_value=IDENTITY), \
             patch("research.records.runtime.inspect_runtime", return_value=probe(window)), \
             patch("research.records.trials.report_trial", return_value=11) as trial, \
             patch.object(artifacts.subprocess, "run", side_effect=self.native()) as calls:
            result = artifacts.explore(ledger={"name": "x"}, strategy_file=draft, strategy_class="Fixture",
                                       output=output, runtime=None, runner_argv=self.argv)
        self.assertEqual((result["status"], result["trial_id"]), ("passed", 11))
        self.assertEqual((result["readings"]["plans_closed"], result["readings"]["plan_win_rate"]), (120, 0.75))
        self.assertEqual(trial.call_args.kwargs["mode"], "explore")
        self.assertEqual(trial.call_args.kwargs["strategy_source_sha256"], hashlib.sha256(SOURCE).hexdigest())
        runner = calls.call_args_list[0].args[0]
        self.assertIn(IDENTITY["image_ref"], runner)
        self.assertEqual(runner[runner.index("--network") + 1], "none")
        self.assertNotIn("--strategy-binding", runner)
        self.assertTrue((output / "reports" / "orders.csv").is_file())

    def test_exploration_output_must_be_temporary_and_new(self):
        draft = self.workspace / "draft.py"
        draft.write_bytes(SOURCE)
        with patch("research.records.runtime.resolve") as resolve, \
             patch("research.records.trials.report_trial") as trial:
            for output, message in ((Path.home() / "trade-explore-persistent", "temp"),
                                    (Path(tempfile.gettempdir()), "exists")):
                with self.subTest(output=output), self.assertRaisesRegex(ArtifactError, message):
                    artifacts.explore(ledger={"name": "x"}, strategy_file=draft, strategy_class="Fixture",
                                      output=output, runtime=None, runner_argv=self.argv)
        resolve.assert_not_called()
        trial.assert_not_called()


class ExplorationReadingTests(Workspace):
    def test_an_exploration_directory_gets_the_same_readings_as_a_stored_run(self):
        reports.write(self.workspace / "pilot" / "reports", plans=120, wins=90)
        result = artifacts.report_directory(None, self.workspace / "pilot")
        self.assertEqual((result["plans_closed"], result["plan_win_rate"], result["exploration"]), (120, 0.75, True))
        self.assertAlmostEqual(result["return_drawdown"], result["annual_return"] / result["max_drawdown"])
        with self.assertRaisesRegex(ArtifactError, "no native summary"):
            artifacts.report_directory(None, self.workspace / "minute")


@unittest.skipUnless(BINARY, SKIP)
class SealedRunTests(Workspace):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryLedger("artifacts-test")
        cls.profile = cls.fixture.profile

    @classmethod
    def tearDownClass(cls):
        cls.fixture.close()

    def setUp(self):
        super().setUp()
        self.window = reports.write(self.workspace / "window", plans=120)
        name = f"A{id(self)}"
        ledger.open_round(self.profile, {"goal_id": name, "max_drawdown": 0.2, "min_annual_return": 0.05,
                                         "min_plan_win_rate": 0.6, "drawdown_measure": "native_mark_equity_5m",
                                         "window": {"start": self.window["trade_start"], "end": self.window["end"]},
                                         "known_exposure": "none"})
        self.addCleanup(ledger.close_round, self.profile)
        records.publish_strategy(self.profile, source=SOURCE + name.encode(), strategy_id="fixture",
                                 entry_class="Fixture", description="synthetic", parent=None, difference=None, op=None)
        self.input = self.workspace / "input.json"
        self.input.write_text("{}")

    def seal(self, execute):
        workdirs = []
        real = tempfile.mkdtemp

        def mkdtemp(**kwargs):
            workdirs.append(Path(real(**kwargs)))
            return str(workdirs[-1])

        with patch("research.records.runtime.resolve", return_value=IDENTITY), \
             patch("research.records.runtime.inspect_runtime", return_value=probe(self.window)), \
             patch("research.records.runtime.image_revision", return_value="a" * 40), \
             patch.object(artifacts, "_check_inputs", return_value={"fixture": "unchanged"}), \
             patch.object(artifacts.tempfile, "mkdtemp", side_effect=mkdtemp), \
             patch.object(artifacts.subprocess, "run", side_effect=execute):
            result = artifacts.run(ledger=self.profile, strategy="fixture@1", runtime=None,
                                   input_identity=self.input, runner_argv=self.argv)
        return result, workdirs[0]

    def test_a_sealed_run_is_stored_whole_and_its_directory_removed(self):
        result, workdir = self.seal(self.native())
        self.assertEqual(result["status"], "passed")
        self.assertFalse(workdir.exists())
        report = records.run_report(self.profile, result["run_id"])
        self.assertEqual((report["plans_closed"], report["plan_win_rate"], report["image_revision"]), (120, 0.75, "a" * 40))
        frozen = records.freeze(self.profile, run_id=result["run_id"], source_bundle=None, failed_part=None, note="x",
                                op=None, check_image=False, check_fresh=False)
        self.assertEqual(frozen["result"], "passed")

    def test_a_failed_replay_stores_only_its_reasons(self):
        result, workdir = self.seal(self.native(passed=False))
        self.assertEqual(result["status"], "invalid")
        self.assertFalse(workdir.exists())
        reasons = records.run_report(self.profile, result["run_id"])["failure_reasons"]
        self.assertIn("native runner exited 23", reasons)
        self.assertIn("native summary missing", reasons)

    def test_an_audit_finding_makes_the_run_invalid(self):
        result, _ = self.seal(self.native(audit_passed=False))
        self.assertEqual(result["status"], "invalid")
        self.assertIn("independent native audit found problems",
                      records.run_report(self.profile, result["run_id"])["failure_reasons"])


if __name__ == "__main__":
    unittest.main()
