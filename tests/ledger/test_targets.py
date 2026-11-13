"""If this fails, the user's research targets are no longer read back as recorded: a line's own
targets, else the ledger default, the latest change in force (a value set again after another is not
lost), written with the line in one commit, refused on an ended line."""

from __future__ import annotations

from datetime import date
import unittest

from ledger import db, lines, strategies, targets
from shared.errors import Refusal
from tests.ledger.dolt import MARKET_DAYS, BINARY, SKIP, Service, market, pinned, reviewed, source


@unittest.skipUnless(BINARY, SKIP)
class TargetTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("targets")
        strategies.publish_candidate(self.profile, source("start"), "start", "Fixture", "template root")
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def select(self, slug: str, window_end: date, line_targets=None) -> int:
        with pinned(date(2026, 1, 2), window_end):
            return lines.select_line(self.conn, "main", "start@1", slug=slug, market=market(),
                                     reviews=reviewed(source("start")), targets=line_targets)["line_id"]

    def commits(self) -> int:
        return self.service.sql(self.profile, "SELECT COUNT(*) FROM dolt_log")[0][0]

    def code(self, *arguments) -> str:
        with self.assertRaises(Refusal) as caught:
            targets.set_targets(self.conn, *arguments)
        return caught.exception.code

    def in_force(self, line: int | None) -> tuple:
        found = targets.targets_for(self.conn, line)
        return None if found is None else (found["max_drawdown"], found["annual_return"], found["source"])

    def test_a_line_reads_its_own_targets_else_the_default_and_the_latest_change(self):
        first = self.select("ema-trend", date(2026, 2, 1))
        self.assertIsNone(self.in_force(first))
        targets.set_targets(self.conn, None, 0.15, 0.2)
        self.assertEqual(self.in_force(first), (0.15, 0.2, "default"))
        before = self.commits()
        second = self.select("ema-wider", date(2026, 3, 1), ("0.1", "0.3"))
        self.assertEqual(self.commits(), before + 1, "the line and its targets are one commit")
        self.assertEqual(self.in_force(second), (0.1, 0.3, "line"))
        for drawdown in (0.2, 0.1):  # back to an earlier value is a new change, not a replay of the first
            self.assertTrue(targets.set_targets(self.conn, second, drawdown, 0.3)["written"])
        self.assertEqual(self.in_force(second), (0.1, 0.3, "line"))
        self.assertFalse(targets.set_targets(self.conn, second, "0.10", "0.30")["written"])
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM line_target WHERE line_id = %s",
                                          (second,)), [(3,)])
        self.assertEqual(self.in_force(None), (0.15, 0.2, "default"))
        self.assertTrue(targets.set_targets(self.conn, first, 0.12, 0.2)["written"], "every open line takes targets")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM line_target t WHERE t.line_id = %s AND "
                                                        "NOT EXISTS (SELECT 1 FROM line_target n WHERE n.supersedes = "
                                                        "t.target_id)", (second,)), [(1,)], "one chain end per scope")
        lines.close_line(self.profile, "ema-trend", b"ema trend summary", MARKET_DAYS)
        self.assertEqual(self.code(first, 0.15, 0.2), "LINE_ENDED")
        self.assertEqual(self.code(first + second + 1, 0.15, 0.2), "LINE_UNKNOWN")
        for drawdown, annual in ((0, 0.2), (1, 0.2), (0.15, 0), (0.15, -0.1), ("nan", 0.2), (0.15, "inf"), (None, 0.2)):
            with self.subTest(drawdown=drawdown, annual=annual):
                self.assertEqual(self.code(second, drawdown, annual), "TARGETS_INVALID")
