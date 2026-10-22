"""Shared result identity and insertion ordering on a disposable schema-v3 ledger."""

from __future__ import annotations

import unittest

from ledger import db, strategies, trials
from ledger.errors import Refusal
from tests.ledger.dolt import (BINARY, RUNTIME, SKIP, Service, attempt_binder, context, inputs,
                               product_bundle, sha, source, window)


@unittest.skipUnless(BINARY, SKIP)
class ResultIdentityTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("result-id")
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)
        self.data = source("result identity")
        strategies.publish_candidate(self.profile, self.data, "result", "Fixture", "identity fixture")

    def open(self, bundle):
        product_bundle(self.conn, bundle, {"research-plan.json": b"{}"})
        return trials.open_trial(self.conn, "research", sha(self.data), RUNTIME, inputs(), window(),
                                 context(self.data, "/tmp/" + bundle), attempt_binder(bundle, sha(self.data)))["trial_id"]

    def seal(self, trial_id):
        def insert(conn, op):
            conn.rows("INSERT INTO run (trial_id, status, audit, fingerprints, op_id, created_at) "
                      "VALUES (%s, 'passed', '{}', '{}', %s, '2026-01-01')", (trial_id, op))
            return {"trial_id": trial_id}
        return db.write(self.conn, "seal_fixture", {"trial_id": trial_id}, "run", insert)["commit"]

    def test_reverse_completion_and_equal_timestamps_use_result_commit_order(self):
        first = self.open("registration-first")
        second = self.open("registration-second")
        # Deterministically force a timestamp tie only in this disposable fixture. Production
        # retains its server-time trigger; neither timestamps nor launch IDs order these results.
        self.service.sql(self.profile, "DROP TRIGGER run_created")
        self.service.sql(self.profile, "CALL DOLT_COMMIT('-a', '-m', 'test timestamp tie')")
        self.assertIsNone(trials.latest_research(self.conn, sha(self.data)))
        second_commit = self.seal(second)
        self.assertEqual(trials.latest_research(self.conn, sha(self.data)), second)
        self.seal(first)
        self.assertLess(first, second)
        self.assertEqual(trials.latest_research(self.conn, sha(self.data)), first)
        self.assertEqual(len(self.conn.rows("SELECT DISTINCT created_at FROM run")), 1)
        with db.read_as_of(self.profile, second_commit) as pinned:
            self.assertEqual(trials.latest_research(pinned, sha(self.data)), second)
        columns = {row[0]: row for row in self.conn.rows("SHOW COLUMNS FROM run")}
        self.assertNotIn("run_id", columns)
        self.assertEqual(columns["trial_id"][3], "PRI")
        self.assertNotIn("auto_increment", columns["trial_id"][5])

    def test_v2_ledger_is_refused_without_modifying_its_history(self):
        self.service.sql(self.profile, "UPDATE ledger_schema SET version = 2")
        self.service.sql(self.profile, "CALL DOLT_COMMIT('-a', '-m', 'isolated v2 fixture')")
        before = self.service.sql(self.profile, "SELECT dolt_hashof('HEAD')")
        for role in ("reader", "writer"):
            with self.subTest(role=role), self.assertRaises(Refusal) as caught:
                db.connect(self.profile, role)
            self.assertEqual(caught.exception.code, "SCHEMA_MISMATCH")
        self.assertEqual(self.service.sql(self.profile, "SELECT dolt_hashof('HEAD')"), before)
