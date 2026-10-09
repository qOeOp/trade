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
        raise RecordError(f"invalid {kind}: {list(errors[0].path)}: {errors[0].message}")


def _attempt_contract(body):
    """Only conclusions and attached evidence can change within one attempt."""
    return {key: value for key, value in body.items()
            if key not in ("decision", "evidence_refs", "comparison_family")}


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
        for edge in self.adapter.list_relations(commit=commit):
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
                       endpoint_revisions=None):
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
                        raise ConflictError("an attempt revision cannot rewrite its original registration contract; use a new attempt ID")
                    for target, revision in self._fixed_attempt_dependencies(previous, base).items():
                        if bindings.get(target, revision) != revision:
                            raise ConflictError(f"an attempt revision cannot rebind its fixed dependency: {target}@{revision}; use a new attempt ID for new dependencies")
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
        attempts, runs, _ = self.snapshot(base)
        (attempts if kind == "attempt" else runs)[body[f"{kind}_id"]] = body
        from research.records.contracts import _validate_records
        _validate_records(attempts, runs)
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
            edge("evidence_ref", obj, target, {"field": field, "reference": reference, "source": obj["provenance"]})

        if strategy_binding:
            target = self.adapter.get_object(
                "strategy:" + strategy_binding["strategy_id"],
                revision=strategy_binding["revision"], commit=strategy_binding["commit"],
            )
            edge("uses_strategy", obj, target, {"binding": strategy_binding})

        if kind == "attempt":
            for index, parent in enumerate(body["parents"]):
                edge(parent["relationship"], obj, endpoint("attempt:" + parent["attempt_id"]),
                     {"field": f"/parents/{index}", "reference": parent, "source": obj["provenance"]})
            for index, reference in enumerate(body.get("mechanism_refs", [])):
                target = endpoint("attempt:" + reference["attempt_id"])
                field = f"/mechanism_refs/{index}"
                edge(reference["relationship"], obj, target,
                     {"field": field, "reference": reference, "source": obj["provenance"]})
                component = derived("component:" + reference["component"], "component",
                                    {"name": reference["component"]}, field + "/component")
                for selected in (obj, target):
                    edge("component_index", component, selected,
                         {"field": field + "/component", "boundary": reference["boundary"], "source": obj["provenance"]})
            family = body.get("comparison_family")
            if family:
                for role in ("origin", "factor_a", "factor_b"):
                    edge("comparison_family", obj, endpoint("attempt:" + family[role + "_attempt_id"]),
                         {"role": role, "family_id": family["family_id"], "source": obj["provenance"]})
                for cell, run in family["cells"].items():
                    edge("comparison_cell", obj, endpoint("run:" + run),
                         {"cell": cell, "family_id": family["family_id"], "source": obj["provenance"]})
                file_ref(family["analysis_ref"], "/comparison_family/analysis_ref")
            for index, reference in enumerate(body["evidence_refs"]):
                file_ref(reference, f"/evidence_refs/{index}")
        else:
            edge("run_of", obj, endpoint("attempt:" + body["attempt_id"]),
                 {"field": "/attempt_id", "source": obj["provenance"]})
            if body["control_run_id"]:
                edge("compared_with", obj, endpoint("run:" + body["control_run_id"]),
                     {"field": "/control_run_id", "source": obj["provenance"]})
            for field in ("summary_ref", "audit_ref", "artifact_manifest_ref"):
                if field in body:
                    file_ref(body[field], "/" + field)
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
