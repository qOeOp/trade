"""Publication refusals and compact research context, using invented evidence."""

import copy
import unittest

from research.records.common import RecordError
from research.records.contracts import (
    decision_basis_refs, publication_context_refs, validate_publication_contract,
)
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


if __name__ == "__main__":
    unittest.main()
