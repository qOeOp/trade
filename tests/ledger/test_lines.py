"""Research lines: rows named by slug, exact reads, the open set, the trials each names and closing rows."""

from __future__ import annotations

from datetime import UTC, date, datetime, time
import unittest

from ledger import db, lines, strategies, trials
from shared.errors import Refusal
from shared.refusals import refuse
from tests.deploy import test_release
from tests.ledger.dolt import (MARKET_DAYS, BINARY, MARKET_DAY, RUNTIME, SKIP, Service, binder, context, coverage, grid_point,
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
        arguments = {"market_at": "main", "today": date(2026, 4, 15), "start": "start@1", "slug": "ema-trend", "market": market(),
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
        self.assertEqual((first["line"], first["market_day"], first["universe_rule"], first["created"]),
                         ("ema-trend", MARKET_DAY, "pool-v1", True))
        self.assertEqual(lines.open_line(self.conn)["line_id"], first["line_id"])
        again = self.select()
        self.assertEqual((again["line_id"], again["created"], again["op_id"]),
                         (first["line_id"], False, first["op_id"]))
        second = self.select(market=market(market_day="2026-03-02"), slug="ema-trend-wider")
        self.assertTrue(second["created"])
        same_choice = self.select(slug="ema-trend-elsewhere")
        self.assertNotEqual(same_choice["line_id"], first["line_id"], "lines on one choice stay apart by name")
        self.assertEqual(lines.open_lines(self.conn), ["ema-trend", "ema-trend-wider", "ema-trend-elsewhere"],
                         "selecting ends no line")
        self.assertEqual(self.open_code(), "LINE_AMBIGUOUS")
        read = lines.open_line(self.conn, "ema-trend-wider")
        self.assertEqual((read["line_id"], read["dev_start"], read["dev_end"], read["start"], read["start_sha256"],
                          read["universe_rule"], read["closed"]),
                         (second["line_id"], "2021-04-01", "2024-04-01", "start@1", sha(source("start")), "pool-v1",
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

    def test_listing_lines_is_pinned_read_only_and_reads_closed_lines_only_when_asked(self):
        from cli import main
        empty = lines.list_lines(self.profile)
        self.assertEqual(empty["lines"], [])
        first = self.select()
        first_head = db.head_commit(self.conn)
        second = self.select(market=market(market_day="2026-03-03"), slug="ema-wider")
        lines.close_line(self.profile, first["line"], b"historical findings retained", MARKET_DAYS)
        head = db.head_commit(self.conn)
        self.assertEqual([item["name"] for item in lines.list_lines(self.profile)["lines"]], [second["line"]],
                         "L11: the open lines by default")
        found = lines.list_lines(self.profile, every=True)
        self.assertIn(("line", "list"), main.READS)
        self.assertEqual(found["ledger_commit"], head)
        self.assertEqual([(item["name"], item["closed"]) for item in found["lines"]],
                         [(first["line"], True), (second["line"], False)])
        self.assertEqual(found["lines"][0]["dev_start"], "2021-04-01")
        self.assertEqual(set(found["lines"][0]), {*lines.LISTED, "targets"}, "deploy.release_host reads these entries")
        self.assertEqual(set(test_release.LINE_KEYS), {*lines.LISTED, "targets"}, "and its test writes them out")
        self.assertEqual([item["targets"] for item in found["lines"]], [None, None])
        historical = lines.list_lines(self.profile, first_head)
        self.assertEqual([(item["name"], item["closed"]) for item in historical["lines"]], [(first["line"], False)])
        self.assertEqual(lines.list_lines(self.profile, empty["ledger_commit"])["lines"], [])
        self.assertEqual(db.head_commit(self.conn), head, "listing writes no commit")
        third = self.select(market=market(market_day="2026-03-04"), slug="ema-targets", targets=(0.15, 0.2))
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(DISTINCT to_commit) FROM dolt_diff_research_line "
                                                        "l JOIN dolt_diff_line_target t USING (to_commit) WHERE "
                                                        "l.to_line_id = %s", (third["line_id"],)), [(1,)],
                         "a line and its targets land in one commit")
        listed = {item["name"]: item["targets"] for item in lines.list_lines(self.profile, every=True)["lines"]}
        self.assertEqual((listed["ema-targets"]["max_drawdown"], listed["ema-targets"]["annual_return"],
                          listed["ema-targets"]["source"]), (0.15, 0.2, "line"))
        self.assertIsNone(listed[second["line"]])
        lines.close_line(self.profile, third["line"], b"targets read", MARKET_DAYS)
        lines.close_line(self.profile, second["line"], b"all lines are now historical", MARKET_DAYS)
        self.assertEqual([item["closed"] for item in lines.list_lines(self.profile, every=True)["lines"]], [True, True, True])
        self.assertEqual(lines.list_lines(self.profile)["lines"], [])

    def test_the_development_period_is_the_twelve_quarters_before_the_two_year_holdout(self):
        """3.1 (user 2026-11-11, "改成三段切分"): Q is the last quarter end before today the market covers; the
        holdout the 8 quarters ending at Q, the period the 12 before it, or 4 with less than 24 quarters of
        coverage before Q, and no line with less than 12."""
        covered = date(2019, 9, 1)
        for today, latest, period in ((date(2026, 11, 10), date(2026, 11, 9), (date(2021, 10, 1), date(2024, 10, 1))),
                                      (date(2026, 8, 15), date(2026, 8, 14), (date(2021, 7, 1), date(2024, 7, 1))),
                                      (date(2026, 10, 1), date(2026, 9, 30), (date(2021, 10, 1), date(2024, 10, 1))),
                                      (date(2026, 10, 1), date(2026, 9, 29), (date(2021, 7, 1), date(2024, 7, 1))),
                                      (date(2026, 9, 30), date(2026, 9, 30), (date(2021, 7, 1), date(2024, 7, 1))),
                                      (date(2027, 1, 5), date(2026, 12, 31), (date(2022, 1, 1), date(2025, 1, 1)))):
            with self.subTest(today=today, latest=latest):
                self.assertEqual(lines.development_period(today, latest, covered), period)
        self.assertEqual(lines.holdout_end(date(2024, 10, 1)), date(2026, 10, 1))
        today, latest = date(2026, 11, 11), date(2026, 11, 10)  # Q = 2026-09-30
        for covered, period in ((date(2020, 10, 1), (date(2021, 10, 1), date(2024, 10, 1))),  # 24 quarters
                                (date(2020, 10, 2), (date(2023, 10, 1), date(2024, 10, 1))),  # 23: one year
                                (date(2023, 10, 1), (date(2023, 10, 1), date(2024, 10, 1)))):  # 12
            with self.subTest(covered=covered):
                self.assertEqual(lines.development_period(today, latest, covered), period)
        for covered in (date(2023, 10, 2), None):  # 11 quarters; an instrument the market never covered
            with self.subTest(covered=covered), self.assertRaises(Refusal) as caught:
                lines.development_period(today, latest, covered)
            self.assertEqual(caught.exception.code, "LINE_HISTORY_SHORT")
        months = {"BTCUSDT": date(2020, 2, 1), "OPUSDT": date(2022, 7, 1)}
        self.assertEqual([lines.covered_from(found, date(2020, 2, 1), months) for found in
                          (None, ["BTCUSDT"], ["BTCUSDT", "OPUSDT"], ["BTCUSDT", "WIFUSDT"])],
                         [date(2020, 2, 1), date(2020, 2, 1), date(2022, 7, 1), None])
        self.assertEqual([lines.selection(argv) for argv in ('["--symbols", "BTCUSDT", "ETHUSDT", "--start", "x"]',
                                                              ["--universe", "pool", "--start", "x"])],
                         [["BTCUSDT", "ETHUSDT"], None])
        line = self.select()
        self.assertEqual((line["line"], lines.read_line(self.conn, line["line_id"])["dev_start"]),
                         ("ema-trend", "2021-04-01"))

    def test_explore_and_precheck_trade_only_inside_a_development_period(self):
        """B5 (line-close-history-test 3.2, user 2026-11-11): a replay with a line trades inside that line's period;
        one without (a start candidate's precheck) inside today's period and before any open line's holdout."""
        def ns(day: date) -> int:
            return int(datetime.combine(day, time(), UTC).timestamp()) * 10**9

        def check(line, first, end, today=date(2026, 11, 11), covered=date(2019, 9, 1)):
            lines.check_replay_window(self.conn, line, ns(first), ns(end), date(2026, 11, 10), covered, today=today)

        def refused(*args, **kwargs) -> str:
            with self.assertRaises(Refusal) as caught:
                check(*args, **kwargs)
            return caught.exception.code

        august = self.select(today=date(2026, 8, 15), market=market(latest_complete_day=date(2026, 8, 14)))
        self.assertEqual(lines.read_line(self.conn, august["line_id"])["dev_end"], "2024-07-01")
        check("ema-trend", date(2021, 7, 1), date(2024, 7, 1))
        self.assertEqual(refused("ema-trend", date(2024, 6, 1), date(2024, 7, 2)), "WINDOW_OUTSIDE_DEVELOPMENT")
        # without a line: today's period is 2021-10-01 to 2024-10-01, but the open August line's holdout starts at
        # 2024-07-01 and inside it is refused
        check(None, date(2024, 5, 1), date(2024, 7, 1))
        self.assertEqual(refused(None, date(2024, 8, 1), date(2024, 9, 1)), "WINDOW_OUTSIDE_DEVELOPMENT")
        self.assertEqual(refused(None, date(2021, 9, 1), date(2021, 10, 2)), "WINDOW_OUTSIDE_DEVELOPMENT")
        self.assertEqual(refused(None, date(2024, 5, 1), date(2024, 6, 1), covered=date(2024, 1, 1)),
                         "LINE_HISTORY_SHORT", "no line could open on instruments covered for under 12 quarters")
        lines.close_line(self.profile, "ema-trend", b"holdout and forward segment replayed at close", MARKET_DAYS)
        check(None, date(2024, 8, 1), date(2024, 9, 1))  # a closed line's holdout was replayed at its close
        self.assertEqual(refused(None, date(2024, 9, 1), date(2024, 10, 2)), "WINDOW_OUTSIDE_DEVELOPMENT")
        self.assertEqual(refused("ema-trend", date(2022, 8, 1), date(2022, 9, 1)), "LINE_ENDED")
        self.assertEqual(refused("none", date(2022, 8, 1), date(2022, 9, 1)), "LINE_UNKNOWN")

    def test_selection_refusals(self):
        self.assertEqual(self.code(start="start@9"), "START_NOT_FOUND")

        def unresolved(at):
            raise refuse("UNKNOWN_REF", "no such market ref")

        self.assertEqual(self.code(market=unresolved), "MARKET_DAY_UNRESOLVED")
        self.assertEqual(self.code(market=market(universe_rule=None)), "MARKET_DAY_UNRESOLVED")
        self.assertEqual(self.code(reviews=reviewed()), "START_REVIEW_REQUIRED")
        self.assertEqual(self.code(market=market(first_day=date(2024, 1, 1))), "LINE_HISTORY_SHORT")
        for slug in ("", "EMA", "ema_trend", "ema--trend", "-ema", "ema-", "趋势", "a" * 49, None):
            with self.subTest(slug=slug):
                self.assertEqual(self.code(slug=slug), "LINE_SLUG_INVALID")
        for targets in ((0, 0.2), (1, 0.2), (0.1, 0)):
            with self.subTest(targets=targets):
                self.assertEqual(self.code(targets=targets), "TARGETS_INVALID")
        # the same quarter's period is the same choice; an older complete day gives an earlier period, another choice
        self.assertEqual(self.select(market=market(latest_complete_day=date(2026, 4, 14)))["line"], "ema-trend")
        self.assertEqual(self.code(market=market(latest_complete_day=date(2025, 12, 31))), "LINE_CONFLICT")
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
        lines.close_line(self.profile, "ema-trend", b"ema trend summary", MARKET_DAYS)
        successor = self.select(slug="ema-trend-again")
        own = self.research_trial(successor["line_id"], "own")
        self.assertEqual(lines.line_trials(self.conn, "ema-trend-again")["trials"], [own],
                         "a closed line's trials stay its own")
        self.assertEqual(lines.line_trials(self.conn, "ema-trend")["trials"], [counted, later])
        for name in ("none", 999):
            with self.subTest(line=name), self.assertRaises(Refusal) as caught:
                lines.line_trials(self.conn, name)
            self.assertEqual(caught.exception.code, "LINE_UNKNOWN")

    def test_lines_on_one_market_day_and_window_keep_the_trials_that_name_them(self):
        line = self.select()
        other = self.select(slug="ema-other")
        self.assertEqual((line["market_day"], other["market_day"]), (MARKET_DAY, MARKET_DAY))
        mine = self.research_trial(line["line_id"], "mine")
        theirs = self.research_trial(other["line_id"], "theirs")
        self.assertEqual(lines.line_trials(self.conn, "ema-trend")["trials"], [mine])
        self.assertEqual(lines.line_trials(self.conn, "ema-other")["trials"], [theirs])

    def test_an_open_line_is_closed_once_with_its_summary(self):
        first = self.select()
        second = self.select(market=market(market_day="2026-03-05"), slug="ema-trend-wider")
        before = db.head_commit(self.conn)
        summary = "\n# 方向\nEMA 趋势  \n# 教训\n窗口太短。\n\n".encode()
        for bad in (b"", b"  \n", b"\xff", b"x" * (lines.SUMMARY_LIMIT + 1)):
            with self.subTest(summary=bad[:8]):
                self.assertEqual(self.close_code("ema-trend", bad), "LINE_SUMMARY_INVALID")
        closed = lines.close_line(self.profile, "ema-trend", summary, MARKET_DAYS)
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
        later = self.select(market=market(market_day="2026-03-06"), slug="ema-later")
        self.assertTrue(lines.close_line(self.profile, "ema-trend", summary, MARKET_DAYS)["replayed"], "a later head too")
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
            lines.close_line(self.profile, line, summary, MARKET_DAYS)
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
