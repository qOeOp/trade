"""Real Dolt checks for immutable lineage and native-custody record bindings.

Opt in with RESEARCH_DOLT_TEST_CONFIG (JSON connection configuration). Every
case uses a disposable randomly named database. Seed data is an explicit Git
fixture import, never evidence for automatic material extraction. Failed seals
below are synthetic registration fixtures; no native replay was performed.
"""

import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid

from research.records import artifacts, cli
from research.records.common import RecordError
from tests.records.fixtures.contract_repository import ContractRepository, v3_pending
from research.records.store import DoltRecords, canonical


class DoltRecordBindingIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("real record binding integration requires RESEARCH_DOLT_TEST_CONFIG")
        cls.connection_config = json.loads(raw)
        if not isinstance(cls.connection_config, dict):
            raise ValueError("RESEARCH_DOLT_TEST_CONFIG must be a JSON object")
        cls.fixture = ContractRepository()
        cls.addClassCleanup(cls.fixture.close)
        cls.context = cls.fixture.patches()
        cls.addClassCleanup(cls.context.close)
        cls.git_commit = cls.fixture.head
        cls.seed_objects = []
        cls.seed_relations = []
        cls.seed_attempts = {}
        cls.seed_runs = {}
        for kind in ("attempt", "run"):
            for path in sorted((cls.fixture.records / f"{kind}s").glob(f"*/{kind}.json")):
                relative = path.relative_to(cls.fixture.root).as_posix()
                raw = subprocess.check_output(["git", "show", f"{cls.git_commit}:{relative}"], cwd=cls.fixture.root)
                body = json.loads(raw)
                identity = f"{kind}:{body[f'{kind}_id']}"
                cls.seed_objects.append({
                    "id": identity, "kind": kind, "revision": 1, "body": body,
                    "provenance": {
                        "origin": "explicit_git_binding_test_fixture", "source_head": cls.git_commit,
                        "git_commit": cls.git_commit, "path": relative,
                        "blob_sha256": hashlib.sha256(raw).hexdigest(),
                        "raw_content_base64": base64.b64encode(raw).decode("ascii"), "locator": "/",
                    },
                })
                (cls.seed_attempts if kind == "attempt" else cls.seed_runs)[body[f"{kind}_id"]] = body
                if kind == "attempt":
                    references = [(item["relationship"], "attempt:" + item["attempt_id"], item)
                                  for item in body["parents"] + body.get("mechanism_refs", [])]
                else:
                    references = [("run_of", "attempt:" + body["attempt_id"], {})]
                    if body["control_run_id"]:
                        references.append(("controlled_by", "run:" + body["control_run_id"], {}))
                for relation_kind, target, detail in references:
                    relation = {"kind": relation_kind, "from_id": identity, "from_revision": 1,
                                "to_id": target, "to_revision": 1,
                                "body": {"reference": detail}}
                    relation["id"] = "binding-fixture:" + hashlib.sha256(canonical(relation).encode()).hexdigest()
                    cls.seed_relations.append(relation)
        expected_attempts, expected_runs = cls.fixture.snapshot()
        if cls.seed_attempts != expected_attempts or cls.seed_runs != expected_runs:
            raise AssertionError("binding seed must retain every synthetic fixture attempt and run")

    def setUp(self):
        self.config = dict(self.connection_config, database="records_test_bindings_" + uuid.uuid4().hex)
        self.store = DoltRecords(self.config)
        self.addCleanup(self._remove_test_database)
        self.store.adapter.initialize()
        self.imported = self.store.adapter.publish(
            self.seed_objects, self.seed_relations, "binding-fixture-import", 0,
            "explicit Git fixture for record binding integration",
        )
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        self.backend_config = self.workspace / "backend.json"
        self.backend_config.write_text(json.dumps(self.config))
        self.backend_config.chmod(0o600)
        self.environment = patch.dict(os.environ, {
            "TRADE_RECORDS_CONFIG": str(self.backend_config), "TRADE_RECORDS_BACKEND": "dolt",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.prereg_id = "BINDING-PREREG-" + uuid.uuid4().hex
        prospective = v3_pending(self.seed_attempts["F01"])
        prospective.update(attempt_id=self.prereg_id, registration={"status": "preregistered"})
        prospective.pop("comparison_family", None)
        prospective["decision"].update(layer="pending", outcome="pending")
        registered = self.store.publish_record(
            "attempt", prospective, operation_id="binding-preregister-" + uuid.uuid4().hex,
            expected_version=self.store.adapter.status()["version"],
        )
        self.prereg_binding = registered["registration_receipt"]

    def _remove_test_database(self):
        self.assertTrue(self.config["database"].startswith("records_test_bindings_"))
        with self.store.adapter._connection(database=False) as connection:
            self.store.adapter._sql(connection, f"DROP DATABASE `{self.config['database']}`")

    def _change_decision(self, identity):
        body = copy.deepcopy(self.store.adapter.get_object("attempt:" + identity)["body"])
        body["decision"]["next_action"] += " Disposable binding integration decision revision."
        before = self.store.adapter.status()
        result = self.store.publish_record(
            "attempt", body, operation_id="binding-test-decision-" + uuid.uuid4().hex,
            expected_version=before["version"],
        )
        self.assertEqual(self.store.adapter.get_object("attempt:" + identity)["revision"], 2)
        return result

    def _git_run_bytes(self):
        return {str(path.relative_to(self.fixture.records)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in (self.fixture.records / "runs").glob("*/run.json")}

    def _failed_seal(self, binding=None):
        run_id = "BINDING-TEST-" + uuid.uuid4().hex
        root = self.workspace / "synthetic-seals"
        archive = root / run_id
        source = archive / "source" / "strategies" / "r1" / "strategy.py"
        source.parent.mkdir(parents=True)
        source.write_bytes(subprocess.check_output(
            ["git", "show", f"{self.git_commit}:strategies/r1/strategy.py"], cwd=self.fixture.root))
        identity = archive / "input_identity.json"
        identity.write_text(json.dumps({
            "nature": "Synthetic record-binding fixture; no catalog was loaded and no native run was performed."
        }))
        manifest = {
            "schema_version": 1, "run_id": run_id, "attempt_id": self.prereg_id, "status": "failed",
            "source_commit": self.git_commit, "nautilus_version": "2.0.0rc3",
            "input_identity_sha256": hashlib.sha256(identity.read_bytes()).hexdigest(),
            "native_exit_code": None, "audit_exit_code": None,
            "problems": ["Synthetic diagnostic registration fixture; no native run or native failure is asserted."],
            "files": artifacts._files(archive),
        }
        if binding is not None:
            manifest["record_binding"] = binding
        (archive / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        self.assertTrue(artifacts.verify(root, run_id)["verified"])
        return root, run_id

    @staticmethod
    def _register(root, run_id):
        return artifacts.register(
            root=root, run_id=run_id, role="diagnostic",
            cost_model="Synthetic record-binding registration fixture; no native replay or economics.",
            control_run_id=None, evidence_grade="unknown",
        )

    def test_lineage_retains_original_component_and_parent_decisions(self):
        original = cli._dolt_lineage(self.store.adapter, "H18a", self.imported["commit"])
        self._change_decision("H08")
        changed = self._change_decision("H15a")
        current = cli._dolt_lineage(self.store.adapter, "H18a", changed["commit"])
        self.assertEqual(current["revision"], 1)
        self.assertEqual(current["mechanism_sources"][0]["source_revision"], 1)
        self.assertEqual(current["mechanism_sources"][0]["source_decision"], self.seed_attempts["H08"]["decision"])
        self.assertEqual(current["mechanism_sources"], original["mechanism_sources"])
        self.assertEqual(current["parents"][0]["record"]["revision"], 1)
        self.assertEqual(current["parents"][0]["record"]["decision"], self.seed_attempts["H15a"]["decision"])
        self.assertEqual({p["record"]["attempt_id"] for p in current["parents"]}, {"H15a"})
        self.assertNotEqual(self.store.adapter.get_object("attempt:H08")["body"]["decision"], current["mechanism_sources"][0]["source_decision"])
        self.assertNotEqual(self.store.adapter.get_object("attempt:H15a")["body"]["decision"], current["parents"][0]["record"]["decision"])

    def test_later_child_decision_retains_registered_parent_and_component_sources(self):
        child = v3_pending(self.seed_attempts["H18a"])
        child["attempt_id"] = "BINDING-CHILD-" + uuid.uuid4().hex
        child["registration"] = {"status": "preregistered"}
        child["decision"].update(layer="pending", outcome="pending")
        first = self.store.publish_record(
            "attempt", child, operation_id="binding-child-register-" + uuid.uuid4().hex,
            expected_version=self.store.adapter.status()["version"],
        )
        original = cli._dolt_lineage(self.store.adapter, child["attempt_id"], first["commit"])
        self._change_decision("H08")
        self._change_decision("H15a")
        decision = copy.deepcopy(child)
        decision["decision"].update(layer="source", outcome="inconclusive", next_action="A later decision only.")
        decision["decision"]["basis"] = {"mode": "source", "evidence_refs": [{"id": "attempt:H08", "revision": 1}]}
        before = self.store.adapter.status()
        for source in ("H08", "H15a"):
            with self.subTest(source=source), self.assertRaisesRegex(RecordError, "cannot rebind"):
                self.store.publish_record(
                    "attempt", decision, operation_id="binding-child-invalid-" + uuid.uuid4().hex,
                    expected_version=before["version"], endpoint_revisions={"attempt:" + source: 2},
                )
            self.assertEqual(self.store.adapter.status(), before)
        operation = "binding-child-decision-" + uuid.uuid4().hex
        published = self.store.publish_record(
            "attempt", decision, operation_id=operation, expected_version=before["version"],
        )
        current = cli._dolt_lineage(self.store.adapter, child["attempt_id"], published["commit"])
        self.assertEqual(current["revision"], 2)
        expected_parents = copy.deepcopy(original["parents"])
        expected_parents[0]["record"]["commit"] = published["commit"]
        self.assertEqual(current["parents"], expected_parents)
        self.assertEqual(current["mechanism_sources"], original["mechanism_sources"])
        context_id = "publication:" + hashlib.sha256(operation.encode()).hexdigest()
        context = self.store.adapter.get_object(context_id, commit=published["commit"])
        self.assertEqual(context["body"]["endpoint_revisions"], {"attempt:H08": 1, "attempt:H15a": 1})
        edges = self.store.adapter.list_relations(commit=published["commit"])
        component = self.store.adapter.get_object("component:FixtureSignal", commit=published["commit"])
        source_revisions = {edge["to_revision"] for edge in edges
                            if edge["kind"] == "component_index" and edge["from_id"] == component["id"]
                            and edge["to_id"] == "attempt:H08"}
        self.assertEqual(source_revisions, {1})
        after = self.store.adapter.status()
        replayed = self.store.publish_record("attempt", decision, operation_id=operation,
                                             expected_version=before["version"], endpoint_revisions={})
        self.assertEqual(replayed, dict(published, replayed=True))
        self.assertEqual(self.store.adapter.status(), after)
        # A new source basis is a new research attempt, not a decision revision.
        new_basis = copy.deepcopy(child)
        new_basis["attempt_id"] = "BINDING-NEW-BASIS-" + uuid.uuid4().hex
        new_record = self.store.publish_record(
            "attempt", new_basis, operation_id="binding-new-basis-" + uuid.uuid4().hex,
            expected_version=after["version"], endpoint_revisions={"attempt:H08": 2, "attempt:H15a": 2},
        )
        new_lineage = cli._dolt_lineage(self.store.adapter, new_basis["attempt_id"], new_record["commit"])
        self.assertEqual(new_lineage["parents"][0]["record"]["revision"], 2)
        self.assertEqual(new_lineage["mechanism_sources"][0]["source_revision"], 2)

    def test_start_binding_reads_original_preregistered_revision_after_update(self):
        original, binding = artifacts._attempt_snapshot(self.prereg_id)
        self.assertEqual(binding, self.prereg_binding)
        self._change_decision(self.prereg_id)
        current, current_binding = artifacts._attempt_snapshot(self.prereg_id)
        retained, retained_binding = artifacts._attempt_snapshot(self.prereg_id, binding)
        self.assertEqual(current_binding, binding)
        self.assertEqual(current, original)
        self.assertEqual(retained, original)
        self.assertEqual(retained_binding, binding)

    def test_registration_time_is_the_native_commit_in_utc(self):
        from datetime import datetime, timedelta, timezone
        from research.records.store import registration_time
        commit = self.prereg_binding["commit"]
        registered = registration_time(self.store.adapter, self.prereg_id, commit)
        self.assertEqual(registered.utcoffset(), timedelta(0))
        self.assertLess(abs(datetime.now(timezone.utc) - registered), timedelta(minutes=10))

    def test_failed_seal_cannot_be_registered_as_independent(self):
        _, binding = artifacts._attempt_snapshot(self.prereg_id)
        root, run_id = self._failed_seal(binding)
        before = self.store.adapter.status()
        with self.assertRaises(RecordError) as caught:
            artifacts.register(root=root, run_id=run_id, role="diagnostic",
                               cost_model="Synthetic record-binding registration fixture; no native replay or economics.",
                               control_run_id=None, evidence_grade="independent")
        self.assertEqual(caught.exception.code, "EVIDENCE_EXPOSURE_CONTRADICTION")
        self.assertEqual(self.store.adapter.status(), before)

    def test_seal_registration_freezes_attempt_revision_and_retries_persistently(self):
        before_git = self._git_run_bytes()
        _, binding = artifacts._attempt_snapshot(self.prereg_id)
        root, run_id = self._failed_seal(binding)
        self._change_decision(self.prereg_id)
        registered = self._register(root, run_id)
        self.assertTrue(registered["publication"]["commit"])
        record = self.store.adapter.get_object("run:" + run_id)
        self.assertEqual(record["revision"], 1)
        self.assertEqual(record["body"]["role"], "diagnostic")
        self.assertEqual(record["body"]["integrity"], "failed")
        self.assertEqual(record["body"]["raw_reports"], "sealed_local")
        self.assertIn("no native run", record["body"]["failure_reasons"][0])
        self.assertEqual(record["provenance"]["record_binding"], binding)
        self.assertEqual(record["provenance"]["binding_origin"], "sealed_start")
        edges = [edge for edge in self.store.adapter.list_relations()
                 if edge["kind"] == "run_of" and edge["from_id"] == "run:" + run_id]
        self.assertEqual(len(edges), 1)
        self.assertEqual((edges[0]["to_id"], edges[0]["to_revision"]), ("attempt:" + self.prereg_id, 1))
        self.assertEqual(self.store.adapter.get_object("attempt:" + self.prereg_id)["revision"], 2)
        self.assertEqual(cli._check_source_revision(record["body"]), "verified")
        self.assertEqual(self._git_run_bytes(), before_git)
        self.assertFalse((self.fixture.records / "runs" / run_id / "run.json").exists())
        before = self.store.adapter.status()
        # register opens a fresh DoltRecords adapter for every call; recovery is persistent.
        recovered = self._register(root, run_id)
        self.assertEqual(recovered["publication"], dict(registered["publication"], replayed=True))
        self.assertEqual(recovered["publication"]["commit"], registered["publication"]["commit"])
        self.assertEqual(self.store.adapter.status(), before)
        self.assertEqual(self._git_run_bytes(), before_git)
        self.assertTrue(artifacts.verify(root, run_id)["verified"])

    def test_lineage_contract_changes_require_a_new_attempt_identity(self):
        a_id, b_id, c_id = "BINDING-DAG-A", "BINDING-DAG-B", "BINDING-DAG-C"
        a = copy.deepcopy(self.seed_attempts["H08"])
        a.update(attempt_id=a_id, parents=[], evidence_refs=[], code_parent=None,
                 question="Synthetic binding immutable lineage fixture.")
        a.pop("mechanism_refs", None)
        a.pop("comparison_family", None)

        def publish(body):
            return self.store.publish_record(
                "attempt", body, operation_id="binding-test-dag-" + uuid.uuid4().hex,
                expected_version=self.store.adapter.status()["version"],
            )

        publish(a)
        b = copy.deepcopy(a)
        b.update(attempt_id=b_id, parents=[{
            "attempt_id": a_id, "relationship": "hypothesis_extension",
            "difference": "Synthetic fixture: B references A.",
        }])
        publish(b)
        changed = copy.deepcopy(a)
        changed["parents"] = [{
            "attempt_id": b_id, "relationship": "hypothesis_extension",
            "difference": "This would change A's initial registered lineage.",
        }]
        before = self.store.adapter.status()
        with self.assertRaisesRegex(RecordError, "registration contract"):
            publish(changed)
        self.assertEqual(before, self.store.adapter.status())
        changed["attempt_id"] = c_id
        published = publish(changed)
        fixed = cli._dolt_lineage(self.store.adapter, c_id, published["commit"])
        self.assertEqual((fixed["attempt_id"], fixed["revision"]), (c_id, 1))
        parent = fixed["parents"][0]["record"]
        self.assertEqual((parent["attempt_id"], parent["revision"]), (b_id, 1))
        ancestor = parent["parents"][0]["record"]
        self.assertEqual((ancestor["attempt_id"], ancestor["revision"]), (a_id, 1))
        self.assertEqual(ancestor["parents"], [])

    def test_unbound_seal_is_rejected(self):
        before_git = self._git_run_bytes()
        root, run_id = self._failed_seal()
        before = self.store.adapter.status()
        with self.assertRaisesRegex(artifacts.ArtifactError, "binding"):
            self._register(root, run_id)
        self.assertEqual(self.store.adapter.status(), before)
        self.assertIsNone(self.store.adapter.get_object("run:" + run_id))
        self.assertEqual(self._git_run_bytes(), before_git)
        self.assertTrue(artifacts.verify(root, run_id)["verified"])


if __name__ == "__main__":
    unittest.main()
