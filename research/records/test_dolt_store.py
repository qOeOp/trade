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

import pymysql

from research.records.common import RecordError
from research.records.dolt_store import ConflictError, DoltStore


def _object(id="attempt:one", revision=1, body=None):
    return {"id": id, "kind": id.split(":", 1)[0], "revision": revision,
            "body": body or {"text": "frozen evidence 中文"},
            "provenance": {"path": "research/records/example.json", "sha256": "a" * 64}}


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
        return self.store.publish(objects, relations, operation, expected, **kwargs)

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

    def test_identical_operation_recovers_original_persistent_commit(self):
        first = self._publish([_object()], operation="retriable", message="snapshot migration")
        self._publish([_object("attempt:later")], operation="later", expected=1)
        before = self.store.status()
        # A new adapter/connection proves recovery needs no in-memory commit map.
        recovered = DoltStore(self.config).publish(
            [_object()], [], "retriable", 0, message="snapshot migration")
        self.assertEqual(recovered, dict(first, replayed=True))
        self.assertNotEqual(recovered["commit"], before["commit"])
        self.assertEqual(before, self.store.status())
        with self.assertRaisesRegex(ConflictError, "operation-content"):
            self._publish([_object()], operation="retriable", expected=0, message="changed message")
        self.assertEqual(before, self.store.status())

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
                        f"race-{trial}-{suffix}", before["version"])
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
                outcomes.append(SynchronizedStore(self.config).publish([_object()], [], "same-operation", 0))
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
