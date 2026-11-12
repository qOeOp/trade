"""If this fails, `research graph` no longer rebuilds a line from the ledger alone as a valid,
repeatable research-graph@3 document: versions with their source, runs and measures, the recommendation
(a version the recommendation only names as `about` is not marked kept),
a failed review that masks a run and one availability ignores for a run, the judgments as events, the targets in force for the line and
only the line's own runs and versions, which `line list` names for every line; or a graph is drawn while the ledger service is unreachable, whose missing
comparisons would read as research facts. A throwaway ledger, never the
active one."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from ledger import db, execution, lines, metrics, strategies, targets
from shared.errors import Refusal
from shared.refusals import refuse
from registration import precheck, register
from replay import entry
from report import comparison, graph, status
from tests.ledger.dolt import BINARY, MARKET_DAY, SKIP, market as line_market, pinned
from tests.registration.world import RUNNER_ARGV, capture
from tests.replay.world import ReplayWorld, registered_grid
from tests.report.test_reports import CANDIDATE_RETURNS, FINGERPRINT

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ide"))
from research_graph import contract, layout


class ComparisonIntervalTests(unittest.TestCase):
    def crosses(self, **intervals):
        found = {"control_trial_id": 1, "evidence": {"mean_daily_log_difference": 1e-5, **intervals}}
        with patch.object(comparison, "compare", return_value=found):
            return graph._comparison(None, 1, 2, "commit", {}, [])[0]["intervals_cross_zero"]

    def test_candidate_and_control_are_told_apart_when_any_interval_excludes_zero(self):
        crossing = [-1.0, 1.0]
        for name in ("mean_log_basic_interval", "mean_log_studentized_interval", "annual_return_difference_interval"):
            intervals = {"mean_log_basic_interval": crossing, "mean_log_studentized_interval": crossing,
                         "annual_return_difference_interval": crossing}
            self.assertIs(self.crosses(**intervals), True)
            self.assertIs(self.crosses(**{**intervals, name: [0.1, 1.0]}), False, name)
            self.assertIs(self.crosses(**{**intervals, name: [-1.0, -0.1]}), False, name)

    def test_an_empty_interval_excludes_nothing_and_no_interval_gives_no_reading(self):
        self.assertIs(self.crosses(mean_log_basic_interval=[-1.0, 1.0], mean_log_studentized_interval=None,
                                   annual_return_difference_interval=None), True)
        self.assertIsNone(self.crosses(mean_log_basic_interval=[None, None], mean_log_studentized_interval=None))


class RecommendationHoldTests(unittest.TestCase):
    class Ledger:
        """The three reads _recommendation makes: judgments, the recommended subjects, research trials."""
        def __init__(self, judgments, named, trials):
            self.judgments, self.named, self.trials = judgments, named, trials

        def dicts(self, sql, params=()):
            return self.judgments if "FROM judgment" in sql else self.trials

        def rows(self, sql, params=()):
            return self.named

    def test_a_re_recommendation_keeps_the_hold_from_the_first_judgment_naming_the_version(self):
        """Each recommendation supersedes the previous one; the hold still starts at the first of the unbroken run
        naming the version, as the drawn graph's summary counts it (layout: recommendations_unchanged)."""
        judgments = [{"judgment_id": 1, "kind": "recommendation", "created_at": date(2026, 1, 1), "supersedes": None},
                     {"judgment_id": 2, "kind": "recommendation", "created_at": date(2026, 1, 3), "supersedes": 1}]
        trials = [{"trial_id": 10, "source_sha256": "a", "created_at": date(2026, 1, 2), "status": None},
                  {"trial_id": 11, "source_sha256": "a", "created_at": date(2026, 1, 4), "status": None}]
        ledger = self.Ledger(judgments, [(1, "s", 1), (2, "s", 1)], trials)
        found = graph._recommendation(ledger, 1, {10, 11}, [], {}, [])
        self.assertEqual((found["recommended"], found["since"], found["runs_since"]), ("s@1", "2026-01-01", 2))
        ledger.named = [(1, "s", 2), (2, "s", 1)]
        found = graph._recommendation(ledger, 1, {10, 11}, [], {}, [])
        self.assertEqual((found["since"], found["runs_since"]), ("2026-01-03", 1),
                         "a change of version restarts the hold")


@unittest.skipUnless(BINARY, SKIP)
class ResearchGraphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = world = ReplayWorld("graph")
        cls.addClassCleanup(world.close)
        world.fingerprint = FINGERPRINT
        cls.registration, cls.refs = registered_grid(world, ["first", "second"])
        cls.runs = {}
        for ref, returns in zip(cls.refs, (None, CANDIDATE_RETURNS), strict=True):
            world.scenario = {"returns": returns} if returns else {}
            cls.runs[ref] = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV,
                                      registration=cls.registration)
            world.judge("interpretation", subjects=[{"role": "about", "trial_id": cls.runs[ref]["trial_id"]}])
        world.scenario = {}
        first, second = cls.refs
        world.judge("recommendation", subjects=[{"role": "recommended", "candidate": first},
                                                {"role": "about", "candidate": second}])
        with db.connect(world.profile, "writer") as conn:
            targets.set_targets(conn, None, 0.15, 0.2)

    def graph(self, **options):
        return graph.research_graph(self.world.profile, **options)

    def readings(self) -> dict:
        """The world's line's recommendation as `line list --readings` gives it."""
        listed = graph.line_list(self.world.profile, readings=True)["lines"]
        return next(item for item in listed if item["name"] == self.world.line["line"])["recommendation"]

    def test_1_the_line_is_a_valid_repeatable_graph_from_the_ledger(self):
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        self.assertEqual(found, self.graph(), "one ledger commit gives one graph")
        reading = status.research_status(self.world.profile, None, found["line"]["bundle"])["multiple_testing"]
        self.assertEqual(found["line"]["trial_counts"], {name: reading[name] for name in ("research_trials", "all_purpose_trials", "sweep_variants",
                                                                          "undeclared_sweeps", "trials_with_sweeps")},
                         "the graph's counts are the multiple-testing reading's")
        first, second = self.refs
        by_id = {c["id"]: c for c in found["candidates"]}
        self.assertLessEqual({first, second}, set(by_id))
        self.assertEqual((by_id[first]["status"], by_id[second]["status"]), ("recommended", "superseded"),
                         "a version the recommendation names only as `about` is not kept as a reference")
        run = next(t for t in by_id[second]["trials"] if t["purpose"] == "research")
        self.assertEqual((run["trial_id"], run["eligible"]), (self.runs[second]["trial_id"], True))
        self.assertIsNotNone(run["annual_return"], "an eligible run carries its measures")
        self.assertEqual(by_id[second]["registration"], str(self.registration))
        with db.read_as_of(self.world.profile) as conn:
            self.assertEqual(by_id[second]["source"], strategies.read_candidate(conn, second)["source"].decode(),
                             "a version carries its registered source")
        self.assertIsNotNone(by_id[second]["interpretation"])
        review = by_id[first]["reviews"][0]
        self.assertEqual(review["verdict"], "passed")
        self.assertEqual([c["name"] for c in review["checks"]], list(precheck.ITEMS))
        for check in review["checks"]:
            self.assertIn(f"{check['name']} checked against the capture", check["note"],
                          "passed reviews retain every check's explanation in the graph")
        recommendation = [e for e in found["events"] if e["kind"] == "recommendation"]
        self.assertEqual(recommendation[-1]["recommends"], first)
        self.assertEqual(self.readings()["recommended"], first)
        self.assertNotIn("recommendation", graph.line_list(self.world.profile)["lines"][0], "only with --readings")
        self.assertEqual(found["line"]["targets"], {"max_drawdown": 0.15, "annual_return": 0.2})
        with db.connect(self.world.profile, "reader") as conn:
            gates = [{"code": g["code"], "message": g["message"]} for g in status.research_state(conn, found["line"]["bundle"])["gates"]
                     if g["code"] in ("INTERPRETATION_REQUIRED", "REVIEW_DUE")]
        self.assertEqual(found["line"]["gates"], gates, "the line carries the registration gates `research state` reads")

    def test_1b_the_graph_reads_its_runs_once_as_a_listing(self):
        """E3: one batched read of the line's research runs, their captures without the bytes the graph never reads."""
        with patch.object(metrics, "load_runs", wraps=metrics.load_runs) as read, \
                patch.object(execution, "_bundles", wraps=execution._bundles) as bundles:
            found = self.graph()
        (call,) = read.call_args_list
        self.assertEqual((sorted(call.args[1]), call.kwargs), (sorted(r["trial_id"] for r in self.runs.values()),
                                                               {"listing": True}))
        self.assertTrue(bundles.call_args_list)
        for each in bundles.call_args_list:
            self.assertEqual(each.args[2], (execution.COVERAGE, *execution.LISTING_FILES))
        self.assertEqual(found, self.graph(), "the document is unchanged")

    def test_2_a_failed_review_masks_the_run_and_becomes_an_event(self):
        first, second = self.refs
        with db.read_as_of(self.world.profile) as conn:
            source = strategies.read_candidate(conn, second)["source_sha256"]
            (precheck_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s", (source,))
        notes = {
            "api": {"status": "passed", "note": "API inspected.\n\n- Orders use the pinned API.\n- Parameters match."},
            "causal": {"status": "failed", "note": "Found later.\n\nThe input arrives after submission."},
            "readiness": {"status": "no_opportunity", "note": "This capture does not reach the funding boundary."},
        }
        body = self.world.review_body(precheck_id, "failed", **notes)
        precheck.record_review(self.world.profile, body, "reviewer-g")
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        masked = next(c for c in found["candidates"] if c["id"] == second)
        run = next(t for t in masked["trials"] if t["purpose"] == "research")
        self.assertEqual((masked["status"], run["eligible"], run["annual_return"]), ("masked", False, None),
                         "a run without economic evidence shows no measures")
        self.assertIn("SOURCE_REVIEW_FAILED", run["ineligible_reason"])
        review = next(r for r in masked["reviews"] if r["verdict"] == "failed")
        checks = {c["name"]: c for c in review["checks"]}
        self.assertEqual(checks["causal"]["status"], "failed")
        for item in precheck.ITEMS:
            self.assertEqual(checks[item]["note"], body[item]["note"],
                             "every item's original paragraphs and lists reach the detail renderer")
        self.assertTrue(any(e["kind"] == "eligibility_change" and second in e["text"] for e in found["events"]))

    def test_2b_a_failed_review_availability_ignores_is_no_lost_evidence(self):
        world = self.world
        published = world.publish("resolved", parent=None)
        data, ref = published["source"], published["candidate"]
        def rows(count):
            return {name: {"rows": count, "sha256": "1" * 64} for name in ("fills", "orders", "positions")}
        quiet = world.open_precheck(data)
        capture(world.conn, quiet, data, fingerprint=rows(0))
        old = precheck.record_review(world.profile, world.review_body(
            quiet, "failed", activity={"status": "unresolved", "note": "no fills to inspect"}), "reviewer-g")["review_id"]
        passed = world.prechecked(data, fingerprint=rows(2))
        registration = world.register(world.body([ref], {ref: passed}))["registration_id"]
        trial_id = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV,
                             registration=registration)["trial_id"]
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        run = next(t for c in found["candidates"] if c["id"] == ref for t in c["trials"] if t["purpose"] == "research")
        self.assertEqual((run["trial_id"], run["eligible"]), (trial_id, True))
        event = next(e for e in found["events"] if e["kind"] == "eligibility_change" and e["ref"] == f"source review {old}")
        self.assertIn("without economic evidence by it: none", event["text"],
                      "the graph names the runs availability counts the review against, not every run of the source")
        self.assertIn(f"not counted for [{trial_id}]: zero-fill, zero-position activity failure resolved", event["text"])
        gate, = found["line"]["gates"]
        self.assertEqual(gate["code"], "INTERPRETATION_REQUIRED", "a research run without an interpretation holds the next registration")
        self.assertIn(str(trial_id), gate["message"])

    def test_2c_a_recommended_version_that_loses_its_evidence_is_masked(self):
        """CF-08: the recommendation stays an event, but the version is shown masked, not as the current pick."""
        world = self.world
        published = world.publish("recommended-then-failed", parent=None)
        data, ref = published["source"], published["candidate"]
        try:  # the earlier tests' runs are interpreted first, as the next registration requires
            register.require_line_records(world.conn, world.line["line_id"])
        except Refusal as exc:
            for missing in exc.missing:
                world.judge("interpretation", subjects=[{"role": "about", "trial_id": int(missing.split()[1])}])
        registration = world.register(world.body([ref], {ref: world.prechecked(data)}))["registration_id"]
        world.scenario = {"returns": CANDIDATE_RETURNS}
        trial_id = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV,
                             registration=registration)["trial_id"]
        world.scenario = {}
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
        named = [{"role": "recommended", "candidate": ref}]
        try:
            world.judge("recommendation", subjects=named)
        except Refusal as exc:  # a recommendation names every candidate of the comparison table
            world.judge("recommendation", subjects=named + [{"role": "about", "candidate": other} for other in exc.missing])
        drawn = self.graph()
        self.assertEqual({c["id"]: c["status"] for c in drawn["candidates"]}[ref], "recommended")
        summary = next(w for w in layout.build_view(drawn)["widgets"] if w["type"] == "summary")
        read = self.readings()
        self.assertEqual((read["recommended"], read["trial_id"], read["eligible"]), (ref, trial_id, True))
        self.assertEqual((read["annual_return"], read["max_drawdown"], read["research_runs"], read["runs_since"]),
                         (summary["reading"]["annual_return"], summary["reading"]["max_drawdown"], summary["research_runs"],
                          summary["runs_since_recommendation_changed"]),
                         "F3: line list --readings says what the drawn graph's summary says, without drawing it")
        with db.read_as_of(world.profile) as conn:
            (precheck_id,), = conn.rows("SELECT trial_id FROM trial WHERE purpose = 'precheck' AND source_sha256 = %s",
                                        (strategies.read_candidate(conn, ref)["source_sha256"],))
        precheck.record_review(world.profile, world.review_body(
            precheck_id, "failed", causal={"status": "failed", "note": "The input arrives after submission."}),
            "reviewer-g")
        found = self.graph()
        self.assertEqual(contract.check_graph(found), [])
        version = next(c for c in found["candidates"] if c["id"] == ref)
        self.assertEqual((version["status"], version["trials"][-1]["eligible"]), ("masked", False))
        self.assertEqual([e["recommends"] for e in found["events"] if e["kind"] == "recommendation"][-1], ref)
        read = self.readings()
        self.assertEqual((read["recommended"], read["eligible"], read["annual_return"]), (ref, False, None),
                         "the recommendation stays named, ineligible now and without measures")

    def test_3_a_new_line_on_another_window_shows_no_run_of_the_old_one(self):
        first, second = self.refs
        with pinned(date(2026, 2, 1), date(2026, 3, 1)):
            bundle = lines.select_line(self.world.conn, MARKET_DAY, first, slug="other-window",
                                       market=line_market(latest_complete_day=date(2026, 3, 31)),
                                       reviews=precheck.review_records)["line"]
        found = graph.research_graph(self.world.profile, bundle)
        self.assertEqual(contract.check_graph(found), [])
        self.assertEqual([t for c in found["candidates"] for t in c["trials"] if t["purpose"] == "research"], [],
                         "the old line's runs traded another window")
        status = {c["id"]: c["status"] for c in found["candidates"]}
        self.assertEqual(status[first], "unrun")
        self.assertNotIn(second, status, "a version linked to the start whose research runs are all the old line's "
                         "is not drawn as this line's unrun or failed version")
        self.assertEqual(set(status.values()), {"unrun"}, "only the start and versions never run remain")
        child = self.world.publish("child", parent=first)["candidate"]
        self.assertIn(child, {c["id"] for c in graph.research_graph(self.world.profile, bundle)["candidates"]},
                      "a derivation not yet run anywhere is still drawn beside the line")
        lineage = next(w for w in layout.build_view(found)["widgets"] if w["type"] == "lineage")
        self.assertEqual(lineage["trail"], [], "a line without a recommendation still lays out")
        old = graph.research_graph(self.world.profile, self.world.line["line"])
        self.assertTrue(any(t["purpose"] == "research" for c in old["candidates"] for t in c["trials"]))
        self.assertIn(second, {c["id"] for c in old["candidates"]})
        with patch.object(graph, "research_trials", wraps=graph.research_trials) as read:
            listed = {item["name"]: item["versions"] for item in graph.line_list(self.world.profile)["lines"]}
        self.assertEqual(read.call_count, 1, "E1: the research trials are read once for every line")
        for each in (bundle, self.world.line["line"]):
            self.assertEqual(set(listed[each]), {c["id"] for c in graph.research_graph(self.world.profile, each)["candidates"]},
                             "line list names the versions each line's graph draws")

    def test_4_an_unreachable_ledger_refuses_the_graph(self):
        line = self.world.line["line"]

        def ledger_down(*arguments, **options):
            raise refuse("LEDGER_UNAVAILABLE", "the ledger service is not running")
        with patch.object(comparison, "compare", ledger_down), self.assertRaises(Refusal) as caught:
            graph.research_graph(self.world.profile, line)
        self.assertEqual(caught.exception.code, "LEDGER_UNAVAILABLE")
        self.assertEqual(contract.check_graph(graph.research_graph(self.world.profile, line)), [],
                         "a run without a control is a missing comparison, not a refused graph")


@unittest.skipUnless(BINARY, SKIP)
class RetriedRegistrationTests(unittest.TestCase):
    """CF-07: a version is shown and compared through the registration its latest research run was bound
    through, not its first registration paired with a later registration's run (which the comparison refuses)."""

    def test_a_retried_version_is_compared_through_its_latest_runs_registration(self):
        world = ReplayWorld("graph-retry")
        self.addCleanup(world.close)
        world.fingerprint = FINGERPRINT
        published = world.publish("retried", parent=None)
        ref = published["candidate"]
        body = world.body([ref], {ref: world.prechecked(published["source"])})
        first = world.register(body)["registration_id"]
        world.scenario = {"audit_passed": False}
        failed = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=first)
        world.scenario = {"returns": CANDIDATE_RETURNS}
        retry = world.register({**body, "retry_of": first})["registration_id"]
        passed = entry.run(world.profile, world.market, MARKET_DAY, ref, None, RUNNER_ARGV, registration=retry)
        world.scenario = {}
        jobs = []

        def comparisons(profile, found, *rest):
            jobs.extend(found)
            return [(None, None)] * len(found)

        with patch.object(graph, "_comparisons", side_effect=comparisons):
            found = graph.research_graph(world.profile)
        (candidate,) = [c for c in found["candidates"] if c["id"] == ref]
        self.assertEqual([t["status"] for t in candidate["trials"] if t["purpose"] == "research"], ["invalid", "passed"],
                         f"the first attempt {failed['trial_id']} failed")
        self.assertEqual((candidate["registration"], jobs), (str(retry), [(retry, passed["trial_id"])]))


if __name__ == "__main__":
    unittest.main()
