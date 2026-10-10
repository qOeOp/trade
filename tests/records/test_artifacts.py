"""Custody integrity and recovery boundaries using a small sealed fixture."""

import contextlib
import json
import shutil
import stat
import subprocess
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


class LegacySealTests(unittest.TestCase):
    """Schema v1 seals stay verifiable; no new run starts without a valid registration."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="trade-artifact-test-", dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        self.stage = self.workspace / "stage"
        self.stage.mkdir()

    def seal(self, summary):
        reports = self.stage / "reports"
        reports.mkdir()
        (reports / "summary.json").write_text(json.dumps(summary))
        manifest = {
            "schema_version": 1, "run_id": "fixture", "attempt_id": "fixture-attempt",
            "source_commit": "a" * 40, "input_identity_sha256": "a" * 64,
            "status": "failed", "problems": ["Synthetic fixture, no native replay"],
            "record_binding": {"id": "attempt:fixture-attempt", "commit": "fixture-fixed", "revision": 1},
            "files": _files(self.stage),
        }
        (self.stage / "manifest.json").write_text(json.dumps(manifest))
        root = self.workspace / "seals"
        root.mkdir()
        self.stage.rename(root / "fixture")
        return root

    def test_legacy_seal_keeps_original_summary_mapping_and_manifest_bytes(self):
        source = self.stage / "source/strategies/r1/strategy.py"
        source.parent.mkdir(parents=True)
        source.write_text("# old frozen strategy\n")
        root = self.seal({"strategy_source_sha256": _sha(source), "brooks_confirmed_strategy_source_sha256": "b" * 64})
        manifest = root / "fixture/manifest.json"
        before = manifest.read_bytes()
        self.assertTrue(verify(root, "fixture")["verified"])
        self.assertEqual(manifest.read_bytes(), before)

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
                                      strategy_id="fixture", strategy_revision=1, source_at="a" * 32,
                                      runtime=self.workspace / "runtime.json",
                                      input_identity=self.workspace / "missing.json", runner_argv=[])
                processes.assert_not_called()
                self.assertFalse(root.exists())

    def test_history_reader_cannot_supply_a_registered_custody_start(self):
        with patch("research.records.store.open_store", return_value=SimpleNamespace()):
            with self.assertRaisesRegex(ArtifactError, "requires the Dolt metadata owner"):
                artifacts._attempt_snapshot("fixture-attempt")


class ArtifactCustodyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="trade-artifact-test-", dir=Path.home())
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


class DoltOciCustodyTests(unittest.TestCase):
    """Synthetic orchestration, including failures before a native summary exists."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="trade-artifact-test-", dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        self.root = self.workspace / "seals"
        self.source = b"# synthetic complete strategy; no economics\n"
        import hashlib
        self.binding = {"database": "fixture", "commit": "a" * 32, "strategy_id": "fixture",
                        "revision": 1, "source_sha256": hashlib.sha256(self.source).hexdigest(),
                        "entry_class": "FixtureStrategy", "runtime_contract": "r1-native-v1"}
        self.identity = {"image_ref": "registry.invalid/native@sha256:" + "b" * 64,
                         "image_digest": "sha256:" + "b" * 64, "platform": "linux/arm64",
                         "runtime_contract": "r1-native-v1"}
        from research.records.runtime import SOURCE_PATHS
        self.probe = {"runtime_contract": "r1-native-v1", "nautilus_version": "fixture-native",
                      "python_version": "fixture-python", "dependency_lock_sha256": "c" * 64,
                      "source_files_sha256": {field: "d" * 64 for field in SOURCE_PATHS},
                      "source_file_paths": SOURCE_PATHS.copy(),
                      "audit_source_sha256": "e" * 64, "platform": "linux/arm64",
                      "effective_config": {"fixture": True}}
        self.record_binding = {"id": "attempt:fixture-attempt", "revision": 1, "commit": "f" * 32}
        self.input = self.workspace / "input.json"
        self.input.write_text("{}")
        for name in ("minute", "daily"):
            (self.workspace / name).mkdir()
        self.quantity = self.workspace / "quantity.csv"
        self.quantity.write_text("fixture")
        self.argv = ["--catalog-root", str(self.workspace / "minute"), "--daily-root", str(self.workspace / "daily"),
                     "--quantity-csv", str(self.quantity), "--coins", "BTC"]

    def run_fixture(self, passed=False, source=None, snapshot=True, on_runner=None):
        mounts = [(self.workspace / "minute", "/inputs/catalog", True),
                  (self.workspace / "daily", "/inputs/daily", True), (self.quantity, "/inputs/quantity.csv", True)]
        prepared = (self.binding, self.source if source is None else source, self.identity, self.probe,
                    ["--catalog-root", "/inputs/catalog", "--daily-root", "/inputs/daily", "--quantity-csv", "/inputs/quantity.csv", "--coins", "BTC"], mounts)

        def execute(command, **kwargs):
            stage = kwargs["cwd"].parent
            if "backtest.r1.run_portfolio" in command and on_runner is not None:
                on_runner()
            if "backtest.r1.run_portfolio" in command and passed:
                summary = {"strategy_binding": self.binding, "runtime_identity": self.identity,
                           "effective_config_sha256": artifacts._config_sha(self.probe["effective_config"]),
                           "strategy_source_sha256": self.binding["source_sha256"],
                           **self.probe["source_files_sha256"], "source_file_paths": self.probe["source_file_paths"],
                           "integrity_passed": True}
                (stage / "reports/summary.json").write_text(json.dumps(summary))
                for name in artifacts.REPORTS[1:]:
                    (stage / "reports" / name).write_text("synthetic reports; no native economics\n")
            if "backtest.r1.checks.audit_tiered_native" in command:
                (stage / "reports/audit.json").write_text(json.dumps({"passed": True, "findings": []}))
            return subprocess.CompletedProcess(command, 0 if passed else 23)

        start = patch.object(artifacts, "_attempt_snapshot", return_value=({"strategy_binding": self.binding}, self.record_binding))
        with start if snapshot else contextlib.nullcontext(), \
             patch.object(artifacts, "_check_inputs", return_value={"fixture": "unchanged"}), \
             patch.object(artifacts, "_dolt_source", return_value=prepared), \
             patch.object(artifacts.subprocess, "run", side_effect=execute) as calls, \
             patch("research.records.common.tempfile.gettempdir", return_value="/system-temp-fixture"):
            result = artifacts.run(root=self.root, run_id="fixture-run", attempt_id="fixture-attempt", strategy_id="fixture",
                                   strategy_revision=1, source_at="a" * 32, runtime=self.workspace / "runtime.json",
                                   input_identity=self.input, runner_argv=self.argv)
        return result, calls

    def test_dolt_oci_seal_freezes_source_and_audits_same_digest(self):
        result, calls = self.run_fixture(passed=True)
        self.assertEqual(result["status"], "passed")
        archive = self.root / "fixture-run"
        manifest = json.loads((archive / "manifest.json").read_text())
        self.assertEqual(manifest["schema_version"], 2)
        self.assertNotIn("source_commit", manifest)
        self.assertEqual((archive / "source/strategy.py").read_bytes(), self.source)
        self.assertEqual(manifest["strategy_binding"], self.binding)
        self.assertEqual(manifest["runtime_identity"], self.identity)
        self.assertEqual(len(calls.call_args_list), 2)
        for call in calls.call_args_list:
            command = call.args[0]
            self.assertIn(self.identity["image_ref"], command)
            self.assertIn("--network", command)
            self.assertIn("none", command)
            self.assertNotIn(str(artifacts.ROOT), command)
        self.assertTrue(verify(self.root, "fixture-run")["verified"])

    def test_failed_before_summary_registers_frozen_identity_without_economics(self):
        result, _ = self.run_fixture()
        self.assertEqual(result["status"], "failed")
        self.assertTrue(verify(self.root, "fixture-run")["verified"])
        store = Mock()
        store.adapter.status.return_value = {"version": "fixture-version"}
        store.publish_record.return_value = {"commit": "fixture-published"}
        with patch("research.records.store.open_store", return_value=store), \
             patch.object(artifacts, "_attempt_snapshot", return_value=({}, self.record_binding)), \
             patch("research.records.strategies.validate_binding", return_value={}):
            artifacts.register(root=self.root, run_id="fixture-run", role="diagnostic", cost_model="Synthetic fixture only",
                               control_run_id=None, evidence_grade="unknown")
        record = store.publish_record.call_args.args[1]
        self.assertEqual(record["strategy_binding"], self.binding)
        self.assertEqual(record["runtime_identity"], self.identity)
        self.assertNotIn("source_revision", record)
        self.assertNotIn("window", record)
        self.assertNotIn("account", record)
        self.assertNotIn("summary_ref", record)
        self.assertIn("native runner exited 23", record["failure_reasons"])

    def test_start_binding_precedes_execution_and_registration_reuses_it(self):
        events = []
        status = {"commit": self.record_binding["commit"], "version": 1}

        def registration_snapshot(attempt_id, fixed=None):
            self.assertEqual(attempt_id, "fixture-attempt")
            if fixed is None:
                events.append("registration-before-run")
            else:
                self.assertEqual(fixed, self.record_binding)
                events.append("verify-fixed-registration")
            return {"strategy_binding": self.binding}, dict(self.record_binding)

        def runner_started():
            self.assertEqual(events, ["registration-before-run"])
            events.append("runner")
            # A later decision published during the run must not become its starting intent.
            status.update(commit="b" * 32, version=2)

        store = SimpleNamespace(adapter=SimpleNamespace(status=lambda: dict(status)),
                                registration_snapshot=registration_snapshot,
                                publish_record=Mock(return_value={"commit": "c" * 32}))
        with patch("research.records.store.open_store", return_value=store):
            result, _ = self.run_fixture(snapshot=False, on_runner=runner_started)
            with patch("research.records.strategies.validate_binding", return_value={}):
                artifacts.register(root=self.root, run_id="fixture-run", role="diagnostic",
                                   cost_model="Synthetic fixture; no native economics.",
                                   control_run_id=None, evidence_grade="unknown")
        self.assertEqual(result["status"], "failed")
        manifest = json.loads((self.root / "fixture-run/manifest.json").read_text())
        self.assertEqual(manifest["record_binding"], self.record_binding)
        self.assertEqual(events, ["registration-before-run", "runner", "verify-fixed-registration"])
        publication = store.publish_record.call_args
        self.assertEqual(publication.kwargs["provenance"]["record_binding"], self.record_binding)
        self.assertEqual(publication.kwargs["provenance"]["binding_origin"], "sealed_start")
        self.assertEqual(publication.kwargs["endpoint_revisions"], {"attempt:fixture-attempt": 1})
        self.assertEqual(publication.kwargs["expected_version"], 2)

    def test_resolved_byte_hash_mismatch_refuses_launch(self):
        with self.assertRaisesRegex(ArtifactError, "resolved strategy bytes"):
            self.run_fixture(source=b"changed bytes")
        self.assertFalse((self.root / "fixture-run").exists())

    def test_preregistered_binding_and_source_authority_are_required(self):
        with patch.object(artifacts, "_attempt_snapshot", return_value=({}, self.record_binding)), \
             patch.object(artifacts, "_dolt_source", return_value=(self.binding,)):
            with self.assertRaisesRegex(ArtifactError, "preregistered attempt"):
                artifacts.run(root=self.root, run_id="fixture-run", attempt_id="fixture-attempt", strategy_id="fixture",
                              strategy_revision=1, source_at="a" * 32, runtime=Path("fixture"), input_identity=self.input, runner_argv=self.argv)


if __name__ == "__main__":
    unittest.main()
