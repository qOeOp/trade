"""Custody integrity and recovery boundaries using a small sealed fixture."""

import json
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from research.records import artifacts
from research.records.artifacts import ArtifactError
from research.records.artifacts import _files
from research.records.artifacts import _sha
from research.records.artifacts import _check_inputs
from research.records.artifacts import _private_root
from research.records.artifacts import backup
from research.records.artifacts import create_input_identity
from research.records.artifacts import restore
from research.records.artifacts import verify
from research.records.common import RecordError


class FrozenSourceLayoutTests(unittest.TestCase):
    """Disposable Git fixtures; no native economics or Dolt writes are asserted."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        self.repo = self.workspace / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.root_patch = patch.object(artifacts, "ROOT", self.repo)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.stage = self.workspace / "stage"
        self.stage.mkdir()

    def write(self, name, content):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self):
        self.write("pyproject.toml", "# frozen project dependencies\n")
        self.write("uv.lock", "# frozen dependency lock\n")
        subprocess.run(["git", "add", "."], cwd=self.repo, check=True)
        subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                        "commit", "-qm", "Disposable frozen source fixture"], cwd=self.repo, check=True)
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.repo).decode().strip()

    def module_layout(self):
        self.write("backtest/__init__.py", "")
        self.write("backtest/r1/__init__.py", "")
        self.write("backtest/r1/run_portfolio.py", "from backtest.r1.helper import VALUE\nprint(VALUE)\n")
        self.write("backtest/r1/helper.py", "from research.r1_variants.variant import VALUE\n")
        self.write("research/r1_variants/__init__.py", "")
        self.write("research/r1_variants/variant.py", "from .leaf import VALUE\n")
        self.write("research/r1_variants/leaf.py", "VALUE = 'frozen import closure'\n")
        self.write("strategies/r1.py", "# complete strategy source fixture\n")
        self.write("backtest/r1/checks/__init__.py", "")
        self.write("backtest/r1/checks/audit_tiered_native.py", "print('frozen audit')\n")
        self.write("backtest/r1/unused_diagnostic.py", "# captured R1 diagnostic source\n")
        self.write("research/unrelated.py", "# outside R1 snapshot roots\n")

    def summary(self):
        files = {
            "strategy_source_sha256": "strategies/r1.py",
            "runner_source_sha256": "backtest/r1/run_portfolio.py",
        }
        return {"source_file_paths": files, **{field: _sha(self.stage / "source" / name)
                for field, name in files.items()}}

    def seal(self, summary, runner_args=None):
        reports = self.stage / "reports"
        reports.mkdir()
        if summary is not None:
            (reports / "summary.json").write_text(json.dumps(summary))
        manifest = {
            "schema_version": 1, "run_id": "fixture", "attempt_id": "fixture-attempt",
            "source_commit": self.commit_id, "input_identity_sha256": "a" * 64,
            "status": "failed", "problems": ["Synthetic fixture, no native replay"],
            "record_binding": {"id": "attempt:fixture-attempt", "commit": "fixture-fixed", "revision": 1},
            "files": _files(self.stage),
        }
        if runner_args is not None:
            manifest["runner_args"] = runner_args
        (self.stage / "manifest.json").write_text(json.dumps(manifest))
        root = self.workspace / "seals"
        root.mkdir()
        self.stage.rename(root / "fixture")
        return root

    def test_legacy_snapshot_resolves_sibling_imports_and_frozen_dependency_pins(self):
        self.write("strategies/r1/run_portfolio.py", "from replay_util import VALUE\nprint(VALUE)\n")
        self.write("strategies/r1/replay_util.py", "VALUE = 'old frozen source'\n")
        self.write("strategies/r1/audit_tiered_native.py", "print('legacy audit')\n")
        self.write("strategies/r1/unused.py", "# preserved legacy source root\n")
        commit = self.commit()
        self.write("pyproject.toml", "# live project changed\n")
        self.write("uv.lock", "# live lock changed\n")
        self.write("strategies/r1/replay_util.py", "VALUE = 'live mutation'\n")
        self.assertEqual(artifacts._snapshot_source(commit, self.stage), commit)
        frozen = self.stage / "source"
        self.assertEqual((frozen / "uv.lock").read_text(), "# frozen dependency lock\n")
        self.assertEqual((frozen / "pyproject.toml").read_text(), "# frozen project dependencies\n")
        self.assertEqual((frozen / "strategies/r1/unused.py").read_text(), "# preserved legacy source root\n")
        command = artifacts._source_command(frozen)
        self.assertEqual(command, [sys.executable, str(frozen / artifacts.LEGACY_RUNNER)])
        self.assertEqual(subprocess.check_output(command, cwd=frozen).decode().strip(), "old frozen source")
        self.assertEqual(artifacts._source_command(frozen, audit=True)[1], str(frozen / artifacts.LEGACY_AUDIT))

    def test_module_snapshot_includes_known_roots_and_runs_from_frozen_source(self):
        self.module_layout()
        commit = self.commit()
        self.write("research/r1_variants/leaf.py", "VALUE = 'live mutation'\n")
        artifacts._snapshot_source(commit, self.stage)
        frozen = self.stage / "source"
        self.assertTrue((frozen / "strategies/r1.py").is_file())
        self.assertTrue((frozen / "research/r1_variants/leaf.py").is_file())
        self.assertTrue((frozen / "backtest/r1/unused_diagnostic.py").is_file())
        self.assertFalse((frozen / "research/unrelated.py").exists())
        self.assertEqual(artifacts._source_command(frozen), [sys.executable, "-m", "backtest.r1.run_portfolio"])
        self.assertEqual(subprocess.check_output(artifacts._source_command(frozen), cwd=frozen).decode().strip(), "frozen import closure")
        self.assertEqual(artifacts._source_command(frozen, audit=True), [sys.executable, "-m", "backtest.r1.checks.audit_tiered_native"])

    def test_conflicting_or_missing_standalone_layout_is_rejected(self):
        self.module_layout()
        self.write("strategies/r1/run_portfolio.py", "")
        with self.assertRaisesRegex(ArtifactError, "conflicting"):
            artifacts._snapshot_source(self.commit(), self.stage)
        with self.assertRaisesRegex(ArtifactError, "standalone strategy"):
            artifacts._source_layout({artifacts.MODULE_RUNNER})

    def test_missing_frozen_variant_root_is_rejected(self):
        self.module_layout()
        shutil.rmtree(self.repo / "research/r1_variants")
        with self.assertRaisesRegex(ArtifactError, "no R1 Python source root"):
            artifacts._snapshot_source(self.commit(), self.stage)

    def test_missing_frozen_module_audit_is_rejected(self):
        self.module_layout()
        (self.repo / artifacts.MODULE_AUDIT).unlink()
        with self.assertRaisesRegex(ArtifactError, "no native audit source"):
            artifacts._snapshot_source(self.commit(), self.stage)

    def test_git_symlink_cannot_be_captured_as_python_source(self):
        self.module_layout()
        (self.repo / "strategies/r1.py").unlink()
        (self.repo / "strategies/r1.py").symlink_to("../outside.py")
        with self.assertRaisesRegex(ArtifactError, "regular Git file"):
            artifacts._snapshot_source(self.commit(), self.stage)

    def test_new_summary_requires_exact_safe_source_paths_and_digest_binding(self):
        self.module_layout()
        artifacts._snapshot_source(self.commit(), self.stage)
        summary = self.summary()
        artifacts._check_source_summary(self.stage, summary)
        for name in ("../outside.py", "/absolute.py", "backtest//r1/run_portfolio.py", "backtest/r1/./run_portfolio.py"):
            summary["source_file_paths"]["strategy_source_sha256"] = name
            with self.assertRaisesRegex(ArtifactError, "unsafe"):
                artifacts._check_source_summary(self.stage, summary)
        summary = self.summary()
        summary["source_file_paths"]["strategy_source_sha256"] = "research/r1_variants/missing.py"
        with self.assertRaisesRegex(ArtifactError, "no frozen"):
            artifacts._check_source_summary(self.stage, summary)
        summary = self.summary()
        summary["source_file_paths"]["strategy_source_sha256"] = artifacts.MODULE_RUNNER
        with self.assertRaisesRegex(ArtifactError, "disagrees with digest field"):
            artifacts._check_source_summary(self.stage, summary)
        summary = self.summary()
        summary["native_node_source_sha256"] = "b" * 64
        with self.assertRaisesRegex(ArtifactError, "every non-null source digest"):
            artifacts._check_source_summary(self.stage, summary)
        summary = self.summary()
        del summary["source_file_paths"]
        with self.assertRaisesRegex(ArtifactError, "no source_file_paths"):
            artifacts._check_source_summary(self.stage, summary)
        summary = self.summary()
        summary["strategy_source_sha256"] = "c" * 64
        with self.assertRaisesRegex(ArtifactError, "differs from frozen"):
            artifacts._check_source_summary(self.stage, summary)

    def test_legacy_seal_keeps_original_summary_mapping_and_manifest_bytes(self):
        source = self.stage / "source/strategies/r1/strategy.py"
        source.parent.mkdir(parents=True)
        source.write_text("# old frozen strategy\n")
        self.commit_id = "a" * 40
        root = self.seal({"strategy_source_sha256": _sha(source), "brooks_confirmed_strategy_source_sha256": "b" * 64})
        manifest = root / "fixture/manifest.json"
        before = manifest.read_bytes()
        self.assertTrue(verify(root, "fixture")["verified"])
        self.assertEqual(manifest.read_bytes(), before)

    def test_registration_uses_new_actual_paths_with_mocked_publication_boundary(self):
        self.module_layout()
        self.commit_id = self.commit()
        artifacts._snapshot_source(self.commit_id, self.stage)
        summary = self.summary()
        root = self.seal(summary)
        store = Mock()
        store.adapter.status.return_value = {"version": "fixture-version"}
        store.publish_record.return_value = {"commit": "fixture-publication"}
        with patch("research.records.store.open_store", return_value=store), \
             patch.object(artifacts, "_attempt_snapshot", return_value=({}, {})), \
             patch.object(artifacts.importlib.metadata, "version", return_value="fixture-native-version"):
            artifacts.register(root=root, run_id="fixture", role="diagnostic", cost_model="Synthetic fixture only",
                               control_run_id=None, evidence_grade="unknown")
        record = store.publish_record.call_args.args[1]
        self.assertEqual(record["source_revision"]["files"], summary["source_file_paths"])
        self.assertEqual(record["source_files_sha256"], {field: summary[field] for field in summary["source_file_paths"]})
        self.assertEqual(record["source_revision"]["commit"], self.commit_id)

    def register_failed_module(self, signal_variant):
        self.module_layout()
        self.write("research/r1_variants/strategy.py", "# legacy base strategy fixture\n")
        self.write("backtest/r1/native_node.py", "# frozen native runtime fixture\n")
        self.commit_id = self.commit()
        artifacts._snapshot_source(self.commit_id, self.stage)
        root = self.seal(None, ["--signal-variant", signal_variant])
        store = Mock()
        store.adapter.status.return_value = {"version": "fixture-version"}
        store.publish_record.return_value = {"commit": "fixture-publication"}
        with patch("research.records.store.open_store", return_value=store), \
             patch.object(artifacts, "_attempt_snapshot", return_value=({}, {})), \
             patch.object(artifacts.importlib.metadata, "version", return_value="fixture-native-version"):
            result = artifacts.register(root=root, run_id="fixture", role="diagnostic", cost_model="Synthetic pre-summary failure",
                                        control_run_id=None, evidence_grade="unknown")
        self.assertEqual(result["status"], "failed")
        record = store.publish_record.call_args.args[1]
        self.assertEqual(record["integrity"], "failed")
        self.assertEqual(record["failure_reasons"], ["Synthetic fixture, no native replay"])
        self.assertNotIn("window", record)
        self.assertNotIn("account", record)
        self.assertNotIn("summary_ref", record)
        self.assertEqual(record["source_revision"]["files"]["native_node_source_sha256"], "backtest/r1/native_node.py")
        for field, path in record["source_revision"]["files"].items():
            self.assertEqual(record["source_files_sha256"][field], _sha(root / "fixture/source" / path))
        return record

    def test_failed_module_registration_without_summary_keeps_h19a_strategy_identity(self):
        record = self.register_failed_module("support-broad-two-tier-4h")
        self.assertEqual(record["source_revision"]["files"]["strategy_source_sha256"], "strategies/r1.py")

    def test_failed_module_registration_without_summary_keeps_legacy_variant_identity(self):
        record = self.register_failed_module("box-failed-breakout-4h")
        self.assertEqual(record["source_revision"]["files"]["strategy_source_sha256"], "research/r1_variants/strategy.py")

    def test_failed_module_registration_without_summary_requires_frozen_runner_arguments(self):
        self.module_layout()
        artifacts._snapshot_source(self.commit(), self.stage)
        with self.assertRaisesRegex(ArtifactError, "no frozen runner arguments"):
            artifacts._summary_source_files(self.stage, None)

    def test_input_paths_survive_frozen_working_directory(self):
        original = ["--catalog-root", "inputs/minute", "--daily-root=inputs/daily", "--quantity-csv", "q.csv", "--start", "2026-01-01"]
        actual = artifacts._absolute_runner_args(original)
        self.assertEqual(actual[1], str(Path("inputs/minute").resolve()))
        self.assertEqual(actual[2], "--daily-root=" + str(Path("inputs/daily").resolve()))
        self.assertEqual(actual[4], str(Path("q.csv").resolve()))
        self.assertEqual(actual[-2:], ["--start", "2026-01-01"])

    def test_run_seals_frozen_module_execution_and_audit_without_external_state_writes(self):
        self.module_layout()
        self.write("backtest/r1/run_portfolio.py", """
import hashlib
import json
import sys
from pathlib import Path
from strategies import r1

# Synthetic custody orchestration fixture, not a native backtest.
output = Path(sys.argv[sys.argv.index('--output') + 1])
output.mkdir(exist_ok=True)
files = {'strategy_source_sha256': 'strategies/r1.py',
         'runner_source_sha256': 'backtest/r1/run_portfolio.py'}
summary = {'source_file_paths': files, 'integrity_passed': True}
summary.update({'input_start_utc': '2024-01-01T00:00:00Z',
                'period_start_utc': '2024-01-02T00:00:00Z',
                'period_end_utc': '2024-01-03T00:00:00Z',
                'data_interval_minutes': 5,
                'account_model': 'Synthetic contract; no account replay',
                'starting_balance_usdt': '100000', 'sizing': {}})
summary.update({field: hashlib.sha256(Path(name).read_bytes()).hexdigest()
                for field, name in files.items()})
(output / 'summary.json').write_text(json.dumps(summary))
for name in ('orders.csv', 'fills.csv', 'positions.csv', 'account.csv', 'returns_series.csv'):
    (output / name).write_text('synthetic custody fixture, no economics\\n')
print(Path.cwd())
""")
        self.write("backtest/r1/checks/audit_tiered_native.py", """
import json
import sys
from pathlib import Path
# Synthetic audit fixture, not an order-integrity claim.
output = Path(sys.argv[sys.argv.index('--output') + 1])
output.write_text(json.dumps({'passed': True, 'findings': []}))
print(Path.cwd())
""")
        commit = self.commit()
        identity = self.workspace / "identity.json"
        identity.write_text("{}")
        quantity = self.workspace / "quantity.csv"
        quantity.write_text("synthetic fixture")
        root = self.workspace / "artifact-root"
        binding = {"id": "attempt:fixture-attempt", "commit": "a" * 32, "revision": 1}
        events = []
        status = {"commit": binding["commit"], "version": 1}

        def registration_snapshot(attempt_id, fixed=None):
            self.assertEqual(attempt_id, "fixture-attempt")
            if fixed is None:
                events.append("registration-before-run")
            else:
                self.assertEqual(fixed, binding)
                events.append("verify-fixed-registration")
            return {"schema_version": 2, "registration": {"status": "preregistered"}}, dict(binding)

        store = SimpleNamespace(
            adapter=SimpleNamespace(status=lambda: dict(status)),
            registration_snapshot=registration_snapshot,
            publish_record=Mock(return_value={"commit": "c" * 32}),
        )
        original_process = subprocess.run

        def process(command, *args, **kwargs):
            if command[:3] == [sys.executable, "-m", "backtest.r1.run_portfolio"]:
                self.assertEqual(events, ["registration-before-run"])
                events.append("runner")
                # A later decision published during the subprocess must not
                # become the experiment's starting intent.
                status.update(commit="b" * 32, version=2)
            elif command[:3] == [sys.executable, "-m", "backtest.r1.checks.audit_tiered_native"]:
                events.append("audit")
            return original_process(command, *args, **kwargs)

        with patch("research.records.store.open_store", return_value=store), \
             patch.object(artifacts, "_check_inputs", return_value={"fixture": "no Catalog mutation"}), \
             patch.object(artifacts.importlib.metadata, "version", return_value="fixture-native-version"), \
             patch.object(artifacts.subprocess, "run", side_effect=process), \
             patch.object(artifacts.tempfile, "gettempdir", return_value="/system-temp-fixture"):
            result = artifacts.run(root=root, run_id="fixture-run", attempt_id="fixture-attempt",
                                   source_ref=commit, input_identity=identity, runner_argv=[
                                       "--catalog-root", str(self.workspace / "minute"),
                                       "--daily-root", str(self.workspace / "daily"),
                                       "--quantity-csv", str(quantity), "--coins", "BTC",
                                       "--signal-variant", "support-broad-two-tier-4h"])
            artifacts.register(root=root, run_id="fixture-run", role="diagnostic",
                               cost_model="Synthetic fixture; no native economics.",
                               control_run_id=None, evidence_grade="unknown")
        self.assertEqual(result["status"], "passed")
        seal = root / "fixture-run"
        native_cwd = (seal / "native.stdout.txt").read_text().strip()
        self.assertTrue(native_cwd.startswith(str(root.resolve() / ".staging")))
        self.assertTrue(native_cwd.endswith("/source"))
        self.assertEqual((seal / "audit.stdout.txt").read_text().strip(), native_cwd)
        self.assertTrue(verify(root, "fixture-run")["verified"])
        manifest = json.loads((seal / "manifest.json").read_text())
        self.assertEqual(manifest["source_commit"], commit)
        self.assertEqual(manifest["record_binding"], binding)
        self.assertEqual(manifest["dependency_lock_sha256"], _sha(seal / "source/uv.lock"))
        self.assertEqual(events, ["registration-before-run", "runner", "audit", "verify-fixed-registration"])
        publication = store.publish_record.call_args
        self.assertEqual(publication.kwargs["provenance"]["record_binding"], binding)
        self.assertEqual(publication.kwargs["provenance"]["binding_origin"], "sealed_start")
        self.assertEqual(publication.kwargs["endpoint_revisions"], {"attempt:fixture-attempt": 1})
        self.assertEqual(publication.kwargs["expected_version"], 2)
        self.assertEqual(publication.args[1]["source_revision"]["commit"], commit)

    def test_invalid_registration_prevents_processes_and_artifact_creation(self):
        root = self.workspace / "never-created-seals"
        for reason in ("unknown registered attempt", "retrospective attempt has no preregistration",
                       "registration is not an initial pending receipt"):
            with self.subTest(reason=reason):
                store = SimpleNamespace(registration_snapshot=Mock(side_effect=RecordError(reason)))
                with patch("research.records.store.open_store", return_value=store), \
                     patch.object(artifacts.subprocess, "run") as processes:
                    with self.assertRaisesRegex(ArtifactError, reason):
                        artifacts.run(root=root, run_id="fixture-run", attempt_id="fixture-attempt",
                                      source_ref="HEAD", input_identity=self.workspace / "missing.json",
                                      runner_argv=[])
                processes.assert_not_called()
                self.assertFalse(root.exists())

    def test_history_reader_cannot_supply_a_registered_custody_start(self):
        with patch("research.records.store.open_store", return_value=SimpleNamespace()):
            with self.assertRaisesRegex(ArtifactError, "requires the Dolt metadata owner"):
                artifacts._attempt_snapshot("fixture-attempt")


class ArtifactCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "archive"
        self.run_id = "fixture-1"
        self.seal = self.root / self.run_id
        reports = self.seal / "reports"
        reports.mkdir(parents=True)
        (reports / "orders.csv").write_text("order_id,status\na,FILLED\n")
        manifest = {
            "schema_version": 1,
            "run_id": self.run_id,
            "status": "failed",
            "files": _files(self.seal),
        }
        (self.seal / "manifest.json").write_text(json.dumps(manifest))

    def test_verify_and_restore_preserve_bytes(self):
        self.assertTrue(verify(self.root, self.run_id)["verified"])
        output = Path(self.temp.name) / "recovered" / "reports"
        restore(self.root, self.run_id, output)
        self.assertEqual(
            _sha(output / "orders.csv"), _sha(self.seal / "reports" / "orders.csv")
        )
        with self.assertRaisesRegex(ArtifactError, "already exists"):
            restore(self.root, self.run_id, output)

    def test_backup_can_restore_without_primary(self):
        backup_root = Path(self.temp.name) / "backup"
        result = backup(self.root, self.run_id, backup_root)
        self.assertTrue(result["same_device_as_primary"])
        self.assertEqual(stat.S_IMODE(backup_root.stat().st_mode), 0o700)
        self.assertEqual(
            stat.S_IMODE(
                (backup_root / self.run_id / "reports" / "orders.csv").stat().st_mode
            ),
            0o600,
        )
        self.assertEqual(
            _sha(self.root / self.run_id / "manifest.json"),
            _sha(backup_root / self.run_id / "manifest.json"),
        )
        shutil.rmtree(self.root / self.run_id)
        output = Path(self.temp.name) / "from-backup"
        restore(backup_root, self.run_id, output)
        self.assertEqual(
            (output / "orders.csv").read_text(), "order_id,status\na,FILLED\n"
        )
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((output / "orders.csv").stat().st_mode), 0o600)

    def test_permissive_root_is_rejected(self):
        self.root.chmod(0o755)
        with self.assertRaisesRegex(ArtifactError, "private"):
            _private_root(self.root)

    def test_tampered_or_extra_file_is_rejected(self):
        report = self.seal / "reports" / "orders.csv"
        report.write_text("order_id,status\na,REJECTED\n")
        with self.assertRaisesRegex(ArtifactError, "SHA-256 differs"):
            verify(self.root, self.run_id)
        report.write_text("order_id,status\na,FILLED\n")
        (self.seal / "reports" / "extra.csv").write_text("not registered\n")
        with self.assertRaisesRegex(ArtifactError, "file set"):
            verify(self.root, self.run_id)

    def test_manifest_run_id_is_bound_to_directory(self):
        manifest = json.loads((self.seal / "manifest.json").read_text())
        manifest["run_id"] = "another-run"
        (self.seal / "manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ArtifactError, "identity mismatch"):
            verify(self.root, self.run_id)

    def test_new_input_identity_detects_catalog_mutation(self):
        minute = Path(self.temp.name) / "minute" / "BTC" / "minute"
        daily = Path(self.temp.name) / "daily" / "BTC" / "daily"
        minute.mkdir(parents=True)
        daily.mkdir(parents=True)
        (minute / "bars.parquet").write_bytes(b"minute")
        (daily / "bars.parquet").write_bytes(b"daily")
        quantity = Path(self.temp.name) / "quantity.csv"
        quantity.write_text("coin,quantity\nBTC,1\n")
        output = Path(self.temp.name) / "identity.json"
        create_input_identity(
            catalog_root=minute.parents[1],
            daily_root=daily.parents[1],
            quantity_csv=quantity,
            coins=["BTC"],
            output=output,
        )
        replay = Namespace(
            catalog_root=minute.parents[1],
            daily_root=daily.parents[1],
            quantity_csv=quantity,
            coins=["BTC"],
        )
        identity = json.loads(output.read_text())
        self.assertEqual(len(_check_inputs(identity, replay)), 1)
        (minute / "bars.parquet").write_bytes(b"changed")
        with self.assertRaisesRegex(ArtifactError, "bytes differ"):
            _check_inputs(identity, replay)

    def test_registration_requires_sealed_start_binding_even_if_a_run_exists(self):
        manifest_path = self.seal / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["attempt_id"] = "fixture-attempt"
        manifest_path.write_text(json.dumps(manifest))
        adapter = Mock()
        # An old run_of edge cannot reconstruct a contract that the seal never
        # captured before execution.
        adapter.get_object.return_value = {"id": "run:" + self.run_id, "revision": 1}
        adapter.list_relations.return_value = [{
            "kind": "run_of", "from_id": "run:" + self.run_id,
            "from_revision": 1, "to_id": "attempt:fixture-attempt", "to_revision": 1,
        }]
        with patch("research.records.store.open_store", return_value=SimpleNamespace(adapter=adapter)):
            with self.assertRaisesRegex(ArtifactError, "no start-time Dolt registration binding"):
                artifacts.register(root=self.root, run_id=self.run_id, role="diagnostic",
                                   cost_model="Synthetic test; no native economics.",
                                   control_run_id=None, evidence_grade="unknown")
        adapter.get_object.assert_not_called()
        adapter.list_relations.assert_not_called()


if __name__ == "__main__":
    unittest.main()
