"""Research metadata port; Dolt owns registrations and decision revisions.

Native account economics and sealed artifacts remain with their existing owners.
Each reader binds all metadata to one native commit before following relations.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from research.records.common import RecordError, _read_json, _validator
from research.records.dolt_store import DoltStore, ConflictError


DEFAULT_ROOT = Path.home() / ".local/share/trade/records"


def canonical(value):
    # JSON has one number type. Dolt emits integral JSON numbers as 25 instead
    # of 25.0; raw JSON formatting remains recoverable in provenance bytes.
    def normalize(item):
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, list):
            return [normalize(child) for child in item]
        return item
    return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def config_path():
    return Path(os.environ.get("TRADE_RECORDS_CONFIG", DEFAULT_ROOT / "backend.json")).expanduser()


def configuration():
    path = config_path()
    if not path.is_file():
        raise RecordError(f"Dolt is not configured: {path}; initialize the Dolt ledger")
    return _read_json(path)


def validate_record(kind, body):
    errors = sorted(_validator(kind).iter_errors(body), key=lambda error: str(error.path))
    if errors:
        error = errors[0]
        path = "/" + "/".join(str(part).replace("~", "~0").replace("/", "~1") for part in error.path)
        expected = error.schema.get("description") or f"{error.validator}: {error.validator_value}"
        raise RecordError(f"invalid {kind}: {list(error.path)}: {error.message}",
                          code="SCHEMA_VALIDATION", path=path, expected=str(expected)[:1024],
                          next_actions=["Read `contract " + kind + "` for the field contract. Repair the declared fact; do not fabricate evidence to satisfy a required field.",
                                        ("Use publish attempt --dry-run with the same payload before publication." if kind == "attempt"
                                         else "Verify the sealed result and submit its unchanged registration through the artifact register entry; do not edit native run facts to satisfy the schema.")],
                          write_status="not_written")


def _attempt_contract(body):
    """Only conclusions and attached evidence can change within one attempt."""
    return {key: value for key, value in body.items()
            if key not in ("decision", "evidence_refs", "comparison_family")}


def paired_control_relations(adapter, commit, body):
    """Read only the sealed candidate edge needed to derive its control."""
    basis = body.get("decision", {}).get("basis", {})
    if basis.get("mode") != "paired":
        return []
    ref = basis["candidate_run_ref"]
    return adapter.list_relations(commit=commit, kinds=("compared_with",),
                                  from_refs=((ref["id"], ref["revision"]),), include_body=False)


class _SelectedRecords:
    """Validate one fixed dependency graph without interpreting unrelated rows."""

    def __init__(self, adapter, commit):
        self.adapter, self.commit = adapter, commit
        self.objects, self.latest = {}, {}
        self.relations, self.outgoing = [], {}
        self.synthetic, self.bindings = None, {}

    def edges(self, obj):
        key = obj["id"], obj["revision"]
        if key not in self.outgoing:
            selected = self.adapter.list_relations(commit=self.commit, from_refs=(key,))
            self.outgoing[key] = selected
            self.remember(selected)
        return self.outgoing[key]

    def remember(self, selected):
        known = {edge["id"] for edge in self.relations}
        self.relations.extend(edge for edge in selected if edge["id"] not in known)

    def load(self, identity, revision=None):
        if self.synthetic is not None and identity == self.synthetic["id"] and revision is None:
            return self.synthetic
        key = (identity, revision)
        found = self.latest.get(identity) if revision is None else self.objects.get(key)
        if found is not None:
            return found
        obj = self.adapter.get_object(identity, revision=revision, commit=self.commit)
        if obj is None:
            raise RecordError(f"missing selected record: {identity}@{revision or 'latest'}")
        kind = identity.split(":", 1)[0]
        if kind not in ("attempt", "run") or obj["kind"] != kind:
            raise RecordError(f"selected record has wrong kind: {identity}@{obj['revision']}")
        try:
            validate_record(kind, obj["body"])
        except RecordError as exc:
            version = obj["body"].get("schema_version", "unknown") if isinstance(obj["body"], dict) else "unknown"
            version_schema = _validator(kind).schema["properties"]["schema_version"]
            supported = version_schema.get("enum", [version_schema.get("const")])
            raw_read = (f"uv run --frozen python -m research.records.cli --at {self.commit} "
                        f"material show {identity} --revision {obj['revision']}")
            raise RecordError(f"{identity}@{obj['revision']} schema_version={version} at {self.commit}: {exc}",
                              code="FIXED_DEPENDENCY_UNSUPPORTED" if version not in supported else exc.code,
                              path="/schema_version" if version not in supported else exc.path,
                              expected=f"supported {kind} versions: {supported}" if version not in supported else exc.expected,
                              next_actions=[raw_read, "This reads original material, not a valid preregistration. Preserve the fixed revision; do not substitute a newer source or downgrade the publication contract."],
                              write_status="not_written") from exc
        if obj["id"] != identity or obj["body"][kind + "_id"] != identity.removeprefix(kind + ":"):
            raise RecordError(f"object identity differs from body: {identity}")
        # Cache before following run_of/comparison_cell, which form a legitimate
        # graph cycle. Attempt ancestry cycles are checked separately below.
        self.objects[obj["id"], obj["revision"]] = obj
        if revision is None:
            self.latest[identity] = obj
        self.visit(obj)
        return obj

    def dependency(self, obj, kind, target, detail=None, label=None):
        if obj is self.synthetic:
            return self.load(target, self.bindings.get(target))
        edges = [edge for edge in self.edges(obj)
                 if edge["kind"] == kind and edge["to_id"] == target
                 and (detail is None or edge["body"].get("reference", edge["body"]) == detail)
                 and (label is None or edge["body"].get(label[0]) == label[1])]
        revisions = {edge["to_revision"] for edge in edges}
        if len(revisions) != 1:
            raise RecordError(f"missing or ambiguous fixed {kind} relation: {obj['id']}@{obj['revision']} -> {target}")
        return self.load(target, revisions.pop())

    def visit(self, obj):
        body = obj["body"]
        if obj["kind"] == "run":
            self.dependency(obj, "run_of", "attempt:" + body["attempt_id"])
            if body["control_run_id"]:
                self.dependency(obj, "compared_with", "run:" + body["control_run_id"])
            from research.records.contracts import validate_publication_contract
            validate_publication_contract("run", body, previous=obj, object_lookup=lambda id, rev: self.load(id, rev))
            return
        for ref in body["parents"] + body.get("mechanism_refs", []):
            self.dependency(obj, ref["relationship"], "attempt:" + ref["attempt_id"], detail=ref)
        if family := body.get("comparison_family"):
            attempts = {body["attempt_id"]: body}
            for role in ("origin", "factor_a", "factor_b"):
                selected = self.dependency(obj, "comparison_family", "attempt:" + family[role + "_attempt_id"],
                                           label=("role", role))
                attempts[selected["body"]["attempt_id"]] = selected["body"]
            runs = {}
            for cell, identity in family["cells"].items():
                selected = self.dependency(obj, "comparison_cell", "run:" + identity, label=("cell", cell))
                runs[identity] = selected["body"]
            from research.records.contracts import _check_family
            _check_family(body, family, attempts, runs)
        if body.get("schema_version") == 3:
            from research.records.contracts import validate_publication_contract
            self.remember(paired_control_relations(self.adapter, self.commit, body))

            def lookup(identity, revision):
                if identity.startswith(("attempt:", "run:")):
                    return self.load(identity, revision)
                return self.adapter.get_object(identity, revision=revision, commit=self.commit)

            validate_publication_contract("attempt", body, previous=obj,
                                          object_lookup=lookup, relations=self.relations)

    def check_ancestry(self):
        checked, active = set(), set()

        def visit(obj):
            key = obj["id"], obj["revision"]
            if key in active:
                raise RecordError(f"cycle in fixed attempt dependencies: {key}")
            if key in checked:
                return
            active.add(key)
            for ref in obj["body"]["parents"] + obj["body"].get("mechanism_refs", []):
                visit(self.dependency(obj, ref["relationship"], "attempt:" + ref["attempt_id"], detail=ref))
            active.remove(key)
            checked.add(key)

        for obj in list(self.objects.values()):
            if obj["kind"] == "attempt":
                visit(obj)
        if self.synthetic is not None and self.synthetic["kind"] == "attempt":
            visit(self.synthetic)

    def snapshot(self, roots):
        self.check_ancestry()
        # Flat DTOs serve existing show/compare helpers. Fixed validation never
        # uses these dictionaries: historical revisions remain in objects.
        visible = {}
        for obj in self.objects.values():
            previous = visible.get(obj["id"])
            if previous is None or obj["revision"] > previous["revision"]:
                visible[obj["id"]] = obj
        visible.update({obj["id"]: obj for obj in roots})
        attempts, runs = {}, {}
        revisions = {}
        for identity, revision in self.objects:
            revisions.setdefault(identity, []).append(revision)
        for obj in visible.values():
            (attempts if obj["kind"] == "attempt" else runs)[obj["body"][obj["kind"] + "_id"]] = obj["body"]
        return attempts, runs, {"backend": "dolt", "commit": self.commit,
                                "selected_revisions": {key: sorted(values) for key, values in revisions.items()}}


class DoltRecords:
    def __init__(self, config=None):
        self.adapter = DoltStore(configuration() if config is None else config)

    def snapshot(self, commit=None):
        status = self.adapter.status()
        fixed = commit or status["commit"]
        attempts, runs = {}, {}
        for kind in ("attempt", "run"):
            for obj in self.adapter.list_objects(kind=kind, commit=fixed):
                body = obj["body"]
                validate_record(kind, body)
                identity = body[f"{kind}_id"]
                if obj["id"] != f"{kind}:{identity}":
                    raise RecordError(f"object identity differs from body: {obj['id']}")
                (attempts if kind == "attempt" else runs)[identity] = body
        return attempts, runs, {"backend": "dolt", "commit": fixed}

    def selected_snapshot(self, *, attempt_ids=(), run_ids=(), commit=None, include_runs=True, revisions=None):
        """Validate only requested records and their exact stored dependencies.

        The returned flat dictionaries are a presentation view. This method
        validates fixed revisions internally; do not revalidate them as a
        latest-only graph with ``_validate_records``.
        """
        fixed = commit or self.adapter.status()["commit"]
        reader = _SelectedRecords(self.adapter, fixed)
        revisions = revisions or {}
        roots = [reader.load("attempt:" + identity, revisions.get("attempt:" + identity)) for identity in attempt_ids]
        roots.extend(reader.load("run:" + identity, revisions.get("run:" + identity)) for identity in run_ids)
        if include_runs:
            selected_attempts = {"attempt:" + identity for identity in attempt_ids}
            run_ids = {edge["from_id"] for edge in self.adapter.list_relations(
                commit=fixed, kinds=("run_of",),
                to_refs=tuple((identity, None) for identity in sorted(selected_attempts)), include_body=False)}
            roots.extend(reader.load(identity) for identity in sorted(run_ids))
        return reader.snapshot(roots)

    def find_snapshot(self, *, mechanism=None, layer=None, component=None, commit=None, purpose=None, outcome=None, family_id=None):
        """Filter raw candidates first, then expose each matching read failure."""
        fixed = commit or self.adapter.status()["commit"]
        component_ids = None
        if component:
            obj = self.adapter.get_object("component:" + component, commit=fixed)
            component_ids = {edge["to_id"] for edge in self.adapter.list_relations(
                commit=fixed, kinds=("component_index",),
                from_refs=((obj["id"], obj["revision"]),), include_body=False)} if obj else set()
        attempts, unreadable = {}, []
        for obj in self.adapter.list_objects(kind="attempt", commit=fixed):
            body = obj["body"]
            if component_ids is not None and obj["id"] not in component_ids:
                continue
            if mechanism and mechanism.casefold() not in str(body.get("mechanism", "")).casefold():
                continue
            if layer and layer != body.get("decision", {}).get("layer"):
                continue
            if purpose and purpose != body.get("purpose", "unknown"):
                continue
            if outcome and outcome != body.get("decision", {}).get("outcome"):
                continue
            if family_id and family_id != body.get("contract", {}).get("selection", {}).get("family_id"):
                continue
            try:
                reader = _SelectedRecords(self.adapter, fixed)
                selected = reader.load(obj["id"])
                reader.check_ancestry()
                attempts[obj["id"].removeprefix("attempt:")] = selected["body"]
            except RecordError as exc:
                unreadable.append({"id": obj["id"], "revision": obj["revision"],
                                   "schema_version": body.get("schema_version"), "error": str(exc)})
        return attempts, unreadable, {"backend": "dolt", "commit": fixed}

    def validate_dependencies(self, kind, body, *, commit=None, endpoint_revisions=None):
        """Validate an unpublished record against only its selected dependencies."""
        validate_record(kind, body)
        fixed = commit or self.adapter.status()["commit"]
        reader = _SelectedRecords(self.adapter, fixed)
        reader.synthetic = {"id": kind + ":" + body[kind + "_id"], "kind": kind,
                            "revision": 0, "body": body}
        reader.bindings = endpoint_revisions or {}
        reader.visit(reader.synthetic)
        reader.check_ancestry()
        return {"backend": "dolt", "commit": fixed}

    def registration_snapshot(self, attempt_id, binding=None, *, at=None):
        """Read the first API registration, independently of later conclusions."""
        identity = "attempt:" + attempt_id
        if binding is not None:
            if (not isinstance(binding, dict) or set(binding) != {"id", "revision", "commit"}
                    or binding["id"] != identity or type(binding["revision"]) is not int
                    or binding["revision"] != 1):
                raise RecordError("registration binding must identify the first attempt revision")
            if at is not None and at != binding["commit"]:
                raise RecordError("registration binding conflicts with the requested snapshot")
            fixed = binding["commit"]
        else:
            fixed = at or self.adapter.status()["commit"]
        obj = self.adapter.get_object(identity, revision=1, commit=fixed)
        if obj is None:
            raise RecordError(f"missing initial Dolt registration: {identity}")
        validate_record("attempt", obj["body"])
        body = obj["body"]
        if (obj["kind"] != "attempt" or obj["id"] != identity or body["attempt_id"] != attempt_id
                or body["registration"]["status"] != "preregistered"
                or body["decision"]["layer"] != "pending" or body["decision"]["outcome"] != "pending"):
            raise RecordError(f"initial attempt is not a pending Dolt preregistration: {identity}")
        operation = obj["provenance"].get("operation_id")
        if not isinstance(operation, str) or not operation:
            raise RecordError(f"initial registration lacks an API publication operation: {identity}")
        context_id = "publication:" + hashlib.sha256(operation.encode()).hexdigest()
        context = self.adapter.get_object(context_id, revision=1, commit=fixed)
        if (context is None or context["kind"] != "publication"
                or context["body"].get("record_id") != identity
                or context["body"].get("record_revision") != 1
                or context["provenance"].get("operation_id") != operation):
            raise RecordError(f"initial registration lacks its fixed publication receipt: {identity}")
        publication = self.adapter.operation_receipt(operation, commit=fixed)
        if publication is None:
            raise RecordError(f"initial registration operation is unavailable: {identity}")
        receipt = {"id": identity, "revision": 1, "commit": publication["commit"]}
        if binding is not None and binding != receipt:
            raise RecordError("registration binding differs from the first committed publication")
        original = self.adapter.get_object(identity, revision=1, commit=receipt["commit"])
        if original is None or canonical(original) != canonical(obj):
            raise RecordError("registration receipt does not contain the initial attempt")
        return body, receipt

    def _fixed_attempt_dependencies(self, previous, commit):
        """Carry the registered source revisions through later decisions."""
        references = previous["body"]["parents"] + previous["body"].get("mechanism_refs", [])
        expected = {(ref["relationship"], "attempt:" + ref["attempt_id"]) for ref in references}
        if not expected:
            return {}
        revisions = {key: set() for key in expected}
        for edge in self.adapter.list_relations(commit=commit,
                    from_refs=((previous["id"], previous["revision"]),), include_body=False):
            key = (edge["kind"], edge["to_id"])
            if (edge["from_id"] == previous["id"] and edge["from_revision"] == previous["revision"]
                    and key in revisions):
                revisions[key].add(edge["to_revision"])
        bindings = {}
        for (_, target), selected in revisions.items():
            if len(selected) != 1:
                raise RecordError(f"missing or ambiguous fixed attempt dependency: {target}")
            revision = next(iter(selected))
            if target in bindings and bindings[target] != revision:
                raise RecordError(f"inconsistent fixed attempt dependency: {target}")
            bindings[target] = revision
        return bindings

    def publish_record(self, kind, body, *, operation_id, expected_version, provenance=None,
                       endpoint_revisions=None, dry_run=False):
        if kind not in ("attempt", "run"):
            raise RecordError("record publications accept only attempt or run")
        if not isinstance(operation_id, str) or not operation_id or len(operation_id) > 160:
            raise RecordError("operation_id must be a nonempty string of at most 160 characters")
        validate_record(kind, body)
        if endpoint_revisions is not None and not isinstance(endpoint_revisions, dict):
            raise RecordError("endpoint_revisions must be a dictionary")
        requested_endpoints = {} if endpoint_revisions is None else dict(endpoint_revisions)
        if any(not isinstance(key, str) or type(value) is not int or value < 1
               for key, value in requested_endpoints.items()):
            raise RecordError("endpoint_revisions must map object ids to positive revisions")
        status = self.adapter.status()
        if status["dirty"]:
            raise RecordError("Dolt working set has unpublished SQL changes; resolve before publication")
        identity = f"{kind}:{body[f'{kind}_id']}"
        context_id = "publication:" + hashlib.sha256(operation_id.encode()).hexdigest()
        retained = self.adapter.get_object(context_id, commit=status["commit"])
        previous = None
        if retained is not None:
            context = retained
            details = context["body"]
            if details["record_id"] != identity or context["provenance"]["operation_id"] != operation_id:
                raise ConflictError("operation-content conflict: publication identity differs")
            base = details["base_commit"]
            bindings = details["endpoint_revisions"]
            if kind == "attempt":
                for reference in body["parents"] + body.get("mechanism_refs", []):
                    target = "attempt:" + reference["attempt_id"]
                    if target in bindings:
                        requested_endpoints.setdefault(target, bindings[target])
            if kind == "run":
                target = "attempt:" + body["attempt_id"]
                registered = self.adapter.get_object(target, commit=base)
                if registered and registered["body"]["registration"]["status"] == "preregistered":
                    requested_endpoints.setdefault(target, 1)
            if endpoint_revisions is not None and requested_endpoints != bindings:
                raise ConflictError("operation-content conflict: endpoint revisions differ")
            obj = self.adapter.get_object(identity, revision=details["record_revision"], commit=status["commit"])
            if obj is None or canonical(obj["body"]) != canonical(body):
                raise ConflictError("operation-content conflict: record body differs")
            requested_provenance = {**(provenance or {"origin": "agent_api"}), "operation_id": operation_id}
            if obj["provenance"].get("operation_id") == operation_id and canonical(obj["provenance"]) != canonical(requested_provenance):
                raise ConflictError("operation-content conflict: provenance differs")
            # Recover the original result before constructing new relation
            # projections. API upgrades must not change an existing receipt.
            result = self.adapter.operation_receipt(operation_id, commit=status["commit"])
            if result is None:
                raise RecordError("publication context exists without its operation receipt")
            result["replayed"] = True
            if kind == "attempt" and body["registration"]["status"] == "preregistered":
                _, result["registration_receipt"] = self.registration_snapshot(body["attempt_id"], at=result["commit"])
            if dry_run:
                result.update(dry_run=True, write_status="already_committed")
            return result
        else:
            base = status["commit"]
            bindings = requested_endpoints
            if kind == "run":
                target = "attempt:" + body["attempt_id"]
                registered = self.adapter.get_object(target, commit=base)
                if registered and registered["body"]["registration"]["status"] == "preregistered":
                    self.registration_snapshot(body["attempt_id"], at=base)
                    if bindings.get(target, 1) != 1:
                        raise RecordError("run_of must bind the initial preregistration revision 1")
                    bindings[target] = 1
            previous = self.adapter.get_object(identity, commit=base)
            if kind == "attempt":
                if previous:
                    if canonical(_attempt_contract(previous["body"])) != canonical(_attempt_contract(body)):
                        raise ConflictError(
                            "an attempt revision cannot rewrite its original registration contract; use a new attempt ID",
                            code="FROZEN_ATTEMPT_CONTRACT", path="/contract",
                            expected="the unchanged initial research intent and registration",
                            next_actions=["Read the fixed initial attempt. Keep its question, plan and selection context intact; publish a new pending attempt before inspecting new results when the research intent changes."],
                            write_status="not_written",
                        )
                    for target, revision in self._fixed_attempt_dependencies(previous, base).items():
                        if bindings.get(target, revision) != revision:
                            raise ConflictError(
                                f"an attempt revision cannot rebind its fixed dependency: {target}@{revision}; use a new attempt ID for new dependencies",
                                code="FROZEN_ATTEMPT_DEPENDENCY", path="/endpoint_revisions",
                                expected={target: revision},
                                next_actions=["Retain the original fixed source revision. Register a new attempt for changed derivation or component evidence; do not replace historical dependencies with latest."],
                                write_status="not_written",
                            )
                        bindings[target] = revision
                    if body["registration"]["status"] == "preregistered":
                        self.registration_snapshot(body["attempt_id"], at=base)
                elif body["registration"]["status"] == "preregistered":
                    if body["decision"]["layer"] != "pending" or body["decision"]["outcome"] != "pending":
                        raise RecordError("first preregistered attempt must have a pending/pending decision")
            if kind == "run" and previous is not None:
                if canonical(previous["body"]) != canonical(body):
                    raise ConflictError(f"a sealed run ID is immutable: {identity}; use a new run ID")
                obj = previous
            else:
                obj = {"id": identity, "kind": kind, "revision": 1 if previous is None else previous["revision"] + 1,
                       "body": body, "provenance": {**(provenance or {"origin": "agent_api"}), "operation_id": operation_id}}
            context = {"id": context_id, "kind": "publication", "revision": 1,
                       "body": {"record_id": identity, "record_revision": obj["revision"],
                                "base_commit": base, "endpoint_revisions": bindings},
                       "provenance": {"operation_id": operation_id}}
        from research.records.contracts import validate_publication_contract, publication_context_refs
        fixed_relations = paired_control_relations(self.adapter, base, body)
        lookup = lambda id, revision: self.adapter.get_object(id, revision=revision, commit=base)
        if retained is None:
            validate_publication_contract(kind, body, previous=previous, object_lookup=lookup, relations=fixed_relations)
        self.validate_dependencies(kind, body, commit=base, endpoint_revisions=bindings)
        objects, related = {identity: obj, context_id: context}, []

        strategy_binding = body.get("strategy_binding")
        if strategy_binding:
            from research.records.strategies import validate_binding
            validate_binding(self.adapter, strategy_binding)

        def endpoint(target):
            if target in objects:
                return objects[target]
            value = self.adapter.get_object(target, revision=bindings.get(target), commit=base)
            if value is None:
                raise RecordError(f"missing fixed relation endpoint {target}@{bindings.get(target, 'latest')}")
            return value

        def derived(target, object_kind, value, locator):
            if target in objects:
                return objects[target]
            previous = self.adapter.get_object(target, commit=base)
            if previous:
                if previous["kind"] != object_kind or canonical(previous["body"]) != canonical(value):
                    raise ConflictError(f"derived record identity conflict: {target}")
                objects[target] = previous
            else:
                objects[target] = {"id": target, "kind": object_kind, "revision": 1, "body": value,
                                   "provenance": {"origin": "declared_record_index", "record_id": identity,
                                                  "locator": locator}}
            return objects[target]

        def edge(relation_kind, source, target, detail):
            relation = {"kind": relation_kind, "from_id": source["id"], "from_revision": source["revision"],
                        "from_kind": source["kind"], "to_id": target["id"], "to_revision": target["revision"],
                        "to_kind": target["kind"], "body": detail}
            relation["id"] = "edge:" + hashlib.sha256(canonical(relation).encode()).hexdigest()
            related.append(relation)

        def file_ref(reference, field):
            value = {"target": reference["path"], "path": reference["path"],
                     "declared_sha256": reference.get("sha256"), "category": "file_evidence"}
            target = derived("reference:" + hashlib.sha256(canonical(value).encode()).hexdigest(),
                             "reference", value, field)
            edge("evidence_ref", obj, target, {"field": field, "reference": reference})

        if strategy_binding:
            target = self.adapter.get_object(
                "strategy:" + strategy_binding["strategy_id"],
                revision=strategy_binding["revision"], commit=strategy_binding["commit"],
            )
            edge("uses_strategy", obj, target, {"binding": strategy_binding})

        if kind == "attempt":
            for role, reference in publication_context_refs(body, relations=fixed_relations):
                target = lookup(reference["id"], reference["revision"])
                if target is None:
                    raise RecordError(f"missing fixed publication evidence: {reference}",
                                      code="FIXED_REFERENCE_UNAVAILABLE", write_status="not_written")
                edge("known_exposure" if role == "known_exposure" else "decision_basis", obj, target, {"role": role})
            for index, parent in enumerate(body["parents"]):
                edge(parent["relationship"], obj, endpoint("attempt:" + parent["attempt_id"]),
                     {"field": f"/parents/{index}", "reference": parent})
            for index, reference in enumerate(body.get("mechanism_refs", [])):
                target = endpoint("attempt:" + reference["attempt_id"])
                field = f"/mechanism_refs/{index}"
                edge(reference["relationship"], obj, target,
                     {"field": field, "reference": reference})
                component = derived("component:" + reference["component"], "component",
                                    {"name": reference["component"]}, field + "/component")
                for selected in (obj, target):
                    edge("component_index", component, selected,
                         {"field": field + "/component", "boundary": reference["boundary"]})
            family = body.get("comparison_family")
            if family:
                for role in ("origin", "factor_a", "factor_b"):
                    edge("comparison_family", obj, endpoint("attempt:" + family[role + "_attempt_id"]),
                         {"role": role, "family_id": family["family_id"]})
                for cell, run in family["cells"].items():
                    edge("comparison_cell", obj, endpoint("run:" + run),
                         {"cell": cell, "family_id": family["family_id"]})
                file_ref(family["analysis_ref"], "/comparison_family/analysis_ref")
            for index, reference in enumerate(body["evidence_refs"]):
                file_ref(reference, f"/evidence_refs/{index}")
        else:
            edge("run_of", obj, endpoint("attempt:" + body["attempt_id"]),
                 {"field": "/attempt_id"})
            if body["control_run_id"]:
                edge("compared_with", obj, endpoint("run:" + body["control_run_id"]),
                     {"field": "/control_run_id"})
            for field in ("summary_ref", "audit_ref", "artifact_manifest_ref"):
                if field in body:
                    file_ref(body[field], "/" + field)
        if dry_run:
            if retained is None and status["version"] != expected_version:
                raise ConflictError(f"expected-version conflict: expected {expected_version}, observed {status['version']}",
                                    code="EXPECTED_VERSION_CONFLICT", path="/expected_version",
                                    expected=status["version"], write_status="not_written",
                                    next_actions=["Read the current ledger status and recheck your payload against that snapshot before publishing."])
            return {"dry_run": True, "write_status": "not_written", "commit": status["commit"],
                    "version": status["version"], "operation_id": operation_id,
                    "record": {"id": identity, "revision": obj["revision"]},
                    "objects": len(objects), "relations": len(related)}
        result = self.adapter.publish(list(objects.values()), related, operation_id, expected_version, f"publish {identity}")
        if kind == "attempt" and body["registration"]["status"] == "preregistered":
            if obj["revision"] == 1:
                receipt = {"id": identity, "revision": 1, "commit": result["commit"]}
            else:
                _, receipt = self.registration_snapshot(body["attempt_id"], at=result["commit"])
            result["registration_receipt"] = receipt
        return result


def open_store():
    return DoltRecords()
