"""Execution start receipts (`ledger.start_receipt`).

Before a replay's container starts, its trial row, binding and start receipt land in one commit:
every attempt has an identity before it has output. The receipt is the product-reserved bundle
trial-<trial_id>-execution-start. Sealing, reading and recovering the execution capture
(`seal_capture`, `read_capture`, `recover_capture`) are a later phase.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import re

from ledger import db, evidence
from ledger.refusals import refuse


FORMAT = "execution_start_v1"
MANIFEST = "execution.json"
SOURCE = "strategy.py"
COVERAGE = "input-coverage.json"
IMAGE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
IDENTITY_FIELDS = ("image_ref", "image_digest", "platform", "runtime_contract")


def pinned_identity(value) -> dict | None:
    """The runtime identity's four fields (and build revision) when its image is pinned by digest.

    Seam: the shape part of runtime.validate_identity; the supported platform and contract sets
    stay with the runtime package of a later phase.
    """
    if not isinstance(value, Mapping):
        return None
    if any(not isinstance(value.get(field), str) or not value.get(field) for field in IDENTITY_FIELDS):
        return None
    if (not IMAGE.fullmatch(value["image_ref"]) or not DIGEST.fullmatch(value["image_digest"])
            or value["image_ref"].rsplit("@", 1)[1] != value["image_digest"]):
        return None
    identity = {field: value[field] for field in IDENTITY_FIELDS}
    if value.get("build_revision") is not None:
        if not isinstance(value["build_revision"], str) or not REVISION.fullmatch(value["build_revision"]):
            return None
        identity["build_revision"] = value["build_revision"]
    return identity


def start_receipt(conn: db.LedgerConnection, trial_id: int, context: Mapping, op_id: str) -> dict:
    """Write trial-<trial_id>-execution-start inside the caller's write; returns its manifest hash.

    `context`: source_sha256, runtime_identity, workdir, argv, mounts, input_identity,
    source_bytes and input_coverage (the coverage receipt bytes).
    """
    trial = conn.one("SELECT trial_id, purpose, source_sha256, image_ref FROM trial WHERE trial_id = %s", (trial_id,))
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id} in this transaction", missing=(str(trial_id),))
    source = context.get("source_bytes")
    identity = pinned_identity(context.get("runtime_identity"))
    coverage = context.get("input_coverage")
    if (context.get("source_sha256") != trial["source_sha256"] or not isinstance(source, bytes)
            or hashlib.sha256(source).hexdigest() != trial["source_sha256"]):
        raise refuse("EXECUTION_IDENTITY", "the source bytes or hash differ from the trial row",
                     missing=("source_sha256",))
    if identity is None or identity["image_ref"] != trial["image_ref"]:
        raise refuse("EXECUTION_IDENTITY", "the runtime identity is malformed or differs from the trial row",
                     missing=("runtime_identity",))
    if not isinstance(coverage, bytes) or not coverage:
        raise refuse("EXECUTION_IDENTITY", "the start context has no input coverage receipt",
                     missing=("input_coverage",))
    manifest = {"format": FORMAT, "trial_id": trial_id, "purpose": trial["purpose"],
                "source_sha256": trial["source_sha256"], "runtime_identity": identity,
                "workdir": context.get("workdir"), "argv": list(context.get("argv") or ()),
                "mounts": list(context.get("mounts") or ()), "input_identity": context.get("input_identity")}
    encoded = db.canonical_json(manifest).encode("utf-8")
    bundle = f"trial-{trial_id}-execution-start"
    evidence.write_files(conn, bundle, {MANIFEST: encoded, SOURCE: source, COVERAGE: coverage},
                         f"execution_start:{op_id}")
    return {"bundle": bundle, "path": MANIFEST, "sha256": hashlib.sha256(encoded).hexdigest()}
