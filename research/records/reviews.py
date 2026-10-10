"""Evidence-backed decisions on an immutable import queue.

Prepare freezes a publication payload; apply uses the existing atomic Dolt port.
There is no scheduler, research workflow or mutable queue table.
"""

from __future__ import annotations

import base64
from collections import Counter
import hashlib
import json
from pathlib import Path

from research.records.common import ROOT, RecordError, _is_temporary_path
from research.records.migration import original_bytes
from research.records.store import canonical


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def _refusal(message, code, path, expected, *actions):
    """This validation refused before any write by this operation."""
    return RecordError(message, code=code, path=path, expected=expected,
                       next_actions=actions, write_status="not_written")


def _original_bytes(obj, path):
    try:
        if (not isinstance(obj, dict) or not isinstance(obj.get("body"), dict)
                or not isinstance(obj.get("provenance"), dict)):
            raise ValueError("original evidence body and provenance must be objects")
        return original_bytes(obj)
    except (RecordError, TypeError, ValueError) as exc:
        raise _refusal(str(exc), "REVIEW_ORIGINAL_BYTES_INVALID", path,
                       "retained original bytes matching their recorded SHA-256",
                       "Recover the actual original bytes and verify their hash; do not rewrite the evidence or invent replacement bytes.",
                       "Prepare a new review payload after correcting the evidence reference.") from exc


def item_identity(inventory, index, *, path="$.item_index"):
    queue = inventory["body"]["review_queue"]
    if type(index) is not int or not 0 <= index < len(queue):
        raise _refusal("review item index is outside the fixed inventory", "REVIEW_ITEM_INDEX_INVALID",
                       path, f"integer from 0 through {len(queue) - 1}",
                       "Read the fixed inventory review queue and select its real occurrence index.")
    binding = {"inventory_id": inventory["id"], "inventory_revision": inventory["revision"],
               "item_index": index, "item_sha256": digest(queue[index])}
    return {**binding, "item_key": digest(binding)}


def _ref(obj):
    return {"id": obj["id"], "revision": obj["revision"], "kind": obj["kind"],
            "object_sha256": digest(obj)}


def _check_ref(ref, objects, path="$.evidence_refs"):
    if (not isinstance(ref, dict) or not isinstance(ref.get("id"), str)
            or type(ref.get("revision")) is not int):
        raise _refusal("review fixed proof requires an identity and revision", "REVIEW_FIXED_REF_INVALID",
                       path, "fixed reference with id, revision, kind and object_sha256",
                       "Read the exact evidence object at the fixed source snapshot and prepare the review again; do not guess its identity or hash.")
    obj = objects.get((ref["id"], ref["revision"]))
    if obj is None or _ref(obj) != ref:
        raise _refusal(f"review fixed proof is missing or changed: {ref['id']}@{ref['revision']}",
                       "REVIEW_FIXED_PROOF_MISMATCH", path,
                       f"unchanged object {ref['id']}@{ref['revision']} at the fixed snapshot",
                       "Recover or select the actual fixed evidence revision, then prepare a new payload; do not remove the required proof or invent a replacement ID.")
    return obj


def _edge(kind, source, target, body):
    value = {"kind": kind, "from_id": source["id"], "from_revision": source["revision"],
             "from_kind": source["kind"], "to_id": target["id"], "to_revision": target["revision"],
             "to_kind": target["kind"], "body": body}
    return {"id": "relation:" + digest(value), **value}


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


def _inventory(adapter, identity, revision, source_at):
    if not source_at:
        raise _refusal("an explicit source inventory Dolt commit is required", "REVIEW_SOURCE_SNAPSHOT_REQUIRED",
                       "$.source_snapshot_commit", "explicit Dolt commit containing the original inventory",
                       "Select and read the source inventory at an exact Dolt commit before preparing the review.")
    inventory = adapter.get_object(identity, revision=revision, commit=source_at)
    if inventory is None or inventory["kind"] != "inventory":
        raise _refusal("unknown fixed source inventory", "REVIEW_INVENTORY_MISSING", "$.inventory_id",
                       f"inventory {identity}@{revision} at source_snapshot_commit",
                       "Read the fixed source snapshot and choose its real inventory ID and revision; do not invent an inventory.")
    if not isinstance(inventory["body"].get("review_queue"), list):
        raise _refusal("source inventory has no immutable review queue", "REVIEW_QUEUE_MISSING",
                       "$.inventory.body.review_queue", "original immutable review queue",
                       "Select the original import inventory containing its review queue; preserve the source snapshot.")
    return inventory


def _projection(inventory, objects, relations, *, source_objects=None, source_at=None):
    by_revision = {(obj["id"], obj["revision"]): obj for obj in objects}
    latest = {}
    for obj in objects:
        if obj["kind"] == "review_decision" and (obj["id"] not in latest or
                obj["revision"] > latest[obj["id"]]["revision"]):
            latest[obj["id"]] = obj
    by_edge = {edge["id"]: edge for edge in relations}
    paths = {obj["id"]: f"$.objects[{index}].body" for index, obj in enumerate(objects)}
    items = []
    for index, item in enumerate(inventory["body"]["review_queue"]):
        binding = item_identity(inventory, index)
        decision = latest.get("review:" + binding["item_key"])
        state = "pending"
        if decision:
            body = decision["body"]
            path = paths[decision["id"]]
            if any(body.get(key) != value for key, value in binding.items()):
                raise _refusal("review decision does not bind its original queue occurrence",
                               "REVIEW_OCCURRENCE_MISMATCH", path, binding,
                               "Read the original fixed queue occurrence and prepare the review again; do not reassign a decision to another occurrence.")
            if body.get("item") != item or body.get("decision_sha256") != digest(
                    {key: value for key, value in body.items() if key != "decision_sha256"}):
                raise _refusal("review decision digest or original item mismatch", "REVIEW_DECISION_DIGEST_MISMATCH",
                               path + ".decision_sha256", "unchanged original item and decision digest",
                               "Prepare a new frozen payload from the original inventory and actual review; do not edit or rehash an existing frozen decision by hand.")
            state = body.get("status")
            if state not in ("resolved", "pending", "unavailable"):
                raise _refusal("unknown review decision status", "REVIEW_STATUS_INVALID", path + ".status",
                               "resolved, pending or unavailable",
                               "Use pending while unresolved; close only after the actual review and its evidence are retained.")
            source = _check_ref(body.get("source_ref"), by_revision, path + ".source_ref")
            if source["id"] != item["object_id"] or (source_at and body.get("source_snapshot_commit") != source_at):
                raise _refusal("review source does not bind the original inventory snapshot", "REVIEW_SOURCE_SNAPSHOT_MISMATCH",
                               path + ".source_snapshot_commit", source_at or "original inventory source snapshot",
                               "Prepare the review against the original fixed inventory snapshot; a later source revision cannot replace it.")
            if source_objects is not None:
                _check_ref(body["source_ref"], source_objects, path + ".source_ref")
            proofs = body.get("evidence_refs", [])
            for index, ref in enumerate(proofs):
                _check_ref(ref, by_revision, path + f".evidence_refs[{index}]")
            edge_ids = body.get("edge_ids", [])
            if state != "pending" and (not proofs or not edge_ids):
                raise _refusal("closed review lacks fixed proof and edges", "REVIEW_CLOSURE_EVIDENCE_REQUIRED",
                               path + ".evidence_refs", "fixed evidence references and their declared edge_ids",
                               "Perform and retain the actual review, then prepare its fixed evidence closure. Keep the item pending when evidence is unavailable.")
            selected = []
            for edge_id in edge_ids:
                edge = by_edge.get(edge_id)
                if edge is None or edge["body"].get("review_id") != decision["id"] or \
                        edge["body"].get("review_revision") != decision["revision"] or \
                        edge["body"].get("item_key") != binding["item_key"]:
                    raise _refusal("closed review edge is absent or binds another decision", "REVIEW_EDGE_BINDING_MISMATCH",
                                   path + ".edge_ids", "all declared edges binding this exact decision revision and queue occurrence",
                                   "Prepare a new frozen payload containing the complete declared evidence edges; do not reuse another review's edges.")
                selected.append(edge)
            for ref in proofs:
                if not any(edge["kind"] == "review_evidence" and
                           (edge["from_id"], edge["from_revision"]) == (decision["id"], decision["revision"]) and
                           (edge["to_id"], edge["to_revision"]) == (ref["id"], ref["revision"]) for edge in selected):
                    raise _refusal("review fixed proof lacks its evidence edge", "REVIEW_EVIDENCE_EDGE_MISSING",
                                   path + ".edge_ids", "one fixed review_evidence edge for every declared proof",
                                   "Prepare the payload again with its complete fixed proof closure; do not remove evidence to bypass the missing edge.")
            target = body.get("target_ref")
            proof = body.get("proof", {})
            if state == "resolved" and body.get("method") == "verified_reference":
                if not target or target not in proofs or proof.get("resolution_status") not in ("resolved", "dependency_reference"):
                    raise _refusal("verified resolution requires its fixed target and resolution proof", "REVIEW_TARGET_PROOF_REQUIRED",
                                   path + ".target_ref", "fixed target in evidence_refs and resolved/dependency_reference proof",
                                   "Resolve the original reference against the fixed source snapshot and prepare again; leave unresolved references pending.")
                if proof.get("original_href") != item.get("target"):
                    raise _refusal("resolution proof does not bind the original href", "REVIEW_HREF_MISMATCH",
                                   path + ".proof.original_href", item.get("target"),
                                   "Resolve the original queue reference; do not substitute a different href into a frozen decision.")
            if state != "pending" and body.get("method") == "agent_review":
                files = proof.get("decision_file_refs", [])
                if not files or not proof.get("reviewer") or not proof.get("rationale") or not proof.get("scope"):
                    raise _refusal("Agent closure requires its retained decision file and scoped rationale", "REVIEW_AGENT_PROOF_REQUIRED",
                                   path + ".proof", "retained decision_file_refs plus reviewer, rationale and scope",
                                   "Perform the actual review and retain its original decision file and scoped rationale before closure; reviewer is a declaration, not authenticated proof of an independent Agent.")
                for ref in files:
                    if ref not in proofs:
                        raise _refusal("Agent decision file is not fixed review evidence", "REVIEW_DECISION_FILE_NOT_EVIDENCE",
                                       path + ".proof.decision_file_refs", "decision files included in the fixed evidence_refs",
                                       "Prepare a new payload from the retained original review files; do not add fictional file references.")
                    _original_bytes(_check_ref(ref, by_revision, path + ".proof.decision_file_refs"),
                                    path + ".proof.decision_file_refs")
            if state != "pending" and body.get("method") not in ("agent_review", "verified_reference"):
                raise _refusal("closed review uses an unsupported decision method", "REVIEW_METHOD_INVALID", path + ".method",
                               "agent_review or verified_reference for a closed review",
                               "Prepare the closure through actual Agent review or fixed reference resolution; otherwise keep it pending.")
            if target:
                _check_ref(target, by_revision, path + ".target_ref")
                source = body["source_ref"]
                if not any(edge["kind"] == "references_resolved" and
                           (edge["from_id"], edge["from_revision"]) == (source["id"], source["revision"]) and
                           (edge["to_id"], edge["to_revision"]) == (target["id"], target["revision"]) for edge in selected):
                    raise _refusal("resolved target lacks its fixed resolution edge", "REVIEW_RESOLUTION_EDGE_MISSING",
                                   path + ".edge_ids", "fixed references_resolved edge from source to target",
                                   "Prepare the resolution against the original source snapshot with its complete target evidence and edge.")
            for semantic in body.get("proof", {}).get("semantic_relations", []):
                if not any(edge["kind"] == semantic["kind"] and
                           (edge["from_id"], edge["from_revision"], edge["to_id"], edge["to_revision"]) ==
                           (semantic["from_id"], semantic["from_revision"], semantic["to_id"], semantic["to_revision"]) and
                           edge["body"].get("scope") == semantic["scope"] for edge in selected):
                    raise _refusal("Agent semantic review lacks its fixed scoped edge", "REVIEW_SEMANTIC_EDGE_MISSING",
                                   path + ".proof.semantic_relations", "declared fixed semantic edge with matching scope",
                                   "Review the actual correction, narrowing or refutation and prepare its scoped evidence relation again.")
        items.append({**binding, "reason": item["reason"], "status": state,
                      "decision_revision": decision["revision"] if decision else None})
    return items


def _decision_refs(objects, *, source_only=False):
    for obj in objects:
        if obj["kind"] != "review_decision":
            continue
        body = obj["body"]
        if "source_ref" not in body:
            raise _refusal("review decision has no fixed source reference", "REVIEW_SOURCE_REF_REQUIRED",
                           "$.objects[].body.source_ref", "original source object at a fixed revision",
                           "Prepare the review from its original fixed inventory; do not guess a missing source reference.")
        yield body["source_ref"]
        if not source_only:
            yield from body.get("evidence_refs", [])
            if body.get("target_ref"):
                yield body["target_ref"]


def _load_fixed(adapter, references, commit, objects=None):
    objects = {} if objects is None else objects
    for ref in references:
        if (not isinstance(ref, dict) or not isinstance(ref.get("id"), str)
                or type(ref.get("revision")) is not int):
            raise _refusal("review evidence requires a fixed identity and revision", "REVIEW_FIXED_REF_INVALID",
                           "$.evidence_refs", "reference with a real id and integer revision",
                           "Read the original evidence object at the fixed snapshot and supply its actual identity and revision.")
        key = ref["id"], ref["revision"]
        if key not in objects:
            obj = adapter.get_object(key[0], revision=key[1], commit=commit)
            if obj is not None:
                objects[key] = obj
    return objects


def _review_snapshot(adapter, inventory, commit):
    """Read this inventory's latest decisions and their declared fixed closure."""
    objects = {}
    for index in range(len(inventory["body"]["review_queue"])):
        identity = "review:" + item_identity(inventory, index)["item_key"]
        obj = adapter.get_object(identity, commit=commit)
        if obj is not None:
            objects[obj["id"], obj["revision"]] = obj
    decisions = list(objects.values())
    _load_fixed(adapter, _decision_refs(decisions), commit, objects)
    edge_ids = {edge_id for obj in decisions for edge_id in obj["body"].get("edge_ids", [])}
    return objects, adapter.list_relations(commit=commit, ids=tuple(sorted(edge_ids)))


def status(adapter, identity, revision=1, *, source_at, at=None, include_items=False):
    fixed = at or adapter.status()["commit"]
    inventory = _inventory(adapter, identity, revision, source_at)
    # The requested read snapshot must itself contain the original inventory.
    seen = adapter.get_object(identity, revision=revision, commit=fixed)
    if seen != inventory:
        raise _refusal("review read snapshot does not contain the fixed inventory", "REVIEW_READ_SNAPSHOT_MISMATCH",
                       "$.at", "read snapshot containing the unchanged original inventory",
                       "Select a Dolt commit containing the original inventory revision and read again.")
    objects, relations = _review_snapshot(adapter, inventory, fixed)
    original = _load_fixed(adapter, _decision_refs(objects.values(), source_only=True), source_at)
    items = _projection(inventory, list(objects.values()), relations,
                        source_objects=original, source_at=source_at)
    counts = Counter(item["status"] for item in items)
    output = {"commit": fixed, "source_snapshot_commit": source_at,
              "inventory_id": identity, "inventory_revision": revision, "total": len(items),
              "counts": {name: counts[name] for name in ("resolved", "pending", "unavailable")},
              "by_reason": {reason: dict(Counter(item["status"] for item in items if item["reason"] == reason))
                            for reason in sorted({item["reason"] for item in items})}}
    if include_items:
        output["items"] = items
    return output


def active_resolutions(objects, relations):
    """Only the latest decision's edges are active; older edges remain history."""
    latest = {}
    for obj in objects:
        if obj["kind"] == "review_decision" and (obj["id"] not in latest or
                latest[obj["id"]]["revision"] < obj["revision"]):
            latest[obj["id"]] = obj
    by_revision = {(obj["id"], obj["revision"]): obj for obj in objects}
    inventories = {(obj["body"]["inventory_id"], obj["body"]["inventory_revision"]) for obj in latest.values()}
    for key in inventories:
        inventory = by_revision.get(key)
        if inventory is None:
            raise _refusal("active review has no fixed source inventory", "REVIEW_INVENTORY_MISSING",
                           "$.objects[].body.inventory_id", "fixed source inventory for every active review",
                           "Recover the original inventory at its fixed revision before relying on the review's resolution.")
        _projection(inventory, objects, relations)
    return [edge for edge in relations if edge["kind"] == "references_resolved" and
            (decision := latest.get(edge["body"].get("review_id"))) and
            decision["body"].get("status") == "resolved" and
            decision["revision"] == edge["body"].get("review_revision") and
            edge["id"] in decision["body"].get("edge_ids", [])]


def prepare(adapter, identity, revision=1, *, source_at, decisions=None, supplemental=(), root=ROOT):
    from research.records.references import resolve_link

    current = adapter.status()
    if current["dirty"]:
        raise _refusal("review preparation requires a clean published Dolt working set", "REVIEW_WORKING_SET_DIRTY",
                       "$.base_commit", "clean committed Dolt working set",
                       "Inspect the unpublished working changes and resolve their owner before preparing a review; do not discard them or publish unrelated changes automatically.")
    if (decisions is not None and (not isinstance(decisions, dict)
            or not isinstance(decisions.get("decisions", []), list)
            or any(not isinstance(spec, dict) for spec in decisions.get("decisions", [])))):
        raise _refusal("manual review decisions must be an object containing decision objects",
                       "REVIEW_DECISIONS_INVALID", "$.decisions", "array of manual decision objects",
                       "Supply the actual scoped review decisions for the selected inventory occurrences.")
    inventory = _inventory(adapter, identity, revision, source_at)
    original_map = {}
    source_latest = {}
    for item in inventory["body"]["review_queue"]:
        source_id = item["object_id"]
        if source_id not in source_latest:
            obj = adapter.get_object(source_id, commit=source_at)
            if obj is not None:
                source_latest[source_id] = obj
                original_map[obj["id"], obj["revision"]] = obj
    manual_refs = [ref for spec in (decisions or {}).get("decisions", [])
                   for ref in [*spec.get("object_refs", []),
                               *(asset["receipt_ref"] for asset in spec.get("source_assets", []))]]
    _load_fixed(adapter, manual_refs, source_at, original_map)
    existing_by_revision, existing_edges = _review_snapshot(adapter, inventory, current["commit"])
    existing_edge_map = {edge["id"]: edge for edge in existing_edges}
    latest = {}
    for obj in existing_by_revision.values():
        if obj["kind"] == "review_decision" and (obj["id"] not in latest or
                obj["revision"] > latest[obj["id"]]["revision"]):
            latest[obj["id"]] = obj
    batch = {}
    relations = []

    def existing_object(identity, revision=None):
        if revision is None:
            if identity not in latest:
                latest[identity] = adapter.get_object(identity, commit=current["commit"])
            obj = latest[identity]
            if obj is not None:
                existing_by_revision[obj["id"], obj["revision"]] = obj
            return obj
        _load_fixed(adapter, ({"id": identity, "revision": revision},),
                    current["commit"], existing_by_revision)
        return existing_by_revision.get((identity, revision))

    def original_for_path(path):
        selected = adapter.list_objects(commit=source_at, latest=False, paths=(path,))
        original_map.update({(obj["id"], obj["revision"]): obj for obj in selected})
        return selected

    def add(value):
        value = json.loads(canonical(value))
        previous = existing_object(value["id"])
        if value["kind"] in ("attempt", "run") or value["id"].startswith(("attempt:", "run:")):
            retained = existing_object(value["id"], value["revision"]) if "revision" in value else previous
            if retained is None or canonical(retained) != canonical(dict(value, revision=retained["revision"])):
                raise _refusal("review evidence cannot create research metadata or write reserved record identities",
                               "REVIEW_RESERVED_IDENTITY", "$.objects[].id", "existing immutable research record when used as evidence",
                               "Reference the existing record at its fixed revision; publish new attempt or run metadata through its dedicated contract.")
            # A fixed existing record can be read as proof. It is already in
            # the snapshot and never becomes part of the review write batch.
            return retained
        if previous and previous["kind"] == value["kind"] and previous["body"] == value["body"] and previous["provenance"] == value["provenance"]:
            value = previous
        elif "revision" not in value:
            value["revision"] = previous["revision"] + 1 if previous else 1
        key = (value["id"], value["revision"])
        if key in batch and batch[key] != value:
            raise _refusal("conflicting fixed review evidence", "REVIEW_EVIDENCE_REVISION_CONFLICT",
                           "$.objects[].revision", "one unchanged object per identity and revision",
                           "Preserve the existing revision; explicitly retain changed evidence as a new revision and prepare again.")
        batch[key] = value
        return value

    for index, obj in enumerate(supplemental):
        _original_bytes(obj, f"$.supplemental[{index}].body")
        add(obj)
    manual = {}
    manual_paths = {}
    for position, spec in enumerate((decisions or {}).get("decisions", [])):
        index = spec.get("item_index")
        original_binding = item_identity(inventory, index, path=f"$.decisions[{position}].item_index")
        if index in manual or spec.get("item_sha256") != original_binding["item_sha256"]:
            raise _refusal("duplicate or mismatched manual review occurrence", "REVIEW_OCCURRENCE_MISMATCH",
                           f"$.decisions[{position}].item_sha256", "one decision per original item index with its exact item_sha256",
                           "Read the original fixed queue occurrence and use its actual index and digest; do not transplant another occurrence's decision.")
        manual[index] = spec
        manual_paths[index] = f"$.decisions[{position}]"
    for index, item in enumerate(inventory["body"]["review_queue"]):
        binding = item_identity(inventory, index)
        source = source_latest.get(item["object_id"])
        if source is None:
            raise _refusal("original queue source is not present at the fixed snapshot", "REVIEW_SOURCE_MISSING",
                           f"$.inventory.body.review_queue[{index}].object_id", item["object_id"],
                           "Recover the actual source object in the original inventory snapshot before reviewing; keep unresolved evidence pending.")
        evidence = [source]
        target = None
        semantic = []
        method, state, proof = "unreviewed", "pending", {}
        spec = manual.get(index)
        if spec:
            spec_path = manual_paths[index]
            for field in ("reviewer", "rationale", "scope"):
                if not spec.get(field):
                    raise _refusal("Agent review requires reviewer, rationale and explicit scope", "REVIEW_DECLARATION_REQUIRED",
                                   spec_path + "." + field, f"actual review {field}",
                                   "Perform the actual review and record who reviewed, the reason and the precise scope; do not invent an independent Agent ID. Reviewer is a declaration, not authentication.")
            method, state = "agent_review", spec.get("status")
            if state not in ("resolved", "pending", "unavailable"):
                raise _refusal("unknown review decision status", "REVIEW_STATUS_INVALID", spec_path + ".status",
                               "resolved, pending or unavailable",
                               "Keep unresolved evidence pending; close only after an actual review and its retained original.")
            proof = {key: spec[key] for key in ("reviewer", "rationale", "scope")}
            for ref_index, ref in enumerate(spec.get("object_refs", [])):
                obj = original_map.get((ref["id"], ref["revision"]))
                if obj is None or hashlib.sha256(_original_bytes(obj, spec_path + f".object_refs[{ref_index}]")).hexdigest() != ref.get("sha256"):
                    raise _refusal("manual review's original evidence revision or hash mismatch", "REVIEW_ORIGINAL_REF_MISMATCH",
                                   spec_path + f".object_refs[{ref_index}]", "existing original evidence revision with its verified SHA-256",
                                   "Read the actual original evidence at source_snapshot_commit and verify its bytes; do not replace the source revision or merely edit the hash.")
                evidence.append(obj)
            files = spec.get("files", [])
            if state != "pending" and not files:
                raise _refusal("Agent closure requires its retained original decision file", "REVIEW_DECISION_FILE_REQUIRED",
                               spec_path + ".files", "retained original review decision file with path and SHA-256",
                               "Perform the actual review and retain its original decision file outside Git and temporary directories before closure; use pending until it exists.")
            retained_files = [add(retain_file(file["path"], file["sha256"], source_path=file.get("source_path"),
                                            field_path=spec_path + f".files[{file_index}]"))
                              for file_index, file in enumerate(files)]
            evidence.extend(retained_files)
            proof["decision_file_refs"] = [_ref(obj) for obj in retained_files]
            for asset_index, asset in enumerate(spec.get("source_assets", [])):
                receipt_ref = asset["receipt_ref"]
                receipt = original_map.get((receipt_ref["id"], receipt_ref["revision"]))
                if receipt is None or asset["sha256"] not in receipt["body"].get("evidence", {}).values():
                    raise _refusal("review source asset is not bound by the original receipt", "REVIEW_SOURCE_ASSET_MISMATCH",
                                   spec_path + f".source_assets[{asset_index}].receipt_ref", "asset hash bound by the original fixed receipt",
                                   "Select the actual original receipt and its frozen asset bytes; do not invent a receipt or substitute newly generated evidence.")
                evidence.append(receipt)
                evidence.append(add(retain_file(asset["path"], asset["sha256"], source_path=asset["source_path"],
                                               field_path=spec_path + f".source_assets[{asset_index}]")))
            asset_groups = {}
            for asset in spec.get("source_assets", []):
                ref = asset["receipt_ref"]
                asset_groups.setdefault((ref["id"], ref["revision"]), set()).add(asset["sha256"])
            for key, hashes in asset_groups.items():
                if hashes != set(original_map[key]["body"]["evidence"].values()):
                    raise _refusal("Agent source review must retain the complete frozen evidence set", "REVIEW_SOURCE_ASSET_SET_INCOMPLETE",
                                   spec_path + ".source_assets", sorted(original_map[key]["body"]["evidence"].values()),
                                   "Recover and retain every asset in the original receipt's frozen evidence set before closing this source review; keep it pending when any original is unavailable.")
            semantic = spec.get("semantic_relations", [])
            proof["semantic_relations"] = semantic
            proof["source_asset_count"] = len(spec.get("source_assets", []))
        elif item["reason"] in ("unresolved_local_link", "unsafe_local_link"):
            resolution = resolve_link(item["target"], source["provenance"]["path"], source["provenance"],
                                      original_for_path, root=root, repository_root=root,
                                      git_commit=inventory["body"]["source_head"], supplemental_objects=supplemental)
            proof = resolution["proof"]
            proof["resolution_status"] = resolution["status"]
            method = "verified_reference"
            if resolution["status"] in ("resolved", "dependency_reference"):
                state = "resolved"
                target = add(resolution["target_object"])
                evidence.append(target)
            else:
                proof["reason"] = resolution.get("reason")
        body = {**binding, "source_snapshot_commit": source_at, "item": item, "status": state,
                "method": method, "source_ref": _ref(source), "proof": proof,
                "evidence_refs": sorted({_ref(obj)["id"] + "@" + str(obj["revision"]): _ref(obj) for obj in evidence}.values(),
                                        key=lambda value: (value["id"], value["revision"]))}
        if target:
            body["target_ref"] = _ref(target)
        review_id = "review:" + binding["item_key"]
        previous = latest.get(review_id)
        # Edge IDs depend on the decision revision, while semantic equality does not.
        semantic_body = {key: value for key, value in body.items() if key not in ("edge_ids", "decision_sha256")}
        if previous and {key: value for key, value in previous["body"].items() if key not in ("edge_ids", "decision_sha256")} == semantic_body:
            add(previous)
            relations.extend(existing_edge_map[edge_id] for edge_id in previous["body"]["edge_ids"])
            continue
        review = {"id": review_id, "kind": "review_decision", "revision": previous["revision"] + 1 if previous else 1,
                  "body": body, "provenance": {"origin": "inventory_review", "source_snapshot_commit": source_at}}
        binding_edge = {"review_id": review_id, "review_revision": review["revision"], "item_key": binding["item_key"]}
        edges = [_edge("review_evidence", review, obj, binding_edge) for obj in
                 {(obj["id"], obj["revision"]): obj for obj in evidence}.values()]
        if target:
            edges.append(_edge("references_resolved", source, target,
                               {**binding_edge, "original_href": item["target"], "proof": proof}))
        for relation in semantic:
            if relation["kind"] not in ("corrects", "narrows", "refutes") or not relation.get("scope"):
                raise _refusal("unsupported or unscoped Agent semantic relation", "REVIEW_SEMANTIC_SCOPE_INVALID",
                               manual_paths[index] + ".semantic_relations", "corrects, narrows or refutes with explicit reviewed scope",
                               "Review the actual downstream meaning and state its precise scope; omit unverified semantic claims and keep the review pending when needed.")
            from_obj = original_map.get((relation["from_id"], relation["from_revision"]))
            to_obj = original_map.get((relation["to_id"], relation["to_revision"]))
            if not from_obj or not to_obj or _ref(from_obj) not in body["evidence_refs"] or _ref(to_obj) not in body["evidence_refs"]:
                raise _refusal("semantic endpoints must be fixed reviewed evidence", "REVIEW_SEMANTIC_ENDPOINT_MISMATCH",
                               manual_paths[index] + ".semantic_relations", "both endpoints present as fixed original reviewed evidence",
                               "Read and actually review both original endpoint revisions, include their verified object_refs, then prepare again.")
            edges.append(_edge(relation["kind"], from_obj, to_obj,
                               {**binding_edge, "scope": relation["scope"], "retrospective": True}))
        body["edge_ids"] = sorted(edge["id"] for edge in edges)
        body["decision_sha256"] = digest(body)
        add(review)
        relations.extend(edges)
    _load_fixed(adapter, _decision_refs(batch.values()), current["commit"], existing_by_revision)
    all_objects = dict(existing_by_revision)
    all_objects.update(batch)
    projected = _projection(inventory, list(all_objects.values()), relations + existing_edges,
                            source_objects=original_map, source_at=source_at)
    payload = {"schema_version": 1, "inventory_id": identity, "inventory_revision": revision,
               "source_snapshot_commit": source_at, "expected_version": current["version"],
               "base_commit": current["commit"], "objects": sorted(batch.values(), key=lambda obj: (obj["id"], obj["revision"])),
               "relations": sorted({edge["id"]: edge for edge in relations}.values(), key=lambda edge: edge["id"]),
               "counts": dict(Counter(item["status"] for item in projected))}
    payload["operation_id"] = "review:" + digest({key: payload[key] for key in ("objects", "relations")})
    payload["payload_sha256"] = digest(payload)
    return payload


def apply(adapter, payload):
    if not isinstance(payload, dict):
        raise _refusal("frozen review publication payload must be an object", "REVIEW_PAYLOAD_INVALID", "$",
                       "frozen JSON object returned by review prepare",
                       "Use the intact payload returned by review prepare; do not construct a replacement manually.")
    if type(payload.get("schema_version")) is not int or payload["schema_version"] != 1:
        raise _refusal("unsupported frozen review publication payload version", "REVIEW_PAYLOAD_VERSION_UNSUPPORTED",
                       "$.schema_version", 1,
                       "Use a consumer supporting the actual frozen review payload version; prepare a compatible payload from the real review rather than changing only its version number.")
    if payload.get("payload_sha256") != digest(
            {key: value for key, value in payload.items() if key != "payload_sha256"}):
        raise _refusal("frozen review publication payload digest mismatch", "REVIEW_PAYLOAD_DIGEST_MISMATCH",
                       "$.payload_sha256", "unchanged schema version 1 payload returned by review prepare",
                       "Restore the intact prepared payload or prepare a new one from the actual review; do not manually edit and rehash a frozen publication.")
    for field in ("inventory_id", "inventory_revision", "source_snapshot_commit", "base_commit",
                  "objects", "relations", "operation_id", "expected_version"):
        if field not in payload:
            raise _refusal(f"frozen review publication payload missing {field}", "REVIEW_PAYLOAD_FIELD_REQUIRED",
                           "$." + field, "field preserved from review prepare",
                           "Restore the intact prepared payload or prepare again; do not guess the missing publication binding.")
    inventory = _inventory(adapter, payload["inventory_id"], payload["inventory_revision"], payload["source_snapshot_commit"])
    combined, existing_relations = _review_snapshot(adapter, inventory, payload["base_commit"])
    _load_fixed(adapter, payload["objects"], payload["base_commit"], combined)
    expected_reviews = {"review:" + item_identity(inventory, index)["item_key"]
                        for index in range(len(inventory["body"]["review_queue"]))}
    if {obj["id"] for obj in payload["objects"] if obj["kind"] == "review_decision"} != expected_reviews:
        raise _refusal("review payload must bind exactly the original queue occurrences", "REVIEW_QUEUE_COVERAGE_MISMATCH",
                       "$.objects", sorted(expected_reviews),
                       "Prepare the complete original inventory queue; do not omit or inject queue occurrences into the frozen payload.")
    for index, obj in enumerate(payload["objects"]):
        path = f"$.objects[{index}]"
        key = (obj["id"], obj["revision"])
        if obj["kind"] in ("attempt", "run") or obj["id"].startswith(("attempt:", "run:")):
            retained = combined.get(key)
            if retained is None or canonical(retained) != canonical(obj):
                raise _refusal("review publication cannot create research metadata or write reserved record identities",
                               "REVIEW_RESERVED_IDENTITY", path + ".id", "existing immutable research record when used as evidence",
                               "Reference an existing fixed record; publish new attempt or run metadata through its dedicated contract.")
        if key in combined and combined[key] != obj:
            raise _refusal("review payload tries to change an immutable revision", "REVIEW_IMMUTABLE_REVISION_CONFLICT",
                           path + ".revision", "existing immutable object bytes at this revision",
                           "Preserve the existing revision. Retain changed evidence or a changed review as a new revision through prepare.")
        if key not in combined and obj["kind"] not in ("review_decision", "reference", "material", "evidence_json"):
            raise _refusal("review publication cannot create research metadata or inventories", "REVIEW_OBJECT_KIND_FORBIDDEN",
                           path + ".kind", "review_decision, reference, material or evidence_json",
                           "Use the dedicated import or research publication contract for other object kinds.")
        combined[key] = obj
        if obj["kind"] == "material":
            _original_bytes(obj, path + ".body")
    _load_fixed(adapter, list(_decision_refs(combined.values())), payload["base_commit"], combined)
    requested_ids = {edge["id"] for edge in payload["relations"]}
    requested_ids.difference_update(edge["id"] for edge in existing_relations)
    existing_relations.extend(adapter.list_relations(commit=payload["base_commit"], ids=tuple(sorted(requested_ids))))
    existing_by_id = {edge["id"]: edge for edge in existing_relations}
    decisions = {obj["id"]: obj for obj in payload["objects"] if obj["kind"] == "review_decision"}
    allowed = {"review_evidence", "references_resolved", "corrects", "narrows", "refutes"}
    for index, edge in enumerate(payload["relations"]):
        path = f"$.relations[{index}]"
        retained = existing_by_id.get(edge["id"])
        if retained is not None:
            if canonical(retained) != canonical(edge):
                raise _refusal("review payload tries to change an immutable relation", "REVIEW_IMMUTABLE_RELATION_CONFLICT",
                               path, "unchanged existing relation at this identity",
                               "Preserve the existing relation and prepare the corrected review as a new decision revision.")
            continue
        if edge["kind"] not in allowed:
            raise _refusal("review publication cannot create research record relations", "REVIEW_RELATION_KIND_FORBIDDEN",
                           path + ".kind", sorted(allowed),
                           "Publish research record relations through their dedicated contract; keep this payload limited to its actual review evidence.")
        decision = decisions.get(edge["body"].get("review_id"))
        if (decision is None or edge["body"].get("review_revision") != decision["revision"]
                or edge["body"].get("item_key") != decision["body"]["item_key"]
                or edge["id"] not in decision["body"]["edge_ids"]):
            raise _refusal("new review relation must bind its corresponding queue decision", "REVIEW_EDGE_BINDING_MISMATCH",
                           path + ".body", "declared edge binding the exact queue decision revision and item_key",
                           "Prepare the complete frozen review again; do not inject another decision's relation or add edges by hand.")
    relations = payload["relations"] + existing_relations
    original = _load_fixed(adapter, _decision_refs(combined.values(), source_only=True),
                           payload["source_snapshot_commit"])
    _projection(inventory, list(combined.values()), relations, source_objects=original,
                source_at=payload["source_snapshot_commit"])
    declared_edges = {}
    for decision in decisions.values():
        body = decision["body"]
        binding = {"review_id": decision["id"], "review_revision": decision["revision"],
                   "item_key": body["item_key"]}
        evidence = [_check_ref(ref, combined) for ref in body["evidence_refs"]]
        edges = [_edge("review_evidence", decision, obj, binding) for obj in evidence]
        if body.get("target_ref"):
            edges.append(_edge("references_resolved", _check_ref(body["source_ref"], combined),
                               _check_ref(body["target_ref"], combined),
                               {**binding, "original_href": body["item"]["target"], "proof": body["proof"]}))
        for semantic in body.get("proof", {}).get("semantic_relations", []):
            if semantic["kind"] not in ("corrects", "narrows", "refutes") or not semantic.get("scope"):
                raise _refusal("unsupported or unscoped Agent semantic relation", "REVIEW_SEMANTIC_SCOPE_INVALID",
                               "$.objects[].body.proof.semantic_relations", "corrects, narrows or refutes with explicit reviewed scope",
                               "Review the actual semantic claim and its precise scope, then prepare a new payload; do not relabel an unsupported relation.")
            source = combined.get((semantic["from_id"], semantic["from_revision"]))
            target = combined.get((semantic["to_id"], semantic["to_revision"]))
            if not source or not target or _ref(source) not in body["evidence_refs"] or _ref(target) not in body["evidence_refs"]:
                raise _refusal("semantic endpoints must be fixed reviewed evidence", "REVIEW_SEMANTIC_ENDPOINT_MISMATCH",
                               "$.objects[].body.proof.semantic_relations", "both endpoints included as fixed reviewed evidence",
                               "Read and actually review both endpoint revisions at the original snapshot, then prepare their fixed evidence closure.")
            edges.append(_edge(semantic["kind"], source, target,
                               {**binding, "scope": semantic["scope"], "retrospective": True}))
        declared_edges.update({edge["id"]: edge for edge in edges})
    for index, edge in enumerate(payload["relations"]):
        if edge["id"] not in existing_by_id and canonical(edge) != canonical(declared_edges.get(edge["id"])):
            raise _refusal("new review relation differs from the declared decision and fixed evidence", "REVIEW_RELATION_CONTENT_MISMATCH",
                           f"$.relations[{index}]", "relation derived from the declared decision and fixed evidence",
                           "Prepare the intact review payload again; do not edit relation content independently of its reviewed decision.")
    result = adapter.publish(payload["objects"], payload["relations"], payload["operation_id"], payload["expected_version"],
                             message=f"Review immutable inventory {payload['inventory_id']}@{payload['inventory_revision']}")
    try:
        projection = status(adapter, payload["inventory_id"], payload["inventory_revision"],
                            source_at=payload["source_snapshot_commit"], at=result["commit"])
    except RecordError as exc:
        # The publication receipt is confirmed; only the follow-up read failed.
        exc.write_status = "already_committed"
        exc.next_actions = [f"Read operation {payload['operation_id']} and commit {result['commit']} before any retry; do not create a new operation to compensate for this follow-up read failure.",
                            *exc.next_actions]
        raise
    return {**result, "review": projection}
