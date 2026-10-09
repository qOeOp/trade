"""OCI custody boundaries with synthetic images; no native economics claimed."""

import json
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from research.records.common import RecordError
from research.records.runtime import SOURCE_PATHS, container_command, inspect_runtime, validate_identity


IDENTITY = {"image_ref": "registry.invalid/research/native@sha256:" + "a" * 64,
            "image_digest": "sha256:" + "a" * 64, "platform": "linux/arm64",
            "runtime_contract": "r1-native-v1"}


class RuntimeIdentityTests(unittest.TestCase):
    def test_mutable_tag_and_conflicting_digest_are_rejected(self):
        for image in ("registry.invalid/native:latest", "registry.invalid/native:fixed"):
            with self.assertRaisesRegex(RecordError, "immutable"):
                validate_identity({**IDENTITY, "image_ref": image})
        with self.assertRaisesRegex(RecordError, "disagree"):
            validate_identity({**IDENTITY, "image_digest": "sha256:" + "b" * 64})

    def probe(self, **changes):
        value = {"runtime_contract": "r1-native-v1", "nautilus_version": "fixture",
                 "python_version": "fixture", "dependency_lock_sha256": "b" * 64,
                 "audit_source_sha256": "c" * 64, "effective_config": {"fixture": True},
                 "source_files_sha256": {field: "d" * 64 for field in SOURCE_PATHS},
                 "source_file_paths": SOURCE_PATHS.copy(),
                 "effective_config_sha256": hashlib.sha256(b'{"fixture":true}').hexdigest()}
        return {**value, **changes}

    def inspect(self, image=None, probe=None):
        actual = image or {"RepoDigests": [IDENTITY["image_ref"]], "Os": "linux", "Architecture": "arm64", "Id": "sha256:" + "e" * 64}
        outputs = [subprocess.CompletedProcess([], 0, json.dumps([actual]), ""),
                   subprocess.CompletedProcess([], 0, json.dumps(probe or self.probe()), "")]
        with patch("research.records.runtime.subprocess.run", side_effect=outputs) as calls:
            result = inspect_runtime(IDENTITY, ["--coins", "BTC"])
        return result, calls

    def test_probe_observes_code_from_pinned_image_without_host_source_mount(self):
        result, calls = self.inspect()
        self.assertEqual(result["source_files_sha256"], self.probe()["source_files_sha256"])
        command = calls.call_args_list[1].args[0]
        self.assertIn(IDENTITY["image_ref"], command)
        self.assertNotIn("--mount", command)
        self.assertIn("none", command)
        self.assertIn("--read-only", command)

    def test_actual_platform_or_manifest_mismatch_is_rejected(self):
        for actual, message in (({"RepoDigests": [IDENTITY["image_ref"]], "Os": "linux", "Architecture": "amd64"}, "platform"),
                                ({"RepoDigests": ["another@sha256:" + "a" * 64]}, "manifest")):
            with self.assertRaisesRegex(RecordError, message):
                self.inspect(image=actual)

    def test_runtime_hash_path_contract_is_checked(self):
        with self.assertRaisesRegex(RecordError, "paths and hashes"):
            self.inspect(probe=self.probe(source_file_paths={}))
        with self.assertRaisesRegex(RecordError, "source digest"):
            self.inspect(probe=self.probe(source_files_sha256={field: "x" * 64 for field in SOURCE_PATHS}))

    def test_only_reports_are_writable(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            command = container_command(IDENTITY, [(path, "/inputs/catalog", True), (path, "/reports", False)], "fixture", [])
            self.assertIn("--read-only", command)
            self.assertIn("--cap-drop", command)
            self.assertIn("no-new-privileges", command)
            self.assertIn("never", command)
            self.assertIn(f"type=bind,source={path.resolve()},target=/inputs/catalog,readonly", command)
            with self.assertRaisesRegex(RecordError, "only the report"):
                container_command(IDENTITY, [(path, "/product", False)], "fixture", [])


class RuntimeComparisonTests(unittest.TestCase):
    def records(self, modern=True):
        base = {"integrity": "passed", "input_identity_sha256": "a" * 64,
                "window": {}, "account": {}, "cost_model": "synthetic fixture", "nautilus_version": "fixture",
                "audit_ref": {"path": "synthetic"}, "raw_reports": "sealed_local", "evidence_grade": "unknown"}
        if modern:
            base.update(strategy_binding={"fixture": True}, runtime_identity=IDENTITY.copy(), effective_config_sha256="b" * 64)
        return {"candidate": {**base, "run_id": "candidate", "role": "candidate", "control_run_id": "control"},
                "control": {**base, "run_id": "control", "role": "control", "control_run_id": None}}

    def test_normal_research_comparison_rejects_runtime_and_configuration_changes(self):
        from research.records.cli import _compare
        records = self.records()
        records["candidate"]["runtime_identity"] = {**IDENTITY, "platform": "linux/amd64"}
        with self.assertRaisesRegex(RecordError, "engineering-audit"):
            _compare("candidate", "control", records)
        records = self.records()
        records["candidate"]["effective_config_sha256"] = "c" * 64
        with self.assertRaisesRegex(RecordError, "configuration differs"):
            _compare("candidate", "control", records)

    def test_legacy_to_oci_comparison_requires_explicit_engineering_scope(self):
        from research.records.cli import _compare
        records = self.records()
        for field in ("strategy_binding", "runtime_identity", "effective_config_sha256"):
            records["control"].pop(field)
        with self.assertRaisesRegex(RecordError, "source_custody_backend"):
            _compare("candidate", "control", records)
        summary = {"per_coin": [{"instrument": "BTC-fixture"}], "final_equity_usdt": "1",
                   "annualized_return_pct": "0", "closed_trade_win_rate": "0",
                   "native_sharpe_365": "0", "native_max_drawdown_daily_close": "0"}
        with patch("research.records.cli._check_source_revision", return_value="verified"), \
             patch("research.records.cli._check_ref", return_value="verified"), \
             patch("research.records.cli._read_evidence_json", return_value={"passed": True, "findings": []}), \
             patch("research.records.cli._summary", return_value=summary):
            result = _compare("candidate", "control", records, engineering_audit=True)
        self.assertEqual(result["comparability"], "engineering_environment_migration")
        self.assertIn("not a paired research decision", result["scope"])


if __name__ == "__main__":
    unittest.main()
