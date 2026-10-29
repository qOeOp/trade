"""Research lines: append-only dated records, exact reads, the open set, the trials of a line and closing
tags."""

from __future__ import annotations

from datetime import date
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ledger import db, evidence, lines, strategies, trials
from ledger.errors import Refusal
from ledger.refusals import refuse
from tests.ledger.dolt import (BINARY, JAN, DAY, MARKET_COMMIT, RUNTIME, SKIP, Service, attempt_binder, context,
                               inputs, market, product_bundle, reviewed, sha, source)


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
        arguments = {"market_database": "market", "market_at": "main", "window_start": date(2026, 1, 2),
                     "window_end": date(2026, 2, 1), "start": "start@1", "note": "why this line",
                     "slug": "ema-trend", "market": market(), "reviews": reviewed(source("start")), **overrides}
        return lines.select_line(self.conn, **arguments)

    def code(self, **overrides) -> str:
        with self.assertRaises(Refusal) as caught:
            self.select(**overrides)
        return caught.exception.code

    def name(self, slug: str) -> str:
        (today,), = self.service.sql(self.profile, "SELECT DATE(UTC_TIMESTAMP())")
        return f"research-line-{today.strftime('%Y%m%d')}-{slug}"

    def test_lines_are_named_by_date_and_direction_appended_and_read_back(self):
        self.assertEqual(lines.open_lines(self.conn), [])
        self.assertEqual(self.open_code(), "RESEARCH_LINE_REQUIRED")
        before = db.head_commit(self.conn)
        first = self.select()
        self.assertEqual((first["bundle"], first["market_commit"], first["created"]),
                         (self.name("ema-trend"), MARKET_COMMIT, True))
        self.assertEqual(lines.open_line(self.conn)["bundle"], first["bundle"])
        again = self.select(slug="another-name")  # the same choice is that open line, whatever its slug
        self.assertEqual((again["bundle"], again["created"], again["content_sha256"]),
                         (first["bundle"], False, first["content_sha256"]))
        second = self.select(window_end=date(2026, 3, 1), note=None, slug="ema-trend-wider")
        self.assertEqual(second["bundle"], self.name("ema-trend-wider"))
        self.assertEqual(lines.open_lines(self.conn), [first["bundle"], second["bundle"]], "selecting ends no line")
        self.assertEqual(self.open_code(), "LINE_AMBIGUOUS")
        read = lines.open_line(self.conn, second["bundle"])
        self.assertEqual((read["bundle"], read["window_start"], read["window_end"], read["start"],
                          read["start_sha256"], read["universe_rule"], read["note"]),
                         (second["bundle"], "2026-01-02", "2026-03-01", "start@1", sha(source("start")), "pool-v1",
                          None))
        again = self.select(window_end=date(2026, 3, 1), note=None, slug="wider-again")
        self.assertEqual((again["bundle"], again["created"]), (second["bundle"], False), "a replay of any open line")
        self.assertEqual(lines.open_lines(self.conn, at=first_commit(self.service, self.profile, first["bundle"])),
                         [first["bundle"]])
        self.assertEqual(lines.open_lines(self.conn, at=before), [])
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM evidence "
                                                        "WHERE bundle LIKE 'research-line-%'"), [(2,)])

    def test_selection_refusals(self):
        self.assertEqual(self.code(start="start@9"), "START_NOT_FOUND")

        def unresolved(database, at):
            raise refuse("UNKNOWN_REF", "no such market ref")

        self.assertEqual(self.code(market=unresolved), "MARKET_COMMIT_UNRESOLVED")
        self.assertEqual(self.code(market=market(universe_rule=None)), "MARKET_COMMIT_UNRESOLVED")
        self.assertEqual(self.code(window_start=date(2026, 2, 1)), "WINDOW_INVALID")
        self.assertEqual(self.code(market=market(latest_complete_day=date(2026, 1, 30))), "WINDOW_OUT_OF_COVERAGE")
        self.assertEqual(self.code(reviews=reviewed()), "START_REVIEW_REQUIRED")
        for slug in ("", "EMA", "ema_trend", "ema--trend", "-ema", "ema-", "趋势", "a" * 49, None):
            with self.subTest(slug=slug):
                self.assertEqual(self.code(slug=slug), "LINE_SLUG_INVALID")
        self.assertEqual(self.select(market=market(latest_complete_day=date(2026, 1, 31)))["bundle"],
                         self.name("ema-trend"))
        self.assertEqual(self.code(note="another choice"), "LINE_CONFLICT")  # same day, same slug
        self.assertEqual(self.code(note="another choice", slug="ema-again"), "LINE_DATA_TAKEN")
        self.assertEqual(self.service.sql(self.profile, "SELECT COUNT(*) FROM evidence_bundle "
                                                        "WHERE bundle LIKE 'research-line-%'"), [(1,)])

    def test_an_agent_cannot_forge_a_research_line(self):
        line = self.select()
        work = Path(tempfile.mkdtemp(prefix="ll-", dir="/tmp"))
        self.addCleanup(__import__("shutil").rmtree, work, ignore_errors=True)
        (work / "research-line.json").write_text(json.dumps({"format": "research-line-v2", "start": "forged@1"}))
        for name in ("research-line-20991231-forged", "research-line-7", "research-line-x"):
            with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                evidence.add_bundle(self.conn, name, [work / "research-line.json"])
            self.assertEqual(caught.exception.code, "RESERVED_BUNDLE")
        self.assertEqual(lines.open_line(self.conn)["bundle"], line["bundle"])

    def test_damaged_line_records_are_refused_on_read(self):
        product_bundle(self.conn, "research-line-20260101-damaged", {"other.json": b"{}"})
        with self.assertRaises(Refusal) as caught:
            lines.open_line(self.conn, "research-line-20260101-damaged")
        self.assertEqual(caught.exception.code, "LINE_CORRUPT")
        product_bundle(self.conn, "research-line-20260101-old-format",
                       {"research-line.json": json.dumps({"format": "v0"}).encode()})
        with self.assertRaises(Refusal) as caught:
            lines.open_line(self.conn, "research-line-20260101-old-format")
        self.assertEqual(caught.exception.code, "LINE_FORMAT_UNSUPPORTED")
        real = evidence._fetch

        def altered(conn, bundle, clause):
            head, rows = real(conn, bundle, clause)
            return head, [(path, content + b" ", stored) for path, content, stored in rows]

        with patch.object(evidence, "_fetch", altered), self.assertRaises(Refusal) as caught:
            lines.open_line(self.conn, "research-line-20260101-old-format")
        self.assertEqual(caught.exception.code, "LINE_CORRUPT")

    def test_a_research_trial_without_a_readable_start_receipt_is_ledger_damage(self):
        line = self.select()
        registration = self.registration()
        start_sha = sha(source("start"))

        def receiptless(conn, op):
            conn.rows("INSERT INTO trial (purpose, source_sha256, image_ref, instruments, input_start, trade_start, "
                      "trade_end, op_id, created_at) VALUES ('research', %s, %s, '[]', '2026-01-01', '2026-01-02', "
                      "'2026-02-01', %s, NOW())", (start_sha, RUNTIME["image_ref"], op))
            (trial_id,), = conn.rows("SELECT LAST_INSERT_ID()")
            attempt_binder(registration, start_sha)(conn, trial_id)
            return {"trial_id": trial_id}

        trial_id = db.write(self.conn, "damage", {"receipt": None}, "trial", receiptless)["record"]["trial_id"]
        with self.assertRaises(Refusal) as caught:
            lines.line_trials(self.conn, line["bundle"])
        self.assertEqual(caught.exception.code, "LEDGER_CORRUPT")
        product_bundle(self.conn, f"trial-{trial_id}-execution-start", {"execution.json": b"not json"})
        with self.assertRaises(Refusal) as caught:
            lines.line_trials(self.conn, line["bundle"])
        self.assertEqual(caught.exception.code, "LEDGER_CORRUPT")

    def test_line_trials_count_research_trials_on_the_lines_market_and_window(self):
        line = self.select()
        registration = self.registration()
        window = {"start": JAN, "trade_start": JAN + DAY, "end": JAN + 31 * DAY}
        start_sha = sha(source("start"))

        def trial(purpose="research", market_commit=MARKET_COMMIT, trial_window=window, workdir="/tmp/a"):
            binder = attempt_binder(registration, start_sha) if purpose == "research" else None
            return trials.open_trial(self.conn, purpose, start_sha, RUNTIME, inputs(market_commit), trial_window,
                                     context(source("start"), workdir), binder)["trial_id"]

        counted = trial()
        trial("precheck", workdir="/tmp/b")
        self.publish_and_register_other()
        since = db.head_commit(self.conn)
        found = lines.line_trials(self.conn, line["bundle"])
        self.assertEqual(found, {"trials": [counted], "count": 1})
        later = self.other_trial(window)
        self.assertEqual(lines.line_trials(self.conn, line["bundle"])["trials"], [counted, later])
        self.assertEqual(lines.line_trials(self.conn, line["bundle"], since_commit=since)["trials"], [later])
        self.assertEqual(lines.line_trials(self.conn, line["bundle"], at=since)["trials"], [counted])
        self.other_trial({"start": JAN, "trade_start": JAN + DAY, "end": JAN + 30 * DAY}, workdir="/tmp/d")
        self.other_trial(window, market_commit="n" * 32, workdir="/tmp/e")
        self.assertEqual(lines.line_trials(self.conn, line["bundle"])["count"], 2)
        lines.close_line(self.profile, line["bundle"], b"ema trend summary")
        successor = self.select(slug="ema-trend-again")
        own = self.other_trial(window, workdir="/tmp/f")
        self.assertEqual(lines.line_trials(self.conn, successor["bundle"])["trials"], [own],
                         "a closed line's trials stay its own")
        self.assertEqual(lines.line_trials(self.conn, line["bundle"])["trials"], [counted, later])
        for bundle in ("research-line-20260101-none", "notes"):
            with self.subTest(bundle=bundle), self.assertRaises(Refusal) as caught:
                lines.line_trials(self.conn, bundle)
            self.assertEqual(caught.exception.code, "LINE_UNKNOWN")

    def test_an_open_line_is_closed_once_at_the_head_with_its_summary(self):
        first = self.select()
        second = self.select(window_end=date(2026, 3, 1), slug="ema-trend-wider")
        head = db.head_commit(self.conn)
        tag = "line/" + first["bundle"][len("research-line-"):]
        summary = "\n# 方向\nEMA 趋势  \n# 教训\n窗口太短。\n\n".encode()
        for bad in (b"", b"  \n", b"\xff", b"x" * (lines.SUMMARY_LIMIT + 1)):
            with self.subTest(summary=bad[:8]):
                self.assertEqual(self.close_code(first["bundle"], bad), "LINE_SUMMARY_INVALID")
        closed = lines.close_line(self.profile, first["bundle"], summary)
        self.assertEqual((closed["tag"], closed["commit"], closed["replayed"]), (tag, head, False))
        self.assertEqual(self.service.sql(self.profile, "SELECT tag_hash, message FROM dolt_tags"),
                         [(head, summary.decode().strip())])
        self.assertEqual(lines.open_lines(self.conn), [second["bundle"]])
        self.assertEqual(lines.open_line(self.conn)["bundle"], second["bundle"])
        with self.assertRaises(Refusal) as caught:
            lines.open_line(self.conn, first["bundle"])
        self.assertEqual(caught.exception.code, "LINE_ENDED")
        with db.read_as_of(self.profile, head) as pinned:  # a tag on the commit read closes the line there
            self.assertEqual(lines.open_lines(pinned), [second["bundle"]])
        with db.read_as_of(self.profile, first_commit(self.service, self.profile, first["bundle"])) as pinned:
            self.assertEqual(lines.open_lines(pinned), [first["bundle"]], "open before its closing commit")
        later = self.select(window_end=date(2026, 3, 31), slug="ema-later")
        self.assertTrue(lines.close_line(self.profile, first["bundle"], summary)["replayed"], "a later head too")
        self.assertEqual(self.close_code(first["bundle"], b"another summary"), "LINE_CLOSED")
        self.assertEqual(lines.open_lines(self.conn), [second["bundle"], later["bundle"]])
        self.assertTrue(self.select(slug="ema-trend-again")["created"], "a closed line's market and window are free")
        self.assertEqual(self.close_code("research-line-20260101-none", summary), "LINE_UNKNOWN")

    def open_code(self, bundle=None) -> str:
        with self.assertRaises(Refusal) as caught:
            lines.open_line(self.conn, bundle)
        return caught.exception.code

    def close_code(self, bundle, summary) -> str:
        with self.assertRaises(Refusal) as caught:
            lines.close_line(self.profile, bundle, summary)
        return caught.exception.code

    def registration(self, name="registration-1") -> str:
        product_bundle(self.conn, name, {"research-plan.json": json.dumps({"grid": name}).encode()})
        return name

    def publish_and_register_other(self):
        strategies.publish_candidate(self.profile, source("other"), "start", "Fixture", "child", parent="start@1",
                                     difference="other rule")
        self.other = self.registration("registration-2")

    def other_trial(self, trial_window, market_commit=MARKET_COMMIT, workdir="/tmp/c"):
        # Each grid point is consumed once: a fresh registration per extra research trial.
        self.registrations = getattr(self, "registrations", 2) + 1
        bundle = self.registration(f"registration-{self.registrations}")
        return trials.open_trial(self.conn, "research", sha(source("other")), RUNTIME, inputs(market_commit),
                                 trial_window, context(source("other"), workdir),
                                 attempt_binder(bundle, sha(source("other"))))["trial_id"]


def first_commit(service, profile, bundle) -> str:
    return service.sql(profile, "SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s "
                                "AND diff_type = 'added'", (bundle,))[0][0]


if __name__ == "__main__":
    unittest.main()
