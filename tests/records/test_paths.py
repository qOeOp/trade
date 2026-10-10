"""All retained local paths exclude the same resolved temporary roots."""

import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from research.records import artifacts, ledger, retention, reviews
from research.records.common import ROOT, RecordError, _is_temporary_path


class RetainedPathTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="trade-path-test-", dir=Path.home())
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.system_temp = self.home / "system-temp"
        self.system_temp.mkdir()
        self.temporary = patch("research.records.common.tempfile.gettempdir", return_value=str(self.system_temp))
        self.temporary.start()
        self.addCleanup(self.temporary.stop)

    def test_helper_resolves_both_temp_roots_and_preserves_normal_home_paths(self):
        for path in (Path("/tmp"), Path("/tmp") / "new-seal", self.system_temp,
                     self.system_temp / "not-created" / "proof.json"):
            with self.subTest(path=path):
                self.assertTrue(_is_temporary_path(path))
        for path in (self.home / "retained", self.home / "system-temp-sibling"):
            with self.subTest(path=path):
                self.assertFalse(_is_temporary_path(path))
        link = self.home / "temp-alias"
        link.symlink_to(self.system_temp, target_is_directory=True)
        self.assertTrue(_is_temporary_path(link / "proof.json"))

    def test_all_custody_callers_reject_conventional_platform_and_linked_temp_paths(self):
        alias = self.home / "temp-alias"
        alias.symlink_to(self.system_temp, target_is_directory=True)
        for parent in (Path("/tmp") / "trade-disallowed-path-fixture", self.system_temp, alias, ROOT):
            target = parent / "new-retained-fixture"
            with self.subTest(parent=parent):
                with patch.object(ledger, "_binary") as binary:
                    with self.assertRaisesRegex(RecordError, "outside Git and /tmp"):
                        ledger.initialize("/unused-dolt", root=target)
                    binary.assert_not_called()
                with patch.object(ledger, "DoltStore") as store:
                    with self.assertRaisesRegex(RecordError, "outside Git and /tmp"):
                        ledger.backup({}, target)
                    store.assert_not_called()
                with self.assertRaisesRegex(RecordError, "outside Git and /tmp"):
                    reviews.retain_file(target / "evidence.json", "a" * 64)
                with self.assertRaisesRegex(RecordError, "outside Git and /tmp"):
                    retention._external_ref({"path": str(target / "recipe.json"), "sha256": "a" * 64}, "recipe_ref")
                with self.assertRaisesRegex(artifacts.ArtifactError, "outside Git and /tmp"):
                    artifacts._private_root(target)
                self.assertFalse(target.exists())

    def test_review_plan_and_backend_config_are_checked_before_writing(self):
        for parent in (Path("/tmp") / "trade-disallowed-path-fixture", self.system_temp, ROOT):
            destination = parent / "new-plan.json"
            args = SimpleNamespace(command="material", action="review", review_action="prepare", at=None,
                                   inventory_id="inventory:fixture", revision=1, source_at="a" * 32,
                                   decisions=None, supplemental=None, destination=destination)
            with self.subTest(parent=parent), patch.object(ledger, "open_store", return_value=SimpleNamespace(adapter=object())), \
                 patch.object(reviews, "prepare", return_value={}):
                with self.assertRaisesRegex(RecordError, "outside Git and /tmp"):
                    ledger.command(args)
                self.assertFalse(destination.exists())
            with patch.object(ledger, "config_path", return_value=destination), patch.object(ledger, "_binary") as binary:
                with self.assertRaisesRegex(RecordError, "backend config"):
                    ledger.initialize("/unused-dolt", root=self.home / "database")
                binary.assert_not_called()
                self.assertFalse(destination.exists())

    def test_normal_retained_home_evidence_passes_and_artifact_permissions_still_apply(self):
        raw = b"retained source bytes\n"
        evidence = self.home / "evidence.json"
        evidence.write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        self.assertEqual(reviews.retain_file(evidence, digest)["body"]["sha256"], digest)
        retention._external_ref({"path": str(evidence), "sha256": digest}, "recipe_ref")
        root = self.home / "archive"
        self.assertEqual(artifacts._private_root(root), root.resolve())
        self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
        alias = self.home / "archive-alias"
        alias.symlink_to(root, target_is_directory=True)
        with self.assertRaisesRegex(artifacts.ArtifactError, "symlink"):
            artifacts._private_root(alias)
        root.chmod(0o755)
        with self.assertRaisesRegex(artifacts.ArtifactError, "private"):
            artifacts._private_root(root)

    def test_fresh_processes_honor_changed_tmpdir_without_losing_tmp_exclusion(self):
        script = """
import json, sys, tempfile
from pathlib import Path
from research.records.common import _is_temporary_path
selected = Path(sys.argv[1]).resolve()
print(json.dumps([Path(tempfile.gettempdir()).resolve() == selected,
                  _is_temporary_path(selected / 'new.json'),
                  _is_temporary_path(Path('/tmp') / 'new.json'),
                  _is_temporary_path(selected.parent / 'retained')]))
"""
        for name in ("first-tmpdir", "second-tmpdir"):
            directory = self.home / name
            directory.mkdir()
            result = subprocess.run([sys.executable, "-c", script, str(directory)],
                                    env={**os.environ, "TMPDIR": str(directory), "TEMP": str(directory),
                                         "TMP": str(directory), "PYTHONDONTWRITEBYTECODE": "1"},
                                    capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout), [True, True, True, False])


if __name__ == "__main__":
    unittest.main()
