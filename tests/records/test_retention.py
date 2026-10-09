"""Admission contracts against disposable real Dolt databases."""

import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid

from research.records.common import RecordError
from research.records.dolt_store import DoltStore, ConflictError
from research.records.retention import publish
from research.records.migration import original_bytes
from research.records.reviews import retain_file
from research.records.store import canonical
from tests.records.fixtures.contract_repository import ContractRepository
from research.records.store import DoltRecords, validate_record


class RetentionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("real Dolt requires RESEARCH_DOLT_TEST_CONFIG")
        cls.config = json.loads(raw)

    def setUp(self):
        self.store = DoltStore(dict(self.config, database="records_test_retention_" + uuid.uuid4().hex))
        self.addCleanup(self._remove)
        self.store.initialize()
        self.target = {"id": "section:source#C01", "kind": "material_section", "revision": 1,
                       "body": {"text": "An observation with uncertain scope."}, "provenance": {}}
        self.store.publish([self.target], [], "source", 0)
        self.body = {"schema_version": 1, "target": {"id": self.target["id"], "revision": 1},
                     "disposition": "knowledge", "reviewer": "test Agent", "purpose": "Avoid a repeated source mistake",
                     "value_basis": "The observation changes a specific next decision",
                     "claim": {"statement": "An observation does not prove an order", "scope": "Only C01",
                               "decision_impact": "Do not infer a trade from this chart", "limitations": "No account inference"},
                     "evidence": [{"id": self.target["id"], "revision": 1}],
                     "retention": {"mode": "irreplaceable", "reason": "The original annotation is unavailable upstream"}}

    def _remove(self):
        with self.store._connection(database=False) as connection:
            self.store._sql(connection, f"DROP DATABASE `{self.store.config['database']}`")

    def test_fixed_admission_and_original_retry_after_later_changes(self):
        first = publish(self.store, self.body, operation_id="admit", expected_version=1)
        changed = copy.deepcopy(self.body)
        changed["disposition"] = "archive"
        publish(self.store, changed, operation_id="archive", expected_version=2)
        newer = dict(self.target, revision=2, body={"text": "Corrected observation"})
        self.store.publish([newer], [], "new-source", 3)
        retry = publish(self.store, self.body, operation_id="admit", expected_version=1)
        self.assertTrue(retry["replayed"])
        self.assertEqual(first["commit"], retry["commit"])
        before = self.store.status()
        with self.assertRaisesRegex(ConflictError, "operation-content") as caught:
            publish(self.store, changed, operation_id="admit", expected_version=4)
        self.assertEqual((caught.exception.code, caught.exception.path, caught.exception.write_status),
                         ("ADMISSION_OPERATION_CONFLICT", "/operation_id", "not_written"))
        self.assertIn("original operation may already be committed", " ".join(caught.exception.next_actions))
        self.assertEqual(self.store.operation_receipt("admit")["commit"], first["commit"])
        self.assertEqual(self.store.status(), before)
        with self.assertRaisesRegex(RecordError, "current target revision") as caught:
            publish(self.store, self.body, operation_id="stale", expected_version=4)
        self.assertEqual((caught.exception.code, caught.exception.path),
                         ("ADMISSION_TARGET_STALE", "/target/revision"))

    def test_no_raw_payloads_or_missing_value_claims(self):
        raw = dict(self.target, id="evidence:large", kind="evidence_json")
        self.store.publish([raw], [], "raw", 1)
        invalid = copy.deepcopy(self.body)
        invalid["target"]["id"] = raw["id"]
        with self.assertRaisesRegex(RecordError, "raw payloads"):
            publish(self.store, invalid, operation_id="bad", expected_version=2)
        invalid = copy.deepcopy(self.body)
        invalid["claim"]["decision_impact"] = " "
        with self.assertRaisesRegex(RecordError, "decision_impact"):
            publish(self.store, invalid, operation_id="bad", expected_version=2)
        invalid = copy.deepcopy(self.body)
        invalid["evidence"][0]["revision"] = 9
        with self.assertRaisesRegex(RecordError, "endpoint unavailable"):
            publish(self.store, invalid, operation_id="bad", expected_version=2)
        self.assertEqual(self.store.status()["version"], 2)
        pending = dict(self.target, id="attempt:pending", kind="attempt", body={"decision": {"outcome": "pending"}})
        self.store.publish([pending], [], "pending", 2)
        invalid = copy.deepcopy(self.body)
        invalid["target"]["id"] = pending["id"]
        with self.assertRaisesRegex(RecordError, "pending attempt"):
            publish(self.store, invalid, operation_id="untested", expected_version=3)
        self.assertEqual(self.store.status()["version"], 3)

    def test_rebuildable_claim_requires_verified_external_recipe_and_receipt(self):
        invalid = copy.deepcopy(self.body)
        invalid["schema_version"] = 3
        invalid["retention"] = {"mode": "rebuildable", "reason": "Detailed output can be generated"}
        with self.assertRaisesRegex(RecordError, "recipe_ref"):
            publish(self.store, invalid, operation_id="bad", expected_version=1)
        with tempfile.TemporaryDirectory(prefix="retention-contract-", dir=Path.home()) as directory:
            path = Path(directory) / "proof.json"
            path.write_text('{"verified":true}')
            ref = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            invalid["retention"].update(recipe_ref=ref, verification_ref=ref)
            publish(self.store, invalid, operation_id="good", expected_version=1)
            path.write_text('{"verified":false}')
            replay = publish(self.store, invalid, operation_id="good", expected_version=1)
            self.assertTrue(replay["replayed"])
            with self.assertRaisesRegex(RecordError, "hash mismatch"):
                publish(self.store, invalid, operation_id="bad", expected_version=2)

    def test_reconstruction_bytes_survive_source_removal_and_original_retry(self):
        body = copy.deepcopy(self.body)
        body["schema_version"] = 3
        with tempfile.TemporaryDirectory(prefix="retention-portable-", dir=Path.home()) as directory:
            root = Path(directory)
            recipe, verification = root / "recipe.py", root / "verification.json"
            originals = {"recipe_ref": b"print('fixed reconstruction')\n",
                         "verification_ref": b'{"scope":"fixture","checked":true}\n'}
            body["retention"] = {"mode": "rebuildable", "reason": "Retain the fixed rebuilding inputs"}
            for field, path in (("recipe_ref", recipe), ("verification_ref", verification)):
                path.write_bytes(originals[field])
                body["retention"][field] = {"path": str(path), "sha256": hashlib.sha256(originals[field]).hexdigest()}
            request = copy.deepcopy(body)
            first = publish(self.store, body, operation_id="portable", expected_version=1)
            self.assertEqual(body, request)
            decision = self.store.list_objects(kind="retention_decision", commit=first["commit"])[0]
            for field in ("recipe_ref", "verification_ref"):
                ref = decision["body"]["retention"][field]
                self.assertEqual(set(ref), {"id", "revision"})
                material = self.store.get_object(ref["id"], revision=ref["revision"], commit=first["commit"])
                self.assertEqual(original_bytes(material), originals[field])
            recipe.unlink()
            verification.unlink()
            retry = publish(self.store, request, operation_id="portable", expected_version=1)
            self.assertTrue(retry["replayed"])
            self.assertEqual(first["commit"], retry["commit"])
            for field in ("recipe_ref", "verification_ref"):
                ref = decision["body"]["retention"][field]
                material = self.store.get_object(ref["id"], revision=ref["revision"], commit=first["commit"])
                recovered = root / "relocated" / field
                recovered.parent.mkdir(exist_ok=True)
                recovered.write_bytes(original_bytes(material))
                self.assertEqual(recovered.read_bytes(), originals[field])
            for change in ("path", "sha256", "purpose"):
                changed = copy.deepcopy(request)
                if change == "purpose":
                    changed["purpose"] = "Changed research intent"
                else:
                    changed["retention"]["recipe_ref"][change] = str(root / "other.py") if change == "path" else "0" * 64
                before = self.store.status()
                with self.subTest(change=change), self.assertRaisesRegex(ConflictError, "operation-content") as caught:
                    publish(self.store, changed, operation_id="portable", expected_version=2)
                self.assertEqual((caught.exception.code, caught.exception.path, caught.exception.write_status),
                                 ("ADMISSION_OPERATION_CONFLICT", "/operation_id", "not_written"))
                self.assertTrue(caught.exception.next_actions)
                self.assertEqual(self.store.status(), before)

    def test_fixed_material_refs_reuse_previous_provenance_and_duplicate_proof(self):
        with tempfile.TemporaryDirectory(prefix="retention-reuse-", dir=Path.home()) as directory:
            path = Path(directory) / "proof.txt"
            raw = b"Original independently retained proof\n"
            path.write_bytes(raw)
            ref = {"path": str(path), "sha256": hashlib.sha256(raw).hexdigest()}
            material = retain_file(path, ref["sha256"], origin="existing_review")
            self.store.publish([material], [], "retained-before", 1)
            body = copy.deepcopy(self.body)
            body["schema_version"] = 3
            body["retention"] = {"mode": "rebuildable", "reason": "One source can serve both roles",
                                 "recipe_ref": ref, "verification_ref": ref}
            receipt = publish(self.store, body, operation_id="reuse", expected_version=2)
            retained = self.store.get_object(material["id"], revision=1, commit=receipt["commit"])
            self.assertEqual(retained, material)
            self.assertEqual(len(self.store.list_objects(kind="material")), 1)
            path.unlink()
            fixed = copy.deepcopy(body)
            fixed["retention"]["recipe_ref"] = {"id": material["id"], "revision": 1}
            fixed["retention"]["verification_ref"] = {"id": material["id"], "revision": 1}
            fixed["purpose"] = "Use already retained material without a host file"
            second = publish(self.store, fixed, operation_id="fixed", expected_version=3)
            self.assertEqual(original_bytes(self.store.get_object(material["id"], revision=1, commit=second["commit"])), raw)

    def test_bad_reconstruction_material_or_second_file_leaves_no_partial_publication(self):
        body = copy.deepcopy(self.body)
        body["schema_version"] = 3
        with tempfile.TemporaryDirectory(prefix="retention-atomic-", dir=Path.home()) as directory:
            path = Path(directory) / "proof.txt"
            path.write_bytes(b"valid proof")
            ref = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            body["retention"] = {"mode": "rebuildable", "reason": "Both artifacts must pass",
                                 "recipe_ref": ref, "verification_ref": dict(ref, sha256="0" * 64)}
            before = self.store.status()
            with self.assertRaisesRegex(RecordError, "hash mismatch"):
                publish(self.store, body, operation_id="partial", expected_version=1)
            self.assertEqual(self.store.status(), before)
            self.assertEqual(self.store.list_objects(kind="material"), [])
            candidates = [dict(retain_file(path, ref["sha256"]), id="material:wrong-length", body={"byte_length": 0}),
                          dict(retain_file(path, ref["sha256"]), id="material:bad-base64")]
            candidates[0]["body"] = {**retain_file(path, ref["sha256"])["body"], "byte_length": 0}
            candidates[1]["body"] = {**candidates[1]["body"], "content_base64": "corrupt!"}
            candidates.extend([dict(candidates[0], id="material:wrong-kind", kind="evidence_json"),
                               {"id": "material:missing-bytes", "kind": "material", "revision": 1,
                                "body": {"byte_length": 0}, "provenance": {}}])
            self.store.publish(candidates, [], "invalid-raw-fixtures", 1)
            for candidate in candidates:
                fixed = {"id": candidate["id"], "revision": 1}
                body["retention"].update(recipe_ref=fixed, verification_ref=fixed)
                before = self.store.status()
                with self.subTest(material=candidate["id"]), self.assertRaises(RecordError):
                    publish(self.store, body, operation_id="bad-" + candidate["id"], expected_version=2)
                self.assertEqual(self.store.status(), before)

    def test_old_rebuildable_operation_retries_but_new_path_contract_is_rejected(self):
        body = copy.deepcopy(self.body)
        body["retention"] = {"mode": "rebuildable", "reason": "Historical custody contract",
                             "recipe_ref": {"path": "/missing-historical/recipe", "sha256": "a" * 64},
                             "verification_ref": {"path": "/missing-historical/proof", "sha256": "b" * 64}}
        base = self.store.status()["commit"]
        identity = "retention:" + hashlib.sha256(canonical(body["target"]).encode()).hexdigest()
        decision = {"id": identity, "kind": "retention_decision", "revision": 1,
                    "body": body, "provenance": {"origin": "agent_retention_review"}}
        context = {"id": "publication:" + hashlib.sha256(b"historical").hexdigest(), "kind": "publication", "revision": 1,
                   "body": {"record_id": identity, "record_revision": 1, "base_commit": base},
                   "provenance": {"origin": "retention_publication", "operation_id": "historical"}}
        edges = []
        for kind in ("retention_of", "admission_evidence"):
            edge = {"kind": kind, "from_id": identity, "from_revision": 1, "from_kind": "retention_decision",
                    "to_id": self.target["id"], "to_revision": 1, "to_kind": self.target["kind"], "body": {}}
            edges.append({**edge, "id": "edge:" + hashlib.sha256(canonical(edge).encode()).hexdigest()})
        first = self.store.publish([decision, context], edges, "historical", 1, "review research knowledge retention")
        self.assertEqual(publish(self.store, body, operation_id="historical", expected_version=1)["commit"], first["commit"])
        with self.assertRaisesRegex(RecordError, "require v3"):
            publish(self.store, body, operation_id="new-legacy", expected_version=2)

    def test_review_feedback_repairs_the_factual_declaration_without_partial_writes(self):
        before = self.store.status()
        invalid = copy.deepcopy(self.body)
        invalid["reviewer"] = " "
        with self.assertRaises(RecordError) as caught:
            publish(self.store, invalid, operation_id="reviewed", expected_version=1)
        error = caught.exception.as_dict()
        self.assertEqual((error["code"], error["path"], error["write_status"]),
                         ("ADMISSION_DECLARATION_REQUIRED", "/reviewer", "not_written"))
        self.assertIn("do not invent a review", " ".join(error["next_actions"]))
        self.assertEqual(self.store.status(), before)
        self.assertEqual(self.store.list_objects(kind="retention_decision"), [])
        self.assertEqual(self.store.list_objects(kind="publication"), [])
        first = publish(self.store, self.body, operation_id="reviewed", expected_version=1)
        self.assertEqual(self.store.operation_receipt("reviewed")["commit"], first["commit"])
        retry = publish(self.store, self.body, operation_id="reviewed", expected_version=1)
        self.assertEqual(retry["commit"], first["commit"])
        self.assertTrue(retry["replayed"])


class SnapshotReadBoundaryTests(unittest.TestCase):
    def test_record_snapshot_reads_only_attempts_and_runs_at_one_fixed_commit(self):
        fixture = ContractRepository()
        self.addCleanup(fixture.close)
        attempts, _ = fixture.snapshot()
        fixed = "d" * 32
        calls = []

        class Adapter:
            def status(self):
                return {"commit": fixed}

            def list_objects(self, kind=None, commit=None):
                calls.append((kind, commit))
                if kind == "attempt":
                    return [{"id": "attempt:H08", "kind": "attempt", "body": attempts["H08"]}]
                if kind == "run":
                    return []
                raise AssertionError("record retrieval must not load archived material payloads")

        store = DoltRecords.__new__(DoltRecords)
        store.adapter = Adapter()
        self.assertEqual(store.snapshot(), ({"H08": attempts["H08"]}, {}, {"backend": "dolt", "commit": fixed}))
        self.assertEqual(calls, [("attempt", fixed), ("run", fixed)])


class PreregistrationIdentityTests(unittest.TestCase):
    def test_dolt_contract_requires_scope_plan_and_rejects_git_registration_fields(self):
        fixture = ContractRepository()
        self.addCleanup(fixture.close)
        attempts, _ = fixture.snapshot()
        body = copy.deepcopy(attempts["H08"])
        body["registration"] = {"status": "preregistered"}
        body["decision"].update(layer="pending", outcome="pending")
        validate_record("attempt", body)
        for obsolete in ("reference", "original_registration_commit"):
            invalid = copy.deepcopy(body)
            invalid["registration"][obsolete] = "obsolete Git identity"
            with self.assertRaisesRegex(RecordError, "Additional properties"):
                validate_record("attempt", invalid)
        invalid = copy.deepcopy(body)
        invalid.pop("contract")
        with self.assertRaisesRegex(RecordError, "contract"):
            validate_record("attempt", invalid)
        for field in ("scope", "plan"):
            invalid = copy.deepcopy(body)
            invalid["contract"][field] = ""
            with self.assertRaises(RecordError):
                validate_record("attempt", invalid)


if __name__ == "__main__":
    unittest.main()
