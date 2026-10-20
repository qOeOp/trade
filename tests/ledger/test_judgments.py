"""Judgments: cited subjects, an exact basis commit on the line, single supersession, no cadence
judgment, and a recommendation that names every candidate of the comparison table."""

from __future__ import annotations

from datetime import date
import json
import unittest

from ledger import db, judgments, lines, strategies, trials
from ledger.errors import Refusal
from tests.ledger.dolt import (BINARY, RUNTIME, SKIP, Service, attempt_binder, context, inputs, market,
                               product_bundle, reviewed, sha, source, window)


@unittest.skipUnless(BINARY, SKIP)
class JudgmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = Service()
        cls.addClassCleanup(cls.service.close)
        cls.profile = cls.service.ledger("judgments")
        strategies.publish_candidate(cls.profile, source("a"), "a", "Fixture", "root")
        with db.connect(cls.profile, "writer") as conn:
            cls.before_line = db.head_commit(conn)
            cls.line = lines.select_line(conn, "market", "main", date(2026, 1, 2), date(2026, 2, 1), "a@1",
                                         market=market(), reviews=reviewed(source("a")))["bundle"]
            plan = {"research-plan.json": json.dumps({"grid": "a"}).encode()}
            product_bundle(conn, "registration-a", plan)
            product_bundle(conn, "registration-unused", plan)
            cls.trial = trials.open_trial(conn, "research", sha(source("a")), RUNTIME, inputs(), window(),
                                          context(source("a")), attempt_binder("registration-a", sha(source("a"))))
            cls.head = db.head_commit(conn)

    def add(self, kind="interpretation", **overrides):
        arguments = {"kind": kind, "line_bundle": self.line, "based_on_commit": self.head, "body": "see trial",
                     "subjects": [{"role": "about", "trial_id": self.trial["trial_id"]}],
                     "compared": lambda line, at: [], **overrides}
        return judgments.add_judgment(self.profile, **arguments)

    def code(self, **overrides) -> str:
        with self.assertRaises(Refusal) as caught:
            self.add(**overrides)
        return caught.exception.code

    def test_a_judgment_cites_its_subjects_and_a_retry_is_a_replay(self):
        subjects = [{"role": "recommended", "candidate": "a@1"}, {"role": "about", "trial_id": self.trial["trial_id"]},
                    {"role": "about", "registration_bundle": "registration-a"}]
        first = self.add("recommendation", subjects=subjects, body="a@1 is the line's best so far")
        again = self.add("recommendation", subjects=subjects, body="a@1 is the line's best so far")
        self.assertEqual((again["judgment_id"], again["replayed"], again["ledger_commit"]),
                         (first["judgment_id"], True, first["ledger_commit"]))
        rows = self.service.sql(self.profile, "SELECT role, strategy_id, revision, trial_id, registration_bundle "
                                              "FROM judgment_subject WHERE judgment_id = %s ORDER BY seq",
                                (first["judgment_id"],))
        self.assertEqual(rows, [("recommended", "a", 1, None, None),
                                ("about", None, None, self.trial["trial_id"], None),
                                ("about", None, None, None, "registration-a")])
        (op_id,), = self.service.sql(self.profile, "SELECT op_id FROM judgment WHERE judgment_id = %s",
                                     (first["judgment_id"],))
        self.assertEqual(self.code(kind="recommendation", subjects=subjects, body="other text", op_id=op_id),
                         "OP_ID_CONFLICT")
        (stored,), = self.service.sql(self.profile, "SELECT based_on_commit FROM judgment WHERE judgment_id = %s",
                                      (first["judgment_id"],))
        self.assertEqual(stored, self.head)
        self.assertEqual(self.add(based_on_commit="main", body="by branch")["replayed"], False)

    def test_basis_and_line_refusals(self):
        self.assertEqual(self.code(line_bundle="research-line-99"), "LINE_UNKNOWN")
        self.assertEqual(self.code(line_bundle="registration-a"), "LINE_UNKNOWN")
        self.assertEqual(self.code(based_on_commit=self.before_line), "COMMIT_BEFORE_LINE")
        self.assertEqual(self.code(based_on_commit="0" * 32), "COMMIT_NOT_ANCESTOR")
        self.service.sql(self.profile, "CALL DOLT_BRANCH('aside', 'main')")
        admin = self.service.admin(self.profile, branch="aside")
        try:
            with admin.cursor() as cursor:
                cursor.execute("CALL DOLT_COMMIT('--allow-empty', '-m', 'aside', '--skip-verification')")
                (aside,), = cursor.fetchall()
        finally:
            admin.close()
        self.assertEqual(self.code(based_on_commit=aside), "COMMIT_NOT_ANCESTOR")

    def test_subject_refusals(self):
        for subject, code in (({"role": "about", "candidate": "a@9"}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "candidate": "nonsense"}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "trial_id": 999_999}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "registration_bundle": "registration-unused"}, "SUBJECT_UNKNOWN"),
                              ({"role": "about"}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "candidate": "a@1", "trial_id": 1}, "SUBJECT_UNKNOWN"),
                              ({"role": "recommended", "trial_id": self.trial["trial_id"]}, "SUBJECT_ROLE_MISMATCH"),
                              ({"role": "control", "registration_bundle": "registration-a"}, "SUBJECT_ROLE_MISMATCH"),
                              ({"role": "boss", "candidate": "a@1"}, "SUBJECT_ROLE_MISMATCH")):
            with self.subTest(subject=subject):
                self.assertEqual(self.code(subjects=[subject]), code)

    def test_supersession_and_no_cadence_judgment(self):
        first = self.add("priority", body="first")
        second = self.add("priority", body="second", supersedes=first["judgment_id"])
        self.assertEqual(self.code(kind="priority", body="third", supersedes=first["judgment_id"]),
                         "SUPERSEDES_INVALID")
        self.assertEqual(self.code(kind="search_exposure", body="x", supersedes=second["judgment_id"]),
                         "SUPERSEDES_INVALID")
        self.assertEqual(self.code(kind="priority", body="x", supersedes=10**9), "SUPERSEDES_INVALID")
        current = {row[0] for row in self.service.sql(self.profile, "SELECT judgment_id FROM v_judgments "
                                                                    "WHERE kind = 'priority'")}
        self.assertEqual(current, {second["judgment_id"]})
        self.assertEqual(self.code(kind="review_cadence", body="review every 10"), "REVIEW_CADENCE_FIXED")
        with self.assertRaises(Refusal) as caught:
            self.add("verdict", body="not a judgment kind")
        self.assertEqual(caught.exception.code, "DOLT_SQL_ERROR")


    def test_a_recommendation_names_every_candidate_of_the_comparison_table(self):
        strategies.publish_candidate(self.profile, source("b"), "b", "Fixture", "another root")
        table = []

        def compared(line, at):
            table.append((line, at))
            return ["a@1", "b@1"]

        exc = None
        with self.assertRaises(Refusal) as caught:
            self.add("recommendation", body="only a", compared=compared,
                     subjects=[{"role": "recommended", "candidate": "a@1"}])
        exc = caught.exception
        self.assertEqual((exc.code, exc.missing), ("RECOMMENDATION_INCOMPLETE", ("b@1",)))
        self.assertEqual(table, [(self.line, self.head)], "the table at the commit the recommendation reads")
        written = self.add("recommendation", body="a over b", compared=compared,
                           subjects=[{"role": "recommended", "candidate": "a@1"}, {"role": "about", "candidate": "b@1"}])
        self.assertFalse(written["replayed"])

if __name__ == "__main__":
    unittest.main()
