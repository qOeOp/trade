"""Shared result identity and insertion ordering on a disposable ledger."""

from __future__ import annotations

import unittest

from ledger import db, strategies, trials
from tests.ledger.dolt import (ACCOUNT, BINARY, IDENTITY, RUNTIME, SKIP, SYMBOLS, Service, binder, context, coverage,
                               grid_point, select_line, sha, source, window)


def receipt(export: str) -> bytes:
    """A coverage receipt of export `export` whose effective configuration has every key the engine writes."""
    return coverage(export_content_sha256=export * 64, effective_config={"runtime_contract": IDENTITY["runtime_contract"], **window(),
                                      "execution_bar_minutes": 1440, "symbols": list(SYMBOLS),
                                      "account": dict(ACCOUNT)})


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
        self.line_id = select_line(self.conn, "result@1", "result-line", self.data)["line_id"]

    def open(self, export: str):
        registration = grid_point(self.conn, self.line_id, self.data, receipt(export))
        return trials.open_trial(self.conn, "research", sha(self.data), RUNTIME, receipt(export), window(),
                                 context(self.data), binder(self.line_id, registration))["trial_id"]

    def seal(self, trial_id):
        def insert(conn, op):
            conn.rows("INSERT INTO run (trial_id, fingerprints, op_id) VALUES (%s, '{}', %s)", (trial_id, op))
            return {"trial_id": trial_id}
        return db.write(self.conn, "seal_fixture", {"trial_id": trial_id}, "run", insert)["commit"]

    def test_reverse_completion_and_equal_timestamps_use_result_commit_order(self):
        first = self.open("e")
        second = self.open("f")
        # Deterministically force a timestamp tie only in this disposable fixture. Production
        # retains its server-time trigger; neither timestamps nor launch IDs order these results.
        self.service.sql(self.profile, "DROP TRIGGER run_sealed")
        self.service.sql(self.profile, "CREATE TRIGGER run_sealed BEFORE INSERT ON run FOR EACH ROW SET "
                                       "NEW.created_at = '2026-01-01', "
                                       "NEW.sealed_seq = (SELECT seq FROM ledger_head WHERE singleton = 1)")
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


if __name__ == "__main__":
    unittest.main()
