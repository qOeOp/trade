"""Bounded TerminusDB v12.0.7 probe; no production ledger integration.

Run with Python's standard library. Docker data, source and HTTP transcripts stay
under --artifact-root outside Git. Native header CAS is tested separately from a
WOQL conditional transaction; an adapter must interpret empty bindings as conflict.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import platform
import subprocess
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


HERE = Path(__file__).resolve().parent
IMAGE = "terminusdb/terminusdb-server:v12.0.7"
PASSWORD = "ledgerprobe-isolated-validation-20261009"
CONTAINER = "ledgerprobe-terminus-20261009"
RESTORE_CONTAINER = "ledgerprobe-terminus-restored-20261009"
SCHEMA = [
    {"@id": "ObjectRevision", "@type": "Class", "id": "xsd:string", "kind": "xsd:string", "revision": "xsd:integer", "body": "xsd:string", "provenance": "xsd:string", "scope": "xsd:string", "aliases": {"@type": "Set", "@class": "xsd:string"}},
    {"@id": "Relation", "@type": "Class", "id": "xsd:string", "kind": "xsd:string", "from": "ObjectRevision", "to": "ObjectRevision", "body": "xsd:string"},
    {"@id": "LedgerHead", "@type": "Class", "version": "xsd:integer"},
    {"@id": "Operation", "@type": "Class", "operation_id": "xsd:string", "payload_sha256": "xsd:string", "result": "xsd:string"},
]


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def object_id(id_, revision):
    return "ObjectRevision/" + urllib.parse.quote(id_, safe="") + "/" + str(revision)


def object_doc(obj):
    return {"@id": object_id(obj["id"], obj["revision"]), "@type": "ObjectRevision", "id": obj["id"], "kind": obj["kind"], "revision": obj["revision"], "body": canonical(obj["body"]), "provenance": canonical(obj["provenance"]), "scope": obj["body"]["scope"], "aliases": obj["body"]["aliases"]}


def relation_doc(rel):
    return {"@id": "Relation/" + urllib.parse.quote(rel["id"], safe=""), "@type": "Relation", "id": rel["id"], "kind": rel["kind"], "from": object_id(rel["from_id"], rel["from_revision"]), "to": object_id(rel["to_id"], rel["to_revision"]), "body": canonical(rel["body"])}


def decode_object(doc):
    return {"id": doc["id"], "kind": doc["kind"], "revision": doc["revision"], "body": json.loads(doc["body"]), "provenance": json.loads(doc["provenance"])}


def decode_ref(ref):
    tail = ref.split("ObjectRevision/", 1)[1]
    id_, revision = tail.rsplit("/", 1)
    return urllib.parse.unquote(id_), int(revision)


def decode_relation(doc):
    from_id, from_revision = decode_ref(doc["from"])
    to_id, to_revision = decode_ref(doc["to"])
    return {"id": doc["id"], "kind": doc["kind"], "from_id": from_id, "from_revision": from_revision, "to_id": to_id, "to_revision": to_revision, "body": json.loads(doc["body"])}


def value(v):
    if isinstance(v, list):
        return {"@type": "Value", "list": [value(x) for x in v]}
    return {"@type": "Value", "data": v}


def doc_query(doc, action="InsertDocument"):
    return {"@type": action, "identifier": {"@type": "NodeValue", "node": doc["@id"]}, "document": {"@type": "Value", "dictionary": {"@type": "DictionaryTemplate", "data": [{"@type": "FieldValuePair", "field": k, "value": value(v)} for k, v in doc.items()]}}}


def triple(subject, predicate, object_, literal=False):
    return {"@type": "Triple", "subject": {"@type": "NodeValue", **subject}, "predicate": {"@type": "NodeValue", "node": predicate}, "object": {"@type": "Value", **({"data": object_} if literal else object_)}}


def read_query(id_, variable="Doc"):
    return {"@type": "ReadDocument", "identifier": {"@type": "NodeValue", **id_}, "document": {"@type": "DataValue", "variable": variable}}


def shell(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


class Client:
    def __init__(self, artifact_root, port=16373):
        self.base = f"http://127.0.0.1:{port}"
        self.root = artifact_root
        self.transcripts = []

    def wait_ready(self):
        for _ in range(80):
            try:
                response = self.request("GET", "/api/info")
                if response["code"] == 200:
                    return response
            except (urllib.error.URLError, http.client.RemoteDisconnected, ConnectionResetError):
                time.sleep(0.1)
        raise RuntimeError("Isolated TerminusDB instance did not become ready")

    def request(self, method, path, data=None, version=None):
        headers = {"Authorization": "Basic " + base64.b64encode(f"admin:{PASSWORD}".encode()).decode(), "Content-Type": "application/json"}
        if version:
            headers["TerminusDB-Data-Version"] = version
        req = urllib.request.Request(self.base + path, data=None if data is None else canonical(data).encode(), headers=headers, method=method)
        started = time.monotonic()
        try:
            response = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            raw = response.read().decode()
            result = {"code": response.code, "headers": dict(response.headers), "body": json.loads(raw) if raw else None, "duration_seconds": time.monotonic() - started}
        self.transcripts.append({"method": method, "path": path, "request": data, "expected_data_version": version, "response": result})
        return result

    def doc(self, db, params=None, path=None):
        p = path or db
        return self.request("GET", "/api/document/" + p + "?" + urllib.parse.urlencode({"as_list": "true", "unfold": "false", **(params or {})}))

    def version(self, db):
        return self.request("HEAD", "/api/document/" + db)["headers"]["Terminusdb-Data-Version"]

    def write(self, db, docs, message, version=None, method="POST", schema=False):
        params = {"author": "ledgerprobe", "message": message}
        if schema:
            params["graph_type"] = "schema"
        if method == "PUT":
            params["create"] = "true"
        return self.request(method, "/api/document/" + db + "?" + urllib.parse.urlencode(params), docs, version)

    def woql(self, db, query, message="read", version=None):
        return self.request("POST", "/api/woql/" + db, {"commit_info": {"author": "ledgerprobe", "message": message}, "query": query}, version)

    def create(self, name, objects, relations):
        db = "admin/ledgerprobe_" + name
        assert self.request("POST", "/api/db/" + db, {"label": name, "comment": "Current validation transcription, synthetic isolated authority"})["code"] == 200
        assert self.write(db, SCHEMA, "schema", schema=True)["code"] == 200
        response = self.write(db, [object_doc(x) for x in objects] + [relation_doc(x) for x in relations] + [{"@id": "LedgerHead/main", "@type": "LedgerHead", "version": 0}], "baseline")
        assert response["code"] == 200, response
        return db, response["headers"]["Terminusdb-Data-Version"].split(":", 1)[1]

    def snapshot(self, db, objects, relations, path=None):
        docs = self.doc(db, path=path)["body"]
        indexed_obj = {(d["id"], d["revision"]): decode_object(d) for d in docs if d["@type"] == "ObjectRevision"}
        indexed_rel = {d["id"]: decode_relation(d) for d in docs if d["@type"] == "Relation"}
        return {"objects_sha256": digest([indexed_obj[(o["id"], o["revision"])] for o in objects]), "relations_sha256": digest([indexed_rel[r["id"]] for r in relations]), "object_count": len(indexed_obj), "relation_count": len(indexed_rel), "operation_count": sum(d["@type"] == "Operation" for d in docs), "ledger_version": next(d["version"] for d in docs if d["@type"] == "LedgerHead"), "data_version": self.version(path or db)}


def mutation(fixture, id_="attempt:H13b", revision=2):
    original = next(x for x in fixture["objects"] if x["id"] == id_ and x["revision"] == 1)
    return {**original, "revision": revision}


def operation_doc(operation_id, request, result):
    return {"@id": "Operation/" + urllib.parse.quote(operation_id, safe=""), "@type": "Operation", "operation_id": operation_id, "payload_sha256": digest(request), "result": canonical(result)}


def guarded_query(docs, expected=0, new_version=1):
    guard = triple({"node": "LedgerHead/main"}, "version", {"@type": "xsd:integer", "@value": expected}, literal=True)
    head = {"@id": "LedgerHead/main", "@type": "LedgerHead", "version": new_version}
    return {"@type": "And", "and": [guard, doc_query(head, "UpdateDocument"), *(doc_query(x) for x in docs)]}


def delayed_native_query(query, delay_reads=3000, guard=False):
    """Read-only native workload exposes commit races without adding revisions."""
    reads = [read_query({"node": object_id("attempt:H08", 1)}, f"DelayRead{i}") for i in range(delay_reads)]
    index = 1 if guard else 0
    query["and"][index:index] = reads
    return {"@type": "Select", "variables": [], "query": query}


def save(root, name, value):
    (root / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-root", type=Path, default=Path("/Users/vx/.local/share/trade/ledger-probe/terminus-20261009"))
    parser.add_argument("--result", type=Path, default=HERE / "terminus_result.json")
    args = parser.parse_args()
    root = args.artifact_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    (root / "logs").mkdir(exist_ok=True)
    fixture = json.loads((HERE / "fixture.json").read_text())
    contract = json.loads((HERE / "contract.json").read_text())
    assert digest(fixture) == contract["fixture_sha256"]
    c = Client(root)
    run = str(int(time.time()))
    baseline_keys = {tuple(x) for x in contract["validation_history"]["baseline"]["object_keys"]}
    baseline_rel_ids = set(contract["validation_history"]["baseline"]["relation_ids"])
    baseline_objects = [x for x in fixture["objects"] if (x["id"], x["revision"]) in baseline_keys]
    baseline_relations = [x for x in fixture["relations"] if x["id"] in baseline_rel_ids]
    tests = {}
    result = {"backend": "TerminusDB", "requested_version": "12.0.7", "fixture_sha256": digest(fixture), "contract_sha256": digest(contract), "source_head": fixture["source_head"], "probe_source_head": shell("git", "rev-parse", "HEAD"), "time_utc": datetime.now(timezone.utc).isoformat(), "host_architecture": platform.machine(), "container_architecture": "linux/arm64", "image": IMAGE, "image_inspect": json.loads(shell("docker", "image", "inspect", IMAGE))[0], "artifact_root": str(root), "authority_changed": False, "classes": tests, "not_tested": [*contract["out_of_scope"], "Domain append-only/update-deny permission policy: native PUT can overwrite the logical id/revision at a later commit. Fixed history requires commit+id/revision; insert-only protocol is adapter custody."], "urls": ["https://github.com/terminusdb/terminusdb/tree/v12.0.7", "https://github.com/terminusdb/terminusdb/blob/v12.0.7/src/core/api/api_document.pl", "https://github.com/terminusdb/terminusdb/blob/v12.0.7/src/core/query/query_response.pl", "https://github.com/terminusdb/terminusdb/blob/v12.0.7/src/core/transaction/database.pl", "https://github.com/terminusdb/terminusdb/blob/v12.0.7/docs/openapi.yaml", "https://github.com/terminusdb/terminusdb/blob/v12.0.7/distribution/init_docker.sh"]}
    result["actual_server_info"] = c.wait_ready()["body"]
    assert result["actual_server_info"]["api:info"]["terminusdb"]["version"] == "12.0.7"
    history_db, baseline_commit = c.create("history_" + run, baseline_objects, baseline_relations)
    for branch in ["validation-baseline", "validation-review"]:
        response = c.request("POST", "/api/branch/" + history_db + "/local/branch/" + branch, {"origin": history_db + "/local/commit/" + baseline_commit})
        assert response["code"] == 200, response
    correction = c.write(history_db, [object_doc(x) for x in fixture["objects"] if (x["id"], x["revision"]) not in baseline_keys] + [relation_doc(x) for x in fixture["relations"] if x["id"] not in baseline_rel_ids], "correction")
    assert correction["code"] == 200
    correction_commit = correction["headers"]["Terminusdb-Data-Version"].split(":", 1)[1]
    result["history_db"] = history_db
    result["native_commits"] = {"baseline": baseline_commit, "correction": correction_commit}

    aliases = contract["classes"][0]["queries"]
    recall = []
    for alias in aliases:
        query = {"@type": "And", "and": [triple({"variable": "Object"}, "kind", "attempt", True), triple({"variable": "Object"}, "aliases", alias, True), read_query({"variable": "Object"})]}
        response = c.woql(history_db, query)
        docs = [decode_object(x["Doc"]) for x in response["body"].get("bindings", [])]
        recall.append({"alias": alias, "query": query, "response": response, "ids": sorted(x["id"] for x in docs), "scopes": {x["id"].split(":")[1]: x["body"]["scope"] for x in docs}})
    tests["A1-component-recall"] = {"status": "passed" if all(x["ids"] == ["attempt:H08", "attempt:H18a"] and x["scopes"] == contract["classes"][0]["expected_scope_by_attempt"] for x in recall) else "failed", "native_exact_alias_queries": recall, "boundary": "Manual metadata exact recall; no general semantic search, no inherited full strategy return."}

    old = c.doc(history_db, {"id": object_id("claim:C02-stop-attribution", 1)}, history_db + "/local/commit/" + baseline_commit)["body"][0]
    current = c.doc(history_db, {"id": object_id("claim:C02-stop-attribution", 2)})["body"][0]
    target = object_id("claim:C02-stop-attribution", 1)
    direct_query = {"@type": "And", "and": [triple({"variable": "Relation"}, "kind", "uses_claim", True), triple({"variable": "Relation"}, "to", {"node": target}), triple({"variable": "Relation"}, "from", {"variable": "Affected"}), read_query({"variable": "Affected"})]}
    direct = c.woql(history_db, direct_query)
    direct_ids = sorted(x["Doc"]["id"] for x in direct["body"]["bindings"])
    downstream_query = {"@type": "And", "and": [triple({"variable": "Use"}, "kind", "uses_claim", True), triple({"variable": "Use"}, "to", {"node": target}), triple({"variable": "Use"}, "from", {"variable": "Affected"}), triple({"variable": "Next"}, "to", {"variable": "Affected"}), triple({"variable": "Next"}, "from", {"variable": "Downstream"}), read_query({"variable": "Downstream"})]}
    downstream = c.woql(history_db, downstream_query)
    downstream_ids = sorted(set(x["Doc"]["id"] for x in downstream["body"]["bindings"]) - set(direct_ids))
    fixed = c.doc(history_db, {"type": "Relation"})["body"]
    fixed = [x for x in fixed if x["id"] in contract["classes"][1]["fixed_endpoint_relations"]]
    negative = c.doc(history_db, {"id": object_id("attempt:H13b", 1)})["body"][0]
    tests["A2-correction-and-impact"] = {"status": "passed" if digest(decode_object(old)) == contract["classes"][1]["historical_object_sha256"] and digest(decode_object(current)) == contract["classes"][1]["current_object_sha256"] and direct_ids == contract["classes"][1]["direct_affected_ids"] and downstream_ids == contract["classes"][1]["downstream_affected_ids"] and all(x["to"] == target for x in fixed) and json.loads(negative["body"])["state"] == "source_failed" else "failed", "old_commit": baseline_commit, "old_object_sha256": digest(decode_object(old)), "current_object_sha256": digest(decode_object(current)), "direct_ids": direct_ids, "downstream_ids": downstream_ids, "fixed_revision_relations": fixed, "direct_query": direct_query, "downstream_query": downstream_query, "responses": [direct, downstream], "negative_h13b_state": json.loads(negative["body"])["state"], "boundary": contract["classes"][1]["required_boundary"]}

    duplicate = c.doc(history_db, {"id": "Relation/" + urllib.parse.quote("rel:S15-duplicate-S01", safe="")})["body"][0]
    source_docs = [decode_object(c.doc(history_db, {"id": object_id(id_, 1)})["body"][0]) for id_ in ["source:S01", "source:S15"]]
    media = contract["classes"][2]["media_sha256"]
    independent = len({x for o in source_docs for x in o["body"]["aliases"] if x == media})
    tests["A3-duplicate-source"] = {"status": "passed" if duplicate["kind"] == "duplicate_of" and independent == 1 and source_docs[1]["body"]["state"] == "duplicate_not_independent" else "failed", "native_typed_relation": duplicate, "processing_attempt_count": len(source_docs), "independent_media_count": independent, "media_sha256": media, "s15_independent_corroboration": False, "adapter_responsibility": "Count unique explicit media hashes and interpret duplicate_of; backend does not infer source independence.", "boundary": contract["classes"][2]["required_boundary"]}

    db, _ = c.create("atomic_" + run, fixture["objects"], fixture["relations"])
    before = c.snapshot(db, fixture["objects"], fixture["relations"])
    invalid_contract = contract["classes"][3]
    copies = [mutation(fixture, x[0], x[2]) for x in invalid_contract["copy_real_objects_to_new_revision"]]
    request = {"objects": copies, "relations": [invalid_contract["invalid_relation"]]}
    op = operation_doc(invalid_contract["operation_id"], request, {"version": 1})
    response = c.woql(db, guarded_query([*(object_doc(x) for x in copies), relation_doc(invalid_contract["invalid_relation"]), op]), "invalid-fk")
    after = Client(root).snapshot(db, fixture["objects"], fixture["relations"])
    tests["A4-atomic-rollback"] = {"status": "passed" if response["code"] == 400 and before == after else "failed", "response": response, "before": before, "after_independent_connection": after, "native_enforcement": "Typed class reference validation and native WOQL transaction rollback; no client FK precheck."}

    # A5 deliberately separates native header preconditions from native field guards.
    race_evidence = []
    for mode in ["ordinary", "delayed-300ms"]:
        db, _ = c.create("race_" + mode.replace("-", "_") + "_" + run, fixture["objects"], fixture["relations"])
        version = c.version(db)
        barrier = threading.Barrier(2)
        def writer(label):
            peer = Client(root)
            expected = peer.version(db)
            # Read-only native workload makes transactions overlap without extra
            # persistent padding objects. Writer keys are disjoint by contract.
            real_id = contract["classes"][4]["copy_real_objects_by_writer"][label][0]
            copy = object_doc(mutation(fixture, real_id))
            operation = operation_doc("validation:race-" + label, {"objects": [mutation(fixture, real_id)]}, {"version": 1})
            query = delayed_native_query({"@type": "And", "and": [doc_query({"@id": "LedgerHead/main", "@type": "LedgerHead", "version": 1}, "UpdateDocument"), doc_query(copy), doc_query(operation)]})
            barrier.wait()
            if mode == "delayed-300ms" and label == "b":
                time.sleep(0.3)
            r = peer.woql(db, query, "native-header-race-" + label, expected)
            c.transcripts.extend(peer.transcripts)
            return {"writer": label, "expected_data_version": expected, "intentional_delay_seconds": 0.3 if mode == "delayed-300ms" and label == "b" else 0, "response": r}
        with ThreadPoolExecutor(2) as pool:
            writers = list(pool.map(writer, ["a", "b"]))
        snapshot = c.snapshot(db, fixture["objects"], fixture["relations"])
        stale = c.write(db, [object_doc({**mutation(fixture), "id": "validation:serial-stale-control"})], "serial-stale-control", version)
        race_evidence.append({"mode": mode, "initial_data_version": version, "writers": writers, "final": snapshot, "serial_stale_negative_control": stale})
    header_passed = all(sum(w["response"]["code"] == 200 for w in r["writers"]) == 1 and r["final"]["operation_count"] == 1 and r["serial_stale_negative_control"]["code"] == 400 for r in race_evidence)
    guard_evidence = []
    for mode in ["ordinary", "delayed-300ms"]:
        db, _ = c.create("guard_" + mode.replace("-", "_") + "_" + run, fixture["objects"], fixture["relations"])
        barrier = threading.Barrier(2)
        def writer(label):
            peer = Client(root)
            expected = peer.doc(db, {"id": "LedgerHead/main"})["body"][0]["version"]
            real_id = contract["classes"][4]["copy_real_objects_by_writer"][label][0]
            docs = [object_doc(mutation(fixture, real_id)), operation_doc("validation:race-" + label, {"objects": [mutation(fixture, real_id)]}, {"version": 1})]
            # Guard re-runs after native optimistic transaction retry.
            queries = delayed_native_query(guarded_query(docs), guard=True)
            barrier.wait()
            if mode == "delayed-300ms" and label == "b":
                time.sleep(0.3)
            response = peer.woql(db, queries, "conditional-guard-" + label)
            c.transcripts.extend(peer.transcripts)
            body = response["body"]
            return {"writer": label, "expected_ledger_version": expected, "intentional_delay_seconds": 0.3 if mode == "delayed-300ms" and label == "b" else 0, "response": response, "domain_status": "success" if response["code"] == 200 and body.get("bindings") else "conflict"}
        with ThreadPoolExecutor(2) as pool:
            writers = list(pool.map(writer, ["a", "b"]))
        guard_evidence.append({"mode": mode, "writers": writers, "final": c.snapshot(db, fixture["objects"], fixture["relations"])})
    tests["A5-same-version-race"] = {"status": "passed" if header_passed else "failed", "native_header": race_evidence, "read_only_transaction_delay": "3000 ReadDocument calls after native header check (or after WOQL field guard) and before mutation; Select hides read bindings. No persistent padding objects; a/b have disjoint real revision keys.", "conditional_woql_alternative": {"status": "passed" if all(sum(x["domain_status"] == "success" for x in r["writers"]) == 1 and r["final"]["operation_count"] == 1 and r["final"]["ledger_version"] == 1 and r["final"]["object_count"] == len(fixture["objects"]) + 1 for r in guard_evidence) else "failed", "evidence": guard_evidence, "boundary": "Native field predicate is re-evaluated inside transaction retry. Empty binding -> explicit domain conflict needs adapter. This does not repair native TerminusDB-Data-Version header CAS; no external lock or coordinator."}}

    db, _ = c.create("idempotent_" + run, fixture["objects"], fixture["relations"])
    before = c.snapshot(db, fixture["objects"], fixture["relations"])
    request = {"objects": [mutation(fixture)]}
    operation_id = contract["classes"][5]["operation_id"]
    op = operation_doc(operation_id, request, {"operation_id": operation_id, "version": 1, "object_keys": [["attempt:H13b", 2]]})
    first = c.woql(db, guarded_query([object_doc(mutation(fixture)), op]), operation_id)
    assert first["code"] == 200 and first["body"]["bindings"]
    lost_commit = first["headers"]["Terminusdb-Data-Version"].split(":", 1)[1]
    # Intentionally lose caller's first result; new connection reconstructs it.
    peer = Client(root)
    recovered = peer.doc(db, {"id": op["@id"]})["body"][0]
    log = peer.request("GET", "/api/log/" + db)["body"]
    recovered_commit = next(x["identifier"] for x in log if x["message"] == operation_id)
    native_retry = peer.write(db, [object_doc(mutation(fixture)), op], operation_id + "-duplicate")
    same_replay = {"status": "replayed", "result": json.loads(recovered["result"]), "native_commit": recovered_commit} if recovered["payload_sha256"] == digest(request) else {"status": "conflict"}
    different_request = {"objects": [mutation(fixture, "attempt:H13")]}
    different = {"code": 409, "error": "operation-content-conflict"} if recovered["payload_sha256"] != digest(different_request) else {"code": 200}
    after = peer.snapshot(db, fixture["objects"], fixture["relations"])
    tests["A6-idempotent-operation"] = {"status": "passed" if recovered_commit == lost_commit and same_replay["status"] == "replayed" and after["operation_count"] == 1 and after["ledger_version"] - before["ledger_version"] == 1 and after["object_count"] - before["object_count"] == 1 and different["code"] == 409 and after["data_version"] == first["headers"]["Terminusdb-Data-Version"] else "failed", "lost_response_commit": lost_commit, "new_connection_operation": recovered, "recovered_result": same_replay, "same_content_native_duplicate_response": native_retry, "different_content_adapter_response": different, "before": before, "after": after, "operation_query_path": "/api/document/" + db + "?id=" + urllib.parse.quote(op["@id"], safe=""), "native_commit_query_path": "/api/log/" + db, "lost_response_simulation": "First native commit response is retained only as the test oracle; replay result/version comes from a fresh Client reading the persistent Operation document, and recovered native commit is selected from backend /api/log by exact operation message. No process-memory replay registry.", "native_primitive": "Deterministic unique document @id + atomic insert; native duplicate HTTP400.", "domain_adapter": "Canonical operation fingerprint, replay result reconstruction, native commit lookup by exact operation commit message, mismatch -> explicit 409. Backend has no native operation_id API."}
    c.transcripts.extend(peer.transcripts)

    # Offline all-storage backup. No logical JSON dump is used for recovery.
    before_main = c.snapshot(history_db, fixture["objects"], fixture["relations"])
    before_old = c.snapshot(history_db, baseline_objects, baseline_relations, history_db + "/local/commit/" + baseline_commit)
    branch_heads = {branch: c.version(history_db + "/local/branch/" + branch) for branch in ["main", "validation-baseline", "validation-review"]}
    save(root, "logs/pre-backup-result.json", result)
    save(root, "logs/http-transcripts.json", c.transcripts)
    shell("docker", "stop", CONTAINER)
    (root / "logs" / "server.log").write_text(shell("docker", "logs", CONTAINER))
    archive = root / ("full-storage-" + run + ".tar.gz")
    with tarfile.open(archive, "w:gz") as tf:
        tf.add(root / "storage", arcname="storage")
    archive_sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    restore_parent = root / ("restore-" + run)
    assert not restore_parent.exists()
    restore_parent.mkdir()
    with tarfile.open(archive) as tf:
        tf.extractall(restore_parent, filter="data")
    restore_container = RESTORE_CONTAINER + "-" + run
    shell("docker", "run", "-d", "--name", restore_container, "-p", "127.0.0.1:16374:6363", "-v", str(restore_parent / "storage") + ":/app/terminusdb/storage", "-e", "TERMINUSDB_ADMIN_PASS=" + PASSWORD, IMAGE)
    restored = Client(root, 16374)
    restored.wait_ready()
    restored_main = restored.snapshot(history_db, fixture["objects"], fixture["relations"])
    restored_old = restored.snapshot(history_db, baseline_objects, baseline_relations, history_db + "/local/commit/" + baseline_commit)
    restored_heads = {branch: restored.version(history_db + "/local/branch/" + branch) for branch in branch_heads}
    history_storage_passed = before_main == restored_main and before_old == restored_old and branch_heads == restored_heads
    tests["A7-native-history-recovery"] = {"status": "passed" if history_storage_passed else "failed", "full_offline_storage_history_and_branches": "passed" if history_storage_passed else "failed", "working_set_recovery": "not_applicable", "working_set_evidence": "Tested server Document and WOQL API persist every mutation as a native commit; no native persistent uncommitted working set equivalent is exposed. Contract revision 3 requires recovery of actual native states; API request-local transient transactions are not a persistent uncommitted workspace.", "backup_path": str(archive), "backup_sha256": archive_sha, "mechanism": "Stop source server; tar the complete /app/terminusdb/storage bind volume including db/store/labels/system/history; extract into previously nonexistent folder and start another server/container.", "restore_directory": str(restore_parent), "baseline_commit": baseline_commit, "correction_commit": correction_commit, "before_main": before_main, "restored_main": restored_main, "before_old_commit": before_old, "restored_old_commit": restored_old, "before_branch_heads": branch_heads, "restored_branch_heads": restored_heads, "boundary": contract["classes"][6]["required_boundary"]}
    c.transcripts.extend(restored.transcripts)
    shell("docker", "stop", restore_container)
    (root / "logs" / "restored-server.log").write_text(shell("docker", "logs", restore_container))
    result["maintenance_adapter"] = {"files": [str(Path(__file__).resolve())], "source_lines": len(Path(__file__).read_text().splitlines()), "dependencies": "Python standard library + Docker; no client SDK", "responsibilities": ["Fixture JSON serialization + exact alias/scope index projection", "Fixed-revision ID encoding and typed relation schema", "Domain source-independence interpretation", "Operation canonical fingerprint/replay/409 conflict mapping", "Optional WOQL empty-binding -> conflict mapping; native header failure remains"], "production_ready": False}
    result["containers_stopped"] = [CONTAINER, restore_container]
    result["probe_script_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    save(root, "logs/http-transcripts.json", c.transcripts)
    result["http_transcript_path"] = str(root / "logs/http-transcripts.json")
    save(root, "terminus_result.json", result)
    args.result.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"result": str(args.result), "classes": {k: v["status"] for k, v in tests.items()}, "guard_alternative": tests["A5-same-version-race"]["conditional_woql_alternative"]["status"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
