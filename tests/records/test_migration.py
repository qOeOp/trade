"""Small synthetic material imports and Dolt record consumer checks.

Opt in with RESEARCH_DOLT_TEST_CONFIG (JSON connection configuration). Native
The suite scans an isolated Git fixture, including two source revisions, and
publishes only into one randomly named disposable database. No native replay
or formal research database is used.
"""

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid

from research.records import cli, migration
from research.records.common import RecordError
from research.records.dolt_store import ConflictError
from research.records.materials import scan
from tests.records.fixtures.contract_repository import ContractRepository, SOURCE_CASES, OLD_CASES, CURRENT_CASES, v3_pending
from research.records.store import DoltRecords, validate_record


class DoltMigrationIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("real migration integration requires RESEARCH_DOLT_TEST_CONFIG")
        config = json.loads(raw)
        if not isinstance(config, dict):
            raise ValueError("RESEARCH_DOLT_TEST_CONFIG must be a JSON object")
        cls.config = dict(config, database="records_test_migration_" + uuid.uuid4().hex)
        cls.store = DoltRecords(cls.config)
        cls.addClassCleanup(cls._remove_test_database)
        cls.store.adapter.initialize()
        cls.fixture = ContractRepository()
        cls.addClassCleanup(cls.fixture.close)
        cls.context = cls.fixture.patches()
        cls.addClassCleanup(cls.context.close)
        cls.fixture_attempts, cls.fixture_runs = cls.fixture.snapshot()
        cls.historical_commit = cls.fixture.historical_commit
        cls.c02_id = f"section:{SOURCE_CASES}#C02"
        cls.inventory = scan(cls.fixture.root, include_untracked=False,
                             historical_refs=cls.fixture.historical_refs())
        cls.imported = migration.publish(cls.store.adapter, cls.inventory)
        cls.fixture.seed_records(cls.store)
        cls.baseline_commit = cls.store.adapter.status()["commit"]

    @classmethod
    def _remove_test_database(cls):
        if not cls.config["database"].startswith("records_test_migration_"):
            raise AssertionError("cleanup refuses a non-test database")
        with cls.store.adapter._connection(database=False) as conn:
            cls.store.adapter._sql(conn, f"DROP DATABASE `{cls.config['database']}`")

    def _baseline_records(self):
        return cli._load_records(store=self.store, commit=self.baseline_commit)

    def _attempt_copy(self, prefix="TEST"):
        body = copy.deepcopy(self.fixture_attempts["H08"])
        body["attempt_id"] = prefix + "-" + uuid.uuid4().hex
        return body

    def _publish_record(self, kind, body, operation_id=None, **kwargs):
        return self.store.publish_record(
            kind, body, operation_id=operation_id or "migration-test-" + uuid.uuid4().hex,
            expected_version=self.store.adapter.status()["version"], **kwargs,
        )

    def test_attempt_a_to_b_to_a_appends_third_revision(self):
        original = self._attempt_copy("ABA")
        first = self._publish_record("attempt", original)
        changed = copy.deepcopy(original)
        changed["decision"]["next_action"] += " Changed decision B."
        self._publish_record("attempt", changed)
        third = self._publish_record("attempt", original)
        identity = "attempt:" + original["attempt_id"]
        self.assertEqual(self.store.adapter.get_object(identity)["revision"], 3)
        self.assertEqual(self.store.adapter.get_object(identity)["body"], original)
        self.assertEqual(self.store.adapter.get_object(identity, commit=first["commit"])["revision"], 1)
        self.assertNotEqual(first["commit"], third["commit"])

    def test_completed_operation_recovers_frozen_components_after_target_update(self):
        source = self._attempt_copy("COMPONENT-SOURCE")
        self._publish_record("attempt", source)
        dependent = self._attempt_copy("COMPONENT-CONSUMER")
        component_name = "test_component_" + uuid.uuid4().hex
        dependent["mechanism_refs"] = [{
            "attempt_id": source["attempt_id"], "relationship": "component_reuse",
            "component": component_name, "boundary": "Disposable component index fixture.",
        }]
        operation = "migration-component-" + uuid.uuid4().hex
        before = self.store.adapter.status()
        result = self.store.publish_record("attempt", dependent, operation_id=operation,
                                          expected_version=before["version"])
        component = self.store.adapter.get_object("component:" + component_name, commit=result["commit"])
        self.assertIsNotNone(component)
        edges = self.store.adapter.list_relations(commit=result["commit"])
        consumers = {edge["to_id"] for edge in edges if edge["kind"] == "component_index"
                     and edge["from_id"] == component["id"] and edge["from_revision"] == component["revision"]}
        self.assertEqual(consumers, {"attempt:" + source["attempt_id"], "attempt:" + dependent["attempt_id"]})
        source["decision"]["next_action"] += " Target advances after consumer publication."
        self._publish_record("attempt", source)
        after = self.store.adapter.status()
        recovered = self.store.publish_record("attempt", dependent, operation_id=operation,
                                             expected_version=before["version"])
        self.assertEqual(recovered, dict(result, replayed=True))
        self.assertEqual(after, self.store.adapter.status())
        fixed = [edge for edge in edges if edge["kind"] == "component_reuse"
                 and edge["from_id"] == "attempt:" + dependent["attempt_id"]]
        self.assertEqual(len(fixed), 1)
        self.assertEqual(fixed[0]["to_revision"], 1)
        changed = copy.deepcopy(dependent)
        changed["decision"]["next_action"] += " Different request."
        with self.assertRaisesRegex(ConflictError, "operation-content"):
            self.store.publish_record("attempt", changed, operation_id=operation,
                                      expected_version=before["version"])

    def test_publication_projects_family_cells_and_declared_evidence(self):
        body = copy.deepcopy(self.store.adapter.get_object("attempt:F01")["body"])
        body["decision"]["next_action"] += " Disposable family projection validation."
        result = self._publish_record("attempt", body)
        obj = self.store.adapter.get_object("attempt:F01", commit=result["commit"])
        edges = [edge for edge in self.store.adapter.list_relations(commit=result["commit"])
                 if edge["from_id"] == obj["id"] and edge["from_revision"] == obj["revision"]]
        self.assertEqual(len([edge for edge in edges if edge["kind"] == "comparison_family"]), 3)
        self.assertEqual({edge["body"]["cell"] for edge in edges if edge["kind"] == "comparison_cell"},
                         {"00", "10", "01", "11"})
        evidence = [edge for edge in edges if edge["kind"] == "evidence_ref"]
        self.assertEqual(len(evidence), len(body["evidence_refs"]) + 1)
        for edge in evidence:
            reference = self.store.adapter.get_object(edge["to_id"], revision=edge["to_revision"],
                                                      commit=result["commit"])
            self.assertEqual(reference["kind"], "reference")
            self.assertEqual(reference["body"]["path"], edge["body"]["reference"]["path"])
            self.assertEqual(reference["body"]["declared_sha256"], edge["body"]["reference"]["sha256"])
            self.assertNotIn("content_base64", reference["body"])

    def test_run_of_uses_explicit_revision_and_persists_recovery_binding(self):
        source = self._attempt_copy("FIXED-RUN-SOURCE")
        self._publish_record("attempt", source)
        source["decision"]["next_action"] += " Second source revision."
        self._publish_record("attempt", source)
        run = copy.deepcopy(self.fixture_runs["F01-11-20261008"])
        run.update(run_id="FIXED-RUN-" + uuid.uuid4().hex, attempt_id=source["attempt_id"],
                   role="diagnostic", integrity="failed", raw_reports="unavailable",
                   control_run_id="F01-10-20261008", failure_reasons=["No native backtest executed."])
        for field in ("window", "summary_ref", "audit_ref", "artifact_manifest_ref"):
            run.pop(field, None)
        operation = "migration-fixed-run-" + uuid.uuid4().hex
        binding = {"attempt:" + source["attempt_id"]: 1}
        result = self._publish_record("run", run, operation_id=operation, endpoint_revisions=binding)
        edges = [edge for edge in self.store.adapter.list_relations(commit=result["commit"])
                 if edge["from_id"] == "run:" + run["run_id"]]
        self.assertEqual([edge["to_revision"] for edge in edges if edge["kind"] == "run_of"], [1])
        self.assertEqual(len([edge for edge in edges if edge["kind"] == "compared_with"]), 1)
        self.assertFalse(any(edge["kind"] == "controlled_by" for edge in edges))
        context_id = "publication:" + hashlib.sha256(operation.encode()).hexdigest()
        context = self.store.adapter.get_object(context_id, commit=result["commit"])
        self.assertEqual(context["body"]["endpoint_revisions"], binding)
        self.assertEqual(self._publish_record("run", run, operation_id=operation),
                         dict(result, replayed=True))
        with self.assertRaisesRegex(ConflictError, "endpoint revisions"):
            self._publish_record("run", run, operation_id=operation,
                                 endpoint_revisions={next(iter(binding)): 2})
        before = self.store.adapter.status()
        with self.assertRaisesRegex(RecordError, "must be a dictionary"):
            self._publish_record("run", run, endpoint_revisions="invalid")
        self.assertEqual(before, self.store.adapter.status())

    def test_first_preregistration_is_committed_only_to_dolt(self):
        body = v3_pending(self._attempt_copy("PREREG"))
        body["registration"] = {"status": "preregistered"}
        body["decision"].update(layer="pending", outcome="pending")
        before = self.store.adapter.status()
        nonpending = copy.deepcopy(body)
        nonpending["decision"].update(layer="source", outcome="passed",
                                     basis={"mode": "source", "evidence_refs": [{"id": "attempt:H08", "revision": 1}]})
        with self.assertRaisesRegex(RecordError, "pending/pending"):
            self._publish_record("attempt", nonpending)
        self.assertEqual(before, self.store.adapter.status())
        first = self._publish_record("attempt", body)
        frozen = copy.deepcopy(body)
        identity = "attempt:" + body["attempt_id"]
        binding = {"id": identity, "revision": 1, "commit": first["commit"]}
        self.assertEqual(first["registration_receipt"], binding)
        self.assertEqual(self.store.registration_snapshot(body["attempt_id"]), (frozen, binding))
        body["decision"].update(layer="source", outcome="failed", scope="A later result scope",
                                next_action="A later next research decision")
        body["decision"]["basis"] = {"mode": "source", "evidence_refs": [{"id": "attempt:H08", "revision": 1}]}
        result = self._publish_record("attempt", body)
        self.assertEqual(result["registration_receipt"], binding)
        self.assertEqual(self.store.adapter.get_object(identity)["revision"], 2)
        self.assertEqual(self.store.registration_snapshot(body["attempt_id"]), (frozen, binding))
        self.assertEqual(self.store.registration_snapshot(body["attempt_id"], binding), (frozen, binding))
        wrong = dict(binding, commit=result["commit"])
        with self.assertRaisesRegex(RecordError, "first committed"):
            self.store.registration_snapshot(body["attempt_id"], wrong)
        self.assertFalse((self.fixture.records / "preregistrations").exists())

    def test_run_publication_defaults_to_initial_registration_not_latest_decision(self):
        body = v3_pending(self._attempt_copy("PREREG-RUN"))
        body["registration"] = {"status": "preregistered"}
        body["decision"].update(layer="pending", outcome="pending")
        self._publish_record("attempt", body)
        later = copy.deepcopy(body)
        later["decision"].update(layer="economics", outcome="failed")
        later["decision"]["basis"] = {"mode": "descriptive", "evidence_refs": [{"id": "attempt:H08", "revision": 1}]}
        self._publish_record("attempt", later)
        run = copy.deepcopy(self.fixture_runs["F01-11-20261008"])
        run.update(run_id="PREREG-RUN-" + uuid.uuid4().hex, attempt_id=body["attempt_id"],
                   role="diagnostic", integrity="failed", raw_reports="unavailable",
                   control_run_id=None, failure_reasons=["Synthetic API registration check; no native replay."])
        for field in ("window", "summary_ref", "audit_ref", "artifact_manifest_ref"):
            run.pop(field, None)
        target = "attempt:" + body["attempt_id"]
        before = self.store.adapter.status()
        with self.assertRaisesRegex(RecordError, "initial preregistration"):
            self._publish_record("run", run, endpoint_revisions={target: 2})
        self.assertEqual(before, self.store.adapter.status())
        operation = "prereg-run-" + uuid.uuid4().hex
        first = self._publish_record("run", run, operation_id=operation)
        edges = [edge for edge in self.store.adapter.list_relations(commit=first["commit"])
                 if edge["kind"] == "run_of" and edge["from_id"] == "run:" + run["run_id"]]
        self.assertEqual([(edge["to_id"], edge["to_revision"]) for edge in edges], [(target, 1)])
        recovered = self._publish_record("run", run, operation_id=operation, endpoint_revisions={})
        self.assertEqual(recovered, dict(first, replayed=True))

    def test_first_registration_retry_recovers_original_commit_after_results(self):
        body = v3_pending(self._attempt_copy("RETRY-PREREG"))
        body["registration"] = {"status": "preregistered"}
        body["decision"].update(layer="pending", outcome="pending")
        operation = "prereg-retry-" + uuid.uuid4().hex
        before = self.store.adapter.status()
        first = self.store.publish_record("attempt", body, operation_id=operation,
                                          expected_version=before["version"])
        later = copy.deepcopy(body)
        later["decision"].update(layer="economics", outcome="failed")
        later["decision"]["basis"] = {"mode": "descriptive", "evidence_refs": [{"id": "attempt:H08", "revision": 1}]}
        self._publish_record("attempt", later)
        after = self.store.adapter.status()
        recovered = self.store.publish_record("attempt", body, operation_id=operation,
                                              expected_version=before["version"])
        self.assertEqual(recovered, dict(first, replayed=True))
        self.assertEqual(after, self.store.adapter.status())

    def test_material_import_cannot_become_a_second_record_writer(self):
        before = self.store.adapter.status()
        inventory = copy.deepcopy(self.inventory)
        body = self._attempt_copy("UNIMPORTED")
        inventory["objects"].append({"id": "attempt:" + body["attempt_id"], "kind": "attempt",
                                     "revision": 1, "body": body, "provenance": {}})
        with self.assertRaisesRegex(RecordError, "record|metadata"):
            migration.publish(self.store.adapter, inventory)
        self.assertEqual(before, self.store.adapter.status())

    def test_record_schemas_lineage_briefs_and_comparisons_are_preserved(self):
        attempts, runs = self._baseline_records()
        self.assertEqual((len(attempts), len(runs)), (len(self.fixture_attempts), len(self.fixture_runs)))
        self.assertEqual(attempts, self.fixture_attempts)
        self.assertEqual(runs, self.fixture_runs)
        for kind, collection in (("attempt", attempts), ("run", runs)):
            for body in collection.values():
                validate_record(kind, body)
        for identity in ("H08", "H18a", "F01", "H27a"):
            self.assertEqual(
                cli._brief(identity, attempts, runs),
                cli._brief(identity, self.fixture_attempts, self.fixture_runs),
            )
        for candidate, control in (
            ("H18a-2026-10-08", "H15a-paired-2026-10-08"),
            ("F01-11-20261008", "F01-10-20261008"),
        ):
            self.assertEqual(cli._compare(candidate, control, runs),
                             cli._compare(candidate, control, self.fixture_runs))

    def test_full_native_evidence_validation_matches_synthetic_fixture(self):
        from research.records import artifacts

        attempts, runs = self._baseline_records()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            body = copy.deepcopy(self.fixture_runs["F01-11-20261008"])
            body["run_id"] = "SYNTHETIC-SEALED-" + uuid.uuid4().hex
            archive = root / body["run_id"]
            reports = archive / "reports"
            reports.mkdir(parents=True)
            for name in artifacts.REPORTS:
                (reports / name).write_text("synthetic_column\nsynthetic_value\n")
            for name, reference in (("summary.json", body["summary_ref"]), ("audit.json", body["audit_ref"])):
                shutil.copyfile(self.fixture.root / reference["path"], reports / name)
            for relative in body["source_revision"]["files"].values():
                target = archive / "source" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(self.fixture.root / relative, target)
            manifest = {"schema_version": 1, "run_id": body["run_id"], "status": "passed",
                        "native_exit_code": 0, "audit_exit_code": 0,
                        "nature": "Synthetic seal contract; no native run was executed.",
                        "files": artifacts._files(archive)}
            manifest_path = archive / "manifest.json"
            manifest_path.write_text(json.dumps(manifest))
            body.update(raw_reports="sealed_local", artifact_manifest_ref={
                "path": f"artifact://{body['run_id']}/manifest.json",
                "sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            })
            expected_runs = dict(self.fixture_runs, **{body["run_id"]: body})
            published = self._publish_record("run", body)
            retained = self.store.adapter.get_object("run:" + body["run_id"], commit=published["commit"])
            actual_runs = dict(runs, **{body["run_id"]: retained["body"]})
            with patch.dict(os.environ, {"TRADE_RESEARCH_ARTIFACT_ROOT": str(root)}):
                expected = cli._validate(self.fixture_attempts, expected_runs)
                self.assertEqual(cli._validate(attempts, actual_runs), expected)
                self.assertEqual((expected["attempts"], expected["runs"]),
                                 (len(self.fixture_attempts), len(self.fixture_runs) + 1))
                self.assertTrue(all(status == "verified" for status in expected["source_revision_status"].values()))
                (reports / "orders.csv").write_text("modified after sealing\n")
                with self.assertRaisesRegex(RecordError, "sealed artifact verification failed"):
                    cli._validate(attempts, actual_runs)

    def test_reimport_of_identical_inventory_creates_no_revision_or_commit(self):
        before = self.store.adapter.status()
        result = migration.publish(self.store.adapter, self.inventory)
        self.assertTrue(result.get("unchanged"), result)
        self.assertEqual(result["new_objects"], 0)
        self.assertEqual(result["new_relations"], 0)
        self.assertEqual((result["version"], result["commit"]),
                         (before["version"], before["commit"]))
        self.assertEqual(before, self.store.adapter.status())
        revisions = [obj for obj in self.store.adapter.list_objects(latest=False)
                     if obj["id"] == self.c02_id]
        self.assertEqual(sorted(obj["revision"] for obj in revisions), [1, 2])

    def test_both_c02_source_revisions_restore_exact_original_bytes(self):
        expected_sources = [OLD_CASES, CURRENT_CASES]
        values = []
        for revision, source_bytes in enumerate(expected_sources, start=1):
            obj = self.store.adapter.get_object(
                self.c02_id, revision=revision, commit=self.baseline_commit)
            self.assertIsNotNone(obj)
            locator = obj["provenance"]["locator"]
            expected = source_bytes[locator["start_byte"]:locator["end_byte"]]
            actual = migration.original_bytes(obj)
            self.assertEqual(actual, expected)
            self.assertEqual(hashlib.sha256(actual).hexdigest(), obj["body"]["sha256"])
            values.append(actual)
        self.assertNotEqual(values[0], values[1])
        latest = self.store.adapter.get_object(self.c02_id, commit=self.baseline_commit)
        self.assertEqual(migration.original_bytes(latest), values[1])

    def test_published_decision_revision_keeps_old_commit_readable(self):
        original = self.store.adapter.get_object("attempt:H08", commit=self.baseline_commit)
        body = copy.deepcopy(original["body"])
        body["decision"]["next_action"] += " Disposable Dolt consumer validation."
        before = self.store.adapter.status()
        result = self.store.publish_record(
            "attempt", body, operation_id="migration-test-decision-" + uuid.uuid4().hex,
            expected_version=before["version"],
        )
        current = self.store.adapter.get_object("attempt:H08", commit=result["commit"])
        retained = self.store.adapter.get_object("attempt:H08", commit=self.baseline_commit)
        self.assertEqual(current["revision"], original["revision"] + 1)
        self.assertEqual(current["body"], body)
        self.assertEqual(retained, original)
        old_attempts, _ = self._baseline_records()
        current_attempts, _ = cli._load_records(store=self.store, commit=result["commit"])
        self.assertEqual(old_attempts["H08"]["decision"], original["body"]["decision"])
        self.assertEqual(current_attempts["H08"]["decision"], body["decision"])
        self.assertEqual(current_attempts["H08"]["registration"],
                         original["body"]["registration"])

    def test_run_publication_writes_dolt_and_preserves_git_files(self):
        def git_run_bytes():
            return {str(path.relative_to(self.fixture.records)): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in (self.fixture.records / "runs").glob("*/run.json")}

        before_git = git_run_bytes()
        body = copy.deepcopy(self.fixture_runs["F01-11-20261008"])
        body.update(
            run_id="MIGRATION-TEST-" + uuid.uuid4().hex,
            role="diagnostic", integrity="failed", raw_reports="unavailable",
            control_run_id=None,
            failure_reasons=["Disposable publication fixture; no native backtest was executed."],
        )
        # Keep the original account's integral floats: native JSON renders 25.0
        # as 25, and an identical publication must still recover its operation.
        for field in ("window", "summary_ref", "audit_ref", "artifact_manifest_ref"):
            body.pop(field, None)
        validate_record("run", body)
        before = self.store.adapter.status()
        operation_id = "migration-test-run-" + uuid.uuid4().hex
        result = self.store.publish_record(
            "run", body, operation_id=operation_id,
            expected_version=before["version"],
        )
        _, runs = cli._load_records(store=self.store, commit=result["commit"])
        self.assertEqual(runs[body["run_id"]], body)
        self.assertEqual(self.store.adapter.get_object("run:" + body["run_id"])["body"], body)
        self.assertNotIn(body["run_id"], self._baseline_records()[1])
        self.assertEqual(git_run_bytes(), before_git)
        self.assertFalse((self.fixture.records / "runs" / body["run_id"]).exists())
        after = self.store.adapter.status()
        recovered = self.store.publish_record(
            "run", body, operation_id=operation_id,
            expected_version=before["version"],
        )
        self.assertEqual(recovered, dict(result, replayed=True))
        self.assertEqual(after, self.store.adapter.status())

    def test_original_registration_contract_cannot_be_rewritten(self):
        original = v3_pending(self._attempt_copy("FROZEN"))
        original["registration"] = {"status": "preregistered"}
        original["decision"].update(layer="pending", outcome="pending")
        first = self._publish_record("attempt", original)
        later = copy.deepcopy(original)
        later["decision"].update(layer="source", outcome="inconclusive", scope="Later observed scope",
                                 next_action="Later decision")
        later["decision"]["basis"] = {"mode": "source", "evidence_refs": [{"id": "attempt:H08", "revision": 1}]}
        self._publish_record("attempt", later)
        edits = {"question": "Replaced question", "hypothesis": "Replaced hypothesis", "mechanism": "Replaced mechanism",
                 "goal_id": "CHANGED", "kind": "diagnostic", "code_parent": None,
                 "parents": [{"attempt_id": "H08", "relationship": "hypothesis_extension", "difference": "New parent"}],
                 "contract": {**later["contract"], "scope": "Changed scope", "plan": "Changed plan"},
                 "registration": {"status": "retrospective"}, "composition_mode": "dependent",
                 "mechanism_refs": [{"attempt_id": "H08", "relationship": "component_reuse", "component": "New",
                                     "boundary": "New mechanism boundary"}]}
        before = self.store.adapter.status()
        for field, value in edits.items():
            with self.subTest(field=field):
                changed = copy.deepcopy(later)
                changed[field] = value
                with self.assertRaisesRegex(ConflictError, "registration contract"):
                    self._publish_record("attempt", changed)
                self.assertEqual(before, self.store.adapter.status())
        retained, receipt = self.store.registration_snapshot(original["attempt_id"], at=first["commit"])
        self.assertEqual(retained, original)
        self.assertEqual(receipt, first["registration_receipt"])

    def test_retrospective_import_is_not_a_prospective_registration(self):
        with self.assertRaisesRegex(RecordError, "pending Dolt preregistration"):
            self.store.registration_snapshot("F01")

    def test_default_dolt_reader_fails_closed_without_any_git_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "backend.json"
            with patch.dict(os.environ, {"TRADE_RECORDS_CONFIG": str(path)}):
                with self.assertRaisesRegex(RecordError, "not configured"):
                    cli._load_records()
                path.write_text(json.dumps(dict(self.config, port=1, unix_socket=None)))
                with self.assertRaisesRegex(RecordError, "Dolt SQL error"):
                    cli._load_records()


if __name__ == "__main__":
    unittest.main()
