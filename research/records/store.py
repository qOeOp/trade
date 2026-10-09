"""Research metadata port; Dolt owns current records, Git is explicit history.

Native account economics and sealed artifacts remain with their existing owners.
Each reader binds all metadata to one native commit before following relations.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess

from research.records.common import ROOT, RECORDS, RecordError, _read_json, _validator
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
        raise RecordError(f"Dolt is not configured: {path}; initialize ledger or explicitly select --backend git for read-only history")
    return _read_json(path)


def validate_record(kind, body):
    errors = sorted(_validator(kind).iter_errors(body), key=lambda error: str(error.path))
    if errors:
        raise RecordError(f"invalid {kind}: {list(errors[0].path)}: {errors[0].message}")


def _preregistration_receipt(body, receipt_path):
    """Freeze prospective intent in Dolt, or verify an original Git receipt."""
    registration = body["registration"]
    if body["decision"]["layer"] != "pending" or body["decision"]["outcome"] != "pending":
        raise RecordError("first preregistered attempt must have a pending/pending decision")
    if registration.get("backend") == "dolt":
        if receipt_path is not None or "original_registration_commit" in registration:
            raise RecordError("Dolt preregistration cannot claim a Git receipt")
        if registration["reference"] != f"dolt:attempt:{body['attempt_id']}@1":
            raise RecordError("Dolt preregistration must identify its immutable first attempt revision")
        return
    if receipt_path is None:
        raise RecordError("first preregistered attempt requires a committed receipt_path")
    root = ROOT.resolve()
    receipt = Path(receipt_path).resolve()
    if not receipt.is_relative_to(root) or not receipt.is_file():
        raise RecordError("preregistration receipt must be a file inside the repository")
    relative = receipt.relative_to(root).as_posix()
    commit = registration.get("original_registration_commit")
    if not isinstance(commit, str) or not commit:
        raise RecordError("preregistration requires an original_registration_commit")

    def git(*args):
        result = subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)
        if result.returncode:
            raise RecordError("preregistration receipt or original reference is not committed")
        return result.stdout

    if git("cat-file", "-t", commit).strip() != b"commit":
        raise RecordError("original preregistration reference is not a Git commit")
    reference = Path(registration["reference"])
    if reference.is_absolute() or ".." in reference.parts:
        raise RecordError("preregistration reference must be a repository path")
    if reference.as_posix() != relative:
        raise RecordError("new preregistration reference must point to its single JSON receipt")
    if git("cat-file", "-t", f"{commit}:{reference.as_posix()}").strip() != b"blob":
        raise RecordError("preregistration reference must exist at its original Git commit")
    if reference.as_posix() == relative:
        # A one-file receipt may add its first commit's identity in a second
        # commit; it may not change the registered intent in that step.
        try:
            original = json.loads(git("show", f"{commit}:{relative}"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RecordError("original preregistration receipt must contain JSON") from exc
        without_anchor = json.loads(json.dumps(body))
        without_anchor["registration"].pop("original_registration_commit", None)
        if canonical(original) != canonical(without_anchor):
            raise RecordError("original preregistration intent changed; only its commit anchor may be added")
    committed = git("show", f"HEAD:{relative}")
    if committed != receipt.read_bytes():
        raise RecordError("preregistration receipt must be committed unchanged at HEAD")
    try:
        retained = json.loads(committed)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RecordError("preregistration receipt must contain the published JSON body") from exc
    if canonical(retained) != canonical(body):
        raise RecordError("preregistration receipt JSON differs from the published body")


class GitHistoryStore:
    """Read retained JSON receipts; never accept a metadata write."""

    def snapshot(self, commit=None):
        if commit is not None:
            raise RecordError("--at is a Dolt commit; Git history uses its fixed archive index or explicit checkout")
        from research.records.history import load_archive
        archive = load_archive(ROOT)
        collections = []
        for kind in ("attempt", "run"):
            found = {}
            if archive:
                paths = [Path(path) for path in archive.paths(f"research/records/{kind}s/")
                         if len(Path(path).parts) == 5 and path.endswith(f"/{kind}.json")]
            else:
                paths = sorted((RECORDS / f"{kind}s").glob(f"*/{kind}.json"))
            for path in paths:
                if archive:
                    try:
                        body = json.loads(archive.read_bytes(path.as_posix()))
                    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                        raise RecordError(f"invalid archived {kind} JSON: {path}") from exc
                else:
                    body = _read_json(path)
                validate_record(kind, body)
                identity = body[f"{kind}_id"]
                if identity != path.parent.name or identity in found:
                    raise RecordError(f"invalid or duplicated identity: {path}")
                found[identity] = body
            collections.append(found)
        return (*collections, {"backend": "git", "read_only": True,
                              **({"git_commit": archive.commit} if archive else {})})

    def publish_record(self, *args, **kwargs):
        raise RecordError("Git metadata is read-only; publications require Dolt")


class DoltRecords:
    def __init__(self, config=None):
        self.adapter = DoltStore(configuration() if config is None else config)

    def snapshot(self, commit=None):
        status = self.adapter.status()
        fixed = commit or status["commit"]
        attempts, runs = {}, {}
        for obj in self.adapter.list_objects(commit=fixed):
            if obj["kind"] not in ("attempt", "run"):
                continue
            kind, body = obj["kind"], obj["body"]
            validate_record(kind, body)
            identity = body[f"{kind}_id"]
            if obj["id"] != f"{kind}:{identity}":
                raise RecordError(f"object identity differs from body: {obj['id']}")
            (attempts if kind == "attempt" else runs)[identity] = body
        return attempts, runs, {"backend": "dolt", "commit": fixed}

    def publish_record(self, kind, body, *, operation_id, expected_version, provenance=None,
                       receipt_path=None, endpoint_revisions=None):
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
            previous = self.adapter.get_object(identity, commit=base)
            if kind == "attempt" and previous and previous["body"]["registration"] != body["registration"]:
                raise ConflictError("an attempt revision cannot rewrite its original registration")
            if kind == "attempt" and previous and previous["body"].get("strategy_binding") != body.get("strategy_binding"):
                raise ConflictError("an attempt revision cannot rewrite its registered strategy binding")
            if kind == "attempt" and previous is None and body["registration"]["status"] == "preregistered":
                _preregistration_receipt(body, receipt_path)
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
        return self.adapter.publish(list(objects.values()), related, operation_id, expected_version, f"publish {identity}")


def open_store(backend=None):
    choice = backend or os.environ.get("TRADE_RECORDS_BACKEND", "dolt")
    if choice == "git":
        return GitHistoryStore()
    if choice == "dolt":
        return DoltRecords()
    raise RecordError(f"unknown research record backend: {choice}")
