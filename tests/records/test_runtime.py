"""OCI custody boundaries with synthetic images; no native economics claimed."""

import json
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from research.records.common import RecordError
from research.records import runtime
from research.records.runtime import LAYOUTS, container_command, inspect_runtime, validate_identity


SOURCE_PATHS = LAYOUTS["r1-native-v6"]["source_paths"]
AUDIT_PATH = LAYOUTS["r1-native-v6"]["audit_path"]


IDENTITY = {"image_ref": "registry.invalid/research/native@sha256:" + "a" * 64,
            "image_digest": "sha256:" + "a" * 64, "platform": "linux/arm64",
            "runtime_contract": "r1-native-v6"}


class RuntimeIdentityTests(unittest.TestCase):
    def test_mutable_tag_and_conflicting_digest_are_rejected(self):
        for image in ("registry.invalid/native:latest", "registry.invalid/native:fixed"):
            with self.assertRaisesRegex(RecordError, "immutable"):
                validate_identity({**IDENTITY, "image_ref": image})
        with self.assertRaisesRegex(RecordError, "disagree"):
            validate_identity({**IDENTITY, "image_digest": "sha256:" + "b" * 64})

    def probe(self, **changes):
        value = {"runtime_contract": "r1-native-v6", "nautilus_version": "fixture",
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
            result = inspect_runtime(IDENTITY, ["--symbols", "BTCUSDT"])
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

    def test_current_contract_probe_is_the_runner_describing_itself(self):
        identity = {**IDENTITY, "runtime_contract": "r1-native-v6"}
        layout = LAYOUTS["r1-native-v6"]
        probe = self.probe(runtime_contract="r1-native-v6", source_file_paths=layout["source_paths"].copy(),
                           source_files_sha256={field: "d" * 64 for field in layout["source_paths"]})
        actual = {"RepoDigests": [IDENTITY["image_ref"]], "Os": "linux", "Architecture": "arm64", "Id": "sha256:" + "e" * 64}
        outputs = [subprocess.CompletedProcess([], 0, json.dumps([actual]), ""),
                   subprocess.CompletedProcess([], 0, json.dumps(probe), "")]
        with patch("research.records.runtime.subprocess.run", side_effect=outputs) as calls:
            inspect_runtime(identity, ["--symbols", "BTCUSDT"])
        command = calls.call_args_list[1].args[0]
        self.assertEqual(command[-5:], ["-m", "backtest.run", "--describe", "--symbols", "BTCUSDT"])

    def test_runner_describes_the_paths_custody_expects(self):
        argv = ["--describe", "--market-root", "/m", "--market-commit", "c" * 32,
                "--symbols", "BTCUSDT", "--start", "2025-01-01T00:00:00Z", "--end", "2025-01-02T00:00:00Z"]
        described = json.loads(subprocess.run([sys.executable, "-m", "backtest.run", *argv], capture_output=True,
                                              text=True, check=True).stdout)
        layout = LAYOUTS[described["runtime_contract"]]
        self.assertEqual(described["runtime_contract"], "r1-native-v7")
        self.assertEqual(described["source_file_paths"], layout["source_paths"])
        root = Path(__file__).resolve().parents[2]
        for field, path in layout["source_paths"].items():
            self.assertEqual(described["source_files_sha256"][field], hashlib.sha256((root / path).read_bytes()).hexdigest())
        self.assertEqual(described["audit_source_sha256"], hashlib.sha256((root / layout["audit_path"]).read_bytes()).hexdigest())
        self.assertEqual(described["effective_config"]["symbols"], ["BTCUSDT"])

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


class CurrentRuntimeTests(unittest.TestCase):
    """The current runtime is the CI main tag; freezes and confirmations accept only main builds of main's code."""

    DIGEST = "sha256:" + "f" * 64
    REVISION = "1" * 40

    def image(self, repository=runtime.REPOSITORY, revision=REVISION):
        return {"RepoDigests": [f"{repository}@{self.DIGEST}"], "Os": "linux", "Architecture": "arm64",
                "Config": {"Labels": {runtime.CONTRACT_LABEL: "r1-native-v6", runtime.REVISION_LABEL: revision}}}

    def docker(self, image):
        def run(command, **kwargs):
            if command[1] == "pull":
                return subprocess.CompletedProcess(command, 0, "", "")
            return subprocess.CompletedProcess(command, 0, json.dumps([image]), "")
        return run

    def test_default_reference_pulls_the_main_tag_and_pins_its_digest(self):
        with patch("research.records.runtime.subprocess.run", side_effect=self.docker(self.image())) as calls:
            identity = runtime.resolve()
        self.assertEqual(calls.call_args_list[0].args[0], ["docker", "pull", "--quiet", runtime.CURRENT])
        self.assertEqual(identity, {"image_ref": f"{runtime.REPOSITORY}@{self.DIGEST}", "image_digest": self.DIGEST,
                                    "platform": "linux/arm64", "runtime_contract": "r1-native-v6"})

    def test_local_digest_reference_is_not_pulled(self):
        reference = f"{runtime.REPOSITORY}@{self.DIGEST}"
        with patch("research.records.runtime.subprocess.run", side_effect=self.docker(self.image())) as calls:
            self.assertEqual(runtime.resolve(reference)["image_ref"], reference)
        self.assertNotIn("pull", [call.args[0][1] for call in calls.call_args_list])

    def inspection(self, files):
        return {"source_files_sha256": {field: hashlib.sha256(files[path]).hexdigest() for field, path in SOURCE_PATHS.items()},
                "source_file_paths": SOURCE_PATHS.copy(),
                "audit_source_sha256": hashlib.sha256(files[AUDIT_PATH]).hexdigest(),
                "dependency_lock_sha256": hashlib.sha256(files["uv.lock"]).hexdigest()}

    def check(self, image, on_main=True, files=None, inspection=None):
        main = {path: path.encode() for path in [*SOURCE_PATHS.values(), AUDIT_PATH, "uv.lock"]}
        files = files or main

        def git(*argv):
            if argv[0] == "merge-base":
                return subprocess.CompletedProcess(argv, 0 if on_main else 1, b"", b"")
            if argv[0] == "show":
                return subprocess.CompletedProcess(argv, 0, files[argv[1].split(":", 1)[1]], b"")
            return subprocess.CompletedProcess(argv, 0, b"", b"")

        identity = {"image_ref": image["RepoDigests"][0], "image_digest": self.DIGEST, "platform": "linux/arm64",
                    "runtime_contract": "r1-native-v6"}
        with patch("research.records.runtime.subprocess.run", side_effect=self.docker(image)), \
             patch("research.records.runtime._git", side_effect=git):
            return runtime.require_main_build(identity, inspection or self.inspection(main))

    def test_main_build_of_main_code_is_accepted(self):
        self.assertEqual(self.check(self.image()), self.REVISION)

    def test_pull_request_image_is_refused(self):
        with self.assertRaisesRegex(RecordError, "not on origin/main"):
            self.check(self.image(), on_main=False)

    def test_image_outside_the_ci_repository_or_without_revision_is_refused(self):
        with self.assertRaisesRegex(RecordError, "CI image"):
            self.check(self.image(repository="localhost:15000/trade-r1-runtime"))
        with self.assertRaisesRegex(RecordError, "revision label"):
            self.check(self.image(revision=None))

    def test_relabelled_image_of_other_code_is_refused(self):
        main = {path: path.encode() for path in [*SOURCE_PATHS.values(), AUDIT_PATH, "uv.lock"]}
        other = self.inspection({**main, SOURCE_PATHS["runner_source_sha256"]: b"changed runner"})
        with self.assertRaisesRegex(RecordError, "code differs"):
            self.check(self.image(), inspection=other)


if __name__ == "__main__":
    unittest.main()
