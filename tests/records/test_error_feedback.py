"""Field repair guidance must point to the entry that owns the record."""

import unittest

from research.records.common import RecordError
from research.records.store import validate_record


class SchemaFeedbackTests(unittest.TestCase):
    def test_attempt_and_run_feedback_preserve_their_publication_boundaries(self):
        for kind in ("attempt", "run"):
            with self.subTest(kind=kind), self.assertRaises(RecordError) as caught:
                validate_record(kind, {})
            error = caught.exception.as_dict()
            self.assertEqual(error["code"], "SCHEMA_VALIDATION")
            self.assertEqual(error["write_status"], "not_written")
            self.assertIn("contract " + kind, error["next_actions"][0])
            if kind == "run":
                self.assertIn("artifact register", error["next_actions"][1])
                self.assertNotIn("publish attempt", error["next_actions"][1])
            else:
                self.assertIn("publish attempt --dry-run", error["next_actions"][1])


class WritePreflightTests(unittest.TestCase):
    """Writes report, before publication, what the formal readers would later refuse."""

    def test_attempt_evidence_path_that_show_cannot_read_is_reported(self):
        from research.records.ledger import evidence_read_findings
        body = {"evidence_refs": [{"kind": "input_identity", "path": "/Users/agent/input.json", "sha256": "a" * 64},
                                  {"kind": "ledger", "path": "research/records/README.md", "sha256": None}]}
        findings = evidence_read_findings(body)
        self.assertEqual([finding["path"] for finding in findings], ["/evidence_refs/0"])
        self.assertEqual(findings[0]["status"], "unreadable")
        self.assertIn("invalid archived source path", findings[0]["message"])

    def test_candidate_registration_reports_the_compare_refusal_before_writing(self):
        from research.records.artifacts import _pair_preflight
        control = {"run_id": "B03", "role": "control", "integrity": "passed", "control_run_id": None,
                   "input_identity_sha256": "i", "window": {"w": 1}, "account": {"a": 1},
                   "cost_model": "native commissions and historical funding", "nautilus_version": "2.0.0rc3"}
        candidate = dict(control, run_id="C09", role="candidate", control_run_id="B03",
                         cost_model="frozen native fees")

        class Adapter:
            def get_object(self, identity):
                return {"body": control} if identity == "run:B03" else None

        class Store:
            adapter = Adapter()

        result = _pair_preflight(Store(), candidate)
        self.assertEqual(result["status"], "incomparable")
        self.assertTrue(result["report_only"])
        self.assertEqual(result["finding"]["path"], "/cost_model")
        self.assertEqual(result["finding"]["expected"]["/cost_model"]["candidate"], "frozen native fees")
        self.assertNotIn("write_status", result["finding"])
        self.assertEqual(_pair_preflight(Store(), dict(candidate, cost_model=control["cost_model"]))["status"],
                         "comparable")
