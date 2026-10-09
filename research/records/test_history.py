"""Fixed Git archive reads in a tiny repo after historical files leave its tree."""

import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from research.records import cli
from research.records.common import RecordError
from research.records.fixtures.contract_repository import ContractRepository
from research.records.history import INDEX_PATH, load_archive, read_archive_bytes


class FixedGitArchiveTests(unittest.TestCase):
    def setUp(self):
        self.fixture = ContractRepository()
        self.addCleanup(self.fixture.close)
        self.context = self.fixture.patches()
        self.addCleanup(self.context.close)
        self.attempts, self.runs = self.fixture.snapshot()
        self.index = {
            "schema_version": 1, "git_commit": self.fixture.head,
            "prefixes": ["research/records/attempts/", "research/records/runs/",
                         "research/r1_native/", "evidence/"],
            "purpose": "Synthetic fixed historical source read, never a metadata fallback.",
        }

    def archive(self):
        self.fixture.json(INDEX_PATH, self.index)
        for relative in self.index["prefixes"]:
            shutil.rmtree(self.fixture.root / relative)

    def test_unindexed_fixture_uses_its_current_records_and_evidence(self):
        self.assertIsNone(load_archive(self.fixture.root))
        self.assertIsNone(read_archive_bytes("evidence/audit.json", self.fixture.root))
        self.assertEqual(cli._check_ref(self.runs["F01-11-20261008"]["audit_ref"]), "verified")

    def test_source_archive_and_summary_read_frozen_bytes_without_worktree_files(self):
        self.archive()
        attempts, runs = self.attempts, self.runs
        self.assertEqual(load_archive(self.fixture.root).commit, self.fixture.head)
        shown = cli._show("F01", attempts, runs)
        self.assertEqual(set(shown["comparison_runs"]), {"00", "10", "01", "11"})
        self.assertTrue(all(item["status"] == "verified" for item in shown["evidence_status"]))
        self.assertEqual(cli._summary(runs["F01-11-20261008"])["final_equity_usdt"], "100014.50")
        comparison = cli._compare("F01-11-20261008", "F01-10-20261008", runs)
        self.assertEqual(comparison["metrics"]["final_equity_usdt"]["difference"], "-5.50")
        validation = cli._validate(attempts, runs)
        self.assertEqual((validation["attempts"], validation["runs"]), (9, 8))
        self.assertTrue(all(status == "verified" for status in validation["source_revision_status"].values()))
        self.assertFalse((self.fixture.records / "attempts").exists())
        self.assertFalse((self.fixture.root / "evidence").exists())

    def test_archive_bytes_stay_fixed_and_current_evidence_must_match_its_hash(self):
        self.archive()
        changed = copy.deepcopy(self.attempts["H08"])
        changed["decision"]["next_action"] = "Unauthorized current receipt rewrite"
        self.fixture.json("research/records/attempts/H08/attempt.json", changed)
        raw = read_archive_bytes("research/records/attempts/H08/attempt.json", self.fixture.root)
        self.assertEqual(json.loads(raw), self.attempts["H08"])
        ref = self.runs["F01-11-20261008"]["summary_ref"]
        self.fixture.json(ref["path"], {"wrong": "current file cannot bypass its frozen reference hash"})
        with self.assertRaisesRegex(RecordError, "hash mismatch"):
            cli._check_ref(ref)
        with self.assertRaisesRegex(RecordError, "hash mismatch"):
            cli._read_evidence_json(ref)

    def test_bad_hash_unknown_path_and_missing_listed_blob_are_rejected(self):
        self.archive()
        ref = self.runs["F01-11-20261008"]["summary_ref"]
        with self.assertRaisesRegex(RecordError, "hash mismatch"):
            cli._read_evidence_json(dict(ref, sha256="0" * 64))
        unknown = {"path": "unlisted/report.json", "sha256": "0" * 64}
        self.assertEqual(cli._check_ref(unknown), "unavailable")
        with self.assertRaisesRegex(RecordError, "unavailable"):
            cli._read_evidence_json(unknown)
        with self.assertRaisesRegex(RecordError, "archived source is unavailable"):
            cli._check_ref({"path": "evidence/missing.json", "sha256": "0" * 64})

    def test_missing_anchor_fails_visibly_in_source_and_evidence_readers(self):
        self.archive()
        self.fixture.json(INDEX_PATH, dict(self.index, git_commit="0" * 40))
        with self.assertRaisesRegex(RecordError, "fixed Git archive is unavailable"):
            load_archive(self.fixture.root)
        with self.assertRaisesRegex(RecordError, "fixed Git archive is unavailable"):
            cli._check_ref(self.runs["F01-11-20261008"]["summary_ref"])

    def test_archive_paths_and_index_prefixes_cannot_escape_or_use_git_pathspecs(self):
        self.archive()
        for path in ("../README.md", str(self.fixture.root / "README.md"),
                     "evidence/../README.md", "evidence\\audit.json", ":(glob)*", "evidence/./audit.json"):
            with self.subTest(path=path), self.assertRaisesRegex(RecordError, "invalid archived source path"):
                cli._check_ref({"path": path, "sha256": "0" * 64})
        for prefixes in (["../"], ["./"], ["evidence/", "evidence/"], [{}]):
            self.fixture.json(INDEX_PATH, dict(self.index, prefixes=prefixes))
            with self.subTest(prefixes=prefixes), self.assertRaises(RecordError):
                load_archive(self.fixture.root)

    def test_archived_symlink_is_not_read_as_source_bytes(self):
        (self.fixture.root / "evidence/link.json").symlink_to("../README.md")
        self.index["git_commit"] = self.fixture.commit("Synthetic archived symlink")
        self.archive()
        with self.assertRaisesRegex(RecordError, "not a regular Git blob"):
            cli._check_ref({"path": "evidence/link.json", "sha256": "0" * 64})

    def test_artifact_uri_still_reads_only_configured_current_custody(self):
        self.archive()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report = root / "fixture/audit.json"
            report.parent.mkdir()
            raw = b'{"passed":true}\n'
            report.write_bytes(raw)
            ref = {"path": "artifact://fixture/audit.json", "sha256": hashlib.sha256(raw).hexdigest()}
            with patch.dict("os.environ", {"TRADE_RESEARCH_ARTIFACT_ROOT": str(root)}):
                self.assertEqual(cli._check_ref(ref), "verified")
                self.assertEqual(cli._read_evidence_json(ref), {"passed": True})


if __name__ == "__main__":
    unittest.main()
