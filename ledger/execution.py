"""Execution start receipts (`ledger.start_receipt`).

Before a replay's container starts, its trial row, binding and start receipt land in one commit:
every attempt has an identity before it has output. The receipt is the product-reserved bundle
trial-<trial_id>-execution-start. Reading the final execution capture (`read_capture`) is here
because registration needs it; sealing and recovering it (`seal_capture`, `recover_capture`) are a
later phase, which owns the writer of the capture format read below.
"""

from __future__ import annotations

from collections.abc import Mapping
import hashlib
import json
import re

from ledger import db, evidence
from ledger.refusals import refuse


FORMAT = "execution_start_v1"
MANIFEST = "execution.json"
SOURCE = "strategy.py"
COVERAGE = "input-coverage.json"
CAPTURE_FORMAT = "execution_capture_v1"
CAPTURED_SOURCE = "source/strategy.py"
RUNTIME_ERRORS = "reports/runtime_errors.jsonl"
FILE_STATUSES = ("captured", "captured_empty", "missing", "not_started")
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


def _json(data: bytes):
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None


def _bundle_rows(conn: db.LedgerConnection, bundle: str, clause: str) -> dict[str, bytes] | None:
    """Every file of a bundle with its hash recomputed (as ledger.load_bundle), or None without the bundle."""
    if not conn.rows(f"SELECT 1 FROM evidence_bundle{clause} WHERE bundle = %s", (bundle,)):
        return None
    files = {}
    for path, content, stored in conn.rows(f"SELECT path, content, sha256 FROM evidence{clause} WHERE bundle = %s "
                                           "ORDER BY path", (bundle,)):
        content = bytes(content)
        if hashlib.sha256(content).hexdigest() != stored:
            raise refuse("LEDGER_CORRUPT", f"stored file {bundle}/{path} differs from its content hash",
                         missing=(f"{bundle}/{path}",))
        files[path] = content
    return files


def _identity_matches(manifest: dict, trial: dict) -> bool:
    identity = pinned_identity(manifest.get("runtime_identity"))
    return (manifest.get("trial_id") == trial["trial_id"] and manifest.get("source_sha256") == trial["source_sha256"]
            and identity is not None and identity["image_ref"] == trial["image_ref"])


def read_capture(conn: db.LedgerConnection, trial_id: int, at: str | None = None) -> dict:
    """The original execution capture of a trial, every identity and file hash checked.

    Without a final capture: {status: missing, start, input_coverage, reason}; recovery bundles are
    never read. With one: {status: captured, purpose, stages, outcome, argv, files (captured bytes by
    path), statuses (status by path), runtime_failures, start, input_coverage}. `start` is the start
    receipt's execution.json and `input_coverage` its parsed input-coverage.json (None when it is not
    JSON). Whether the capture makes the run unusable is not decided here.
    """
    _, clause = db.as_of(conn, at)
    trial = conn.one(f"SELECT trial_id, purpose, source_sha256, image_ref FROM trial{clause} WHERE trial_id = %s",
                     (trial_id,))
    if trial is None:
        raise refuse("TRIAL_NOT_FOUND", f"no trial {trial_id} on this ledger version", missing=(str(trial_id),))
    start_files = _bundle_rows(conn, f"trial-{trial_id}-execution-start", clause)
    start = _json(start_files[MANIFEST]) if start_files and MANIFEST in start_files else None
    if (not isinstance(start, dict) or start.get("format") != FORMAT or not _identity_matches(start, trial)
            or start.get("purpose") != trial["purpose"]):
        raise refuse("EXECUTION_IDENTITY", f"the start receipt of trial {trial_id} is missing or differs from the "
                                           "trial row", missing=(f"trial-{trial_id}-execution-start/{MANIFEST}",))
    coverage = _json(start_files[COVERAGE]) if COVERAGE in start_files else None
    bundle = f"trial-{trial_id}-execution"
    files = _bundle_rows(conn, bundle, clause)
    if files is None or MANIFEST not in files:
        return {"status": "missing", "start": start, "input_coverage": coverage,
                "reason": "the original final capture is missing; later probes cannot replace it"}
    manifest = _json(files.pop(MANIFEST))
    listed = manifest.get("files") if isinstance(manifest, dict) else None
    if (not isinstance(manifest, dict) or manifest.get("format") != CAPTURE_FORMAT
            or not _identity_matches(manifest, trial) or manifest.get("purpose") != start["purpose"]
            or not isinstance(listed, dict) or set(files) - set(listed)):
        raise refuse("EXECUTION_IDENTITY", f"the execution capture of trial {trial_id} differs from the trial row "
                                           "or holds files outside its manifest", missing=(f"{bundle}/{MANIFEST}",))
    captured, statuses = {}, {}
    for path, entry in sorted(listed.items()):
        status = entry.get("status") if isinstance(entry, dict) else None
        if status not in FILE_STATUSES:
            raise refuse("EXECUTION_IDENTITY", f"{bundle}/{path} has an unknown capture status",
                         missing=(f"{bundle}/{path}",))
        data = files.get(path)
        if status == "captured":
            if data is None or len(data) != entry.get("length") or hashlib.sha256(data).hexdigest() != entry.get(
                    "sha256"):
                raise refuse("LEDGER_CORRUPT", f"{bundle}/{path} differs from its manifest entry",
                             missing=(f"{bundle}/{path}",))
            captured[path] = data
        elif data is not None:
            raise refuse("LEDGER_CORRUPT", f"{bundle}/{path} is recorded {status} but holds bytes",
                         missing=(f"{bundle}/{path}",))
        statuses[path] = status
    if CAPTURED_SOURCE in captured and hashlib.sha256(captured[CAPTURED_SOURCE]).hexdigest() != trial["source_sha256"]:
        raise refuse("EXECUTION_IDENTITY", f"the sealed source of trial {trial_id} is not the trial's source",
                     missing=(f"{bundle}/{CAPTURED_SOURCE}",))
    failures = []
    for line in captured.get(RUNTIME_ERRORS, b"").decode("utf-8", errors="replace").splitlines():
        if line.strip():
            parsed = _json(line.encode("utf-8"))
            failures.append(parsed if parsed is not None else {"unparsed": line})
    return {"status": "captured", "purpose": manifest["purpose"], "stages": manifest.get("stages"),
            "outcome": manifest.get("outcome"), "argv": manifest.get("argv"), "files": captured,
            "statuses": statuses, "runtime_failures": failures, "start": start, "input_coverage": coverage}
