"""Read projections for research decisions, admitted knowledge and archives.

Admission and correction remain explicit, revision-bound Agent decisions.
This module neither classifies source prose nor changes retained records.
"""

from __future__ import annotations

import re

from research.records.common import RecordError


RESEARCH_ID = re.compile(r"[CSHDF]\d+[a-z]?", re.IGNORECASE)
HASH = re.compile(r"(?<![A-Za-z0-9])[0-9a-f]{32,}(?![A-Za-z0-9])", re.IGNORECASE)
READABLE_FIELDS = {
    "title", "text", "question", "mechanism", "hypothesis", "scope", "next_action",
    "description", "rationale", "notes", "limitations", "limitation", "difference",
    "attempt_id", "run_id", "component_id", "explicit_id", "declared_id", "name", "case",
    "layer", "outcome", "role", "integrity", "evidence_grade", "status",
    "statement", "decision_impact", "component", "boundary",
}
ARCHIVE_FIELDS = {"path", "target", "record_id", "original_href", "purpose", "value_basis"}
INTERNAL_KINDS = {"reference", "review_decision", "publication", "inventory", "retention_decision"}


def latest_objects(objects):
    latest = {}
    for obj in objects:
        previous = latest.get(obj["id"])
        if previous is None or obj["revision"] > previous["revision"]:
            latest[obj["id"]] = obj
    return list(latest.values())


def _ref(obj):
    return {"id": obj["id"], "revision": obj["revision"]}


def _endpoint(edge, side):
    return {"id": edge[side + "_id"], "revision": edge[side + "_revision"]}


def admissions(objects):
    """Never infer admission from successful import or reference review."""
    decisions = {}
    for obj in latest_objects(objects):
        if obj["kind"] != "retention_decision":
            continue
        target = obj["body"].get("target", {})
        if not isinstance(target, dict) or not isinstance(target.get("id"), str) or \
                type(target.get("revision")) is not int:
            raise RecordError("retention decision has no fixed target revision")
        key = target["id"], target["revision"]
        if key in decisions:
            raise RecordError(f"multiple retention decisions for fixed target {key}")
        decisions[key] = obj
    return decisions


def _strings(value, fields, key=None):
    if isinstance(value, str):
        if key in fields:
            yield HASH.sub(" ", value)
    elif isinstance(value, dict):
        for child_key, child in value.items():
            # Serialized source bodies are custody bytes, never search text.
            if child_key not in {"content_base64", "raw_content_base64"}:
                yield from _strings(child, fields, child_key)
    elif isinstance(value, list):
        for child in value:
            yield from _strings(child, fields, key)


def _declared_ids(obj):
    body = obj["body"]
    for name in ("attempt_id", "run_id", "explicit_id", "declared_id"):
        if isinstance(body.get(name), str):
            yield body[name]


def admission_view(decision):
    if decision is None:
        return None
    body = decision["body"]
    return {**_ref(decision), "target": body["target"], "disposition": body["disposition"],
            **{key: body[key] for key in ("reviewer", "purpose", "value_basis") if key in body}}


def _aliases(obj):
    aliases = {obj["id"]}
    explicit = obj["body"].get("explicit_id")
    if obj["kind"] == "material_section" and isinstance(explicit, str):
        aliases.add(explicit.casefold() + "_section")
    return aliases


def _retained_match(obj, entry):
    reference = entry.get("object_ref")
    if isinstance(reference, dict):
        return reference == _ref(obj)
    return isinstance(reference, str) and reference in _aliases(obj)


def _applies(obj, edge):
    fixed = obj["id"], obj["revision"]
    if any(fixed == (edge[side + "_id"], edge[side + "_revision"]) for side in ("from", "to")):
        return True
    scope = edge["body"].get("scope")
    return isinstance(scope, dict) and any(
        _retained_match(obj, entry)
        for entry in scope.get("retained_research_decisions", []))


class _Reader:
    """Cache selected DTOs at one snapshot; no unqualified material inventory."""

    def __init__(self, adapter, at, initial):
        self.adapter, self.at = adapter, at
        self.objects = {(obj["id"], obj["revision"]): obj for obj in initial}
        self.current = {}

    def get(self, identity, revision=None):
        found = self.current.get(identity) if revision is None else self.objects.get((identity, revision))
        if found is None:
            found = self.adapter.get_object(identity, revision=revision, commit=self.at)
            if found is None:
                raise RecordError(f"retrieval fixed object is missing: {identity}@{revision or 'latest'}")
            self.objects[found["id"], found["revision"]] = found
            if revision is None:
                self.current[identity] = found
        return found


def _correction_context(reader, candidates, relations):
    selected = []
    for edge in relations:
        if edge["kind"] != "corrects" or not any(_applies(obj, edge) for obj in candidates):
            continue
        selected.append(edge)
        for side in ("from", "to"):
            reader.get(edge[side + "_id"], edge[side + "_revision"])
            # A historical correction endpoint must not make an older revision
            # appear to be the current target of a knowledge admission.
            reader.get(edge[side + "_id"])
        review_id = edge["body"].get("review_id")
        if review_id:
            reader.get(review_id)
    return selected


def load_search(adapter, at, *, include_archive=False):
    relations = adapter.list_relations(commit=at)
    if include_archive:
        return adapter.list_objects(commit=at, latest=False), relations
    objects = [obj for kind in ("attempt", "run", "retention_decision")
               for obj in adapter.list_objects(kind=kind, commit=at)]
    reader = _Reader(adapter, at, objects)
    reader.current.update({obj["id"]: obj for obj in objects})
    for decision in admissions(objects).values():
        if decision["body"].get("disposition") == "knowledge":
            # Current source revision must still equal the independently frozen
            # admitted target. A new source revision never inherits admission.
            reader.get(decision["body"]["target"]["id"])
    candidates = latest_objects(list(reader.objects.values()))
    selected = _correction_context(reader, candidates, relations)
    return list(reader.objects.values()), selected


def load_show(adapter, at, obj, relations):
    decisions = adapter.list_objects(kind="retention_decision", commit=at)
    reader = _Reader(adapter, at, [obj, *decisions])
    selected = _correction_context(reader, [obj], relations)
    return reader, selected


def resolved_references(reader, obj, relations):
    """Validate only this object's resolution closure using the existing audit.

    The global inventory remains immutable. Unrelated queue occurrences need
    not load their source bytes and review assets for a scoped material read.
    """
    selected = []
    for edge in relations:
        if edge["kind"] != "references_resolved" or \
                (edge["from_id"], edge["from_revision"]) != (obj["id"], obj["revision"]):
            continue
        review_id = edge["body"].get("review_id")
        if review_id is None:
            continue
        review = reader.get(review_id)
        if review["revision"] == edge["body"].get("review_revision") and \
                review["body"].get("status") == "resolved":
            selected.append(review)
    if not selected:
        return []
    objects = {}
    for review in latest_objects(selected):
        objects[review["id"], review["revision"]] = review
        body = review["body"]
        refs = [body["source_ref"], *body.get("evidence_refs", []),
                {"id": body["inventory_id"], "revision": body["inventory_revision"]}]
        for ref in refs:
            proof = reader.get(ref["id"], ref["revision"])
            objects[proof["id"], proof["revision"]] = proof
    from research.records.reviews import active_resolutions
    return [edge for edge in active_resolutions(list(objects.values()), relations)
            if (edge["from_id"], edge["from_revision"]) == (obj["id"], obj["revision"])]


def corrections(obj, objects, relations):
    """Expose only fixed correction endpoints and explicitly reviewed scopes.

    A retained research decision can remain valid while its source rationale is
    corrected. An explicit alias such as d94_section needs the review's fixed
    evidence reference before it can annotate that historical section.
    """
    current = {item["id"]: item for item in latest_objects(objects)}
    fixed_refs = {(item["id"], item["revision"]) for item in objects}
    target = obj["id"], obj["revision"]
    output = []
    for edge in relations:
        if edge["kind"] != "corrects" or not _applies(obj, edge):
            continue
        source_ref, old_ref = _endpoint(edge, "from"), _endpoint(edge, "to")
        if any((ref["id"], ref["revision"]) not in fixed_refs for ref in (source_ref, old_ref)):
            raise RecordError("correction has a missing fixed endpoint")
        review_id = edge["body"].get("review_id")
        review = current.get(review_id) if review_id else None
        if review_id and (review is None or review["revision"] != edge["body"].get("review_revision")
                          or review["body"].get("status") != "resolved"):
            continue
        scope = edge["body"].get("scope")
        effect, preserve = None, None
        if target == (old_ref["id"], old_ref["revision"]):
            effect = "corrected_source_revision"
        elif target == (source_ref["id"], source_ref["revision"]):
            effect = "source_correction"
        elif review and isinstance(scope, dict):
            evidence = {(ref["id"], ref["revision"]) for ref in review["body"].get("evidence_refs", [])}
            for retained in scope.get("retained_research_decisions", []):
                if target in evidence and _retained_match(obj, retained):
                    effect = "scoped_source_correction"
                    preserve = retained.get("preserve")
                    break
        if effect:
            output.append({"relation_id": edge["id"], "effect": effect,
                           "from_ref": source_ref, "to_ref": old_ref, "scope": scope,
                           **({"preserve": preserve} if preserve is not None else {})})
    return output


def search(objects, relations, query, *, include_archive=False):
    if not isinstance(query, str) or not query.strip():
        raise RecordError("material search requires a nonempty query")
    query = query.strip()
    mode = "research_id" if RESEARCH_ID.fullmatch(query) else "text"
    pattern = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(query) + r"(?![A-Za-z0-9_])",
                         re.IGNORECASE) if mode == "research_id" else None
    admitted = admissions(objects)
    results = []
    for obj in latest_objects(objects):
        if obj["kind"] in INTERNAL_KINDS and not include_archive:
            continue
        decision = admitted.get((obj["id"], obj["revision"]))
        is_knowledge = decision is not None and decision["body"].get("disposition") == "knowledge"
        if is_knowledge:
            view = "admitted_knowledge"
        elif obj["kind"] == "attempt":
            view = "research_decision"
        elif obj["kind"] == "run":
            view = "native_run_identity"
        elif include_archive:
            view = "legacy_archive"
        else:
            continue
        fields = READABLE_FIELDS | (ARCHIVE_FIELDS if include_archive else set())
        # Admission reviews a compact expression, not every historical sentence
        # in the referenced source. Original bytes remain accessible via show.
        searchable = decision["body"]["claim"] if is_knowledge else obj["body"]
        text = "\n".join(_strings(searchable, fields))
        identifiers = list(_declared_ids(obj))
        # Object IDs contain hash-based receipts and are not full-text fields.
        # Exact declared record IDs take precedence over textual references.
        direct = query.casefold() in {identity.casefold() for identity in identifiers}
        matches = (direct or bool(pattern.search(text))) if pattern else query.casefold() in text.casefold()
        match_basis = "declared_id" if direct else "reviewed_claim" if is_knowledge else "retained_record"
        if not matches and include_archive and is_knowledge:
            retained_text = "\n".join(_strings(obj["body"], fields))
            matches = bool(pattern.search(retained_text)) if pattern else query.casefold() in retained_text.casefold()
            if matches:
                view, match_basis = "legacy_archive", "retained_source"
        if not matches:
            continue
        result = {**_ref(obj), "kind": obj["kind"], "title": obj["body"].get("title"),
                  "source": obj["provenance"].get("path"), "scope": view,
                  "match_basis": match_basis,
                  "knowledge_admission": admission_view(decision) if is_knowledge else None,
                  "corrections": corrections(obj, objects, relations)}
        if is_knowledge:
            result["claim"] = decision["body"]["claim"]
        if obj["kind"] == "attempt":
            result.update({key: obj["body"][key] for key in ("question", "decision") if key in obj["body"]})
        results.append((0 if direct else 1, result))
    results.sort(key=lambda item: (item[0], item[1]["id"]))
    return {"query_mode": mode, "scope": "archive_included" if include_archive else "decisions_and_admitted_knowledge",
            "matches": [item for _, item in results]}
