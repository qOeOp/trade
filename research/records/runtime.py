"""Digest-pinned OCI execution for the existing native replay contract."""

from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
from pathlib import Path

from research.records.common import ROOT
from research.records.common import RecordError


DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}$")
# Where the image keeps its runner, audit and identity probe.
LAYOUTS = {
    "r1-native-v5": {"runner": "engine.run", "audit": "engine.audit", "audit_args": [],
                     "probe": "engine.run",
                     "source_paths": {"config_source_sha256": "engine/config.py",
                                      "runner_source_sha256": "engine/run.py",
                                      "load_source_sha256": "engine/load.py",
                                      "report_source_sha256": "engine/report.py"},
                     "audit_path": "engine/audit.py"},
}
# Images of the same contract built before backtest/ became engine/ cannot be executed by this code;
# a run stored from one is still checked against its own revision's bytes (require_main_build), with
# the auditor path of that layout.
EARLIER_AUDIT_PATHS = {"backtest/run.py": "backtest/checks/audit.py"}
CONTRACTS = set(LAYOUTS)
# CI pushes every runtime image here; `main` is the current runtime (.github/workflows/runtime-image.yml).
REPOSITORY = "ghcr.io/qoeop/trade-runtime"
CURRENT = REPOSITORY + ":main"
REVISION_LABEL = "org.opencontainers.image.revision"
CONTRACT_LABEL = "trade.runtime.contract"


def validate_identity(value: dict) -> dict:
    if not isinstance(value, dict) or set(value) != {
        "image_ref", "image_digest", "platform", "runtime_contract"
    }:
        raise RecordError("runtime identity needs image_ref, image_digest, platform and runtime_contract")
    if not isinstance(value["image_ref"], str) or not IMAGE.fullmatch(value["image_ref"]):
        raise RecordError("runtime image_ref must include an immutable sha256 manifest digest")
    if not isinstance(value["image_digest"], str) or not DIGEST.fullmatch(value["image_digest"]):
        raise RecordError("invalid runtime image_digest")
    if value["image_ref"].rsplit("@", 1)[1] != value["image_digest"]:
        raise RecordError("runtime image_ref and image_digest disagree")
    if value["platform"] not in {"linux/arm64", "linux/amd64"}:
        raise RecordError("runtime platform must be linux/arm64 or linux/amd64")
    if value["runtime_contract"] not in CONTRACTS:
        raise RecordError("unsupported runtime contract")
    return dict(value)


def _docker(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *argv], capture_output=True, text=True, check=False)


def _image(reference: str) -> dict:
    result = _docker("image", "inspect", reference)
    if result.returncode:
        raise RecordError(f"runtime image is unavailable: {result.stderr.strip()}")
    try:
        images = json.loads(result.stdout)
        if len(images) != 1 or not isinstance(images[0], dict):
            raise ValueError("expected exactly one image")
        return images[0]
    except (ValueError, TypeError) as exc:
        raise RecordError("invalid Docker image inspection") from exc


def _repository(reference: str) -> str:
    name = reference.split("@", 1)[0]
    slash = name.rfind("/")
    return name[:slash + 1] + name[slash + 1:].split(":", 1)[0]


def resolve(reference: str | None = None) -> dict:
    """Pin an image reference, by default the current main runtime, to its manifest digest.

    A tag is pulled every time, so `main` means the latest main build; a digest reference is
    pulled only when it is not already local. The identity comes from the image itself.
    """
    reference = reference or CURRENT
    if "@" not in reference or _docker("image", "inspect", reference).returncode:
        pulled = _docker("pull", "--quiet", reference)
        if pulled.returncode:
            raise RecordError(f"cannot pull runtime image {reference}: {pulled.stderr.strip()}")
    image = _image(reference)
    repository = _repository(reference)
    digests = [value for value in image.get("RepoDigests") or [] if value.split("@", 1)[0] == repository]
    if len(set(digests)) != 1:
        raise RecordError(f"runtime image {reference} has no single manifest digest in {repository}")
    labels = (image.get("Config") or {}).get("Labels") or {}
    return validate_identity({
        "image_ref": digests[0], "image_digest": digests[0].split("@", 1)[1],
        "platform": f"{image.get('Os')}/{image.get('Architecture')}",
        "runtime_contract": labels.get(CONTRACT_LABEL),
    })


def _git(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *argv], cwd=ROOT, capture_output=True, check=False)


def _on_main(revision: str) -> bool:
    check = ("merge-base", "--is-ancestor", revision, "origin/main")
    if _git(*check).returncode == 0:
        return True
    _git("fetch", "--quiet", "origin", "main")
    return _git(*check).returncode == 0


def require_main_build(identity: dict, inspection: dict) -> str:
    """Freezes and confirmations accept only a CI image built from a commit on origin/main.

    The revision label is bound to the manifest digest; the observed runtime code must also be
    that commit's bytes, so a relabelled image of other code is refused too.
    """
    identity = validate_identity(identity)
    if _repository(identity["image_ref"]) != REPOSITORY:
        raise RecordError(f"a freeze or confirmation needs a CI image from {REPOSITORY}, not {identity['image_ref']}",
                          code="RUNTIME_NOT_MAIN", write_status="not_written")
    try:
        image = _image(identity["image_ref"])
    except RecordError:
        resolve(identity["image_ref"])
        image = _image(identity["image_ref"])
    revision = ((image.get("Config") or {}).get("Labels") or {}).get(REVISION_LABEL)
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise RecordError("runtime image has no commit revision label", code="RUNTIME_NOT_MAIN",
                          write_status="not_written")
    if not _on_main(revision):
        raise RecordError(f"runtime image revision {revision} is not on origin/main; merge first, then rerun "
                          "with the main image", code="RUNTIME_NOT_MAIN", write_status="not_written")
    expected = {path: inspection["source_files_sha256"][field] for field, path in inspection["source_file_paths"].items()}
    runner = inspection["source_file_paths"].get("runner_source_sha256")
    audit_path = EARLIER_AUDIT_PATHS.get(runner, LAYOUTS[identity["runtime_contract"]]["audit_path"])
    expected[audit_path] = inspection["audit_source_sha256"]
    expected["uv.lock"] = inspection["dependency_lock_sha256"]
    for path, digest in expected.items():
        blob = _git("show", f"{revision}:{path}")
        if blob.returncode or hashlib.sha256(blob.stdout).hexdigest() != digest:
            raise RecordError(f"runtime image code differs from {path} at its revision {revision}",
                              code="RUNTIME_NOT_MAIN", write_status="not_written")
    return revision


def image_revision(identity: dict) -> str | None:
    """The image's Git commit label, read from the local image (None when it carries none)."""
    image = _image(validate_identity(identity)["image_ref"])
    revision = ((image.get("Config") or {}).get("Labels") or {}).get(REVISION_LABEL)
    return revision if isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40}", revision) else None


def inspect_runtime(identity: dict, runner_args: list[str]) -> dict:
    """Check the local manifest identity and observe code hashes inside that image."""
    identity = validate_identity(identity)
    actual = _image(identity["image_ref"])
    try:
        if identity["image_ref"] not in actual.get("RepoDigests", []):
            raise RecordError("local image does not attest the requested manifest digest")
        platform = actual["Os"] + "/" + actual["Architecture"]
        if platform != identity["platform"]:
            raise RecordError("actual image platform differs from runtime identity")
    except (ValueError, KeyError, TypeError) as exc:
        raise RecordError("invalid Docker image inspection") from exc
    layout = LAYOUTS[identity["runtime_contract"]]
    probe = (["--describe", *runner_args] if layout["probe"] == layout["runner"]
             else ["--runner-args-json", json.dumps(runner_args, separators=(",", ":"))])
    command = container_command(identity, [], layout["probe"], probe)
    observed = subprocess.run(command, capture_output=True, text=True, check=False)
    if observed.returncode:
        raise RecordError(f"runtime identity probe failed: {observed.stderr.strip()}")
    try:
        value = json.loads(observed.stdout)
    except (ValueError, TypeError) as exc:
        raise RecordError("runtime identity probe did not return JSON") from exc
    required = {"runtime_contract", "nautilus_version", "python_version", "dependency_lock_sha256",
                "source_files_sha256", "source_file_paths", "effective_config", "effective_config_sha256", "audit_source_sha256"}
    if not isinstance(value, dict) or not required.issubset(value):
        raise RecordError("runtime identity probe omitted execution identities")
    if value["runtime_contract"] != identity["runtime_contract"]:
        raise RecordError("image runtime contract disagrees with identity")
    hashes, paths = value["source_files_sha256"], value["source_file_paths"]
    if not isinstance(hashes, dict) or not hashes or not isinstance(paths, dict) or set(paths) != set(hashes):
        raise RecordError("image probe source paths and hashes disagree")
    if paths != layout["source_paths"]:
        raise RecordError("image probe must describe all native runtime source paths")
    for field, digest in hashes.items():
        if not field.endswith("_source_sha256") or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise RecordError("invalid runtime source digest")
        path = paths[field]
        if not isinstance(path, str) or not path.startswith("engine/") or ".." in Path(path).parts:
            raise RecordError("invalid runtime source path")
    if not re.fullmatch(r"[0-9a-f]{64}", value["dependency_lock_sha256"]):
        raise RecordError("invalid image dependency lock digest")
    if not isinstance(value["audit_source_sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", value["audit_source_sha256"]):
        raise RecordError("invalid image audit source digest")
    if not isinstance(value["effective_config"], dict):
        raise RecordError("image probe effective configuration must be an object")
    encoded = json.dumps(value["effective_config"], sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    if hashlib.sha256(encoded).hexdigest() != value["effective_config_sha256"]:
        raise RecordError("image probe effective configuration hash mismatch")
    return {**value, "image_config_digest": actual["Id"], "platform": platform}


def container_command(identity: dict, mounts: list[tuple[Path, str, bool]], module: str,
                      argv: list[str]) -> list[str]:
    """Only explicit read-only inputs and one writable report mount enter the image."""
    identity = validate_identity(identity)
    command = ["docker", "run", "--rm", "--pull", "never", "--platform", identity["platform"],
               "--network", "none", "--read-only", "--cap-drop", "ALL",
               "--security-opt", "no-new-privileges", "--pids-limit", "256",
               "--user", f"{os.geteuid()}:{os.getegid()}",
               "--tmpfs", "/tmp:rw,nosuid,noexec,size=1073741824",
               "--env", "PYTHONDONTWRITEBYTECODE=1", "--entrypoint", "python"]
    writable = []
    for source, target, readonly in mounts:
        source = source.resolve()
        if not source.exists() or "," in str(source) or "," in target:
            raise RecordError("invalid runtime bind mount")
        if not readonly:
            writable.append(target)
        value = f"type=bind,source={source},target={target}"
        if readonly:
            value += ",readonly"
        command.extend(["--mount", value])
    if writable not in ([], ["/reports"]):
        raise RecordError("only the report directory may be a writable host mount")
    return [*command, identity["image_ref"], "-m", module, *argv]
