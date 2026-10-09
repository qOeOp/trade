"""Lossless import and explicit-relation boundaries for the material index."""

import base64
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from research.records.materials import HISTORICAL_MANIFEST, retained_historical_refs, scan
from research.records.fixtures.contract_repository import ContractRepository, EXPERIMENTS, OBSERVATIONS

RESEARCH_PROJECTIONS = {
    "hypothesis_extension", "repair", "composition", "component_reuse", "component_index",
    "comparison_family", "comparison_cell", "run_of", "compared_with", "controlled_by",
}


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

    def test_explicit_archive_selection_keeps_python_and_ordinary_json_bytes(self):
        from research.records.migration import original_bytes
        payloads = {"keep.py": b"print('one-off probe')\n", "keep.json": b'{"observed": false}\n'}
        for path, raw in payloads.items():
            self.write(path, raw)
        self.commit()
        result = scan(self.root, include_untracked=False, selected_paths=payloads)
        self.assertEqual(len(result["objects"]), 2)
        for obj in result["objects"]:
            self.assertEqual(obj["kind"], "material")
            self.assertEqual(original_bytes(obj), payloads[obj["provenance"]["path"]])
        self.assertEqual(result["statistics"]["bytes_scanned"], sum(map(len, payloads.values())))

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

    def test_archived_record_fields_are_references_without_registration_or_lineage(self):
        data = {"attempt_id": "H18a", "parents": [{"attempt_id": "H15a", "relationship": "hypothesis_extension", "difference": "bounded"}], "mechanism_refs": [{"attempt_id": "H08", "relationship": "component_reuse", "component": "ConfirmedLineSupportTouches", "boundary": "state only; no inherited entry"}], "decision": {"scope": "corrects C02 and supports every hypothesis"}}
        self.write("research/records/attempts/H18a/attempt.json", json.dumps(data, ensure_ascii=False))
        self.write("research/records/attempts/H08/attempt.json", json.dumps({"attempt_id": "H08", "parents": []}))
        self.write("research/records/attempts/H15a/attempt.json", json.dumps({"attempt_id": "H15a", "parents": []}))
        self.write("research/r1_native/RD_EXPERIMENTS.md", "## Candidate H18a: corrects C02, inherits H08, supports H99\nOnly text.\n")
        self.commit()
        result = scan(self.root)
        obj = next(o for o in result["objects"] if o["id"] == "evidence_json:research/records/attempts/H18a/attempt.json")
        self.assertEqual(obj["body"], data)
        self.assertEqual(base64.b64decode(obj["provenance"]["raw_content_base64"]), (self.root / obj["provenance"]["path"]).read_bytes())
        objects = {o["id"]: o for o in result["objects"]}
        declared = [(objects[r["to_id"]]["body"], r["body"]) for r in result["relations"]
                    if r["from_id"] == obj["id"] and r["kind"] == "references"]
        self.assertEqual({target["target"] for target, _ in declared}, {"attempt:H08", "attempt:H15a"})
        self.assertEqual({body["reference"]["relationship"] for _, body in declared}, {"component_reuse", "hypothesis_extension"})
        self.assertFalse({r["kind"] for r in result["relations"]} & (RESEARCH_PROJECTIONS | {"corrects", "supports", "inherits"}))
        self.assertFalse({o["kind"] for o in result["objects"]} & {"attempt", "run", "component"})
        self.assertIn("archived_record_requires_registration", result["statistics"]["review_by_reason"])
        self.assertEqual(scan(self.root), result)

    def test_historical_and_selected_record_json_remain_lossless_source_custody(self):
        from research.records.migration import original_bytes
        path = "research/records/runs/run-1/run.json"
        raw = b'{ "run_id": "run-1", "attempt_id": "H01", "control_run_id": "run-0" }\r\n'
        self.write(path, raw)
        historical = self.commit()
        self.write(path, b'{ "run_id": "run-1", "attempt_id": "H02" }\n')
        self.commit()
        result = scan(self.root, include_untracked=False,
                      historical_refs=[{"commit": historical, "paths": [path]}], selected_paths=[path])
        versions = [obj for obj in result["objects"] if obj["provenance"].get("path") == path]
        self.assertEqual([obj["kind"] for obj in versions], ["evidence_json", "evidence_json"])
        self.assertEqual([original_bytes(obj) for obj in versions], [raw, (self.root / path).read_bytes()])
        self.assertFalse({edge["kind"] for edge in result["relations"]} & RESEARCH_PROJECTIONS)
        self.assertFalse(any(obj["id"].startswith(("attempt:", "run:")) for obj in result["objects"]))

    def test_retained_legacy_record_for_link_resolution_is_projected_to_source(self):
        from research.records.migration import original_bytes
        path = "retained/attempt.json"
        raw = b'{"attempt_id":"H01","parents":[]}\n'
        self.write("notes.md", f"# Navigation\n[old record]({path})\n")
        self.commit()
        legacy = {"id": "attempt:H01", "kind": "attempt", "revision": 1,
                  "body": json.loads(raw), "provenance": {"path": path, "git_commit": None,
                  "blob_sha256": hashlib.sha256(raw).hexdigest(),
                  "raw_content_base64": base64.b64encode(raw).decode("ascii")}}
        result = scan(self.root, supplemental_objects=[legacy])
        archived = next(obj for obj in result["objects"] if obj["id"] == "evidence_json:" + path)
        self.assertEqual(original_bytes(archived), raw)
        self.assertFalse(any(obj["kind"] in {"attempt", "run"} for obj in result["objects"]))

    def test_material_import_rejects_record_kind_or_namespace_before_database_access(self):
        from research.records.common import RecordError
        from research.records.migration import plan
        for kind, identity in (("attempt", "any-id"), ("run", "any-id"),
                               ("material", "attempt:H01"), ("evidence_json", "run:R01")):
            with self.subTest(kind=kind, identity=identity):
                with self.assertRaisesRegex(RecordError, "publish through the Dolt record API"):
                    plan(None, {"objects": [{"kind": kind, "id": identity}]})

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


class FrozenMaterialContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.golden = json.loads((Path(__file__).parent / "fixtures" / "material_contract.json").read_text())
        cls.fixture = ContractRepository()
        cls.addClassCleanup(cls.fixture.close)
        paths = {expected["id"].removeprefix("section:").rsplit("#", 1)[0] for expected in cls.golden["sections"]}
        cls.source_blobs = {path: subprocess.check_output(["git", "show", f"{cls.fixture.current_source_commit}:{path}"], cwd=cls.fixture.root) for path in paths}
        # Navigation may move byte offsets without changing the observed source.
        cls.fixture.write(EXPERIMENTS, b"# Navigation added later\n\n" + OBSERVATIONS)
        cls.fixture.commit("Synthetic navigation change")
        cls.result = scan(cls.fixture.root, include_untracked=False,
                          historical_refs=cls.fixture.historical_refs())
        cls.current = {o["id"]: o for o in cls.result["objects"]}
        cls.current_blobs = {path: (cls.fixture.root / path).read_bytes() for path in paths}

    def test_golden_byte_spans_are_bound_to_original_git_source(self):
        for expected in self.golden["sections"]:
            path = expected["id"].removeprefix("section:").rsplit("#", 1)[0]
            raw = self.source_blobs[path]
            self.assertGreaterEqual(expected["start_byte"], 0)
            self.assertGreater(expected["end_byte"], expected["start_byte"])
            self.assertLessEqual(expected["end_byte"], len(raw))
            fragment = raw[expected["start_byte"]:expected["end_byte"]]
            self.assertEqual(hashlib.sha256(fragment).hexdigest(), expected["sha256"])

    def test_current_section_locators_preserve_golden_source_bytes(self):
        for expected in self.golden["sections"]:
            obj = self.current[expected["id"]]
            path = obj["provenance"]["path"]
            raw = self.current_blobs[path]
            parent = self.current[f"material:{path}"]
            self.assertEqual(base64.b64decode(parent["body"]["content_base64"]), raw)
            self.assertEqual(obj["provenance"]["blob_sha256"], hashlib.sha256(raw).hexdigest())
            locator = obj["provenance"]["locator"]
            self.assertGreaterEqual(locator["start_byte"], 0)
            self.assertGreater(locator["end_byte"], locator["start_byte"])
            self.assertLessEqual(locator["end_byte"], len(raw))
            fragment = raw[locator["start_byte"]:locator["end_byte"]]
            self.assertEqual(base64.b64decode(obj["body"]["content_base64"]), fragment)
            self.assertEqual(hashlib.sha256(fragment).hexdigest(), expected["sha256"])
            self.assertEqual(obj["body"]["sha256"], expected["sha256"])
            self.assertEqual(fragment, self.source_blobs[path][expected["start_byte"]:expected["end_byte"]])

    def test_historical_c02_retained_source_bytes_and_locator(self):
        # The retained original bytes are the one real historical recovery case;
        # read only that fixture in a separate tiny clone, not current research.
        fixtures = Path(__file__).parent / "fixtures"
        historical = json.loads((fixtures / "materials_golden.json").read_text())
        expected = historical["historical_c02"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            subprocess.check_call(["git", "init", "-q"], cwd=root)
            subprocess.check_call(["git", "config", "user.name", "Historical fixture"], cwd=root)
            subprocess.check_call(["git", "config", "user.email", "historical@example.invalid"], cwd=root)
            (root / "README.md").write_text("# Isolated retained source reader\n")
            target = root / HISTORICAL_MANIFEST
            target.parent.mkdir(parents=True)
            target.write_bytes((fixtures / "historical_sources.json").read_bytes())
            subprocess.check_call(["git", "add", "."], cwd=root)
            subprocess.check_call(["git", "commit", "-qm", "Independent historical source reader"], cwd=root)
            refs = retained_historical_refs(root)
            result = scan(root, include_untracked=False, historical_refs=refs)
        obj = next(o for o in result["objects"] if o["id"] == expected["id"] and o["provenance"]["git_commit"] == historical["historical_commit"])
        payload = next(payload for selection in refs for payload in selection["retained_payloads"] if payload["original_commit"] == historical["historical_commit"] and payload["path"] == obj["provenance"]["path"])
        raw = base64.b64decode(payload["content_base64"])
        self.assertEqual(obj["provenance"]["origin"], "retained_git_blob")
        self.assertEqual(obj["provenance"]["verify_source"], "retained_bytes")
        self.assertEqual(obj["provenance"]["blob_sha256"], payload["sha256"])
        for field in ("start_byte", "end_byte"):
            self.assertEqual(obj["provenance"]["locator"][field], expected[field])
        fragment = raw[expected["start_byte"]:expected["end_byte"]]
        self.assertEqual(base64.b64decode(obj["body"]["content_base64"]), fragment)
        self.assertEqual(hashlib.sha256(fragment).hexdigest(), expected["sha256"])
        self.assertEqual(obj["body"]["sha256"], expected["sha256"])

    def test_reliable_source_facts_and_required_human_review(self):
        actual = {(r["kind"], r["from_id"], r["to_id"]) for r in self.result["relations"]}
        for expected in self.golden["reliable_relations"]:
            if expected["kind"] not in RESEARCH_PROJECTIONS:
                self.assertIn((expected["kind"], expected["from_id"], expected["to_id"]), actual)
        self.assertFalse(set(self.golden["forbidden_inferred_relations"]) & {r["kind"] for r in self.result["relations"]})
        self.assertFalse(RESEARCH_PROJECTIONS & {r["kind"] for r in self.result["relations"]})
        for reason in self.golden["review_required"]:
            self.assertIn(reason, self.result["statistics"]["review_by_reason"])
        self.assertFalse({obj["kind"] for obj in self.result["objects"]} & {"attempt", "run", "component"})
        same_media = [r for r in self.result["relations"] if r["kind"] == "same_media"]
        self.assertEqual(len(same_media), 2)
        self.assertEqual(len({r["to_id"] for r in same_media}), 1)
        for obj in self.result["objects"]:
            if obj["kind"] == "evidence_json":
                self.assertEqual(obj["body"], json.loads(base64.b64decode(obj["provenance"]["raw_content_base64"])))


if __name__ == "__main__":
    unittest.main()
