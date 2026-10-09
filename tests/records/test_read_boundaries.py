"""Scoped reads keep exact dependencies and report matching incompatibilities."""

import copy
import unittest

from research.records.common import RecordError
from research.records.store import DoltRecords
from tests.records.fixtures.contract_repository import ContractRepository
from tests.records.fixtures.relations import select_relations


class SnapshotAdapter:
    def __init__(self, objects, relations, commit="a" * 32):
        self.objects, self.relations, self.commit = objects, relations, commit
        self.reads, self.gets, self.lists = [], [], []
        self.status_reads = 0

    def status(self):
        self.status_reads += 1
        return {"commit": self.commit}

    def get_object(self, identity, revision=None, commit=None):
        self.reads.append(commit)
        self.gets.append((identity, revision))
        found = [obj for obj in self.objects if obj["id"] == identity
                 and (revision is None or obj["revision"] == revision)]
        return copy.deepcopy(max(found, key=lambda obj: obj["revision"])) if found else None

    def list_objects(self, kind=None, commit=None, latest=True):
        self.reads.append(commit)
        self.lists.append(kind)
        selected = {}
        for obj in self.objects:
            if obj["id"] not in selected or selected[obj["id"]]["revision"] < obj["revision"]:
                selected[obj["id"]] = obj
        return copy.deepcopy([obj for obj in selected.values() if kind is None or obj["kind"] == kind])

    def list_relations(self, commit=None, **filters):
        self.reads.append(commit)
        return select_relations(self.relations, **filters)


class ScopedRecordReads(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = ContractRepository()
        cls.addClassCleanup(cls.fixture.close)
        cls.attempts, cls.runs = cls.fixture.snapshot()

    def setUp(self):
        self.objects = [{"id": kind + ":" + identity, "kind": kind, "revision": 1,
                         "body": copy.deepcopy(body), "provenance": {}}
                        for kind, records in (("attempt", self.attempts), ("run", self.runs))
                        for identity, body in records.items()]
        self.relations = []
        for obj in self.objects:
            body = obj["body"]
            if obj["kind"] == "attempt":
                for ref in body["parents"] + body.get("mechanism_refs", []):
                    self.edge(obj, ref["relationship"], "attempt:" + ref["attempt_id"], {"reference": ref})
                if family := body.get("comparison_family"):
                    for role in ("origin", "factor_a", "factor_b"):
                        self.edge(obj, "comparison_family", "attempt:" + family[role + "_attempt_id"], {"role": role})
                    for cell, identity in family["cells"].items():
                        self.edge(obj, "comparison_cell", "run:" + identity, {"cell": cell})
            else:
                self.edge(obj, "run_of", "attempt:" + body["attempt_id"])
                if body["control_run_id"]:
                    self.edge(obj, "compared_with", "run:" + body["control_run_id"])
        self.adapter = SnapshotAdapter(self.objects, self.relations)
        self.store = DoltRecords.__new__(DoltRecords)
        self.store.adapter = self.adapter

    def edge(self, obj, kind, target, body=None, revision=1):
        self.relations.append({"id": "edge:" + str(len(self.relations)), "kind": kind,
                               "from_id": obj["id"], "from_revision": obj["revision"],
                               "to_id": target, "to_revision": revision, "body": body or {}})

    def object(self, identity, revision=1):
        return next(obj for obj in self.objects if obj["id"] == identity and obj["revision"] == revision)

    def test_show_ignores_unrelated_unsupported_records_but_validate_does_not(self):
        bad = self.object("attempt:H27a")
        bad["body"]["schema_version"] = 999
        attempts, runs, storage = self.store.selected_snapshot(attempt_ids=("H18a",), commit=self.adapter.commit)
        self.assertIn("H18a", attempts)
        self.assertIn("H18a-2026-10-08", runs)
        self.assertIn("H15a-paired-2026-10-08", runs)
        self.assertNotIn((bad["id"], None), self.adapter.gets)
        self.assertEqual(self.adapter.lists, [])
        self.assertEqual(set(self.adapter.reads), {self.adapter.commit})
        self.assertEqual(self.adapter.status_reads, 0)
        self.assertEqual(storage["selected_revisions"]["attempt:H08"], [1])
        with self.assertRaises(RecordError):
            self.store.snapshot(self.adapter.commit)

    def test_related_unsupported_record_fails_with_fixed_identity_and_version(self):
        self.object("attempt:H08")["body"]["schema_version"] = 999
        with self.assertRaisesRegex(RecordError, "attempt:H08@1 schema_version=999") as caught:
            self.store.selected_snapshot(attempt_ids=("H18a",), include_runs=False)
        self.assertEqual(caught.exception.code, "FIXED_DEPENDENCY_UNSUPPORTED")
        self.assertIn("material show attempt:H08 --revision 1", caught.exception.next_actions[0])
        self.assertIn(self.adapter.commit, caught.exception.next_actions[0])

    def test_fixed_history_dependency_does_not_inherit_bad_latest_revision(self):
        old = self.object("attempt:H08")
        current = copy.deepcopy(old)
        current["revision"] = 2
        current["body"]["schema_version"] = 999
        self.objects.append(current)
        attempts, _, storage = self.store.selected_snapshot(attempt_ids=("H18a",), include_runs=False)
        self.assertEqual(attempts["H08"], old["body"])
        self.assertEqual(storage["selected_revisions"]["attempt:H08"], [1])
        self.assertIn(("attempt:H08", 1), self.adapter.gets)
        self.assertNotIn(("attempt:H08", None), self.adapter.gets)

    def test_primary_latest_and_dependency_history_are_explicitly_distinct(self):
        current = copy.deepcopy(self.object("attempt:H08"))
        current["revision"] = 2
        current["body"]["decision"]["next_action"] = "Current revised action."
        self.objects.append(current)
        attempts, _, storage = self.store.selected_snapshot(attempt_ids=("H18a", "H08"), include_runs=False)
        self.assertEqual(attempts["H08"], current["body"])
        self.assertEqual(storage["selected_revisions"]["attempt:H08"], [1, 2])

    def test_missing_fixed_relation_fails_instead_of_falling_back_to_latest(self):
        self.relations[:] = [edge for edge in self.relations if edge["kind"] != "component_reuse"]
        with self.assertRaisesRegex(RecordError, "missing or ambiguous fixed component_reuse"):
            self.store.selected_snapshot(attempt_ids=("H18a",), include_runs=False)

    def test_comparison_family_reads_and_validates_all_fixed_cells(self):
        attempts, runs, _ = self.store.selected_snapshot(attempt_ids=("F01",), include_runs=False)
        self.assertIn("F01", attempts)
        self.assertTrue(set(attempts["F01"]["comparison_family"]["cells"].values()).issubset(runs))
        self.object("run:F01-00-20261008")["body"]["window"]["bar_minutes"] = 15
        with self.assertRaisesRegex(RecordError, "four-cell recorded contracts differ"):
            self.store.selected_snapshot(attempt_ids=("F01",), include_runs=False)

    def test_find_reports_bad_matching_candidates_and_keeps_good_matches(self):
        self.object("attempt:H27a")["body"]["schema_version"] = 999
        attempts, unreadable, storage = self.store.find_snapshot(mechanism="Synthetic", commit=self.adapter.commit)
        self.assertIn("H18a", attempts)
        self.assertEqual([item["id"] for item in unreadable], ["attempt:H27a"])
        self.assertEqual(unreadable[0]["schema_version"], 999)
        self.assertEqual(storage["commit"], self.adapter.commit)
        self.assertEqual(set(self.adapter.reads), {self.adapter.commit})
        self.adapter.gets.clear()
        self.object("attempt:H27a")["body"]["mechanism"] = "Unrelated mechanism"
        _, unreadable, _ = self.store.find_snapshot(mechanism="Synthetic")
        self.assertEqual(unreadable, [])
        self.assertNotIn(("attempt:H27a", None), self.adapter.gets)

    def test_publication_dependency_probe_ignores_unrelated_bad_rows(self):
        self.object("attempt:H27a")["body"]["schema_version"] = 999
        draft = copy.deepcopy(self.attempts["H18a"])
        draft["attempt_id"] = "NEW-TEST"
        result = self.store.validate_dependencies("attempt", draft, commit=self.adapter.commit)
        self.assertEqual(result["commit"], self.adapter.commit)
        self.assertNotIn(("attempt:H27a", None), self.adapter.gets)
        self.assertEqual(self.adapter.lists, [])

    def test_dependency_probe_honors_fixed_parent_revision_and_rejects_cycles(self):
        current = copy.deepcopy(self.object("attempt:H08"))
        current["revision"] = 2
        current["body"]["schema_version"] = 999
        self.objects.append(current)
        draft = copy.deepcopy(self.attempts["H18a"])
        self.store.validate_dependencies("attempt", draft, endpoint_revisions={"attempt:H08": 1})
        with self.assertRaisesRegex(RecordError, "schema_version=999"):
            self.store.validate_dependencies("attempt", draft)
        draft = copy.deepcopy(self.attempts["H08"])
        draft["parents"] = [{"attempt_id": "H08", "relationship": "repair", "difference": "Cycle probe."}]
        with self.assertRaisesRegex(RecordError, "cycle in fixed attempt dependencies"):
            self.store.validate_dependencies("attempt", draft)


if __name__ == "__main__":
    unittest.main()
