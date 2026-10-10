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
