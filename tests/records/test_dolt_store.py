"""Real Dolt 2.4.2 integration checks, opt in with RESEARCH_DOLT_TEST_CONFIG.

The environment value is a JSON connection configuration. Each test creates
and removes its own randomly named database; the configured database is never
used. No mock database or alternate backend exercises this protocol.
"""

import copy
import json
import os
import threading
import unittest
import uuid
from unittest.mock import patch

import pymysql

from research.records.common import RecordError
from research.records.dolt_store import ConflictError, DoltStore


def _object(id="attempt:one", revision=1, body=None):
    return {"id": id, "kind": id.split(":", 1)[0], "revision": revision,
            "body": body or {"text": "frozen evidence 中文"},
            "provenance": {"path": "research/records/example.json", "sha256": "a" * 64}}


class RawPublicationGuardTests(unittest.TestCase):
    """The refusal precedes any connection, so no database is needed."""

    def test_raw_publication_is_refused_before_connecting(self):
        store = DoltStore({"database": "unused_guard_test"})
        relation = {"id": "relation:x", "kind": "run_of", "from_id": "run:x", "from_revision": 1,
                    "to_id": "attempt:x", "to_revision": 1, "body": {}}
        relabeled = dict(_object("attempt:x", revision=2), kind="material")
        with patch.object(store, "_connection", side_effect=AssertionError("reached the database")):
            for objects, relations in (([_object("review_evidence:" + "a" * 64)], []), ([relabeled], []),
                                       ([_object("run:x")], []), ([], [relation])):
                with self.subTest(objects=objects, relations=relations), self.assertRaises(RecordError) as caught:
                    store.publish(objects, relations, "raw", 0)
                self.assertEqual((caught.exception.code, caught.exception.write_status),
                                 ("RAW_RECORD_PUBLICATION", "not_written"))


class DoltStoreIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("real Dolt integration requires RESEARCH_DOLT_TEST_CONFIG")
        cls.connection_config = json.loads(raw)
        if not isinstance(cls.connection_config, dict):
            raise ValueError("RESEARCH_DOLT_TEST_CONFIG must be a JSON object")

    def setUp(self):
        self.config = dict(self.connection_config,
                           database="records_test_" + uuid.uuid4().hex)
        self.store = DoltStore(self.config)
        self.addCleanup(self._remove_test_database)
        self.initial = self.store.initialize()

    def _remove_test_database(self):
        # Only the generated test database is eligible for cleanup.
        self.assertTrue(self.config["database"].startswith("records_test_"))
        with self.store._connection(database=False) as conn:
            self.store._sql(conn, f"DROP DATABASE `{self.config['database']}`")

    def _publish(self, objects, relations=(), operation="first", expected=0, **kwargs):
        # Adapter tests exercise storage with synthetic records, below the publication contracts.
        return self.store.publish(objects, relations, operation, expected, validated_by="adapter test", **kwargs)

    def test_history_latest_and_immutable_rows(self):
        first = _object(body={"text": "original", "value": True})
        published = self._publish([first])
        corrected = _object(revision=2, body={"text": "corrected scope"})
        self._publish([first, corrected], operation="correction", expected=1)
        self.assertEqual(self.store.get_object(first["id"]), corrected)
        self.assertEqual(self.store.get_object(first["id"], revision=1), first)
        self.assertEqual(self.store.get_object(first["id"], commit=published["commit"]), first)
        self.assertIsNone(self.store.get_object(first["id"], revision=2, commit=published["commit"]))
        self.assertEqual(self.store.list_objects(commit=published["commit"]), [first])
        self.assertEqual(len(self.store.list_objects(latest=False)), 2)
        self.assertEqual(self.store.list_objects(kind="claim"), [])
        before = self.store.status()
        altered = copy.deepcopy(first)
        altered["body"]["text"] = "overwrite old revision"
        with self.assertRaisesRegex(ConflictError, "immutable object revision"):
            self._publish([altered], operation="overwrite", expected=2)
        self.assertEqual(before, self.store.status())
        self.assertEqual(self.store.get_object(first["id"], revision=1), first)
        altered = copy.deepcopy(first)
        altered["body"]["value"] = 1
        with self.assertRaisesRegex(ConflictError, "immutable object revision"):
            self._publish([altered], operation="change-json-type", expected=2)
        self.assertEqual(before, self.store.status())

    def test_operation_receipt_uses_the_original_commit_and_fixed_visibility(self):
        first = self._publish([_object()], operation="registered")
        later = self._publish([_object("attempt:later")], operation="later", expected=1)
        expected = {key: first[key] for key in ("operation_id", "version", "commit")}
        self.assertEqual(self.store.operation_receipt("registered"), expected)
        self.assertEqual(self.store.operation_receipt("registered", first["commit"]), expected)
        self.assertEqual(self.store.operation_receipt("registered", later["commit"]), expected)
        with self.assertRaisesRegex(RecordError, "unknown publication operation"):
            self.store.operation_receipt("later", first["commit"])

    def test_invalid_native_foreign_keys_abort_entire_publication(self):
        self._publish([_object()])
        before = self.store.status()
        new = _object("attempt:two")
        for operation, endpoint, endpoint_kind in (
            ("missing-endpoint", "claim:missing", "claim"),
            ("wrong-typed-endpoint", "attempt:one", "claim"),
        ):
            relation = {"id": "relation:" + operation, "kind": "uses_claim",
                        "from_id": new["id"], "from_revision": 1, "from_kind": "attempt",
                        "to_id": endpoint, "to_revision": 1, "to_kind": endpoint_kind,
                        "body": {"scope": "must roll back"}}
            with self.assertRaisesRegex(RecordError, "Dolt SQL error") as caught:
                self._publish([new], [relation], operation=operation, expected=1)
            self.assertIsInstance(caught.exception.__cause__, pymysql.MySQLError)
            self.assertEqual(before, self.store.status())
            self.assertIsNone(self.store.get_object(new["id"]))
            self.assertEqual(self.store.list_relations(), [])

    def test_kind_filter_does_not_resurrect_a_superseded_kind(self):
        old = _object()
        first = self._publish([old])
        new = dict(old, kind="claim", revision=2)
        self._publish([new], operation="new-kind", expected=1)
        self.assertEqual(self.store.list_objects(kind="attempt"), [])
        self.assertEqual(self.store.list_objects(kind="claim"), [new])
        self.assertEqual(self.store.list_objects(kind="attempt", latest=False), [old])
        self.assertEqual(self.store.list_objects(kind="attempt", commit=first["commit"]), [old])

    def test_latest_query_returns_only_selected_json_rows_at_the_fixed_commit(self):
        versions = [_object("attempt:many", revision=revision,
                            body={"revision": revision, "payload": "x" * 16384})
                    for revision in range(1, 8)]
        old_kind = _object("attempt:switched")
        steady = _object("claim:steady")
        first = self._publish([versions[0], old_kind, steady])
        new_kind = dict(old_kind, kind="claim", revision=2)
        later = _object("attempt:later")
        self._publish([*versions[1:], new_kind, later], operation="many-revisions", expected=1)

        native_sql = self.store._sql

        def read(**kwargs):
            selected_rows = []

            def observe(conn, statement, params=None):
                result = native_sql(conn, statement, params)
                if statement.startswith("SELECT ") and "body" in statement and "provenance" in statement:
                    selected_rows.append(result[0])
                return result

            # Observe the real protocol result before Python decoding so the
            # test fails if old revision JSON is transferred then discarded.
            with patch.object(self.store, "_sql", side_effect=observe):
                objects = self.store.list_objects(**kwargs)
            self.assertEqual(len(selected_rows), 1)
            self.assertEqual(len(selected_rows[0]), len(objects))
            json_bytes = sum(len(value.encode("utf-8")) for row in selected_rows[0]
                             for value in row[3:5])
            return objects, json_bytes

        current, current_bytes = read()
        self.assertEqual(current, [later, versions[-1], new_kind, steady])
        historical, _ = read(commit=first["commit"])
        self.assertEqual(historical, [versions[0], old_kind, steady])
        self.assertEqual(read(kind="attempt")[0], [later, versions[-1]])
        self.assertEqual(read(kind="claim")[0], [new_kind, steady])
        self.assertEqual(read(kind="attempt", commit=first["commit"])[0],
                         [versions[0], old_kind])
        self.assertEqual(read(kind="claim", commit=first["commit"])[0], [steady])
        all_revisions, all_bytes = read(latest=False)
        self.assertEqual(all_revisions, [later, *reversed(versions), new_kind, old_kind, steady])
        self.assertLess(current_bytes * 5, all_bytes)
        self.assertEqual(read(kind="attempt", latest=False)[0],
                         [later, *reversed(versions), old_kind])
        self.assertEqual(read(commit=first["commit"], latest=False)[0],
                         [versions[0], old_kind, steady])

    def test_relations_are_fixed_to_revision_and_historical_commit(self):
        attempt, claim = _object(), _object("claim:evidence")
        relation = {"id": "relation:uses", "kind": "uses_claim",
                    "from_id": attempt["id"], "from_revision": 1,
                    "to_id": claim["id"], "to_revision": 1,
                    "body": {"scope": "original"}}
        first = self._publish([attempt, claim], [relation])
        self._publish([_object("claim:evidence", revision=2, body={"scope": "new"})],
                      operation="correction", expected=1)
        self.assertEqual(self.store.list_relations(),
                         self.store.list_relations(commit=first["commit"]))
        self.assertEqual(self.store.list_relations()[0]["to_revision"], 1)
        before = self.store.status()
        changed = dict(relation, to_revision=2)
        with self.assertRaisesRegex(ConflictError, "immutable relation"):
            self._publish([], [changed], operation="rewrite-relation", expected=2)
        self.assertEqual(before, self.store.status())

    def test_relation_filters_preserve_snapshot_revision_and_index_reads(self):
        first, second = _object("attempt:source"), _object("claim:target")
        newer = _object(first["id"], revision=2)
        edges = [
            {"id": "edge:old", "kind": "repair", "from_id": first["id"], "from_revision": 1,
             "to_id": second["id"], "to_revision": 1, "body": {"scope": "old"}},
            {"id": "edge:new", "kind": "run_of", "from_id": first["id"], "from_revision": 2,
             "to_id": second["id"], "to_revision": 1, "body": {"scope": "new"}},
        ]
        frozen = self._publish([first, second], [edges[0]])["commit"]
        self._publish([newer], [edges[1]], operation="next-relation", expected=1)
        self.assertEqual([edge["id"] for edge in self.store.list_relations(
            from_refs=((first["id"], 1),))], ["edge:old"])
        self.assertEqual([edge["id"] for edge in self.store.list_relations(
            from_refs=((first["id"], None),))], ["edge:new", "edge:old"])
        self.assertEqual([edge["id"] for edge in self.store.list_relations(
            commit=frozen, to_refs=((second["id"], 1),))], ["edge:old"])
        self.assertEqual([edge["id"] for edge in self.store.list_relations(
            kinds=("repair",), from_refs=((first["id"], 2),), to_refs=((second["id"], 1),))], ["edge:old"])
        self.assertEqual(self.store.list_relations(commit=frozen, kinds=("run_of",)), [])
        indexed = self.store.list_relations(kinds=("run_of",), include_body=False)
        self.assertEqual(len(indexed), 1)
        self.assertNotIn("body", indexed[0])
        for filters in ({"kinds": ()}, {"from_refs": ()}):
            self.assertEqual(self.store.list_relations(**filters), [])
        for filters in ({"from_refs": ((first["id"], 0),)}, {"kinds": "repair"}, {"include_body": 1}):
            with self.assertRaises(RecordError):
                self.store.list_relations(**filters)

    def test_publication_refuses_uncommitted_sql_changes(self):
        import hashlib
        import tempfile
        from pathlib import Path
        from research.records import evidence

        self._publish([_object()])
        with self.store._connection() as conn:
            self.store._sql(conn, "INSERT INTO objects(id,kind,revision,body,provenance) VALUES(%s,%s,1,%s,%s)",
                            ("attempt:stray", "attempt", "{}", "{}"))
        before = self.store.status()
        self.assertTrue(before["dirty"])
        with self.assertRaises(RecordError) as caught:
            self._publish([_object("claim:new")], operation="after-stray", expected=before["version"])
        self.assertEqual((caught.exception.code, caught.exception.write_status), ("DIRTY_WORKING_SET", "not_written"))
        with tempfile.TemporaryDirectory(prefix="trade-dirty-test-", dir=Path.home()) as directory:
            path = Path(directory) / "evidence.txt"
            path.write_bytes(b"evidence")
            with self.assertRaises(RecordError) as caught:
                evidence.retain(self.store, [(path, hashlib.sha256(b"evidence").hexdigest())],
                                operation_id="retain-dirty", expected_version=before["version"])
        self.assertEqual(caught.exception.code, "DIRTY_WORKING_SET")
        self.assertEqual(before, self.store.status())

    def test_material_show_accepts_maximum_length_identity_without_impossible_legacy_lookup(self):
        from research.records.ledger import material

        selected = _object("material:" + "x" * (160 - len("material:")))
        published = self._publish([selected])
        result = material(self.store, "show", identity=selected["id"], at=published["commit"])
        self.assertEqual(result["object"]["id"], selected["id"])
        self.assertEqual(result["incoming_repairs"], [])

    def test_identical_operation_recovers_original_persistent_commit(self):
        first = self._publish([_object()], operation="retriable", message="snapshot migration")
        self._publish([_object("attempt:later")], operation="later", expected=1)
        before = self.store.status()
        # A new adapter/connection proves recovery needs no in-memory commit map.
        recovered = DoltStore(self.config).publish(
            [_object()], [], "retriable", 0, message="snapshot migration", validated_by="adapter test")
        self.assertEqual(recovered, dict(first, replayed=True))
        self.assertNotEqual(recovered["commit"], before["commit"])
        self.assertEqual(before, self.store.status())
        with self.assertRaisesRegex(ConflictError, "operation-content"):
            self._publish([_object()], operation="retriable", expected=0, message="changed message")
        self.assertEqual(before, self.store.status())

    def test_version_feedback_allows_checked_retry_and_rejects_changed_intent(self):
        self._publish([_object()], operation="first")
        before = self.store.status()
        payload = [_object("attempt:second")]
        with self.assertRaises(ConflictError) as caught:
            self._publish(payload, operation="second", expected=0)
        error = caught.exception.as_dict()
        self.assertEqual((error["code"], error["path"], error["expected"], error["write_status"]),
                         ("EXPECTED_VERSION_CONFLICT", "/expected_version", 1, "not_written"))
        self.assertIn("operation receipt", error["next_actions"][0])
        self.assertEqual(self.store.status(), before)
        with self.assertRaisesRegex(RecordError, "unknown publication operation"):
            self.store.operation_receipt("second")
        result = self._publish(payload, operation="second", expected=1)
        self.assertEqual(self.store.operation_receipt("second")["commit"], result["commit"])
        self.assertEqual(self._publish(payload, operation="second", expected=0), dict(result, replayed=True))
        after = self.store.status()
        with self.assertRaises(ConflictError) as caught:
            self._publish([_object("attempt:second", body={"changed": True})], operation="second", expected=2)
        error = caught.exception.as_dict()
        self.assertEqual((error["code"], error["path"], error["write_status"]),
                         ("OPERATION_CONTENT_CONFLICT", "/operation_id", "not_written"))
        self.assertEqual(self.store.status(), after)

    def test_integral_json_floats_are_stable_across_native_roundtrip(self):
        obj = _object(body={"value": 25.0, "nested": [5.0, 0.25, True]})
        first = self._publish([obj], operation="float-operation")
        self._publish([_object("attempt:later")], operation="later", expected=1)
        before = self.store.status()
        readback = self.store.get_object(obj["id"])
        self.assertEqual(readback["body"], {"value": 25, "nested": [5, 0.25, True]})
        self.assertEqual(self._publish([obj], operation="float-operation"),
                         dict(first, replayed=True))
        self.assertEqual(self._publish([readback], operation="float-operation"),
                         dict(first, replayed=True))
        self.assertEqual(before, self.store.status())
        # A new operation may include the unchanged native revision without
        # appending another object row or rejecting its numeric representation.
        self._publish([obj], operation="unchanged-float-row", expected=2)
        self.assertEqual(self.store.status()["object_revisions"], before["object_revisions"])

    def test_disjoint_concurrent_writes_from_same_version_create_one_commit(self):
        self._publish([_object()])
        for trial in range(3):
            before = self.store.status()
            barrier = threading.Barrier(2)
            outcomes = []

            class SynchronizedStore(DoltStore):
                def _read_head(inner, conn, commit=None):
                    row = super()._read_head(conn, commit)
                    if commit is None:
                        barrier.wait(timeout=15)
                    return row

            def writer(suffix):
                try:
                    value = SynchronizedStore(self.config).publish(
                        [_object(f"attempt:race-{trial}-{suffix}")], [],
                        f"race-{trial}-{suffix}", before["version"], validated_by="adapter test")
                    outcomes.append(value)
                except Exception as exc:
                    outcomes.append(exc)

            threads = [threading.Thread(target=writer, args=(suffix,)) for suffix in ("a", "b")]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=30)
                self.assertFalse(thread.is_alive())
            self.assertEqual(len(outcomes), 2)
            self.assertEqual(sum(isinstance(value, dict) for value in outcomes), 1, outcomes)
            conflicts = [value for value in outcomes if isinstance(value, Exception)]
            self.assertEqual(len(conflicts), 1)
            self.assertIsInstance(conflicts[0], ConflictError)
            self.assertIn("1213", str(conflicts[0]))
            after = self.store.status()
            for key in ("version", "operations", "object_revisions", "native_commits"):
                self.assertEqual(after[key], before[key] + 1, key)
            self.assertFalse(after["dirty"])

    def test_same_operation_concurrent_attempts_also_create_one_commit(self):
        before = self.store.status()
        barrier = threading.Barrier(2)
        outcomes = []

        class SynchronizedStore(DoltStore):
            def _read_head(inner, conn, commit=None):
                row = super()._read_head(conn, commit)
                if commit is None:
                    barrier.wait(timeout=15)
                return row

        def writer():
            try:
                outcomes.append(SynchronizedStore(self.config).publish([_object()], [], "same-operation", 0,
                                                                       validated_by="adapter test"))
            except Exception as exc:
                outcomes.append(exc)

        threads = [threading.Thread(target=writer) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive())
        self.assertEqual(sum(isinstance(value, dict) for value in outcomes), 1, outcomes)
        self.assertEqual(sum(isinstance(value, ConflictError) for value in outcomes), 1, outcomes)
        after = self.store.status()
        self.assertEqual(after["operations"], 1)
        self.assertEqual(after["native_commits"], before["native_commits"] + 1)
        self.assertTrue(self._publish([_object()], operation="same-operation")["replayed"])

    def test_explicit_version_and_configuration_do_not_fall_back(self):
        self.assertEqual(self.initial["version"], 0)
        self.assertEqual(self.initial, self.store.initialize())
        self._publish([_object()])
        before = self.store.status()
        with self.assertRaisesRegex(ConflictError, "expected-version"):
            self._publish([_object("attempt:stale")], operation="stale", expected=0)
        self.assertEqual(before, self.store.status())
        for config in ({}, {"database": "bad/name"},
                       {"database": "valid", "dolt_version": "next"},
                       {"database": "valid", "schema_version": 2}):
            with self.assertRaises(RecordError):
                DoltStore(config)
        with self.assertRaisesRegex(RecordError, "exact.*commit hash"):
            self.store.get_object("attempt:one", commit="HEAD")
        disconnected = DoltStore(dict(self.config, port=1, unix_socket=None))
        with self.assertRaisesRegex(RecordError, "Dolt SQL error"):
            disconnected.list_objects()


if __name__ == "__main__":
    unittest.main()
