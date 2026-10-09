"""Read projections for research decisions, admitted knowledge and archives.

Admission and correction remain explicit, revision-bound Agent decisions.
This module neither classifies source prose nor changes retained records.
"""

from __future__ import annotations

import re
import hashlib

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
SEMANTIC_EFFECTS = {"corrects", "narrows", "refutes"}
PURPOSES = {"knowledge", "research", "engineering", "demo", "source", "diagnostic", "pending", "unknown"}
VIEWS = {"knowledge", "research", "archive", "native_run_identity", "admitted_knowledge",
         "research_decision", "legacy_archive"}


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
    for name in ("attempt_id", "run_id", "component_id", "explicit_id", "declared_id"):
        if isinstance(body.get(name), str):
            yield body[name]
    # Retained component definitions declare their symbol as name. A name in
    # another record is prose, not an alias for admitted knowledge.
    if obj["kind"] == "component" and isinstance(body.get("name"), str):
        yield body["name"]


def admission_view(decision):
    if decision is None:
        return None
    body = decision["body"]
    return {**_ref(decision), "target": body["target"], "disposition": body["disposition"],
            **{key: body[key] for key in ("schema_version", "reviewer", "purpose", "value_basis",
                                        "evidence", "retention") if key in body}}


def admission_for(adapter, at, obj):
    """Read current decisions only for this exact admitted target revision."""
    from research.records.store import canonical

    identities = {edge["from_id"] for edge in adapter.list_relations(
        commit=at, kinds=("retention_of",), to_refs=((obj["id"], obj["revision"]),), include_body=False)}
    # These fixed identities also preserve pre-index decisions and old imports.
    identities.add("retention:" + hashlib.sha256(canonical(_ref(obj)).encode()).hexdigest())
    legacy_id = "retention:" + obj["id"]
    if len(legacy_id) <= 160:
        identities.add(legacy_id)
    decisions = []
    for identity in sorted(identities):
        decision = adapter.get_object(identity, commit=at)
        if decision is not None:
            if decision["kind"] != "retention_decision":
                raise RecordError("retention target index points to a non-decision object")
            decisions.append(decision)
    return admissions(decisions).get((obj["id"], obj["revision"]))


def _aliases(obj):
    aliases = {obj["id"]}
    explicit = obj["body"].get("explicit_id")
    if obj["kind"] == "material_section" and isinstance(explicit, str):
        aliases.add(explicit.casefold() + "_section")
    return aliases


def _retained_match(obj, entry, *, historical=False):
    reference = entry.get("object_ref")
    if isinstance(reference, dict):
        return reference == _ref(obj) or historical and reference.get("id") == obj["id"]
    return isinstance(reference, str) and reference in _aliases(obj)


def _applies(obj, edge, *, historical=False):
    fixed = obj["id"], obj["revision"]
    if any(fixed == (edge[side + "_id"], edge[side + "_revision"]) or
           historical and obj["id"] == edge[side + "_id"] for side in ("from", "to")):
        return True
    scope = edge["body"].get("scope")
    return isinstance(scope, dict) and any(
        _retained_match(obj, entry, historical=historical)
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


def _correction_relations(reader, candidates):
    """Locate direct scopes and reviewed source bridges without an inventory."""
    identities = sorted({obj["id"] for obj in candidates})
    refs = tuple((identity, None) for identity in identities)
    scope_refs = [{"id": identity} for identity in identities]
    scope_refs.extend(sorted({alias for obj in candidates for alias in _aliases(obj)}))
    semantic = reader.adapter.list_relations(
        commit=reader.at, kinds=tuple(sorted(SEMANTIC_EFFECTS)),
        from_refs=refs, to_refs=refs, scope_refs=scope_refs)
    dependencies = reader.adapter.list_relations(
        commit=reader.at, kinds=("references", "documents_source_check"),
        to_refs=refs, include_body=False)
    sources = {(edge["from_id"], edge["from_revision"]) for edge in dependencies}
    evidence = reader.adapter.list_relations(
        commit=reader.at, kinds=("review_evidence",),
        to_refs=tuple(sorted(sources)) + refs, include_body=False)
    selected_ids = set()
    for identity, revision in sorted({(edge["from_id"], edge["from_revision"]) for edge in evidence}):
        review = reader.get(identity, revision)
        selected_ids.update(review["body"].get("edge_ids", []))
    indirect = reader.adapter.list_relations(
        commit=reader.at, kinds=tuple(sorted(SEMANTIC_EFFECTS)), ids=tuple(sorted(selected_ids)))
    return list({edge["id"]: edge for edge in [*semantic, *dependencies, *evidence, *indirect]}.values())


def _correction_context(reader, candidates, relations):
    selected = []
    for edge in relations:
        if edge["kind"] not in SEMANTIC_EFFECTS:
            continue
        review_id = edge["body"].get("review_id")
        if not review_id:
            continue
        direct = any(_applies(obj, edge, historical=True) for obj in candidates)
        reviewed_endpoints = {(item["to_id"], item["to_revision"]) for item in relations
                              if item["kind"] == "review_evidence" and item["from_id"] == review_id
                              and item["from_revision"] == edge["body"].get("review_revision")}
        if not direct and not any(item["kind"] in {"references", "documents_source_check"}
                and (item["from_id"], item["from_revision"]) in reviewed_endpoints
                and any(obj["id"] == item["to_id"] for obj in candidates) for item in relations):
            continue
        review = reader.get(review_id)
        source = review["body"].get("source_ref", {})
        source_key = source.get("id"), source.get("revision")
        dependencies = [item for item in relations if item["kind"] in {"references", "documents_source_check"}
                        and (item["from_id"], item["from_revision"]) == source_key
                        and any(obj["id"] == item["to_id"] for obj in candidates)]
        if not dependencies and not any(_applies(obj, edge, historical=True) for obj in candidates):
            continue
        selected.append(edge)
        selected.extend(dependencies)
        for dependency in dependencies:
            reader.get(dependency["to_id"], dependency["to_revision"])
        for side in ("from", "to"):
            reader.get(edge[side + "_id"], edge[side + "_revision"])
            # A historical correction endpoint must not make an older revision
            # appear to be the current target of a knowledge admission.
            reader.get(edge[side + "_id"])
        fixed_review = reader.get(review_id, edge["body"].get("review_revision"))
        for ref in fixed_review["body"].get("evidence_refs", []):
            reader.get(ref["id"], ref["revision"])
            reader.get(ref["id"])
    return selected


def load_search(adapter, at, *, include_archive=False):
    if include_archive:
        return adapter.list_objects(commit=at, latest=False), adapter.list_relations(commit=at)
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
    relations = _correction_relations(reader, candidates)
    selected = _correction_context(reader, candidates, relations)
    # Typed parent repair relations are informational until the repair has a
    # completed decision. They never replace or revoke the original result.
    refs = tuple((obj["id"], obj["revision"]) for obj in candidates)
    dependencies = adapter.list_relations(commit=at, kinds=("repair", "component_reuse"),
                                         from_refs=refs, to_refs=tuple((obj["id"], None) for obj in candidates))
    return list(reader.objects.values()), selected + dependencies


def load_show(adapter, at, obj):
    reader = _Reader(adapter, at, [obj])
    relations = _correction_relations(reader, [obj])
    selected = _correction_context(reader, [obj], relations)
    for edge in adapter.list_relations(commit=at, kinds=("repair",), to_refs=((obj["id"], None),)):
        reader.get(edge["from_id"], edge["from_revision"])
        reader.get(edge["from_id"])
        selected.append(edge)
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
    relation_ids = set()
    for review in latest_objects(selected):
        objects[review["id"], review["revision"]] = review
        body = review["body"]
        relation_ids.update(body.get("edge_ids", []))
        refs = [body["source_ref"], *body.get("evidence_refs", []),
                {"id": body["inventory_id"], "revision": body["inventory_revision"]}]
        for ref in refs:
            proof = reader.get(ref["id"], ref["revision"])
            objects[proof["id"], proof["revision"]] = proof
    from research.records.reviews import active_resolutions
    closure = reader.adapter.list_relations(commit=reader.at, ids=tuple(sorted(relation_ids)))
    return [edge for edge in active_resolutions(list(objects.values()), closure)
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
        if edge["kind"] not in SEMANTIC_EFFECTS:
            continue
        source_ref, old_ref = _endpoint(edge, "from"), _endpoint(edge, "to")
        review_id = edge["body"].get("review_id")
        review = current.get(review_id) if review_id else None
        if not review_id or review is None or review["revision"] != edge["body"].get("review_revision") \
                or review["body"].get("status") != "resolved":
            continue
        scope = edge["body"].get("scope")
        semantic_fields = ("kind", "from_id", "from_revision", "to_id", "to_revision")
        if not scope or edge["id"] not in review["body"].get("edge_ids", []) or not any(
                all(item.get(key) == edge.get(key) for key in semantic_fields) and item.get("scope") == scope
                for item in review["body"].get("proof", {}).get("semantic_relations", [])):
            continue
        dependency = _review_dependency(obj, review, scope, objects, relations)
        if not _applies(obj, edge, historical=True) and dependency is None:
            continue
        if any((ref["id"], ref["revision"]) not in fixed_refs for ref in (source_ref, old_ref)):
            raise RecordError("correction has a missing fixed endpoint")
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
                historical = [item for item in objects if (item["id"], item["revision"]) in evidence
                              and item["id"] == obj["id"] and _retained_match(item, retained)]
                if historical:
                    effect = "historical_dependency"
                    preserve = retained.get("preserve")
                    break
        if effect is None and obj["id"] in {source_ref["id"], old_ref["id"]}:
            effect = "historical_dependency"
        if effect is None and dependency is not None:
            effect, preserve, _ = dependency
        if effect:
            output.append({"relation_id": edge["id"], "relation_kind": edge["kind"], "effect": effect,
                           "from_ref": source_ref, "to_ref": old_ref, "scope": scope,
                           "review_ref": _ref(review), "evidence_group": f"{review['id']}@{review['revision']}",
                           "requires_reassessment": effect == "historical_dependency",
                           **({"dependency_ref": dependency[2]} if dependency is not None else {}),
                           **({"preserve": preserve} if preserve is not None else {})})
    return output


def _review_dependency(obj, review, scope, objects, relations):
    """Bridge reviewed historical material through existing fixed typed edges."""
    body = review["body"]
    evidence = {(ref["id"], ref["revision"]) for ref in body.get("evidence_refs", [])}
    source = body.get("source_ref", {})
    source_key = source.get("id"), source.get("revision")
    if source_key not in evidence:
        return None
    for edge in relations:
        if (edge["from_id"], edge["from_revision"]) != source_key or edge["to_id"] != obj["id"] \
                or not any((old["id"], old["revision"]) == (edge["to_id"], edge["to_revision"]) for old in objects):
            continue
        target = _endpoint(edge, "to")
        if edge["kind"] == "documents_source_check" and (target["id"], target["revision"]) in evidence:
            effect = "shared_review_context" if target == _ref(obj) else "historical_dependency"
            return effect, None, target
        if edge["kind"] != "references" or obj["kind"] != "attempt" or not isinstance(scope, dict):
            continue
        identity = obj["body"].get("attempt_id")
        # The reviewed section names the research decision, and the reviewed
        # source separately has an exact typed reference to its old revision.
        # Equal prose labels alone never establish downstream impact.
        for old in objects:
            if (old["id"], old["revision"]) not in evidence or old["kind"] != "material_section" \
                    or old["body"].get("explicit_id") != identity:
                continue
            for retained in scope.get("retained_research_decisions", []):
                if _retained_match(old, retained):
                    return "historical_dependency", retained.get("preserve"), target
    return None


def incoming_repairs(obj, objects, relations):
    current = {item["id"]: item for item in latest_objects(objects)}
    output = []
    for edge in relations:
        if edge["kind"] != "repair" or edge["to_id"] != obj["id"]:
            continue
        repair = current.get(edge["from_id"])
        if repair is None or repair.get("kind") != "attempt":
            continue
        decision = repair["body"].get("decision", {})
        if decision.get("outcome") != "pending":
            continue
        output.append({"relation_id": edge["id"], "repair_ref": _ref(repair),
                       "target_ref": _endpoint(edge, "to"), "status": "pending_repair",
                       "scope": decision.get("scope"), "next_action": decision.get("next_action"),
                       "effect": "requires_reassessment", "original_decision_preserved": True})
    return output


def reference_view(obj, active=()):
    """Report byte availability only where a fixed hash can be checked.

    A resolved URL/dependency descriptor is navigation, not verified source
    content. Historical bytes are read only at the configured exact archive
    commit; no fetch, external file traversal or publication occurs.
    """
    output = []
    archive = None
    archive_loaded = False
    for ref in obj["body"].get("evidence_refs", [])[:24]:
        if not isinstance(ref, dict):
            continue
        entry = {"reference": dict(ref), "status": "declared"}
        path, expected = ref.get("path"), ref.get("sha256")
        if isinstance(path, str) and isinstance(expected, str) and re.fullmatch(r"[0-9a-f]{64}", expected):
            from research.records.history import load_archive
            try:
                if not archive_loaded:
                    archive_loaded = True
                    archive = load_archive()
                if archive is None or not archive.allows(path):
                    entry["reason"] = "no_fixed_archive_for_path"
                else:
                    raw = archive.read_bytes(path)
                    if raw is None:
                        entry.update(status="unavailable", reason="fixed_archive_bytes_unavailable")
                    else:
                        actual = hashlib.sha256(raw).hexdigest()
                        entry.update(status="verified" if actual == expected else "unavailable",
                                     source={"kind": "fixed_git_archive", "commit": archive.commit,
                                             "path": path}, actual_sha256=actual)
                        if actual != expected:
                            entry["reason"] = "fixed_archive_hash_mismatch"
            except RecordError as exc:
                entry.update(status="unavailable", reason=str(exc))
        output.append(entry)
    for edge in active[:24]:
        proof = edge.get("body", {}).get("proof", {})
        output.append({"relation_id": edge["id"], "reference": _endpoint(edge, "to"),
                       "status": "declared", "reason": "recorded_review_proof_not_read_back",
                       "review_ref": {"id": edge["body"].get("review_id"),
                                      "revision": edge["body"].get("review_revision")},
                       "proof": {key: proof[key] for key in ("kind", "git_commit", "path", "sha256",
                                  "target_sha256", "target_content_read", "resolution_status") if key in proof}})
    return output


def purpose_view(obj, *, knowledge=False):
    """Use declared purpose or typed fields, never semantic guesses from prose."""
    if knowledge:
        return "knowledge", "retention_decision.disposition"
    for key in ("purpose",):
        value = obj["body"].get(key)
        if isinstance(value, str) and value in {"research", "engineering", "demo", "unknown"}:
            return value, "body." + key
    decision = obj["body"].get("decision", {})
    if decision.get("outcome") == "pending":
        return "pending", "body.decision.outcome"
    if obj["body"].get("kind") in {"source", "diagnostic"}:
        return obj["body"]["kind"], "body.kind"
    if obj["kind"] in {"material", "material_section"}:
        return "source", "kind"
    return "unknown", "no_explicit_purpose"


def _string_paths(value, fields, path="", key=None):
    if isinstance(value, str) and key in fields:
        yield path, HASH.sub(" ", value)
    elif isinstance(value, dict):
        for name, child in value.items():
            if name not in {"content_base64", "raw_content_base64"}:
                yield from _string_paths(child, fields, f"{path}.{name}" if path else name, name)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _string_paths(child, fields, f"{path}[{index}]", key)


def _alias_expansions(objects, relations, admitted, query):
    """Expand a reviewed name only through a fixed typed component dependency."""
    output = {}
    for target in latest_objects(objects):
        decision = admitted.get((target["id"], target["revision"]))
        if decision is None or decision["body"].get("disposition") != "knowledge":
            continue
        claim = decision["body"].get("claim", {})
        aliases = claim.get("aliases", []) if target["kind"] == "component" else []
        aliases = aliases if isinstance(aliases, list) else []
        symbols = list(_declared_ids(target)) if target["kind"] == "component" else []
        matched_alias = next((value for value in aliases + symbols
                              if isinstance(value, str) and value.casefold() == query.casefold()), None)
        if matched_alias is None or not symbols:
            continue
        evidence = [ref for ref in decision["body"].get("evidence", [])
                    if isinstance(ref, dict) and "id" in ref and "revision" in ref]
        for obj in latest_objects(objects):
            if obj["kind"] != "attempt":
                continue
            for index, ref in enumerate(obj["body"].get("mechanism_refs", [])):
                if ref.get("component") not in symbols or not ref.get("boundary"):
                    continue
                targets = [*evidence, _ref(target)]
                edge = next((edge for edge in relations if edge["kind"] == "component_reuse"
                             and _endpoint(edge, "from") == _ref(obj)
                             and _endpoint(edge, "to") in targets
                             and edge["to_id"] == "attempt:" + ref.get("attempt_id", "")), None)
                if edge is None:
                    continue
                output.setdefault((obj["id"], obj["revision"]), []).append({
                    "basis": "reviewed_mechanism_alias", "path": f"body.mechanism_refs[{index}]",
                    "alias": matched_alias, "admission_ref": _ref(decision), "target_ref": _ref(target),
                    "claim_scope": claim.get("scope"), "boundary": ref["boundary"],
                    "fixed_dependency": _endpoint(edge, "to"), "relation_id": edge["id"],
                })
    return output


def search(objects, relations, query, *, include_archive=False, purpose=None, outcome=None, view=None):
    if not isinstance(query, str) or not query.strip():
        raise RecordError("material search requires a nonempty query")
    query = query.strip()
    if purpose is not None and purpose not in PURPOSES:
        raise RecordError("unknown search purpose", code="invalid_search_purpose",
                          next_actions=["Choose a declared purpose facet; prose is not used to infer it."])
    if view is not None and view not in VIEWS:
        raise RecordError("unknown search view", code="invalid_search_view",
                          next_actions=["Choose knowledge, research, archive or a reported result scope."])
    mode = "research_id" if RESEARCH_ID.fullmatch(query) else "text"
    pattern = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(query) + r"(?![A-Za-z0-9_])",
                         re.IGNORECASE) if mode == "research_id" else None
    admitted = admissions(objects)
    expansions = _alias_expansions(objects, relations, admitted, query)
    results = []
    for obj in latest_objects(objects):
        if obj["kind"] in INTERNAL_KINDS and not include_archive:
            continue
        decision = admitted.get((obj["id"], obj["revision"]))
        is_knowledge = decision is not None and decision["body"].get("disposition") == "knowledge"
        if is_knowledge:
            result_view = "admitted_knowledge"
        elif obj["kind"] == "attempt":
            result_view = "research_decision"
        elif obj["kind"] == "run":
            result_view = "native_run_identity"
        elif include_archive:
            result_view = "legacy_archive"
        else:
            continue
        fields = READABLE_FIELDS | (ARCHIVE_FIELDS if include_archive else set())
        # Admission reviews a compact expression, not every historical sentence
        # in the referenced source. Original bytes remain accessible via show.
        searchable = decision["body"]["claim"] if is_knowledge else obj["body"]
        paths = list(_string_paths(searchable, fields, "claim" if is_knowledge else "body"))
        text = "\n".join(value for _, value in paths)
        identifiers = list(_declared_ids(obj))
        # Object IDs contain hash-based receipts and are not full-text fields.
        # Exact declared record IDs take precedence over textual references.
        direct = query.casefold() in {identity.casefold() for identity in identifiers}
        direct_object = query == obj["id"] and obj["kind"] in {"attempt", "run", "component", "material_section"}
        # Hash-derived custody IDs remain excluded from ordinary text search.
        direct_object = direct_object and not HASH.search(obj["id"])
        alias = next((item for item in searchable.get("aliases", [])
                      if isinstance(item, str) and item.casefold() == query.casefold()), None) \
            if is_knowledge and obj["kind"] == "component" else None
        direct = direct or direct_object
        related = expansions.get((obj["id"], obj["revision"]), [])
        matches = direct or alias is not None or bool(related) or (
            bool(pattern.search(text)) if pattern else query.casefold() in text.casefold())
        match_basis = "declared_id" if direct else "reviewed_alias" if alias else \
            "reviewed_mechanism_alias" if related else "reviewed_claim" if is_knowledge else "retained_record"
        reasons = [{"basis": "declared_id", "path": "body.declared_identity"}] if direct else []
        if alias is not None:
            reasons.append({"basis": "reviewed_alias", "path": "claim.aliases", "alias": alias,
                            "admission_ref": _ref(decision), "target_ref": _ref(obj),
                            "claim_scope": searchable.get("scope")})
        reasons.extend(related)
        reasons.extend({"basis": "reviewed_claim" if is_knowledge else "retained_record", "path": path}
                       for path, value in paths if (bool(pattern.search(value)) if pattern
                                                   else query.casefold() in value.casefold()))
        if not matches and include_archive and is_knowledge:
            retained_text = "\n".join(_strings(obj["body"], fields))
            matches = bool(pattern.search(retained_text)) if pattern else query.casefold() in retained_text.casefold()
            if matches:
                result_view, match_basis = "legacy_archive", "retained_source"
                reasons = [{"basis": "retained_source", "path": "body"}]
        if not matches:
            continue
        selected_purpose, purpose_basis = purpose_view(obj, knowledge=is_knowledge)
        if purpose is not None and selected_purpose != purpose:
            continue
        if outcome is not None and obj["body"].get("decision", {}).get("outcome") != outcome:
            continue
        allowed_views = {"knowledge": {"admitted_knowledge"},
                         "research": {"research_decision", "native_run_identity"},
                         "archive": {"legacy_archive"}}
        if view is not None and result_view not in allowed_views.get(view, {view}):
            continue
        result = {**_ref(obj), "kind": obj["kind"], "title": obj["body"].get("title"),
                  "source": obj["provenance"].get("path"), "scope": result_view,
                  "purpose": selected_purpose, "purpose_basis": purpose_basis,
                  "match_basis": match_basis,
                  "match_reasons": reasons[:16],
                  "knowledge_admission": admission_view(decision) if is_knowledge else None,
                  "corrections": corrections(obj, objects, relations),
                  "incoming_repairs": incoming_repairs(obj, objects, relations)}
        if is_knowledge:
            result["claim"] = decision["body"]["claim"]
        if obj["kind"] == "attempt":
            result.update({key: obj["body"][key] for key in ("question", "decision") if key in obj["body"]})
        # Failed and uncertain research decisions receive the same completion
        # priority as passed decisions; outcome is never a quality score.
        completed = obj["body"].get("decision", {}).get("outcome") not in {None, "pending"}
        relevant_decision = selected_purpose in {"research", "diagnostic", "source"} or \
            obj["body"].get("decision", {}).get("layer") == "economics"
        priority = 0 if direct else 1 if is_knowledge else 2 if relevant_decision and completed else 3
        results.append((priority, result))
    results.sort(key=lambda item: (item[0], item[1]["id"]))
    return {"query_mode": mode, "scope": "archive_included" if include_archive else "decisions_and_admitted_knowledge",
            "matches": [item for _, item in results]}
