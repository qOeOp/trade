"""Small revision-bound fixtures for useful research recall and correction scope."""

import base64
import copy
import unittest
from unittest.mock import patch

from research.records.common import RecordError
from research.records.ledger import material
from research.records.retrieval import corrections, search


def obj(identity, kind, body, revision=1):
    return {"id": identity, "kind": kind, "revision": revision, "body": body,
            "provenance": {"origin": "historical_import", "path": "source.md"}}


def admission(target, *, disposition="knowledge", revision=1, statement="A bounded source correction."):
    return obj("retention:" + target["id"], "retention_decision", {
        "target": {"id": target["id"], "revision": target["revision"]},
        "disposition": disposition, "reviewer": "Agent fixture",
        "purpose": "Avoid repeating a source attribution error.",
        "value_basis": "The distinction changes the next research decision.",
        "claim": {"statement": statement, "scope": "Only the source attribution.",
                  "decision_impact": "Do not use this source to select a stop.",
                  "limitations": "No change to historical native account outcomes."},
    }, revision)


class SnapshotAdapter:
    def __init__(self, objects, relations=(), commit="fixed-snapshot"):
        self.objects = objects
        self.relations = list(relations)
        self.commit = commit
        self.reads = []
        self.object_lists = []
        self.object_gets = []

    def status(self):
        return {"commit": self.commit}

    def list_objects(self, kind=None, *, commit, latest=True):
        self.reads.append(commit)
        self.object_lists.append((kind, latest))
        selected = [item for item in self.objects if kind is None or item["kind"] == kind]
        if latest:
            current = {}
            for item in selected:
                if item["id"] not in current or item["revision"] > current[item["id"]]["revision"]:
                    current[item["id"]] = item
            selected = list(current.values())
        return copy.deepcopy(selected)

    def list_relations(self, *, commit):
        self.reads.append(commit)
        return copy.deepcopy(self.relations)

    def get_object(self, identity, *, revision=None, commit):
        self.reads.append(commit)
        self.object_gets.append((identity, revision))
        found = [item for item in self.objects if item["id"] == identity
                 and (revision is None or item["revision"] == revision)]
        return copy.deepcopy(max(found, key=lambda item: item["revision"])) if found else None


class RetrievalTests(unittest.TestCase):
    def test_research_id_does_not_match_hash_ids_hash_text_or_encoded_bytes(self):
        direct = obj("attempt:D99", "attempt", {"attempt_id": "D99", "question": "Capacity?"})
        reuse = obj("attempt:H29a", "attempt", {"attempt_id": "H29a", "mechanism": "Extend D99 capacity."})
        hex_value = "abcd99" + "a" * 58
        noise = [obj("reference:" + hex_value, "reference", {"target": hex_value}),
                 obj("attempt:H01", "attempt", {"attempt_id": "H01", "question": hex_value}),
                 obj("material:encoded", "material", {"content_base64": "D99"}),
                 obj("evidence_json:run", "evidence_json", {"sha256": hex_value})]
        for include_archive in (False, True):
            result = search([direct, reuse, *noise], [], "d99", include_archive=include_archive)
            self.assertEqual(result["query_mode"], "research_id")
            self.assertEqual([item["id"] for item in result["matches"]], ["attempt:D99", "attempt:H29a"])

    def test_archive_search_is_explicit_and_import_is_not_knowledge_admission(self):
        section = obj("section:source#C02", "material_section",
                      {"explicit_id": "C02", "title": "C02 wick", "text": "A wick is insufficient."})
        original = obj("material:source", "material", {"title": "Archive", "text": "A wick is insufficient."})
        self.assertEqual(search([section, original], [], "wick")["matches"], [])
        archived = search([section, original], [], "wick", include_archive=True)
        self.assertEqual(len(archived["matches"]), 2)
        self.assertTrue(all(item["scope"] == "legacy_archive" and item["knowledge_admission"] is None
                            for item in archived["matches"]))

    def test_current_knowledge_searches_reviewed_claim_not_original_section(self):
        section = obj("section:source#C02", "material_section", {
            "explicit_id": "C02", "title": "Historical interpretation",
            "text": "An old outside-zone stop rationale and a long historical log.",
        })
        approved = admission(section, statement="The source gives no numeric stop boundary.")
        objects = [section, approved]
        self.assertEqual(search(objects, [], "outside-zone")["matches"], [])
        result = search(objects, [], "numeric stop")["matches"]
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["scope"], "admitted_knowledge")
        self.assertEqual(result[0]["claim"], approved["body"]["claim"])
        self.assertEqual(result[0]["knowledge_admission"]["target"], {"id": section["id"], "revision": 1})
        self.assertEqual(search(objects, [], "C02")["matches"][0]["id"], section["id"])
        retained = search(objects, [], "outside-zone", include_archive=True)["matches"]
        self.assertEqual(retained[0]["scope"], "legacy_archive")
        self.assertEqual(retained[0]["match_basis"], "retained_source")
        self.assertEqual(retained[0]["claim"], approved["body"]["claim"])

    def test_new_source_revision_requires_a_new_admission(self):
        old = obj("section:source#C02", "material_section", {"explicit_id": "C02"})
        current = obj(old["id"], old["kind"], {"explicit_id": "C02", "text": "Changed source."}, 2)
        self.assertEqual(search([old, current, admission(old)], [], "C02")["matches"], [])
        archived = search([old, current, admission(old)], [], "C02", include_archive=True)["matches"]
        self.assertEqual([(item["id"], item["revision"]) for item in archived], [(current["id"], 2)])

    def test_latest_archive_decision_retracts_knowledge_without_rewriting_source(self):
        section = obj("section:source#C02", "material_section", {"explicit_id": "C02", "text": "Retained bytes."})
        original = copy.deepcopy(section)
        self.assertEqual(search([section, admission(section), admission(section, disposition="archive", revision=2)],
                                [], "C02")["matches"], [])
        self.assertEqual(section, original)

    def test_full_document_and_every_heading_do_not_become_default_results(self):
        raw = "# Source\n## C02\nWick and resistance are different observations."
        full = obj("material:source", "material", {"text": raw, "content_base64": base64.b64encode(raw.encode()).decode()})
        heading = obj("section:source#heading-source", "material_section", {"text": raw})
        case = obj("section:source#C02", "material_section", {"explicit_id": "C02", "text": "Wick and resistance."})
        result = search([full, heading, case, admission(case, statement="A wick does not select a resistance stop.")],
                        [], "wick")["matches"]
        self.assertEqual([item["id"] for item in result], [case["id"]])

    def test_small_attempt_decisions_and_run_identity_remain_discoverable(self):
        attempt = obj("attempt:H27a", "attempt", {"attempt_id": "H27a", "decision": {
            "layer": "economics", "outcome": "failed", "scope": "Native account failed its return goal."}})
        run = obj("run:H27a-year", "run", {"run_id": "H27a-year", "attempt_id": "H27a", "integrity": "passed"})
        matches = search([attempt, run], [], "H27a")["matches"]
        self.assertEqual([item["scope"] for item in matches], ["research_decision", "native_run_identity"])
        self.assertTrue(all(item["knowledge_admission"] is None for item in matches))
        self.assertEqual(matches[0]["decision"]["outcome"], "failed")

    def test_explicit_component_reuse_is_searchable_without_searching_receipts(self):
        attempt = obj("attempt:H18a", "attempt", {"attempt_id": "H18a", "mechanism_refs": [
            {"attempt_id": "H08", "component": "ConfirmedLineSupportTouches",
             "boundary": "Reuse state computation only."}]})
        matches = search([attempt], [], "ConfirmedLineSupportTouches")["matches"]
        self.assertEqual([item["id"] for item in matches], ["attempt:H18a"])

    def test_admitted_component_is_discoverable_by_exact_declared_symbol(self):
        symbol = "ConfirmedLineSupportTouches"
        for field in ("name", "component_id"):
            with self.subTest(field=field):
                component = obj("component:" + symbol, "component", {
                    field: symbol, "text": "Historical implementation diagnostic.",
                    "content_base64": base64.b64encode(symbol.encode()).decode(),
                })
                approved = admission(component, statement="已确认支撑触碰状态可供后续实验复用。")
                hash_value = "a" * 64
                noise = obj("component:" + hash_value, "component", {"name": "Unrelated",
                            "text": symbol, "description": hash_value})
                prose = obj("section:other", "material_section", {"name": symbol, "text": symbol})
                objects = [component, approved, noise, admission(noise), prose, admission(prose)]
                result = search(objects, [], symbol.lower())
                self.assertEqual(result["query_mode"], "text")
                self.assertEqual([item["id"] for item in result["matches"]], [component["id"]])
                match = result["matches"][0]
                self.assertEqual(match["scope"], "admitted_knowledge")
                self.assertEqual(match["match_basis"], "declared_id")
                self.assertEqual(match["claim"], approved["body"]["claim"])
                for query in ("ConfirmedLineSupport", "Historical implementation diagnostic", hash_value,
                              component["id"]):
                    self.assertEqual(search(objects, [], query)["matches"], [])

    def test_read_projection_uses_one_snapshot_for_objects_and_relations(self):
        adapter = SnapshotAdapter([obj("attempt:D99", "attempt", {"attempt_id": "D99"})])
        result = material(adapter, "search", at="historical-snapshot", query="D99")
        self.assertEqual(result["commit"], "historical-snapshot")
        self.assertEqual(set(adapter.reads), {"historical-snapshot"})

    def test_default_loader_reads_only_record_kinds_and_admitted_targets(self):
        section = obj("section:source#C02", "material_section", {"explicit_id": "C02", "text": "Archived payload."})
        huge = obj("evidence_json:huge", "evidence_json", {"text": "A raw report never loaded by this search."})
        adapter = SnapshotAdapter([section, huge, admission(section)])
        result = material(adapter, "search", at="historical-snapshot", query="C02")
        self.assertEqual([item["id"] for item in result["matches"]], [section["id"]])
        self.assertEqual(adapter.object_lists, [("attempt", True), ("run", True), ("retention_decision", True)])
        self.assertEqual(adapter.object_gets, [(section["id"], None)])
        self.assertEqual(set(adapter.reads), {"historical-snapshot"})

    def test_default_loader_does_not_apply_old_admission_to_new_source(self):
        old = obj("section:source#C02", "material_section", {"explicit_id": "C02"})
        current = obj(old["id"], old["kind"], {"explicit_id": "C02"}, 2)
        adapter = SnapshotAdapter([old, current, admission(old)])
        self.assertEqual(material(adapter, "search", query="C02")["matches"], [])

    def test_show_does_not_inventory_unrelated_large_materials(self):
        source = obj("section:source#C02", "material_section", {"explicit_id": "C02", "text": "Source bytes."})
        huge = obj("evidence_json:huge", "evidence_json", {"text": "Unrelated large report."})
        adapter = SnapshotAdapter([source, huge])
        result = material(adapter, "show", at="historical-snapshot", identity=source["id"], brief=True)
        self.assertEqual(result["object"]["id"], source["id"])
        self.assertEqual(adapter.object_lists, [("retention_decision", True)])
        self.assertEqual(adapter.object_gets, [(source["id"], None)])
        self.assertEqual(set(adapter.reads), {"historical-snapshot"})

    def test_archive_expansion_is_the_only_unqualified_inventory_read(self):
        adapter = SnapshotAdapter([obj("material:source", "material", {"text": "Archived source."})])
        result = material(adapter, "search", query="source", include_archive=True)
        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(adapter.object_lists, [(None, False)])

    def test_empty_query_rejects_instead_of_dumping_the_archive(self):
        with self.assertRaisesRegex(RecordError, "nonempty"):
            search([], [], "  ", include_archive=True)


class CorrectionTests(unittest.TestCase):
    def setUp(self):
        self.old = obj("section:source#C02", "material_section", {"explicit_id": "C02", "text": "Outside-zone stop."})
        self.current = obj(self.old["id"], self.old["kind"], {"explicit_id": "C02", "text": "No stop specified."}, 2)
        self.d94 = obj("section:research#D94", "material_section", {"explicit_id": "D94", "text": "Original premise."})
        self.unrelated = obj("section:other#D94", "material_section", {"explicit_id": "D94", "text": "Same label."})
        self.review = obj("review:fixed", "review_decision", {
            "status": "resolved", "evidence_refs": [{"id": self.d94["id"], "revision": 1}],
        })
        self.edge = {"id": "edge:correction", "kind": "corrects", "from_id": self.current["id"],
                     "from_revision": 2, "to_id": self.old["id"], "to_revision": 1,
                     "body": {"review_id": self.review["id"], "review_revision": 1,
                              "scope": {"fields": ["Source attribution only."],
                                        "retained_research_decisions": [
                                            {"object_ref": "d94_section", "preserve": "Native outcomes remain valid."}]}}}
        self.objects = [self.old, self.current, self.d94, self.unrelated, self.review]

    def test_correction_keeps_fixed_revisions_narrow_scope_and_preserved_outcomes(self):
        before = copy.deepcopy(self.objects)
        old = corrections(self.old, self.objects, [self.edge])[0]
        self.assertEqual(old["effect"], "corrected_source_revision")
        self.assertEqual(old["to_ref"], {"id": self.old["id"], "revision": 1})
        self.assertEqual(old["from_ref"], {"id": self.current["id"], "revision": 2})
        historical = corrections(self.d94, self.objects, [self.edge])[0]
        self.assertEqual(historical["effect"], "scoped_source_correction")
        self.assertEqual(historical["preserve"], "Native outcomes remain valid.")
        self.assertEqual(corrections(self.unrelated, self.objects, [self.edge]), [])
        self.assertEqual(self.objects, before)

    def test_superseded_review_does_not_present_old_correction_as_active(self):
        superseding = obj(self.review["id"], self.review["kind"], {"status": "pending"}, 2)
        self.assertEqual(corrections(self.old, [*self.objects, superseding], [self.edge]), [])

    def test_search_and_show_expose_correction_without_invalidating_the_whole_record(self):
        approved = admission(self.current, statement="C02 specifies no numeric stop.")
        results = search([*self.objects, approved], [self.edge], "C02")["matches"]
        self.assertEqual(results[0]["corrections"][0]["effect"], "source_correction")
        adapter = SnapshotAdapter(self.objects, [self.edge])
        with patch("research.records.reviews.active_resolutions", return_value=[]):
            shown = material(adapter, "show", identity=self.d94["id"], at="historical-snapshot", brief=True)
        self.assertEqual(shown["object"]["body"]["explicit_id"], "D94")
        self.assertEqual(shown["corrections"][0]["preserve"], "Native outcomes remain valid.")
        self.assertEqual(set(adapter.reads), {"historical-snapshot"})


if __name__ == "__main__":
    unittest.main()
