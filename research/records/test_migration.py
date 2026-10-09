"""Real repository-to-Dolt migration and consumer checks.

Opt in with RESEARCH_DOLT_TEST_CONFIG (JSON connection configuration). Native
artifact validation additionally uses TRADE_RESEARCH_ARTIFACT_ROOT. The suite
scans once and publishes only into one randomly named disposable database.
"""

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

from research.records import cli, migration
from research.records.common import RECORDS, ROOT, RecordError
from research.records.dolt_store import ConflictError
from research.records.materials import retained_historical_refs, scan
from research.records.store import DoltRecords, GitHistoryStore, validate_record


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
        cls.git_attempts, cls.git_runs, _ = GitHistoryStore().snapshot()
        golden = json.loads((RECORDS / "fixtures/materials_golden.json").read_text())
        cls.historical_commit = golden["historical_commit"]
        cls.c02_id = golden["historical_c02"]["id"]
        # Historical selection reads one ledger, then scans the worktree once.
        cls.inventory = scan(ROOT, include_untracked=False, historical_refs=retained_historical_refs())
        cls.imported = migration.publish(cls.store.adapter, cls.inventory)
        cls.baseline_commit = cls.imported["commit"]

    @classmethod
    def _remove_test_database(cls):
        if not cls.config["database"].startswith("records_test_migration_"):
            raise AssertionError("cleanup refuses a non-test database")
        with cls.store.adapter._connection(database=False) as conn:
            cls.store.adapter._sql(conn, f"DROP DATABASE `{cls.config['database']}`")

    def _baseline_records(self):
        return cli._load_records(store=self.store, commit=self.baseline_commit)

    def _attempt_copy(self, prefix="TEST"):
        body = copy.deepcopy(self.git_attempts["H08"])
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
        run = copy.deepcopy(self.git_runs["F01-11-20261008"])
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

    def test_first_preregistration_gate_is_enforced_inside_store_api(self):
        body = self._attempt_copy("PREREG")
        body["registration"] = {"status": "preregistered", "reference": "docs/prereg.md"}
        body["decision"].update(layer="pending", outcome="pending")
        before = self.store.adapter.status()
        with self.assertRaisesRegex(RecordError, "receipt_path"):
            self._publish_record("attempt", body)
        self.assertEqual(before, self.store.adapter.status())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)

            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root).decode().strip()

            git("init", "-q")
            git("config", "user.name", "Preregistration fixture")
            git("config", "user.email", "fixture@example.invalid")
            (root / "docs").mkdir()
            (root / "docs/prereg.md").write_text("# Frozen preregistration\n")
            git("add", ".")
            git("commit", "-qm", "Freeze preregistration reference")
            body["registration"]["original_registration_commit"] = git("rev-parse", "HEAD")
            receipt = root / "attempt.json"
            receipt.write_text(json.dumps(body, ensure_ascii=False))
            with patch("research.records.store.ROOT", root):
                with self.assertRaisesRegex(RecordError, "not committed"):
                    self._publish_record("attempt", body, receipt_path=receipt)
                git("add", ".")
                git("commit", "-qm", "Retain pending attempt receipt")
                nonpending = copy.deepcopy(body)
                nonpending["decision"]["outcome"] = "passed"
                with self.assertRaisesRegex(RecordError, "pending/pending"):
                    self._publish_record("attempt", nonpending, receipt_path=receipt)
                receipt.write_text(json.dumps(body, ensure_ascii=False) + "\n")
                with self.assertRaisesRegex(RecordError, "committed unchanged"):
                    self._publish_record("attempt", body, receipt_path=receipt)
                receipt.write_text(json.dumps(body, ensure_ascii=False))
                first = self._publish_record("attempt", body, receipt_path=receipt)
                body["decision"]["next_action"] += " Later pending update without a receipt."
                self._publish_record("attempt", body)
                self.assertEqual(self.store.adapter.get_object("attempt:" + body["attempt_id"])["revision"], 2)
                self.assertEqual(self.store.adapter.get_object("attempt:" + body["attempt_id"],
                                                             commit=first["commit"])["revision"], 1)

    def test_frozen_git_metadata_cannot_become_a_second_writer(self):
        before = self.store.adapter.status()
        for add_identity in (False, True):
            inventory = copy.deepcopy(self.inventory)
            incoming = next(obj for obj in inventory["objects"] if obj["kind"] == "attempt")
            if add_identity:
                incoming["body"]["attempt_id"] = "UNIMPORTED-" + uuid.uuid4().hex
                incoming["id"] = "attempt:" + incoming["body"]["attempt_id"]
            else:
                incoming["body"]["decision"]["next_action"] += " Unauthorized Git metadata update."
            with self.assertRaisesRegex(RecordError, "frozen import, not a writer"):
                migration.publish(self.store.adapter, inventory)
            self.assertEqual(before, self.store.adapter.status())

    def test_record_schemas_lineage_briefs_and_comparisons_are_preserved(self):
        attempts, runs = self._baseline_records()
        self.assertEqual((len(attempts), len(runs)), (len(self.git_attempts), len(self.git_runs)))
        self.assertEqual(attempts, self.git_attempts)
        self.assertEqual(runs, self.git_runs)
        for kind, collection in (("attempt", attempts), ("run", runs)):
            for body in collection.values():
                validate_record(kind, body)
        for identity in ("H08", "H18a", "F01", "H27a"):
            self.assertEqual(
                cli._brief(identity, attempts, runs),
                cli._brief(identity, self.git_attempts, self.git_runs),
            )
        for candidate, control in (
            ("H18a-2026-10-08", "H15a-paired-2026-10-08"),
            ("F01-11-20261008", "F01-10-20261008"),
        ):
            self.assertEqual(cli._compare(candidate, control, runs),
                             cli._compare(candidate, control, self.git_runs))

    def test_full_native_evidence_validation_matches_git(self):
        if not os.environ.get("TRADE_RESEARCH_ARTIFACT_ROOT"):
            self.skipTest("full native custody validation requires TRADE_RESEARCH_ARTIFACT_ROOT")
        attempts, runs = self._baseline_records()
        expected = cli._validate(self.git_attempts, self.git_runs)
        self.assertEqual(cli._validate(attempts, runs), expected)
        self.assertEqual((expected["attempts"], expected["runs"]),
                         (len(self.git_attempts), len(self.git_runs)))

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
        source_path = "research/r1_native/SOURCE_CASES.md"
        old_file = subprocess.check_output(
            ["git", "show", f"{self.historical_commit}:{source_path}"], cwd=ROOT)
        current_file = (ROOT / source_path).read_bytes()
        expected_sources = [old_file, current_file]
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
            return {str(path.relative_to(RECORDS)): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in (RECORDS / "runs").glob("*/run.json")}

        before_git = git_run_bytes()
        body = copy.deepcopy(self.git_runs["F01-11-20261008"])
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
        self.assertFalse((RECORDS / "runs" / body["run_id"]).exists())
        after = self.store.adapter.status()
        recovered = self.store.publish_record(
            "run", body, operation_id=operation_id,
            expected_version=before["version"],
        )
        self.assertEqual(recovered, dict(result, replayed=True))
        self.assertEqual(after, self.store.adapter.status())

    def test_original_registration_cannot_be_rewritten(self):
        body = copy.deepcopy(self.store.adapter.get_object("attempt:H08")["body"])
        body["registration"]["reference"] += " rewritten"
        before = self.store.adapter.status()
        with self.assertRaisesRegex(ConflictError, "registration"):
            self.store.publish_record(
                "attempt", body, operation_id="migration-test-registration-" + uuid.uuid4().hex,
                expected_version=before["version"],
            )
        self.assertEqual(before, self.store.adapter.status())

    def test_default_dolt_reader_fails_closed_and_git_is_explicit_read_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "backend.json"
            with patch.dict(os.environ, {"TRADE_RECORDS_CONFIG": str(path),
                                         "TRADE_RECORDS_BACKEND": "dolt"}):
                with self.assertRaisesRegex(RecordError, "not configured"):
                    cli._load_records()
                path.write_text(json.dumps(dict(self.config, port=1, unix_socket=None)))
                with self.assertRaisesRegex(RecordError, "Dolt SQL error"):
                    cli._load_records()
                # Explicit history remains available despite unavailable Dolt.
                attempts, runs = cli._load_records(store=GitHistoryStore())
                self.assertEqual((attempts, runs), (self.git_attempts, self.git_runs))
        with self.assertRaisesRegex(RecordError, "read-only"):
            GitHistoryStore().publish_record("run", {}, operation_id="forbidden", expected_version=0)


if __name__ == "__main__":
    unittest.main()
