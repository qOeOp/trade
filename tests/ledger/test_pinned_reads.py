"""A read at a pinned commit is reused only inside `reusing_pinned_reads`, only on a pinned reader connection, and
never as a shared object or a kept refusal (ledger.db.pinned_read)."""

from __future__ import annotations

from pathlib import Path
import unittest

from ledger import db
from shared.errors import Refusal
from shared.refusals import refuse

PROFILE = db.LedgerProfile(name="t", database="t", service_root=Path("/nonexistent"))


def pinned(commit: str) -> db.ReadConnection:
    return db.ReadConnection(None, PROFILE, commit)


class PinnedReadTests(unittest.TestCase):
    def setUp(self):
        self.calls: list[tuple] = []

        @db.pinned_read
        def read(conn, trial_id):
            self.calls.append((getattr(conn, "resolved_commit", None), trial_id))
            if trial_id < 0:
                raise refuse("TRIAL_NOT_FOUND", "no such trial")
            return {"trial_id": trial_id, "rows": [1, 2]}

        self.read = read

    def test_a_repeated_read_at_one_commit_is_read_once_inside_the_block_only(self):
        conn = pinned("a" * 32)
        with db.reusing_pinned_reads():
            first = self.read(conn, 1)
            first["rows"].append(3)  # a caller may change what it got
            self.assertEqual(self.read(conn, 1), {"trial_id": 1, "rows": [1, 2]})
            self.read(pinned("b" * 32), 1)  # another commit is another read
        self.read(conn, 1)  # outside the block nothing is kept
        self.assertEqual(self.calls, [("a" * 32, 1), ("b" * 32, 1), ("a" * 32, 1)])

    def test_an_unpinned_connection_and_a_refusal_are_read_every_time(self):
        branch = db.LedgerConnection(None, PROFILE, "reader")
        with db.reusing_pinned_reads():
            self.read(branch, 1)
            self.read(branch, 1)
            for _ in range(2):
                with self.assertRaises(Refusal):
                    self.read(pinned("a" * 32), -1)
        self.assertEqual(len(self.calls), 4)


if __name__ == "__main__":
    unittest.main()
