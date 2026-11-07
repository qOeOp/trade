"""If this fails, `research unchanged` can call a line's graph the same when it is not, and the served page would show
a wrong graph with no draw to correct it: each kind of input a graph reads (its own runs, a control's review, a joining
version, a trial on its instruments, its judgments, targets and line record, a changed row, the schema) must answer
changed, and what it says is unchanged must draw equal, comparisons included. A throwaway ledger, never the active one."""

from __future__ import annotations

from datetime import date
import re
import unittest
from unittest.mock import patch

from ledger import db, judgments, lines, strategies, targets
from ledger.errors import Refusal
from qualification import availability
from registration import precheck
from replay import entry
from report import graph, seams, status
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP, market as line_market
from tests.registration.world import RUNNER_ARGV, capture, config, source
from tests.replay.world import ReplayWorld, registered_grid
from tests.report.test_reports import CANDIDATE_RETURNS, FINGERPRINT, OUTCOMES, market_returns


@unittest.skipUnless(BINARY, SKIP)
class UnchangedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("unchanged")
        cls.addClassCleanup(world.close)
        cls.market = seams.use(market_returns=market_returns)
        cls.market.__enter__()
        cls.addClassCleanup(cls.market.__exit__, None, None, None)
        world.fingerprint = FINGERPRINT
        (cls.control_ref,) = registered_grid(world, ["control"], "registration-root")
        cls.control = entry.run(world.profile, world.market, MARKET_COMMIT, cls.control_ref, None, RUNNER_ARGV, hypothesis="registration-root")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.control["trial_id"]}])
        child = world.publish("child", parent=cls.control_ref, difference="widen the stop")
        cls.child_ref, cls.child_source = child["candidate"], child["source"]
        mechanism = [{"slice": "trade_structure", "measure": "win_rate", "direction": "up", "duty": "F3", "reason": "fixture"}]
        world.register("registration-child", world.body(
            [cls.child_ref], {cls.child_ref: world.prechecked(child["source"])}, parent=cls.control_ref,
            control_trial_id=cls.control["trial_id"], duties=["F3"], prediction={"mechanism": mechanism, "outcomes": dict(OUTCOMES)}))
        world.scenario = {"returns": CANDIDATE_RETURNS}
        cls.child = entry.run(world.profile, world.market, MARKET_COMMIT, cls.child_ref, None, RUNNER_ARGV, hypothesis="registration-child")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.child["trial_id"]}])
        world.scenario = {}
        cls.line = world.line["bundle"]
        cls.other_line = lines.select_line(world.conn, "market", MARKET_COMMIT, date(2026, 2, 1), date(2026, 3, 1), cls.control_ref,
                                           slug="other-window", market=line_market(latest_complete_day=date(2026, 3, 31)),
                                           reviews=availability.review_records)["bundle"]

    def head(self) -> str:
        with db.read_as_of(self.world.profile) as conn:
            return db.head_commit(conn)

    def drawn(self, at: str) -> dict:
        found = graph.research_graph(self.world.profile, self.line, at, workers=1)
        return {**found, "scope": {**found["scope"], "ledger_commit": None}}

    def answers(self, since: str, unchanged: bool, same: bool | None = None) -> None:
        """What `unchanged_since` says and whether the two draws agree; `same` only where a change that draws the same
        is expected to answer changed, which costs a draw and shows no wrong graph."""
        found = graph.unchanged_since(self.world.profile, self.line, since)
        self.assertEqual(found["unchanged"], unchanged, found["reason"])
        self.assertEqual(self.drawn(since) == self.drawn(found["ledger_commit"]), unchanged if same is None else same, found["reason"])

    def sql(self, *statements: str) -> None:
        conn = self.world.service.admin(self.world.profile)
        try:
            with conn.cursor() as cursor:
                for statement in statements:
                    cursor.execute(statement)
        finally:
            conn.close()

    def unrelated(self, tag: str) -> bytes:
        """A version of a strategy no line draws: one strategy id joins its versions into one lineage."""
        data = source(tag)
        strategies.publish_candidate(self.world.profile, data, f"other-{tag}", "Fixture", f"variant {tag}")
        return data

    def sealed_precheck(self, tag: str, **options) -> int:
        data = self.unrelated(tag)
        trial_id = self.world.open_precheck(data, **options)
        capture(self.world.conn, trial_id, data)
        return trial_id

    def reviewed_trial(self, ref: str) -> int:
        with db.read_as_of(self.world.profile) as conn:
            (sha,), = conn.rows("SELECT source_sha256 FROM candidate WHERE CONCAT(strategy_id, '@', revision) = %s", (ref,))
            (trial_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s", (sha,))
        return trial_id

    def test_a_line_is_unchanged_at_its_own_commit(self):
        head = self.head()
        self.assertEqual(graph.unchanged_since(self.world.profile, self.line, head, head),
                         {"unchanged": True, "reason": None, "since": head, "ledger_commit": head})

    def test_a_graph_reads_no_table_the_check_skips(self):
        """Every table a draw, comparisons included, reads is one a changed row of answers changed; this is what the
        list of skipped tables stands on. The evidence it reads is named here too: anything else needs a rule."""
        read: set[str] = set()
        bundles: set[str] = set()
        real = db.LedgerConnection.rows, db.LedgerConnection.dicts

        def watching(method):
            def traced(conn, statement, *params):
                read.update(name.lower() for name in re.findall(r"\b(?:FROM|JOIN)\s+`?([A-Za-z_0-9]+)", statement))
                if params and re.search(r"\bbundle\b", statement):
                    bundles.update(p for p in (params[0] if isinstance(params[0], (list, tuple)) else params) if isinstance(p, str))
                return method(conn, statement, *params)
            return traced

        with patch.object(db.LedgerConnection, "rows", watching(real[0])), patch.object(db.LedgerConnection, "dicts", watching(real[1])):
            graph.research_graph(self.world.profile, self.line, workers=1)
        self.assertIn("run_return", read, "the trace saw the comparison's reads")
        self.assertEqual(read & graph._UNREAD, set())
        kinds = re.compile(r"trial-.*|source-review-.*|research-line-.*|registration-.*|research-plan\.json|source-review\.json|.*manifest.*|.*\.json")
        self.assertEqual({bundle for bundle in bundles if not kinds.fullmatch(bundle)}, set())

    def test_an_unrelated_version_changes_nothing(self):
        since = self.head()
        self.unrelated("unrelated")
        self.answers(since, True)

    def test_a_review_of_another_source_changes_nothing(self):
        trial_id = self.sealed_precheck("elsewhere")
        since = self.head()
        precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")
        self.answers(since, True)

    def test_a_trial_on_its_instruments_changes_the_counts(self):
        since = self.head()
        self.sealed_precheck("overlapping")
        self.answers(since, False)

    def test_a_trial_on_another_instrument_changes_nothing(self):
        since = self.head()
        self.sealed_precheck("other-symbol", identity_overrides={"symbols": ["ZZZUSDT"]}, effective_config=config(
            symbols=["ZZZUSDT"], start="2026-01-05T00:00:00Z", trade_start="2026-01-06T00:00:00Z", end="2026-01-08T00:00:00Z"))
        self.answers(since, True)

    def test_a_version_joining_the_line_is_a_change(self):
        since = self.head()
        self.world.publish("grandchild", parent=self.child_ref, difference="again")
        self.answers(since, False)

    def test_y_a_review_of_the_line_or_its_control_is_a_change(self):
        for ref in (self.control_ref, self.child_ref):
            with self.subTest(ref):
                since = self.head()
                precheck.record_review(self.world.profile, self.world.review_body(self.reviewed_trial(ref), "failed", api={
                    "status": "failed", "note": "it calls an unknown API"}), f"reviewer-{ref}")
                self.answers(since, False)

    def judge(self, line: str) -> None:
        judgments.add_judgment(self.world.profile, "interpretation", line, self.head(), "fixture",
                               subjects=[{"role": "about", "trial_id": self.child["trial_id"]}],
                               compared=lambda name, at: status.compared_candidates(self.world.profile, name, at))

    def test_only_this_line_s_judgment_is_a_change(self):
        since = self.head()
        self.judge(self.other_line)
        self.answers(since, True)
        since = self.head()
        self.judge(self.line)
        self.answers(since, False)

    def test_targets_and_a_new_line_answer_changed(self):
        since = self.head()
        with db.connect(self.world.profile, "writer") as conn:
            targets.set_targets(conn, self.line, 0.15, 0.2)
        self.answers(since, False)
        since = self.head()
        with db.connect(self.world.profile, "writer") as conn:
            targets.set_targets(conn, self.other_line, 0.15, 0.2)
        self.answers(since, False, same=True)
        since = self.head()
        lines.select_line(self.world.conn, "market", MARKET_COMMIT, date(2026, 2, 2), date(2026, 3, 1), self.control_ref, slug="third",
                          market=line_market(latest_complete_day=date(2026, 3, 31)), reviews=availability.review_records)
        self.answers(since, False, same=True)

    def test_an_explore_trial_anywhere_answers_changed(self):
        since = self.head()
        trial_id = self.sealed_precheck("explored", identity_overrides={"symbols": ["ZZZUSDT"]}, effective_config=config(
            symbols=["ZZZUSDT"], start="2026-01-05T00:00:00Z", trade_start="2026-01-06T00:00:00Z", end="2026-01-08T00:00:00Z"))
        self.assertEqual(graph.unchanged_since(self.world.profile, self.line, since)["unchanged"], True)
        self.sql(f"UPDATE trial SET purpose = 'explore' WHERE trial_id = {trial_id}",
                 "CALL DOLT_COMMIT('-a', '-m', 'tamper: an explore trial', '--skip-verification')")
        found = graph.unchanged_since(self.world.profile, self.line, since)
        self.assertEqual((found["unchanged"], found["reason"]), (False, f"trial of trial {trial_id} reaches the line"))

    def test_a_file_failing_its_hash_is_never_reused_past(self):
        """A review of nothing on the line still refuses a draw when its bytes fail their hash (the schema's generated
        hash makes real damage hard to stage, so the hash here is what says so)."""
        trial_id = self.sealed_precheck("damaged", identity_overrides={"symbols": ["ZZZUSDT"]}, effective_config=config(
            symbols=["ZZZUSDT"], start="2026-01-05T00:00:00Z", trade_start="2026-01-06T00:00:00Z", end="2026-01-08T00:00:00Z"))
        since = self.head()
        bundle = precheck.record_review(self.world.profile, self.world.review_body(trial_id), "reviewer-b")["bundle"]
        self.assertTrue(graph.unchanged_since(self.world.profile, self.line, since)["unchanged"])
        with patch.object(graph, "hashlib") as hashing:
            hashing.sha256.return_value.hexdigest.return_value = "0" * 64
            found = graph.unchanged_since(self.world.profile, self.line, since)
        self.assertEqual((found["unchanged"], found["reason"]), (False, f"{bundle}/{precheck.REVIEW_FILE} differs from its content hash"))

    def test_zz_a_changed_or_deleted_row_or_table_answers_changed_and_a_refusal_stays_one(self):
        since = self.head()
        self.sql("UPDATE candidate SET description = 'rewritten' WHERE description LIKE 'variant unrelated%'",
                 "CALL DOLT_COMMIT('-a', '-m', 'tamper: a row', '--skip-verification')")
        found = graph.unchanged_since(self.world.profile, self.line, since)
        self.assertEqual((found["unchanged"], found["reason"]), (False, "a row of candidate was deleted or modified"))
        since = self.head()
        self.sql("ALTER TABLE candidate ADD COLUMN extra INT", "CALL DOLT_COMMIT('-a', '-m', 'tamper: a table', '--skip-verification')")
        found = graph.unchanged_since(self.world.profile, self.line, since)
        self.assertEqual((found["unchanged"], found["reason"]), (False, "the table candidate itself changed"))
        with patch.object(db, "READABLE_VERSIONS", frozenset()), self.assertRaises(Refusal) as refused:
            graph.unchanged_since(self.world.profile, self.line, since)
        self.assertEqual(refused.exception.code, "SCHEMA_MISMATCH")


if __name__ == "__main__":
    unittest.main()
