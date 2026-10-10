"""Publication refusals and compact research context, using invented evidence."""

import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch

from research.records.common import RecordError
from research.records.contracts import (
    decision_basis_refs, publication_context_refs, validate_publication_contract,
)
from research.records.retention import publish
from research.records.dolt_store import DoltStore
from research.records.store import validate_record


def attempt(version=3, *, pending=False):
    body = {
        "schema_version": version, "attempt_id": "TEST-01", "goal_id": "synthetic",
        "kind": "strategy", "question": "Can fixed evidence be retrieved?",
        "mechanism": "Synthetic mechanism", "hypothesis": "A bounded synthetic test",
        "parents": [], "code_parent": None, "registration": {"status": "preregistered"},
        "contract": {"scope": "Synthetic tests only", "plan": "Exercise the publication boundary"},
        "decision": {"layer": "pending" if pending else "economics",
                     "outcome": "pending" if pending else "failed",
                     "scope": "Synthetic tests only", "next_action": "Keep the failed result"},
        "evidence_refs": [],
    }
    if version == 3:
        body["purpose"] = "research"
        body["contract"]["selection"] = {
            "family_id": "synthetic-family", "primary_response": "final_equity_usdt",
            "known_exposure": {"status": "unknown", "run_refs": []},
        }
        if not pending:
            body["decision"]["basis"] = {"mode": "paired",
                                         "candidate_run_ref": {"id": "run:candidate", "revision": 1},
                                         "evidence_refs": []}
    return body


def evidence_objects():
    native = {"input_identity_sha256": "a" * 64, "window": {"bar_minutes": 1440},
              "account": {"starting_balance_usdt": "100000"}, "cost_model": "synthetic",
              "nautilus_version": "2.0.0rc3", "integrity": "passed"}
    candidate = {"id": "run:candidate", "kind": "run", "revision": 1,
                 "body": dict(native, attempt_id="TEST-01", role="candidate", control_run_id="control")}
    control = {"id": "run:control", "kind": "run", "revision": 2,
               "body": dict(native, attempt_id="CONTROL-01", role="control", control_run_id=None)}
    source = {"id": "section:source", "kind": "material_section", "revision": 1,
              "body": {"text": "An invented source observation"}}
    objects = {(obj["id"], obj["revision"]): obj for obj in (candidate, control, source)}
    relations = [{"kind": "compared_with", "from_id": candidate["id"], "from_revision": 1,
                  "to_id": control["id"], "to_revision": 2}]
    return objects, relations


class PublicationContractTests(unittest.TestCase):
    def setUp(self):
        self.objects, self.relations = evidence_objects()

    def validate(self, body):
        validate_record("attempt", body)
        validate_publication_contract(
            "attempt", body, previous={"body": body},
            object_lookup=lambda identity, revision: self.objects.get((identity, revision)),
            relations=self.relations,
        )

    def test_historical_v2_and_new_pending_v3_are_readable(self):
        self.validate(attempt(2))
        self.validate(attempt(pending=True))
        with self.assertRaises(RecordError) as caught:
            validate_publication_contract("attempt", attempt(2, pending=True))
        self.assertEqual(caught.exception.code, "NEW_REGISTRATION_CONTRACT")
        validate_publication_contract("attempt", attempt(pending=True))

    def test_enriched_contract_requires_only_reviewed_fields(self):
        for path in (("purpose",), ("contract", "selection"),
                     ("contract", "selection", "family_id"),
                     ("contract", "selection", "primary_response"),
                     ("contract", "selection", "known_exposure", "status"),
                     ("contract", "selection", "known_exposure", "run_refs")):
            body = attempt(pending=True)
            selected = body
            for key in path[:-1]:
                selected = selected[key]
            selected.pop(path[-1])
            with self.subTest(path=path), self.assertRaises(RecordError):
                validate_record("attempt", body)
        body = attempt(pending=True)
        body["contract"]["selection"]["run_budget"] = 10
        with self.assertRaises(RecordError):
            validate_record("attempt", body)

    def test_fixed_candidate_derives_its_exact_control_revision(self):
        # A later control must not replace the candidate's registered control.
        newer = copy.deepcopy(self.objects[("run:control", 2)])
        newer["revision"] = 3
        newer["body"]["cost_model"] = "different costs"
        self.objects[(newer["id"], 3)] = newer
        body = attempt()
        self.validate(body)
        refs = decision_basis_refs(body, relations=self.relations)
        self.assertIn(("control", {"id": "run:control", "revision": 2}), refs)
        self.assertNotIn("control_run_ref", body["decision"]["basis"])
        body["decision"]["basis"]["control_run_ref"] = {"id": "run:control", "revision": 3}
        with self.assertRaises(RecordError):
            validate_record("attempt", body)

    def test_missing_or_ambiguous_registered_control_refuses_pair(self):
        for relations in ([], self.relations * 2):
            self.relations = relations
            with self.subTest(edges=len(relations)), self.assertRaises(RecordError) as caught:
                self.validate(attempt())
            self.assertEqual(caught.exception.code, "decision_control_ambiguous")
            self.assertEqual(caught.exception.write_status, "not_written")
            self.assertTrue(caught.exception.next_actions)

    def test_unavailable_exposure_is_not_accepted_as_known_history(self):
        body = attempt(pending=True)
        exposure = body["contract"]["selection"]["known_exposure"]
        exposure["status"] = "development_exposed"
        exposure["run_refs"] = [{"id": "run:invented", "revision": 1}]
        with self.assertRaises(RecordError) as caught:
            self.validate(body)
        self.assertEqual(caught.exception.code, "fixed_reference_unavailable")
        exposure["run_refs"] = [{"id": "run:candidate", "revision": 1}]
        self.validate(body)
        self.assertIn(("known_exposure", exposure["run_refs"][0]), publication_context_refs(body))

    def test_inspected_results_cannot_be_declared_unexposed(self):
        body = attempt(pending=True)
        body["contract"]["selection"]["known_exposure"] = {
            "status": "unexposed_declared", "run_refs": [{"id": "run:candidate", "revision": 1}]}
        with self.assertRaises(RecordError) as caught:
            self.validate(body)
        self.assertEqual(caught.exception.code, "EXPOSURE_CONTRADICTION")
        body["contract"]["selection"]["known_exposure"]["status"] = "unknown"
        self.validate(body)

    def test_realized_family_keeps_the_registered_primary_response(self):
        body = attempt(pending=True)
        body["comparison_family"] = {"family_id": "different", "primary_response": "final_equity_usdt"}
        for field in ("family_id", "primary_response"):
            body["comparison_family"][field] = "different"
            with self.subTest(field=field), self.assertRaises(RecordError) as caught:
                validate_publication_contract("attempt", body, previous={"body": body})
            self.assertEqual(caught.exception.code, "SELECTION_CONTRACT_MISMATCH")
            body["comparison_family"][field] = body["contract"]["selection"][field]

    def _independent_case(self):
        from datetime import datetime, timezone
        binding = {"database": "research_records", "commit": "c" * 32, "strategy_id": "s", "revision": 1,
                   "source_sha256": "a" * 64, "entry_class": "PublishedR1Strategy", "runtime_contract": "r1-native-v2"}
        initial = attempt(pending=True)
        initial["contract"]["selection"]["known_exposure"] = {
            "status": "development_exposed", "run_refs": [{"id": "run:developed", "revision": 1}]}
        initial["strategy_binding"] = binding
        run = {"attempt_id": "TEST-01", "run_id": "confirmation", "control_run_id": None,
               "evidence_grade": "independent", "strategy_binding": dict(binding),
               "window": {"input_start_utc": "2026-10-01T00:00:00Z",
                          "trade_start_utc": "2026-10-10T00:05:00+00:00"}}
        registered = datetime(2026, 10, 10, 0, 0, 0, 840000, tzinfo=timezone.utc)
        return run, (lambda id, rev: {"body": initial}), (lambda identity: registered)

    def test_confirmation_after_a_frozen_registration_may_be_independent(self):
        run, lookup, registered_at = self._independent_case()
        validate_publication_contract("run", run, object_lookup=lookup, registered_at=registered_at)
        run["window"]["trade_start_utc"] = "2026-10-10T09:05:00+09:00"
        validate_publication_contract("run", run, object_lookup=lookup, registered_at=registered_at)

    def test_independent_grade_needs_frozen_strategy_later_window_and_snapshot(self):
        cases = {
            "window starts at registration": lambda run: run["window"].update(trade_start_utc="2026-10-10T09:00:00+09:00"),
            "window starts before registration": lambda run: run["window"].update(trade_start_utc="2026-10-09T00:00:00+00:00"),
            "no window": lambda run: run.pop("window"),
            "naive window start": lambda run: run["window"].update(trade_start_utc="2026-10-10T00:05:00"),
            "unparseable window start": lambda run: run["window"].update(trade_start_utc="soon"),
            "no strategy binding": lambda run: run.pop("strategy_binding"),
            "different strategy revision": lambda run: run["strategy_binding"].update(revision=2),
        }
        for name, change in cases.items():
            run, lookup, registered_at = self._independent_case()
            change(run)
            with self.subTest(name), self.assertRaises(RecordError) as caught:
                validate_publication_contract("run", run, object_lookup=lookup, registered_at=registered_at)
            self.assertEqual(caught.exception.code, "EVIDENCE_EXPOSURE_CONTRADICTION")
            self.assertEqual(caught.exception.write_status, "not_written")
        run, lookup, registered_at = self._independent_case()
        for missing in ({"object_lookup": lookup}, {"registered_at": registered_at}, {}):
            with self.subTest(missing=sorted(missing)), self.assertRaises(RecordError) as caught:
                validate_publication_contract("run", run, **missing)
            self.assertEqual(caught.exception.code, "EVIDENCE_EXPOSURE_CONTRADICTION")

    def test_invalid_registration_refuses_but_backend_errors_propagate(self):
        run, lookup, _ = self._independent_case()

        def retrospective(identity):
            raise RecordError("initial attempt is not a pending Dolt preregistration")

        def unavailable(identity):
            raise RecordError("Dolt SQL error", code="DOLT_SQL_ERROR")

        with self.assertRaises(RecordError) as caught:
            validate_publication_contract("run", run, object_lookup=lookup, registered_at=retrospective)
        self.assertEqual(caught.exception.code, "EVIDENCE_EXPOSURE_CONTRADICTION")
        with self.assertRaises(RecordError) as caught:
            validate_publication_contract("run", run, object_lookup=lookup, registered_at=unavailable)
        self.assertEqual(caught.exception.code, "DOLT_SQL_ERROR")

    def test_development_grades_do_not_need_registration_time(self):
        run, lookup, _ = self._independent_case()
        for grade in ("development_exposed", "unknown"):
            run["evidence_grade"] = grade
            validate_publication_contract("run", run, object_lookup=lookup)

    def test_source_failure_and_inconclusive_diagnostics_can_be_published(self):
        source = {"id": "section:source", "revision": 1}
        body = attempt()
        body["decision"].update(layer="source", outcome="failed",
                                basis={"mode": "source", "evidence_refs": [source]})
        self.validate(body)
        body["decision"].update(layer="execution", outcome="inconclusive",
                                basis={"mode": "descriptive", "candidate_run_ref":
                                       {"id": "run:candidate", "revision": 1}, "evidence_refs": []})
        self.objects[("run:candidate", 1)]["body"]["integrity"] = "failed"
        self.validate(body)
        body["decision"].pop("basis")
        with self.assertRaises(RecordError):
            validate_record("attempt", body)

    def test_candidate_belongs_to_attempt_and_pair_contracts_match(self):
        self.objects[("run:candidate", 1)]["body"]["attempt_id"] = "ANOTHER"
        with self.assertRaises(RecordError) as caught:
            self.validate(attempt())
        self.assertEqual(caught.exception.code, "decision_candidate_mismatch")
        self.objects[("run:candidate", 1)]["body"]["attempt_id"] = "TEST-01"
        self.objects[("run:control", 2)]["body"]["cost_model"] = "different"
        with self.assertRaises(RecordError) as caught:
            self.validate(attempt())
        self.assertEqual(caught.exception.code, "decision_pair_incomparable")

    def test_pending_pairs_and_self_duplicate_lineage_are_rejected(self):
        body = attempt(2, pending=True)
        body["decision"]["outcome"] = "failed"
        with self.assertRaises(RecordError) as caught:
            validate_publication_contract("attempt", body, previous={"body": body})
        self.assertEqual(caught.exception.code, "pending_state_mismatch")
        body = attempt(2, pending=True)
        body["parents"] = [{"attempt_id": "TEST-01", "relationship": "repair", "difference": "self"}]
        with self.assertRaises(RecordError) as caught:
            validate_publication_contract("attempt", body, previous={"body": body})
        self.assertEqual(caught.exception.code, "self_lineage")
        body["parents"] = [{"attempt_id": "OTHER", "relationship": "repair", "difference": "bounded"}] * 2
        with self.assertRaises(RecordError) as caught:
            validate_publication_contract("attempt", body, previous={"body": body})
        self.assertEqual(caught.exception.code, "duplicate_lineage")
        with self.assertRaises(RecordError) as caught:
            validate_publication_contract("run", {"run_id": "self", "control_run_id": "self"})
        self.assertEqual(caught.exception.code, "self_control")


class AdmissionAliasTests(unittest.TestCase):
    def setUp(self):
        self.target = {"id": "component:Synthetic", "kind": "component", "revision": 1,
                       "body": {"name": "Synthetic"}, "provenance": {}}
        target = self.target

        class Adapter:
            def status(self):
                return {"commit": "a" * 32, "dirty": False}

            def get_object(self, identity, *, revision=None, commit=None):
                return target if identity == target["id"] and revision in (None, 1) else None

            def publish(self, objects, relations, operation_id, expected_version, message):
                return {"objects": objects, "relations": relations}

        self.adapter = Adapter()
        self.body = {
            "schema_version": 2, "target": {"id": target["id"], "revision": 1},
            "disposition": "knowledge", "reviewer": "Synthetic Agent declaration",
            "purpose": "Exercise bounded retrieval", "value_basis": "Names find a fixed component",
            "claim": {"statement": "A synthetic component", "scope": "Synthetic tests only",
                      "decision_impact": "Reuse only the stated component", "limitations": "No economics",
                      "aliases": ["synthetic support", "合成支撑"]},
            "evidence": [{"id": target["id"], "revision": 1}],
            "retention": {"mode": "minimal_record", "reason": "Small synthetic component claim"},
        }

    def publish(self):
        return publish(self.adapter, self.body, operation_id="synthetic-alias", expected_version=0)

    def test_aliases_are_bound_to_fixed_component_admission(self):
        result = self.publish()
        self.assertEqual(result["objects"][0]["body"]["claim"]["aliases"], self.body["claim"]["aliases"])
        self.target["kind"] = "material_section"
        with self.assertRaises(RecordError) as caught:
            self.publish()
        self.assertEqual(caught.exception.code, "ADMISSION_ALIASES_TARGET")

    def test_aliases_are_bounded_and_not_case_duplicates(self):
        for aliases in ([], ["x"] * 9, ["Support", "support"], [" name"], ["x\ny"], ["x" * 81]):
            self.body["claim"]["aliases"] = aliases
            with self.subTest(aliases=aliases), self.assertRaises(RecordError) as caught:
                self.publish()
            self.assertEqual(caught.exception.code, "ADMISSION_ALIASES_INVALID")

    def test_legacy_admission_does_not_gain_aliases_implicitly(self):
        self.body["schema_version"] = 1
        with self.assertRaises(RecordError):
            self.publish()
        self.body["claim"].pop("aliases")
        self.publish()


class AdmissionFeedbackTests(unittest.TestCase):
    """Repair guidance identifies the failed fact without inviting fabricated proof."""

    def setUp(self):
        fixture = AdmissionAliasTests()
        fixture.setUp()
        self.body = copy.deepcopy(fixture.body)
        target = copy.deepcopy(fixture.target)
        self.objects = {(target["id"], target["revision"]): target}
        objects = self.objects

        class Adapter:
            dirty = False

            def status(self):
                return {"commit": "a" * 32, "dirty": self.dirty}

            def get_object(self, identity, *, revision=None, commit=None):
                if revision is not None:
                    return objects.get((identity, revision))
                versions = [obj for (key, _), obj in objects.items() if key == identity]
                return max(versions, key=lambda obj: obj["revision"]) if versions else None

            def publish(self, *args):
                return {"published": True}

        self.adapter = Adapter()

    def refusal(self, body, code, path):
        with patch.object(self.adapter, "publish", wraps=self.adapter.publish) as writer:
            with self.assertRaises(RecordError) as caught:
                publish(self.adapter, body, operation_id="feedback", expected_version=0)
            writer.assert_not_called()
        error = caught.exception
        self.assertEqual((error.code, error.path, error.write_status), (code, path, "not_written"))
        self.assertIsNotNone(error.expected)
        self.assertTrue(error.next_actions)
        return error

    def test_required_review_judgements_identify_exact_fields(self):
        for path in (("reviewer",), ("purpose",), ("value_basis",),
                     ("claim", "statement"), ("claim", "scope"),
                     ("claim", "decision_impact"), ("claim", "limitations"),
                     ("retention", "reason")):
            body = copy.deepcopy(self.body)
            item = body
            for key in path[:-1]:
                item = item[key]
            item[path[-1]] = " "
            with self.subTest(path=path):
                error = self.refusal(body, "ADMISSION_DECLARATION_REQUIRED", "/" + "/".join(path))
                self.assertIn("do not invent", " ".join(error.next_actions))
        body = copy.deepcopy(self.body)
        body.pop("reviewer")
        self.refusal(body, "ADMISSION_CONTRACT_INVALID", "/reviewer")

    def test_claim_shape_and_utf8_size_keep_scope_and_negative_evidence(self):
        body = copy.deepcopy(self.body)
        body["claim"].pop("limitations")
        self.refusal(body, "ADMISSION_CLAIM_INVALID", "/claim/limitations")
        body = copy.deepcopy(self.body)
        body["claim"]["statement"] = "证" * 3000
        error = self.refusal(body, "ADMISSION_CLAIM_TOO_LARGE", "/claim")
        self.assertIn("negative results", " ".join(error.next_actions))

    def test_retention_and_disposition_errors_guide_truthful_custody(self):
        cases = (("disposition", "arbitrary", "ADMISSION_DISPOSITION_INVALID", "/disposition"),
                 ("mode", "unverified", "ADMISSION_RETENTION_MODE", "/retention/mode"))
        for field, value, code, path in cases:
            body = copy.deepcopy(self.body)
            selected = body if field == "disposition" else body["retention"]
            selected[field] = value
            with self.subTest(field=field):
                self.refusal(body, code, path)
        body = copy.deepcopy(self.body)
        body["retention"]["recipe_ref"] = {"id": "material:unknown", "revision": 1}
        self.refusal(body, "ADMISSION_RECONSTRUCTION_MODE", "/retention/mode")

    def test_fixed_target_and_evidence_errors_identify_actual_reference(self):
        for field, path in (("target", "/target"), ("evidence", "/evidence/0")):
            for ref, code in (({"id": "missing", "revision": 0}, "ADMISSION_REFERENCE_INVALID"),
                              ({"id": "missing", "revision": 1}, "ADMISSION_REFERENCE_UNAVAILABLE")):
                body = copy.deepcopy(self.body)
                body[field] = ref if field == "target" else [ref]
                with self.subTest(field=field, code=code):
                    self.refusal(body, code, path)
        body = copy.deepcopy(self.body)
        body["evidence"] = []
        self.refusal(body, "ADMISSION_EVIDENCE_REQUIRED", "/evidence")

    def test_pending_raw_and_stale_targets_require_actual_review(self):
        body = copy.deepcopy(self.body)
        body["claim"].pop("aliases")
        target = self.objects[(body["target"]["id"], 1)]
        target["kind"] = "evidence_json"
        self.refusal(body, "ADMISSION_TARGET_KIND", "/target")
        target.update(kind="attempt", body={"decision": {"outcome": "pending"}})
        error = self.refusal(body, "ADMISSION_TARGET_PENDING", "/target")
        self.assertIn("Failed or inconclusive", " ".join(error.next_actions))
        target["body"]["decision"]["outcome"] = "failed"
        newer = copy.deepcopy(target)
        newer["revision"] = 2
        self.objects[(newer["id"], 2)] = newer
        error = self.refusal(body, "ADMISSION_TARGET_STALE", "/target/revision")
        self.assertEqual(error.expected, 2)
        self.assertIn("without reviewing", " ".join(error.next_actions))

    def test_dirty_refusal_does_not_discard_another_agents_work(self):
        self.adapter.dirty = True
        error = self.refusal(self.body, "ADMISSION_DIRTY_WORKING_SET", "/database/working_set")
        self.assertIn("do not automatically discard", " ".join(error.next_actions))

    def test_reconstruction_fixed_material_faults_are_field_specific(self):
        import base64
        import hashlib

        raw = b"actual original"
        original = {"id": "material:proof", "kind": "material", "revision": 1,
                    "body": {"sha256": hashlib.sha256(raw).hexdigest(), "byte_length": len(raw),
                             "content_base64": base64.b64encode(raw).decode()}, "provenance": {}}
        body = copy.deepcopy(self.body)
        body["schema_version"] = 3
        ref = {"id": original["id"], "revision": 1}
        body["retention"].update(mode="rebuildable", recipe_ref=ref, verification_ref=ref)
        self.refusal(body, "RECONSTRUCTION_MATERIAL_UNAVAILABLE", "/retention/recipe_ref")
        for change, code in (({"kind": "run"}, "RECONSTRUCTION_MATERIAL_KIND"),
                             ({"body": []}, "RECONSTRUCTION_MATERIAL_BYTES"),
                             ({"body": dict(original["body"], content_base64="corrupt!")}, "RECONSTRUCTION_MATERIAL_BYTES"),
                             ({"body": dict(original["body"], byte_length=0)}, "RECONSTRUCTION_MATERIAL_LENGTH")):
            self.objects[(original["id"], 1)] = dict(original, **change)
            with self.subTest(code=code):
                self.refusal(body, code, "/retention/recipe_ref")
        self.objects[(original["id"], 1)] = original
        body["retention"]["verification_ref"] = {"id": original["id"], "revision": True}
        self.refusal(body, "RECONSTRUCTION_REFERENCE_INVALID", "/retention/verification_ref")

    def test_reconstruction_file_shape_custody_and_hash_errors_are_actionable(self):
        import hashlib

        with tempfile.TemporaryDirectory(prefix="admission-feedback-", dir=Path.home()) as directory:
            path = Path(directory) / "proof.txt"
            path.write_bytes(b"actual independently reviewed proof")
            ref = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            cases = (({"path": str(path)}, "RECONSTRUCTION_REFERENCE_INVALID", "/retention/recipe_ref"),
                     (dict(ref, path=17), "RECONSTRUCTION_INPUT_SHAPE", "/retention/recipe_ref"),
                     (dict(ref, path="relative-proof.txt"), "RECONSTRUCTION_PATH_INVALID", "/retention/recipe_ref/path"),
                     (dict(ref, path="/invalid\x00original"), "RECONSTRUCTION_PATH_INVALID", "/retention/recipe_ref/path"),
                     (dict(ref, path=str(Path(tempfile.gettempdir()) / "temporary-proof")), "RECONSTRUCTION_CUSTODY_PATH", "/retention/recipe_ref/path"),
                     (dict(ref, sha256="INVALID"), "RECONSTRUCTION_HASH_INVALID", "/retention/recipe_ref/sha256"),
                     (dict(ref, sha256="0" * 64), "RECONSTRUCTION_INPUT_UNAVAILABLE", "/retention/recipe_ref"),
                     (dict(ref, path=str(path.parent / "missing")), "RECONSTRUCTION_INPUT_UNAVAILABLE", "/retention/recipe_ref"))
            for incoming, code, location in cases:
                body = copy.deepcopy(self.body)
                body["schema_version"] = 3
                body["retention"].update(mode="rebuildable", recipe_ref=incoming, verification_ref=ref)
                with self.subTest(code=code, location=location):
                    self.refusal(body, code, location)
            body["retention"]["recipe_ref"] = ref
            with patch("research.records.reviews.retain_file", side_effect=RecordError("original changed during reading")):
                self.refusal(body, "RECONSTRUCTION_INPUT_UNAVAILABLE", "/retention/recipe_ref")

    def test_unconfirmed_adapter_write_is_never_reported_not_written(self):
        failure = RecordError("response was lost after submitting the publication")
        with patch.object(self.adapter, "publish", side_effect=failure) as writer:
            with self.assertRaises(RecordError) as caught:
                publish(self.adapter, self.body, operation_id="uncertain", expected_version=0)
            writer.assert_called_once()
        self.assertIs(caught.exception, failure)
        self.assertEqual(caught.exception.write_status, "unknown")


class AdmissionAliasDoltTests(unittest.TestCase):
    """Verify new alias content uses the existing atomic immutable protocol."""

    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("real Dolt requires RESEARCH_DOLT_TEST_CONFIG")
        cls.config = json.loads(raw)

    def setUp(self):
        self.adapter = DoltStore(dict(self.config, database="records_test_alias_" + uuid.uuid4().hex))
        self.adapter.initialize()
        self.addCleanup(self.remove_database)
        fixture = AdmissionAliasTests()
        fixture.setUp()
        self.body = fixture.body
        self.adapter.publish([fixture.target], [], "source", 0)

    def remove_database(self):
        with self.adapter._connection(database=False) as connection:
            self.adapter._sql(connection, f"DROP DATABASE `{self.adapter.config['database']}`")

    def test_fixed_component_aliases_persist_and_original_retry_is_immutable(self):
        result = publish(self.adapter, self.body, operation_id="admit", expected_version=1)
        changed = copy.deepcopy(self.body)
        changed["claim"]["aliases"] = ["new reviewed name"]
        publish(self.adapter, changed, operation_id="new-review", expected_version=2)
        retry = publish(self.adapter, self.body, operation_id="admit", expected_version=1)
        self.assertEqual(retry["commit"], result["commit"])
        self.assertTrue(retry["replayed"])
        historical = self.adapter.list_objects(kind="retention_decision", commit=result["commit"])
        self.assertEqual(historical[0]["body"]["claim"]["aliases"], self.body["claim"]["aliases"])

    def test_bad_aliases_refuse_without_any_database_change(self):
        before = self.adapter.status()
        self.body["claim"]["aliases"] = ["Support", "support"]
        with self.assertRaises(RecordError):
            publish(self.adapter, self.body, operation_id="bad", expected_version=1)
        self.assertEqual(self.adapter.status(), before)
        self.assertEqual(self.adapter.list_objects(kind="retention_decision"), [])


if __name__ == "__main__":
    unittest.main()
