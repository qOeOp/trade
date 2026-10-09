"""Dolt-owned prospective intent remains frozen without product Git receipts."""

import copy
import json
import os
import unittest
import uuid

from research.records.common import RecordError
from research.records.dolt_store import ConflictError
from research.records.store import DoltRecords


def pending():
    return {
        "schema_version": 1, "attempt_id": "DOLT-PROBE", "goal_id": "contract-test",
        "kind": "diagnostic", "question": "Synthetic source custody test",
        "mechanism": "Freeze prospective intent in one Dolt publication",
        "hypothesis": "Frozen first revision remains available after the decision changes",
        "parents": [], "code_parent": None,
        "registration": {"status": "preregistered", "backend": "dolt", "reference": "dolt:attempt:DOLT-PROBE@1"},
        "decision": {"layer": "pending", "outcome": "pending", "scope": "Synthetic test only", "next_action": "Check the contract"},
        "evidence_refs": [],
    }


class DoltPreregistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("requires isolated Dolt integration server")
        cls.config = json.loads(raw)

    def setUp(self):
        self.store = DoltRecords(dict(self.config, database="records_test_prereg_" + uuid.uuid4().hex))
        self.store.adapter.initialize()
        self.addCleanup(self.clean)

    def clean(self):
        with self.store.adapter._connection(database=False) as conn:
            self.store.adapter._sql(conn, f"DROP DATABASE `{self.store.adapter.config['database']}`")

    def publish(self, body, operation="preregister"):
        return self.store.publish_record("attempt", body, operation_id=operation,
                                         expected_version=self.store.adapter.status()["version"])

    def test_frozen_intent_retries_after_later_decision(self):
        body = pending()
        first = self.publish(body)
        later = copy.deepcopy(body)
        later["decision"] = {"layer": "execution", "outcome": "passed", "scope": "Synthetic test", "next_action": "Stop"}
        self.publish(later, "decision")
        self.assertEqual(self.store.adapter.get_object("attempt:DOLT-PROBE", commit=first["commit"])["body"], body)
        retry = self.publish(body)
        self.assertEqual(retry["commit"], first["commit"])
        self.assertTrue(retry["replayed"])
        changed = copy.deepcopy(later)
        changed["registration"]["reference"] = "dolt:attempt:DOLT-PROBE@2"
        with self.assertRaisesRegex(ConflictError, "original registration"):
            self.publish(changed, "rewrite-registration")

    def test_first_results_and_wrong_reference_are_rejected(self):
        body = pending()
        body["decision"]["outcome"] = "passed"
        with self.assertRaisesRegex(RecordError, "pending/pending"):
            self.publish(body)
        body = pending()
        body["registration"]["reference"] = "dolt:attempt:OTHER@1"
        with self.assertRaisesRegex(RecordError, "immutable first"):
            self.publish(body)
        self.assertIsNone(self.store.adapter.get_object("attempt:DOLT-PROBE"))

    def test_legacy_git_path_still_requires_its_receipt(self):
        body = pending()
        body["registration"].pop("backend")
        with self.assertRaisesRegex(RecordError, "committed receipt_path"):
            self.publish(body)


if __name__ == "__main__":
    unittest.main()
