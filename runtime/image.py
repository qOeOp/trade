"""Runtime image identity (`runtime.layout`, `runtime.validate_identity`, `runtime.resolve`,
`runtime.inspect_runtime`, `runtime.require_ci_build`, `runtime.require_main_build`).

An identity is read from the image itself (its manifest digest, platform and labels), never written
by a caller. A tag reference is pulled every time, so `main` means the latest main build; a digest
reference is pulled only when it is not local. The probe runs inside the pinned image and reports
the code and effective configuration a replay would use.
"""

from __future__ import annotations

import ast
from collections.abc import Sequence
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

from engine.config import config_sha256
from ledger.execution import IDENTITY_FIELDS
from shared.refusals import refuse


DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
PLATFORMS = frozenset({"linux/arm64", "linux/amd64"})
LAYOUTS = {
    "replay-contract@v8": {"runner_module": "engine.run", "audit_module": "engine.audit",
                           "fingerprint_module": "engine.compare",
                           "source_paths": {
                               "package_source_sha256": "engine/__init__.py",
                               "config_source_sha256": "engine/config.py",
                               "runner_source_sha256": "engine/run.py",
                               "load_source_sha256": "engine/load.py",
                               "report_source_sha256": "engine/report.py",
                               "fingerprint_source_sha256": "engine/compare.py",
                               "strategy_source_sha256": "engine/strategy.py",
                               "fill_source_sha256": "engine/fill.py",
                               "order_rules_source_sha256": "engine/order_rules.py",
                               "protection_source_sha256": "engine/protection.py",
                               "warmup_source_sha256": "engine/warmup.py",
                               "history_source_sha256": "engine/history.py",
                               "klines_source_sha256": "engine/klines.py",
                               "native_csv_source_sha256": "engine/native_csv.py",
                               "live_errors_source_sha256": "engine/live_errors.py"},
                           "audit_path": "engine/audit.py", "lock_path": "uv.lock"},
}
# The modules Paper and Live run. They are only in the execution image, which adds the rest of engine/ and Redis to
# the replay image's files (engine/runtime/Dockerfile); the replay image holds only LAYOUTS' files.
EXECUTION_MODULES = {
    "replay-contract@v8": {"paper_module": "engine.paper", "egress_module": "engine.egress",
                           "live_module": "engine.live"},
}
# CI pushes both images here (.github/workflows/runtime-image.yml). `main` is the current replay image, rebuilt only
# when a replay input changes; `exec-main` is the current execution image, for Paper and Live.
REPOSITORY = "ghcr.io/qoeop/trade-runtime"
CURRENT = REPOSITORY + ":main"
EXECUTION = REPOSITORY + ":exec-main"
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


def execution_modules(runtime_contract: str) -> dict:
    """The Paper and Live module names of one runtime contract (the execution image's)."""
    found = EXECUTION_MODULES.get(runtime_contract) if isinstance(runtime_contract, str) else None
    if found is None:
        raise refuse("RUNTIME_UNSUPPORTED", f"runtime contract {runtime_contract!r} has no execution modules",
                     missing=(str(runtime_contract),), expected=", ".join(sorted(EXECUTION_MODULES)))
    return dict(found)


def _copy(value: dict) -> dict:
    return {**value, "source_paths": dict(value["source_paths"])}


def _supported_source_paths(runtime_contract: str, paths: dict) -> bool:
    return paths == layout(runtime_contract)["source_paths"]


def validate_identity(value) -> dict:
    """The normalized identity: four required fields, an immutable digest reference that agrees with
    the digest, a supported platform and contract, and an optional 40-hex build revision."""
    if (not isinstance(value, dict) or not set(IDENTITY_FIELDS) <= set(value)
            or set(value) - {*IDENTITY_FIELDS, "build_revision"}):
        raise refuse("RUNTIME_IDENTITY_INVALID", "a runtime identity holds image_ref, image_digest, platform, "
                                                 "runtime_contract and optionally build_revision",
                     expected=", ".join(IDENTITY_FIELDS))
    if any(not isinstance(value[key], str) or not value[key] for key in IDENTITY_FIELDS):
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
    normalized = {key: value[key] for key in IDENTITY_FIELDS}
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
    except OSError as exc:
        raise refuse("RUNTIME_UNAVAILABLE", f"the docker client could not run ({exc}): every replay runs in a "
                                            "container, so Docker must be installed and running",
                     missing=("docker",)) from exc


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


def _pull(reference: str) -> None:
    pulled = _docker("pull", "--quiet", reference, timeout=PULL_TIMEOUT, reference=reference)
    if pulled.returncode:
        raise refuse("RUNTIME_UNAVAILABLE", f"cannot pull runtime image {reference}: {pulled.stderr.strip()}",
                     missing=(reference,))


def resolve(reference: str | None = None) -> dict:
    """Pin a tag or digest reference (default: the main tag) to its single manifest digest and read
    the identity from the image."""
    reference = reference or CURRENT
    if not isinstance(reference, str) or not reference.strip():
        raise refuse("RUNTIME_UNAVAILABLE", "the runtime reference is empty", missing=("runtime",))
    if "@" not in reference or _docker("image", "inspect", reference, timeout=INSPECT_TIMEOUT,
                                       reference=reference).returncode:
        _pull(reference)
    image = _image(reference)
    name = repository(reference)
    digests = sorted({value for value in image.get("RepoDigests") or [] if value.split("@", 1)[0] == name})
    if len(digests) != 1:
        raise refuse("RUNTIME_DIGEST_AMBIGUOUS", f"runtime image {reference} has no single manifest digest in {name}",
                     missing=(reference,))
    if "@" not in reference:
        _pull(digests[0])  # a tag alone names it: the next pull that moves the tag leaves the digest unreachable
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

    `mounts` are the read-only inputs the probe reads (the exported market, which it reads so an image that
    cannot read the export refuses before a trial, and the universe membership file, whose bytes enter the
    effective configuration); a writable mount is refused."""
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
    if not _supported_source_paths(identity["runtime_contract"], paths):
        raise refuse("RUNTIME_MISMATCH", "the probe's source paths are not a complete supported contract layout")
    if config_sha256(value["effective_config"]) != value["effective_config_sha256"]:
        raise refuse("RUNTIME_MISMATCH", "the probe's effective configuration does not hash to its recorded hash")
    return {**value, "image_config_digest": actual.get("Id"), "platform": platform}


def _git(*argv: str, cwd: Path | None = None) -> subprocess.CompletedProcess:
    """One git call, in the product checkout by default; past GIT_TIMEOUT seconds it is killed and the
    runtime's revision cannot be checked (RUNTIME_UNAVAILABLE)."""
    try:
        return subprocess.run(["git", *argv], cwd=cwd or CHECKOUT, capture_output=True, check=False,
                              timeout=GIT_TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        raise _unavailable(f"git {' '.join(argv)}", GIT_TIMEOUT, "origin/main") from exc


def _history(scratch: Path) -> tuple[Path, str]:
    """Where origin's history and file bytes are read, and main's name there: the product checkout, or for a
    shallow one (a CI image ships only the commit it was built from) a blobless clone of origin's main in
    `scratch`, which fetches a file's bytes when they are read."""
    if _git("rev-parse", "--is-shallow-repository").stdout.strip() != b"true":
        return CHECKOUT, "origin/main"
    url = _git("remote", "get-url", "origin").stdout.decode().strip()
    clone = scratch / "main.git"
    cloned = _git("clone", "--quiet", "--bare", "--filter=blob:none", "--single-branch", "--branch", "main", url,
                  str(clone)) if url else None
    if cloned is None or cloned.returncode:
        why = cloned.stderr.decode(errors="replace").strip()[-500:] if cloned else "the checkout names no origin"
        raise refuse("RUNTIME_UNAVAILABLE", f"origin's main history could not be read: {why}", missing=("origin/main",))
    return clone, "main"


def _on_main(revision: str, where: Path, main: str) -> bool:
    check = ("merge-base", "--is-ancestor", revision, main)
    if _git(*check, cwd=where).returncode == 0:
        return True
    _git("fetch", "--quiet", "origin", "main", cwd=where)
    return _git(*check, cwd=where).returncode == 0


def _known(revision: str, where: Path) -> bool:
    """Whether the commit is in this history, fetched by its hash from origin when it is not yet (GitHub serves
    a commit reachable from any branch or pull request ref)."""
    check = ("cat-file", "-e", f"{revision}^{{commit}}")
    if _git(*check, cwd=where).returncode == 0:
        return True
    _git("fetch", "--quiet", "origin", revision, cwd=where)
    return _git(*check, cwd=where).returncode == 0


def _declared_source_paths(source: bytes, runtime_contract: str, code: str = "RUNTIME_NOT_MAIN") -> dict:
    """Read one literal declaration from trusted Git bytes, without executing them."""
    name = "RUNTIME_SOURCE_PATHS"
    try:
        tree = ast.parse(source)
        declarations = [node for node in tree.body if isinstance(node, ast.Assign)
                        and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                        and node.targets[0].id == name]
        writes = [node for node in ast.walk(tree) if isinstance(node, ast.Name)
                  and node.id == name and isinstance(node.ctx, (ast.Store, ast.Del))]
        if len(declarations) != 1 or len(writes) != 1:
            raise ValueError("expected one top-level assignment")
        value = declarations[0].value
        if (not isinstance(value, ast.Dict)
                or any(not isinstance(node, ast.Constant) or not isinstance(node.value, str)
                       for node in [*value.keys, *value.values])):
            raise ValueError("expected literal string keys and paths")
        paths = ast.literal_eval(value)
        if len(paths) != len(value.keys) or not _supported_source_paths(runtime_contract, paths):
            raise ValueError("unknown or duplicate source paths")
        for node in ast.walk(tree):
            if (isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name)
                    and node.value.id == name and isinstance(node.ctx, (ast.Store, ast.Del))):
                raise ValueError("source paths may not be mutated")
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == name
                    and node.func.attr not in {"copy", "items", "keys", "values", "get"}):
                raise ValueError("source paths may not be mutated")
        return paths
    except (SyntaxError, ValueError, TypeError, UnicodeError) as exc:
        raise refuse(code, "the revision has no unique supported literal RUNTIME_SOURCE_PATHS declaration") from exc


def require_ci_build(identity: dict, inspection: dict) -> str:
    """Research (explore, precheck): a CI image of this repository from any branch, that is an image of the
    product registry whose runner, auditor, fingerprint and lock bytes are those of its build revision in
    origin's history; returns the build revision."""
    return _require_build(identity, inspection, "RUNTIME_NOT_CI_BUILT", on_main=False)


def require_main_build(identity: dict, inspection: dict) -> str:
    """Out-of-sample validation only: require_ci_build's check, of a commit on main; returns the build revision."""
    return _require_build(identity, inspection, "RUNTIME_NOT_MAIN", on_main=True)


def _require_build(identity: dict, inspection: dict, code: str, on_main: bool) -> str:
    identity = validate_identity(identity)
    if repository(identity["image_ref"]) != REPOSITORY:
        raise refuse(code, f"{identity['image_ref']} is not in {REPOSITORY}, where this repository's CI pushes "
                           "its images")
    revision = identity.get("build_revision")
    if revision is None:
        revision = _labels(_image(identity["image_ref"])).get(REVISION_LABEL)
    if not isinstance(revision, str) or not REVISION.fullmatch(revision):
        raise refuse(code, f"runtime image {identity['image_ref']} has no build source revision label",
                     missing=(REVISION_LABEL,))
    found = layout(identity["runtime_contract"])
    with tempfile.TemporaryDirectory(prefix="main-history-") as scratch:
        where, main = _history(Path(scratch))
        if on_main and not _on_main(revision, where, main):
            raise refuse(code, f"runtime image revision {revision} is not on origin/main; merge first, then replay "
                               "with the main image")
        if not on_main and not _known(revision, where):
            raise refuse(code, f"runtime image revision {revision} is in no history of origin")
        config_path = found["source_paths"]["config_source_sha256"]
        config = _git("show", f"{revision}:{config_path}", cwd=where)
        if config.returncode:
            raise refuse(code, f"runtime revision {revision} has no {config_path}")
        required = _declared_source_paths(config.stdout, identity["runtime_contract"], code)
        try:
            paths, hashes = inspection["source_file_paths"], inspection["source_files_sha256"]
            if not isinstance(paths, dict) or paths != required or not isinstance(hashes, dict) or set(hashes) != set(required):
                raise ValueError("source layout differs from the trusted revision")
            expected = {path: hashes[field] for field, path in required.items()}
            expected[found["audit_path"]] = inspection["audit_source_sha256"]
            expected[found["lock_path"]] = inspection["dependency_lock_sha256"]
            if any(not isinstance(digest, str) or not SHA256.fullmatch(digest) for digest in expected.values()):
                raise ValueError("invalid source, audit or lock digest")
        except (KeyError, TypeError, ValueError) as exc:
            raise refuse(code, "the inspection does not completely identify the trusted revision's source "
                               "layout") from exc
        for path, digest in expected.items():
            blob = _git("show", f"{revision}:{path}", cwd=where)
            if blob.returncode or hashlib.sha256(blob.stdout).hexdigest() != digest:
                raise refuse(code, f"runtime image code differs from {path} at its revision {revision}")
    return revision
