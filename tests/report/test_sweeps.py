"""The variants a line's search_exposure judgments declare (status.sweeps): the largest K along each
supersession chain, current judgments only, and the undeclared ones listed."""

from __future__ import annotations

import unittest

from report import status


class Conn:
    """The two reads of status.sweeps: the lines of the overlapping trials, then their search_exposure judgments."""

    def __init__(self, owners, judgments):
        self.owners, self.judgments, self.asked = owners, judgments, None

    def rows(self, sql, params):
        return [(owner,) for owner in self.owners]

    def dicts(self, sql, params):
        self.asked = params
        return [row for row in self.judgments if row["line_id"] in params]


def row(judgment_id, line_id, body, supersedes=None):
    return {"judgment_id": judgment_id, "line_id": line_id, "body": body, "supersedes": supersedes}


class SweepTests(unittest.TestCase):
    def test_the_largest_k_of_a_chain_counts_once_and_undeclared_ones_are_listed(self):
        conn = Conn([2], [
            row(1, 1, "Evaluated variants: 30\nscaling grid"),
            row(2, 1, "Evaluated variants: 4\nreconstructed", supersedes=1),  # a supersession cannot lower it
            row(3, 1, "free text before the rule"),
            row(4, 2, "old text"),
            row(5, 2, "Evaluated variants: 6\nsignal dates", supersedes=4),
            row(6, 9, "Evaluated variants: 100"),  # a line with no overlapping trial
            row(7, 1, "older free text"),
            row(8, 1, "still free text", supersedes=7),
        ])
        self.assertEqual(status.sweeps(conn, 1, [{"trial_id": 11}]),
                         {"sweep_variants": 36, "undeclared_sweeps": [3, 8]})
        self.assertEqual(conn.asked, (1, 2))

    def test_a_line_without_trials_reads_its_own_judgments(self):
        conn = Conn([], [row(1, 1, "Evaluated variants: 0")])
        self.assertEqual(status.sweeps(conn, 1, []), {"sweep_variants": 0, "undeclared_sweeps": []})
