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

from research.records.common import ROOT, RecordError
from research.records.migration import original_bytes
from research.records.store import canonical


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def item_identity(inventory, index):
    queue = inventory["body"]["review_queue"]
    if type(index) is not int or not 0 <= index < len(queue):
        raise RecordError("review item index is outside the fixed inventory")
    binding = {"inventory_id": inventory["id"], "inventory_revision": inventory["revision"],
               "item_index": index, "item_sha256": digest(queue[index])}
    return {**binding, "item_key": digest(binding)}


def _ref(obj):
    return {"id": obj["id"], "revision": obj["revision"], "kind": obj["kind"],
            "object_sha256": digest(obj)}


def _check_ref(ref, objects):
    obj = objects.get((ref["id"], ref["revision"]))
    if obj is None or _ref(obj) != ref:
        raise RecordError(f"review fixed proof is missing or changed: {ref['id']}@{ref['revision']}")
    return obj


def _edge(kind, source, target, body):
    value = {"kind": kind, "from_id": source["id"], "from_revision": source["revision"],
             "from_kind": source["kind"], "to_id": target["id"], "to_revision": target["revision"],
             "to_kind": target["kind"], "body": body}
    return {"id": "relation:" + digest(value), **value}


def retain_file(path, expected_sha256, *, source_path=None, origin="agent_review_evidence"):
    """Read only an explicitly supplied, already retained local evidence file."""
    path = Path(path).expanduser().resolve()
    if path.is_relative_to(ROOT) or path.is_relative_to(Path("/tmp").resolve()):
        raise RecordError("review evidence must first be retained outside Git and /tmp")
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    if sha != expected_sha256:
        raise RecordError(f"review evidence hash mismatch: {path}")
    return {"id": "review_evidence:" + sha, "kind": "material", "revision": 1,
            "body": {"format": "original_bytes", "sha256": sha, "byte_length": len(raw),
                     "content_base64": base64.b64encode(raw).decode()},
            "provenance": {"origin": origin, "path": source_path or str(path),
                           "retained_path": str(path), "blob_sha256": sha,
                           "custody": "observed_after_source_snapshot"}}


def _inventory(adapter, identity, revision, source_at):
    if not source_at:
        raise RecordError("an explicit source inventory Dolt commit is required")
    inventory = adapter.get_object(identity, revision=revision, commit=source_at)
    if inventory is None or inventory["kind"] != "inventory":
        raise RecordError("unknown fixed source inventory")
    if not isinstance(inventory["body"].get("review_queue"), list):
        raise RecordError("source inventory has no immutable review queue")
    return inventory


def _projection(inventory, objects, relations, *, source_objects=None, source_at=None):
    by_revision = {(obj["id"], obj["revision"]): obj for obj in objects}
    latest = {}
    for obj in objects:
        if obj["kind"] == "review_decision" and (obj["id"] not in latest or
                obj["revision"] > latest[obj["id"]]["revision"]):
            latest[obj["id"]] = obj
    by_edge = {edge["id"]: edge for edge in relations}
    items = []
    for index, item in enumerate(inventory["body"]["review_queue"]):
        binding = item_identity(inventory, index)
        decision = latest.get("review:" + binding["item_key"])
        state = "pending"
        if decision:
            body = decision["body"]
            if any(body.get(key) != value for key, value in binding.items()):
                raise RecordError("review decision does not bind its original queue occurrence")
            if body.get("item") != item or body.get("decision_sha256") != digest(
                    {key: value for key, value in body.items() if key != "decision_sha256"}):
                raise RecordError("review decision digest or original item mismatch")
            state = body.get("status")
            if state not in ("resolved", "pending", "unavailable"):
                raise RecordError("unknown review decision status")
            source = _check_ref(body["source_ref"], by_revision)
            if source["id"] != item["object_id"] or (source_at and body.get("source_snapshot_commit") != source_at):
                raise RecordError("review source does not bind the original inventory snapshot")
            if source_objects is not None:
                _check_ref(body["source_ref"], source_objects)
            proofs = body.get("evidence_refs", [])
            for ref in proofs:
                _check_ref(ref, by_revision)
            edge_ids = body.get("edge_ids", [])
            if state != "pending" and (not proofs or not edge_ids):
                raise RecordError("closed review lacks fixed proof and edges")
            selected = []
            for edge_id in edge_ids:
                edge = by_edge.get(edge_id)
                if edge is None or edge["body"].get("review_id") != decision["id"] or \
                        edge["body"].get("review_revision") != decision["revision"] or \
                        edge["body"].get("item_key") != binding["item_key"]:
                    raise RecordError("closed review edge is absent or binds another decision")
                selected.append(edge)
            for ref in proofs:
                if not any(edge["kind"] == "review_evidence" and
                           (edge["from_id"], edge["from_revision"]) == (decision["id"], decision["revision"]) and
                           (edge["to_id"], edge["to_revision"]) == (ref["id"], ref["revision"]) for edge in selected):
                    raise RecordError("review fixed proof lacks its evidence edge")
            target = body.get("target_ref")
            proof = body.get("proof", {})
            if state == "resolved" and body.get("method") == "verified_reference":
                if not target or target not in proofs or proof.get("resolution_status") not in ("resolved", "dependency_reference"):
                    raise RecordError("verified resolution requires its fixed target and resolution proof")
                if proof.get("original_href") != item.get("target"):
                    raise RecordError("resolution proof does not bind the original href")
            if state != "pending" and body.get("method") == "agent_review":
                files = proof.get("decision_file_refs", [])
                if not files or not proof.get("reviewer") or not proof.get("rationale") or not proof.get("scope"):
                    raise RecordError("Agent closure requires its retained decision file and scoped rationale")
                for ref in files:
                    if ref not in proofs:
                        raise RecordError("Agent decision file is not fixed review evidence")
                    original_bytes(_check_ref(ref, by_revision))
            if state != "pending" and body.get("method") not in ("agent_review", "verified_reference"):
                raise RecordError("closed review uses an unsupported decision method")
            if target:
                _check_ref(target, by_revision)
                source = body["source_ref"]
                if not any(edge["kind"] == "references_resolved" and
                           (edge["from_id"], edge["from_revision"]) == (source["id"], source["revision"]) and
                           (edge["to_id"], edge["to_revision"]) == (target["id"], target["revision"]) for edge in selected):
                    raise RecordError("resolved target lacks its fixed resolution edge")
            for semantic in body.get("proof", {}).get("semantic_relations", []):
                if not any(edge["kind"] == semantic["kind"] and
                           (edge["from_id"], edge["from_revision"], edge["to_id"], edge["to_revision"]) ==
                           (semantic["from_id"], semantic["from_revision"], semantic["to_id"], semantic["to_revision"]) and
                           edge["body"].get("scope") == semantic["scope"] for edge in selected):
                    raise RecordError("Agent semantic review lacks its fixed scoped edge")
        items.append({**binding, "reason": item["reason"], "status": state,
                      "decision_revision": decision["revision"] if decision else None})
    return items


def status(adapter, identity, revision=1, *, source_at, at=None, include_items=False):
    fixed = at or adapter.status()["commit"]
    inventory = _inventory(adapter, identity, revision, source_at)
    # The requested read snapshot must itself contain the original inventory.
    seen = adapter.get_object(identity, revision=revision, commit=fixed)
    if seen != inventory:
        raise RecordError("review read snapshot does not contain the fixed inventory")
    original = {(obj["id"], obj["revision"]): obj for obj in adapter.list_objects(commit=source_at, latest=False)}
    items = _projection(inventory, adapter.list_objects(commit=fixed, latest=False),
                        adapter.list_relations(commit=fixed), source_objects=original, source_at=source_at)
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
            raise RecordError("active review has no fixed source inventory")
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
        raise RecordError("review preparation requires a clean published Dolt working set")
    inventory = _inventory(adapter, identity, revision, source_at)
    original = adapter.list_objects(commit=source_at, latest=False)
    original_map = {(obj["id"], obj["revision"]): obj for obj in original}
    source_latest = {}
    for obj in original:
        if obj["id"] not in source_latest or obj["revision"] > source_latest[obj["id"]]["revision"]:
            source_latest[obj["id"]] = obj
    existing = adapter.list_objects(commit=current["commit"], latest=False)
    existing_edges = adapter.list_relations(commit=current["commit"])
    existing_edge_map = {edge["id"]: edge for edge in existing_edges}
    latest = {}
    for obj in existing:
        if obj["id"] not in latest or obj["revision"] > latest[obj["id"]]["revision"]:
            latest[obj["id"]] = obj
    batch = {}
    relations = []

    def add(value):
        value = json.loads(canonical(value))
        previous = latest.get(value["id"])
        if previous and previous["kind"] == value["kind"] and previous["body"] == value["body"] and previous["provenance"] == value["provenance"]:
            value = previous
        elif "revision" not in value:
            value["revision"] = previous["revision"] + 1 if previous else 1
        key = (value["id"], value["revision"])
        if key in batch and batch[key] != value:
            raise RecordError("conflicting fixed review evidence")
        batch[key] = value
        return value

    for obj in supplemental:
        original_bytes(obj)
        add(obj)
    manual = {}
    for spec in (decisions or {}).get("decisions", []):
        index = spec["item_index"]
        if index in manual or spec.get("item_sha256") != item_identity(inventory, index)["item_sha256"]:
            raise RecordError("duplicate or mismatched manual review occurrence")
        manual[index] = spec
    for index, item in enumerate(inventory["body"]["review_queue"]):
        binding = item_identity(inventory, index)
        source = source_latest.get(item["object_id"])
        if source is None:
            raise RecordError("original queue source is not present at the fixed snapshot")
        evidence = [source]
        target = None
        semantic = []
        method, state, proof = "unreviewed", "pending", {}
        spec = manual.get(index)
        if spec:
            if not spec.get("reviewer") or not spec.get("rationale") or not spec.get("scope"):
                raise RecordError("Agent review requires reviewer, rationale and explicit scope")
            method, state = "agent_review", spec["status"]
            proof = {key: spec[key] for key in ("reviewer", "rationale", "scope")}
            for ref in spec.get("object_refs", []):
                obj = original_map.get((ref["id"], ref["revision"]))
                if obj is None or hashlib.sha256(original_bytes(obj)).hexdigest() != ref["sha256"]:
                    raise RecordError("manual review's original evidence revision or hash mismatch")
                evidence.append(obj)
            files = spec.get("files", [])
            if state != "pending" and not files:
                raise RecordError("Agent closure requires its retained original decision file")
            retained_files = [add(retain_file(file["path"], file["sha256"], source_path=file.get("source_path"))) for file in files]
            evidence.extend(retained_files)
            proof["decision_file_refs"] = [_ref(obj) for obj in retained_files]
            for asset in spec.get("source_assets", []):
                receipt_ref = asset["receipt_ref"]
                receipt = original_map.get((receipt_ref["id"], receipt_ref["revision"]))
                if receipt is None or asset["sha256"] not in receipt["body"].get("evidence", {}).values():
                    raise RecordError("review source asset is not bound by the original receipt")
                evidence.append(receipt)
                evidence.append(add(retain_file(asset["path"], asset["sha256"], source_path=asset["source_path"])))
            asset_groups = {}
            for asset in spec.get("source_assets", []):
                ref = asset["receipt_ref"]
                asset_groups.setdefault((ref["id"], ref["revision"]), set()).add(asset["sha256"])
            for key, hashes in asset_groups.items():
                if hashes != set(original_map[key]["body"]["evidence"].values()):
                    raise RecordError("Agent source review must retain the complete frozen evidence set")
            semantic = spec.get("semantic_relations", [])
            proof["semantic_relations"] = semantic
            proof["source_asset_count"] = len(spec.get("source_assets", []))
        elif item["reason"] in ("unresolved_local_link", "unsafe_local_link"):
            resolution = resolve_link(item["target"], source["provenance"]["path"], source["provenance"],
                                      original, root=root, repository_root=root,
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
                raise RecordError("unsupported or unscoped Agent semantic relation")
            from_obj = original_map.get((relation["from_id"], relation["from_revision"]))
            to_obj = original_map.get((relation["to_id"], relation["to_revision"]))
            if not from_obj or not to_obj or _ref(from_obj) not in body["evidence_refs"] or _ref(to_obj) not in body["evidence_refs"]:
                raise RecordError("semantic endpoints must be fixed reviewed evidence")
            edges.append(_edge(relation["kind"], from_obj, to_obj,
                               {**binding_edge, "scope": relation["scope"], "retrospective": True}))
        body["edge_ids"] = sorted(edge["id"] for edge in edges)
        body["decision_sha256"] = digest(body)
        add(review)
        relations.extend(edges)
    all_objects = {(obj["id"], obj["revision"]): obj for obj in existing}
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
    if payload.get("schema_version") != 1 or payload.get("payload_sha256") != digest(
            {key: value for key, value in payload.items() if key != "payload_sha256"}):
        raise RecordError("frozen review publication payload digest mismatch")
    inventory = _inventory(adapter, payload["inventory_id"], payload["inventory_revision"], payload["source_snapshot_commit"])
    existing = adapter.list_objects(commit=payload["base_commit"], latest=False)
    combined = {(obj["id"], obj["revision"]): obj for obj in existing}
    expected_reviews = {"review:" + item_identity(inventory, index)["item_key"]
                        for index in range(len(inventory["body"]["review_queue"]))}
    if {obj["id"] for obj in payload["objects"] if obj["kind"] == "review_decision"} != expected_reviews:
        raise RecordError("review payload must bind exactly the original queue occurrences")
    for obj in payload["objects"]:
        key = (obj["id"], obj["revision"])
        if key in combined and combined[key] != obj:
            raise RecordError("review payload tries to change an immutable revision")
        if key not in combined and obj["kind"] not in ("review_decision", "reference", "material", "evidence_json"):
            raise RecordError("review publication cannot create research metadata or inventories")
        combined[key] = obj
        if obj["kind"] == "material":
            original_bytes(obj)
    relations = payload["relations"] + adapter.list_relations(commit=payload["base_commit"])
    original = {(obj["id"], obj["revision"]): obj for obj in adapter.list_objects(commit=payload["source_snapshot_commit"], latest=False)}
    _projection(inventory, list(combined.values()), relations, source_objects=original,
                source_at=payload["source_snapshot_commit"])
    result = adapter.publish(payload["objects"], payload["relations"], payload["operation_id"], payload["expected_version"],
                             message=f"Review immutable inventory {payload['inventory_id']}@{payload['inventory_revision']}")
    return {**result, "review": status(adapter, payload["inventory_id"], payload["inventory_revision"],
                                      source_at=payload["source_snapshot_commit"], at=result["commit"])}
