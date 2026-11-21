"""If this fails, a read of many IDs (LedgerConnection.rows_in) drops or repeats rows across its batches, binds
the wrong parameters to a statement holding the list twice or other parameters around it, or sends `IN ()`."""

from __future__ import annotations

from pathlib import Path
import unittest

from ledger import db


class Raw:
    """A driver connection whose every statement answers one row per bound parameter."""

    def __init__(self):
        self.executed: list[tuple[str, tuple]] = []

    def cursor(self):
        return Cursor(self)


class Cursor:
    def __init__(self, raw):
        self.raw, self.description, self.found = raw, (("value",),), []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params):
        self.raw.executed.append((statement, tuple(params)))
        self.found = [(value,) for value in params]

    def fetchall(self):
        return self.found

    def nextset(self):
        return None


class RowsInTests(unittest.TestCase):
    def setUp(self):
        self.raw = Raw()
        self.conn = db.LedgerConnection(self.raw, db.LedgerProfile(name="t", database="t",
                                                                   service_root=Path("/nonexistent")), "reader")

    def test_batches_cover_every_value_once_with_the_parameters_around_each_list(self):
        values = list(range(db.IN_BATCH + 2))
        found = self.conn.rows_in("SELECT a WHERE x = %s AND (id IN () OR id IN ()) AND y = %s", values,
                                  before=("b",), after=("a",))
        self.assertEqual(len(self.raw.executed), 2)
        statement, params = self.raw.executed[1]
        self.assertEqual(statement, "SELECT a WHERE x = %s AND (id IN (%s, %s) OR id IN (%s, %s)) AND y = %s")
        self.assertEqual(params, ("b", db.IN_BATCH, db.IN_BATCH + 1, db.IN_BATCH, db.IN_BATCH + 1, "a"))
        self.assertEqual(self.raw.executed[0][1][1:db.IN_BATCH + 1], tuple(range(db.IN_BATCH)))
        self.assertEqual(len(found), (2 + 2 * db.IN_BATCH) + (2 + 2 * 2))  # every bound parameter, batch after batch

    def test_no_values_read_nothing(self):
        self.assertEqual(self.conn.rows_in("SELECT a WHERE id IN ()", []), [])
        self.assertEqual(self.raw.executed, [])

    def test_dicts_name_the_columns(self):
        self.assertEqual(self.conn.rows_in("SELECT value WHERE id IN ()", (7,), dicts=True), [{"value": 7}])
