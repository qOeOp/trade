"""Fixed source layouts are selected by trusted Git, including direct main checks."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from engine import config
from shared.errors import Refusal
from runtime import image
from tests.runtime import test_image as image_tests
from tests.helpers import refused


CONTRACT = "replay-contract@v8"
CURRENT = image.layout(CONTRACT)["source_paths"]
# The five-file map of builds before replay-contract@v8; no image of this contract reports it.
LEGACY = {key: CURRENT[key] for key in ("config_source_sha256", "runner_source_sha256", "load_source_sha256",
                                        "report_source_sha256", "fingerprint_source_sha256")}
# The map v8 images built before 2026-11-13 report: their runs still reproduce.
EARLIER, = image.EARLIER_SOURCE_PATHS[CONTRACT]


def declaration(paths):
    return ("RUNTIME_SOURCE_PATHS = " + repr(paths) + "\n").encode()


class SourceIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="source-identity-")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.git("init", "--quiet", "--initial-branch", "main")
        cls.builds = []
        for paths in (LEGACY, CURRENT, EARLIER):
            files = {path: (path + "\n").encode() for path in (*paths.values(), "engine/audit.py", "uv.lock")}
            files["engine/config.py"] = declaration(paths)
            for path, raw in files.items():
                destination = cls.root / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(raw)
            cls.git("add", ".")
            cls.git("commit", "--quiet", "-m", "source layout")
            revision = cls.git("rev-parse", "HEAD").strip()
            identity = {"image_ref": image.REPOSITORY + "@sha256:" + "a" * 64,
                        "image_digest": "sha256:" + "a" * 64, "platform": "linux/arm64",
                        "runtime_contract": CONTRACT, "build_revision": revision}
            inspection = {"source_file_paths": dict(paths),
                          "source_files_sha256": {field: hashlib.sha256(files[path]).hexdigest()
                                                  for field, path in paths.items()},
                          "audit_source_sha256": hashlib.sha256(files["engine/audit.py"]).hexdigest(),
                          "dependency_lock_sha256": hashlib.sha256(files["uv.lock"]).hexdigest()}
            cls.builds.append((identity, inspection))
        cls.git("update-ref", "refs/remotes/origin/main", "HEAD")

    @classmethod
    def git(cls, *args):
        return subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@invalid",
                               "-c", "commit.gpgsign=false", *args], cwd=cls.root, capture_output=True,
                              text=True, check=True).stdout

    def check(self, build, inspection=None):
        identity, original = self.builds[build]
        with patch.object(image, "CHECKOUT", self.root):
            return image.require_main_build(identity, original if inspection is None else inspection)

    def refused(self, build, inspection):
        self.assertEqual(refused(self.check, build, inspection).code, "RUNTIME_NOT_MAIN")

    def test_only_the_complete_current_layout_is_a_main_build(self):
        before = json.dumps(self.builds, sort_keys=True)
        self.assertEqual(self.check(1), self.builds[1][0]["build_revision"])
        self.assertEqual(json.dumps(self.builds, sort_keys=True), before)
        with self.assertRaises(Refusal):  # a revision declaring the older, shorter map
            self.check(0)
        self.refused(1, self.builds[0][1])  # no new-revision downgrade to the complete old map
        downgraded = deepcopy(self.builds[1][1])
        downgraded["source_file_paths"] = dict(LEGACY)
        downgraded["source_files_sha256"] = {key: value for key, value in downgraded["source_files_sha256"].items()
                                            if key in LEGACY}
        self.refused(1, downgraded)  # even when all five reported hashes match the new revision
        self.refused(0, self.builds[1][1])  # do not rewrite history with new fields

    def test_an_earlier_v8_image_is_still_a_main_build_of_its_own_revision_only(self):
        self.assertEqual(set(EARLIER) - set(CURRENT), {"live_errors_source_sha256"})
        self.assertEqual(self.check(2), self.builds[2][0]["build_revision"])
        self.refused(1, self.builds[2][1])  # a current revision takes no earlier map
        self.refused(2, self.builds[1][1])  # nor an earlier revision the current one
        helper = image_tests.ProbeTests()
        result, _ = helper.inspect(probe=helper.probe(source_file_paths=dict(EARLIER),
                                                      source_files_sha256={key: "d" * 64 for key in EARLIER}))
        self.assertEqual(result["source_file_paths"], EARLIER)

    def test_direct_main_check_rejects_missing_swapped_extra_or_invalid_fields(self):
        for field in ("strategy_source_sha256", "fill_source_sha256"):
            for change in ("omit", "wrong_hash", "wrong_path", "invalid_hash"):
                candidate = deepcopy(self.builds[1][1])
                if change == "omit":
                    candidate["source_file_paths"].pop(field)
                    candidate["source_files_sha256"].pop(field)
                elif change == "wrong_path":
                    candidate["source_file_paths"][field] = "engine/run.py"
                else:
                    candidate["source_files_sha256"][field] = "0" * 64 if change == "wrong_hash" else None
                with self.subTest(field=field, change=change):
                    self.refused(1, candidate)
        for field in ("source_file_paths", "source_files_sha256"):
            candidate = deepcopy(self.builds[1][1])
            candidate[field]["unexpected_source_sha256"] = "engine/extra.py" if field.endswith("paths") else "0" * 64
            self.refused(1, candidate)
        for malformed in (None, [], {}, {"source_file_paths": None}):
            # Explicit None should exercise the direct entry, not check()'s convenience default.
            identity = self.builds[1][0]
            with patch.object(image, "CHECKOUT", self.root), self.assertRaises(Refusal) as caught:
                image.require_main_build(identity, malformed)
            self.assertEqual(caught.exception.code, "RUNTIME_NOT_MAIN")

    def test_native_metadata_changes_when_either_extracted_module_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for path in config.RUNTIME_SOURCE_PATHS.values():
                destination = root / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes((config.ROOT / path).read_bytes())
            with patch.object(config, "ROOT", root):
                before = config.runtime_source_metadata()
                for field, path in (("strategy_source_sha256", "engine/strategy.py"),
                                    ("fill_source_sha256", "engine/fill.py")):
                    original = (root / path).read_bytes()
                    (root / path).write_bytes(original + b"\n# changed disposable source copy\n")
                    after = config.runtime_source_metadata()
                    self.assertNotEqual(before[field], after[field])
                    self.assertEqual(before["runner_source_sha256"], after["runner_source_sha256"])
                    (root / path).write_bytes(original)

    def test_probe_accepts_only_the_complete_current_map(self):
        helper = image_tests.ProbeTests()
        probe = helper.probe(source_file_paths=dict(CURRENT), source_files_sha256={key: "d" * 64 for key in CURRENT})
        result, _ = helper.inspect(probe=probe)
        self.assertEqual(result["source_file_paths"], CURRENT)
        bad = [dict(LEGACY), dict(CURRENT)]
        bad[1].pop("fill_source_sha256")
        bad += [{**CURRENT, "fill_source_sha256": "engine/run.py"},
                {**CURRENT, "extra_source_sha256": "engine/extra.py"}]
        for paths in bad:
            with self.subTest(paths=paths), self.assertRaises(Refusal) as caught:
                helper.inspect(probe=helper.probe(source_file_paths=paths,
                                                  source_files_sha256={key: "d" * 64 for key in paths}))
            self.assertEqual(caught.exception.code, "RUNTIME_MISMATCH")

    def test_trusted_declaration_is_parsed_without_executing_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "executed"
            source = f"__import__('pathlib').Path({str(marker)!r}).touch()\n".encode() + declaration(CURRENT)
            self.assertEqual(image._declared_source_paths(source, CONTRACT), CURRENT)
            self.assertFalse(marker.exists())

    def test_dynamic_ambiguous_unknown_or_missing_trusted_declaration_is_refused(self):
        variants = [b"", b"not Python !!!", b"RUNTIME_SOURCE_PATHS = make_paths()\n",
                    declaration(CURRENT) + declaration(LEGACY),
                    declaration(CURRENT) + b"RUNTIME_SOURCE_PATHS.update({})\n",
                    declaration(CURRENT) + b"RUNTIME_SOURCE_PATHS['x'] = 'x'\n",
                    declaration(CURRENT) + b"RUNTIME_SOURCE_PATHS |= {}\n",
                    declaration({**CURRENT, "fill_source_sha256": "../outside.py"}),
                    b"if True:\n    " + declaration(CURRENT),
                    b"RUNTIME_SOURCE_PATHS = {**OTHER}\n",
                    declaration(CURRENT).rstrip()[:-1] + b", 'fill_source_sha256': 'engine/fill.py'}\n"]
        for source in variants:
            with self.subTest(source=source), self.assertRaises(Refusal) as caught:
                image._declared_source_paths(source, CONTRACT)
            self.assertEqual(caught.exception.code, "RUNTIME_NOT_MAIN")
        identity, inspection = self.builds[1]
        original_git = image._git

        def changed(*args, **kwargs):
            if args == ("show", f"{identity['build_revision']}:engine/config.py"):
                return subprocess.CompletedProcess(args, 1, b"", b"missing")
            return original_git(*args, **kwargs)

        with patch.object(image, "CHECKOUT", self.root), patch.object(image, "_git", side_effect=changed), \
                self.assertRaises(Refusal) as caught:
            image.require_main_build(identity, inspection)
        self.assertEqual(caught.exception.code, "RUNTIME_NOT_MAIN")
