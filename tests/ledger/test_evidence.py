"""Evidence bundles: exact bytes, ledger-derived hashes, refusals that write nothing, idempotent retries."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ledger import db, evidence
from ledger.errors import Refusal
from tests.ledger.dolt import BINARY, SKIP, Service


class EvidenceShapeTests(unittest.TestCase):
    """Refusals decided from the name and the files alone, before any connection is used."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="le-", dir="/tmp"))
        self.addCleanup(__import__("shutil").rmtree, self.root, ignore_errors=True)

    def code(self, bundle, sources) -> str:
        with self.assertRaises(Refusal) as caught:
            evidence.add_bundle(None, bundle, sources)
        return caught.exception.code

    def files(self, name: str, **contents) -> Path:
        directory = self.root / name
        for path, data in contents.items():
            (directory / path.replace("__", "/")).parent.mkdir(parents=True, exist_ok=True)
            (directory / path.replace("__", "/")).write_bytes(data)
        return directory

    def test_bundle_names_and_the_sealed_namespace(self):
        good = self.files("good", **{"a.txt": b"a"})
        for name in ("", "-x", "a" * 161, "a/b", "a b"):
            with self.subTest(name=name):
                self.assertEqual(self.code(name, [good]), "INVALID_BUNDLE_NAME")
        for name in ("trial-3-execution", "trial-3-execution-start", "trial-3-recovery", "trial-3-recovery-1"):
            with self.subTest(name=name):
                self.assertEqual(self.code(name, [good]), "RESERVED_BUNDLE")

    def test_links_absolute_or_repeated_paths_are_refused(self):
        target = self.files("target", **{"a.txt": b"a"})
        os.symlink(target / "a.txt", self.root / "link.txt")
        self.assertEqual(self.code("b", [self.root / "link.txt"]), "INVALID_EVIDENCE_PATH")
        nested = self.files("nested", **{"x.txt": b"x"})
        os.symlink(target, nested / "inner")
        self.assertEqual(self.code("b", [nested]), "INVALID_EVIDENCE_PATH")
        other = self.files("other", **{"a.txt": b"b"})
        self.assertEqual(self.code("b", [target / "a.txt", other / "a.txt"]), "INVALID_EVIDENCE_PATH")
        self.assertEqual(self.code("b", [self.root / "missing.txt"]), "INVALID_EVIDENCE_PATH")

    def test_empty_media_and_oversized_files_are_refused(self):
        self.assertEqual(self.code("b", [self.files("empty", **{"a.txt": b"a", "b.txt": b""})]), "EMPTY_EVIDENCE")
        (self.root / "none").mkdir()
        self.assertEqual(self.code("b", [self.root / "none"]), "EMPTY_EVIDENCE")
        self.assertEqual(self.code("b", [self.files("media", **{"talk.MP4": b"v"})]), "MEDIA_NOT_KEPT")
        with patch.object(evidence, "MAX_FILE_BYTES", 3):
            self.assertEqual(self.code("b", [self.files("big", **{"a.txt": b"abcd"})]), "EVIDENCE_TOO_LARGE")


@unittest.skipUnless(BINARY, SKIP)
class EvidenceLedgerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.profile = cls.service.ledger("evidence")

    @classmethod
    def tearDownClass(cls):
        cls.service.close()

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="le-", dir="/tmp"))
        self.addCleanup(__import__("shutil").rmtree, self.root, ignore_errors=True)
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def directory(self, name: str, **contents) -> Path:
        directory = self.root / name
        for path, data in contents.items():
            (directory / path).parent.mkdir(parents=True, exist_ok=True)
            (directory / path).write_bytes(data)
        return directory

    def test_a_bundle_round_trips_exact_bytes_and_a_retry_is_a_replay(self):
        source = self.directory("notes", **{"claims.json": b'{"claims": []}\n', "sub/raw.bin": bytes(range(256))})
        first = evidence.add_bundle(self.conn, "notes-1", [source])
        again = evidence.add_bundle(self.conn, "notes-1", [source])
        self.assertEqual((first["write_status"], again["write_status"]), ("written", "replayed"))
        self.assertEqual((again["files"], again["ledger_commit"]), (first["files"], first["ledger_commit"]))
        self.assertEqual(set(first["files"]), {"claims.json", "sub/raw.bin"})
        with db.read_as_of(self.profile) as reader:
            loaded = evidence.load_bundle(reader, "notes-1")
        self.assertEqual(loaded["files"]["sub/raw.bin"], bytes(range(256)))
        self.assertEqual(loaded["digests"], first["files"])
        self.assertEqual(loaded["commit"], first["ledger_commit"])
        stored = dict(self.service.sql(self.profile, "SELECT path, byte_length FROM evidence WHERE bundle = 'notes-1'"))
        self.assertEqual(stored, {"claims.json": 15, "sub/raw.bin": 256})

    def test_a_name_is_never_reused_for_other_content(self):
        evidence.add_bundle(self.conn, "taken", [self.directory("one", **{"a.txt": b"one"})])
        seq = self.service.sql(self.profile, "SELECT seq FROM ledger_head")
        with self.assertRaises(Refusal) as caught:
            evidence.add_bundle(self.conn, "taken", [self.directory("two", **{"a.txt": b"two"})])
        self.assertEqual((caught.exception.code, caught.exception.write_status), ("BUNDLE_EXISTS", "not_written"))
        self.assertEqual(self.service.sql(self.profile, "SELECT seq FROM ledger_head"), seq)

    def test_load_reads_an_exact_version_and_refuses_unknown_or_corrupt_bundles(self):
        before = db.head_commit(self.conn)
        evidence.add_bundle(self.conn, "later", [self.directory("later", **{"a.txt": b"a"})])
        self.assertEqual(evidence.load_bundle(self.conn, "later")["files"], {"a.txt": b"a"})
        for bundle, at, code in (("later", before, "UNKNOWN_BUNDLE"), ("absent", None, "UNKNOWN_BUNDLE"),
                                 ("bad name", None, "INVALID_BUNDLE_NAME")):
            with self.subTest(bundle=bundle, at=at), self.assertRaises(Refusal) as caught:
                evidence.load_bundle(self.conn, bundle, at)
            self.assertEqual(caught.exception.code, code)
        real = evidence._fetch

        def altered(conn, bundle, clause):
            head, rows = real(conn, bundle, clause)
            return head, [(path, content + b"!", stored) for path, content, stored in rows]

        with patch.object(evidence, "_fetch", altered), self.assertRaises(Refusal) as caught:
            evidence.load_bundle(self.conn, "later")
        self.assertEqual(caught.exception.code, "LEDGER_CORRUPT")


if __name__ == "__main__":
    unittest.main()
