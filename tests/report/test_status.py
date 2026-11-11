"""The trial counts of `research status` (user decision 2026-10-20): reproductions and trials the
product stopped before the strategy ran are listed apart and left out of the multiple-testing
counts; the multiple-testing reading of a line (trials on its contracts over overlapping windows,
their mean correlation and effective number); its comparison table, split by execution identity,
and the recommendation that names every candidate of the line's identity in it. A throwaway ledger
with the stand-in runtime; never the active ledger."""

from __future__ import annotations

from datetime import date, datetime
import json
import math
from pathlib import Path
import statistics
import tempfile
import unittest
from unittest import mock

from shared.errors import Refusal
from ledger import db, evidence, execution, judgments, lines, metrics, strategies
from registration import reproduction
from registration import precheck, register, seams as registration_seams
from replay import entry, reproduce
from report import runs, seams, status
from runtime import image
from tests.ledger.dolt import BINARY, IDENTITY, MARKET_COMMIT, RUNTIME, SKIP, market, pinned, reviewed, source
from tests.registration.world import RUNNER_ARGV, World, capture as capture_fixture
from tests.replay.world import ReplayWorld, registered_grid
from tests.report.test_reports import CANDIDATE_RETURNS, FINGERPRINT


def capture(native_exit=1, outcome="completed", summary="missing", failures="missing") -> dict:
    return {"stages": {"native": {"state": "exited", "exit_code": native_exit}}, "outcome": {"kind": outcome},
            "statuses": {"reports/summary.json": summary, "reports/runtime_failures.jsonl": failures}}


@unittest.skipUnless(BINARY, SKIP)
class OpenLinesStateTests(unittest.TestCase):
    def test_without_a_line_named_the_state_reads_the_only_open_line_and_reports_several(self):
        world = World("state-lines")
        self.addCleanup(world.close)
        mine = world.line["line"]
        with db.connect(world.profile, "reader") as conn:
            state = status.research_state(conn)
        self.assertEqual((state["line"]["name"], [item["name"] for item in state["open_lines"]]), (mine, [mine]))
        with pinned(date(2026, 1, 1), date(2026, 3, 1)):
            other = lines.select_line(world.conn, MARKET_COMMIT, "rsi@1", slug="rsi-wider", market=market(),
                                      reviews=reviewed(source("root")))["line"]
        with db.connect(world.profile, "reader") as conn:
            state, named = status.research_state(conn), status.research_state(conn, other)
        self.assertIsNone(state["line"])
        self.assertEqual([(gate["code"], gate["missing"]) for gate in state["gates"]],
                         [("LINE_AMBIGUOUS", [mine, other])])
        self.assertIsNone(state["facts"], "candidate list and research status are their own commands")
        self.assertEqual(state["open_lines"][1], {"name": other, "start": "rsi@1", "dev_start": "2026-01-01",
                                                  "dev_end": "2026-03-01", "market_commit": MARKET_COMMIT})
        self.assertEqual(named["line"]["name"], other)
        self.assertIsNone(status.research_status(world.profile)["comparison"])
        lines.close_line(world.profile, mine, b"rsi root summary")
        with db.connect(world.profile, "reader") as conn:
            self.assertEqual(status.research_state(conn)["line"]["name"], other)


class UndistinguishedRunsTests(unittest.TestCase):
    """The read `research state` gives for a due change of approach: newest back, reported, never refused."""
    CROSSING = {"evidence": {"mean_log_basic_interval": [-1.0, 1.0]}}
    EXCLUDING = {"evidence": {"mean_log_basic_interval": [0.1, 1.0]}}
    NO_CONTROL = {"evidence": None}

    def read(self, answers: dict) -> tuple[dict, list[int]]:
        asked: list[int] = []

        def answer(_profile, _bundle, trial_id, _at, **_):
            asked.append(trial_id)
            found = answers[trial_id]
            if isinstance(found, Refusal):
                raise found
            return found
        with mock.patch.object(status.comparison, "compare", side_effect=answer):
            return status._undistinguished_runs(None, "commit", [(trial_id, "bundle") for trial_id in answers], {}, []), asked

    def test_the_read_ends_at_the_latest_run_an_interval_tells_apart(self):
        found, asked = self.read({1: self.CROSSING, 2: self.EXCLUDING, 3: self.CROSSING, 4: self.CROSSING})
        self.assertEqual(found, {"trials": [3, 4], "uncompared": [], "distinguished": 2})
        self.assertEqual(asked, [4, 3, 2])

    def test_a_run_without_a_comparison_neither_counts_nor_clears(self):
        refused_run = Refusal("SOURCE_REVIEW_FAILED", "stand-in", write_status="not_written")
        found, _ = self.read({1: self.EXCLUDING, 2: self.CROSSING, 3: refused_run, 4: self.NO_CONTROL, 5: self.CROSSING})
        self.assertEqual(found, {"trials": [2, 5], "uncompared": [3, 4], "distinguished": 1})

    def test_the_read_stops_at_review_every_of_either_kind(self):
        counted, asked = self.read({trial_id: self.CROSSING for trial_id in range(1, 9)})
        self.assertEqual(counted["trials"], [4, 5, 6, 7, 8])
        self.assertEqual(len(asked), register.REVIEW_EVERY)
        outage, asked = self.read({trial_id: Refusal("LEDGER_UNAVAILABLE", "stand-in", write_status="not_written") for trial_id in range(1, 9)})
        self.assertEqual(outage, {"trials": [], "uncompared": [4, 5, 6, 7, 8], "distinguished": None})
        self.assertEqual(len(asked), register.REVIEW_EVERY)


class StoppedBeforeStrategyTests(unittest.TestCase):
    def test_only_a_completed_nonzero_exit_without_summary_or_strategy_failures_is_stopped(self):
        load = json.dumps({"stage": "load", "exception_type": "Refusal", "code": "BINDING_MISMATCH", "count": 1})
        bar = json.dumps({"stage": "on_bar", "exception_type": "AttributeError"})
        cases = [(capture(), None, True), (capture(), load.encode(), True),
                 (capture(), (load + "\n" + bar).encode(), False), (capture(), b"not json", False),
                 (capture(summary="captured"), None, False), (capture(native_exit=0), None, False),
                 (capture(outcome="interrupted"), None, False), (None, None, False)]
        for found, failures, expected in cases:
            with self.subTest(capture=found, failures=failures):
                self.assertIs(status.stopped_before_strategy(found, failures), expected)


class UnresolvedMarketTests(unittest.TestCase):
    """The gate for a line whose pinned market commit the active market no longer holds."""

    LINE = {"market_commit": "a" * 32}

    def test_only_a_commit_the_active_market_does_not_hold_is_gated(self):
        cases = [(None, []), ({"database": "market", "commit": "a" * 32}, [])]
        for found, expected in cases:
            with self.subTest(found=found), seams.use(market_commit=lambda ref: found):
                self.assertEqual(status._unresolved_market(self.LINE), expected)
        with seams.use(market_commit=lambda ref: {"database": "market", "commit": None}):
            gate, = status._unresolved_market(self.LINE)
        self.assertEqual((gate["code"], gate["missing"]), ("MARKET_COMMIT_UNRESOLVED", ["a" * 32]))

    def test_a_run_reads_the_market_profile_its_market_database_names_else_the_active_one(self):
        local = {"name": "market", "kind": "market", "role": "active", "root": "/srv/market"}
        copy = {"name": "market-copy", "kind": "market", "root": "/srv/copy"}
        with tempfile.TemporaryDirectory() as home, mock.patch.dict("os.environ", {"TRADE_LEDGER_HOME": home}):
            for profile in (local, copy):
                Path(home, f"{profile['name']}.json").write_text(json.dumps(profile), encoding="utf-8")
            self.assertEqual(seams._market_profile("market"), local, "market-copy.json sorts first")
            self.assertEqual(seams._market_profile("market-copy"), copy)
            self.assertEqual(seams._market_profile(None), local)
            Path(home, "market.json").write_text(json.dumps({**local, "role": "isolated"}), encoding="utf-8")
            for name in (None, "absent"):
                with self.subTest(name=name), self.assertRaises(Refusal) as caught:
                    seams._market_profile(name)
                self.assertEqual(caught.exception.code, "MARKET_RETURNS_UNAVAILABLE")

    def test_the_default_seam_tells_an_unknown_commit_from_an_unreadable_market(self):
        from datetime import date
        from market import files
        from tests.market.directory import directory, forged
        profile = {**directory(self.addCleanup), "name": "market", "kind": "market", "role": "active"}
        forged(profile, "bar", date(2025, 1, 1), rows=dict(zip(
            ("symbol", "price_type", "ts_open", "open", "high", "low", "close", "volume"),
            (["BTCUSDT"], ["LAST"], [1735689600000], [1], [1], [1], [1], [1]), strict=True)))
        commit = files.commit_of(date(2025, 1, 1))
        with mock.patch.object(seams, "_market_profile", return_value=profile):
            self.assertEqual(seams._market_commit("a" * 32), {"database": "market", "commit": None})
            self.assertEqual(seams._market_commit(commit), {"database": "market", "commit": commit})
            self.assertEqual(seams._market_commit(files.commit_of(date(2025, 1, 2))), {"database": "market", "commit": None})
        with mock.patch.object(seams, "_market_profile", return_value={**profile, "root": profile["root"] + "-absent"}):
            self.assertIsNone(seams._market_commit("a" * 32))
        with mock.patch.object(seams, "_market_profile",
                               side_effect=Refusal("MARKET_RETURNS_UNAVAILABLE", "no profile", write_status="not_written")):
            self.assertIsNone(seams._market_commit("a" * 32))


@unittest.skipUnless(BINARY, SKIP)
class TrialCountTests(unittest.TestCase):
    def setUp(self):
        self.world = world = ReplayWorld("status")
        self.addCleanup(world.close)
        world.fingerprint = {"fills": {"rows": 2, "sha256": "1" * 64}}

    def replay(self, ref: str, registration: int) -> dict:
        return entry.run(self.world.profile, self.world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                         registration=registration)

    def test_history_keeps_replaced_text_subjects_and_pinned_pages_without_changing_gates(self):
        world = self.world
        first = judgments.add_judgment(world.profile, "interpretation", world.line["line"],
                                       db.head_commit(world.conn), "original conclusion",
                                       subjects=[{"role": "about", "candidate": "rsi@1"}])
        for _ in range(20):
            world.judge("priority")
        last = judgments.add_judgment(world.profile, "interpretation", world.line["line"],
                                      db.head_commit(world.conn), "corrected conclusion",
                                      subjects=[{"role": "about", "candidate": "rsi@1"}],
                                      supersedes=first["judgment_id"])
        with db.connect(world.profile, "reader") as conn:
            default = status.research_state(conn)
            first_page = status.research_state(conn, history=True)
            self.assertEqual(default["judgment_history"], {"total": 22, "superseded": 1,
                                                           "entries": [], "next_before": None})
            self.assertEqual(default["gates"], first_page["gates"])
            self.assertEqual(default["interpretations"], first_page["interpretations"])
            history = first_page["judgment_history"]
            self.assertEqual(len(history["entries"]), 20)
            self.assertEqual(history["entries"][0]["supersedes"], first["judgment_id"])
            older = status.research_state(conn, at=first_page["ledger_commit"], history_before=history["next_before"])
            tail = older["judgment_history"]
            self.assertEqual(len(tail["entries"]), 2)
            original = tail["entries"][-1]
            self.assertEqual((original["body"], original["superseded_by"]),
                             ("original conclusion", last["judgment_id"]))
            self.assertEqual(original["subjects"][0]["strategy_id"], "rsi")
            self.assertIsNone(tail["next_before"])
            pinned = status.research_state(conn, at=first["ledger_commit"], history=True)
            self.assertEqual(pinned["judgment_history"]["total"], 1)
            self.assertIsNone(pinned["judgment_history"]["entries"][0]["superseded_by"])

    def test_reproductions_and_trials_stopped_before_the_strategy_are_not_counted(self):
        world = self.world
        registration, (kept,) = registered_grid(world, ["kept"])
        passed = self.replay(kept, registration)
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": passed["trial_id"]}])
        registration, (stopped,) = registered_grid(world, ["stopped"])
        world.scenario = {"skip_reports": True}  # the runner exits 1 before writing any report
        refused = self.replay(stopped, registration)
        world.scenario = {}
        before = status.research_status(world.profile)
        self.assertEqual(refused["status"], "invalid")
        self.assertEqual(before["excluded_trials"], {"reproductions": [],
                                                     "stopped_before_strategy": [refused["trial_id"]]})
        done = reproduce.reproduce(passed["trial_id"], world.output("again"), ledger=world.profile, market=world.market)
        after = status.research_status(world.profile)
        self.assertEqual(after["excluded_trials"]["reproductions"], [done["reproduction_trial_id"]])
        self.assertEqual((after["trials"], after["multiple_testing"]), (before["trials"], before["multiple_testing"]))
        self.assertEqual(after["multiple_testing"]["research_trials"], 1, "only the trial whose strategy ran")
        self.assertEqual(after["invalid_research_runs"], 1, "the attempt itself still counts as invalid")


def trial(start: str, end: str, instruments=("BTCUSDT",), purpose="research") -> dict:
    return {"trade_start": datetime.fromisoformat(start), "trade_end": datetime.fromisoformat(end),
            "instruments": list(instruments), "purpose": purpose}


class MultipleTestingTests(unittest.TestCase):
    """The pure parts of the multiple-testing reading (findings 20261025-10 and 20261025-35)."""

    WINDOW = (datetime(2025, 10, 1), datetime(2026, 10, 1))

    def test_a_trial_counts_when_it_traded_a_line_contract_in_an_overlapping_window(self):
        cases = [(trial("2025-10-01", "2026-10-01"), True, "the same window"),
                 (trial("2025-01-01", "2026-10-01"), True, "a longer window holding it"),
                 (trial("2025-10-01", "2025-10-03", purpose="precheck"), True, "a short window inside it"),
                 (trial("2022-10-01", "2025-10-02"), True, "one shared day"),
                 (trial("2022-10-01", "2025-10-01"), False, "ends where the window starts"),
                 (trial("2026-10-01", "2026-11-01"), False, "starts where the window ends"),
                 (trial("2025-10-01", "2026-10-01", ("ETHUSDT",)), False, "another contract"),
                 (trial("2025-10-01", "2026-10-01", ("ETHUSDT", "BTCUSDT")), True, "a basket holding the contract")]
        for item, expected, note in cases:
            with self.subTest(note):
                self.assertEqual(status.overlapping_trials([item], {"BTCUSDT"}, *self.WINDOW) == [item], expected)

    def test_the_mean_correlation_and_effective_trials_match_a_hand_computed_matrix(self):
        # On days 1-4, corr(x, y) = 4/5, corr(x, z) = 3/5 and corr(y, z) = 0, so the mean is 7/15 and ten
        # trials are worth 7/15 + 8/15 * 10 = 5.8 independent ones. y's day 5 is not x's or z's and
        # changes none of them; w shares one day with each, so its pairs are left out.
        x = {1: 1.0, 2: 2.0, 3: 3.0, 4: 4.0}
        y = {1: 1.0, 2: 3.0, 3: 2.0, 4: 4.0, 5: 40.0}
        z = {1: 2.0, 2: 1.0, 3: 4.0, 4: 3.0}
        w = {1: 5.0, 9: 1.0}
        found = status.mean_correlation([x, y, z, w])
        self.assertAlmostEqual(found, 7 / 15)
        self.assertAlmostEqual(status.effective_trials(found, 10), 5.8)
        self.assertIsNone(status.mean_correlation([x, w]), "no pair with two common days")
        self.assertIsNone(status.mean_correlation([x, {1: 0.0, 2: 0.0, 3: 0.0}]), "a constant side has no correlation")

    def test_effective_trials_stay_between_one_and_the_trial_count(self):
        self.assertEqual(status.effective_trials(1.0, 30), 1.0, "perfectly correlated trials are one")
        self.assertEqual(status.effective_trials(0.0, 30), 30.0)
        self.assertEqual(status.effective_trials(-0.2, 30), 30.0, "a negative mean counts as independent")
        self.assertIsNone(status.effective_trials(None, 30))


def measured(annual, drawdown, sharpe, win) -> dict:
    values = dict(zip(status.TABLE_MEASURES, (annual, drawdown, sharpe, win), strict=True))
    return {name: {"value": value} for name, value in values.items()}


class RunMeasuresTests(unittest.TestCase):
    def test_the_command_line_offers_the_measures_research_runs_reads(self):
        from cli import main
        self.assertEqual(main.RUN_MEASURES, status.RUN_MEASURES)


class DominanceTests(unittest.TestCase):
    def test_a_run_dominates_when_no_worse_on_all_four_and_better_on_one(self):
        base = measured(0.10, 0.20, 1.0, 0.5)
        self.assertTrue(status._dominates(measured(0.10, 0.15, 1.0, 0.5), base), "a smaller drawdown is better")
        self.assertTrue(status._dominates(measured(0.12, 0.20, 1.1, 0.6), base))
        self.assertFalse(status._dominates(base, base), "equal on all four is no dominance")
        self.assertFalse(status._dominates(measured(0.20, 0.30, 2.0, 0.9), base), "a larger drawdown trades off")
        self.assertFalse(status._dominates(measured(0.20, 0.10, 2.0, None), base), "a missing measure never compares")


@unittest.skipUnless(BINARY, SKIP)
class ComparisonTableTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("comparison")
        cls.addClassCleanup(world.close)
        world.fingerprint = FINGERPRINT
        registration, cls.refs = registered_grid(world, ["first", "second"])
        cls.runs = {}
        for ref, returns in zip(cls.refs, (None, CANDIDATE_RETURNS), strict=True):
            world.scenario = {"returns": returns} if returns else {}
            cls.runs[ref] = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                                      registration=registration)
            world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.runs[ref]["trial_id"]}])
        world.scenario = {}

    def test_the_multiple_testing_reading_takes_its_correlation_and_variance_from_the_line_runs(self):
        counts = status.research_status(self.world.profile)
        found, table = counts["multiple_testing"], counts["comparison"]
        ids = [self.runs[ref]["trial_id"] for ref in self.refs]
        with db.read_as_of(self.world.profile) as conn:
            rows = conn.rows("SELECT trial_id, trade_start FROM trial WHERE trial_id IN (%s, %s) ORDER BY trial_id",
                             tuple(ids))
            series = [{int(ts): float(value) for ts, value in conn.rows(
                "SELECT ts_event_ns, native_return FROM run_return WHERE trial_id = %s AND ts_event_ns >= %s",
                (trial_id, metrics.moment_ns(start)))} for trial_id, start in rows]
            instruments = sorted({name for (name,) in conn.rows(
                "SELECT instrument_id FROM trial_instrument WHERE trial_id IN (%s, %s)", tuple(ids))})
        self.assertEqual((found["line"], found["instruments"], found["research_trials"], found["runs_with_returns"]),
                         (self.world.line["line"], instruments, 2, 2))
        self.assertGreaterEqual(found["all_purpose_trials"], found["research_trials"])
        self.assertAlmostEqual(found["mean_correlation"], statistics.correlation(*(
            [days[day] for day in sorted(days)] for days in series)))
        self.assertAlmostEqual(found["effective_trials"], status.effective_trials(found["mean_correlation"], 2))
        sharpes = [item["measures"]["sharpe_365"]["value"] / math.sqrt(365) for item in table["runs"]]
        self.assertAlmostEqual(found["daily_sharpe_variance"], statistics.variance(sharpes),
                               msg="the report's Sharpe ratios, per day")

    def test_the_table_lists_every_available_run_with_its_report_measures_and_dominance(self):
        table = status.research_status(self.world.profile)["comparison"]
        self.assertEqual((table["line"], table["dev_start"], table["dev_end"], table["universe_rule"]),
                         (self.world.line["line"], "2026-01-01", "2026-02-01", self.world.line["universe_rule"]))
        self.assertEqual(table["candidates"], sorted(self.refs))
        self.assertEqual([item["trial_id"] for item in table["runs"]], [self.runs[ref]["trial_id"] for ref in self.refs])
        for item in table["runs"]:
            report = runs.run_report(self.world.profile, item["trial_id"])
            self.assertEqual({name: item["measures"][name]["value"] for name in table["measures"]},
                             {name: report["headline"][name]["value"] for name in table["measures"]},
                             "the single-run report's measures, not a recomputation")
        first, second = table["runs"]
        for item, other in ((first, second), (second, first)):
            dominated = status._dominates(other["measures"], item["measures"])
            self.assertEqual(item["dominated_by"], [other["trial_id"]] if dominated else [])
            complete = all(item["measures"][name]["value"] is not None for name in table["measures"])
            self.assertEqual(item["non_dominated"], (not dominated) if complete else None)

    def test_x_a_line_whose_candidates_are_on_a_contract_without_layout_is_gated(self):
        first, second = self.refs
        self.world.judge("priority", subjects=[{"role": "parent", "candidate": first},
                                               {"role": "control", "candidate": second}])
        with db.connect(self.world.profile, "reader") as conn:
            self.assertNotIn("RUNTIME_UNSUPPORTED", [gate["code"] for gate in status.research_state(conn)["gates"]])
            with mock.patch.dict(image.LAYOUTS, {"replay-contract@v99": {}}, clear=True):
                gate = status.research_state(conn)["gates"][-1]
        self.assertEqual((gate["code"], gate["missing"]), ("RUNTIME_UNSUPPORTED", sorted(self.refs)))
        self.assertIn(strategies.RUNTIME_CONTRACT, gate["message"])
        self.assertIn("replay-contract@v99", gate["message"])

    def test_x_a_candidate_whose_run_reached_a_newer_image_is_not_gated(self):
        first, second = self.refs
        self.world.judge("priority", subjects=[{"role": "parent", "candidate": first},
                                               {"role": "control", "candidate": second}])
        def reproduce_all(contract: str) -> None:
            digest = "sha256:" + "8" * 64
            runtime = {**RUNTIME, "image_ref": "ghcr.io/x/y@" + digest, "image_digest": digest,
                       "runtime_contract": contract, "inspection": {**RUNTIME["inspection"], "runtime_contract": contract}}
            for tag in ("first", "second"):
                self.world.open_precheck(source(tag), runtime=runtime, purpose="explore")

        def gates() -> list[str]:
            with db.connect(self.world.profile, "reader") as conn, \
                    mock.patch.dict(image.LAYOUTS, {"replay-contract@v99": {}}, clear=True), \
                    mock.patch.object(reproduction, "matches", return_value=True):
                return [gate["code"] for gate in status.research_state(conn)["gates"]]

        reproduce_all(strategies.RUNTIME_CONTRACT)
        self.assertIn("RUNTIME_UNSUPPORTED", gates(), "a reproduction under the old contract moved nothing")
        reproduce_all("replay-contract@v99")
        self.assertNotIn("RUNTIME_UNSUPPORTED", gates())

    def test_x_the_state_lists_the_runs_behind_the_current_image(self):
        trials = sorted(run["trial_id"] for run in self.runs.values())
        own = self.runs[self.refs[0]]
        with db.connect(self.world.profile, "reader") as conn:
            self.assertIsNone(status.research_state(conn)["runs_behind_image"], "unknown without the current image")
            digest = conn.one(f"SELECT {db.IMAGE_DIGEST} FROM trial WHERE trial_id = %s", (own["trial_id"],))["image_digest"]
            self.assertEqual(status.research_state(conn, current_image=digest)["runs_behind_image"], [])
            behind = status.research_state(conn, current_image="ghcr.io/x/y@sha256:new")
            self.assertEqual((behind["current_image"], behind["runs_behind_image"]), ("ghcr.io/x/y@sha256:new", trials))
        newer = "sha256:" + "9" * 64
        first = self.runs[self.refs[0]]["trial_id"]
        explore = self.world.open_precheck(source("first"), runtime={**RUNTIME, "image_ref": "ghcr.io/x/y@" + newer,
                                                                     "image_digest": newer}, purpose="explore")
        with db.connect(self.world.profile, "reader") as conn:
            self.assertEqual(status.research_state(conn, current_image=newer)["runs_behind_image"], trials,
                             "an explore that does not reproduce the run moves nothing")
            with mock.patch.object(reproduction, "matches", side_effect=lambda _, later, original, **__: (later, original) == (explore, first)):
                self.assertEqual(status.research_state(conn, current_image=newer)["runs_behind_image"],
                                 [trial_id for trial_id in trials if trial_id != first], "its reproduction on the image")

    def test_y_the_default_state_keeps_the_judgments_after_the_recommendation(self):
        first, second = self.refs
        self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first},
                                                     {"role": "about", "candidate": second}])
        later = self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.runs[first]["trial_id"]}])
        with db.connect(self.world.profile, "reader") as conn:
            default, full = status.research_state(conn), status.research_state(conn, full=True)
        self.assertEqual([item["judgment_id"] for item in default["interpretations"]], [later])
        self.assertEqual(default["earlier"], {"interpretations": len(full["interpretations"]) - 1,
                                              "search_exposures": len(full["search_exposures"])})
        self.assertGreater(len(full["interpretations"]), 1)
        self.assertIsNone(default["facts"])
        self.assertEqual(list(full)[:2], ["ledger_commit", "gates"], "a cut answer keeps the gates")
        self.assertEqual(full["facts"]["counts"]["research_attempts"], 2)
        self.assertIsNone(full["earlier"])
        self.assertEqual((default["recommendation"], default["gates"], default["unreviewed_trials"]),
                         (full["recommendation"], full["gates"], full["unreviewed_trials"]))

    def test_z_a_later_failed_review_lists_the_run_apart_and_flags_its_earlier_report(self):
        first, second = self.refs
        trial_id = self.runs[second]["trial_id"]
        before = status.research_status(self.world.profile)["ledger_commit"]
        with db.read_as_of(self.world.profile) as conn:
            source_sha256 = strategies.read_candidate(conn, second)["source_sha256"]
            (precheck_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s",
                                        (source_sha256,))
        precheck.record_review(self.world.profile, self.world.review_body(
            precheck_id, "failed", causal={"status": "failed", "note": "found after the run was sealed"}), "reviewer-z")
        table = status.research_status(self.world.profile)["comparison"]
        self.assertEqual([item["trial_id"] for item in table["runs"]], [self.runs[first]["trial_id"]])
        (apart,) = table["without_economic_evidence"]
        self.assertEqual((apart["candidate"], apart["trial_id"]), (second, trial_id))
        self.assertTrue(any(reason.startswith("SOURCE_REVIEW_FAILED") for reason in apart["reasons"]))
        earlier = runs.run_report(self.world.profile, trial_id, before)
        self.assertIsNotNone(earlier["headline"], "the historical reading stays readable")
        self.assertTrue(any("at the research head" in item and "SOURCE_REVIEW_FAILED" in item
                            for item in earlier["limitations"]))
        self.assertFalse(any("at the research head" in item
                             for item in runs.run_report(self.world.profile, self.runs[first]["trial_id"], before)
                             ["limitations"]), "a run the head still qualifies carries no such note")

@unittest.skipUnless(BINARY, SKIP)
class SameKeyLineCandidatesTests(unittest.TestCase):
    """Lines on one market commit and window, with runs of one execution identity (finding 20261105-01):
    a recommendation names the line's own candidates and its start; other lines' runs stay in the table."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("same-key-candidates")
        cls.addClassCleanup(world.close)
        world.fingerprint = FINGERPRINT
        cls.mine, cls.mine_source = cls.run_one("mine")
        cls.other = cls.line("other", source("root"), "rsi@1")
        cls.theirs, _ = cls.run_one("theirs", line=cls.other)
        cls.started = cls.line("started", cls.mine_source, cls.mine)
        cls.follows, _ = cls.run_one("follows", line=cls.started)

    @classmethod
    def run_one(cls, tag: str, **kwargs) -> tuple[str, bytes]:
        published = cls.world.publish(tag, parent=None)
        ref = published["candidate"]
        registration = cls.world.register(cls.world.body([ref], {ref: cls.world.prechecked(published["source"])}),
                                          **kwargs)["registration_id"]
        entry.run(cls.world.profile, cls.world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV, registration=registration)
        return ref, published["source"]

    @classmethod
    def line(cls, slug: str, data: bytes, start: str) -> str:
        with pinned():
            return lines.select_line(cls.world.conn, MARKET_COMMIT, start, slug=slug, market=market(),
                                     reviews=reviewed(data))["line"]

    def table(self, line: str) -> dict:
        return status.research_status(self.world.profile, line=line)["comparison"]

    def test_another_lines_candidate_of_the_same_identity_stays_in_runs_and_out_of_candidates(self):
        table = self.table(self.other)
        rows = {item["candidate"]: item for item in table["runs"]}
        self.assertEqual(set(rows), {self.mine, self.theirs, self.follows})
        self.assertEqual(rows[self.mine]["execution_identity"], rows[self.theirs]["execution_identity"],
                         "the two lines share an identity, so identity alone would name both")
        self.assertEqual(table["candidates"], [self.theirs])
        self.assertEqual(self.table(self.world.line["line"])["candidates"], [self.mine])

    def test_the_lines_start_is_named_though_another_line_ran_it(self):
        self.assertEqual(self.table(self.started)["candidates"], sorted([self.mine, self.follows]))

    def test_research_runs_lists_a_lines_table_and_names_the_line_each_run_belongs_to(self):
        listed = status.research_runs(self.world.profile, line=self.other)
        self.assertEqual({item["trial_id"] for item in listed["runs"]},
                         {item["trial_id"] for item in self.table(self.other)["runs"]}, "the comparison table's runs")
        owners = {item["candidate"]: item["lines"] for item in listed["runs"]}
        self.assertEqual(owners, {self.mine: [self.world.line["line"]], self.theirs: [self.other],
                                  self.follows: [self.started]}, "the line a run belongs to, not every line it fits")
        self.assertEqual(len(listed["groups"]), 1, "one identity across the three lines")

    def test_a_recommendation_names_the_lines_own_candidates_and_its_start(self):
        world = self.world
        compared = lambda line, at: status.compared_candidates(world.profile, line, at)
        head = db.head_commit(world.conn)
        with self.assertRaises(Refusal) as caught:
            judgments.add_judgment(world.profile, "recommendation", self.started, head, "the start left out",
                                   subjects=[{"role": "recommended", "candidate": self.follows}], compared=compared)
        self.assertEqual((caught.exception.code, caught.exception.missing), ("RECOMMENDATION_INCOMPLETE", (self.mine,)))
        judgments.add_judgment(world.profile, "recommendation", self.other, head, "names its own alone",
                               subjects=[{"role": "recommended", "candidate": self.theirs}], compared=compared)


OTHER_DIGEST = "sha256:" + "c" * 64
OTHER_IDENTITY = {**IDENTITY, "image_ref": "ghcr.io/qoeop/trade-runtime@" + OTHER_DIGEST, "image_digest": OTHER_DIGEST}
BETTER_RETURNS = [0.004, -0.0002, 0.003, -0.0001, 0.002]  # beats CANDIDATE_RETURNS on every measure it moves


@unittest.skipUnless(BINARY, SKIP)
class ExecutionIdentityTests(unittest.TestCase):
    """Two runs on the line's first image, then a better one on a rebuilt image (finding 20261025-25):
    rows carry their identity, dominance stays within one, and the recommendation and the unreviewed
    trials follow the line's latest identity."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("identity")
        cls.addClassCleanup(world.close)
        world.fingerprint = FINGERPRINT
        cls.selected = db.head_commit(world.conn)
        registration, cls.refs = registered_grid(world, ["first", "second"])
        cls.trials = {}
        for ref, returns in zip(cls.refs, (None, CANDIDATE_RETURNS), strict=True):
            world.scenario = {"returns": returns} if returns else {}
            cls.trials[ref] = entry.run(world.profile, world.market, MARKET_COMMIT, ref, None, RUNNER_ARGV,
                                        registration=registration)["trial_id"]
            world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.trials[ref]}])
        cls.before = db.head_commit(world.conn)
        published = world.publish("third", parent=None)
        cls.third = published["candidate"]
        precheck_id = world.open_precheck(published["source"], runtime={**RUNTIME, **OTHER_IDENTITY})
        capture_fixture(world.conn, precheck_id, published["source"])
        review = precheck.record_review(world.profile, world.review_body(precheck_id), "reviewer-b")["review_id"]
        with registration_seams.use(resolve_runtime=lambda ref: dict(OTHER_IDENTITY)):
            registration = world.register(world.body([cls.third], {cls.third: review}))["registration_id"]
            world.scenario = {"returns": BETTER_RETURNS}
            cls.trials[cls.third] = entry.run(world.profile, world.market, MARKET_COMMIT, cls.third, None,
                                              RUNNER_ARGV, registration=registration)["trial_id"]
        world.scenario = {}
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.trials[cls.third]}])

    def test_a_rows_carry_their_identity_and_dominance_stays_within_one(self):
        table = status.research_status(self.world.profile)["comparison"]
        rows = {item["candidate"]: item for item in table["runs"]}
        by_trial = {item["trial_id"]: item for item in table["runs"]}
        first, second = (rows[ref]["execution_identity"] for ref in self.refs)
        third = rows[self.third]["execution_identity"]
        self.assertEqual(first, second)
        self.assertEqual((first["runtime_contract"], first["image_digest"]),
                         (IDENTITY["runtime_contract"], IDENTITY["image_digest"]))
        self.assertEqual((third["runtime_contract"], third["image_digest"]),
                         (IDENTITY["runtime_contract"], OTHER_DIGEST))
        self.assertNotEqual(first["keys"], third["keys"])
        with db.read_as_of(self.world.profile) as conn:
            receipt = evidence.load_bundle(conn, f"trial-{self.trials[self.third]}-start")["files"][execution.COVERAGE]
        self.assertEqual(third["execution"], json.loads(receipt)["effective_config"]["account"]["execution"])
        better, worse = rows[self.third], rows[self.refs[1]]
        self.assertTrue(status._dominates(better["measures"], worse["measures"]),
                        "the rebuilt image's run would dominate the old one if they were compared")
        self.assertNotIn(better["trial_id"], worse["dominated_by"])
        for item in table["runs"]:
            for other in item["dominated_by"]:
                self.assertEqual(by_trial[other]["execution_identity"]["keys"],
                                 item["execution_identity"]["keys"])
        self.assertTrue(better["non_dominated"], "alone in its identity")
        self.assertEqual(table["execution_identity"], third, "the line's latest trial sets its identity")
        self.assertEqual(table["candidates"], [self.third])

    def test_b_a_recommendation_names_the_candidates_of_the_lines_identity_at_its_commit(self):
        world = self.world
        self.assertEqual(status.compared_candidates(world.profile, world.line["line"], self.before), sorted(self.refs))
        self.assertEqual(status.compared_candidates(world.profile, world.line["line"], self.selected), [],
                         "a line without a trial of its own has no identity yet")
        with self.assertRaises(Refusal) as caught:
            judgments.add_judgment(world.profile, "recommendation", world.line["line"], self.before, "old image",
                                   subjects=[{"role": "recommended", "candidate": self.third}],
                                   compared=lambda line, at: status.compared_candidates(world.profile, line, at))
        self.assertEqual((caught.exception.code, caught.exception.missing),
                         ("RECOMMENDATION_INCOMPLETE", tuple(sorted(self.refs))))

    def test_c_the_unreviewed_trials_are_those_of_the_lines_identity_and_the_count_keeps_every_one(self):
        with db.connect(self.world.profile, "reader") as conn:
            empty = status.research_state(conn, at=self.selected)
            old = status.research_state(conn, at=self.before)
            new = status.research_state(conn)
        self.assertEqual((empty["execution_identity"], empty["unreviewed_trials"]), (None, []))
        self.assertEqual(old["unreviewed_trials"], [self.trials[ref] for ref in self.refs])
        self.assertEqual(new["unreviewed_trials"], [self.trials[self.third]])
        self.assertEqual(new["execution_identity"]["image_digest"], OTHER_DIGEST)
        self.assertEqual(new["trials_on_line"], 3, "the trial count still counts every identity")

    def test_c_research_runs_groups_by_identity_and_orders_by_one_measure(self):
        listed = status.research_runs(self.world.profile)
        rows = {item["trial_id"]: item for item in listed["runs"]}
        first, second, third = (self.trials[ref] for ref in [*self.refs, self.third])
        self.assertEqual((listed["runs_listed"], [item["trial_id"] for item in listed["runs"]]),
                         (3, sorted(rows)), "every run, by trial ID without --by")
        self.assertEqual(rows[first]["group"], rows[second]["group"])
        self.assertNotEqual(rows[first]["group"], rows[third]["group"])
        self.assertEqual({group["image_digest"] for group in listed["groups"]}, {IDENTITY["image_digest"], OTHER_DIGEST})
        for item in listed["runs"]:
            headline = runs.run_report(self.world.profile, item["trial_id"])["headline"]
            self.assertEqual({key: item["measures"][key] for key in headline},
                             {key: value["value"] for key, value in headline.items()}, "the report's own values")
        for by, descending in (("sharpe_365", True), ("mark_max_drawdown", False)):
            ordered = status.research_runs(self.world.profile, by=by)["runs"]
            values = [item["measures"][by] for item in ordered if item["measures"][by] is not None]
            self.assertEqual(values, sorted(values, reverse=descending), by)
            self.assertEqual(values, [item["measures"][by] for item in ordered][:len(values)], "nulls last")
        kept = status.research_runs(self.world.profile, by="sharpe_365", limit=1)
        self.assertEqual((kept["runs_listed"], len(kept["runs"]), [group["group"] for group in kept["groups"]]),
                         (3, 1, [kept["runs"][0]["group"]]), "groups and lines cover the runs kept")
        self.assertEqual([line["line"] for line in kept["lines"]], [self.world.line["line"]])

    def test_d_a_recommendation_of_the_new_identity_need_not_name_the_old_one(self):
        self.world.judge("recommendation", subjects=[{"role": "recommended", "candidate": self.third}])
        with db.connect(self.world.profile, "reader") as conn:
            self.assertEqual(status.research_state(conn)["unreviewed_trials"], [])


if __name__ == "__main__":
    unittest.main()
