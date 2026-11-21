"""The one runtime contract's layout and the shape of a runtime identity (`runtime.LAYOUT`,
`runtime.validate_identity`): what the image module reads from an image and the container module runs.
"""

from __future__ import annotations

import re

from engine.config import AUDIT_PATH, RUNTIME_CONTRACT, RUNTIME_SOURCE_PATHS
from ledger.execution import IDENTITY_FIELDS
from shared.refusals import refuse


DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
PLATFORMS = frozenset({"linux/arm64", "linux/amd64"})
# The modules and files of the one runtime contract (engine.config.RUNTIME_CONTRACT). The replay image holds only
# the source paths, the auditor and the lock; the Paper and Live modules are only in the execution image, which adds
# the rest of engine/ and Redis (engine/runtime/Dockerfile).
LAYOUT: dict = {
    "runner_module": "engine.run", "audit_module": "engine.audit", "fingerprint_module": "engine.compare",
    "paper_module": "engine.paper", "egress_module": "engine.egress", "live_module": "engine.live",
    "source_paths": RUNTIME_SOURCE_PATHS, "audit_path": AUDIT_PATH, "lock_path": "uv.lock"}


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
    if value["platform"] not in PLATFORMS or value["runtime_contract"] != RUNTIME_CONTRACT:
        raise refuse("RUNTIME_UNSUPPORTED", f"platform {value['platform']} or contract {value['runtime_contract']} is "
                                            "not supported", expected=", ".join(sorted(PLATFORMS)))
    revision = value.get("build_revision")
    if revision is not None and (not isinstance(revision, str) or not REVISION.fullmatch(revision)):
        raise refuse("RUNTIME_IDENTITY_INVALID", "build_revision is a 40-hex Git commit hash")
    normalized = {key: value[key] for key in IDENTITY_FIELDS}
    if "build_revision" in value:
        normalized["build_revision"] = revision
    return normalized
