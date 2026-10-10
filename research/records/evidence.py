"""Custody of decision evidence originals as content-addressed material objects."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

from research.records.common import ROOT, RecordError, _is_temporary_path
from research.records.dolt_store import ConflictError


def _refusal(message, code, path, expected, *actions):
    """This validation refused before any write by this operation."""
    return RecordError(message, code=code, path=path, expected=expected,
                       next_actions=actions, write_status="not_written")


def original_bytes(obj):
    body, provenance = obj["body"], obj["provenance"]
    encoded = body.get("content_base64")
    expected = body.get("sha256") if encoded is not None else provenance.get("blob_sha256")
    if encoded is None:
        encoded = provenance.get("raw_content_base64")
    if encoded is None:
        raise RecordError(f"object has no original byte payload: {obj['id']}")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise RecordError("invalid byte payload") from exc
    if hashlib.sha256(raw).hexdigest() != expected:
        raise RecordError(f"original byte hash mismatch: {obj['id']}")
    return raw


def retain_file(path, expected_sha256, *, source_path=None, origin="agent_review_evidence", field_path="$.files[]"):
    """Read only an explicitly supplied, already retained local evidence file."""
    path = Path(path).expanduser().resolve()
    if path.is_relative_to(ROOT.resolve()) or _is_temporary_path(path):
        raise _refusal("review evidence must first be retained outside Git and /tmp or the system temp directory",
                       "REVIEW_EVIDENCE_NOT_RETAINED", field_path + ".path",
                       "an existing original file retained outside Git and temporary directories",
                       "Retain the actual review original in a durable local directory, then use its path and verified SHA-256.")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise _refusal(f"cannot read retained review evidence: {path}", "REVIEW_EVIDENCE_UNREADABLE",
                       field_path + ".path", "readable retained original file",
                       "Recover the actual retained original and verify access; do not substitute a fabricated decision file.") from exc
    sha = hashlib.sha256(raw).hexdigest()
    if sha != expected_sha256:
        raise _refusal(f"review evidence hash mismatch: {path}", "REVIEW_EVIDENCE_HASH_MISMATCH",
                       field_path + ".sha256", sha,
                       "Check whether the selected file is the original reviewed evidence. Restore that original or explicitly review the changed bytes and prepare a new payload; do not change only the declared hash to pass validation.")
    return {"id": "review_evidence:" + sha, "kind": "material", "revision": 1,
            "body": {"format": "original_bytes", "sha256": sha, "byte_length": len(raw),
                     "content_base64": base64.b64encode(raw).decode()},
            "provenance": {"origin": origin, "path": source_path or str(path),
                           "retained_path": str(path), "blob_sha256": sha,
                           "custody": "observed_after_source_snapshot"}}


def retain(adapter, files, *, operation_id, expected_version, origin="agent_review_evidence", dry_run=False):
    """Publish retained originals as review_evidence materials in one operation.

    ``files`` holds (path, expected SHA-256) pairs. The ID is the content hash:
    bytes already in the ledger are cited through their stored object, whatever
    path or origin first retained them, and a retry with the same operation ID
    recovers the original commit.
    """
    if not files:
        raise _refusal("no evidence file was given", "REVIEW_EVIDENCE_MISSING", "/files",
                       "at least one --file PATH SHA256", "Name each retained original and its SHA-256.")
    built = {}
    for index, (path, sha256) in enumerate(files):
        obj = retain_file(path, sha256, origin=origin, field_path=f"/files/{index}")
        built.setdefault(obj["id"], obj)
    status = adapter.status()
    if status["dirty"]:
        raise _refusal("Dolt working set has unpublished SQL changes; resolve before publication",
                       "DIRTY_WORKING_SET", "/expected_version", "a clean working set at the last published commit",
                       "Inspect `dolt_status` and the uncommitted rows; do not publish them under this operation's receipt.")
    objects, evidence = [], []
    for identity, obj in built.items():
        stored = adapter.get_object(identity, revision=1, commit=status["commit"])
        if stored is not None and hashlib.sha256(original_bytes(stored)).hexdigest() != obj["body"]["sha256"]:
            raise RecordError(f"stored evidence bytes differ from their content ID: {identity}")
        objects.append(stored or obj)
        evidence.append({"id": identity, "revision": 1, "sha256": obj["body"]["sha256"],
                         "byte_length": obj["body"]["byte_length"], "already_published": stored is not None})
    if dry_run:
        if status["version"] != expected_version:
            try:
                receipt = adapter.operation_receipt(operation_id)
            except RecordError:
                raise ConflictError(
                    f"expected-version conflict: expected {expected_version}, observed {status['version']}",
                    code="EXPECTED_VERSION_CONFLICT", path="/expected_version", expected=status["version"],
                    next_actions=["Read the current ledger status, then retry with the observed version."],
                    write_status="not_written") from None
            return {"dry_run": True, "write_status": "already_committed", **receipt, "evidence": evidence}
        return {"dry_run": True, "write_status": "not_written", "operation_id": operation_id,
                "expected_version": expected_version, "evidence": evidence}
    result = adapter.publish(objects, [], operation_id, expected_version, "retain review evidence",
                             validated_by="material_retain")
    return {**result, "evidence": evidence}
