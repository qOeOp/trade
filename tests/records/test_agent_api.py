"""Real isolated publication feedback and scoped CLI reads for Agent consumers."""

import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from research.records import cli
from research.records.common import RecordError
from research.records.store import DoltRecords
from tests.records.test_publication_contracts import attempt


class AgentAPIIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = os.environ.get("RESEARCH_DOLT_TEST_CONFIG")
        if not raw:
            raise unittest.SkipTest("Agent API integration requires isolated real Dolt")
        cls.connection_config = json.loads(raw)

    def setUp(self):
        self.config = dict(self.connection_config, database="records_test_agent_" + uuid.uuid4().hex)
        self.store = DoltRecords(self.config)
        self.store.adapter.initialize()
        self.addCleanup(self.remove_database)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.payload = Path(self.temp.name) / "attempt.json"
        self.body = attempt(pending=True)

    def remove_database(self):
        self.assertTrue(self.config["database"].startswith("records_test_agent_"))
        with self.store.adapter._connection(database=False) as conn:
            self.store.adapter._sql(conn, f"DROP DATABASE `{self.config['database']}`")

    def command(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("sys.argv", ["records", *args]), patch("research.records.store.open_store", return_value=self.store), \
                patch("research.records.ledger.open_store", return_value=self.store), redirect_stdout(stdout), redirect_stderr(stderr):
            try:
                code = cli.main()
            except SystemExit as exc:
                code = exc.code
        return code, stdout.getvalue(), stderr.getvalue()

    def publish(self, *, dry_run=False):
        self.payload.write_text(json.dumps(self.body, ensure_ascii=False))
        args = ["publish", "attempt", "--file", str(self.payload), "--operation-id", "synthetic-agent-register",
                "--expected-version", "0"]
        if dry_run:
            args.append("--dry-run")
        return self.command(*args)

    def test_material_retain_command_checks_then_publishes_evidence_once(self):
        with tempfile.TemporaryDirectory(prefix="trade-retain-cli-", dir=Path.home()) as directory:
            files = []
            for name, raw in (("reader.py", b"print('reader')\n"), ("result.json", b'{"rows": 3}\n')):
                path = Path(directory) / name
                path.write_bytes(raw)
                files += ["--file", str(path), hashlib.sha256(raw).hexdigest()]
            args = ["material", "retain", *files, "--expected-version", "0", "--operation-id", "evidence-cli"]
            code, stdout, stderr = self.command(*args, "--dry-run")
            self.assertEqual((code, stderr), (0, ""))
            checked = json.loads(stdout)
            self.assertEqual((checked["write_status"], len(checked["evidence"])), ("not_written", 2))
            self.assertEqual(self.store.adapter.status()["version"], 0)
            code, stdout, stderr = self.command(*args)
            self.assertEqual((code, stderr), (0, ""))
            published = json.loads(stdout)
            self.assertEqual(published["version"], 1)
            for item in published["evidence"]:
                code, stdout, _ = self.command("material", "show", item["id"], "--brief")
                self.assertEqual((code, json.loads(stdout)["object"]["kind"]), (0, "material"))

    def test_feedback_allows_repair_and_preflight_never_writes(self):
        before = self.store.adapter.status()
        selection = self.body["contract"].pop("selection")
        with patch.object(self.store.adapter, "publish", wraps=self.store.adapter.publish) as writer:
            code, stdout, stderr = self.publish(dry_run=True)
            writer.assert_not_called()
        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        error = json.loads(stderr)["error"]
        self.assertEqual(error["code"], "SCHEMA_VALIDATION")
        self.assertEqual(error["write_status"], "not_written")
        self.assertTrue(error["path"].startswith("/contract"))
        self.assertTrue(error["next_actions"])
        self.assertNotIn("reason", error)
        self.assertNotIn("details", error)
        self.assertEqual(self.store.adapter.status(), before)
        self.body["contract"]["selection"] = selection
        code, stdout, stderr = self.publish(dry_run=True)
        self.assertEqual((code, stderr), (0, ""))
        self.assertEqual(json.loads(stdout)["write_status"], "not_written")
        self.assertEqual(self.store.adapter.status(), before)
        with self.assertRaisesRegex(RecordError, "unknown publication operation"):
            self.store.adapter.operation_receipt("synthetic-agent-register")
        code, stdout, stderr = self.publish()
        self.assertEqual((code, stderr), (0, ""))
        published = json.loads(stdout)
        self.assertEqual(published["registration_receipt"]["revision"], 1)
        code, stdout, stderr = self.publish()
        self.assertEqual((code, stderr), (0, ""))
        self.assertEqual(json.loads(stdout), dict(published, replayed=True))
        self.assertEqual(self.store.adapter.status()["version"], 1)
        code, stdout, stderr = self.publish(dry_run=True)
        self.assertEqual((code, stderr), (0, ""))
        recovered = json.loads(stdout)
        self.assertEqual(recovered["write_status"], "already_committed")
        self.assertEqual(recovered["commit"], published["commit"])
        self.assertEqual(self.store.adapter.status()["version"], 1)

    def test_decision_can_cite_its_fixed_initial_registration(self):
        self.assertEqual(self.publish()[0], 0)
        initial = copy.deepcopy(self.body)
        self.body["decision"].update(layer="source", outcome="failed", basis={
            "mode": "source", "evidence_refs": [{"id": "attempt:TEST-01", "revision": 1}]})
        result = self.store.publish_record("attempt", self.body, operation_id="synthetic-source-decision", expected_version=1)
        current = self.store.adapter.get_object("attempt:TEST-01", commit=result["commit"])
        self.assertEqual(current["revision"], 2)
        self.assertEqual(self.store.adapter.get_object("attempt:TEST-01", revision=1)["body"], initial)
        code, stdout, stderr = self.command("show", "TEST-01", "--revision", "2", "--brief")
        self.assertEqual((code, stderr), (0, ""))
        self.assertEqual(json.loads(stdout)["decision"]["outcome"], "failed")

    def test_unrelated_version_cannot_block_show_but_is_visible_to_find_and_validate(self):
        self.assertEqual(self.publish()[0], 0)
        bad = copy.deepcopy(self.body)
        bad.update(attempt_id="BAD-01", schema_version=999)
        result = self.store.adapter.publish(
            [{"id": "attempt:BAD-01", "kind": "attempt", "revision": 1, "body": bad, "provenance": {}}],
            [], "synthetic-unsupported", 1, validated_by="unsupported-version fixture")
        code, stdout, stderr = self.command("--at", result["commit"], "show", "TEST-01", "--brief")
        self.assertEqual((code, stderr), (0, ""))
        shown = json.loads(stdout)
        self.assertEqual(shown["attempt_id"], "TEST-01")
        self.assertEqual(shown["full_read"]["revision"], 1)
        self.assertEqual(shown["storage"]["commit"], result["commit"])
        code, stdout, stderr = self.command("find", "--mechanism", "Synthetic")
        self.assertEqual((code, stderr), (0, ""))
        found = json.loads(stdout)
        self.assertEqual([item["attempt_id"] for item in found["matches"]], ["TEST-01"])
        self.assertEqual(found["unreadable"][0]["id"], "attempt:BAD-01")
        self.assertEqual(found["unreadable"][0]["schema_version"], 999)
        code, _, stderr = self.command("validate")
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(stderr)["error"]["code"], "SCHEMA_VALIDATION")

    def test_brief_budget_includes_final_storage_and_multibyte_text(self):
        self.body["question"] = "长研究问题" * 10000
        self.body["decision"]["next_action"] = "下一动作" * 10000
        self.assertEqual(self.publish()[0], 0)
        code, stdout, stderr = self.command("show", "TEST-01", "--brief")
        self.assertEqual((code, stderr), (0, ""))
        self.assertLessEqual(len(stdout.encode("utf-8")), 32768)
        self.assertTrue(json.loads(stdout)["truncated"])

    def test_find_filters_frozen_selection_and_declared_purpose(self):
        self.assertEqual(self.publish()[0], 0)
        code, stdout, _ = self.command("find", "--family-id", "synthetic-family", "--purpose", "research", "--outcome", "pending")
        self.assertEqual(code, 0)
        found = json.loads(stdout)["matches"]
        self.assertEqual(found[0]["selection"]["primary_response"], "final_equity_usdt")
        code, stdout, _ = self.command("find", "--purpose", "engineering")
        self.assertEqual(json.loads(stdout)["matches"], [])


if __name__ == "__main__":
    unittest.main()
