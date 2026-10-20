"""Runtime identity with synthetic images: digest pinning, the in-image probe, main builds and the
isolated container; no native economics claimed."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from engine import config as engine_config
from ledger import problems
from ledger.errors import Refusal
from runtime import container, image


LAYOUT = image.layout("r1-native-v6")
SOURCE_PATHS = LAYOUT["source_paths"]
IDENTITY = {"image_ref": "registry.invalid/research/native@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/arm64", "runtime_contract": "r1-native-v6"}


def refused(test, code, call, *args, **kwargs):
    with test.assertRaises(Refusal) as caught:
        call(*args, **kwargs)
    test.assertEqual(caught.exception.code, code)
    return caught.exception


class IdentityTests(unittest.TestCase):
    def test_mutable_tags_conflicting_digests_and_unknown_fields_are_refused(self):
        for value in ({**IDENTITY, "image_ref": "registry.invalid/native:latest"},
                      {**IDENTITY, "image_digest": "sha256:" + "b" * 64},
                      {**IDENTITY, "extra": 1}, {key: IDENTITY[key] for key in ("image_ref", "image_digest")},
                      {**IDENTITY, "build_revision": "short"}):
            with self.subTest(value=value):
                refused(self, "RUNTIME_IDENTITY_INVALID", image.validate_identity, value)
        refused(self, "RUNTIME_UNSUPPORTED", image.validate_identity, {**IDENTITY, "platform": "windows/amd64"})
        refused(self, "RUNTIME_UNSUPPORTED", image.validate_identity, {**IDENTITY, "runtime_contract": "r1-native-v5"})
        self.assertEqual(image.validate_identity({**IDENTITY, "build_revision": "1" * 40})["build_revision"], "1" * 40)

    def test_layout_of_an_undeclared_contract_is_refused(self):
        refused(self, "RUNTIME_UNSUPPORTED", image.layout, "r1-native-v5")
        self.assertEqual(set(image.layout(None)), {"r1-native-v6"})


class ProbeTests(unittest.TestCase):
    def probe(self, **changes):
        value = {"runtime_contract": "r1-native-v6", "engine_version": "fixture", "python_version": "fixture",
                 "dependency_lock_sha256": "b" * 64, "audit_source_sha256": "c" * 64,
                 "effective_config": {"fixture": True}, "source_files_sha256": {field: "d" * 64 for field in SOURCE_PATHS},
                 "source_file_paths": dict(SOURCE_PATHS),
                 "effective_config_sha256": hashlib.sha256(b'{"fixture":true}').hexdigest()}
        return {**value, **changes}

    def inspect(self, actual=None, probe=None, mounts=()):
        actual = actual or {"RepoDigests": [IDENTITY["image_ref"]], "Os": "linux", "Architecture": "arm64",
                            "Id": "sha256:" + "e" * 64}
        outputs = [subprocess.CompletedProcess([], 0, json.dumps([actual]), ""),
                   subprocess.CompletedProcess([], 0, json.dumps(probe or self.probe()), "")]
        with patch("runtime.image.subprocess.run", side_effect=outputs) as calls:
            result = image.inspect_runtime(IDENTITY, ["--symbols", "BTCUSDT"], list(mounts))
        return result, calls

    def test_the_probe_runs_the_runner_describing_itself_in_the_isolated_image(self):
        result, calls = self.inspect()
        self.assertEqual(result["image_config_digest"], "sha256:" + "e" * 64)
        command = calls.call_args_list[1].args[0]
        self.assertEqual(command[-5:], ["-m", "engine.run", "--describe", "--symbols", "BTCUSDT"])
        for flag in ("--read-only", "no-new-privileges", "never"):
            self.assertIn(flag, command)
        self.assertEqual(command[command.index("--network") + 1], "none")
        self.assertNotIn("--mount", command)

    def test_a_different_image_or_probe_is_refused(self):
        for actual in ({"RepoDigests": [IDENTITY["image_ref"]], "Os": "linux", "Architecture": "amd64"},
                       {"RepoDigests": ["another@sha256:" + "a" * 64], "Os": "linux", "Architecture": "arm64"}):
            with self.subTest(actual=actual), self.assertRaises(Refusal) as caught:
                self.inspect(actual=actual)
            self.assertEqual(caught.exception.code, "RUNTIME_MISMATCH")
        for probe, code in ((self.probe(source_file_paths={}), "RUNTIME_PROBE_INVALID"),
                            (self.probe(source_files_sha256={field: "x" * 64 for field in SOURCE_PATHS}),
                             "RUNTIME_PROBE_INVALID"),
                            (self.probe(effective_config_sha256="0" * 64), "RUNTIME_MISMATCH"),
                            (self.probe(runtime_contract="other"), "RUNTIME_MISMATCH")):
            with self.subTest(code=code), self.assertRaises(Refusal) as caught:
                self.inspect(probe=probe)
            self.assertEqual(caught.exception.code, code)
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(Refusal) as caught:
            self.inspect(mounts=[(Path(folder), "/reports", False)])
        self.assertEqual(caught.exception.code, "RUNTIME_PROBE_INVALID")

    def test_the_runner_describes_the_paths_the_layout_declares(self):
        argv = ["--describe", "--market-root", "/m", "--market-commit", "c" * 32, "--symbols", "BTCUSDT",
                "--start", "2025-01-01T00:00:00Z", "--end", "2025-01-02T00:00:00Z"]
        described = json.loads(subprocess.run([sys.executable, "-m", "engine.run", *argv], capture_output=True,
                                              text=True, check=True).stdout)
        self.assertEqual(described["runtime_contract"], "r1-native-v6")
        self.assertEqual(described["source_file_paths"], SOURCE_PATHS)
        root = Path(__file__).resolve().parents[2]
        for field, path in SOURCE_PATHS.items():
            self.assertEqual(described["source_files_sha256"][field], hashlib.sha256((root / path).read_bytes()).hexdigest())
        self.assertEqual(described["audit_source_sha256"],
                         hashlib.sha256((root / LAYOUT["audit_path"]).read_bytes()).hexdigest())

    def test_the_host_hashes_a_described_configuration_as_the_runner_does(self):
        def described(*extra):
            argv = ["--describe", "--market-commit", "c" * 32, "--symbols", "BTCUSDT", "ETHUSDT",
                    "--start", "2025-01-01T00:00:00Z", "--trade-start", "2025-01-01T12:00:00Z",
                    "--end", "2025-01-02T00:00:00Z", *extra]
            return json.loads(subprocess.run([sys.executable, "-m", "engine.run", *argv], capture_output=True,
                                             text=True, check=True).stdout)
        with tempfile.TemporaryDirectory() as folder:
            for name in ("a", "b"):
                (Path(folder) / name).mkdir()
                (Path(folder) / name / "universe.json").write_text('{"members": ["BTCUSDT", "ETHUSDT"]}')
            runs = [described("--market-root", f"{folder}/a"), described("--market-root", f"{folder}/b"),
                    described("--market-root", f"{folder}/a", "--universe", f"{folder}/a/universe.json"),
                    described("--market-root", f"{folder}/b", "--universe", f"{folder}/b/universe.json")]
        for run in runs:  # as the start receipt seals it and ingest reads it back
            receipt = json.loads(json.dumps({"effective_config": run["effective_config"]}).encode())
            self.assertEqual(problems.config_sha256(receipt["effective_config"]), run["effective_config_sha256"])
            self.assertEqual(problems.config_sha256(run["effective_config"]),
                             engine_config.config_sha256(run["effective_config"]))
        hashes = [run["effective_config_sha256"] for run in runs]
        self.assertEqual((hashes[0] == hashes[1], hashes[2] == hashes[3], hashes[0] == hashes[2]), (True, True, False))
        self.assertEqual(problems.HOST_PATH_KEYS, engine_config.HOST_PATH_KEYS)
        unicode = {"label": "资金费 ü", "market_root": "/x", "nested": {"b": [1, None, True], "a": "é"}}
        self.assertEqual(problems.config_sha256(unicode), engine_config.config_sha256(unicode))


class ResolveTests(unittest.TestCase):
    DIGEST = "sha256:" + "f" * 64
    REVISION = "1" * 40

    def image(self, repository=image.REPOSITORY, revision=REVISION, contract="r1-native-v6"):
        labels = {image.REVISION_LABEL: revision, **({image.CONTRACT_LABEL: contract} if contract else {})}
        return {"RepoDigests": [f"{repository}@{self.DIGEST}"], "Os": "linux", "Architecture": "arm64",
                "Config": {"Labels": labels}}

    def docker(self, found):
        def run(command, **kwargs):
            if command[1] == "pull":
                return subprocess.CompletedProcess(command, 0, "", "")
            return subprocess.CompletedProcess(command, 0, json.dumps([found]), "")
        return run

    def test_the_default_reference_pulls_the_main_tag_and_reads_the_identity_from_the_image(self):
        with patch("runtime.image.subprocess.run", side_effect=self.docker(self.image())) as calls:
            identity = image.resolve()
        self.assertEqual(calls.call_args_list[0].args[0], ["docker", "pull", "--quiet", image.CURRENT])
        self.assertEqual(identity, {"image_ref": f"{image.REPOSITORY}@{self.DIGEST}", "image_digest": self.DIGEST,
                                    "platform": "linux/arm64", "runtime_contract": "r1-native-v6",
                                    "build_revision": self.REVISION})

    def test_a_local_digest_reference_is_not_pulled(self):
        reference = f"{image.REPOSITORY}@{self.DIGEST}"
        with patch("runtime.image.subprocess.run", side_effect=self.docker(self.image())) as calls:
            self.assertEqual(image.resolve(reference)["image_ref"], reference)
        self.assertNotIn("pull", [call.args[0][1] for call in calls.call_args_list])

    def test_unpullable_unlabelled_and_ambiguous_images_are_refused(self):
        def fails(command, **kwargs):
            return subprocess.CompletedProcess(command, 1, "", "no such image")
        with patch("runtime.image.subprocess.run", side_effect=fails):
            refused(self, "RUNTIME_UNAVAILABLE", image.resolve, "registry.invalid/x:main")
        with patch("runtime.image.subprocess.run", side_effect=self.docker(self.image(contract=None))):
            refused(self, "RUNTIME_IDENTITY_INVALID", image.resolve)
        twice = {**self.image(), "RepoDigests": [f"{image.REPOSITORY}@{self.DIGEST}",
                                                 f"{image.REPOSITORY}@sha256:" + "0" * 64]}
        with patch("runtime.image.subprocess.run", side_effect=self.docker(twice)):
            refused(self, "RUNTIME_DIGEST_AMBIGUOUS", image.resolve)

    def test_a_hung_docker_call_is_refused_as_unavailable_within_its_timeout(self):
        def hangs(command, **kwargs):  # a credential helper that never answers
            if command[1] == "pull":
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            return subprocess.CompletedProcess(command, 1, "", "no such image")
        with patch("runtime.image.subprocess.run", side_effect=hangs) as calls:
            refusal = refused(self, "RUNTIME_UNAVAILABLE", image.resolve)
        self.assertEqual([call.kwargs["timeout"] for call in calls.call_args_list], [image.PULL_TIMEOUT])
        self.assertIn(f"docker pull {image.CURRENT} did not finish within {image.PULL_TIMEOUT} s", refusal.message)
        self.assertIn("credential helper", refusal.message)
        killed = []

        def probe_hangs(command, **kwargs):
            if command[:2] == ["docker", "kill"]:
                killed.append(command[2])
                return subprocess.CompletedProcess(command, 0, "", "")
            if "--describe" in command:
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            return subprocess.CompletedProcess(command, 0, json.dumps([{
                "RepoDigests": [IDENTITY["image_ref"]], "Os": "linux", "Architecture": "arm64"}]), "")
        with patch("runtime.image.subprocess.run", side_effect=probe_hangs) as calls:
            refused(self, "RUNTIME_UNAVAILABLE", image.inspect_runtime, IDENTITY, ["--symbols", "BTCUSDT"])
        probe = next(call.args[0] for call in calls.call_args_list if "--describe" in call.args[0])
        self.assertEqual(killed, [probe[probe.index("--name") + 1]], "the hung probe container is killed by name")


class MainBuildTests(unittest.TestCase):
    DIGEST = "sha256:" + "f" * 64
    REVISION = "1" * 40
    FILES = {path: path.encode() for path in [*SOURCE_PATHS.values(), LAYOUT["audit_path"], LAYOUT["lock_path"]]}

    def inspection(self, files):
        return {"source_files_sha256": {field: hashlib.sha256(files[path]).hexdigest()
                                        for field, path in SOURCE_PATHS.items()},
                "source_file_paths": dict(SOURCE_PATHS),
                "audit_source_sha256": hashlib.sha256(files[LAYOUT["audit_path"]]).hexdigest(),
                "dependency_lock_sha256": hashlib.sha256(files[LAYOUT["lock_path"]]).hexdigest()}

    def check(self, repository=image.REPOSITORY, revision=REVISION, on_main=True, inspection=None):
        def git(*argv):
            if argv[0] == "merge-base":
                return subprocess.CompletedProcess(argv, 0 if on_main else 1, b"", b"")
            if argv[0] == "show":
                return subprocess.CompletedProcess(argv, 0, self.FILES[argv[1].split(":", 1)[1]], b"")
            return subprocess.CompletedProcess(argv, 0, b"", b"")
        identity = {"image_ref": f"{repository}@{self.DIGEST}", "image_digest": self.DIGEST, "platform": "linux/arm64",
                    "runtime_contract": "r1-native-v6", **({"build_revision": revision} if revision else {})}
        found = {"RepoDigests": [identity["image_ref"]], "Config": {"Labels": {}}}
        with patch("runtime.image._git", side_effect=git), \
                patch("runtime.image.subprocess.run",
                      return_value=subprocess.CompletedProcess([], 0, json.dumps([found]), "")):
            return image.require_main_build(identity, inspection or self.inspection(self.FILES))

    def test_a_main_build_of_main_code_is_accepted(self):
        self.assertEqual(self.check(), self.REVISION)

    def test_a_fetch_of_main_that_never_finishes_leaves_the_runtime_unavailable(self):
        def fetch_hangs(command, **kwargs):
            if command[:2] == ["git", "fetch"]:
                raise subprocess.TimeoutExpired(command, kwargs["timeout"])
            return subprocess.CompletedProcess(command, 1, b"", b"")  # the revision is not known locally yet
        identity = {"image_ref": f"{image.REPOSITORY}@{self.DIGEST}", "image_digest": self.DIGEST,
                    "platform": "linux/arm64", "runtime_contract": "r1-native-v6", "build_revision": self.REVISION}
        with patch("runtime.image.subprocess.run", side_effect=fetch_hangs) as calls:
            refusal = refused(self, "RUNTIME_UNAVAILABLE", image.require_main_build, identity,
                              self.inspection(self.FILES))
        self.assertEqual({call.kwargs["timeout"] for call in calls.call_args_list}, {image.GIT_TIMEOUT})
        self.assertIn(f"git fetch --quiet origin main did not finish within {image.GIT_TIMEOUT} s", refusal.message)

    def test_other_builds_are_refused(self):
        for options in ({"on_main": False}, {"repository": "localhost:15000/trade"}, {"revision": None}):
            with self.subTest(options=options), self.assertRaises(Refusal) as caught:
                self.check(**options)
            self.assertEqual(caught.exception.code, "RUNTIME_NOT_MAIN")
        for field in ("runner_source_sha256", "fingerprint_source_sha256"):
            other = self.inspection({**self.FILES, SOURCE_PATHS[field]: b"changed code"})
            with self.subTest(field=field), self.assertRaises(Refusal) as caught:
                self.check(inspection=other)
            self.assertIn(SOURCE_PATHS[field], caught.exception.message)


class ContainerTests(unittest.TestCase):
    def test_only_reports_are_writable_and_the_name_is_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            command = container.container_command(IDENTITY, [(path, "/inputs/catalog", True), (path, "/reports", False)],
                                                  "engine.audit", [], "replay-x")
            self.assertEqual(command[:4], ["docker", "run", "--name", "replay-x"])
            self.assertIn(f"type=bind,source={path.resolve()},target=/inputs/catalog,readonly", command)
            self.assertIn(f"type=bind,source={path.resolve()},target=/reports", command)
            refused(self, "MOUNT_WRITABLE_NOT_REPORTS", container.container_command, IDENTITY,
                    [(path, "/product", False)], "engine.audit", [])
            refused(self, "REPORTS_MOUNT_MISSING", container.container_command, IDENTITY,
                    [(path, "/inputs", True)], "engine.audit", [])
            refused(self, "MODULE_NOT_IN_LAYOUT", container.container_command, IDENTITY,
                    [(path, "/reports", False)], "fixture", [])


if __name__ == "__main__":
    unittest.main()
