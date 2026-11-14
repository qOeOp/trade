"""Qualification and the report readers on sealed runs of a throwaway ledger: a root control run and a
derived candidate run, each through the replay entry with a stand-in runtime, plus a run without a
semantic fingerprint and an invalid one. Never the active ledger."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
import json
from pathlib import Path
import shutil
import unittest
from unittest import mock

from cli.replay_commands import replay_report
from ledger import db, metrics, strategies
from shared.refusals import refuse
from market.sources import MarketError
from registration import availability, duties, precheck, register
from replay import entry, reproduce
from report import candidates, comparison, graph, measures, runs, seams, status
from runtime import image
from tests.ledger.dolt import BINARY, MARKET_DAY, SKIP
from tests.registration.world import OUTCOMES, RUNNER_ARGV
from tests.replay.world import ReplayWorld, registered_grid
from tests.helpers import refused


FINGERPRINT = {"fills": {"rows": 2, "sha256": "1" * 64}, "orders": {"rows": 2, "sha256": "2" * 64}}
CANDIDATE_RETURNS = [0.002, -0.001, 0.0015, -0.0005, 0.001]
DAYS = [(date(2026, 1, 1) + timedelta(days=k)).isoformat() for k in range(31)]


def market_returns(market_database, commit, universe_rule, start, end) -> dict:
    """A market stand-in: the basket and BTC daily returns over January 2026."""
    return {"days": list(DAYS), "basket": [0.01 * ((k % 4) - 1.5) for k in range(31)],
            "btc": [0.005 * ((k % 3) - 1) for k in range(31)]}


def unreachable(*window):
    """A market whose service refuses the connection."""
    cause = MarketError("connection refused", code="MARKET_UNREACHABLE")
    raise refuse("MARKET_RETURNS_UNAVAILABLE", f"{cause.code}: {cause.message}") from cause


def unprofiled(*window):
    """A ledger profile directory without a market profile."""
    raise refuse("MARKET_RETURNS_UNAVAILABLE", "no market profile for database (the active one)")


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
        cls.root_registration, (cls.control_ref,) = registered_grid(world, ["control"])
        cls.control = cls.replay(cls.control_ref, cls.root_registration, output=world.output("control-kept"))
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.control["trial_id"]}])
        child = world.publish("child", parent=cls.control_ref, difference="widen the stop")
        cls.child_ref = child["candidate"]
        mechanism = [{"slice": "trade_structure", "measure": "win_rate", "direction": "up", "duty": "F3",
                      "reason": "a wider stop is hit less often"},
                     {"slice": "by_period", "measure": "months_won_share", "direction": "down", "duty": "F3",
                      "reason": "fixture"},
                     {"slice": None, "measure": None, "direction": "up", "duty": "F3", "reason": "no slice measures it"}]
        body = world.body([cls.child_ref], {cls.child_ref: world.prechecked(child["source"])},
                          control_trial_id=cls.control["trial_id"], duties=["F3"],
                          prediction={"mechanism": mechanism, "outcomes": dict(OUTCOMES)})
        cls.child_registration = world.register(body)["registration_id"]
        world.scenario = {"returns": CANDIDATE_RETURNS}
        cls.candidate = cls.replay(cls.child_ref, cls.child_registration)
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.candidate["trial_id"]}])
        world.scenario = {}
        # A passed run without economic evidence: a later independent review fails its source.
        bare_registration, (cls.bare_ref,) = registered_grid(world, ["bare"])
        cls.bare = cls.replay(cls.bare_ref, bare_registration)
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.bare["trial_id"]}])
        with db.read_as_of(world.profile) as conn:
            source_sha256 = strategies.read_candidate(conn, cls.bare_ref)["source_sha256"]
            (trial_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s",
                                     (source_sha256,))
        precheck.record_review(world.profile, world.review_body(trial_id, "failed", api={
            "status": "failed", "note": "it calls an unknown API"}), "reviewer-b")
        world.scenario = {"audit_passed": False, "findings": ["fill F-1 unmatched"], "audit_exit": 1}
        bad_registration, (cls.bad_ref,) = registered_grid(world, ["bad"])
        cls.bad = cls.replay(cls.bad_ref, bad_registration)
        world.scenario = {}

    @classmethod
    def replay(cls, ref: str, registration: int, output: Path | None = None) -> dict:
        return entry.run(cls.world.profile, cls.world.market, MARKET_DAY, ref, None, RUNNER_ARGV,
                         registration=registration, output=output)

    def setUp(self):
        self.world = self.__class__.world
        self.profile = self.world.profile

    def assess(self, trial_id: int) -> dict:
        with db.read_as_of(self.profile) as conn:
            return availability.assess(conn, {"trial_id": trial_id})

    # Qualification

    def test_a_clean_fingerprinted_run_is_economic_evidence_under_a_named_check(self):
        self.assertEqual((self.control["status"], self.bare["status"], self.bad["status"]),
                         ("passed", "passed", "invalid"))
        value = self.assess(self.control["trial_id"])
        self.assertEqual((value["economic_evidence_available"], value["reasons"]), (True, []))
        self.assertEqual(value["checker"]["check"], availability.CHECK)
        self.assertEqual(set(value["checker"]), {"check", "product_commit", "checker_source_sha256"})
        self.assertEqual((value["activity"]["fills"], value["activity"]["orders"]), (2, 2))
        self.assertEqual((value["source_check"]["status"], value["execution_capture"]["status"]), ("passed", "captured"))
        self.assertIsNotNone(value["source_check"]["reviews"][0]["created_at"])

    def test_a_run_of_a_failed_source_or_with_a_failed_audit_is_not_evidence(self):
        bare = self.assess(self.bare["trial_id"])
        self.assertFalse(bare["economic_evidence_available"])
        self.assertTrue(any(reason.startswith("SOURCE_REVIEW_FAILED") for reason in bare["reasons"]))
        bad = self.assess(self.bad["trial_id"])
        self.assertTrue(bad["reasons"][0].startswith("RUN_INVALID: ") and "AUDIT" in bad["reasons"][0])
        with db.read_as_of(self.profile) as conn:
            exc = refused(availability.require, conn, {"trial_id": self.bare["trial_id"]})
        self.assertEqual((exc.code, exc.missing[0]), ("ECONOMIC_EVIDENCE_UNAVAILABLE", str(self.bare["trial_id"])))
        self.assertEqual(exc.missing[1:], tuple(bare["reasons"]))

    def test_native_reasons_name_failing_and_unrecorded_facts(self):
        report = {"activity": {"real_fills": {"passed": False, "code": "NO_FILLS"}}}
        found = availability.native_reasons(report)
        self.assertTrue(found[0].startswith("NO_FILLS: real_fills"))
        self.assertIn("NOT_EVALUATED: cycles_reconcile_audit", found)

    # The single-run report and the drill-down

    def test_a_registered_run_reads_its_annual_return_with_the_declared_interval(self):
        with db.read_as_of(self.profile) as conn:
            found = comparison.annual_return_interval(conn, self.candidate["trial_id"])
        self.assertLess(found["interval"][0], found["annual_return"])
        self.assertLess(found["annual_return"], found["interval"][1])
        self.assertEqual(found["coverage"], 0.95)

        report = runs.run_report(self.profile, self.control["trial_id"])
        headline = report["headline"]
        self.assertAlmostEqual(headline["annual_return"]["value"], 1.000098 ** (365 / 31) - 1, places=12)
        self.assertEqual(headline["mark_max_drawdown"]["population"], "bars")
        bridge = next(item for item in report["slices"] if item["id"] == "profit_bridge")["measures"]
        self.assertEqual([bridge[name]["value"] for name in ("price", "fee", "funding", "open_mark", "account")],
                         ["10.00000000", "-0.20000000", "0.00000000", "0.00000000", "9.80000000"])
        self.assertEqual([item["id"] for item in report["slices"]],
                         ["profit_bridge", "capital_scaled", "fee_stress", "by_instrument", "market_exposure",
                          "by_period", "by_regime", "trade_structure", "drawdown"], "trade pairs are comparison only")
        exposure = next(item for item in report["slices"] if item["id"] == "market_exposure")["measures"]
        self.assertIsNotNone(exposure["beta_basket"]["value"])
        self.assertEqual(report["closed_by_year"]["2026"]["closed_trades"], 1)
        self.assertIsNone(report["dev_years"], "a 31-day window has no development years")
        self.assertEqual(report["cost_basis"]["taker_fill_share"], 0.5)
        notional = sum(Decimal(item["notional"]) for item in report["cost_basis"]["by_liquidity_side"].values())
        stress = report["cost_basis"]["slippage_stress"]
        self.assertEqual([item["bps_per_side"] for item in stress], [2, 5])
        starting = Decimal(report["cost_basis"]["account"]["starting_balance_usdt"])
        for item in stress:
            cost = notional * item["bps_per_side"] / 10_000
            self.assertEqual(Decimal(item["extra_cost_usdt"]), cost)
            self.assertAlmostEqual(item["annual_return"], (1.000098 - float(cost / starting)) ** (365 / 31) - 1,
                                   places=12, msg="the extra cost taken from the final equity")
        self.assertLess(stress[1]["annual_return"], stress[0]["annual_return"])
        self.assertLess(stress[0]["annual_return"], headline["annual_return"]["value"])
        slices = {item["id"]: item["measures"] for item in report["slices"]}
        for slice_id, name in (("capital_scaled", "timing_term"), ("by_period", "residual_after_top5_days")):
            self.assertEqual(slices[slice_id][name]["definition_note"], measures.MEASURE_NOTES[name])
        self.assertEqual(report["availability"]["economic_evidence_available"], True)
        bare = runs.run_report(self.profile, self.bare["trial_id"])
        self.assertEqual((bare["headline"], bare["slices"], bare["cost_basis"]), (None, None, None))
        self.assertEqual(bare["activity"]["real_fills"]["count"], 2, "diagnostics stay")
        bad = runs.run_report(self.profile, self.bad["trial_id"])
        self.assertEqual((bad["status"], bad["headline"]), ("invalid", None))
        self.assertTrue(bad["failure_reasons"])

    def test_a_run_without_evidence_shows_no_money_in_its_activity_facts(self):
        bare = runs.run_report(self.profile, self.bare["trial_id"])
        compounding = bare["activity"]["returns_compound_to_equity"]
        self.assertEqual(compounding, {"passed": True, "code": None})
        self.assertEqual(bare["activity"]["real_fills"], {"passed": True, "code": None, "count": 2})
        self.assertNotIn("100009.8", json.dumps(bare, default=str), "neither the final nor the compounded equity")
        with db.read_as_of(self.profile) as conn:
            self.assertEqual(measures.run_facts(conn, self.control["trial_id"])["final_equity"],
                             Decimal("100009.80000000"), "the final equity the stored daily returns compound to")

    def test_a_report_reads_an_exact_ledger_version(self):
        with db.read_as_of(self.profile) as conn:
            before = conn.rows("SELECT to_commit FROM dolt_diff_run WHERE to_trial_id = %s AND diff_type = 'added'",
                               (self.candidate["trial_id"],))[0][0]
            parent = conn.rows("SELECT parent_hash FROM dolt_commit_ancestors WHERE commit_hash = %s", (before,))[0][0]
        self.assertEqual(refused(runs.run_report, self.profile, self.candidate["trial_id"], parent).code, "UNKNOWN_RUN")
        self.assertEqual(runs.run_report(self.profile, self.control["trial_id"], parent)["ledger_commit"], parent)
        self.assertEqual(refused(runs.run_report, self.profile, self.control["trial_id"], "no-such-tag").code,
                         "UNKNOWN_REF")

    def test_one_report_reads_one_ledger_version(self):
        """CF-11: without --at, replay report resolves the head once and reads every part at that commit; the one
        other head read is run_report's deliberate check that the run still has its evidence there."""
        opened: list = []
        real = db.read_as_of

        def recording(profile, at=None, *arguments, **options):
            opened.append(at)
            return real(profile, at, *arguments, **options)
        with mock.patch.object(db, "read_as_of", side_effect=recording):
            found = replay_report(self.profile, self.candidate["trial_id"], None, None, True, None, None, False, False)
        self.assertIsNotNone(found["annual_return_interval"])
        self.assertIn("tables", found)
        self.assertEqual((opened[0], opened.count(None), set(opened) - {None}), (None, 2, {found["ledger_commit"]}))

    def test_tables_give_the_cycles_and_series_and_native_detail_only_from_a_verified_reproduction(self):
        found = runs.tables(self.control["trial_id"], self.profile)
        self.assertEqual((len(found["positions"]), len(found["daily_returns"])), (1, 31))
        self.assertEqual(found["reconciled"]["realized_pnl_usdt"], "9.80000000")
        self.assertIsNone(found["orders"])
        self.assertEqual(set(found["null_reasons"]), {"orders", "fills", "account", "exposures", "order_events"})
        self.assertIn(f"replay reproduce --trial-id {self.control['trial_id']}", found["null_reasons"]["exposures"],
                      "a null native table names the step that fills it")
        self.assertTrue(found["null_reasons"]["exposures"].startswith("REPRODUCTION_REQUIRED"))
        with mock.patch.dict(image.LAYOUTS, {"replay-contract@v99": {}}, clear=True):
            retired = runs.tables(self.control["trial_id"], self.profile, exposures=True)["null_reasons"]["exposures"]
        self.assertTrue(retired.startswith("RUNTIME_UNSUPPORTED"), retired)
        self.assertNotIn("replay reproduce", retired, "a run of a retired contract is never told to run a step "
                                                      "the product always refuses")
        self.assertEqual(refused(runs.tables, self.bad["trial_id"], self.profile).code, "RUN_NOT_PASSED")
        self.assertEqual(refused(runs.tables, self.bare["trial_id"], self.profile).code, "ECONOMIC_EVIDENCE_UNAVAILABLE")
        done = reproduce.reproduce(self.control["trial_id"], self.world.output("drill"), ledger=self.profile,
                                   market=self.world.market)
        directory = Path(done["directory"])
        detail = runs.tables(self.control["trial_id"], self.profile, directory=directory, account=True,
                             reproduction=done["reproduction_trial_id"])
        self.assertEqual([fill["cycle_position_id"] for fill in detail["fills"]], ["AAAUSDT-PERP.BINANCE-P"] * 2)
        self.assertEqual(detail["positions"], found["positions"], "native drill-down must keep stored cycle values")
        self.assertEqual((len(detail["account"]), detail["reproduction"]), (3, done["reproduction_trial_id"]))
        self.assertEqual(detail["null_reasons"], {"exposures": "NOT_REQUESTED: pass --exposures"})
        self.assertEqual(runs.tables(self.control["trial_id"], self.profile, directory=directory)["fills"],
                         detail["fills"], "a reproduction equal byte for byte to the run's own capture reads as it")
        fills = directory / "reports" / "fills.csv"
        fills.write_text(fills.read_text().replace(",100,", ",99,"))
        exc = refused(runs.tables, self.control["trial_id"], self.profile, directory=directory,
                      reproduction=done["reproduction_trial_id"])
        self.assertEqual((exc.code, exc.missing), ("REPRODUCTION_MISMATCH", ("reports/fills.csv",)))

    def test_the_directory_a_run_kept_reads_as_its_original_cache_and_a_changed_copy_is_refused(self):
        trial_id, directory = self.control["trial_id"], self.world.output("control-kept")
        self.assertEqual(self.control["path"], str(directory.resolve()))
        stored = runs.tables(trial_id, self.profile)
        detail = runs.tables(trial_id, self.profile, directory=directory, account=True)
        self.assertEqual((len(detail["orders"]), len(detail["fills"]), len(detail["account"])), (2, 2, 3))
        self.assertIsNone(detail["reproduction"])
        self.assertEqual(detail["positions"], stored["positions"])
        self.assertEqual(detail["null_reasons"], {"exposures": "NOT_REQUESTED: pass --exposures"})
        shown = replay_report(self.profile, trial_id, str(directory), None, False, None, None, False, False)
        self.assertEqual(len(shown["tables"]["fills"]), 2, "--directory alone reads the run's kept cache")
        self.assertEqual(refused(replay_report, self.profile, trial_id, str(directory), None, True, str(directory),
                                 None, False, False).code, "USAGE_ERROR")
        for mode in ("changed", "missing", "extra"):
            clone = self.world.output(f"control-kept-{mode}")
            shutil.copytree(directory, clone)
            fills = clone / "reports" / "fills.csv"
            if mode == "changed":
                fills.write_text(fills.read_text().replace(",100,", ",99,"))
            elif mode == "missing":
                fills.unlink()
            else:
                (clone / "reports" / "unexpected.csv").write_text("extra\n")
            with self.subTest(mode=mode):
                exc = refused(runs.tables, trial_id, self.profile, directory=clone)
                self.assertEqual((exc.code, exc.missing),
                                 ("REPRODUCTION_MISMATCH", ("reports/unexpected.csv",) if mode == "extra"
                                  else ("reports/fills.csv",)))
        exc = refused(runs.tables, self.candidate["trial_id"], self.profile, directory=directory)
        self.assertEqual(exc.code, "REPRODUCTION_MISMATCH", "one run's kept directory is no cache of another run")

    def test_a_forged_directory_is_no_reproduction(self):
        """An exploration of another source with its own (matching) fingerprint and edited fill prices."""
        explored = entry.explore(self.profile, self.world.market, MARKET_DAY,
                                 self.world.strategy_file(b"from nautilus_trader.trading import Strategy\n\n\nclass "
                                                          b"Fixture(Strategy):\n    pass\n# forge\n", "forge.py"),
                                 "Fixture", self.world.output("forge"), None, RUNNER_ARGV + ["--symbols", "AAAUSDT"],
                                 self.world.line["line"])
        directory = Path(explored["path"])
        fills = directory / "reports" / "fills.csv"
        fills.write_text(fills.read_text().replace(",100,", ",999999,"))
        with db.read_as_of(self.profile) as conn:
            (explore_trial,), = conn.rows("SELECT MAX(trial_id) FROM trial WHERE purpose = 'explore'")
        for reproduction in (None, explore_trial, self.control["trial_id"], 999_999):
            with self.subTest(reproduction=reproduction):
                self.assertEqual(refused(runs.tables, self.control["trial_id"], self.profile, directory=directory,
                                         reproduction=reproduction).code, "REPRODUCTION_MISMATCH")

    def test_an_exploration_directory_reads_with_the_sealed_functions_marked_unverified(self):
        explored = entry.explore(self.profile, self.world.market, MARKET_DAY,
                                 self.world.strategy_file(b"from nautilus_trader.trading import Strategy\n\n\nclass "
                                                          b"Fixture(Strategy):\n    pass\n# draft\n", "draft.py"),
                                 "Fixture", self.world.output("draft"), None, RUNNER_ARGV + ["--symbols", "AAAUSDT"],
                                 self.world.line["line"])
        found = explored["metrics"]
        self.assertTrue(found["exploration"])
        self.assertEqual(found["availability"]["unverified"], runs.UNVERIFIED)
        sealed = runs.run_report(self.profile, self.control["trial_id"])
        self.assertEqual(found["headline"]["annual_return"]["value"], sealed["headline"]["annual_return"]["value"])
        self.assertIn(runs.UNVERIFIED, found["limitations"])

    def test_a_directory_whose_audit_failed_is_masked_with_the_reason(self):
        self.world.scenario = {"audit_passed": False, "findings": ["fill F-1 unmatched"]}
        try:
            explored = entry.explore(self.profile, self.world.market, MARKET_DAY,
                                     self.world.strategy_file(b"from nautilus_trader.trading import Strategy\n\n\nclass "
                                                              b"Fixture(Strategy):\n    pass\n# failed audit\n",
                                                              "failed.py"),
                                     "Fixture", self.world.output("failed-audit"), None,
                                     RUNNER_ARGV + ["--symbols", "AAAUSDT"], self.world.line["line"])
        finally:
            self.world.scenario = {}
        found = runs.directory_report(Path(explored["path"]), account=True)
        self.assertFalse(found["availability"]["economic_evidence_available"])
        self.assertTrue(any(item.startswith("AUDIT_FAILED") for item in found["availability"]["reasons"]))
        self.assertEqual((found["headline"], found["slices"], found["account"]), (None, None, None))
        self.assertNotIn("final_equity", found["activity"]["returns_compound_to_equity"])
        self.assertNotIn("100009.8", json.dumps(found, default=str))

    # The comparison

    def test_the_basket_note_reaches_both_reports_on_every_basket_measure(self):
        basket = {"capital_scaled": ("up_month_notional", "down_month_notional"),
                  "market_exposure": ("beta_basket", "alpha_basket"),
                  "by_regime": ("high_vol_days", "high_vol_mean_log", "high_vol_log_sum", "low_vol_days",
                                "low_vol_mean_log", "low_vol_log_sum")}
        single = {item["id"]: item["measures"] for item in runs.run_report(self.profile, self.control["trial_id"])["slices"]}
        paired = comparison.compare(self.profile, self.child_registration, self.candidate["trial_id"])["attribution"]["slices"]
        for slice_id, names in basket.items():
            for name in names:
                self.assertEqual(single[slice_id][name]["definition_note"], measures.BASKET_NOTE, name)
                self.assertEqual(paired[slice_id]["measures"][name]["definition_note"], measures.BASKET_NOTE, name)
        exposure = paired["market_exposure"]["measures"]
        for name in ("beta_basket", "alpha_basket"):
            self.assertEqual(exposure[name]["pairwise"]["definition_note"], measures.BASKET_NOTE, name)
        for name in ("beta_btc", "alpha_btc"):
            self.assertNotIn("definition_note", single["market_exposure"][name], "BTC is not the basket")
            self.assertNotIn("definition_note", exposure[name], "BTC is not the basket")

    def test_the_comparison_gives_the_test_attribution_pairs_and_predictions_in_one_entry(self):
        found = comparison.compare(self.profile, self.child_registration, self.candidate["trial_id"])
        self.assertEqual((found["trial_id"], found["control_trial_id"], found["research_parent"]),
                         (self.candidate["trial_id"], self.control["trial_id"], self.control_ref))
        evidence = found["evidence"]
        self.assertEqual((evidence["days"], evidence["design"]["block_days"]), (31, 5))
        self.assertIsNotNone(evidence["p_one_sided"])
        self.assertEqual(list(found["attribution"]["slices"]),
                         [item["id"] for item in duties.measure_catalogue()["slices"]])
        slices = found["attribution"]["slices"]
        self.assertEqual(slices["capital_scaled"]["measures"]["timing_term"]["definition_note"],
                         measures.MEASURE_NOTES["timing_term"])
        trimmed = slices["by_period"]["measures"]["residual_after_top5_days"]
        notes = (trimmed["definition_note"], trimmed["pairwise"]["definition_note"])
        catalogue = measures.MEASURE_NOTES["residual_after_top5_days"]
        self.assertEqual([note.startswith(catalogue) and note != catalogue for note in notes], [True, True],
                         "the comparison extends the catalogue note of the trimmed residual on both sides")
        self.assertNotEqual(notes[0], notes[1], "the difference and the pairwise value trim different series")
        pairs = found["attribution"]["slices"]["trade_pairs"]["measures"]
        self.assertEqual(pairs["matched_share"]["difference"], 1.0, "the same single trade on both sides")
        predictions = found["attribution"]["predictions"]
        self.assertEqual([item["same_sign"] for item in predictions], [False, False, None],
                         "an unchanged measure is no change in the predicted direction")
        self.assertTrue(predictions[0]["reason"] is None and predictions[0]["observed"] == 0.0)
        months = found["attribution"]["slices"]["by_period"]["measures"]["months_won_share"]
        self.assertEqual((months["difference"], months["pairwise"]["value"]), (0.0, 1.0))
        self.assertEqual((predictions[1]["observed"], predictions[1]["observed_as"]), (1.0, "pairwise"),
                         "a measure the comparison defines is checked against the comparison's own value")
        self.assertEqual(predictions[0]["observed_as"], "difference")
        self.assertTrue(predictions[2]["reason"].startswith("NO_SLICE"))
        again = comparison.compare(self.profile, self.child_registration, self.candidate["trial_id"])
        self.assertEqual(again["evidence"], evidence, "recomputed from stored rows and the locked seed")

    def test_the_research_graph_refuses_an_unreachable_market_and_not_a_missing_market_profile(self):
        for workers in (1, 3):
            with self.subTest(workers=workers):
                with seams.use(market_returns=unreachable):
                    self.assertEqual(refused(graph.research_graph, self.profile, workers=workers).code,
                                     "MARKET_UNREACHABLE", "a graph without the market would show its comparisons' "
                                     "market measures as missing")
                with seams.use(market_returns=unprofiled):
                    self.assertEqual(graph.research_graph(self.profile, workers=workers)["format"], graph.FORMAT)

    def test_the_research_graph_is_the_same_from_one_process_or_several(self):
        one = graph.research_graph(self.profile, workers=1)
        drawn = [c["comparison"] for c in one["candidates"] if c["comparison"] is not None]
        self.assertGreater(len(drawn), 0, "a comparison is drawn")
        self.assertTrue(all(isinstance(item["detectable"], float) and item["detectable"] >= 0 for item in drawn),
                        "the graph shows the comparison's annual power reading")
        self.assertEqual(json.dumps(graph.research_graph(self.profile, workers=4)), json.dumps(one))

    def test_one_research_graph_reads_the_source_reviews_and_the_checker_once(self):
        with mock.patch.object(precheck, "review_records", wraps=precheck.review_records) as reviews, \
                mock.patch.object(availability, "report_revision", wraps=availability.report_revision) as revision:
            found = graph.research_graph(self.profile, workers=1)
        self.assertTrue(any(c["comparison"] for c in found["candidates"]), "the graph compares a version")
        self.assertEqual((reviews.call_count, revision.call_count), (1, 1),
                         "every comparison shares the graph's reads at its one commit")

    def test_a_graph_without_comparisons_differs_only_in_them_and_gives_each_on_request(self):
        full = graph.research_graph(self.profile, workers=1)
        with mock.patch.object(comparison, "block_indices", side_effect=AssertionError("no bootstrap")):
            bare = graph.research_graph(self.profile, comparisons=False)
        self.assertGreater(sum(c["comparison"] is not None for c in full["candidates"]), 0, "a comparison is drawn")
        for candidate in full["candidates"]:
            drawn = candidate["comparison"]
            registration, trial = candidate["registration"], next(
                (t["trial_id"] for t in reversed(candidate["trials"]) if t["purpose"] == "research"), None)
            if drawn is not None:
                self.assertEqual(graph.version_comparison(self.profile, int(registration), trial,
                                                          full["scope"]["ledger_commit"]),
                                 {"comparison": drawn}, "the graph's own comparison of that version")
            candidate["comparison"] = None
        self.assertEqual(bare, full)

    def test_a_version_s_comparison_refuses_a_failed_market_read_as_the_graph_does(self):
        commit = graph.research_graph(self.profile, workers=1)["scope"]["ledger_commit"]
        args = (self.profile, self.child_registration, self.candidate["trial_id"], commit)
        environment = refuse(next(iter(comparison.ENVIRONMENT)), "the service is gone")

        def failing(failure):
            def read(*window):
                raise failure
            return read

        clean = graph.version_comparison(*args)
        with seams.use(market_returns=failing(refuse("MARKET_DAY_UNKNOWN", "no such market day"))):
            drawn = graph.research_graph(self.profile, workers=1)
            self.assertIn("market_unread", drawn["scope"])
            shown = next(c["comparison"] for c in drawn["candidates"]
                         if c["registration"] == str(self.child_registration))
            self.assertEqual(graph.version_comparison(*args), {"comparison": shown}, "marked on the graph, so not refused")
            self.assertEqual(graph.version_comparison(*args), clean, "what a browser keeps for this commit is what a read market gives")
        with seams.use(market_returns=failing(environment)):
            self.assertIs(refused(graph.research_graph, self.profile, workers=1), environment)
            self.assertIs(refused(graph.version_comparison, *args), environment)

    def test_comparing_without_the_bootstrap_refuses_what_the_bootstrap_refuses(self):
        refusal = refuse("COMPARISON_UNAVAILABLE", "too few days")
        with mock.patch.object(comparison, "_paired_inputs", side_effect=refusal):
            for bootstrap in (True, False):
                with self.subTest(bootstrap=bootstrap):
                    self.assertIs(refused(comparison.compare, self.profile, self.child_registration, self.candidate["trial_id"],
                                          bootstrap=bootstrap), refusal)

    def test_the_interval_reading_is_the_comparison_s_without_its_attribution(self):
        """CF-10: research state's reading of a comparison computes the intervals alone and refuses what compare does."""
        evidence = comparison.compare(self.profile, self.child_registration, self.candidate["trial_id"])["evidence"]
        with mock.patch.object(comparison.report_attribution, "attribute") as attribute, \
                mock.patch.object(comparison, "interaction_of") as interaction, \
                mock.patch.object(comparison, "_sensitivity") as sensitivity:
            found = comparison.crossing(self.profile, self.child_registration, self.candidate["trial_id"])
            self.assertIsNone(comparison.crossing(self.profile, self.root_registration, self.control["trial_id"]),
                              "a registration without a control gives no reading")
            for arguments, code in [((self.child_registration, self.control["trial_id"]), "RUN_NOT_IN_GRID"),
                                    ((self.root_registration, self.candidate["trial_id"]), "RUN_NOT_IN_GRID"),
                                    ((self.child_registration, 9999), "UNKNOWN_RUN")]:
                self.assertEqual(refused(comparison.crossing, self.profile, *arguments).code, code)
        self.assertEqual(found, comparison.intervals_cross_zero(evidence))
        self.assertIsNotNone(found)
        self.assertEqual((attribute.call_count, interaction.call_count, sensitivity.call_count), (0, 0, 0))

    def test_a_registration_without_a_control_has_nothing_to_compare(self):
        found = comparison.compare(self.profile, self.root_registration, self.control["trial_id"])
        self.assertEqual((found["control_trial_id"], found["evidence"], found["attribution"]), (None, None, None))
        self.assertEqual(found["next_actions"], [f"Read the run alone with `replay report --trial-id "
                                                 f"{self.control['trial_id']}`."])
        self.assertEqual(refused(comparison.compare, self.profile, self.root_registration, self.candidate["trial_id"]).code,
                         "RUN_NOT_IN_GRID")

    def test_the_comparison_is_refused_outside_the_grid_or_without_evidence(self):
        cases = [((self.child_registration, self.control["trial_id"]), "RUN_NOT_IN_GRID"),
                 ((self.child_registration, 9999), "UNKNOWN_RUN")]
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
        self.assertEqual([(item["registration_id"], item["run_status"],
                           item["availability"]["economic_evidence_available"]) for item in control["attempts"]],
                         [(self.root_registration, "passed", True)])
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
            found = status.research_state(conn, full=True)
        line = found["line"]
        self.assertEqual({key: line[key] for key in ("name", "start", "dev_start", "dev_end", "market_day",
                                                     "universe_rule", "closed")},
                         {"name": self.world.line["line"], "start": "rsi@1", "dev_start": "2026-01-01",
                          "dev_end": "2026-02-01", "market_day": self.world.line["market_day"],
                          "universe_rule": self.world.line["universe_rule"], "closed": False})
        self.assertIsNone(found["recommendation"])
        self.assertEqual(found["trials_on_line"], 4)
        self.assertEqual(len(found["unreviewed_trials"]), 4, "without a recommendation every trial of the line")
        self.assertEqual(found["interpretations"][0]["facts"][0]["trial"]["trial_id"], self.control["trial_id"])
        self.assertIsNotNone(found["interpretations"][0]["facts"][0]["headline"])
        self.assertEqual([gate["code"] for gate in found["gates"]], ["INTERPRETATION_REQUIRED"])
        self.assertEqual(found["review_every"], register.REVIEW_EVERY)
        self.assertEqual(found["facts"]["counts"]["research_attempts"], 4)
        with db.connect(self.profile, "reader") as conn:
            self.assertEqual(refused(status.research_state, conn, "no-such-line").code, "LINE_UNKNOWN")
            with mock.patch.dict(image.LAYOUTS, {"replay-contract@v99": {}}, clear=True):
                gate = status.research_state(conn)["gates"][-1]
        self.assertEqual((gate["code"], gate["missing"]), ("RUNTIME_UNSUPPORTED", ["rsi@1"]),
                         "without a recommendation or priority the line's start")


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
