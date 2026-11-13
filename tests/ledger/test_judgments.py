"""Judgments: cited subjects, an exact basis commit on the line, single supersession, known kinds
only, and a recommendation that names every candidate of the comparison table."""

from __future__ import annotations

import unittest

from ledger import db, judgments, strategies, trials
from shared.errors import Refusal
from tests.ledger.dolt import (BINARY, RUNTIME, SKIP, Service, binder, context, coverage, grid_point, select_line,
                               sha, source, window)
from tests.helpers import refused


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
            line = select_line(conn, "a@1", "a-root", source("a"))
            cls.line, cls.line_id = line["line"], line["line_id"]
            cls.registration = grid_point(conn, cls.line_id, source("a"))
            cls.trial = trials.open_trial(conn, "research", sha(source("a")), RUNTIME, coverage(), window(),
                                          context(source("a")), binder(cls.line_id, cls.registration))
            cls.head = db.head_commit(conn)

    def add(self, kind="interpretation", **overrides):
        arguments = {"kind": kind, "line": self.line, "based_on_commit": self.head, "body": "see trial",
                     "subjects": [{"role": "about", "trial_id": self.trial["trial_id"]}],
                     "compared": lambda line, at: [], **overrides}
        return judgments.add_judgment(self.profile, **arguments)

    def code(self, **overrides) -> str:
        with self.assertRaises(Refusal) as caught:
            self.add(**overrides)
        return caught.exception.code

    def test_a_judgment_cites_its_subjects_and_a_retry_is_a_replay(self):
        subjects = [{"role": "recommended", "candidate": "a@1"}, {"role": "about", "trial_id": self.trial["trial_id"]},
                    {"role": "about", "registration_id": self.registration}]
        first = self.add("recommendation", subjects=subjects, body="a@1 is the line's best so far")
        again = self.add("recommendation", subjects=subjects, body="a@1 is the line's best so far")
        self.assertEqual((again["judgment_id"], again["replayed"], again["ledger_commit"]),
                         (first["judgment_id"], True, first["ledger_commit"]))
        rows = self.service.sql(self.profile, "SELECT role, source_sha256, trial_id, research_registration_id "
                                              "FROM judgment_subject WHERE judgment_id = %s ORDER BY seq",
                                (first["judgment_id"],))
        self.assertEqual(rows, [("recommended", sha(source("a")), None, None),
                                ("about", None, self.trial["trial_id"], None),
                                ("about", None, None, self.registration)])
        self.assertEqual(self.service.sql(self.profile, "SELECT kind, line_id FROM judgment WHERE judgment_id = %s",
                                          (first["judgment_id"],)), [("recommendation", self.line_id)])
        (op_id,), = self.service.sql(self.profile, "SELECT op_id FROM judgment WHERE judgment_id = %s",
                                     (first["judgment_id"],))
        self.assertEqual(self.code(kind="recommendation", subjects=subjects, body="other text", op_id=op_id),
                         "OP_ID_CONFLICT")
        (stored,), = self.service.sql(self.profile, "SELECT based_on_commit FROM judgment WHERE judgment_id = %s",
                                      (first["judgment_id"],))
        self.assertEqual(stored, self.head)
        self.assertEqual(self.add(based_on_commit="main", body="by branch")["replayed"], False)

    def test_basis_and_line_refusals(self):
        self.assertEqual(self.code(line="none"), "LINE_UNKNOWN")
        self.assertEqual(self.code(line=self.line_id), "LINE_UNKNOWN")
        self.assertEqual(self.code(based_on_commit=self.before_line), "COMMIT_BEFORE_LINE")
        self.assertEqual(self.code(based_on_commit="0" * 32), "COMMIT_NOT_ANCESTOR")
        self.service.sql(self.profile, "CALL DOLT_BRANCH('aside', 'main')")
        admin = self.service.admin(self.profile, branch="aside")
        try:
            with admin.cursor() as cursor:
                cursor.execute("CALL DOLT_COMMIT('--allow-empty', '-m', 'aside')")
                (aside,), = cursor.fetchall()
        finally:
            admin.close()
        self.assertEqual(self.code(based_on_commit=aside), "COMMIT_NOT_ANCESTOR")

    def test_subject_refusals(self):
        for subject, code in (({"role": "about", "candidate": "a@9"}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "candidate": "nonsense"}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "trial_id": 999_999}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "registration_id": 999_999}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "registration_id": str(self.registration)}, "SUBJECT_UNKNOWN"),
                              ({"role": "about"}, "SUBJECT_UNKNOWN"),
                              ({"role": "about", "candidate": "a@1", "trial_id": 1}, "SUBJECT_UNKNOWN"),
                              ({"role": "recommended", "trial_id": self.trial["trial_id"]}, "SUBJECT_ROLE_MISMATCH"),
                              ({"role": "control", "registration_id": self.registration}, "SUBJECT_ROLE_MISMATCH"),
                              ({"role": "boss", "candidate": "a@1"}, "SUBJECT_ROLE_MISMATCH")):
            with self.subTest(subject=subject):
                self.assertEqual(self.code(subjects=[subject]), code)

    def test_a_trial_or_registration_subject_needs_no_role_but_a_candidate_does(self):
        written = self.add(body="without a role", subjects=[{"trial_id": self.trial["trial_id"]}, {
            "role": None, "registration_id": self.registration}])  # the command line passes a missing role as None
        rows = self.service.sql(self.profile, "SELECT role, trial_id, research_registration_id FROM judgment_subject "
                                              "WHERE judgment_id = %s ORDER BY seq", (written["judgment_id"],))
        self.assertEqual(rows, [("about", self.trial["trial_id"], None), ("about", None, self.registration)])
        self.assertEqual(self.code(subjects=[{"candidate": "a@1"}]), "SUBJECT_ROLE_MISMATCH")

    def test_supersession_and_unknown_kind(self):
        first = self.add("priority", body="first")
        second = self.add("priority", body="second", supersedes=first["judgment_id"])
        self.assertEqual(self.code(kind="priority", body="third", supersedes=first["judgment_id"]),
                         "SUPERSEDES_INVALID")
        self.assertEqual(self.code(kind="search_exposure", body="Evaluated variants: 1\nx", supersedes=second["judgment_id"]),
                         "SUPERSEDES_INVALID")
        self.assertEqual(self.code(kind="priority", body="x", supersedes=10**9), "SUPERSEDES_INVALID")
        current = {row[0] for row in self.service.sql(self.profile, "SELECT judgment_id FROM judgment j WHERE "
                                                                    "kind = 'priority' AND NOT EXISTS (SELECT 1 FROM "
                                                                    "judgment n WHERE n.supersedes = j.judgment_id)")}
        self.assertEqual(current, {second["judgment_id"]})
        self.assertEqual(refused(self.add, "verdict", body="not a judgment kind").code, "DOLT_SQL_ERROR")

    def test_a_search_exposure_declares_its_variants_on_the_first_line(self):
        for body in ("x", "Evaluated variants: 01", "evaluated variants: 3", " Evaluated variants: 3",
                     "Evaluated variants: -1", "Evaluated variants: 3 views", "Notes\nEvaluated variants: 3"):
            with self.subTest(body=body):
                self.assertEqual(self.code(kind="search_exposure", body=body), "SEARCH_EXPOSURE_VARIANTS_MISSING")
        first = self.add("search_exposure", body="Evaluated variants: 0\nsignal dates only")
        self.add("search_exposure", body="Evaluated variants: 12\r\ngrid", supersedes=first["judgment_id"])
        self.add("interpretation", body="no variants line needed")
        self.assertEqual([judgments.declared_variants(body) for body in ("Evaluated variants: 7", "x", "")], [7, None, None])

    def test_a_decision_opening_is_exact_and_a_change_of_approach_names_its_chooser(self):
        for kind, body in (("priority", "Change of approach. Trials 1-5 undistinguished; chosen by the user."),
                           ("priority", "Line decision. Old line stopped; the user delegated the switch."),
                           ("priority", "Priority after trial 6: exits first"),
                           ("interpretation", "Line of the decision rule held")):
            with self.subTest(accepted=body):
                self.assertIsNone(judgments.check_decision_opening(kind, body))
        for kind, body in (("priority", "change of approach: chosen by the Agent"),
                           ("priority", "Line Decision. delegated"), ("priority", " Change of approach. chosen by the user"),
                           ("interpretation", "Change of approach. chosen by the Agent")):
            with self.subTest(kind=kind, body=body):
                self.assertEqual(self.code(kind=kind, body=body), "DECISION_OPENING_INVALID")
        self.assertEqual(self.code(kind="priority", body="Change of approach. Exits next."), "APPROACH_CHOOSER_MISSING")

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

    def test_an_oversized_body_is_refused_with_the_cause_in_the_message(self):
        with self.assertRaises(Refusal) as caught:
            self.add(body="x" * 70_000)
        self.assertEqual(caught.exception.code, "DOLT_SQL_ERROR")
        self.assertIn("too large for column", caught.exception.message)
        self.assertLess(len(caught.exception.message), 400)

    def test_a_write_landing_during_the_comparison_does_not_roll_a_recommendation_back(self):
        subjects = [{"role": "recommended", "candidate": "a@1"}]

        def compared(line, at):
            self.add(body="another session wrote while the table was read")
            return ["a@1"]

        written = self.add("recommendation", body="survives the other write", compared=compared, subjects=subjects)
        self.assertFalse(written["replayed"])

        def unread(line, at):
            raise AssertionError("the table is read only for a new recommendation with a valid line, commit and subjects")

        again = self.add("recommendation", body="survives the other write", compared=unread, subjects=subjects)
        self.assertEqual((again["judgment_id"], again["replayed"]), (written["judgment_id"], True))
        self.assertEqual(self.code(kind="recommendation", body="too old", compared=unread, subjects=subjects,
                                   based_on_commit=self.before_line), "COMMIT_BEFORE_LINE")
        self.assertEqual(self.code(kind="recommendation", body="no such", compared=unread,
                                   subjects=[{"role": "recommended", "candidate": "nobody@1"}]), "SUBJECT_UNKNOWN")
