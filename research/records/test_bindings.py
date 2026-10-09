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
from research.records.fixtures.contract_repository import ContractRepository
from research.records.store import DoltRecords, GitHistoryStore, canonical


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
        expected_attempts, expected_runs, _ = GitHistoryStore().snapshot()
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
            "schema_version": 1, "run_id": run_id, "attempt_id": "F01", "status": "failed",
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

    def test_start_binding_reads_original_preregistered_revision_after_update(self):
        original, binding = artifacts._attempt_snapshot("F01")
        self.assertEqual(binding, {"id": "attempt:F01", "revision": 1, "commit": self.imported["commit"]})
        self._change_decision("F01")
        current, current_binding = artifacts._attempt_snapshot("F01")
        retained, retained_binding = artifacts._attempt_snapshot("F01", binding)
        self.assertEqual(current_binding["revision"], 2)
        self.assertNotEqual(current["decision"], original["decision"])
        self.assertEqual(retained, original)
        self.assertEqual(retained_binding, binding)

    def test_seal_registration_freezes_attempt_revision_and_retries_persistently(self):
        before_git = self._git_run_bytes()
        _, binding = artifacts._attempt_snapshot("F01")
        root, run_id = self._failed_seal(binding)
        self._change_decision("F01")
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
        self.assertEqual((edges[0]["to_id"], edges[0]["to_revision"]), ("attempt:F01", 1))
        self.assertEqual(self.store.adapter.get_object("attempt:F01")["revision"], 2)
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

    def test_revision_dag_remains_valid_when_latest_ids_project_a_cycle(self):
        a_id, b_id = "BINDING-DAG-A", "BINDING-DAG-B"
        a = copy.deepcopy(self.seed_attempts["H08"])
        a.update(attempt_id=a_id, parents=[], evidence_refs=[], code_parent=None,
                 question="Synthetic binding revision-DAG integration fixture.")
        a["registration"]["status"] = "retrospective"
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
            "difference": "Synthetic fixture: B revision 1 references A revision 1.",
        }])
        publish(b)
        a2 = copy.deepcopy(a)
        a2["parents"] = [{
            "attempt_id": b_id, "relationship": "hypothesis_extension",
            "difference": "Synthetic fixture: A revision 2 references B revision 1.",
        }]
        published = publish(a2)
        fixed = cli._dolt_lineage(self.store.adapter, a_id, published["commit"])
        self.assertEqual((fixed["attempt_id"], fixed["revision"]), (a_id, 2))
        parent = fixed["parents"][0]["record"]
        self.assertEqual((parent["attempt_id"], parent["revision"]), (b_id, 1))
        ancestor = parent["parents"][0]["record"]
        self.assertEqual((ancestor["attempt_id"], ancestor["revision"]), (a_id, 1))
        self.assertEqual(ancestor["parents"], [])
        latest = {a_id: a2, b_id: b}
        with self.assertRaisesRegex(RecordError, "cycle"):
            cli._lineage(a_id, latest)
        with self.assertRaisesRegex(RecordError, "cycle"):
            cli._validate(latest, {})
        # Dolt's fixed revision graph was checked above; a latest-ID projection
        # must not replace it or reject a valid A@2 -> B@1 -> A@1 graph.
        validated = cli._validate(latest, {}, check_lineage=False)
        self.assertEqual((validated["attempts"], validated["runs"]), (2, 0))
        self.assertEqual(validated["attempt_evidence_status"], {a_id: [], b_id: []})

    def test_unbound_legacy_seal_without_retained_registration_is_rejected(self):
        before_git = self._git_run_bytes()
        root, run_id = self._failed_seal()
        before = self.store.adapter.status()
        with self.assertRaisesRegex(artifacts.ArtifactError, "legacy seal.*binding.*retained registration"):
            self._register(root, run_id)
        self.assertEqual(self.store.adapter.status(), before)
        self.assertIsNone(self.store.adapter.get_object("run:" + run_id))
        self.assertEqual(self._git_run_bytes(), before_git)
        self.assertTrue(artifacts.verify(root, run_id)["verified"])


if __name__ == "__main__":
    unittest.main()
