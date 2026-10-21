"""Runtime image identity (`runtime.layout`, `runtime.validate_identity`, `runtime.resolve`,
`runtime.inspect_runtime`, `runtime.require_main_build`).

An identity is read from the image itself (its manifest digest, platform and labels), never written
by a caller. A tag reference is pulled every time, so `main` means the latest main build; a digest
reference is pulled only when it is not local. The probe runs inside the pinned image and reports
the code and effective configuration a replay would use.
"""

from __future__ import annotations

from collections.abc import Sequence
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

from ledger import problems
from ledger.refusals import refuse


DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
PLATFORMS = frozenset({"linux/arm64", "linux/amd64"})
REQUIRED = ("image_ref", "image_digest", "platform", "runtime_contract")
# The modules and source paths of each runtime contract inside its image. The refactor keeps no
# compatibility: an image built before a layout change is no longer supported.
LAYOUTS = {
    "r1-native-v6": {"runner_module": "engine.run", "audit_module": "engine.audit",
                     "fingerprint_module": "engine.compare",
                     "source_paths": {"config_source_sha256": "engine/config.py",
                                      "runner_source_sha256": "engine/run.py",
                                      "load_source_sha256": "engine/load.py",
                                      "report_source_sha256": "engine/report.py",
                                      "fingerprint_source_sha256": "engine/compare.py"},
                     "audit_path": "engine/audit.py", "lock_path": "uv.lock"},
}
# CI pushes every runtime image here; `main` is the current runtime (.github/workflows/runtime-image.yml).
REPOSITORY = "ghcr.io/qoeop/trade-runtime"
CURRENT = REPOSITORY + ":main"
REVISION_LABEL = "org.opencontainers.image.revision"
CONTRACT_LABEL = "trade.runtime.contract"
CHECKOUT = Path(__file__).resolve().parents[1]
PROBE_FIELDS = ("runtime_contract", "engine_version", "python_version", "dependency_lock_sha256",
                "source_files_sha256", "source_file_paths", "effective_config", "effective_config_sha256",
                "audit_source_sha256")


def layout(runtime_contract: str | None) -> dict:
    """The image layout of one runtime contract; None gives every contract's layout."""
    if runtime_contract is None:
        return {name: _copy(value) for name, value in LAYOUTS.items()}
    found = LAYOUTS.get(runtime_contract) if isinstance(runtime_contract, str) else None
    if found is None:
        raise refuse("RUNTIME_UNSUPPORTED", f"runtime contract {runtime_contract!r} has no image layout",
                     missing=(str(runtime_contract),), expected=", ".join(sorted(LAYOUTS)))
    return _copy(found)


def _copy(value: dict) -> dict:
    return {**value, "source_paths": dict(value["source_paths"])}


def validate_identity(value) -> dict:
    """The normalized identity: four required fields, an immutable digest reference that agrees with
    the digest, a supported platform and contract, and an optional 40-hex build revision."""
    if not isinstance(value, dict) or not set(REQUIRED) <= set(value) or set(value) - {*REQUIRED, "build_revision"}:
        raise refuse("RUNTIME_IDENTITY_INVALID", "a runtime identity holds image_ref, image_digest, platform, "
                                                 "runtime_contract and optionally build_revision",
                     expected=", ".join(REQUIRED))
    if any(not isinstance(value[key], str) or not value[key] for key in REQUIRED):
        raise refuse("RUNTIME_IDENTITY_INVALID", "every runtime identity field is a nonempty string")
    if not IMAGE.fullmatch(value["image_ref"]) or not DIGEST.fullmatch(value["image_digest"]):
        raise refuse("RUNTIME_IDENTITY_INVALID", "the runtime image_ref must carry an immutable sha256 manifest digest",
                     expected="<image>@sha256:<64 hex>")
    if value["image_ref"].rsplit("@", 1)[1] != value["image_digest"]:
        raise refuse("RUNTIME_IDENTITY_INVALID", "the runtime image_ref and image_digest disagree")
    if value["platform"] not in PLATFORMS or value["runtime_contract"] not in LAYOUTS:
        raise refuse("RUNTIME_UNSUPPORTED", f"platform {value['platform']} or contract {value['runtime_contract']} is "
                                            "not supported", expected=", ".join(sorted(PLATFORMS)))
    revision = value.get("build_revision")
    if revision is not None and (not isinstance(revision, str) or not REVISION.fullmatch(revision)):
        raise refuse("RUNTIME_IDENTITY_INVALID", "build_revision is a 40-hex Git commit hash")
    normalized = {key: value[key] for key in REQUIRED}
    if "build_revision" in value:
        normalized["build_revision"] = revision
    return normalized


# Seconds a docker client call may take before the runtime counts as unavailable; uncalibrated example values.
INSPECT_TIMEOUT = 60
PULL_TIMEOUT = 300
PROBE_TIMEOUT = 300
GIT_TIMEOUT = 120  # one git call, the fetch of origin/main included
HUNG_PULL = ("a credential helper that never answers (credsStore or credHelpers in the Docker config) blocks a "
             "pull; the public runtime image pulls anonymously")


def _unavailable(what: str, timeout: float, reference: str, why: str = ""):
    return refuse("RUNTIME_UNAVAILABLE", f"{what} did not finish within {timeout:g} s" + (f": {why}" if why else ""),
                  missing=(reference,))


def _docker(*argv: str, timeout: float, reference: str) -> subprocess.CompletedProcess:
    """One docker client call; past `timeout` seconds it is killed and the runtime is unavailable."""
    try:
        return subprocess.run(["docker", *argv], capture_output=True, text=True, check=False, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        verb = " ".join(value for value in argv if not value.startswith("-") and value != reference)
        raise _unavailable(f"docker {verb} {reference}", timeout, reference,
                           HUNG_PULL if argv[0] == "pull" else "") from exc


def _image(reference: str) -> dict:
    result = _docker("image", "inspect", reference, timeout=INSPECT_TIMEOUT, reference=reference)
    if result.returncode:
        raise refuse("RUNTIME_UNAVAILABLE", f"runtime image {reference} cannot be inspected: {result.stderr.strip()}",
                     missing=(reference,))
    try:
        images = json.loads(result.stdout)
        if len(images) != 1 or not isinstance(images[0], dict):
            raise ValueError("expected exactly one image")
        return images[0]
    except (ValueError, TypeError) as exc:
        raise refuse("RUNTIME_UNAVAILABLE", f"the inspection of {reference} is not one image") from exc


def repository(reference: str) -> str:
    """The image name of a reference, without its tag or digest."""
    name = reference.split("@", 1)[0]
    slash = name.rfind("/")
    return name[:slash + 1] + name[slash + 1:].split(":", 1)[0]


def _labels(image: dict) -> dict:
    return (image.get("Config") or {}).get("Labels") or {}


def resolve(reference: str | None = None) -> dict:
    """Pin a tag or digest reference (default: the main tag) to its single manifest digest and read
    the identity from the image."""
    reference = reference or CURRENT
    if not isinstance(reference, str) or not reference.strip():
        raise refuse("RUNTIME_UNAVAILABLE", "the runtime reference is empty", missing=("runtime",))
    if "@" not in reference or _docker("image", "inspect", reference, timeout=INSPECT_TIMEOUT,
                                       reference=reference).returncode:
        pulled = _docker("pull", "--quiet", reference, timeout=PULL_TIMEOUT, reference=reference)
        if pulled.returncode:
            raise refuse("RUNTIME_UNAVAILABLE", f"cannot pull runtime image {reference}: {pulled.stderr.strip()}",
                         missing=(reference,))
    image = _image(reference)
    name = repository(reference)
    digests = sorted({value for value in image.get("RepoDigests") or [] if value.split("@", 1)[0] == name})
    if len(digests) != 1:
        raise refuse("RUNTIME_DIGEST_AMBIGUOUS", f"runtime image {reference} has no single manifest digest in {name}",
                     missing=(reference,))
    labels = _labels(image)
    if not labels.get(CONTRACT_LABEL):
        raise refuse("RUNTIME_IDENTITY_INVALID", f"runtime image {reference} carries no {CONTRACT_LABEL} label",
                     missing=(CONTRACT_LABEL,))
    revision = labels.get(REVISION_LABEL)
    return validate_identity({
        "image_ref": digests[0], "image_digest": digests[0].split("@", 1)[1],
        "platform": f"{image.get('Os')}/{image.get('Architecture')}", "runtime_contract": labels[CONTRACT_LABEL],
        "build_revision": revision if isinstance(revision, str) and REVISION.fullmatch(revision) else None})


def _probe_invalid(why: str):
    return refuse("RUNTIME_PROBE_INVALID", f"the runtime identity probe {why}")


def inspect_runtime(identity: dict, runner_args: list[str], mounts: Sequence[tuple[Path, str, bool]] = ()) -> dict:
    """Check the local image against the identity and run the identity probe inside it.

    `mounts` are the read-only inputs the probe reads (the universe membership file, whose bytes
    enter the effective configuration); a writable mount is refused."""
    from runtime import container
    identity = validate_identity(identity)
    if any(not readonly for _, _, readonly in mounts):
        raise _probe_invalid("may not have a writable mount")
    actual = _image(identity["image_ref"])
    platform = f"{actual.get('Os')}/{actual.get('Architecture')}"
    if identity["image_ref"] not in (actual.get("RepoDigests") or []):
        raise refuse("RUNTIME_MISMATCH", "the local image does not carry the requested manifest digest",
                     missing=(identity["image_ref"],))
    if platform != identity["platform"]:
        raise refuse("RUNTIME_MISMATCH", f"the local image is {platform}, the identity {identity['platform']}",
                     expected=identity["platform"])
    found = layout(identity["runtime_contract"])
    name = f"runtime-probe-{os.getpid()}-{time.time_ns()}"
    command = container.command(identity, list(mounts), found["runner_module"], ["--describe", *runner_args],
                                name=name)
    try:
        observed = subprocess.run(command, capture_output=True, text=True, check=False, timeout=PROBE_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        try:  # killing the docker client alone leaves the container running
            subprocess.run(["docker", "kill", name], capture_output=True, check=False, timeout=INSPECT_TIMEOUT)
        except subprocess.TimeoutExpired:
            pass
        raise _unavailable("the runtime identity probe", PROBE_TIMEOUT, identity["image_ref"]) from exc
    if observed.returncode:
        raise _probe_invalid(f"failed: {observed.stderr.strip()[-2000:]}")
    try:
        value = json.loads(observed.stdout)
    except (ValueError, TypeError) as exc:
        raise _probe_invalid("did not return JSON") from exc
    if not isinstance(value, dict) or not set(PROBE_FIELDS) <= set(value):
        raise _probe_invalid("omitted execution identities")
    hashes, paths = value["source_files_sha256"], value["source_file_paths"]
    if not isinstance(hashes, dict) or not hashes or not isinstance(paths, dict) or set(paths) != set(hashes):
        raise _probe_invalid("returned source paths and hashes that disagree")
    for field, digest in hashes.items():
        if not field.endswith("_source_sha256") or not isinstance(digest, str) or not SHA256.fullmatch(digest):
            raise _probe_invalid(f"returned an invalid source digest for {field}")
    for field in ("dependency_lock_sha256", "audit_source_sha256", "effective_config_sha256"):
        if not isinstance(value[field], str) or not SHA256.fullmatch(value[field]):
            raise _probe_invalid(f"returned an invalid {field}")
    if not isinstance(value["effective_config"], dict):
        raise _probe_invalid("returned an effective configuration that is no object")
    if value["runtime_contract"] != identity["runtime_contract"]:
        raise refuse("RUNTIME_MISMATCH", "the image's runtime contract disagrees with its identity",
                     expected=identity["runtime_contract"])
    if paths != found["source_paths"]:
        raise refuse("RUNTIME_MISMATCH", "the probe's source paths are not the contract's layout",
                     expected=json.dumps(found["source_paths"], sort_keys=True))
    if problems.config_sha256(value["effective_config"]) != value["effective_config_sha256"]:
        raise refuse("RUNTIME_MISMATCH", "the probe's effective configuration does not hash to its recorded hash")
    return {**value, "image_config_digest": actual.get("Id"), "platform": platform}


def _git(*argv: str) -> subprocess.CompletedProcess:
    """One git call in the product checkout; past GIT_TIMEOUT seconds it is killed and the runtime's
    revision cannot be checked (RUNTIME_UNAVAILABLE)."""
    try:
        return subprocess.run(["git", *argv], cwd=CHECKOUT, capture_output=True, check=False, timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        raise _unavailable(f"git {' '.join(argv)}", GIT_TIMEOUT, "origin/main") from exc


def _on_main(revision: str) -> bool:
    check = ("merge-base", "--is-ancestor", revision, "origin/main")
    if _git(*check).returncode == 0:
        return True
    _git("fetch", "--quiet", "origin", "main")
    return _git(*check).returncode == 0


def _not_main(why: str):
    return refuse("RUNTIME_NOT_MAIN", why)


def require_main_build(identity: dict, inspection: dict) -> str:
    """Out-of-sample validation only: a CI image of the product registry built from a commit on main
    whose runner, auditor, fingerprint and lock bytes are that commit's; returns the build revision."""
    identity = validate_identity(identity)
    if repository(identity["image_ref"]) != REPOSITORY:
        raise _not_main(f"a validation needs a CI image from {REPOSITORY}, not {identity['image_ref']}")
    revision = identity.get("build_revision")
    if revision is None:
        revision = _labels(_image(identity["image_ref"])).get(REVISION_LABEL)
    if not isinstance(revision, str) or not REVISION.fullmatch(revision):
        raise _not_main(f"runtime image {identity['image_ref']} has no build source revision label")
    if not _on_main(revision):
        raise _not_main(f"runtime image revision {revision} is not on origin/main; merge first, then replay with the "
                        "main image")
    found = layout(identity["runtime_contract"])
    try:
        expected = {path: inspection["source_files_sha256"][field]
                    for field, path in inspection["source_file_paths"].items()}
        expected[found["audit_path"]] = inspection["audit_source_sha256"]
        expected[found["lock_path"]] = inspection["dependency_lock_sha256"]
    except (KeyError, TypeError, AttributeError) as exc:
        raise _not_main("the inspection lacks the source, audit or lock hashes") from exc
    for path, digest in expected.items():
        blob = _git("show", f"{revision}:{path}")
        if blob.returncode or hashlib.sha256(blob.stdout).hexdigest() != digest:
            raise _not_main(f"runtime image code differs from {path} at its revision {revision}")
    return revision
