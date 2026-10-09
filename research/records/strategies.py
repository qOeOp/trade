"""Complete strategy source revisions in the existing append-only Dolt store.

This API publishes bytes and fixed lineage. It does not import strategy code,
run experiments, infer inheritance, or qualify a strategy.
"""

from __future__ import annotations

import ast
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re

from research.records.common import RecordError
from research.records.dolt_store import ConflictError
from research.records.store import canonical


RUNTIME_CONTRACTS = {"r1-native-v1", "r1-native-v2"}
STATUSES = {"research", "retired", "archived"}
BINDING_FIELDS = {"database", "commit", "strategy_id", "revision", "source_sha256",
                  "entry_class", "runtime_contract"}
ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\Z")
COMMIT = re.compile(r"[0-9a-v]{32}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
MAX_SOURCE_BYTES = 8 * 1024 * 1024


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _id(value, name):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise RecordError(f"{name} must use 1 to 100 letters, digits, dots, underscores or hyphens")
    return value


def _revision(value):
    if type(value) is not int or not 1 <= value <= 2147483647:
        raise RecordError("revision must be a positive SQL INT")
    return value


def _text(value, name, limit=10000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise RecordError(f"{name} must be nonempty text of at most {limit} characters")
    return value


def _metadata(value):
    if not isinstance(value, dict):
        raise RecordError("strategy metadata must be an object")
    required = {"strategy_id", "family_id", "description", "entry_class", "runtime_contract", "status"}
    allowed = required | {"schema_version", "parents", "attempt_refs", "legacy_git"}
    if not required <= value.keys() or value.keys() - allowed:
        raise RecordError("strategy metadata has missing or unknown fields")
    if type(value.get("schema_version", 1)) is not int or value.get("schema_version", 1) != 1:
        raise RecordError("strategy schema_version must be 1")
    result = {"schema_version": 1,
              "strategy_id": _id(value["strategy_id"], "strategy_id"),
              "family_id": _id(value["family_id"], "family_id"),
              "description": _text(value["description"], "description"),
              "entry_class": _text(value["entry_class"], "entry_class", 100),
              "runtime_contract": value["runtime_contract"], "status": value["status"]}
    if not result["entry_class"].isidentifier():
        raise RecordError("entry_class must be a Python class identifier")
    if result["runtime_contract"] not in RUNTIME_CONTRACTS:
        raise RecordError(f"unsupported runtime contract: {result['runtime_contract']}")
    if not isinstance(result["status"], str) or result["status"] not in STATUSES:
        raise RecordError("strategy status must be research, retired or archived")
    for field, identity, extra in (("parents", "strategy_id", "difference"),
                                   ("attempt_refs", "attempt_id", None)):
        items = value.get(field, [])
        if not isinstance(items, list):
            raise RecordError(f"{field} must be an array")
        normalized, seen = [], set()
        for item in items:
            fields = {identity, "revision"} | ({extra} if extra else set())
            if not isinstance(item, dict) or set(item) != fields:
                raise RecordError(f"{field} requires exact identities and fixed revisions")
            ref = {identity: _id(item[identity], identity), "revision": _revision(item["revision"])}
            if extra:
                ref[extra] = _text(item[extra], extra)
                if ref[identity] == result["strategy_id"]:
                    raise RecordError("strategy parents cannot reference the same strategy identity")
            key = (ref[identity], ref["revision"])
            if key in seen:
                raise RecordError(f"duplicate fixed reference in {field}")
            seen.add(key)
            normalized.append(ref)
        result[field] = normalized
    if "legacy_git" in value:
        legacy = value["legacy_git"]
        if not isinstance(legacy, dict) or set(legacy) != {"commit", "path", "sha256"}:
            raise RecordError("legacy_git requires commit, path and sha256")
        if not isinstance(legacy["commit"], str) or not re.fullmatch(r"[0-9a-f]{40}", legacy["commit"]):
            raise RecordError("legacy_git commit must be an exact Git SHA-1")
        path = legacy["path"]
        if (not isinstance(path, str) or not path or PurePosixPath(path).is_absolute()
                or ".." in PurePosixPath(path).parts or PurePosixPath(path).as_posix() != path
                or any(ord(char) < 32 for char in path)):
            raise RecordError("legacy_git path must be a relative repository path")
        if not isinstance(legacy["sha256"], str) or not SHA256.fullmatch(legacy["sha256"]):
            raise RecordError("legacy_git sha256 must be exact")
        result["legacy_git"] = dict(legacy)
    return result


def _source(raw, entry_class):
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_SOURCE_BYTES:
        raise RecordError("strategy source must contain 1 to 8388608 bytes")
    try:
        text = raw.decode("utf-8")
        tree = ast.parse(text, filename="<strategy>")
        compile(tree, "<strategy>", "exec")
    except (UnicodeDecodeError, SyntaxError, ValueError) as exc:
        raise RecordError(f"strategy source must be valid UTF-8 Python: {exc}") from exc
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == entry_class]
    if len(classes) != 1:
        raise RecordError("entry_class must name exactly one top-level class in the strategy source")
    return {"content_base64": base64.b64encode(raw).decode("ascii"),
            "sha256": _sha(raw), "byte_length": len(raw), "encoding": "utf-8", "language": "python"}


def _object_source(obj):
    if not isinstance(obj, dict) or obj.get("kind") != "strategy" or not isinstance(obj.get("body"), dict):
        raise RecordError("object is not a strategy revision")
    body = obj["body"]
    metadata = _metadata({key: value for key, value in body.items() if key != "source"})
    if obj.get("id") != "strategy:" + metadata["strategy_id"]:
        raise RecordError("strategy identity differs from its object")
    _revision(obj.get("revision"))
    payload = body.get("source")
    if not isinstance(payload, dict):
        raise RecordError("strategy source payload is missing")
    try:
        raw = base64.b64decode(payload["content_base64"], validate=True)
    except (KeyError, TypeError, ValueError) as exc:
        raise RecordError("strategy source base64 is invalid") from exc
    expected = _source(raw, metadata["entry_class"])
    if canonical(payload) != canonical(expected):
        raise RecordError("strategy source byte length, hash or encoding differs")
    legacy = metadata.get("legacy_git")
    if legacy and legacy["sha256"] != expected["sha256"]:
        raise RecordError("legacy Git source hash differs from the retained exact bytes")
    return raw


def _fixed(adapter, at):
    if at is None:
        at = adapter.status()["commit"]
    if not isinstance(at, str) or not COMMIT.fullmatch(at):
        raise RecordError("strategy reads require an exact 32-character Dolt commit")
    return at


def _binding(adapter, obj, commit):
    body = obj["body"]
    return {"database": adapter.database, "commit": commit,
            "strategy_id": body["strategy_id"], "revision": obj["revision"],
            "source_sha256": body["source"]["sha256"], "entry_class": body["entry_class"],
            "runtime_contract": body["runtime_contract"]}


def resolve(adapter, strategy_id, revision=None, at=None):
    """Read exact source bytes and their immutable binding at one snapshot."""
    strategy_id = _id(strategy_id, "strategy_id")
    if revision is not None:
        _revision(revision)
    fixed = _fixed(adapter, at)
    obj = adapter.get_object("strategy:" + strategy_id, revision=revision, commit=fixed)
    if obj is None:
        raise RecordError(f"unknown strategy revision: {strategy_id}@{revision or 'latest'}")
    raw = _object_source(obj)
    return {"binding": _binding(adapter, obj, fixed), "object": obj, "source_bytes": raw}


def validate_binding(adapter, binding):
    """Verify the exact bound object and source bytes, never a latest alias."""
    if not isinstance(binding, dict) or set(binding) != BINDING_FIELDS:
        raise RecordError("strategy binding has missing or unknown fields")
    if binding["database"] != adapter.database:
        raise RecordError("strategy binding belongs to a different Dolt database")
    value = resolve(adapter, binding["strategy_id"], _revision(binding["revision"]), binding["commit"])
    if canonical(value["binding"]) != canonical(binding):
        raise RecordError("strategy binding differs from its fixed Dolt source revision")
    return value


def export(adapter, strategy_id, destination, revision=None, at=None, binding_output=None):
    """Export byte-identical source to a new working file, refusing overwrite."""
    value = resolve(adapter, strategy_id, revision, at)
    path = Path(destination).expanduser().absolute()
    outputs = [(path, value["source_bytes"])]
    if binding_output is not None:
        binding_path = Path(binding_output).expanduser().absolute()
        if binding_path.resolve() == path.resolve():
            raise RecordError("strategy source and binding destinations must differ")
        outputs.append((binding_path, (json.dumps(value["binding"], ensure_ascii=False, indent=2) + "\n").encode("utf-8")))
    for target_path, _ in outputs:
        if target_path.exists() or target_path.is_symlink():
            raise RecordError(f"strategy export destination exists: {target_path}")
    created = []
    try:
        for target_path, raw in outputs:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with target_path.open("xb") as target:
                created.append(target_path)
                target.write(raw)
                target.flush()
                os.fsync(target.fileno())
        if _sha(path.read_bytes()) != value["binding"]["source_sha256"]:
            raise RecordError("exported strategy hash differs")
    except (OSError, RecordError) as exc:
        for target_path in created:
            target_path.unlink(missing_ok=True)
        raise RecordError(f"strategy export failed: {exc}") from exc
    return {**value["binding"], "destination": str(path),
            **({"binding_output": str(binding_path)} if binding_output is not None else {})}


def _edges(obj):
    edges = []
    for ref in obj["body"]["parents"]:
        edges.append(("strategy_parent", "strategy:" + ref["strategy_id"], ref["revision"], ref))
    for ref in obj["body"]["attempt_refs"]:
        edges.append(("strategy_attempt", "attempt:" + ref["attempt_id"], ref["revision"], ref))
    return edges


def _lineage(adapter, obj, fixed, relations, seen=frozenset()):
    _object_source(obj)
    key = (obj["id"], obj["revision"])
    if key in seen:
        raise RecordError(f"cycle in fixed strategy lineage: {key}")
    actual = [edge for edge in relations if
              (edge["from_id"], edge["from_revision"]) == key and
              edge["kind"] in {"strategy_parent", "strategy_attempt"}]
    parents, attempts = [], []
    expected = _edges(obj)
    if len(actual) != len(expected):
        raise RecordError(f"missing or unexpected fixed strategy relations: {key}")
    for kind, identity, revision, reference in expected:
        matching = [edge for edge in actual if (edge["kind"], edge["to_id"], edge["to_revision"]) ==
                    (kind, identity, revision) and edge["from_kind"] == "strategy" and
                    edge["to_kind"] == ("strategy" if kind == "strategy_parent" else "attempt") and
                    canonical(edge["body"]) == canonical(reference)]
        if len(matching) != 1:
            raise RecordError(f"missing or ambiguous fixed strategy endpoint: {identity}@{revision}")
        target = adapter.get_object(identity, revision=revision, commit=fixed)
        if target is None or target["kind"] != matching[0]["to_kind"]:
            raise RecordError(f"fixed strategy endpoint is unavailable: {identity}@{revision}")
        if kind == "strategy_parent":
            _object_source(target)
            if target["body"]["family_id"] != obj["body"]["family_id"]:
                raise RecordError("a strategy parent must belong to the declared family")
            parents.append({"difference": reference["difference"],
                            "strategy": _lineage(adapter, target, fixed, relations, seen | {key})})
        else:
            if target["body"].get("attempt_id") != reference["attempt_id"]:
                raise RecordError("attempt identity differs from the fixed attempt object")
            attempts.append(dict(reference))
    return {"binding": _binding(adapter, obj, fixed), "family_id": obj["body"]["family_id"],
            "description": obj["body"]["description"], "status": obj["body"]["status"],
            "attempt_refs": attempts, "parents": parents}


def lineage(adapter, strategy_id, revision=None, at=None):
    value = resolve(adapter, strategy_id, revision, at)
    fixed = value["binding"]["commit"]
    return _lineage(adapter, value["object"], fixed, adapter.list_relations(commit=fixed))


def publish(adapter, metadata, source_path, operation_id, expected_version):
    """Append a source revision and fixed lineage using the existing writer."""
    metadata = _metadata(metadata)
    if not isinstance(operation_id, str) or not operation_id or len(operation_id) > 160:
        raise RecordError("operation_id must be nonempty text of at most 160 characters")
    if type(expected_version) is not int or expected_version < 0:
        raise RecordError("expected_version must be a nonnegative integer")
    try:
        raw = Path(source_path).read_bytes()
    except OSError as exc:
        raise RecordError(f"strategy source is unavailable: {exc}") from exc
    body = {**metadata, "source": _source(raw, metadata["entry_class"])}
    digest = _sha(canonical(body).encode("utf-8"))
    status = adapter.status()
    if status["dirty"]:
        raise RecordError("Dolt working set has unpublished SQL changes; resolve before publication")
    identity = "strategy:" + metadata["strategy_id"]
    context_id = "strategy-publication:" + _sha(operation_id.encode("utf-8"))
    retained = adapter.get_object(context_id, commit=status["commit"])
    if retained:
        details = retained["body"]
        if (retained["kind"] != "publication" or details.get("record_id") != identity
                or details.get("request_sha256") != digest
                or retained["provenance"].get("operation_id") != operation_id):
            raise ConflictError("operation-content conflict: strategy publication differs")
        fixed = details["base_commit"]
        obj = adapter.get_object(identity, revision=details["record_revision"], commit=status["commit"])
        if obj is None or canonical(obj["body"]) != canonical(body):
            raise ConflictError("operation-content conflict: strategy source revision differs")
        context = retained
    else:
        fixed = status["commit"]
        previous = adapter.get_object(identity, commit=fixed)
        if previous:
            _object_source(previous)
            if previous["body"]["family_id"] != metadata["family_id"]:
                raise ConflictError("strategy family_id is immutable; publish a new strategy identity")
        obj = {"id": identity, "kind": "strategy", "revision": previous["revision"] + 1 if previous else 1,
               "body": body, "provenance": {"origin": "strategy_publication", "operation_id": operation_id}}
        context = {"id": context_id, "kind": "publication", "revision": 1,
                   "body": {"record_id": identity, "record_revision": obj["revision"],
                            "base_commit": fixed, "request_sha256": digest},
                   "provenance": {"operation_id": operation_id}}
    _object_source(obj)
    relations = []
    existing = adapter.list_relations(commit=fixed)
    for kind, target_id, target_revision, reference in _edges(obj):
        target = adapter.get_object(target_id, revision=target_revision, commit=fixed)
        expected_kind = "strategy" if kind == "strategy_parent" else "attempt"
        if target is None or target["kind"] != expected_kind:
            raise RecordError(f"fixed strategy endpoint is unavailable: {target_id}@{target_revision}")
        if kind == "strategy_parent":
            _lineage(adapter, target, fixed, existing)
            if target["body"]["family_id"] != metadata["family_id"]:
                raise RecordError("a strategy parent must belong to the declared family")
        elif target["body"].get("attempt_id") != reference["attempt_id"]:
            raise RecordError("attempt identity differs from the fixed attempt object")
        edge = {"kind": kind, "from_id": identity, "from_revision": obj["revision"],
                "from_kind": "strategy", "to_id": target_id, "to_revision": target_revision,
                "to_kind": expected_kind, "body": reference}
        edge["id"] = "edge:" + _sha(canonical(edge).encode("utf-8"))
        relations.append(edge)
    result = adapter.publish([obj, context], relations, operation_id, expected_version, f"publish {identity}")
    checked = resolve(adapter, metadata["strategy_id"], obj["revision"], result["commit"])
    return {**result, "binding": checked["binding"]}


def list_strategies(adapter, at=None, family_id=None, status=None, all_revisions=False):
    fixed = _fixed(adapter, at)
    if family_id is not None:
        _id(family_id, "family_id")
    if status is not None and status not in STATUSES:
        raise RecordError("unknown strategy status")
    result = []
    for obj in adapter.list_objects(kind="strategy", commit=fixed, latest=not all_revisions):
        _object_source(obj)
        body = obj["body"]
        if family_id is not None and body["family_id"] != family_id:
            continue
        if status is not None and body["status"] != status:
            continue
        result.append({"binding": _binding(adapter, obj, fixed),
                       **{field: body[field] for field in ("family_id", "description", "status", "parents", "attempt_refs")}})
    return {"database": adapter.database, "commit": fixed, "strategies": result}


def command(args):
    from research.records.store import open_store
    from research.records.common import _read_json
    store = open_store()
    if not hasattr(store, "adapter"):
        raise RecordError("strategy APIs require Dolt; Git is read-only research history")
    adapter = store.adapter
    if args.action == "publish":
        if args.at:
            raise RecordError("strategy publication cannot write to a historical snapshot")
        return publish(adapter, _read_json(args.file), args.source, args.operation_id, args.expected_version)
    if args.action == "list":
        return list_strategies(adapter, args.at, args.family_id, args.status, args.all_revisions)
    if args.action == "lineage":
        return lineage(adapter, args.strategy_id, args.revision, args.at)
    if args.action == "export":
        return export(adapter, args.strategy_id, args.destination, args.revision, args.at, args.binding_output)
    value = resolve(adapter, args.strategy_id, args.revision, args.at)
    obj = value["object"]
    if args.brief:
        obj = {**obj, "body": {**obj["body"], "source": {key: child for key, child in obj["body"]["source"].items()
                                                         if key != "content_base64"}}}
    return {"binding": value["binding"], "object": obj}
