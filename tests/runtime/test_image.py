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
from shared.errors import Refusal
from runtime import container, image


CONTRACT = engine_config.RUNTIME_CONTRACT
LAYOUT = image.layout(CONTRACT)
SOURCE_PATHS = LAYOUT["source_paths"]
IDENTITY = {"image_ref": "registry.invalid/research/native@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/arm64", "runtime_contract": CONTRACT}


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
        refused(self, "RUNTIME_UNSUPPORTED", image.validate_identity, {**IDENTITY, "runtime_contract": "replay-contract@v5"})
        self.assertEqual(image.validate_identity({**IDENTITY, "build_revision": "1" * 40})["build_revision"], "1" * 40)

    def test_layout_of_an_undeclared_contract_is_refused(self):
        for contract in ("replay-contract@v5", "r1-native-v6"):
            with self.subTest(contract=contract):
                refused(self, "RUNTIME_UNSUPPORTED", image.layout, contract)
        self.assertEqual(set(image.layout(None)), {"replay-contract@v8"})


class ProbeTests(unittest.TestCase):
    def probe(self, **changes):
        value = {"runtime_contract": CONTRACT, "engine_version": "fixture", "python_version": "fixture",
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
        argv = ["--describe", "--market-root", "/m", "--market-day", "c" * 32, "--symbols", "BTCUSDT",
                "--start", "2025-01-01T00:00:00Z", "--end", "2025-01-02T00:00:00Z"]
        described = json.loads(subprocess.run([sys.executable, "-m", "engine.run", *argv], capture_output=True,
                                              text=True, check=True).stdout)
        self.assertEqual(described["runtime_contract"], "replay-contract@v8")
        self.assertEqual(CONTRACT, described["runtime_contract"])
        dockerfile = Path(__file__).resolve().parents[2] / "engine/runtime/Dockerfile"
        self.assertIn(f'{image.CONTRACT_LABEL}="{described["runtime_contract"]}"', dockerfile.read_text())
        self.assertEqual(described["source_file_paths"], SOURCE_PATHS)
        root = Path(__file__).resolve().parents[2]
        for field, path in SOURCE_PATHS.items():
            self.assertEqual(described["source_files_sha256"][field], hashlib.sha256((root / path).read_bytes()).hexdigest())
        self.assertEqual(described["audit_source_sha256"],
                         hashlib.sha256((root / LAYOUT["audit_path"]).read_bytes()).hexdigest())

    def test_the_host_hashes_a_described_configuration_as_the_runner_does(self):
        def described(*extra):
            argv = ["--describe", "--market-day", "c" * 32, "--symbols", "BTCUSDT", "ETHUSDT",
                    "--start", "2025-01-01T00:00:00Z", "--trade-start", "2025-01-01T12:00:00Z",
                    "--end", "2025-01-02T00:00:00Z", *extra]
            return json.loads(subprocess.run([sys.executable, "-m", "engine.run", *argv], capture_output=True,
                                             text=True, check=True).stdout)
        with tempfile.TemporaryDirectory() as folder:
            for name in ("a", "b"):
                (Path(folder) / name).mkdir()
                (Path(folder) / name / "universe.json").write_text('{"members": ["BTCUSDT", "ETHUSDT"]}')
            # Unmounted market roots (as Live's probe): an existing one is read (test_describe_reads_market).
            runs = [described("--market-root", f"{folder}/a/market"), described("--market-root", f"{folder}/b/market"),
                    described("--market-root", f"{folder}/a/market", "--universe", f"{folder}/a/universe.json"),
                    described("--market-root", f"{folder}/b/market", "--universe", f"{folder}/b/universe.json")]
        for run in runs:  # as the start receipt seals it and ingest reads it back
            receipt = json.loads(json.dumps({"effective_config": run["effective_config"]}).encode())
            self.assertEqual(engine_config.config_sha256(receipt["effective_config"]), run["effective_config_sha256"])
        hashes = [run["effective_config_sha256"] for run in runs]
        self.assertEqual((hashes[0] == hashes[1], hashes[2] == hashes[3], hashes[0] == hashes[2]), (True, True, False))


class ResolveTests(unittest.TestCase):
    DIGEST = "sha256:" + "f" * 64
    REVISION = "1" * 40

    def image(self, repository=image.REPOSITORY, revision=REVISION, contract=CONTRACT):
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
        pulled = [call.args[0] for call in calls.call_args_list if call.args[0][1] == "pull"]
        self.assertEqual(pulled, [["docker", "pull", "--quiet", image.CURRENT],  # then by digest, or moving the tag
                                  ["docker", "pull", "--quiet", f"{image.REPOSITORY}@{self.DIGEST}"]])  # orphans it
        self.assertEqual(identity, {"image_ref": f"{image.REPOSITORY}@{self.DIGEST}", "image_digest": self.DIGEST,
                                    "platform": "linux/arm64", "runtime_contract": CONTRACT,
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

    def test_no_docker_client_is_refused_as_unavailable(self):
        with patch("runtime.image.subprocess.run", side_effect=FileNotFoundError("docker")):
            with self.assertRaises(Refusal) as caught:
                image._docker("image", "inspect", "x", timeout=1, reference="x")
        self.assertEqual(caught.exception.code, "RUNTIME_UNAVAILABLE")
        self.assertIn("Docker must be installed", str(caught.exception))

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


# A revision's runtime files: its declared source paths, auditor and lock (runtime.image._require_build reads them).
FILES = {path: path.encode() for path in [*SOURCE_PATHS.values(), LAYOUT["audit_path"], LAYOUT["lock_path"]]}
FILES["engine/config.py"] = ("RUNTIME_SOURCE_PATHS = " + repr(SOURCE_PATHS) + "\n").encode()


def build_inspection(files: dict) -> dict:
    """The probe's source, auditor and lock hashes of an image holding `files`."""
    return {"source_files_sha256": {field: hashlib.sha256(files[path]).hexdigest()
                                    for field, path in SOURCE_PATHS.items()},
            "source_file_paths": dict(SOURCE_PATHS),
            "audit_source_sha256": hashlib.sha256(files[LAYOUT["audit_path"]]).hexdigest(),
            "dependency_lock_sha256": hashlib.sha256(files[LAYOUT["lock_path"]]).hexdigest()}


def _git(*argv: str, cwd) -> str:
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *argv], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


def branch_build(root: Path) -> tuple[Path, str]:
    """An origin whose main holds FILES and whose branch `side` adds a commit not on main, and a full clone of
    origin's main alone, so the side commit is not local; returns (the clone, the side commit)."""
    origin, checkout = root / "origin", root / "checkout"
    _git("init", "--quiet", "--initial-branch", "main", str(origin), cwd=root)
    _git("config", "uploadpack.allowFilter", "true", cwd=origin)
    for path, data in FILES.items():
        (origin / path).parent.mkdir(parents=True, exist_ok=True)
        (origin / path).write_bytes(data)
    _git("add", ".", cwd=origin)
    _git("commit", "--quiet", "-m", "runtime", cwd=origin)
    _git("checkout", "--quiet", "-b", "side", cwd=origin)
    (origin / "notes.txt").write_text("a branch change outside the runtime files\n")
    _git("add", ".", cwd=origin)
    _git("commit", "--quiet", "-m", "side", cwd=origin)
    side = _git("rev-parse", "HEAD", cwd=origin)
    _git("checkout", "--quiet", "main", cwd=origin)
    _git("clone", "--quiet", "--single-branch", "--branch", "main", f"file://{origin}", str(checkout), cwd=root)
    return checkout, side


class MainBuildTests(unittest.TestCase):
    DIGEST = "sha256:" + "f" * 64
    REVISION = "1" * 40
    FILES = FILES

    def inspection(self, files):
        return build_inspection(files)

    def check(self, repository=image.REPOSITORY, revision=REVISION, on_main=True, inspection=None):
        def git(*argv, cwd=None):
            if argv[0] == "merge-base":
                return subprocess.CompletedProcess(argv, 0 if on_main else 1, b"", b"")
            if argv[0] == "show":
                return subprocess.CompletedProcess(argv, 0, self.FILES[argv[1].split(":", 1)[1]], b"")
            return subprocess.CompletedProcess(argv, 0, b"", b"")
        identity = {"image_ref": f"{repository}@{self.DIGEST}", "image_digest": self.DIGEST, "platform": "linux/arm64",
                    "runtime_contract": CONTRACT, **({"build_revision": revision} if revision else {})}
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
                    "platform": "linux/arm64", "runtime_contract": CONTRACT, "build_revision": self.REVISION}
        with patch("runtime.image.subprocess.run", side_effect=fetch_hangs) as calls:
            refusal = refused(self, "RUNTIME_UNAVAILABLE", image.require_main_build, identity,
                              self.inspection(self.FILES))
        self.assertEqual({call.kwargs["timeout"] for call in calls.call_args_list}, {image.GIT_TIMEOUT})
        self.assertIn(f"git fetch --quiet origin main did not finish within {image.GIT_TIMEOUT} s", refusal.message)

    def test_a_shallow_checkout_reads_main_history_from_origin(self):
        # A CI image ships a one-commit .git, so an older runtime revision is checked against origin's main.
        def run(*argv, cwd):
            subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *argv], cwd=cwd, check=True,
                           capture_output=True)

        def head(cwd):
            return subprocess.run(["git", "rev-parse", "HEAD"], cwd=cwd, check=True, capture_output=True,
                                  text=True).stdout.strip()
        with tempfile.TemporaryDirectory() as scratch:
            origin, checkout = Path(scratch) / "origin", Path(scratch) / "checkout"
            run("init", "--quiet", "--initial-branch", "main", str(origin), cwd=scratch)
            run("config", "uploadpack.allowFilter", "true", cwd=origin)
            for path, data in self.FILES.items():
                (origin / path).parent.mkdir(parents=True, exist_ok=True)
                (origin / path).write_bytes(data)
            run("add", ".", cwd=origin)
            run("commit", "--quiet", "-m", "runtime", cwd=origin)
            runtime = head(origin)
            run("checkout", "--quiet", "-b", "side", cwd=origin)
            run("commit", "--quiet", "--allow-empty", "-m", "unmerged", cwd=origin)
            unmerged = head(origin)
            run("checkout", "--quiet", "main", cwd=origin)
            run("commit", "--quiet", "--allow-empty", "-m", "service", cwd=origin)
            run("clone", "--quiet", "--depth", "1", f"file://{origin}", str(checkout), cwd=scratch)
            identity = {"image_ref": f"{image.REPOSITORY}@{self.DIGEST}", "image_digest": self.DIGEST,
                        "platform": "linux/arm64", "runtime_contract": CONTRACT}
            with patch("runtime.image.CHECKOUT", checkout):
                self.assertEqual(image.require_main_build({**identity, "build_revision": runtime},
                                                          self.inspection(self.FILES)), runtime)
                refused(self, "RUNTIME_NOT_MAIN", image.require_main_build, {**identity, "build_revision": unmerged},
                        self.inspection(self.FILES))
                changed = self.inspection({**self.FILES, LAYOUT["lock_path"]: b"changed lock"})
                refused(self, "RUNTIME_NOT_MAIN", image.require_main_build, {**identity, "build_revision": runtime},
                        changed)

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


class CiBuildTests(unittest.TestCase):
    """Explorations and prechecks take a CI image of this repository from any branch (runtime.require_ci_build)."""
    DIGEST = "sha256:" + "f" * 64

    def identity(self, revision: str | None, repository: str = image.REPOSITORY) -> dict:
        return {"image_ref": f"{repository}@{self.DIGEST}", "image_digest": self.DIGEST, "platform": "linux/arm64",
                "runtime_contract": CONTRACT, **({"build_revision": revision} if revision else {})}

    def test_a_branch_build_passes_and_is_fetched_from_origin_but_stays_out_of_validation(self):
        with tempfile.TemporaryDirectory() as scratch:
            checkout, side = branch_build(Path(scratch))
            missing = subprocess.run(["git", "cat-file", "-e", f"{side}^{{commit}}"], cwd=checkout, check=False,
                                     capture_output=True)
            self.assertNotEqual(missing.returncode, 0, "the branch commit starts out of the local history")
            with patch("runtime.image.CHECKOUT", checkout):
                self.assertEqual(image.require_ci_build(self.identity(side), build_inspection(FILES)), side)
                refused(self, "RUNTIME_NOT_MAIN", image.require_main_build, self.identity(side),
                        build_inspection(FILES))
                refused(self, "RUNTIME_NOT_CI_BUILT", image.require_ci_build, self.identity("e" * 40),
                        build_inspection(FILES))
            # A CI image ships a one-commit .git: the branch commit is fetched into the clone of origin's main.
            shallow = Path(scratch) / "shallow"
            _git("clone", "--quiet", "--depth", "1", f"file://{Path(scratch) / 'origin'}", str(shallow), cwd=scratch)
            with patch("runtime.image.CHECKOUT", shallow):
                self.assertEqual(image.require_ci_build(self.identity(side), build_inspection(FILES)), side)

    def test_other_registries_unlabelled_images_and_changed_code_are_no_ci_build(self):
        with tempfile.TemporaryDirectory() as scratch:
            checkout, side = branch_build(Path(scratch))
            unlabelled = {"RepoDigests": [self.identity(None)["image_ref"]], "Config": {"Labels": {}}}
            cases = {"another registry": (self.identity(side, "localhost:15000/trade-runtime"), FILES),
                     "no revision label": (self.identity(None), FILES),
                     "changed lock": (self.identity(side), {**FILES, LAYOUT["lock_path"]: b"changed lock"}),
                     "changed runner": (self.identity(side),
                                        {**FILES, SOURCE_PATHS["runner_source_sha256"]: b"changed code"})}
            with patch("runtime.image.CHECKOUT", checkout), patch("runtime.image._image", return_value=unlabelled):
                for case, (identity, files) in cases.items():
                    with self.subTest(case=case):
                        refused(self, "RUNTIME_NOT_CI_BUILT", image.require_ci_build, identity,
                                build_inspection(files))


class ContainerTests(unittest.TestCase):
    def test_only_reports_are_writable_and_the_name_is_kept(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            command = container.container_command(IDENTITY, [(path, "/inputs/catalog", True), (path, "/reports", False)],
                                                  "engine.audit", [], "replay-x")
            self.assertEqual(command[:4], ["docker", "run", "--name", "replay-x"])
            self.assertIn(f"type=bind,source={path.resolve()},target=/inputs/catalog,readonly", command)
            self.assertIn(f"type=bind,source={path.resolve()},target=/reports", command)
