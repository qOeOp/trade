"""Navigation resolution, frozen-byte custody, and local-path boundaries."""

import base64
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import quote

from research.records.materials import _extract_markdown
from research.records.references import resolve_link


class ReferenceResolutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Reference fixture")
        self.git("config", "user.email", "reference-fixture@example.invalid")
        self.write("README.md", "# Fixture\n")
        self.write("tracked.py", "first\nsecond\nthird\n")
        self.write("folder/data.json", '{"retained": true}\n')
        self.write(".gitignore", "ignored/\n.venv/\n")
        self.commit = self.freeze()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root).decode().strip()

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content if isinstance(content, bytes) else content.encode())

    def freeze(self):
        self.git("add", ".")
        self.git("commit", "-qm", "Frozen reference fixture")
        return self.git("rev-parse", "HEAD")

    def source(self, commit=None):
        return {"path": "README.md", "git_commit": commit or self.commit,
                "source_head": commit or self.commit, "blob_sha256": hashlib.sha256(b"# Fixture\n").hexdigest()}

    def resolve(self, href, objects=(), **kwargs):
        return resolve_link(href, "README.md", self.source(), objects, root=self.root, **kwargs)

    def markdown_objects(self, path, raw, commit=None):
        provenance = {"path": path, "git_commit": commit,
                      "source_head": commit or self.commit, "blob_sha256": hashlib.sha256(raw).hexdigest(),
                      "locator": {"start_byte": 0, "end_byte": len(raw)}}
        return _extract_markdown(path, raw, provenance)[0]

    def test_git_blob_is_frozen_even_if_worktree_changed(self):
        original = b"first\nsecond\nthird\n"
        self.write("tracked.py", "CURRENT_BYTES_ARE_DIFFERENT\n")
        with patch.object(Path, "read_bytes", side_effect=AssertionError("worktree bytes must not be read")):
            result = self.resolve("tracked.py:2")
        self.assertEqual(result["status"], "resolved")
        body = result["target_object"]["body"]
        self.assertEqual(body["category"], "git_blob")
        self.assertEqual(body["git_commit"], self.commit)
        self.assertEqual(body["sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(body["line"], 2)
        self.assertNotIn("content_base64", body)

    def test_lazy_objects_receive_only_the_checked_normalized_path(self):
        paths = []

        def selected(path):
            paths.append(path)
            return []

        self.assertEqual(self.resolve("folder/../tracked.py:2", selected)["status"], "resolved")
        self.assertEqual(paths, ["tracked.py"])
        for href in ("../outside", ".env", ".git/config", "https://example.invalid/page"):
            self.resolve(href, selected)
        self.assertEqual(paths, ["tracked.py"])

    def test_git_tree_is_navigation_without_research_evidence(self):
        result = self.resolve("folder/")
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["target_object"]["body"]["category"], "git_tree")
        self.assertFalse(result["proof"]["directory_is_evidence"])
        self.assertNotIn("sha256", result["target_object"]["body"])
        self.assertEqual(self.resolve("./")["target_object"]["body"]["category"], "git_tree")

    def test_absolute_root_boundary_decoding_and_line_number(self):
        self.write("中文 report.md", "# 中文\n第二行\n")
        self.commit = self.freeze()
        original_root = "/original/verified/repository"
        result = self.resolve(original_root + "/" + quote("中文 report.md") + ":2", repository_root=original_root)
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["target_object"]["body"]["path"], "中文 report.md")
        self.assertEqual(result["target_object"]["body"]["line"], 2)
        self.assertEqual(result["proof"]["percent_decodes"], 1)
        sibling = self.resolve(original_root + "-another/tracked.py", repository_root=original_root)
        self.assertEqual(sibling["status"], "unsafe")
        self.assertEqual(sibling["reason"], "outside_repository_root")
        encoded_line = self.resolve("tracked.py%3A3")
        self.assertEqual(encoded_line["target_object"]["body"]["line"], 3)

    def test_percent_decoding_is_not_repeated_and_escape_is_rejected(self):
        self.write("%2e%2e/literal.py", "literal directory\n")
        self.commit = self.freeze()
        literal = self.resolve("%252e%252e/literal.py")
        self.assertEqual(literal["status"], "resolved")
        self.assertEqual(literal["target_object"]["body"]["path"], "%2e%2e/literal.py")
        for href in ("../tracked.py", "%2e%2e/tracked.py", str(self.root) + "/../tracked.py"):
            self.assertEqual(self.resolve(href)["status"], "unsafe")

    def test_excluded_ignored_and_sensitive_targets_are_not_read(self):
        self.write("ignored/private.json", "PRIVATE_SENTINEL")
        self.write(".env", "PRIVATE_SENTINEL")
        self.write("secrets/private.json", "PRIVATE_SENTINEL")
        with patch.object(Path, "read_bytes", side_effect=AssertionError("excluded bytes must not be read")):
            results = [self.resolve(path) for path in ("ignored/private.json", ".env", "secrets/private.json", ".git/config")]
        self.assertTrue(all(result["status"] == "unsafe" for result in results))
        self.assertEqual(results[0]["reason"], "ignored_unretained_path")
        self.assertNotIn("PRIVATE_SENTINEL", json.dumps(results))

    def test_symlink_file_or_directory_is_rejected_without_following(self):
        (self.root / "link.py").symlink_to("/outside/private.py")
        (self.root / "linked-folder").symlink_to("/outside/private")
        self.assertEqual(self.resolve("link.py")["reason"], "symlink_path")
        self.assertEqual(self.resolve("linked-folder/source.py")["reason"], "symlink_path")

    def test_line_bounds_use_frozen_bytes_and_reject_directory_lines(self):
        self.write("tracked.py", "now only one line\n")
        self.assertEqual(self.resolve("tracked.py:3")["status"], "resolved")
        for href in ("tracked.py:4", "tracked.py:0", "folder/:1"):
            result = self.resolve(href)
            self.assertEqual(result["status"], "unresolved")
            self.assertEqual(result["reason"], "line_out_of_bounds")

    def test_binary_blob_does_not_claim_text_line_bounds(self):
        self.write("binary.bin", b"\xff\xfe\n")
        self.commit = self.freeze()
        result = self.resolve("binary.bin:1")
        self.assertEqual(result["status"], "unresolved")
        self.assertEqual(result["reason"], "line_bounds_unavailable")

    def test_real_html_id_name_and_inline_anchor_resolve_but_fences_do_not(self):
        path = "notes.md"
        raw = b'# Document\n\n<a id="real"></a>\n\n## Next section\n\n```html\n<a id="fake"></a>\n```\n\n## Inline <a name="named"></a>\n\nBody\n'
        self.write(path, raw)
        self.commit = self.freeze()
        objects = self.markdown_objects(path, raw, self.commit)
        real = self.resolve("notes.md#real", objects)
        self.assertEqual(real["status"], "resolved")
        self.assertEqual(real["target_object"]["body"]["title"], "Next section")
        self.assertEqual(real["proof"]["anchor"]["kind"], "explicit_html_anchor")
        named = self.resolve("notes.md#named", objects)
        self.assertEqual(named["target_object"]["body"]["title"], "Inline")
        self.assertEqual(self.resolve("notes.md#fake", objects)["status"], "unresolved")
        self.assertEqual(self.resolve("notes.md#missing", objects)["status"], "unresolved")

    def test_unique_explicit_id_casefold_does_not_allow_arbitrary_fragment(self):
        path = "docs/plans/r1-native-rd-findings.zh.md"
        raw = b"## F01: One finding\n\nBody\n"
        self.write(path, raw)
        self.commit = self.freeze()
        objects = self.markdown_objects(path, raw, self.commit)
        result = self.resolve(path + "#f01", objects)
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["target_object"]["body"]["explicit_id"], "F01")
        self.assertEqual(self.resolve(path + "#f", objects)["status"], "unresolved")
        duplicate = raw + b"\n## F01: Another finding\n\nBody\n"
        self.write(path, duplicate)
        self.commit = self.freeze()
        objects = self.markdown_objects(path, duplicate, self.commit)
        self.assertEqual(self.resolve(path + "#f01", objects)["status"], "unresolved")

    def test_stale_payload_hash_and_self_consistent_forged_git_bytes_are_rejected(self):
        objects = self.markdown_objects("README.md", b"# Fixture\n", self.commit)
        objects[0]["body"]["sha256"] = "0" * 64
        mismatch = self.resolve("README.md", objects)
        self.assertEqual(mismatch["status"], "unresolved")
        self.assertIn("hash_mismatch", mismatch["reason"])
        forged = self.markdown_objects("README.md", b"# Altered\n", self.commit)
        mismatch = self.resolve("README.md", forged)
        self.assertEqual(mismatch["status"], "unresolved")
        self.assertEqual(mismatch["reason"], "retained_git_source_hash_mismatch")

    def test_html_anchor_target_section_bytes_are_checked_against_parent(self):
        raw = b'<a id="real"></a>\n\n## Section\n\nOriginal\n'
        self.write("notes.md", raw)
        self.commit = self.freeze()
        objects = self.markdown_objects("notes.md", raw, self.commit)
        section = next(obj for obj in objects if obj["kind"] == "material_section")
        forged = b"Forged\n"
        section["body"].update(content_base64=base64.b64encode(forged).decode(), sha256=hashlib.sha256(forged).hexdigest())
        result = self.resolve("notes.md#real", objects)
        self.assertEqual(result["status"], "unresolved")
        self.assertEqual(result["reason"], "retained_section_bytes_mismatch")

    def test_only_explicit_verified_supplemental_json_is_accepted(self):
        raw = b'{"fixture": "explicitly retained"}\n'
        path = "research/ledger_probe/result.json"
        self.write(path, raw)
        self.assertEqual(self.resolve(path)["status"], "unresolved")
        supplemental = {"id": "evidence_json:" + path, "kind": "evidence_json", "revision": 1,
                        "body": json.loads(raw), "provenance": {"path": path, "git_commit": None,
                        "source_head": self.commit, "blob_sha256": hashlib.sha256(raw).hexdigest(),
                        "raw_content_base64": base64.b64encode(raw).decode()}}
        with patch.object(Path, "read_bytes", side_effect=AssertionError("untracked JSON must not be scanned")):
            result = self.resolve(path, supplemental_objects=[supplemental])
        self.assertEqual(result["status"], "resolved")
        self.assertTrue(result["proof"]["supplemental"])
        self.assertEqual(result["target_object"]["revision"], 1)
        forged = copy.deepcopy(supplemental)
        forged["body"]["fixture"] = "different parsed body"
        self.assertEqual(self.resolve(path, supplemental_objects=[forged])["reason"], "retained_json_body_hash_mismatch")
        forged = copy.deepcopy(supplemental)
        forged["provenance"]["blob_sha256"] = "0" * 64
        self.assertIn("hash_mismatch", self.resolve(path, supplemental_objects=[forged])["reason"])

    def test_native_dependency_descriptor_uses_pinned_git_without_reading_venv(self):
        self.write("pyproject.toml", '[project]\ndependencies = ["nautilus_trader[visualization]==2.0.0rc3"]\n')
        self.write("uv.lock", 'version = 1\n[[package]]\nname = "nautilus-trader"\nversion = "2.0.0rc3"\n')
        self.write(".venv/lib/python3.14/site-packages/nautilus_trader/backtest/__init__.pyi", b"UNREAD_PRIVATE_NATIVE_CONTENT")
        self.commit = self.freeze()
        href = str(self.root) + "/.venv/lib/python3.14/site-packages/nautilus_trader/backtest/__init__.pyi:170"
        with patch.object(Path, "read_bytes", side_effect=AssertionError("venv must not be read")):
            result = self.resolve(href)
        self.assertEqual(result["status"], "dependency_reference")
        self.assertEqual(result["proof"]["original_href"], href)
        self.assertEqual(result["proof"]["line"], 170)
        self.assertEqual(result["proof"]["percent_decodes"], 1)
        self.assertEqual(result["target_object"]["body"]["version"], "2.0.0rc3")
        self.assertFalse(result["proof"]["excluded_target_content_read"])
        self.assertIn("uv_lock", result["proof"])
        self.assertEqual(result["proof"]["line_bounds"], "not_checked_excluded_dependency_content")
        self.assertNotIn("UNREAD_PRIVATE_NATIVE_CONTENT", json.dumps(result))
        self.assertEqual(self.resolve(".venv/secrets/site-packages/nautilus_trader/code.py")["status"], "unsafe")
        self.assertEqual(self.resolve(".venv/lib/python3.14/site-packages/unlisted/code.py")["status"], "unsafe")
        self.assertEqual(self.resolve(".venv/lib/python3.14/site-packages/nautilus_trader/secret.key")["status"], "unsafe")

    def test_same_byte_section_index_revisions_do_not_make_anchor_ambiguous(self):
        raw = b'<a id="real"></a>\n\n## Section\n\nOriginal\n'
        self.write("notes.md", raw)
        self.commit = self.freeze()
        objects = self.markdown_objects("notes.md", raw, self.commit)
        section = next(obj for obj in objects if obj["kind"] == "material_section")
        section["revision"] = 1
        later = copy.deepcopy(section)
        later["revision"] = 2
        later["body"]["index_note"] = "Same retained bytes, later index metadata."
        result = self.resolve("notes.md#real", objects + [later])
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["target_object"]["revision"], 2)

    def test_historical_source_selects_matching_retained_revision(self):
        path = "notes.md"
        old = b"## Old heading\n\nOld bytes\n"
        self.write(path, old)
        old_commit = self.freeze()
        old_objects = self.markdown_objects(path, old, old_commit)
        new = b"## New heading\n\nNew bytes\n"
        self.write(path, new)
        self.commit = self.freeze()
        objects = old_objects + self.markdown_objects(path, new, self.commit)
        result = resolve_link(path + "#old-heading", "README.md", self.source(old_commit), objects, root=self.root)
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["target_object"]["provenance"]["git_commit"], old_commit)
        self.assertIn("Old bytes", result["target_object"]["body"]["text"])


if __name__ == "__main__":
    unittest.main()
