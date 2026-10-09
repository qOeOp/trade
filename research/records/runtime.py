"""Digest-pinned OCI execution for the existing native replay contract."""

from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
from pathlib import Path

from research.records.common import RecordError


DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}$")
CONTRACTS = {"r1-native-v1", "r1-native-v2"}
SOURCE_PATHS = {f"{name}_source_sha256": f"backtest/r1/{name}.py"
                for name in ("runner", "native_node", "node_strategy", "replay_inputs", "replay_util", "strategy_loader")}
SOURCE_PATHS["runner_source_sha256"] = "backtest/r1/run_portfolio.py"


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


def inspect_runtime(identity: dict, runner_args: list[str]) -> dict:
    """Check the local manifest identity and observe code hashes inside that image."""
    identity = validate_identity(identity)
    result = subprocess.run(
        ["docker", "image", "inspect", identity["image_ref"]],
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise RecordError(f"pinned runtime image is unavailable: {result.stderr.strip()}")
    try:
        images = json.loads(result.stdout)
        if len(images) != 1:
            raise ValueError("expected exactly one image")
        actual = images[0]
        if identity["image_ref"] not in actual.get("RepoDigests", []):
            raise RecordError("local image does not attest the requested manifest digest")
        platform = actual["Os"] + "/" + actual["Architecture"]
        if platform != identity["platform"]:
            raise RecordError("actual image platform differs from runtime identity")
    except (ValueError, KeyError, TypeError) as exc:
        raise RecordError("invalid Docker image inspection") from exc
    command = container_command(identity, [], "backtest.r1.runtime_identity", [
        "--runner-args-json", json.dumps(runner_args, separators=(",", ":")),
    ])
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
    if paths != SOURCE_PATHS:
        raise RecordError("image probe must describe all native runtime source paths")
    for field, digest in hashes.items():
        if not field.endswith("_source_sha256") or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise RecordError("invalid runtime source digest")
        path = paths[field]
        if not isinstance(path, str) or not path.startswith("backtest/r1/") or ".." in Path(path).parts:
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
