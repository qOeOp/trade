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
import uuid

from research.records import reviews
from research.records.common import ROOT, RecordError, _read_json
from research.records.dolt_store import ConflictError, DoltStore
from research.records.ledger import material


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
        with self.assertRaisesRegex(RecordError, "retained original decision file"):
            self._prepare(self._manual("resolved"))
        mismatched = self._manual()
        mismatched["decisions"][0]["item_sha256"] = "0" * 64
        with self.assertRaisesRegex(RecordError, "mismatched manual review occurrence"):
            self._prepare(mismatched)
        self.assertEqual(self.adapter.status(), before)

    def test_missing_fixed_proof_and_resolution_edge_reject_entire_payload(self):
        payload = self._prepare()
        target = next(obj for obj in payload["objects"] if obj["kind"] == "reference")
        before = self.adapter.status()
        missing_proof = copy.deepcopy(payload)
        missing_proof["objects"] = [obj for obj in missing_proof["objects"] if obj["id"] != target["id"]]
        with self.assertRaisesRegex(RecordError, "fixed proof is missing"):
            reviews.apply(self.adapter, self._reseal(missing_proof))
        self.assertEqual(self.adapter.status(), before)
        missing_edge = copy.deepcopy(payload)
        removed = next(edge for edge in missing_edge["relations"] if edge["kind"] == "references_resolved")
        missing_edge["relations"] = [edge for edge in missing_edge["relations"] if edge["id"] != removed["id"]]
        with self.assertRaisesRegex(RecordError, "closed review edge is absent"):
            reviews.apply(self.adapter, self._reseal(missing_edge))
        self.assertEqual(self.adapter.status(), before)

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


if __name__ == "__main__":
    unittest.main()
