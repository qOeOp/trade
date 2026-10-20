"""Research lines: append-only numbered records, exact reads, and the trials that belong to a line."""

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
                     "market": market(), "reviews": reviewed(source("start")), **overrides}
        return lines.select_line(self.conn, **arguments)

    def code(self, **overrides) -> str:
        with self.assertRaises(Refusal) as caught:
            self.select(**overrides)
        return caught.exception.code

    def test_lines_are_numbered_appended_and_read_back(self):
        self.assertIsNone(lines.current_line(self.conn))
        before = db.head_commit(self.conn)
        first = self.select()
        self.assertEqual((first["bundle"], first["line_no"], first["market_commit"], first["created"]),
                         ("research-line-1", 1, MARKET_COMMIT, True))
        again = self.select()
        self.assertEqual((again["bundle"], again["created"], again["content_sha256"]),
                         ("research-line-1", False, first["content_sha256"]))
        second = self.select(window_end=date(2026, 3, 1), note=None)
        self.assertEqual(second["bundle"], "research-line-2")
        current = lines.current_line(self.conn)
        self.assertEqual((current["line_no"], current["window_start"], current["window_end"], current["start"],
                          current["start_sha256"], current["universe_rule"], current["note"]),
                         (2, "2026-01-02", "2026-03-01", "start@1", sha(source("start")), "pool-v1", None))
        self.assertEqual(lines.current_line(self.conn, at=first_commit(self.service, self.profile, "research-line-1"))
                         ["line_no"], 1)
        self.assertIsNone(lines.current_line(self.conn, at=before))
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
        self.assertEqual(self.select(market=market(latest_complete_day=date(2026, 1, 31)))["line_no"], 1)
        with patch.object(lines, "current_line", return_value=None):
            self.assertEqual(self.code(note="another choice"), "LINE_CONFLICT")

    def test_an_agent_cannot_forge_a_research_line(self):
        line = self.select()
        work = Path(tempfile.mkdtemp(prefix="ll-", dir="/tmp"))
        self.addCleanup(__import__("shutil").rmtree, work, ignore_errors=True)
        (work / "research-line.json").write_text(json.dumps({"format": "research-line-v1", "line_no": 7,
                                                             "start": "forged@1"}))
        for name in ("research-line-7", "research-line-07"):
            with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                evidence.add_bundle(self.conn, name, [work / "research-line.json"])
            self.assertEqual(caught.exception.code, "RESERVED_BUNDLE")
        self.assertEqual(lines.current_line(self.conn)["bundle"], line["bundle"])

    def test_damaged_line_records_are_refused_on_read(self):
        product_bundle(self.conn, "research-line-7", {"other.json": b"{}"})
        with self.assertRaises(Refusal) as caught:
            lines.current_line(self.conn)
        self.assertEqual(caught.exception.code, "LINE_CORRUPT")
        product_bundle(self.conn, "research-line-8", {"research-line.json": json.dumps({"format": "v0"}).encode()})
        with self.assertRaises(Refusal) as caught:
            lines.current_line(self.conn)
        self.assertEqual(caught.exception.code, "LINE_FORMAT_UNSUPPORTED")
        real = evidence._fetch

        def altered(conn, bundle, clause):
            head, rows = real(conn, bundle, clause)
            return head, [(path, content + b" ", stored) for path, content, stored in rows]

        with patch.object(evidence, "_fetch", altered), self.assertRaises(Refusal) as caught:
            lines.current_line(self.conn)
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
        for bundle in ("research-line-9", "notes"):
            with self.subTest(bundle=bundle), self.assertRaises(Refusal) as caught:
                lines.line_trials(self.conn, bundle)
            self.assertEqual(caught.exception.code, "LINE_UNKNOWN")

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
