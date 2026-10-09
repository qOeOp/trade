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
from research.records.fixtures.contract_repository import ContractRepository
from research.records.store import _preregistration_receipt


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
        with self.assertRaisesRegex(ConflictError, "operation-content"):
            publish(self.store, changed, operation_id="admit", expected_version=4)
        with self.assertRaisesRegex(RecordError, "current target revision"):
            publish(self.store, self.body, operation_id="stale", expected_version=4)

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


class PreregistrationIdentityTests(unittest.TestCase):
    def test_single_receipt_can_only_add_the_original_commit_anchor(self):
        fixture = ContractRepository()
        self.addCleanup(fixture.close)
        with fixture.patches():
            body = json.loads((fixture.records / "attempts/H08/attempt.json").read_text())
            relative = "research/records/preregistrations/H08.json"
            body["registration"] = {"status": "preregistered", "reference": relative}
            body["decision"]["layer"] = body["decision"]["outcome"] = "pending"
            fixture.json(relative, body)
            original = fixture.commit("Register original intent")
            body["registration"]["original_registration_commit"] = original
            mismatched = copy.deepcopy(body)
            mismatched["registration"]["reference"] = "README.md"
            fixture.json(relative, mismatched)
            fixture.commit("Invalid unrelated registration reference")
            with self.assertRaisesRegex(RecordError, "single JSON receipt"):
                _preregistration_receipt(mismatched, fixture.root / relative)
            changed = copy.deepcopy(body)
            changed["hypothesis"] = "A different hypothesis after seeing the result"
            fixture.json(relative, changed)
            fixture.commit("Invalid rewrite")
            with self.assertRaisesRegex(RecordError, "intent changed"):
                _preregistration_receipt(changed, fixture.root / relative)
            fixture.json(relative, body)
            fixture.commit("Add only the original anchor")
            _preregistration_receipt(body, fixture.root / relative)


if __name__ == "__main__":
    unittest.main()
