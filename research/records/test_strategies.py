"""Source byte custody and fixed strategy lineage, plus disposable Dolt probes."""

import copy
from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import uuid

from research.records.common import RecordError
from research.records.dolt_store import ConflictError, DoltStore
from research.records.store import DoltRecords, canonical
from research.records import strategies


SOURCE = '# 中文 source\r\nclass Example:\r\n    pass\r\nraise RuntimeError("never execute during publication")\r\n'.encode("utf-8")


def metadata(identity="r1-example", **kwargs):
    return {"strategy_id": identity, "family_id": "r1", "description": "Native source experiment",
            "entry_class": "Example", "runtime_contract": "r1-native-v1", "status": "research",
            "parents": [], "attempt_refs": [], **kwargs}


class MemoryAdapter:
    """A snapshot double for publication policy, not a production writer."""

    database = "strategy_unit_test"

    def __init__(self):
        self.version = 0
        self.dirty = False
        self.snapshots = {"0" * 32: ({}, {})}
        self.operations = {}

    def status(self):
        return {"database": self.database, "commit": f"{self.version:032x}",
                "version": self.version, "dirty": self.dirty}

    def get_object(self, identity, revision=None, commit=None):
        objects, _ = self.snapshots[commit or self.status()["commit"]]
        selected = [value for (key, rev), value in objects.items() if key == identity and
                    (revision is None or revision == rev)]
        return copy.deepcopy(max(selected, key=lambda value: value["revision"])) if selected else None

    def list_objects(self, kind=None, commit=None, latest=True):
        objects, _ = self.snapshots[commit or self.status()["commit"]]
        values = list(objects.values())
        if latest:
            values = [value for value in values if self.get_object(value["id"], commit=commit)["revision"] == value["revision"]]
        return copy.deepcopy([value for value in values if kind is None or value["kind"] == kind])

    def list_relations(self, commit=None):
        return copy.deepcopy(list(self.snapshots[commit or self.status()["commit"]][1].values()))

    def publish(self, objects, relations, operation_id, expected_version, message):
        payload = canonical({"objects": objects, "relations": relations, "message": message})
        if operation_id in self.operations:
            prior_payload, prior = self.operations[operation_id]
            if prior_payload != payload:
                raise ConflictError("operation-content conflict")
            return {**prior, "replayed": True}
        if self.version != expected_version:
            raise ConflictError("expected-version conflict")
        all_objects, all_relations = copy.deepcopy(self.snapshots[self.status()["commit"]])
        for obj in objects:
            key = (obj["id"], obj["revision"])
            if key in all_objects and canonical(all_objects[key]) != canonical(obj):
                raise ConflictError("immutable object revision conflict")
            all_objects[key] = copy.deepcopy(obj)
        for edge in relations:
            if edge["id"] in all_relations and canonical(all_relations[edge["id"]]) != canonical(edge):
                raise ConflictError("immutable relation conflict")
            all_relations[edge["id"]] = copy.deepcopy(edge)
        self.version += 1
        self.snapshots[self.status()["commit"]] = (all_objects, all_relations)
        result = {"operation_id": operation_id, "version": self.version,
                  "commit": self.status()["commit"], "replayed": False}
        self.operations[operation_id] = (payload, result)
        return result


class StrategyPolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = Path(self.directory.name) / "source.py"
        self.source.write_bytes(SOURCE)
        self.adapter = MemoryAdapter()

    def publish(self, body=None, operation="source", expected=None):
        return strategies.publish(self.adapter, body or metadata(), self.source, operation,
                                  self.adapter.version if expected is None else expected)

    def test_exact_utf8_crlf_bytes_and_no_source_execution(self):
        first = self.publish()
        value = strategies.resolve(self.adapter, "r1-example")
        self.assertEqual(value["source_bytes"], SOURCE)
        self.assertEqual(value["binding"], first["binding"])
        self.assertEqual(value["binding"]["source_sha256"], hashlib.sha256(SOURCE).hexdigest())
        self.assertEqual(strategies.validate_binding(self.adapter, first["binding"])["source_bytes"], SOURCE)

    def test_immutable_retry_recovers_original_commit_after_later_revision(self):
        first = self.publish()
        changed = metadata(status="retired", description="Stopped research with unchanged source")
        second = self.publish(changed, "retire")
        recovered = self.publish(operation="source", expected=0)
        self.assertEqual(recovered["commit"], first["commit"])
        self.assertTrue(recovered["replayed"])
        self.assertEqual(recovered["binding"]["revision"], 1)
        self.assertEqual(second["binding"]["revision"], 2)
        self.assertEqual(strategies.resolve(self.adapter, "r1-example", at=first["commit"])["object"]["body"]["status"], "research")
        self.assertEqual(strategies.resolve(self.adapter, "r1-example")["object"]["body"]["status"], "retired")
        with self.assertRaisesRegex(ConflictError, "operation-content"):
            self.publish(changed, "source", expected=0)
        self.source.write_bytes(SOURCE + b"# changed\n")
        with self.assertRaisesRegex(ConflictError, "operation-content"):
            self.publish(operation="source", expected=0)
        self.assertEqual(self.adapter.version, 2)

    def test_version_guard_dirty_working_set_and_stable_family(self):
        self.publish()
        with self.assertRaisesRegex(ConflictError, "expected-version"):
            self.publish(operation="stale", expected=0)
        self.adapter.dirty = True
        with self.assertRaisesRegex(RecordError, "unpublished SQL"):
            self.publish(operation="dirty")
        self.adapter.dirty = False
        with self.assertRaisesRegex(ConflictError, "family_id is immutable"):
            self.publish(metadata(family_id="other"), "new-family")
        self.assertEqual(self.adapter.version, 1)

    def test_parents_and_attempts_bind_fixed_snapshot_revisions(self):
        parent = self.publish(metadata("r1-parent"))
        attempt = {"id": "attempt:H1", "kind": "attempt", "revision": 1,
                   "body": {"attempt_id": "H1"}, "provenance": {}}
        self.adapter.publish([attempt], [], "attempt", 1, "publish test attempt")
        child_meta = metadata("r1-child", parents=[{"strategy_id": "r1-parent", "revision": 1,
                                                   "difference": "Replace only the selector"}],
                              attempt_refs=[{"attempt_id": "H1", "revision": 1}])
        child = self.publish(child_meta, "child")
        self.publish(metadata("r1-parent", description="New parent scope"), "parent-later")
        attempt = dict(attempt, revision=2, body={"attempt_id": "H1", "note": "Later decision"})
        self.adapter.publish([attempt], [], "attempt-later", 4, "later decision")
        value = strategies.lineage(self.adapter, "r1-child")
        self.assertEqual(value["parents"][0]["strategy"]["binding"]["revision"], 1)
        self.assertEqual(value["attempt_refs"], [{"attempt_id": "H1", "revision": 1}])
        frozen = strategies.lineage(self.adapter, "r1-child", at=child["commit"])
        self.assertEqual(frozen["parents"][0]["strategy"]["binding"]["source_sha256"], parent["binding"]["source_sha256"])

    def test_invalid_or_ambiguous_fixed_endpoints_do_not_publish(self):
        for body in (
            metadata(parents=[{"strategy_id": "r1-example", "revision": 1, "difference": "Self"}]),
            metadata(parents=[{"strategy_id": "r1-missing", "revision": 1, "difference": "Unknown"}]),
            metadata(attempt_refs=[{"attempt_id": "H1", "revision": 9}]),
            metadata(attempt_refs=[{"attempt_id": "H1", "revision": 1}, {"attempt_id": "H1", "revision": 1}]),
        ):
            with self.assertRaises(RecordError):
                self.publish(body)
        self.publish(metadata("r1-other", family_id="different"))
        with self.assertRaisesRegex(RecordError, "declared family"):
            self.publish(metadata(parents=[{"strategy_id": "r1-other", "revision": 1, "difference": "Different family"}]), "child")
        self.assertEqual(self.adapter.version, 1)

    def test_source_validation_does_not_accept_invalid_class_or_encoding(self):
        for raw in (b"\xff", b"class Broken(\n", b"return 1\nclass Example: pass\n",
                    b"class Other: pass\n", b"class Example: pass\nclass Example: pass\n"):
            self.source.write_bytes(raw)
            with self.assertRaises(RecordError):
                self.publish()
        self.assertEqual(self.adapter.version, 0)

    def test_source_hash_and_all_binding_fields_are_verified(self):
        first = self.publish()
        for field, changed in (("source_sha256", "0" * 64), ("entry_class", "Other"),
                               ("runtime_contract", "other"), ("database", "other"),
                               ("revision", 2), ("commit", "HEAD")):
            with self.subTest(field=field), self.assertRaises(RecordError):
                strategies.validate_binding(self.adapter, {**first["binding"], field: changed})
        with self.assertRaises(RecordError):
            strategies.validate_binding(self.adapter, {**first["binding"], "unknown": True})
        obj = self.adapter.snapshots[first["commit"]][0][("strategy:r1-example", 1)]
        obj["body"]["source"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(RecordError, "hash or encoding differs"):
            strategies.resolve(self.adapter, "r1-example")

    def test_export_new_source_and_binding_exact_bytes_and_cleanup_failure(self):
        first = self.publish()
        output = Path(self.directory.name) / "work/strategy.py"
        binding = Path(self.directory.name) / "work/binding.json"
        strategies.export(self.adapter, "r1-example", output, binding_output=binding)
        self.assertEqual(output.read_bytes(), SOURCE)
        self.assertEqual(json.loads(binding.read_bytes()), first["binding"])
        with self.assertRaisesRegex(RecordError, "destination exists"):
            strategies.export(self.adapter, "r1-example", output, binding_output=binding)
        blocker = Path(self.directory.name) / "regular-file"
        blocker.write_text("preserve")
        another = Path(self.directory.name) / "new.py"
        with self.assertRaisesRegex(RecordError, "export failed"):
            strategies.export(self.adapter, "r1-example", another, binding_output=blocker / "binding.json")
        self.assertFalse(another.exists())
        self.assertEqual(blocker.read_text(), "preserve")
        with self.assertRaisesRegex(RecordError, "destinations must differ"):
            strategies.export(self.adapter, "r1-example", another, binding_output=another)

    def test_legacy_provenance_requires_exact_bytes(self):
        legacy = {"commit": "a" * 40, "path": "strategies/r1.py", "sha256": hashlib.sha256(SOURCE).hexdigest()}
        self.publish(metadata(legacy_git=legacy))
        with self.assertRaisesRegex(RecordError, "legacy Git source hash"):
            self.publish(metadata(legacy_git={**legacy, "sha256": "0" * 64}), "bad-legacy")
        with self.assertRaisesRegex(RecordError, "relative repository path"):
            self.publish(metadata(legacy_git={**legacy, "path": "../source.py"}), "bad-path")

    def test_list_filters_and_research_status_has_no_qualification_field(self):
        self.publish()
        self.publish(metadata("r1-retired", status="retired"), "retired")
        value = strategies.list_strategies(self.adapter, family_id="r1", status="retired")
        self.assertEqual([item["binding"]["strategy_id"] for item in value["strategies"]], ["r1-retired"])
        with self.assertRaisesRegex(RecordError, "missing or unknown fields"):
            self.publish({**metadata(), "qualified": True}, "claim")
        self.publish(metadata(status="archived"), "archive")
        self.assertEqual(len(strategies.list_strategies(self.adapter)["strategies"]), 2)
        self.assertEqual(len(strategies.list_strategies(self.adapter, all_revisions=True)["strategies"]), 3)

    def test_cli_export_pins_global_snapshot_and_fixed_revision(self):
        from research.records.cli import main
        first = self.publish()
        self.publish(metadata(status="archived"), "archive")
        output = Path(self.directory.name) / "cli-strategy.py"
        binding = Path(self.directory.name) / "cli-binding.json"
        arguments = ["records", "--at", first["commit"], "strategy", "export", "r1-example",
                     "--revision", "1", "--destination", str(output), "--binding-output", str(binding)]
        buffer = io.StringIO()
        with patch("sys.argv", arguments), patch("research.records.store.open_store", return_value=SimpleNamespace(adapter=self.adapter)), redirect_stdout(buffer):
            self.assertEqual(main(), 0)
        self.assertEqual(output.read_bytes(), SOURCE)
        self.assertEqual(json.loads(binding.read_bytes()), first["binding"])
        self.assertEqual(json.loads(buffer.getvalue())["commit"], first["commit"])

    def test_unavailable_dolt_and_historical_writes_fail_visibly(self):
        with patch("research.records.store.open_store", side_effect=RecordError("Dolt is unavailable")):
            with self.assertRaisesRegex(RecordError, "Dolt is unavailable"):
                strategies.command(SimpleNamespace(action="list"))
        with patch("research.records.store.open_store", return_value=SimpleNamespace(adapter=self.adapter)):
            with self.assertRaisesRegex(RecordError, "historical snapshot"):
                strategies.command(SimpleNamespace(action="publish", at="0" * 32))

    def test_lineage_rejects_missing_relations_and_corrupt_cycles(self):
        self.publish(metadata("r1-parent"))
        self.publish(metadata("r1-child", parents=[{"strategy_id": "r1-parent", "revision": 1, "difference": "Selector"}]), "child")
        snapshot = self.adapter.snapshots[self.adapter.status()["commit"]]
        objects, relations = snapshot
        edge = next(iter(relations.values()))
        relations.clear()
        with self.assertRaisesRegex(RecordError, "missing or unexpected"):
            strategies.lineage(self.adapter, "r1-child")
        relations[edge["id"]] = edge
        parent = objects[("strategy:r1-parent", 1)]
        parent["body"]["parents"] = [{"strategy_id": "r1-child", "revision": 1, "difference": "Corrupt cycle"}]
        reverse = {"id": "corrupt-cycle", "kind": "strategy_parent", "from_id": parent["id"],
                   "from_revision": 1, "from_kind": "strategy", "to_id": "strategy:r1-child",
                   "to_revision": 1, "to_kind": "strategy", "body": parent["body"]["parents"][0]}
        relations[reverse["id"]] = reverse
        with self.assertRaisesRegex(RecordError, "cycle in fixed strategy"):
            strategies.lineage(self.adapter, "r1-child")


class StrategyDoltIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("real Dolt integration requires RESEARCH_DOLT_TEST_CONFIG")
        cls.connection_config = json.loads(raw)

    def setUp(self):
        self.config = dict(self.connection_config, database="records_test_strategy_" + uuid.uuid4().hex)
        self.adapter = DoltStore(self.config)
        self.addCleanup(self.remove)
        self.adapter.initialize()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = Path(self.directory.name) / "source.py"
        self.source.write_bytes(SOURCE)

    def remove(self):
        self.assertTrue(self.config["database"].startswith("records_test_strategy_"))
        with self.adapter._connection(database=False) as conn:
            self.adapter._sql(conn, f"DROP DATABASE `{self.config['database']}`")

    def test_persistent_retry_export_and_native_historical_snapshot(self):
        first = strategies.publish(self.adapter, metadata(), self.source, "first", 0)
        second = strategies.publish(self.adapter, metadata(status="archived"), self.source, "archive", 1)
        fresh_adapter = DoltStore(self.config)
        recovered = strategies.publish(fresh_adapter, metadata(), self.source, "first", 0)
        self.assertEqual(recovered, {**first, "replayed": True})
        self.assertEqual(fresh_adapter.status()["version"], 2)
        self.assertFalse(fresh_adapter.status()["dirty"])
        self.assertNotEqual(first["commit"], second["commit"])
        destination = Path(self.directory.name) / "restored.py"
        binding_path = Path(self.directory.name) / "binding.json"
        strategies.export(fresh_adapter, "r1-example", destination, revision=1,
                          at=first["commit"], binding_output=binding_path)
        self.assertEqual(destination.read_bytes(), SOURCE)
        self.assertEqual(json.loads(binding_path.read_bytes()), first["binding"])
        with self.assertRaisesRegex(ConflictError, "operation-content"):
            strategies.publish(fresh_adapter, metadata(status="retired"), self.source, "first", 2)
        self.assertEqual(fresh_adapter.status()["version"], 2)

    def test_fixed_parent_edges_survive_parent_correction(self):
        strategies.publish(self.adapter, metadata("r1-parent"), self.source, "parent", 0)
        child_meta = metadata("r1-child", parents=[{"strategy_id": "r1-parent", "revision": 1,
                                                   "difference": "Changed selector"}])
        child = strategies.publish(self.adapter, child_meta, self.source, "child", 1)
        strategies.publish(self.adapter, metadata("r1-parent", description="Corrected source scope"), self.source, "correct", 2)
        value = strategies.lineage(DoltStore(self.config), "r1-child")
        self.assertEqual(value["parents"][0]["strategy"]["binding"]["revision"], 1)
        self.assertEqual(value["parents"][0]["strategy"]["description"], "Native source experiment")
        self.assertEqual(strategies.lineage(self.adapter, "r1-child", at=child["commit"])["binding"]["commit"], child["commit"])

    def test_schema2_preregistration_binds_strategy_through_decision_revisions(self):
        source = strategies.publish(self.adapter, metadata(), self.source, "source", 0)
        records = DoltRecords(self.config)
        attempt = {"schema_version": 2, "attempt_id": "STRATEGY-BINDING-01", "goal_id": "registry-integration",
                   "kind": "strategy", "question": "Can the initial source binding remain fixed?",
                   "mechanism": "Immutable source snapshot", "hypothesis": "Decision revisions retain their registered source",
                   "parents": [], "code_parent": None, "strategy_binding": source["binding"],
                   "contract": {"scope": "Disposable API custody probe; no research outcome", "plan": "Publish source, preregister, then alter only a decision"},
                   "registration": {"status": "preregistered"},
                   "decision": {"layer": "pending", "outcome": "pending", "scope": "No replay performed", "next_action": "Exercise record custody"},
                   "evidence_refs": []}
        first = records.publish_record("attempt", attempt, operation_id="preregister", expected_version=1)
        self.assertEqual(first["registration_receipt"], {"id": "attempt:STRATEGY-BINDING-01", "revision": 1, "commit": first["commit"]})
        self.source.write_bytes(SOURCE + b"# Later strategy edit\n")
        later_source = strategies.publish(self.adapter, metadata(description="Later source revision"), self.source, "later-source", 2)
        decision = copy.deepcopy(attempt)
        decision["decision"].update(layer="execution", outcome="inconclusive", scope="Only the API custody probe; no replay", next_action="Keep native replay separate")
        later = records.publish_record("attempt", decision, operation_id="decision", expected_version=3)
        self.assertEqual(records.adapter.get_object("attempt:STRATEGY-BINDING-01")["revision"], 2)
        original, receipt = records.registration_snapshot("STRATEGY-BINDING-01")
        self.assertEqual(original, attempt)
        self.assertEqual(receipt, first["registration_receipt"])
        for revision in (1, 2):
            edges = [edge for edge in self.adapter.list_relations(commit=later["commit"])
                     if edge["kind"] == "uses_strategy" and edge["from_id"] == "attempt:STRATEGY-BINDING-01"
                     and edge["from_revision"] == revision]
            self.assertEqual(len(edges), 1)
            self.assertEqual({key: edges[0][key] for key in ("from_kind", "to_id", "to_revision", "to_kind", "body")},
                             {"from_kind": "attempt", "to_id": "strategy:r1-example", "to_revision": 1,
                              "to_kind": "strategy", "body": {"binding": source["binding"]}})
        before = self.adapter.status()
        rebound = copy.deepcopy(decision)
        rebound["strategy_binding"] = later_source["binding"]
        with self.assertRaisesRegex(ConflictError, "original registration contract"):
            records.publish_record("attempt", rebound, operation_id="rebind", expected_version=before["version"])
        dropped = copy.deepcopy(decision)
        dropped.pop("strategy_binding")
        with self.assertRaisesRegex(ConflictError, "original registration contract"):
            records.publish_record("attempt", dropped, operation_id="drop-binding", expected_version=before["version"])
        self.assertEqual(self.adapter.status(), before)
        retried = records.publish_record("attempt", attempt, operation_id="preregister", expected_version=1)
        self.assertEqual(retried, {**first, "replayed": True})
        self.assertEqual(self.adapter.status(), before)

    def test_initial_preregistration_rejects_corrupt_strategy_binding_without_write(self):
        source = strategies.publish(self.adapter, metadata(), self.source, "source", 0)
        records = DoltRecords(self.config)
        attempt = {"schema_version": 2, "attempt_id": "STRATEGY-BINDING-BAD", "goal_id": "registry-integration", "kind": "strategy",
                   "question": "Can corrupt source bindings be published?", "mechanism": "Exact source verification", "hypothesis": "A mismatch is refused",
                   "parents": [], "code_parent": None, "strategy_binding": {**source["binding"], "source_sha256": "0" * 64},
                   "contract": {"scope": "Disposable refusal probe", "plan": "Attempt a mismatched source binding"},
                   "registration": {"status": "preregistered"},
                   "decision": {"layer": "pending", "outcome": "pending", "scope": "No replay", "next_action": "Verify refusal"}, "evidence_refs": []}
        before = self.adapter.status()
        with self.assertRaisesRegex(RecordError, "binding differs"):
            records.publish_record("attempt", attempt, operation_id="bad-binding", expected_version=1)
        self.assertEqual(self.adapter.status(), before)
        self.assertIsNone(self.adapter.get_object("attempt:STRATEGY-BINDING-BAD"))


if __name__ == "__main__":
    unittest.main()
