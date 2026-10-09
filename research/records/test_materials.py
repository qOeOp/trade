"""Lossless import and explicit-relation boundaries for the material index."""

import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from research.records.common import ROOT
from research.records.materials import HISTORICAL_MANIFEST, retained_historical_refs, scan


class MaterialFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Material fixture")
        self.git("config", "user.email", "material-fixture@example.invalid")
        self.write("README.md", "# Fixture\n")
        self.commit()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root).decode().strip()

    def write(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data if isinstance(data, bytes) else data.encode())

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture material")
        return self.git("rev-parse", "HEAD")

    def retained_manifest(self, raw, commit, path, root=None):
        source = {
            "original_commit": commit, "path": path,
            "blob_oid": hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest(),
            "sha256": hashlib.sha256(raw).hexdigest(), "byte_length": len(raw),
            "content_base64": base64.b64encode(raw).decode("ascii"),
        }
        target = (root or self.root) / HISTORICAL_MANIFEST
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({"schema_version": 1, "sources": [source]}) + "\n")
        return target, source

    def test_fenced_headings_links_and_inline_code_are_not_structure(self):
        self.write("notes.md", "# Real\n## Repeat\n[a](README.md)\n```md\n## False\n[fake](fake.md)\n```\n`[inline](inline.md)`\n## Repeat\n[second](README.md)\n")
        self.commit()
        result = scan(self.root)
        sections = [o for o in result["objects"] if o["kind"] == "material_section" and o["provenance"]["path"] == "notes.md"]
        self.assertEqual([o["body"]["title"] for o in sections], ["Real", "Repeat", "Repeat"])
        self.assertEqual(len({o["id"] for o in sections}), 3)
        refs = [r["body"]["href"] for r in result["relations"] if "href" in r["body"]]
        self.assertEqual(refs, ["README.md", "README.md"])
        self.assertNotIn("inline.md", json.dumps(result["review_queue"]))

    def test_heading_markup_and_slug_collisions_have_distinct_addresses(self):
        self.write("research/r1_native/SOURCE_CASES.md", "## **C02** - case\nText\n")
        self.write("notes.md", "# A!\nText\n# A?\nOther\n")
        self.commit()
        result = scan(self.root)
        identifiers = [o["id"] for o in result["objects"] if o["kind"] == "material_section"]
        self.assertIn("section:research/r1_native/SOURCE_CASES.md#C02", identifiers)
        self.assertIn("section:notes.md#heading-a-1", identifiers)
        self.assertIn("section:notes.md#heading-a-2", identifiers)

    def test_byte_intervals_preserve_crlf_and_unicode(self):
        raw = "# 标题\r\n\r\n## 第一\r\n正文😀\r\n\r\n## 第二\r\n后文\r\n".encode()
        self.write("notes.md", raw)
        self.commit()
        result = scan(self.root)
        for obj in result["objects"]:
            if obj["provenance"].get("path") == "notes.md":
                locator = obj["provenance"]["locator"]
                fragment = raw[locator["start_byte"]:locator["end_byte"]]
                self.assertEqual(base64.b64decode(obj["body"]["content_base64"]), fragment)
                self.assertEqual(obj["body"]["sha256"], hashlib.sha256(fragment).hexdigest())

    def test_path_traversal_and_symlinks_never_read_external_bytes(self):
        secret = Path(self.temp.name).parent / (self.root.name + "-outside.md")
        secret.write_text("PRIVATE_SENTINEL")
        self.addCleanup(secret.unlink)
        self.write("notes.md", f"# Safe\n[escape](../{secret.name})\n[encoded](%2e%2e/{secret.name})\n[absolute]({secret})\n")
        (self.root / "linked.md").symlink_to(secret)
        self.commit()
        result = scan(self.root)
        self.assertNotIn("PRIVATE_SENTINEL", json.dumps(result))
        self.assertTrue(any(r["reason"] == "unsafe_symlink" for r in result["review_queue"]))
        self.assertEqual(sum(r["reason"] == "unsafe_local_link" for r in result["review_queue"]), 3)

    def test_invalid_utf8_is_lossless_review_material(self):
        raw = b"# Broken\n\xff\xfe\n"
        self.write("broken.md", raw)
        self.commit()
        result = scan(self.root)
        obj = next(o for o in result["objects"] if o["id"] == "material:broken.md")
        self.assertEqual(base64.b64decode(obj["body"]["content_base64"]), raw)
        self.assertNotIn("text", obj["body"])
        self.assertIn("invalid_utf8", result["statistics"]["review_by_reason"])

    def test_modified_untracked_and_ignored_provenance(self):
        self.write(".gitignore", "research_notes/ignored.md\n.venv/\n")
        self.write("docs/plans/old.md", "# Original\n")
        head = self.commit()
        self.write("docs/plans/old.md", "# Changed\n")
        self.write("reports/new.md", "# New\n")
        self.write("research_notes/ignored.md", "IGNORED_SENTINEL")
        self.write(".venv/secret.md", "VENV_SENTINEL")
        self.write("unrelated.md", "UNRELATED_SENTINEL")
        result = scan(self.root)
        objects = {o["id"]: o for o in result["objects"]}
        for path, state in [("docs/plans/old.md", "modified"), ("reports/new.md", "untracked")]:
            prov = objects[f"material:{path}"]["provenance"]
            self.assertIsNone(prov["git_commit"])
            self.assertEqual(prov["source_head"], head)
            self.assertEqual(prov["worktree_state"], state)
        self.assertEqual(objects["material:README.md"]["provenance"]["git_commit"], head)
        self.assertFalse(any("SENTINEL" in o["body"].get("text", "") for o in result["objects"]))
        self.assertNotIn("material:reports/new.md", {o["id"] for o in scan(self.root, include_untracked=False)["objects"]})

    def test_explicit_fields_preserve_record_body_and_do_not_infer_from_prose(self):
        data = {"attempt_id": "H18a", "parents": [{"attempt_id": "H15a", "relationship": "hypothesis_extension", "difference": "bounded"}], "mechanism_refs": [{"attempt_id": "H08", "relationship": "component_reuse", "component": "ConfirmedLineSupportTouches", "boundary": "state only; no inherited entry"}], "decision": {"scope": "corrects C02 and supports every hypothesis"}}
        self.write("research/records/attempts/H18a/attempt.json", json.dumps(data, ensure_ascii=False))
        self.write("research/records/attempts/H08/attempt.json", json.dumps({"attempt_id": "H08", "parents": []}))
        self.write("research/records/attempts/H15a/attempt.json", json.dumps({"attempt_id": "H15a", "parents": []}))
        self.write("research/r1_native/RD_EXPERIMENTS.md", "## Candidate H18a: corrects C02, inherits H08, supports H99\nOnly text.\n")
        self.commit()
        result = scan(self.root)
        obj = next(o for o in result["objects"] if o["id"] == "attempt:H18a")
        self.assertEqual(obj["body"], data)
        relations = {(r["kind"], r["from_id"], r["to_id"]) for r in result["relations"]}
        self.assertIn(("component_reuse", "attempt:H18a", "attempt:H08"), relations)
        self.assertIn(("hypothesis_extension", "attempt:H18a", "attempt:H15a"), relations)
        self.assertNotIn(("hypothesis_extension", "attempt:H18a", "attempt:H08"), relations)
        self.assertFalse({r["kind"] for r in result["relations"]} & {"corrects", "supports", "inherits"})
        self.assertEqual(scan(self.root), result)

    def test_historical_sections_and_edges_bind_to_historical_bytes(self):
        path = "research/r1_native/SOURCE_CASES.md"
        self.write(path, "# Cases\n## C02 - old\nOld interpretation.\n")
        historical = self.commit()
        self.write(path, "# Cases\n## C02 - revised\nRevised interpretation.\n")
        current = self.commit()
        result = scan(self.root, historical_refs=[{"commit": historical, "paths": [path]}])
        versions = [o for o in result["objects"] if o["id"] == f"section:{path}#C02"]
        self.assertEqual([o["provenance"]["git_commit"] for o in versions], [historical, current])
        self.assertNotEqual(versions[0]["body"]["sha256"], versions[1]["body"]["sha256"])
        edges = [r for r in result["relations"] if r["kind"] == "contains" and r["to_id"] == versions[0]["id"]]
        self.assertEqual([r["to_source_sha256"] for r in edges], [o["provenance"]["blob_sha256"] for o in versions])

    def test_explicit_retained_source_survives_unavailable_original_commit(self):
        path = "research/r1_native/SOURCE_CASES.md"
        raw = "# Cases\r\n\r\n## C02 - old\r\nOriginal 中文😀.\r\n".encode()
        self.write(path, raw)
        original = self.commit()
        self.retained_manifest(raw, original, path)
        available = scan(self.root, historical_refs=retained_historical_refs(self.root))
        with tempfile.TemporaryDirectory() as consumer_directory:
            consumer = Path(consumer_directory)
            for args in (("init", "-q"), ("config", "user.name", "Consumer fixture"), ("config", "user.email", "consumer@example.invalid")):
                subprocess.check_call(["git", *args], cwd=consumer)
            (consumer / "README.md").write_text("# Consumer\n")
            subprocess.check_call(["git", "add", "README.md"], cwd=consumer)
            subprocess.check_call(["git", "commit", "-qm", "Unrelated consumer"], cwd=consumer)
            self.assertNotEqual(subprocess.run(["git", "cat-file", "-e", original], cwd=consumer, capture_output=True).returncode, 0)
            manifest, source = self.retained_manifest(raw, original, path, consumer)
            refs = retained_historical_refs(consumer)
            self.assertEqual(base64.b64decode(refs[0]["retained_payloads"][0]["content_base64"]), raw)
            result = scan(consumer, historical_refs=refs)
            obj = next(o for o in result["objects"] if o["id"] == f"material:{path}")
            self.assertEqual(base64.b64decode(obj["body"]["content_base64"]), raw)
            prov = obj["provenance"]
            self.assertEqual(prov["git_commit"], original)
            self.assertEqual(prov["origin"], "retained_git_blob")
            self.assertEqual(prov["verify_source"], "retained_bytes")
            self.assertEqual(prov["git_blob_oid"], source["blob_oid"])
            self.assertEqual(prov["worktree_state"], "historical_retained")
            self.assertEqual(prov["retained_fixture"], {"path": HISTORICAL_MANIFEST, "sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(), "locator": "/sources/0"})
            original_obj = next(o for o in available["objects"] if o["id"] == obj["id"] and o["provenance"].get("origin") == "retained_git_blob")
            self.assertEqual({k: v for k, v in original_obj["provenance"].items() if k != "source_head"}, {k: v for k, v in prov.items() if k != "source_head"})
            section = next(o for o in result["objects"] if o["id"] == f"section:{path}#C02")
            locator = section["provenance"]["locator"]
            self.assertEqual(base64.b64decode(section["body"]["content_base64"]), raw[locator["start_byte"]:locator["end_byte"]])
            relation = next(r for r in result["relations"] if r["kind"] == "contains" and r["to_id"] == section["id"])
            self.assertEqual(relation["from_source_sha256"], source["sha256"])
            self.assertEqual(relation["to_source_sha256"], source["sha256"])
            # Retention is never a silent fallback for an ordinary Git selection.
            with self.assertRaises(ValueError):
                scan(consumer, historical_refs=[{"commit": original, "paths": [path]}])

    def test_retained_manifest_rejects_corrupt_payloads_before_returning_refs(self):
        path = "research/r1_native/SOURCE_CASES.md"
        raw = b"# Cases\n## C02 - old\nExact bytes.\n"
        self.write(path, raw)
        commit = self.commit()
        target, source = self.retained_manifest(raw, commit, path)
        for field, value, reason in (
            ("sha256", "0" * 64, "sha256 mismatch"),
            ("blob_oid", "0" * 40, "blob_oid mismatch"),
            ("byte_length", len(raw) + 1, "byte_length mismatch"),
            ("content_base64", "@@@", "content_base64 is invalid"),
            ("path", "../outside.md", "path is unsafe"),
        ):
            with self.subTest(field=field):
                target.write_text(json.dumps({"schema_version": 1, "sources": [dict(source, **{field: value})]}))
                with self.assertRaisesRegex(ValueError, reason):
                    retained_historical_refs(self.root)
        self.retained_manifest(raw, commit, path)
        refs = retained_historical_refs(self.root)
        refs[0]["retained_payloads"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "sha256 mismatch"):
            scan(self.root, historical_refs=refs)

    def test_retained_source_disagreement_with_available_git_is_rejected(self):
        path = "research/r1_native/SOURCE_CASES.md"
        self.write(path, "# Actual Git bytes\n")
        commit = self.commit()
        self.retained_manifest(b"# Different but internally valid bytes\n", commit, path)
        with self.assertRaisesRegex(ValueError, "differs from the available original Git blob"):
            scan(self.root, historical_refs=retained_historical_refs(self.root))

    def test_multiple_ids_in_heading_remain_one_section_without_semantic_edges(self):
        self.write("research/r1_native/RD_EXPERIMENTS.md", "## Source S45 and Diagnostic D80: title\nText\n## Candidate H19a / source-capacity diagnostic D60: title\nText\n")
        self.commit()
        result = scan(self.root)
        sections = [o["body"].get("explicit_id") for o in result["objects"] if o["kind"] == "material_section" and o["provenance"]["path"].endswith("RD_EXPERIMENTS.md")]
        self.assertEqual(sections, ["S45", "H19a"])
        self.assertNotIn("multiple_ids_in_heading", result["statistics"]["review_by_reason"])
        mentions = {o["body"]["explicit_id"]: o["body"].get("mentioned_ids", []) for o in result["objects"] if o["kind"] == "material_section" and o["provenance"]["path"].endswith("RD_EXPERIMENTS.md")}
        self.assertEqual(mentions, {"S45": ["D80"], "H19a": ["D60"]})
        self.assertEqual(set(result["statistics"]["relations_by_kind"]), {"contains"})


class CurrentMaterialGoldenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.golden = json.loads((Path(__file__).parent / "fixtures" / "materials_golden.json").read_text())
        cls.result = scan(ROOT, include_untracked=False, historical_refs=retained_historical_refs(ROOT))
        cls.current = {o["id"]: o for o in cls.result["objects"]}

    def test_source_byte_golden_spans_and_historical_revision(self):
        for expected in self.golden["sections"]:
            obj = self.current[expected["id"]]
            self.assertEqual(obj["body"]["sha256"], expected["sha256"])
            for field in ("start_byte", "end_byte"):
                self.assertEqual(obj["provenance"]["locator"][field], expected[field])
        expected = self.golden["historical_c02"]
        obj = next(o for o in self.result["objects"] if o["id"] == expected["id"] and o["provenance"]["git_commit"] == self.golden["historical_commit"])
        self.assertEqual(obj["body"]["sha256"], expected["sha256"])

    def test_reliable_source_facts_and_required_human_review(self):
        actual = {(r["kind"], r["from_id"], r["to_id"]) for r in self.result["relations"]}
        for expected in self.golden["reliable_relations"]:
            self.assertIn((expected["kind"], expected["from_id"], expected["to_id"]), actual)
        self.assertFalse(set(self.golden["forbidden_inferred_relations"]) & {r["kind"] for r in self.result["relations"]})
        for reason in self.golden["review_required"]:
            self.assertIn(reason, self.result["statistics"]["review_by_reason"])
        self.assertNotIn(("hypothesis_extension", "attempt:H18a", "attempt:H08"), actual)
        component_edges = [r for r in self.result["relations"] if r["kind"] == "component_index"]
        self.assertEqual({r["to_id"] for r in component_edges}, {"attempt:H18a", "attempt:H08"})
        same_media = [r for r in self.result["relations"] if r["kind"] == "same_media"]
        self.assertEqual(len(same_media), 2)
        self.assertEqual(len({r["to_id"] for r in same_media}), 1)
        for obj in self.result["objects"]:
            if obj["kind"] in {"attempt", "run"}:
                self.assertEqual(obj["body"], json.loads(base64.b64decode(obj["provenance"]["raw_content_base64"])))


if __name__ == "__main__":
    unittest.main()
