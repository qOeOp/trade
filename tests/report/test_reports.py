"""Qualification and the report readers on sealed runs of a throwaway ledger: a root control run and a
derived candidate run, each through the replay entry with a stand-in runtime, plus a run without a
semantic fingerprint and an invalid one. Never the active ledger."""

from __future__ import annotations

from datetime import date, timedelta
import json
from pathlib import Path
import shutil
import unittest

from ledger import db, metrics, strategies
from ledger.errors import Refusal
from qualification import availability
from registration import duties, precheck, register
from replay import entry, reproduce
from report import attribution, candidates, comparison, runs, seams, status
from tests.ledger.dolt import BINARY, MARKET_COMMIT, SKIP
from tests.registration.world import OUTCOMES, RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid


FINGERPRINT = {"fills": {"rows": 2, "sha256": "1" * 64}, "orders": {"rows": 2, "sha256": "2" * 64}}
CANDIDATE_RETURNS = [0.002, -0.001, 0.0015, -0.0005, 0.001]
DAYS = [(date(2026, 1, 1) + timedelta(days=k)).isoformat() for k in range(31)]


def market_returns(market_database, commit, universe_rule, start, end) -> dict:
    """A market stand-in: the basket and BTC daily returns over January 2026."""
    return {"days": list(DAYS), "basket": [0.01 * ((k % 4) - 1.5) for k in range(31)],
            "btc": [0.005 * ((k % 3) - 1) for k in range(31)], "members_per_day": [2] * 31}


def refused(function, *args, **kwargs) -> Refusal:
    try:
        function(*args, **kwargs)
    except Refusal as exc:
        return exc
    raise AssertionError("no refusal")


@unittest.skipUnless(BINARY, SKIP)
class ReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("report")
        cls.addClassCleanup(world.close)
        cls.market = seams.use(market_returns=market_returns)
        cls.market.__enter__()
        cls.addClassCleanup(cls.market.__exit__, None, None, None)
        world.fingerprint = FINGERPRINT
        (cls.control_ref,) = registered_grid(world, ["control"], "registration-root")
        cls.control = cls.replay(cls.control_ref, "registration-root")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.control["trial_id"]}])
        child = world.publish("child", parent=cls.control_ref, difference="widen the stop")
        cls.child_ref = child["candidate"]
        mechanism = [{"slice": "trade_structure", "measure": "win_rate", "direction": "up", "duty": "F3",
                      "reason": "a wider stop is hit less often"},
                     {"slice": "by_period", "measure": "months_won_share", "direction": "down", "duty": "F3",
                      "reason": "fixture"},
                     {"slice": None, "measure": None, "direction": "up", "duty": "F3", "reason": "no slice measures it"}]
        body = world.body([cls.child_ref], {cls.child_ref: world.prechecked(child["source"])}, parent=cls.control_ref,
                          control_run=cls.control["run_id"], change="widen the stop", duties=["F3"],
                          prediction={"mechanism": mechanism, "outcomes": dict(OUTCOMES)})
        world.register("registration-child", body)
        world.scenario = {"returns": CANDIDATE_RETURNS}
        cls.candidate = cls.replay(cls.child_ref, "registration-child")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.candidate["trial_id"]}])
        world.scenario = {}
        # A passed run without economic evidence: a later independent review fails its source.
        (cls.bare_ref,) = registered_grid(world, ["bare"], "registration-bare")
        cls.bare = cls.replay(cls.bare_ref, "registration-bare")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.bare["trial_id"]}])
        with db.read_as_of(world.profile) as conn:
            source_sha256 = strategies.read_candidate(conn, cls.bare_ref)["source_sha256"]
            (trial_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s",
                                     (source_sha256,))
        precheck.record_review(world.profile, world.review_body(trial_id, "failed", api={
            "status": "failed", "note": "it calls an unknown API"}), "reviewer-b")
        world.scenario = {"audit_passed": False, "findings": ["fill F-1 unmatched"], "audit_exit": 1}
        (cls.bad_ref,) = registered_grid(world, ["bad"], "registration-bad")
        cls.bad = cls.replay(cls.bad_ref, "registration-bad")
        world.scenario = {}

    @classmethod
    def replay(cls, ref: str, bundle: str) -> dict:
        return entry.run(cls.world.profile, cls.world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV, hypothesis=bundle)

    def setUp(self):
        self.world = self.__class__.world
        self.profile = self.world.profile

    def assess(self, run_id: int) -> dict:
        with db.read_as_of(self.profile) as conn:
            return availability.assess(conn, {"run_id": run_id})

    # Qualification

    def test_a_clean_fingerprinted_run_is_economic_evidence_under_a_named_check(self):
        self.assertEqual((self.control["status"], self.bare["status"], self.bad["status"]),
                         ("passed", "passed", "invalid"))
        value = self.assess(self.control["run_id"])
        self.assertEqual((value["economic_evidence_available"], value["reasons"]), (True, []))
        self.assertEqual(value["checker"]["check"], availability.CHECK)
        self.assertEqual(set(value["checker"]), {"check", "metrics_revision", "checker_source_sha256"})
        self.assertEqual((value["activity"]["fills"], value["activity"]["orders"]), (2, 2))
        self.assertEqual((value["source_check"]["status"], value["execution_capture"]["status"]), ("passed", "captured"))
        self.assertTrue(value["source_check"]["reviews"][0]["ledger_commit"])

    def test_a_run_of_a_failed_source_or_with_a_failed_audit_is_not_evidence(self):
        bare = self.assess(self.bare["run_id"])
        self.assertFalse(bare["economic_evidence_available"])
        self.assertTrue(any(reason.startswith("SOURCE_REVIEW_FAILED") for reason in bare["reasons"]))
        bad = self.assess(self.bad["run_id"])
        self.assertTrue(bad["reasons"][0].startswith("RUN_INVALID: ") and "AUDIT" in bad["reasons"][0])
        with db.read_as_of(self.profile) as conn:
            exc = refused(availability.require, conn, {"run_id": self.bare["run_id"]})
        self.assertEqual((exc.code, exc.missing[0]), ("ECONOMIC_EVIDENCE_UNAVAILABLE", str(self.bare["run_id"])))
        self.assertEqual(exc.availability["reasons"], bare["reasons"])

    def test_a_failed_review_of_the_source_disqualifies_its_runs(self):
        with db.read_as_of(self.profile) as conn:
            source_sha256 = strategies.read_candidate(conn, self.bare_ref)["source_sha256"]
            (trial_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s",
                                     (source_sha256,))
        body = self.world.review_body(trial_id, "failed", api={"status": "failed", "note": "it calls an unknown API"})
        precheck.record_review(self.profile, body, "reviewer-c")
        value = self.assess(self.bare["run_id"])
        self.assertEqual(value["source_check"]["status"], "failed")
        self.assertTrue(any(reason.startswith("SOURCE_REVIEW_FAILED") for reason in value["reasons"]))

    def test_native_reasons_name_failing_and_unrecorded_facts(self):
        report = {"activity": {"real_fills@1": {"passed": False, "code": "NO_FILLS"}}}
        found = availability.native_reasons(report)
        self.assertTrue(found[0].startswith("NO_FILLS: real_fills@1"))
        self.assertIn("NOT_EVALUATED: cycles_reconcile_audit@1", found)

    # The single-run report and the drill-down

    def test_the_single_run_report_follows_the_catalogue_behind_the_qualification_view(self):
        report = runs.run_report(self.profile, self.control["run_id"])
        headline = report["headline"]
        self.assertAlmostEqual(headline["annual_return@1"]["value"], 1.000098 ** (365 / 31) - 1, places=12)
        self.assertEqual(headline["mark_max_drawdown@2"]["population"], "bars")
        bridge = next(item for item in report["slices"] if item["id"] == "profit_bridge")["measures"]
        self.assertEqual([bridge[f"{name}@1"]["value"] for name in ("price", "fee", "funding", "open_mark", "account")],
                         ["10.00000000", "-0.20000000", "0.00000000", "0.00000000", "9.80000000"])
        self.assertEqual([item["id"] for item in report["slices"]],
                         ["profit_bridge", "capital_scaled", "fee_stress", "by_instrument", "market_exposure",
                          "by_period", "by_regime", "trade_structure", "drawdown"], "trade pairs are comparison only")
        exposure = next(item for item in report["slices"] if item["id"] == "market_exposure")["measures"]
        self.assertIsNotNone(exposure["beta_basket@1"]["value"])
        self.assertEqual(report["closed_by_year"]["2026"]["closed_trades"], 1)
        self.assertEqual(report["cost_basis"]["taker_fill_share"], 0.5)
        self.assertEqual(report["availability"]["economic_evidence_available"], True)
        bare = runs.run_report(self.profile, self.bare["run_id"])
        self.assertEqual((bare["headline"], bare["slices"], bare["cost_basis"]), (None, None, None))
        self.assertEqual(bare["populations"]["fills"], 2, "diagnostics stay")
        bad = runs.run_report(self.profile, self.bad["run_id"])
        self.assertEqual((bad["status"], bad["headline"]), ("invalid", None))
        self.assertTrue(bad["failure_reasons"])

    def test_a_run_without_evidence_shows_no_money_in_its_activity_facts(self):
        bare = runs.run_report(self.profile, self.bare["run_id"])
        compounding = bare["activity"]["returns_compound_to_equity@1"]
        self.assertEqual(compounding, {"passed": True, "code": None})
        self.assertEqual(bare["activity"]["real_fills@1"], {"passed": True, "code": None, "count": 2})
        self.assertNotIn("100009.8", json.dumps(bare, default=str), "neither the final nor the compounded equity")
        shown = runs.run_report(self.profile, self.control["run_id"])
        self.assertEqual(shown["activity"]["returns_compound_to_equity@1"]["final_equity"], "100009.80000000")

    def test_a_report_reads_an_exact_ledger_version(self):
        with db.read_as_of(self.profile) as conn:
            before = conn.rows("SELECT to_commit FROM dolt_diff_run WHERE to_run_id = %s AND diff_type = 'added'",
                               (self.candidate["run_id"],))[0][0]
            parent = conn.rows("SELECT parent_hash FROM dolt_commit_ancestors WHERE commit_hash = %s", (before,))[0][0]
        self.assertEqual(refused(runs.run_report, self.profile, self.candidate["run_id"], parent).code, "UNKNOWN_RUN")
        self.assertEqual(runs.run_report(self.profile, self.control["run_id"], parent)["ledger_commit"], parent)
        self.assertEqual(refused(runs.run_report, self.profile, self.control["run_id"], "no-such-tag").code,
                         "UNKNOWN_REF")

    def test_tables_give_the_cycles_and_series_and_native_detail_only_from_a_verified_reproduction(self):
        found = runs.tables(self.control["run_id"], self.profile)
        self.assertEqual((len(found["positions"]), len(found["daily_returns"])), (1, 31))
        self.assertEqual(found["reconciled"]["realized_pnl_usdt"], "9.80000000")
        self.assertIsNone(found["orders"])
        self.assertEqual(refused(runs.tables, self.bad["run_id"], self.profile).code, "RUN_NOT_PASSED")
        self.assertEqual(refused(runs.tables, self.bare["run_id"], self.profile).code, "ECONOMIC_EVIDENCE_UNAVAILABLE")
        done = reproduce.reproduce(self.control["run_id"], self.world.output("drill"), ledger=self.profile,
                                   market=self.world.market)
        directory = Path(done["directory"])
        detail = runs.tables(self.control["run_id"], self.profile, directory=directory, account=True,
                             reproduction=done["trial_id"])
        self.assertEqual([fill["cycle_position_id"] for fill in detail["fills"]], ["AAAUSDT-PERP.BINANCE-P"] * 2)
        self.assertEqual((len(detail["account"]), detail["reproduction"]), (3, done["trial_id"]))
        exc = refused(runs.tables, self.control["run_id"], self.profile, directory=directory)
        self.assertEqual((exc.code, exc.missing), ("REPRODUCTION_MISMATCH", ("reproduction",)),
                         "no native detail without the reproduction trial")
        fills = directory / "reports" / "fills.csv"
        fills.write_text(fills.read_text().replace(",100,", ",99,"))
        exc = refused(runs.tables, self.control["run_id"], self.profile, directory=directory,
                      reproduction=done["trial_id"])
        self.assertEqual((exc.code, exc.missing), ("REPRODUCTION_MISMATCH", ("reports/fills.csv",)))

    def test_a_forged_directory_is_no_reproduction(self):
        """An exploration of another source with its own (matching) fingerprint and edited fill prices."""
        explored = entry.explore(self.profile, self.world.market, MARKET_COMMIT,
                                 self.world.strategy_file(b"from nautilus_trader.trading import Strategy\n\n\nclass "
                                                          b"Fixture(Strategy):\n    pass\n# forge\n", "forge.py"),
                                 "Fixture", self.world.output("forge"), None, RUNNER_ARGV + ["--symbols", "AAAUSDT"])
        directory = Path(explored["path"])
        fills = directory / "reports" / "fills.csv"
        fills.write_text(fills.read_text().replace(",100,", ",999999,"))
        with db.read_as_of(self.profile) as conn:
            (explore_trial,), = conn.rows("SELECT MAX(trial_id) FROM trial WHERE purpose = 'explore'")
        for reproduction in (None, explore_trial, self.control["trial_id"], 999_999):
            with self.subTest(reproduction=reproduction):
                self.assertEqual(refused(runs.tables, self.control["run_id"], self.profile, directory=directory,
                                         reproduction=reproduction).code, "REPRODUCTION_MISMATCH")

    def test_an_exploration_directory_reads_with_the_sealed_functions_marked_unverified(self):
        explored = entry.explore(self.profile, self.world.market, MARKET_COMMIT,
                                 self.world.strategy_file(b"from nautilus_trader.trading import Strategy\n\n\nclass "
                                                          b"Fixture(Strategy):\n    pass\n# draft\n", "draft.py"),
                                 "Fixture", self.world.output("draft"), None, RUNNER_ARGV + ["--symbols", "AAAUSDT"])
        found = explored["metrics"]
        self.assertTrue(found["exploration"])
        self.assertEqual(found["availability"]["unverified"], runs.UNVERIFIED)
        sealed = runs.run_report(self.profile, self.control["run_id"])
        self.assertEqual(found["headline"]["annual_return@1"]["value"], sealed["headline"]["annual_return@1"]["value"])
        self.assertIn(runs.UNVERIFIED, found["limitations"])

    def test_a_directory_whose_audit_failed_is_masked_with_the_reason(self):
        self.world.scenario = {"audit_passed": False, "findings": ["fill F-1 unmatched"]}
        try:
            explored = entry.explore(self.profile, self.world.market, MARKET_COMMIT,
                                     self.world.strategy_file(b"from nautilus_trader.trading import Strategy\n\n\nclass "
                                                              b"Fixture(Strategy):\n    pass\n# failed audit\n",
                                                              "failed.py"),
                                     "Fixture", self.world.output("failed-audit"), None,
                                     RUNNER_ARGV + ["--symbols", "AAAUSDT"])
        finally:
            self.world.scenario = {}
        found = runs.directory_report(Path(explored["path"]), account=True)
        self.assertFalse(found["availability"]["economic_evidence_available"])
        self.assertTrue(any(item.startswith("AUDIT_FAILED") for item in found["availability"]["reasons"]))
        self.assertEqual((found["headline"], found["slices"], found["account"]), (None, None, None))
        self.assertNotIn("final_equity", found["activity"]["returns_compound_to_equity@1"])
        self.assertNotIn("100009.8", json.dumps(found, default=str))

    # The comparison

    def test_the_comparison_gives_the_test_attribution_pairs_and_predictions_in_one_entry(self):
        found = comparison.compare(self.profile, "registration-child", self.candidate["run_id"])
        self.assertEqual((found["run_id"], found["control_run_id"], found["research_parent"]),
                         (self.candidate["run_id"], self.control["run_id"], self.control_ref))
        evidence = found["evidence"]
        self.assertEqual((evidence["days"], evidence["design"]["block_days"]), (31, 5))
        self.assertIsNotNone(evidence["p_one_sided"])
        annual = found["attribution"]["headline"]["annual_return@1"]
        self.assertAlmostEqual(evidence["observed_account_annual_return_difference"],
                               annual["candidate"] - annual["control"], places=15)
        self.assertEqual(list(found["attribution"]["slices"]),
                         [item["id"] for item in duties.measure_catalogue()["slices"]])
        pairs = found["attribution"]["slices"]["trade_pairs"]["measures"]
        self.assertEqual(pairs["matched_share@1"]["difference"], 1.0, "the same single trade on both sides")
        predictions = found["attribution"]["predictions"]
        self.assertEqual([item["same_sign"] for item in predictions], [False, False, None],
                         "an unchanged measure is no change in the predicted direction")
        self.assertTrue(predictions[0]["reason"] is None and predictions[0]["observed"] == 0.0)
        months = found["attribution"]["slices"]["by_period"]["measures"]["months_won_share@1"]
        self.assertEqual((months["difference"], months["pairwise"]["value"]), (0.0, 1.0))
        self.assertEqual((predictions[1]["observed"], predictions[1]["observed_as"]), (1.0, "pairwise"),
                         "a measure the comparison defines is checked against the comparison's own value")
        self.assertEqual(predictions[0]["observed_as"], "difference")
        self.assertTrue(predictions[2]["reason"].startswith("NO_SLICE"))
        again = comparison.compare(self.profile, "registration-child", self.candidate["run_id"])
        self.assertEqual(again["evidence"], evidence, "recomputed from stored rows and the locked seed")
        part = attribution.attribution(self.profile, "registration-child", self.candidate["run_id"])
        self.assertEqual(part["slices"], found["attribution"]["slices"])

    def test_a_registration_without_a_control_has_nothing_to_compare(self):
        found = comparison.compare(self.profile, "registration-root", self.control["run_id"])
        self.assertEqual((found["control_run_id"], found["evidence"], found["attribution"]), (None, None, None))
        self.assertEqual(found["next_actions"], [f"Read the run alone with `replay report --run-id "
                                                 f"{self.control['run_id']}`."])
        self.assertEqual(refused(comparison.compare, self.profile, "registration-root", self.candidate["run_id"]).code,
                         "RUN_NOT_IN_GRID")

    def test_the_comparison_is_refused_outside_the_grid_or_without_evidence(self):
        cases = [(("registration-child", self.control["run_id"]), "RUN_NOT_IN_GRID"),
                 (("registration-child", 9999), "UNKNOWN_RUN")]
        for arguments, code in cases:
            with self.subTest(code=code):
                self.assertEqual(refused(comparison.compare, self.profile, *arguments).code, code)

    def test_two_series_on_different_days_are_not_compared(self):
        day = metrics.DAY_NS
        self.assertIsNone(comparison.check_clocks([(0, 0.1), (day, 0.0)], [(0, 0.2), (day, 0.1)]))
        self.assertEqual(refused(comparison.check_clocks, [(0, 0.1), (day, 0.0)], [(0, 0.2), (2 * day, 0.1)]).code,
                         "CLOCK_MISMATCH")

    # Candidates, counts and state

    def test_the_candidate_list_gives_every_attempt_with_its_availability_and_no_score(self):
        found = candidates.candidates(self.profile)
        by_ref = {f"{item['strategy_id']}@{item['revision']}": item for item in found["candidates"]}
        control = by_ref[self.control_ref]
        self.assertEqual([(item["bundle"], item["run_status"], item["availability"]["economic_evidence_available"])
                          for item in control["attempts"]], [("registration-root", "passed", True)])
        self.assertTrue(control["valid_evidence"])
        self.assertFalse(by_ref[self.bad_ref]["valid_evidence"])
        self.assertEqual(by_ref["rsi@1"]["attempts"], [], "the line's start was never registered")

    def test_research_counts_add_up_to_the_attempts(self):
        found = status.research_status(self.profile)
        self.assertEqual(found["research_attempts"], 4)
        self.assertEqual((found["valid_research_runs"], found["diagnostic_only_research_runs"],
                          found["invalid_research_runs"], found["unfinished_research_attempts"]), (2, 1, 1, 0))
        self.assertGreater(found["trials"], found["research_attempts"], "prechecks and explorations count as trials")
        self.assertEqual(found["validation"], {"registered": 0, "bound": 0, "unbound": 0, "unwitnessed": 0})

    def test_the_research_state_gives_judgments_unreviewed_trials_and_gates(self):
        with db.connect(self.profile, "reader") as conn:
            found = status.research_state(conn)
        line = found["line"]
        self.assertEqual({key: line[key] for key in ("bundle", "start", "window_start", "window_end", "market_commit",
                                                     "universe_rule", "note")},
                         {"bundle": self.world.line["bundle"], "start": "rsi@1", "window_start": "2026-01-01",
                          "window_end": "2026-02-01", "market_commit": self.world.line["market_commit"],
                          "universe_rule": self.world.line["universe_rule"], "note": None})
        self.assertIsNone(found["recommendation"])
        self.assertEqual(found["trials_on_line"], 4)
        self.assertEqual(len(found["unreviewed_trials"]), 4, "without a recommendation every trial of the line")
        self.assertEqual(found["interpretations"][0]["facts"][0]["trial"]["trial_id"], self.control["trial_id"])
        self.assertIsNotNone(found["interpretations"][0]["facts"][0]["headline"])
        self.assertEqual(found["gates"][0]["code"], "INTERPRETATION_REQUIRED")
        self.assertEqual(found["cadence"], {"cadence_trials": register.DEFAULT_REVIEW_CADENCE, "judgment_id": None})
        self.assertEqual(found["facts"]["counts"]["research_attempts"], 4)
        with db.connect(self.profile, "reader") as conn:
            self.assertEqual(refused(status.research_state, conn, "research-line-9").code, "LINE_UNKNOWN")

    def test_affected_runs_list_the_runs_of_another_identity(self):
        other = {"runtime": {"image_digest": "sha256:" + "c" * 64}}
        found = status.affected_runs(self.profile, other)
        self.assertEqual({item["run_id"] for item in found["runs"]},
                         {self.control["run_id"], self.candidate["run_id"], self.bare["run_id"], self.bad["run_id"]})
        self.assertEqual(found["runs"][0]["differs_in"], ["runtime.image_digest"])
        self.assertIn("registration-child", found["evidence_bundles"], "it names the control run")
        recorded = found["runs"][0]["recorded"]
        same = status.affected_runs(self.profile, {"runtime": {"image_digest": recorded["image_digest"]},
                                                   "effective_config": recorded["config_key"],
                                                   "input": recorded["input_key"]})
        self.assertEqual(same["runs"], [])
        unrecorded = status.affected_runs(self.profile, {"runtime": {"engine_version": "2.0.0rc3"}})
        self.assertEqual((unrecorded["runs"], unrecorded["unrecorded"]), ([], ["runtime.engine_version"]))
        for query in ({}, {"runtime": {"tag": "x"}}, {"market": {}}):
            with self.subTest(query=query):
                self.assertEqual(refused(status.affected_runs, self.profile, query).code, "INVALID_QUERY")


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.root = Path(tempfile.mkdtemp(prefix="report-dir-"))
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_a_directory_without_its_reports_is_refused_by_name(self):
        self.assertEqual(refused(runs.load_directory, self.root / "absent").code, "DIRECTORY_NOT_FOUND")
        (self.root / "reports").mkdir()
        self.assertEqual(refused(runs.load_directory, self.root).code, "NATIVE_SUMMARY_MISSING")
        (self.root / "reports" / "summary.json").write_text("{}")
        self.assertEqual(refused(runs.load_directory, self.root).code, "REPORT_PARSE_FAILED")
        for name in ("orders.csv", "fills.csv", "positions.csv", "account.csv", "returns_series.csv"):
            (self.root / "reports" / name).write_text("ts_event_ns,native_return\n" if name.startswith("returns") else
                                                      "x\n1\n")
        import gzip
        (self.root / "reports" / "order_events.jsonl.gz").write_bytes(gzip.compress(b""))
        exc = refused(runs.load_directory, self.root)
        self.assertEqual(exc.code, "REPORT_PARSE_FAILED")
        self.assertIn("orders.csv:client_order_id", exc.missing)


if __name__ == "__main__":
    unittest.main()
