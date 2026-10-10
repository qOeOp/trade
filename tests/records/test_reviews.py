"""Evidence-backed review checks on disposable real Dolt databases.

Opt in with RESEARCH_DOLT_TEST_CONFIG. Its database is never used: each test
creates a random records_test_reviews_* database and a separate retained Git
fixture outside the project and /tmp, then removes both.
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

from research.records import reviews
from research.records.common import ROOT, RecordError, _read_json
from research.records.dolt_store import ConflictError, DoltStore
from research.records.ledger import material
from tests.records.fixtures.contract_repository import v3_pending


class ReviewIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("real review integration requires RESEARCH_DOLT_TEST_CONFIG")
        cls.connection_config = json.loads(raw)
        if not isinstance(cls.connection_config, dict):
            raise ValueError("RESEARCH_DOLT_TEST_CONFIG must be a JSON object")

    def setUp(self):
        self.config = dict(self.connection_config,
                           database="records_test_reviews_" + uuid.uuid4().hex)
        self.adapter = DoltStore(self.config)
        self.addCleanup(self._remove_test_database)
        self.adapter.initialize()
        external = Path.home() / ".local/share/trade/review-test-fixtures"
        external.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = tempfile.TemporaryDirectory(prefix="review-", dir=external)
        self.addCleanup(temporary.cleanup)
        self.fixture = Path(temporary.name)
        self.root = self.fixture / "repository"
        (self.root / "notes").mkdir(parents=True)
        source_raw = b"# Source\n\nSee [target](../target.txt:2).\n"
        (self.root / "notes/source.md").write_bytes(source_raw)
        (self.root / "target.txt").write_bytes(b"first retained line\nsecond retained line\n")
        self._git("init", "-q")
        self._git("add", "notes/source.md", "target.txt")
        self._git("-c", "user.name=Review Test", "-c", "user.email=review-test@example.invalid",
                  "commit", "-qm", "frozen reference fixture")
        self.git_commit = self._git("rev-parse", "HEAD").decode().strip()
        source_sha = hashlib.sha256(source_raw).hexdigest()
        self.source = {
            "id": "section:notes/source.md#source", "kind": "material_section", "revision": 1,
            "body": {"format": "markdown_fragment", "text": source_raw.decode(),
                     "content_base64": base64.b64encode(source_raw).decode(),
                     "sha256": source_sha, "byte_length": len(source_raw)},
            "provenance": {"path": "notes/source.md", "source_head": self.git_commit,
                           "git_commit": self.git_commit, "blob_sha256": source_sha,
                           "locator": {"start_byte": 0, "end_byte": len(source_raw)}}}
        item = {"reason": "unresolved_local_link", "object_id": self.source["id"],
                "target": "../target.txt:2"}
        self.inventory = {
            "id": "inventory:" + uuid.uuid4().hex, "kind": "inventory", "revision": 1,
            "body": {"source_head": self.git_commit,
                     "review_queue": [copy.deepcopy(item), copy.deepcopy(item)], "warnings": []},
            "provenance": {"source_head": self.git_commit, "origin": "disposable_review_fixture"}}
        initial = self.adapter.publish([self.source, self.inventory], [], "seed-" + uuid.uuid4().hex, 0)
        self.source_at = initial["commit"]

    def _git(self, *arguments):
        process = subprocess.run(["git", *arguments], cwd=self.root, capture_output=True, check=False)
        if process.returncode:
            self.fail(process.stderr.decode(errors="replace"))
        return process.stdout

    def _remove_test_database(self):
        self.assertTrue(self.config["database"].startswith("records_test_reviews_"))
        with self.adapter._connection(database=False) as connection:
            self.adapter._sql(connection, f"DROP DATABASE IF EXISTS `{self.config['database']}`")

    def _prepare(self, decisions=None):
        return reviews.prepare(self.adapter, self.inventory["id"], source_at=self.source_at,
                               decisions=decisions, root=self.root)

    def _status(self, at=None):
        return reviews.status(self.adapter, self.inventory["id"], source_at=self.source_at,
                              at=at, include_items=True)

    def _manual(self, status="pending", *, evidence_file=None):
        spec = {"item_index": 0,
                "item_sha256": reviews.item_identity(self.inventory, 0)["item_sha256"],
                "status": status, "reviewer": "disposable Agent review",
                "rationale": "This occurrence requires a separately recorded decision.",
                "scope": "Only queue occurrence zero; no strategy or source claim changes."}
        if evidence_file is not None:
            spec["files"] = [{"path": str(evidence_file),
                              "sha256": hashlib.sha256(evidence_file.read_bytes()).hexdigest()}]
        return {"decisions": [spec]}

    @staticmethod
    def _reseal(payload):
        payload["payload_sha256"] = reviews.digest(
            {key: value for key, value in payload.items() if key != "payload_sha256"})
        return payload

    def test_duplicate_dictionary_occurrences_keep_independent_keys_and_counts(self):
        first = reviews.item_identity(self.inventory, 0)
        second = reviews.item_identity(self.inventory, 1)
        self.assertEqual(first["item_sha256"], second["item_sha256"])
        self.assertNotEqual(first["item_key"], second["item_key"])
        before = self._status(at=self.source_at)
        self.assertEqual(before["total"], 2)
        self.assertEqual(before["counts"], {"resolved": 0, "pending": 2, "unavailable": 0})
        publication = reviews.apply(self.adapter, self._prepare())
        current = self._status(at=publication["commit"])
        self.assertEqual(current["counts"], {"resolved": 2, "pending": 0, "unavailable": 0})
        self.assertEqual(len({item["item_key"] for item in current["items"]}), 2)
        self.assertEqual(self._status(at=self.source_at), before)
        self.assertEqual(self.adapter.get_object(self.inventory["id"], commit=publication["commit"]),
                         self.inventory)

    def test_manual_closure_retains_external_decision_file_and_original_queue(self):
        decision_file = self.fixture / "agent-decision.json"
        raw = b'{"decision":"unavailable","scope":"only occurrence zero"}\n'
        decision_file.write_bytes(raw)
        publication = reviews.apply(self.adapter, self._prepare(
            self._manual("unavailable", evidence_file=decision_file)))
        current = self._status(at=publication["commit"])
        self.assertEqual(current["counts"], {"resolved": 1, "pending": 0, "unavailable": 1})
        retained = self.adapter.get_object("review_evidence:" + hashlib.sha256(raw).hexdigest(),
                                           commit=publication["commit"])
        self.assertEqual(base64.b64decode(retained["body"]["content_base64"]), raw)
        self.assertEqual(retained["provenance"]["custody"], "observed_after_source_snapshot")
        self.assertEqual(len(self.adapter.get_object(self.inventory["id"])["body"]["review_queue"]), 2)
        with self.assertRaisesRegex(RecordError, "outside Git and /tmp"):
            reviews.retain_file(Path("/tmp/disallowed-review-evidence"), "a" * 64)
        with self.assertRaisesRegex(RecordError, "outside Git and /tmp"):
            reviews.retain_file(ROOT / "README.md", "a" * 64)

    def test_manual_closure_requires_retained_file_and_original_item_digest(self):
        before = self.adapter.status()
        with self.assertRaisesRegex(RecordError, "retained original decision file") as failure:
            self._prepare(self._manual("resolved"))
        self.assertEqual(failure.exception.code, "REVIEW_DECISION_FILE_REQUIRED")
        self.assertEqual(failure.exception.path, "$.decisions[0].files")
        self.assertEqual(failure.exception.write_status, "not_written")
        self.assertTrue(any("actual review" in action for action in failure.exception.next_actions))
        mismatched = self._manual()
        mismatched["decisions"][0]["item_sha256"] = "0" * 64
        with self.assertRaisesRegex(RecordError, "mismatched manual review occurrence"):
            self._prepare(mismatched)
        self.assertEqual(self.adapter.status(), before)

    def test_missing_review_declarations_identify_field_and_require_actual_review(self):
        before = self.adapter.status()
        for field in ("reviewer", "rationale", "scope"):
            manual = self._manual()
            del manual["decisions"][0][field]
            with self.subTest(field=field), self.assertRaises(RecordError) as failure:
                self._prepare(manual)
            self.assertEqual(failure.exception.code, "REVIEW_DECLARATION_REQUIRED")
            self.assertEqual(failure.exception.path, "$.decisions[0]." + field)
            self.assertEqual(failure.exception.write_status, "not_written")
            self.assertTrue(any("do not invent" in action for action in failure.exception.next_actions))
            self.assertEqual(self.adapter.status(), before)
        original = self.fixture / "actual-review.txt"
        original.write_bytes(b"Actual fixture review: occurrence zero is unavailable; no strategy claim.\n")
        fixed = self._prepare(self._manual("unavailable", evidence_file=original))
        publication = reviews.apply(self.adapter, fixed)
        self.assertEqual(publication["review"]["counts"]["unavailable"], 1)

    def test_original_file_failures_explain_custody_and_leave_database_unchanged(self):
        original = self.fixture / "actual-review.txt"
        original.write_bytes(b"Actual fixed fixture decision.\n")
        before = self.adapter.status()
        manual = self._manual("unavailable", evidence_file=original)
        manual["decisions"][0]["files"][0]["sha256"] = "0" * 64
        with self.assertRaises(RecordError) as failure:
            self._prepare(manual)
        self.assertEqual(failure.exception.code, "REVIEW_EVIDENCE_HASH_MISMATCH")
        self.assertEqual(failure.exception.path, "$.decisions[0].files[0].sha256")
        self.assertEqual(failure.exception.expected, hashlib.sha256(original.read_bytes()).hexdigest())
        self.assertTrue(any("do not change only" in action for action in failure.exception.next_actions))
        self.assertEqual(failure.exception.write_status, "not_written")
        original.unlink()
        with self.assertRaises(RecordError) as unreadable:
            self._prepare(manual)
        self.assertEqual(unreadable.exception.code, "REVIEW_EVIDENCE_UNREADABLE")
        self.assertEqual(unreadable.exception.write_status, "not_written")
        self.assertEqual(self.adapter.status(), before)

    def test_missing_fixed_proof_and_resolution_edge_reject_entire_payload(self):
        payload = self._prepare()
        target = next(obj for obj in payload["objects"] if obj["kind"] == "reference")
        before = self.adapter.status()
        missing_proof = copy.deepcopy(payload)
        missing_proof["objects"] = [obj for obj in missing_proof["objects"] if obj["id"] != target["id"]]
        with self.assertRaisesRegex(RecordError, "fixed proof is missing") as failure:
            reviews.apply(self.adapter, self._reseal(missing_proof))
        self.assertEqual(failure.exception.code, "REVIEW_FIXED_PROOF_MISMATCH")
        self.assertIn(".evidence_refs[", failure.exception.path)
        self.assertEqual(failure.exception.write_status, "not_written")
        self.assertTrue(any("do not remove" in action for action in failure.exception.next_actions))
        self.assertEqual(self.adapter.status(), before)
        missing_edge = copy.deepcopy(payload)
        removed = next(edge for edge in missing_edge["relations"] if edge["kind"] == "references_resolved")
        missing_edge["relations"] = [edge for edge in missing_edge["relations"] if edge["id"] != removed["id"]]
        with self.assertRaisesRegex(RecordError, "closed review edge is absent") as edge_failure:
            reviews.apply(self.adapter, self._reseal(missing_edge))
        self.assertEqual(edge_failure.exception.code, "REVIEW_EDGE_BINDING_MISMATCH")
        self.assertTrue(edge_failure.exception.path.endswith(".edge_ids"))
        self.assertEqual(edge_failure.exception.write_status, "not_written")
        self.assertEqual(self.adapter.status(), before)

    def test_frozen_payload_and_original_bytes_refusals_are_actionable_and_retryable(self):
        original = self.fixture / "actual-review.txt"
        original.write_bytes(b"Actual retained review original.\n")
        payload = self._prepare(self._manual("unavailable", evidence_file=original))
        before = self.adapter.status()
        for version in (2, True, 1.0, "1", None):
            unsupported = copy.deepcopy(payload)
            unsupported["schema_version"] = version
            with self.subTest(version=version), patch.object(self.adapter, "get_object") as read, \
                    patch.object(self.adapter, "publish") as publish, self.assertRaises(RecordError) as version_failure:
                reviews.apply(self.adapter, self._reseal(unsupported))
            self.assertEqual(version_failure.exception.code, "REVIEW_PAYLOAD_VERSION_UNSUPPORTED")
            self.assertEqual(version_failure.exception.path, "$.schema_version")
            self.assertEqual(version_failure.exception.write_status, "not_written")
            read.assert_not_called()
            publish.assert_not_called()
        edited = copy.deepcopy(payload)
        edited["expected_version"] += 1
        with self.assertRaises(RecordError) as digest_failure:
            reviews.apply(self.adapter, edited)
        self.assertEqual(digest_failure.exception.code, "REVIEW_PAYLOAD_DIGEST_MISMATCH")
        self.assertEqual(digest_failure.exception.path, "$.payload_sha256")
        missing = copy.deepcopy(payload)
        del missing["operation_id"]
        with self.assertRaises(RecordError) as missing_failure:
            reviews.apply(self.adapter, self._reseal(missing))
        self.assertEqual(missing_failure.exception.code, "REVIEW_PAYLOAD_FIELD_REQUIRED")
        self.assertEqual(missing_failure.exception.path, "$.operation_id")
        for encoded in ("not-base64", 123, ["base64"]):
            corrupted = copy.deepcopy(payload)
            obj = next(obj for obj in corrupted["objects"] if obj["kind"] == "material")
            obj["body"]["content_base64"] = encoded
            with self.subTest(content_base64=encoded), self.assertRaises(RecordError) as bytes_failure:
                reviews.apply(self.adapter, self._reseal(corrupted))
            self.assertEqual(bytes_failure.exception.code, "REVIEW_ORIGINAL_BYTES_INVALID")
            self.assertTrue(bytes_failure.exception.path.endswith(".body"))
            self.assertEqual(bytes_failure.exception.write_status, "not_written")
            self.assertEqual(self.adapter.status(), before)
        for refusal in (version_failure, digest_failure, missing_failure, bytes_failure):
            self.assertEqual(refusal.exception.write_status, "not_written")
            self.assertTrue(refusal.exception.next_actions)
        self.assertEqual(self.adapter.status(), before)
        first = reviews.apply(self.adapter, payload)
        self.assertEqual(reviews.apply(self.adapter, payload), dict(first, replayed=True))

    def test_confirmed_publication_followup_read_failure_does_not_invite_new_write(self):
        payload = self._prepare()
        failure = RecordError("follow-up read fixture failure", code="REVIEW_FIXED_PROOF_MISMATCH",
                              path="$.objects[0].body.evidence_refs", write_status="not_written")
        with patch.object(reviews, "status", side_effect=failure), self.assertRaises(RecordError) as refused:
            reviews.apply(self.adapter, payload)
        committed = self.adapter.status()
        self.assertEqual(refused.exception.write_status, "already_committed")
        self.assertIn(payload["operation_id"], refused.exception.next_actions[0])
        self.assertIn(committed["commit"], refused.exception.next_actions[0])
        self.assertIn("do not create a new operation", refused.exception.next_actions[0])
        recovered = reviews.apply(self.adapter, payload)
        self.assertTrue(recovered["replayed"])
        self.assertEqual(recovered["commit"], committed["commit"])
        self.assertEqual(self.adapter.status(), committed)

    def test_rehashed_bad_item_digest_still_fails_original_occurrence_binding(self):
        payload = self._prepare()
        decision = next(obj for obj in payload["objects"] if obj["kind"] == "review_decision")
        decision["body"]["item_sha256"] = "0" * 64
        decision["body"]["decision_sha256"] = reviews.digest(
            {key: value for key, value in decision["body"].items() if key != "decision_sha256"})
        before = self.adapter.status()
        with self.assertRaisesRegex(RecordError, "original queue occurrence"):
            reviews.apply(self.adapter, self._reseal(payload))
        self.assertEqual(self.adapter.status(), before)

    def test_verified_resolution_cannot_close_after_target_and_its_edges_are_removed(self):
        payload = self._prepare()
        decision = next(obj for obj in payload["objects"] if obj["kind"] == "review_decision")
        target = decision["body"].pop("target_ref")
        decision["body"]["evidence_refs"] = [ref for ref in decision["body"]["evidence_refs"]
                                                if ref != target]
        removed = {edge["id"] for edge in payload["relations"]
                   if edge["body"].get("review_id") == decision["id"] and
                   edge["to_id"] == target["id"] and edge["to_revision"] == target["revision"]}
        decision["body"]["edge_ids"] = [identity for identity in decision["body"]["edge_ids"]
                                          if identity not in removed]
        payload["relations"] = [edge for edge in payload["relations"] if edge["id"] not in removed]
        decision["body"]["decision_sha256"] = reviews.digest(
            {key: value for key, value in decision["body"].items() if key != "decision_sha256"})
        before = self.adapter.status()
        with self.assertRaises(RecordError):
            reviews.apply(self.adapter, self._reseal(payload))
        self.assertEqual(self.adapter.status(), before)

    def test_review_payload_cannot_create_unrelated_research_metadata(self):
        payload = self._prepare()
        payload["objects"].append({"id": "attempt:unrelated", "kind": "attempt", "revision": 1,
                                   "body": {"purpose": "must not become a research write path"},
                                   "provenance": {"origin": "disposable_publication_boundary_test"}})
        before = self.adapter.status()
        with self.assertRaisesRegex(RecordError, "cannot create research metadata"):
            reviews.apply(self.adapter, self._reseal(payload))
        self.assertEqual(self.adapter.status(), before)

    def test_review_cannot_shadow_registered_record_with_an_archival_kind(self):
        from research.records.store import DoltRecords
        store = DoltRecords(self.config)
        attempt = {
            "schema_version": 2, "attempt_id": "REVIEW-FROZEN", "goal_id": "TEST",
            "kind": "diagnostic", "question": "Does review respect the record writer?",
            "mechanism": "A disposable API registration.", "hypothesis": "Review cannot hide it.",
            "parents": [], "code_parent": None,
            "contract": {"scope": "Synthetic review boundary only.", "plan": "Reject archival namespace writes."},
            "registration": {"status": "preregistered"},
            "decision": {"layer": "pending", "outcome": "pending", "scope": "Synthetic only.",
                         "next_action": "Check the namespace boundary."}, "evidence_refs": [],
        }
        attempt = v3_pending(attempt)
        store.publish_record("attempt", attempt, operation_id="review-registered-" + uuid.uuid4().hex,
                             expected_version=self.adapter.status()["version"])
        payload = self._prepare()
        raw = b"An archival note must not replace the registered attempt.\n"
        before = self.adapter.status()
        for kind in ("material", "evidence_json", "reference"):
            with self.subTest(kind=kind):
                forged = copy.deepcopy(payload)
                forged["objects"].append({"id": "attempt:" + attempt["attempt_id"], "revision": 2,
                    "kind": kind, "body": {"content_base64": base64.b64encode(raw).decode(),
                    "sha256": hashlib.sha256(raw).hexdigest()}, "provenance": {"origin": "archival_shadow"}})
                with self.assertRaisesRegex(RecordError, "reserved record identities"):
                    reviews.apply(self.adapter, self._reseal(forged))
                self.assertEqual(self.adapter.status(), before)
                self.assertEqual(store.snapshot(before["commit"])[0][attempt["attempt_id"]], attempt)

    def test_prepare_and_apply_reject_new_archival_record_namespace_objects(self):
        raw = b"ordinary archival bytes\n"
        body = {"content_base64": base64.b64encode(raw).decode(), "sha256": hashlib.sha256(raw).hexdigest()}
        before = self.adapter.status()
        for prefix in ("attempt:", "run:"):
            value = {"id": prefix + "UNREGISTERED", "revision": 1, "kind": "material",
                     "body": body, "provenance": {"origin": "archival_shadow"}}
            with self.subTest(prefix=prefix):
                with self.assertRaisesRegex(RecordError, "reserved record identities"):
                    reviews.prepare(self.adapter, self.inventory["id"], source_at=self.source_at,
                                    root=self.root, supplemental=[value])
                payload = self._prepare()
                payload["objects"].append(value)
                with self.assertRaisesRegex(RecordError, "reserved record identities"):
                    reviews.apply(self.adapter, self._reseal(payload))
                self.assertEqual(self.adapter.status(), before)

    def test_existing_fixed_record_evidence_is_read_only_during_prepare(self):
        raw = b'{"attempt_id":"LEGACY-EVIDENCE"}\n'
        retained = {"id": "attempt:LEGACY-EVIDENCE", "kind": "attempt", "revision": 1,
                    "body": json.loads(raw), "provenance": {
                    "raw_content_base64": base64.b64encode(raw).decode(),
                    "blob_sha256": hashlib.sha256(raw).hexdigest()}}
        self.adapter.publish([retained], [], "legacy-evidence-" + uuid.uuid4().hex,
                             self.adapter.status()["version"])
        before = self.adapter.status()
        payload = reviews.prepare(self.adapter, self.inventory["id"], source_at=self.source_at,
                                  root=self.root, supplemental=[retained])
        self.assertNotIn(retained["id"], {obj["id"] for obj in payload["objects"]})
        self.assertEqual(self.adapter.status(), before)
        changed = copy.deepcopy(retained)
        changed["revision"] = 2
        with self.assertRaisesRegex(RecordError, "reserved record identities"):
            reviews.prepare(self.adapter, self.inventory["id"], source_at=self.source_at,
                            root=self.root, supplemental=[changed])
        self.assertEqual(self.adapter.status(), before)

    def test_empty_review_queue_cannot_inject_research_record_relations(self):
        empty = {"id": "inventory:empty-" + uuid.uuid4().hex, "kind": "inventory", "revision": 1,
                 "body": {"source_head": self.git_commit, "review_queue": [], "warnings": []},
                 "provenance": {"origin": "disposable_empty_review_fixture"}}
        attempt = {"id": "attempt:REVIEW-RELATION", "kind": "attempt", "revision": 2,
                   "body": {"purpose": "Existing later attempt revision"}, "provenance": {}}
        run = {"id": "run:REVIEW-SEALED", "kind": "run", "revision": 1,
               "body": {"purpose": "Existing sealed run revision"}, "provenance": {}}
        seeded = self.adapter.publish([empty, attempt, run], [], "empty-review-" + uuid.uuid4().hex,
                                      self.adapter.status()["version"])
        payload = reviews.prepare(self.adapter, empty["id"], source_at=seeded["commit"], root=self.root)
        before = self.adapter.status()
        for kind in ("run_of", "hypothesis_extension", "composition", "component_index", "compared_with"):
            with self.subTest(kind=kind):
                forged = copy.deepcopy(payload)
                forged["relations"].append(reviews._edge(kind, run, attempt, {}))
                with self.assertRaisesRegex(RecordError, "cannot create research record relations"):
                    reviews.apply(self.adapter, self._reseal(forged))
                self.assertEqual(self.adapter.status(), before)

    def test_extra_semantic_relation_must_be_declared_by_its_queue_decision(self):
        payload = self._prepare()
        before = self.adapter.status()
        for declared_id in (False, True):
            with self.subTest(bound_to_decision=declared_id):
                forged = copy.deepcopy(payload)
                decision = next(obj for obj in forged["objects"] if obj["kind"] == "review_decision")
                binding = {"review_id": decision["id"], "review_revision": decision["revision"],
                           "item_key": decision["body"]["item_key"], "scope": "An undeclared correction",
                           "retrospective": True}
                extra = reviews._edge("corrects", self.source, self.source, binding)
                forged["relations"].append(extra)
                if declared_id:
                    decision["body"]["edge_ids"].append(extra["id"])
                    decision["body"]["decision_sha256"] = reviews.digest(
                        {key: value for key, value in decision["body"].items() if key != "decision_sha256"})
                with self.assertRaisesRegex(RecordError, "corresponding queue decision|declared decision and fixed evidence"):
                    reviews.apply(self.adapter, self._reseal(forged))
                self.assertEqual(self.adapter.status(), before)
    def test_frozen_file_replay_recovers_original_commit_after_later_publication(self):
        frozen = self.fixture / "frozen-review.json"
        frozen.write_text(json.dumps(self._prepare(), ensure_ascii=False) + "\n")
        first = reviews.apply(self.adapter, _read_json(frozen))
        self.adapter.publish([{"id": "test:later", "kind": "test", "revision": 1,
                               "body": {"purpose": "prove persistent old operation recovery"},
                               "provenance": {"origin": "disposable_review_fixture"}}], [],
                             "later-" + uuid.uuid4().hex, first["version"])
        before = self.adapter.status()
        recovered = reviews.apply(DoltStore(self.config), _read_json(frozen))
        self.assertEqual(recovered, dict(first, replayed=True))
        self.assertNotEqual(recovered["commit"], before["commit"])
        self.assertEqual(recovered["review"]["commit"], first["commit"])
        self.assertEqual(self.adapter.status(), before)

    def test_stale_expected_version_cannot_override_another_decision(self):
        winner = self._prepare()
        stale = self._prepare(self._manual("pending"))
        first = reviews.apply(self.adapter, winner)
        before = self.adapter.status()
        with self.assertRaisesRegex(ConflictError, "expected-version conflict"):
            reviews.apply(self.adapter, stale)
        self.assertEqual(self.adapter.status(), before)
        self.assertEqual(self._status()["counts"], first["review"]["counts"])

    def test_pending_revision_deactivates_old_resolution_but_keeps_history(self):
        first = reviews.apply(self.adapter, self._prepare())
        old = material(self.adapter, "show", identity=self.source["id"], at=first["commit"])
        self.assertEqual(len(old["resolved_references"]), 2)
        second = reviews.apply(self.adapter, self._prepare(self._manual("pending")))
        current = material(self.adapter, "show", identity=self.source["id"], at=second["commit"])
        self.assertEqual(len(current["resolved_references"]), 1)
        self.assertEqual(self._status()["counts"], {"resolved": 1, "pending": 1, "unavailable": 0})
        key = reviews.item_identity(self.inventory, 0)["item_key"]
        self.assertFalse(any(edge["body"]["item_key"] == key for edge in current["resolved_references"]))
        history = [edge for edge in current["relations"] if edge["kind"] == "references_resolved"]
        self.assertEqual(len(history), 2)
        self.assertEqual(material(self.adapter, "show", identity=self.source["id"], at=first["commit"]), old)

    def test_inventory_operations_read_only_selected_review_and_evidence_closure(self):
        noise = [{"id": "noise:source", "kind": "material", "revision": 1,
                  "body": {"content_base64": "x" * 65536}, "provenance": {"path": "unrelated/report"}},
                 {"id": "noise:target", "kind": "material", "revision": 1,
                  "body": {"text": "y" * 65536}, "provenance": {"path": "unrelated/target"}},
                 {"id": "review:unrelated", "kind": "review_decision", "revision": 1,
                  "body": {"edge_ids": ["noise:missing"], "evidence_refs": [{"id": "noise:missing", "revision": 1}]},
                  "provenance": {}}]
        edges = [{"id": "noise:edge:" + str(index), "kind": ("corrects", "narrows", "refutes")[index % 3],
                  "from_id": noise[0]["id"], "from_revision": 1, "from_kind": "material",
                  "to_id": noise[1]["id"], "to_revision": 1, "to_kind": "material",
                  "body": {"review_id": noise[2]["id"], "blob": "z" * 4096}} for index in range(100)]
        seeded = self.adapter.publish(noise, edges, "scope-noise", self.adapter.status()["version"])
        self.source_at = seeded["commit"]
        original_sql = self.adapter._sql
        reads = []

        def selected_sql(connection, query, params=()):
            result = original_sql(connection, query, params)
            if query.startswith("SELECT id,kind,revision,body,provenance") or query.startswith("SELECT current.id,current.kind,current.revision,current.body,current.provenance"):
                reads.extend(row[0] for row in result[0])
            if query.startswith("SELECT id,kind,from_id,from_revision,from_kind,to_id,to_revision,to_kind"):
                reads.extend(row[0] for row in result[0])
            return result

        with patch.object(self.adapter, "_sql", side_effect=selected_sql):
            self.assertEqual(self._status()["counts"]["pending"], 2)
            payload = self._prepare()
            published = reviews.apply(self.adapter, payload)
            self.assertEqual(published["review"]["counts"]["resolved"], 2)
            repeated = self._prepare()
            self.assertEqual(repeated["counts"], {"resolved": 2})
            self.assertEqual(reviews.apply(self.adapter, payload), dict(published, replayed=True))
        self.assertTrue(reads)
        self.assertFalse(any(identity.startswith("noise:") or identity == noise[2]["id"] for identity in reads))


if __name__ == "__main__":
    unittest.main()
