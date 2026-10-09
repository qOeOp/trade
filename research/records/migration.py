"""Publish a lossless material inventory through the metadata storage port."""

from __future__ import annotations

import base64
from collections import Counter
import hashlib

from research.records.common import RecordError
from research.records.store import canonical


def _fingerprint(obj):
    # Reobserving unchanged bytes at another Git HEAD does not create a revision.
    return canonical({"kind": obj["kind"], "body": obj["body"],
                      "blob_sha256": obj["provenance"].get("blob_sha256")})


def plan(adapter, inventory):
    for incoming in inventory["objects"]:
        if incoming["kind"] in ("attempt", "run") or incoming["id"].startswith(("attempt:", "run:")):
            raise RecordError(f"material import cannot register or revise research records: {incoming['id']}; publish through the Dolt record API")
    status = adapter.status()
    if status["dirty"]:
        raise RecordError("migration requires a clean Dolt working set")
    existing = adapter.list_objects(commit=status["commit"], latest=False)
    indexed = {(obj["id"], _fingerprint(obj)): obj for obj in existing}
    latest = {}
    for obj in existing:
        if obj["id"] not in latest or obj["revision"] > latest[obj["id"]]:
            latest[obj["id"]] = obj["revision"]
    rows, endpoints = [], {}
    for incoming in inventory["objects"]:
        key = (incoming["id"], _fingerprint(incoming))
        obj = indexed.get(key)
        if obj is None:
            revision = latest.get(incoming["id"], 0) + 1
            obj = {**incoming, "revision": revision}
            indexed[key] = obj
            latest[obj["id"]] = revision
            rows.append(obj)
        endpoints[(incoming["id"], incoming["provenance"].get("blob_sha256"))] = obj
    edges = []
    old_edges = {edge["id"] for edge in adapter.list_relations(commit=status["commit"])}
    for incoming in inventory["relations"]:
        body = dict(incoming["body"])
        # Provenance locators and source bytes define this edge. Merely observing
        # them again at a newer HEAD must not manufacture another fact.
        if isinstance(body.get("source"), dict):
            body["source"] = {key: value for key, value in body["source"].items()
                              if key not in ("source_head", "git_commit", "worktree_state", "raw_content_base64")}
        edge = {"kind": incoming["kind"], "body": body}
        for side in ("from", "to"):
            identity = incoming[side + "_id"]
            key = (identity, incoming.get(side + "_source_sha256"))
            endpoint = endpoints.get(key)
            if endpoint is None:
                raise RecordError(f"unresolved fixed relation endpoint: {key}")
            edge.update({side + "_id": identity, side + "_revision": endpoint["revision"], side + "_kind": endpoint["kind"]})
        edge["id"] = "edge:" + hashlib.sha256(canonical(edge).encode()).hexdigest()
        if edge["id"] not in old_edges:
            edges.append(edge)
            old_edges.add(edge["id"])
    receipt_body = {"source_head": inventory["source_head"], "statistics": inventory["statistics"],
                    "review_queue": inventory["review_queue"], "warnings": inventory["warnings"]}
    receipt_digest = hashlib.sha256(canonical(receipt_body).encode()).hexdigest()
    receipt = {"id": "inventory:" + receipt_digest, "kind": "inventory", "revision": 1,
               "body": receipt_body, "provenance": {"source_head": inventory["source_head"], "origin": "automatic_material_scan"}}
    # A repeated identical scan remains the original receipt and commit.
    if not adapter.get_object(receipt["id"], commit=status["commit"]):
        rows.append(receipt)
    digest = hashlib.sha256(canonical({"objects": rows, "relations": edges}).encode()).hexdigest()
    return {"objects": rows, "relations": edges, "expected_version": status["version"],
            "operation_id": "import:" + digest, "base_commit": status["commit"],
            "receipt_id": receipt["id"], "statistics": inventory["statistics"],
            "new_objects": len(rows), "new_relations": len(edges),
            "new_kinds": dict(Counter(obj["kind"] for obj in rows))}


def publish(adapter, inventory, dry_run=False):
    batch = plan(adapter, inventory)
    public = {key: value for key, value in batch.items() if key not in ("objects", "relations")}
    if dry_run:
        return {**public, "dry_run": True}
    if not batch["objects"] and not batch["relations"]:
        return {**public, "commit": batch["base_commit"], "version": batch["expected_version"], "unchanged": True}
    result = adapter.publish(batch["objects"], batch["relations"], batch["operation_id"],
                             batch["expected_version"], "import repository research materials")
    return {**public, **result}


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
