"""Candidates: source checks without execution, publication, lineage and exact reads."""

from __future__ import annotations

import hashlib
import unittest
from unittest.mock import patch

from ledger import db, strategies
from ledger.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, SOURCE, Service, source


class SourceCheckTests(unittest.TestCase):
    def code(self, data, entry) -> str:
        with self.assertRaises(Refusal) as caught:
            strategies.check_source(data, entry)
        return caught.exception.code

    def test_a_source_parses_without_running(self):
        strategies.check_source(SOURCE, "Fixture")
        strategies.check_source(b"raise SystemExit(1)\nclass Fixture:\n    pass\n", "Fixture")

    def test_source_refusals(self):
        self.assertEqual(self.code(b"", "Fixture"), "SOURCE_SIZE")
        self.assertEqual(self.code("class Fixture: pass", "Fixture"), "SOURCE_SIZE")
        with patch.object(strategies, "MAX_SOURCE_BYTES", 10):
            self.assertEqual(self.code(SOURCE, "Fixture"), "SOURCE_SIZE")
        self.assertEqual(self.code(SOURCE, "not-a-name"), "ENTRY_CLASS_INVALID")
        self.assertEqual(self.code(b"def broken(:\n", "Fixture"), "SOURCE_SYNTAX")
        self.assertEqual(self.code(b"\xff\xfe", "Fixture"), "SOURCE_SYNTAX")
        self.assertEqual(self.code(SOURCE, "Missing"), "ENTRY_CLASS_NOT_UNIQUE")
        self.assertEqual(self.code(b"class A:\n  pass\nclass A:\n  pass\n", "A"), "ENTRY_CLASS_NOT_UNIQUE")
        self.assertEqual(self.code(b"def f():\n  class A:\n    pass\n", "A"), "ENTRY_CLASS_NOT_UNIQUE")


class FakeConnection:
    def __init__(self, row):
        self.row = row

    def one(self, statement, params):
        return dict(self.row) if self.row else None


class ReadCandidateShapeTests(unittest.TestCase):
    def test_references_and_corrupt_rows_are_refused(self):
        for ref in ("x", "x@0", "x@-1", "x@01", "@1", None):
            with self.subTest(ref=ref), self.assertRaises(Refusal) as caught:
                strategies.read_candidate(FakeConnection(None), ref)
            self.assertEqual(caught.exception.code, "BAD_REF")
        with self.assertRaises(Refusal) as caught:
            strategies.read_candidate(FakeConnection(None), "x@1")
        self.assertEqual(caught.exception.code, "UNKNOWN_CANDIDATE")
        row = {"source": SOURCE + b"tampered", "source_sha256": hashlib.sha256(SOURCE).hexdigest()}
        with self.assertRaises(Refusal) as caught:
            strategies.read_candidate(FakeConnection(row), "x@1")
        self.assertEqual(caught.exception.code, "LEDGER_CORRUPT")


@unittest.skipUnless(BINARY, SKIP)
class PublishTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.addClassCleanup(cls.service.close)
        cls.profile = cls.service.ledger("candidates")

    def publish(self, data, strategy_id="rsi", **kwargs):
        description = kwargs.pop("description", "rule")
        return strategies.publish_candidate(self.profile, data, strategy_id, "Fixture", description, **kwargs)

    def code(self, *args, **kwargs) -> str:
        with self.assertRaises(Refusal) as caught:
            self.publish(*args, **kwargs)
        return caught.exception.code

    def test_roots_children_and_retries(self):
        root = self.publish(source("root"), "lineage")
        self.assertEqual((root["candidate"], root["replayed"], root["runtime_contract"]),
                         ("lineage@1", False, strategies.RUNTIME_CONTRACT))
        self.assertEqual(root["source_sha256"], hashlib.sha256(source("root")).hexdigest())
        child = self.publish(source("child"), "lineage", parent="lineage@1", difference="tighter stop")
        self.assertEqual(child["candidate"], "lineage@2")
        again = self.publish(source("child"), "lineage", parent="lineage@1", difference="tighter stop")
        self.assertEqual((again["candidate"], again["replayed"], again["ledger_commit"]),
                         ("lineage@2", True, child["ledger_commit"]))
        with db.connect(self.profile, "reader") as reader:
            row = strategies.read_candidate(reader, "lineage@2")
        self.assertEqual((row["source"], row["parent_strategy_id"], row["parent_revision"], row["difference"]),
                         (source("child"), "lineage", 1, "tighter stop"))
        (created,), = self.service.sql(self.profile, "SELECT created_at FROM candidate WHERE revision = 2 "
                                                     "AND strategy_id = 'lineage'")[0:1]
        self.assertIsNotNone(created)

    def test_publication_refusals(self):
        self.publish(source("taken"), "taken")
        self.assertEqual(self.code(source("taken"), "other"), "SOURCE_EXISTS")
        self.assertEqual(self.code(source("x"), "bad id"), "INVALID_ID")
        self.assertEqual(self.code(source("x"), description=" "), "NOTE_INVALID")
        self.assertEqual(self.code(source("x"), description="x" * 2001), "NOTE_INVALID")
        self.assertEqual(self.code(source("x"), parent="taken@1", difference=""), "NOTE_INVALID")
        self.assertEqual(self.code(source("x"), parent="taken@1"), "LINEAGE_INCOMPLETE")
        self.assertEqual(self.code(source("x"), difference="why"), "LINEAGE_INCOMPLETE")
        self.assertEqual(self.code(source("x"), parent="taken", difference="why"), "BAD_REF")
        self.assertEqual(self.code(source("x"), parent="taken@9", difference="why"), "UNKNOWN_CANDIDATE")
        self.assertEqual(self.code(b"", "x"), "SOURCE_SIZE")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM candidate WHERE strategy_id = 'x'"),
                         [(0,)])

    def test_an_operation_id_never_returns_another_candidate(self):
        first = self.publish(source("op owner"), "owner", op_id="publish:fixed")
        with self.assertRaises(Refusal) as caught:
            self.publish(source("op thief"), "thief", op_id="publish:fixed")
        self.assertEqual(caught.exception.code, "OP_ID_CONFLICT")
        again = self.publish(source("op owner"), "owner", op_id="publish:fixed")
        self.assertEqual((again["candidate"], again["replayed"]), (first["candidate"], True))

    def test_reads_follow_the_version_of_the_connection(self):
        with db.connect(self.profile, "reader") as reader:
            before = db.head_commit(reader)
        self.publish(source("versioned"), "versioned")
        with db.read_as_of(self.profile, before) as old, self.assertRaises(Refusal) as caught:
            strategies.read_candidate(old, "versioned@1")
        self.assertEqual(caught.exception.code, "UNKNOWN_CANDIDATE")


if __name__ == "__main__":
    unittest.main()
