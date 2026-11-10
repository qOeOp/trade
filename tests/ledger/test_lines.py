"""Research lines: rows named by slug, exact reads, the open set, the trials each names and closing rows."""

from __future__ import annotations

from datetime import date
import unittest

from ledger import db, lines, strategies, trials
from shared.errors import Refusal
from shared.refusals import refuse
from tests.ledger.dolt import (BINARY, MARKET_COMMIT, RUNTIME, SKIP, Service, binder, context, coverage, grid_point,
                               market, reviewed, sha, source, window)


@unittest.skipUnless(BINARY, SKIP)
class ResearchLineTests(unittest.TestCase):
    def setUp(self):
        self.service = Service()
        self.addCleanup(self.service.close)
        self.profile = self.service.ledger("lines")
        strategies.publish_candidate(self.profile, source("start"), "start", "Fixture", "template root")
        self.conn = db.connect(self.profile, "writer")
        self.addCleanup(self.conn.close)

    def select(self, **overrides):
        arguments = {"market_at": "main", "window_start": date(2026, 1, 2), "window_end": date(2026, 2, 1),
                     "start": "start@1", "slug": "ema-trend", "market": market(),
                     "reviews": reviewed(source("start")), **overrides}
        return lines.select_line(self.conn, **arguments)

    def code(self, **overrides) -> str:
        seq = self.seq()
        with self.assertRaises(Refusal) as caught:
            self.select(**overrides)
        self.assertEqual(self.seq(), seq)
        return caught.exception.code

    def seq(self) -> int:
        return self.service.sql(self.profile, "SELECT seq FROM ledger_head")[0][0]

    def test_lines_are_named_by_slug_appended_and_read_back(self):
        self.assertEqual(lines.open_lines(self.conn), [])
        self.assertEqual(self.open_code(), "RESEARCH_LINE_REQUIRED")
        before = db.head_commit(self.conn)
        first = self.select()
        self.assertEqual((first["line"], first["market_commit"], first["universe_rule"], first["created"]),
                         ("ema-trend", MARKET_COMMIT, "pool-v1", True))
        self.assertEqual(lines.open_line(self.conn)["line_id"], first["line_id"])
        again = self.select()
        self.assertEqual((again["line_id"], again["created"], again["op_id"]),
                         (first["line_id"], False, first["op_id"]))
        second = self.select(window_end=date(2026, 3, 1), slug="ema-trend-wider")
        self.assertTrue(second["created"])
        same_choice = self.select(slug="ema-trend-elsewhere")
        self.assertNotEqual(same_choice["line_id"], first["line_id"], "lines on one choice stay apart by name")
        self.assertEqual(lines.open_lines(self.conn), ["ema-trend", "ema-trend-wider", "ema-trend-elsewhere"],
                         "selecting ends no line")
        self.assertEqual(self.open_code(), "LINE_AMBIGUOUS")
        read = lines.open_line(self.conn, "ema-trend-wider")
        self.assertEqual((read["line_id"], read["dev_start"], read["dev_end"], read["start"], read["start_sha256"],
                          read["universe_rule"], read["closed"]),
                         (second["line_id"], "2026-01-02", "2026-03-01", "start@1", sha(source("start")), "pool-v1",
                          False))
        self.assertEqual(lines.read_line(self.conn, second["line_id"])["name"], "ema-trend-wider")
        with db.read_as_of(self.profile, self.first_commit(first["line_id"])) as pinned:
            self.assertEqual(lines.open_lines(pinned), ["ema-trend"])
        with db.read_as_of(self.profile, before) as pinned:
            self.assertEqual(lines.open_lines(pinned), [])
        for line in ("none", 999):
            with self.subTest(line=line):
                self.assertEqual(self.open_code(line), "LINE_UNKNOWN")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM research_line"), [(3,)])

    def test_listing_all_lines_is_pinned_read_only_and_includes_closed_lines(self):
        from cli import main
        empty = lines.list_lines(self.profile)
        self.assertEqual(empty["lines"], [])
        first = self.select()
        first_head = db.head_commit(self.conn)
        second = self.select(window_end=date(2026, 3, 1), slug="ema-wider")
        lines.close_line(self.profile, first["line"], b"historical findings retained")
        head = db.head_commit(self.conn)
        found = lines.list_lines(self.profile)
        self.assertIn(("line", "list"), main.READS)
        self.assertEqual(found["ledger_commit"], head)
        self.assertEqual([(item["name"], item["closed"]) for item in found["lines"]],
                         [(first["line"], True), (second["line"], False)])
        self.assertEqual(found["lines"][0]["dev_start"], "2026-01-02")
        self.assertEqual([item["targets"] for item in found["lines"]], [None, None])
        historical = lines.list_lines(self.profile, first_head)
        self.assertEqual([(item["name"], item["closed"]) for item in historical["lines"]], [(first["line"], False)])
        self.assertEqual(lines.list_lines(self.profile, empty["ledger_commit"])["lines"], [])
        self.assertEqual(db.head_commit(self.conn), head, "listing writes no commit")
        third = self.select(window_end=date(2026, 3, 2), slug="ema-targets", targets=(0.15, 0.2))
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(DISTINCT to_commit) FROM dolt_diff_research_line "
                                                        "l JOIN dolt_diff_line_target t USING (to_commit) WHERE "
                                                        "l.to_line_id = %s", (third["line_id"],)), [(1,)],
                         "a line and its targets land in one commit")
        listed = {item["name"]: item["targets"] for item in lines.list_lines(self.profile)["lines"]}
        self.assertEqual((listed["ema-targets"]["max_drawdown"], listed["ema-targets"]["annual_return"],
                          listed["ema-targets"]["source"]), (0.15, 0.2, "line"))
        self.assertIsNone(listed[second["line"]])
        lines.close_line(self.profile, third["line"], b"targets read")
        lines.close_line(self.profile, second["line"], b"all lines are now historical")
        self.assertEqual([item["closed"] for item in lines.list_lines(self.profile)["lines"]], [True, True, True])

    def test_selection_refusals(self):
        self.assertEqual(self.code(start="start@9"), "START_NOT_FOUND")

        def unresolved(at):
            raise refuse("UNKNOWN_REF", "no such market ref")

        self.assertEqual(self.code(market=unresolved), "MARKET_COMMIT_UNRESOLVED")
        self.assertEqual(self.code(market=market(universe_rule=None)), "MARKET_COMMIT_UNRESOLVED")
        self.assertEqual(self.code(window_start=date(2026, 2, 1)), "WINDOW_INVALID")
        self.assertEqual(self.code(market=market(latest_complete_day=date(2026, 1, 30))), "WINDOW_OUT_OF_COVERAGE")
        self.assertEqual(self.code(reviews=reviewed()), "START_REVIEW_REQUIRED")
        for slug in ("", "EMA", "ema_trend", "ema--trend", "-ema", "ema-", "趋势", "a" * 49, None):
            with self.subTest(slug=slug):
                self.assertEqual(self.code(slug=slug), "LINE_SLUG_INVALID")
        for targets in ((0, 0.2), (1, 0.2), (0.1, 0)):
            with self.subTest(targets=targets):
                self.assertEqual(self.code(targets=targets), "TARGETS_INVALID")
        self.assertEqual(self.select(market=market(latest_complete_day=date(2026, 1, 31)))["line"], "ema-trend")
        self.assertEqual(self.code(window_end=date(2026, 1, 30)), "LINE_CONFLICT")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM research_line"), [(1,)])

    def test_line_trials_are_the_research_trials_that_name_the_line(self):
        line = self.select()
        counted = self.research_trial(line["line_id"], "counted")
        trials.open_trial(self.conn, "precheck", sha(source("start")), RUNTIME, coverage(), window(),
                          context(source("start")))
        since = db.head_commit(self.conn)
        self.assertEqual(lines.line_trials(self.conn, "ema-trend"), {"trials": [counted], "count": 1})
        later = self.research_trial(line["line_id"], "later")
        self.assertEqual(lines.line_trials(self.conn, line["line_id"])["trials"], [counted, later])
        self.assertEqual(lines.line_trials(self.conn, "ema-trend", since_commit=since)["trials"], [later])
        with db.read_as_of(self.profile, since) as pinned:
            self.assertEqual(lines.line_trials(pinned, "ema-trend")["trials"], [counted])
        lines.close_line(self.profile, "ema-trend", b"ema trend summary")
        successor = self.select(slug="ema-trend-again")
        own = self.research_trial(successor["line_id"], "own")
        self.assertEqual(lines.line_trials(self.conn, "ema-trend-again")["trials"], [own],
                         "a closed line's trials stay its own")
        self.assertEqual(lines.line_trials(self.conn, "ema-trend")["trials"], [counted, later])
        for name in ("none", 999):
            with self.subTest(line=name), self.assertRaises(Refusal) as caught:
                lines.line_trials(self.conn, name)
            self.assertEqual(caught.exception.code, "LINE_UNKNOWN")

    def test_lines_on_one_market_commit_and_window_keep_the_trials_that_name_them(self):
        line = self.select()
        other = self.select(slug="ema-other")
        self.assertEqual((line["market_commit"], other["market_commit"]), (MARKET_COMMIT, MARKET_COMMIT))
        mine = self.research_trial(line["line_id"], "mine")
        theirs = self.research_trial(other["line_id"], "theirs")
        self.assertEqual(lines.line_trials(self.conn, "ema-trend")["trials"], [mine])
        self.assertEqual(lines.line_trials(self.conn, "ema-other")["trials"], [theirs])

    def test_an_open_line_is_closed_once_with_its_summary(self):
        first = self.select()
        second = self.select(window_end=date(2026, 3, 1), slug="ema-trend-wider")
        before = db.head_commit(self.conn)
        summary = "\n# 方向\nEMA 趋势  \n# 教训\n窗口太短。\n\n".encode()
        for bad in (b"", b"  \n", b"\xff", b"x" * (lines.SUMMARY_LIMIT + 1)):
            with self.subTest(summary=bad[:8]):
                self.assertEqual(self.close_code("ema-trend", bad), "LINE_SUMMARY_INVALID")
        closed = lines.close_line(self.profile, "ema-trend", summary)
        self.assertEqual((closed["line"], closed["line_id"], closed["replayed"]), ("ema-trend", first["line_id"], False))
        self.assertEqual(self.service.sql(self.profile, "SELECT line_id, summary FROM line_close"),
                         [(first["line_id"], summary.decode().strip())])
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM dolt_tags"), [(0,)])
        self.assertEqual(lines.read_line(self.conn, "ema-trend")["summary"], summary.decode().strip())
        self.assertEqual(lines.open_lines(self.conn), ["ema-trend-wider"])
        self.assertEqual(lines.open_line(self.conn)["line_id"], second["line_id"])
        self.assertEqual(self.open_code("ema-trend"), "LINE_ENDED")
        with db.read_as_of(self.profile, closed["ledger_commit"]) as pinned:
            self.assertEqual(lines.open_lines(pinned), ["ema-trend-wider"])
        with db.read_as_of(self.profile, before) as pinned:
            self.assertEqual(lines.open_lines(pinned), ["ema-trend", "ema-trend-wider"],
                             "open before its closing commit")
        later = self.select(window_end=date(2026, 3, 31), slug="ema-later")
        self.assertTrue(lines.close_line(self.profile, "ema-trend", summary)["replayed"], "a later head too")
        self.assertEqual(self.close_code("ema-trend", b"another summary"), "LINE_CLOSED")
        self.assertEqual(lines.open_lines(self.conn), ["ema-trend-wider", "ema-later"])
        self.assertTrue(self.select(slug="ema-trend-again")["created"], "a closed line's market and window are free")
        self.assertEqual(self.close_code("none", summary), "LINE_UNKNOWN")
        self.assertEqual(later["line"], "ema-later")

    def open_code(self, line=None) -> str:
        with self.assertRaises(Refusal) as caught:
            lines.open_line(self.conn, line)
        return caught.exception.code

    def close_code(self, line, summary) -> str:
        seq = self.seq()
        with self.assertRaises(Refusal) as caught:
            lines.close_line(self.profile, line, summary)
        self.assertEqual(self.seq(), seq)
        return caught.exception.code

    def research_trial(self, line_id: int, tag: str) -> int:
        """A research trial of the start source on line `line_id`, under a registration of its own."""
        receipt = coverage(export_content_sha256=sha(tag.encode()))
        registration = grid_point(self.conn, line_id, source("start"), receipt)
        return trials.open_trial(self.conn, "research", sha(source("start")), RUNTIME, receipt, window(),
                                 context(source("start")), binder(line_id, registration))["trial_id"]

    def first_commit(self, line_id: int) -> str:
        return self.service.sql(self.profile, "SELECT to_commit FROM dolt_diff_research_line WHERE to_line_id = %s "
                                              "AND diff_type = 'added'", (line_id,))[0][0]


if __name__ == "__main__":
    unittest.main()
