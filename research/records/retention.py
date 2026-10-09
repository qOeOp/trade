"""Explicit Agent admission of compact knowledge; storage remains with Dolt.

An import or reference review never constitutes knowledge admission. The Agent
owns the value judgement; this boundary verifies its fixed evidence and recipe.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from research.records.common import ROOT, RecordError
from research.records.store import canonical
from research.records.dolt_store import ConflictError


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise RecordError(f"retention {field} must explain the Agent's judgement")


def _external_ref(ref, field):
    if not isinstance(ref, dict) or set(ref) != {"path", "sha256"}:
        raise RecordError(f"retention {field} requires path and sha256")
    if not isinstance(ref["path"], str) or not isinstance(ref["sha256"], str):
        raise RecordError(f"retention {field} requires string path and sha256")
    path = Path(ref["path"]).expanduser()
    if not path.is_absolute() or path.is_symlink():
        raise RecordError(f"retention {field} must be an absolute external file")
    resolved = path.resolve()
    if resolved.is_relative_to(ROOT.resolve()) or resolved.is_relative_to(Path("/tmp").resolve()):
        raise RecordError(f"retention {field} must be outside Git and /tmp")
    if not resolved.is_file() or hashlib.sha256(resolved.read_bytes()).hexdigest() != ref["sha256"]:
        raise RecordError(f"retention {field} is unavailable or has a hash mismatch")


def publish(adapter, body, *, operation_id, expected_version):
    allowed = {"schema_version", "target", "disposition", "reviewer", "purpose",
               "value_basis", "claim", "evidence", "retention"}
    if not isinstance(body, dict) or set(body) != allowed or type(body["schema_version"]) is not int or body["schema_version"] != 1:
        raise RecordError("retention decision requires the v1 admission contract")
    if body["disposition"] not in ("knowledge", "archive"):
        raise RecordError("retention disposition must be knowledge or archive")
    for field in ("reviewer", "purpose", "value_basis"):
        _text(body[field], field)
    claim = body["claim"]
    if not isinstance(claim, dict) or set(claim) != {"statement", "scope", "decision_impact", "limitations"}:
        raise RecordError("retention claim requires statement, scope, decision_impact and limitations")
    for field, value in claim.items():
        _text(value, "claim." + field)
    if len(canonical(claim).encode()) > 8192:
        raise RecordError("knowledge claim must be compact; cite detailed evidence instead")
    retention = body["retention"]
    if not isinstance(retention, dict) or not {"mode", "reason"} <= set(retention):
        raise RecordError("retention requires an explicit mode and reason")
    if set(retention) - {"mode", "reason", "recipe_ref", "verification_ref"}:
        raise RecordError("unknown retention field")
    if retention["mode"] not in ("minimal_record", "irreplaceable", "rebuildable"):
        raise RecordError("unknown retention mode")
    _text(retention["reason"], "reason")
    if retention["mode"] != "rebuildable" and ("recipe_ref" in retention or "verification_ref" in retention):
        raise RecordError("reconstruction references require rebuildable mode")
    if not isinstance(operation_id, str) or not operation_id or len(operation_id) > 160:
        raise RecordError("retention operation_id must be nonempty and at most 160 characters")
    status = adapter.status()
    if status["dirty"]:
        raise RecordError("retention publication requires a clean Dolt working set")
    context_id = "publication:" + hashlib.sha256(operation_id.encode()).hexdigest()
    context = adapter.get_object(context_id, commit=status["commit"])
    fixed = context["body"]["base_commit"] if context else status["commit"]
    if context is None and retention["mode"] == "rebuildable":
        for field in ("recipe_ref", "verification_ref"):
            _external_ref(retention.get(field), field)

    def endpoint(ref):
        if not isinstance(ref, dict) or set(ref) != {"id", "revision"} or not isinstance(ref["id"], str) or type(ref["revision"]) is not int or ref["revision"] < 1:
            raise RecordError("retention evidence requires a fixed id and positive revision")
        obj = adapter.get_object(ref["id"], revision=ref["revision"], commit=fixed)
        if obj is None:
            raise RecordError(f"retention endpoint unavailable: {ref}")
        return obj

    target = endpoint(body["target"])
    if body["disposition"] == "knowledge":
        if target["kind"] not in ("attempt", "material_section", "component"):
            raise RecordError("raw payloads and operational receipts cannot be admitted as knowledge")
        if target["kind"] == "attempt" and target["body"].get("decision", {}).get("outcome") == "pending":
            raise RecordError("a pending attempt cannot be admitted as learned knowledge")
        current = adapter.get_object(target["id"], commit=fixed)
        if current["revision"] != target["revision"]:
            raise RecordError("knowledge admission must review the current target revision")
    if not isinstance(body["evidence"], list) or not body["evidence"]:
        raise RecordError("retention admission requires fixed supporting evidence")
    evidence = [endpoint(ref) for ref in body["evidence"]]
    identity = "retention:" + hashlib.sha256(canonical(body["target"]).encode()).hexdigest()
    previous = adapter.get_object(identity, commit=fixed)
    if context:
        obj = adapter.get_object(identity, revision=context["body"]["record_revision"], commit=status["commit"])
        if context["body"]["record_id"] != identity or obj is None or canonical(obj["body"]) != canonical(body):
            raise ConflictError("retention operation-content conflict")
    elif previous and canonical(previous["body"]) == canonical(body):
        obj = previous
    else:
        obj = {"id": identity, "kind": "retention_decision",
               "revision": 1 if previous is None else previous["revision"] + 1,
               "body": body, "provenance": {"origin": "agent_retention_review"}}
    if context is None:
        context = {"id": context_id, "kind": "publication", "revision": 1,
                   "body": {"record_id": identity, "record_revision": obj["revision"], "base_commit": fixed},
                   "provenance": {"origin": "retention_publication", "operation_id": operation_id}}
    relations = []
    for kind, selected in [("retention_of", target), *[("admission_evidence", item) for item in evidence]]:
        edge = {"kind": kind, "from_id": obj["id"], "from_revision": obj["revision"],
                "from_kind": obj["kind"], "to_id": selected["id"],
                "to_revision": selected["revision"], "to_kind": selected["kind"], "body": {}}
        edge["id"] = "edge:" + hashlib.sha256(canonical(edge).encode()).hexdigest()
        relations.append(edge)
    return adapter.publish([obj, context], relations, operation_id, expected_version,
                           "review research knowledge retention")
