"""Registration on a throwaway ledger: the lock and its refusals, binding a research trial to one grid
point in the trial's own transaction, and the line-record gates before the next registration."""

from __future__ import annotations

from datetime import date
import threading
import unittest
from unittest.mock import patch

from ledger import db, judgments, lines, strategies, trials
from shared.errors import Refusal
from registration import precheck, register
from tests.ledger.dolt import (MARKET_DAYS, BINARY, MARKET_COMMIT, RUNTIME, SKIP, coverage, market, product_bundle, reviewed,
                               pinned, sha, source)
from tests.registration.world import ACCOUNT, DAY, JAN, LINE_WINDOW, RUNNER_ARGV, World, capture, config

OTHER_DIGEST = "sha256:" + "c" * 64
OTHER_RUNTIME = {**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime@" + OTHER_DIGEST, "image_digest": OTHER_DIGEST}


def refused(function, *args, **kwargs) -> Refusal:
    try:
        function(*args, **kwargs)
    except Refusal as exc:
        return exc
    raise AssertionError(f"{function.__name__} did not refuse")


def runner_argv(trade_start: str = "2026-01-01", end: str = "2026-02-01") -> list[str]:
    return ["--start", "2025-12-31T00:00:00Z", "--trade-start", f"{trade_start}T00:00:00Z", "--end", f"{end}T00:00:00Z"]


@unittest.skipUnless(BINARY, SKIP)
class RegisterTests(unittest.TestCase):
    """Registrations of roots and of children of rsi@1, whose one research run is invalid (so a child
    may register without a control); no other research trial completes here."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = World("register")
        cls.addClassCleanup(world.close)
        cls.root_review = world.prechecked(source("root"))
        cls.child = world.publish("child")
        cls.child_review = world.prechecked(cls.child["source"])
        cls.registered = world.register(world.body(["rsi@1"], {"rsi@1": cls.root_review}, comparison=None))
        cls.root = cls.registered["registration_id"]
        world.seal_run(world.research_trial(cls.root, source("root")), "invalid")
        world.judge("interpretation", subjects=[{"role": "about", "registration_id": cls.root}])

    def setUp(self):
        self.world = self.__class__.world

    def derived(self, **overrides) -> dict:
        body = self.world.body([self.child["candidate"]], {self.child["candidate"]: self.child_review},
                               duties=["G3"])
        body.update(overrides)
        return body

    def code(self, body, **kwargs) -> str:
        seq = self.world.seq()
        exc = refused(self.world.register, body, **kwargs)
        self.assertEqual(self.world.seq(), seq, "a refused registration writes nothing")
        self.assertEqual(exc.write_status, "not_written")
        return exc.code

    def test_a_registration_locks_the_body_and_the_probed_execution_once(self):
        registered = self.registered
        plan = self.world.plan(self.root)
        execution = plan["execution"]
        self.assertEqual(execution, registered["execution"])
        self.assertEqual((execution["image_digest"], execution["market_day"], execution["universe_rule"],
                          execution["lifecycle_bundle"], execution["comparable_config_sha256"]),
                         (RUNTIME["image_digest"], MARKET_COMMIT, "pool-v1", None,
                          trials.comparable_config_sha256(config())))
        self.assertEqual((plan["line_id"], registered["line"]), (self.world.line["line_id"], self.world.line["line"]))
        self.assertEqual(plan["grid"], [{"candidate": "rsi@1", "source_sha256": sha(source("root")),
                                         "source_review_id": self.root_review}])
        self.assertEqual((plan["parent"], plan["change"], plan["comparison"], plan["control_trial_id"]),
                         (None, None, None, None), "a root has no parent, change, control or comparison design")
        body = self.world.body(["rsi@1"], {"rsi@1": self.root_review}, comparison=None)
        self.assertEqual(plan["body"], {key: body[key] for key in register.BODY_KEYS})
        again = self.world.register(body)
        self.assertEqual((again["registration_id"], again["replayed"], again["ledger_commit"]),
                         (self.root, True, registered["ledger_commit"]))

    def test_the_change_is_the_published_difference_and_the_body_does_not_write_it(self):
        """A body states no parent or change; the registration reads the grid candidates' difference byte for
        byte (none for a root), so a retyped copy that differs, say by a trailing newline, cannot arise."""
        noted = self.world.publish("noted", difference="cap volume at 5%\n")
        body = self.world.body([noted["candidate"]], {noted["candidate"]: self.world.prechecked(noted["source"])},
                               duties=["G3"])
        self.assertEqual(self.code({**body, "change": "cap volume at 5%\n"}), "REGISTRATION_INVALID",
                         "a body that writes change is refused, even with the same text")
        self.assertEqual(self.code({**body, "parent": "rsi@1"}), "REGISTRATION_INVALID")
        plan = self.world.plan(self.world.register(body)["registration_id"])
        self.assertEqual((plan["parent"], plan["change"]), ("rsi@1", "cap volume at 5%\n"))
        self.assertNotIn("change", plan["body"])

    def test_a_derived_registration_writes_its_source_originals_in_the_same_commit(self):
        original = self.world.tmp / "paper.txt"
        original.write_text("capacity limits momentum profits")
        body = self.derived(rationale={"external": "capacity binds (paper.txt)", "local": "parent fills late",
                                       "conjecture": ""})
        registered = self.world.register(body, source_files=[original])
        sources = self.world.plan(registered["registration_id"])["body"]["sources"]
        self.assertEqual(len(sources), 1)
        commits = {commit for (commit,) in self.world.service.sql(
            self.world.profile, "SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle = %s UNION ALL "
            "SELECT to_commit FROM dolt_diff_research_registration WHERE to_registration_id = %s",
            (sources[0], registered["registration_id"]))}
        self.assertEqual(commits, {registered["ledger_commit"]})
        self.assertEqual(self.code(self.derived(
            rationale={"external": "capacity binds", "local": "parent fills late", "conjecture": ""})),
            "SOURCES_REQUIRED")
        self.assertEqual(self.code(self.derived(sources=["source-missing"])), "SOURCES_REQUIRED")
        self.assertEqual(self.code(self.derived(), source_files=[self.world.tmp / "absent"]), "SOURCES_REQUIRED")

    def test_shapes_window_duties_and_predictions_are_checked_before_writing(self):
        body = self.derived()
        del body["conditions"]
        self.assertEqual(self.code(body), "REGISTRATION_INVALID")
        self.assertEqual(self.code(self.derived(control_trial_id=1, comparison=None)), "REGISTRATION_INVALID",
                         "a control needs the comparison design")
        self.assertEqual(self.code(self.derived(comparison={"method": "paired-circular-log-mean-v1"})),
                         "REGISTRATION_INVALID")
        self.assertEqual(self.code(self.derived(), runner_argv=runner_argv(trade_start="2026-01-02")),
                         "WINDOW_MISMATCH", "the window is the line's development window")
        for duties in (["Z9"], []):
            with self.subTest(duties=duties):
                self.assertEqual(self.code(self.derived(changed_duties=duties)), "DUTY_UNKNOWN")
        root = self.world.body(["rsi@1"], {"rsi@1": self.root_review}, changed_duties=["A1"])
        self.assertEqual(self.code(root), "DUTY_UNKNOWN")
        predictions = [
            [{"slice": "capital_scaled", "measure": "unit_return", "direction": "up", "duty": "E1", "reason": "r"}],
            [{"slice": "capital_scaled", "measure": "funding", "direction": "up", "duty": "G3", "reason": "r"}],
            [{"slice": "made_up", "measure": "unit_return", "direction": "up", "duty": "G3", "reason": "r"}],
            [{"slice": None, "measure": None, "direction": "down", "duty": "G3", "reason": " "}],
            [{"slice": None, "measure": "made_up", "direction": "down", "duty": "G3", "reason": "no slice"}],
        ]
        for mechanism in predictions:
            body = self.derived()
            body["prediction"]["mechanism"] = mechanism
            with self.subTest(mechanism=mechanism):
                self.assertEqual(self.code(body), "PREDICTION_INVALID")
        two = self.derived(changed_duties=["G3", "E1"])
        self.assertEqual(self.code(two), "PREDICTION_INVALID")
        root = self.world.body(["rsi@1"], {"rsi@1": self.root_review})
        root["prediction"]["mechanism"] = [{"slice": "made_up", "measure": "unit_return", "direction": "up",
                                            "duty": "B1", "reason": "r"}]
        self.assertEqual(self.code(root), "PREDICTION_INVALID")
        without_slice = self.derived()
        without_slice["prediction"]["mechanism"] = [{"slice": None, "measure": None, "direction": "down",
                                                     "duty": "G3", "reason": "no slice measures queue position"}]
        self.assertFalse(self.world.register(without_slice)["replayed"])

    def test_a_root_may_predict_mechanisms_on_any_duty(self):
        root = self.world.body(["rsi@1"], {"rsi@1": self.root_review}, retry_of=self.root)
        root["prediction"]["mechanism"] = [{"slice": "by_period", "measure": "months_won_share", "direction": "up",
                                            "duty": "B1", "reason": "the mispricing persists across months"}]
        self.assertFalse(self.world.register(root)["replayed"])

    def test_lineage_grid_and_references_are_checked_against_the_ledger(self):
        cases = {
            "root with control": self.world.body(["rsi@1"], {"rsi@1": self.root_review}, control_trial_id=1),
            "no control, no local diagnosis": self.derived(rationale={"external": "", "local": " ",
                                                                      "conjecture": "c"}),
            "unknown grid candidate": self.derived(grid=["rsi@99"]),
            "repeated grid source": self.derived(grid=[self.child["candidate"]] * 2),
            "unknown retry_of": self.derived(retry_of=999_999),
            "retry_of not a registration_id": self.derived(retry_of="registration-1"),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self.assertEqual(self.code(body), "REGISTRATION_INVALID")
        other = self.world.publish("another change", difference="cap volume at 6%")
        self.assertEqual(self.code(self.derived(grid=[self.child["candidate"], other["candidate"]])),
                         "LINEAGE_MISMATCH", "one registration tests one change")
        self.assertEqual(self.code(self.derived(grid=[self.child["candidate"], "rsi@1"])), "LINEAGE_MISMATCH",
                         "one registration has one parent")
        with patch.object(strategies, "RUNTIME_CONTRACT", "r0-retired"):
            retired = self.world.publish("retired contract")
        self.assertEqual(self.code(self.derived(grid=[retired["candidate"]])), "CONFIG_MISMATCH")
        self.assertEqual(self.code(self.derived(control_trial_id=999)), "RUN_NOT_PASSED")

    def test_every_grid_source_needs_a_passing_review_and_no_prior_exposure(self):
        self.assertEqual(self.code(self.derived(prechecks={})), "SOURCE_PRECHECK_REQUIRED")
        failing = self.world.publish("fails its precheck")
        review = self.world.prechecked(failing["source"], native_exit=1)
        self.assertEqual(self.code(self.derived(grid=[failing["candidate"]], prechecks={failing["candidate"]: review})),
                         "SOURCE_PRECHECK_FAILED")
        explored = self.world.publish("explored first")
        review = self.world.prechecked(explored["source"])
        trials.open_trial(self.world.conn, "explore", sha(explored["source"]), RUNTIME,
                          coverage(effective_config=config(symbols=["AAAUSDT"]), symbols=["AAAUSDT"]), LINE_WINDOW,
                          self.world.start(explored["source"]))
        body = self.derived(grid=[explored["candidate"]], prechecks={explored["candidate"]: review})
        self.assertEqual(self.code(body), "SOURCE_ALREADY_EXPOSED")
        self.assertEqual(self.code({**body, "retry_of": self.root}), "SOURCE_ALREADY_EXPOSED")

    def test_a_source_run_on_other_contracts_only_is_not_exposed_on_these(self):
        """Exposure is per contract: a run on CCCUSDT says nothing about AAAUSDT and BBBUSDT."""
        for symbol, exposed in (("CCCUSDT", False), ("BBBUSDT", True)):
            with self.subTest(symbol=symbol):
                elsewhere = self.world.publish(f"explored on {symbol}")
                review = self.world.prechecked(elsewhere["source"])
                trials.open_trial(self.world.conn, "explore", sha(elsewhere["source"]), RUNTIME,
                                  coverage(effective_config=config(symbols=[symbol]), symbols=[symbol]), LINE_WINDOW,
                                  self.world.start(elsewhere["source"]))
                body = self.derived(grid=[elsewhere["candidate"]], prechecks={elsewhere["candidate"]: review})
                if exposed:
                    self.assertEqual(self.code(body), "SOURCE_ALREADY_EXPOSED")
                else:
                    self.world.register(body)

    def test_only_the_cited_precheck_of_at_most_seven_days_leaves_the_source_unexposed(self):
        """Condition (3): the cited precheck of at most PRECHECK_MAX_DAYS that matches the identity."""
        long = self.world.publish("prechecked for eight days")
        review = self.world.prechecked(long["source"], days=precheck.PRECHECK_MAX_DAYS + 1)
        body = self.derived(grid=[long["candidate"]], prechecks={long["candidate"]: review})
        self.assertEqual(self.code(body), "SOURCE_ALREADY_EXPOSED")
        self.assertEqual(refused(self.world.register, body).missing, (long["candidate"],))
        week = self.world.publish("prechecked for seven days")
        review = self.world.prechecked(week["source"], days=precheck.PRECHECK_MAX_DAYS)
        self.world.register(self.derived(grid=[week["candidate"]], prechecks={week["candidate"]: review}))
        twice = self.world.publish("prechecked twice")
        self.world.prechecked(twice["source"])
        review = self.world.prechecked(twice["source"])
        self.assertEqual(self.code(self.derived(grid=[twice["candidate"]], prechecks={twice["candidate"]: review})),
                         "SOURCE_ALREADY_EXPOSED")

    def test_a_precheck_that_failed_before_market_data_does_not_expose_the_source(self):
        """Condition (2), relaxation 1: every stage before market data, the execution binding included."""
        for stage, exposed in (("execution_binding", False), ("load", False), ("inputs", False), ("replay", True)):
            with self.subTest(stage=stage):
                retried = self.world.publish(f"failed in {stage}, then prechecked again")
                failed = self.world.open_precheck(retried["source"], days=30)
                capture(self.world.conn, failed, retried["source"], native_exit=1, audit_exit=None,
                        runtime_errors=b'{"stage": "%s"}\n' % stage.encode())
                review = self.world.prechecked(retried["source"])
                body = self.derived(grid=[retried["candidate"]], prechecks={retried["candidate"]: review})
                if exposed:
                    self.assertEqual(self.code(body), "SOURCE_ALREADY_EXPOSED")
                else:
                    self.world.register(body)

    def test_a_short_precheck_that_sealed_no_fill_does_not_expose_the_source(self):
        """Condition (2): a short precheck that sealed no fill and no position, on any image."""
        for fills, exposed in ((0, False), (1, True)):
            with self.subTest(fills=fills):
                retried = self.world.publish(f"sealed {fills} fills, then prechecked again")
                quiet = self.world.open_precheck(retried["source"], runtime=OTHER_RUNTIME, days=7)
                capture(self.world.conn, quiet, retried["source"], fingerprint={
                    "fills": {"rows": fills, "sha256": "1" * 64}, "positions": {"rows": fills, "sha256": "2" * 64}})
                review = self.world.prechecked(retried["source"])
                body = self.derived(grid=[retried["candidate"]], prechecks={retried["candidate"]: review})
                if exposed:
                    self.assertEqual(self.code(body), "SOURCE_ALREADY_EXPOSED")
                else:
                    self.world.register(body)

    def test_registration_needs_a_research_line(self):
        body = self.world.body(["rsi@1"], {"rsi@1": self.root_review})
        with patch("ledger.lines.lines", return_value=[]):
            self.assertEqual(self.code(body), "RESEARCH_LINE_REQUIRED")


def second_line(world: World, slug: str, end: date = date(2026, 2, 1)) -> str:
    """Another open line from rsi@1 on the world's market commit, from 2026-01-01 to `end`."""
    with pinned(date(2026, 1, 1), end):
        return lines.select_line(world.conn, MARKET_COMMIT, "rsi@1", slug=slug, market=market(),
                                 reviews=reviewed(source("root")))["line"]


@unittest.skipUnless(BINARY, SKIP)
class OpenLinesTests(unittest.TestCase):
    """Several open lines: a registration names its line, binding follows the line it was written on, and
    a closed line takes and binds no more registrations."""

    def test_registrations_and_bindings_follow_their_own_open_line(self):
        world = World("open-lines")
        self.addCleanup(world.close)
        mine = world.line["line"]
        first = world.publish("first root", parent=None)
        body = world.body([first["candidate"]], {first["candidate"]: world.prechecked(first["source"])})
        opened = world.register(body)["registration_id"]  # the only open line
        other = second_line(world, "rsi-wider", date(2026, 3, 1))
        second = world.publish("second root", parent=None)
        later = world.body([second["candidate"]], {second["candidate"]: world.prechecked(second["source"])})
        self.assertEqual(refused(world.register, later).code, "LINE_AMBIGUOUS")
        self.assertEqual(refused(world.register, later, line=other).code, "WINDOW_MISMATCH")
        pending = world.register(later, line=mine)["registration_id"]
        trial_id = world.research_trial(opened, first["source"])  # another line opened meanwhile
        self.assertEqual(lines.line_trials(world.conn, mine)["trials"], [trial_id])
        self.assertEqual(lines.line_trials(world.conn, other)["trials"], [])
        lines.close_line(world.profile, mine, b"rsi root summary", MARKET_DAYS)
        seq = world.seq()
        self.assertEqual(refused(world.research_trial, pending, second["source"]).code, "LINE_ENDED")
        self.assertEqual(refused(world.register, later, line=mine).code, "LINE_ENDED")
        self.assertEqual(world.seq(), seq, "a closed line binds and registers nothing")


@unittest.skipUnless(BINARY, SKIP)
class SameKeyLinesTests(unittest.TestCase):
    """Two open lines on one market commit and window (finding 20261105-01): a registration names its line,
    and its trials count and bind there alone."""

    def setUp(self):
        self.world = World("same-key-lines")
        self.addCleanup(self.world.close)
        self.mine = self.world.line["line"]

    def registered(self, tag: str, **kwargs) -> tuple[int, bytes]:
        published = self.world.publish(tag, parent=None)
        review = self.world.prechecked(published["source"])
        registered = self.world.register(self.world.body([published["candidate"]], {published["candidate"]: review}),
                                         **kwargs)
        return registered["registration_id"], published["source"]

    def test_registrations_written_in_turn_stay_on_their_own_lines(self):
        other = second_line(self.world, "rsi-other")
        written = [self.registered(tag, line=line) for tag, line in (("a1", self.mine), ("b1", other),
                                                                      ("a2", self.mine), ("b2", other))]
        self.assertEqual([self.world.plan(registration)["line_id"] for registration, _ in written],
                         [lines.read_line(self.world.conn, line)["line_id"] for line in (self.mine, other) * 2])
        bound = [self.world.research_trial(*written[index]) for index in (1, 0, 2, 3)]
        self.assertEqual(lines.line_trials(self.world.conn, self.mine)["trials"], [bound[1], bound[2]])
        self.assertEqual(lines.line_trials(self.world.conn, other)["trials"], [bound[0], bound[3]])

    def test_a_closed_line_binds_no_more_while_its_twin_goes_on(self):
        other = second_line(self.world, "rsi-other")
        first = self.registered("a1", line=self.mine)
        second = self.registered("b1", line=other)
        lines.close_line(self.world.profile, self.mine, b"same key summary", MARKET_DAYS)
        successor = second_line(self.world, "rsi-successor")
        seq = self.world.seq()
        self.assertEqual(refused(self.world.research_trial, *first).code, "LINE_ENDED")
        self.assertEqual(self.world.seq(), seq)
        trial_id = self.world.research_trial(*second)
        self.assertEqual(lines.line_trials(self.world.conn, other)["trials"], [trial_id])
        self.assertEqual(lines.line_trials(self.world.conn, successor)["trials"], [])

    def test_the_same_body_on_its_own_line_is_a_replay_and_on_another_a_new_registration(self):
        """On another line the same body is that line's registration; whichever replays first exposes the
        source to the other."""
        other = second_line(self.world, "rsi-other")
        published = self.world.publish("a1", parent=None)
        body = self.world.body([published["candidate"]],
                               {published["candidate"]: self.world.prechecked(published["source"])})
        first = self.world.register(body, line=self.mine)
        self.assertTrue(self.world.register(body, line=self.mine)["replayed"])
        twin = self.world.register(body, line=other)
        self.assertEqual((twin["replayed"], twin["line"]), (False, other))
        self.assertNotEqual(twin["registration_id"], first["registration_id"])
        self.world.research_trial(first["registration_id"], published["source"])
        exc = refused(self.world.research_trial, twin["registration_id"], published["source"])
        self.assertEqual((exc.code, exc.missing), ("SOURCE_ALREADY_EXPOSED", (published["candidate"],)))

    def test_a_retry_written_on_another_line_excuses_no_interpretation_here(self):
        review = self.world.prechecked(source("root"))
        body = self.world.body(["rsi@1"], {"rsi@1": review})
        first = self.world.register(body)["registration_id"]
        self.world.seal_run(self.world.research_trial(first, source("root")), "invalid")
        other = second_line(self.world, "rsi-other")
        self.world.register({**body, "retry_of": first}, line=other)
        next_root = self.world.publish("next", parent=None)
        later = self.world.body([next_root["candidate"]],
                                {next_root["candidate"]: self.world.prechecked(next_root["source"])})
        self.assertEqual(refused(self.world.register, later, line=self.mine).code, "INTERPRETATION_REQUIRED")
        self.world.register({**body, "retry_of": first}, line=self.mine)
        self.world.register(later, line=self.mine)


@unittest.skipUnless(BINARY, SKIP)
class BindTests(unittest.TestCase):
    """Research trials bound to root registrations, each grid point on its own root candidate."""

    @classmethod
    def setUpClass(cls):
        cls.world = World("bind")
        cls.addClassCleanup(cls.world.close)
        cls.count = 0

    def setUp(self):
        self.world = self.__class__.world

    def registration(self) -> tuple[int, bytes]:
        """A fresh root candidate, prechecked, reviewed and registered alone."""
        self.__class__.count += 1
        point = self.world.publish(f"bind root {self.count}", parent=None)
        review = self.world.prechecked(point["source"])
        registered = self.world.register(self.world.body([point["candidate"]], {point["candidate"]: review}))
        return registered["registration_id"], point["source"]

    def trial_count(self) -> int:
        return self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0]

    def refused_trial(self, registration, data, **kwargs) -> Refusal:
        seq, count = self.world.seq(), self.trial_count()
        exc = refused(self.world.research_trial, registration, data, **kwargs)
        self.assertEqual((self.world.seq(), self.trial_count()), (seq, count), "a refused binding leaves no trial")
        return exc

    def test_a_bound_trial_consumes_its_grid_point_once_even_when_it_fails(self):
        registration, data = self.registration()
        trial_id = self.world.research_trial(registration, data)
        rows = self.world.service.sql(self.world.profile, "SELECT purpose, line_id, research_registration_id, "
                                      "source_sha256 FROM trial WHERE trial_id = %s", (trial_id,))
        self.assertEqual(rows, [("research", self.world.line["line_id"], registration, sha(data))])
        registered_at, trial_at = self.world.service.sql(
            self.world.profile, "SELECT g.created_at, t.created_at FROM research_registration g, trial t "
                                "WHERE g.registration_id = %s AND t.trial_id = %s", (registration, trial_id))[0]
        self.assertLess(registered_at, trial_at)
        self.assertEqual(self.refused_trial(registration, data).code, "GRID_ALREADY_ATTEMPTED")
        self.world.seal_run(trial_id, "invalid")
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
        self.assertEqual(self.refused_trial(registration, data).code, "GRID_ALREADY_ATTEMPTED")

    def test_two_concurrent_bindings_of_one_grid_point_commit_once(self):
        registration, data = self.registration()
        receipt = self.world.receipt(registration)
        starts = {label: self.world.start(data) for label in ("race-a", "race-b")}
        barrier, outcomes = threading.Barrier(2, timeout=60), {}

        def race(label: str) -> None:
            conn = db.connect(self.world.profile, "writer")
            try:
                def binder(c, row):
                    bound = register.bind(c, registration, sha(data), row)
                    barrier.wait()
                    return bound
                trials.open_trial(conn, "research", sha(data), RUNTIME, receipt, LINE_WINDOW, starts[label], binder)
                outcomes[label] = "written"
            except Refusal as exc:
                outcomes[label] = exc.code
            finally:
                conn.close()

        threads = [threading.Thread(target=race, args=(label,)) for label in starts]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        # The loser's rerun meets the winner's binding on the new head.
        self.assertEqual(sorted(outcomes.values()), ["GRID_ALREADY_ATTEMPTED", "written"])
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial WHERE "
                                                                    "research_registration_id = %s", (registration,)),
                         [(1,)])

    def test_the_executed_source_and_execution_must_be_the_registered_ones(self):
        registration, data = self.registration()
        outsider = self.world.publish("not in the grid", parent=None)["source"]
        self.assertEqual(self.refused_trial(registration, outsider).code, "SOURCE_MISMATCH")
        cases = [({"symbols": ["AAAUSDT"], "export_content_sha256": "d" * 64}, None, ("input_identity",)),
                 ({}, config(account={**ACCOUNT, "fees": "other"}), ("effective_configuration",)),
                 ({"market_day": "n" * 32}, None, ("market_day",))]
        for identity, effective, conflict in cases:
            with self.subTest(conflict=conflict):
                exc = self.refused_trial(registration, data,
                                         receipt=self.world.receipt(registration, effective, **identity))
                self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", conflict))
        exc = self.refused_trial(registration, data, runtime=OTHER_RUNTIME)
        self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", ("runtime_image",)))
        contract = "replay-contract@v8"
        exc = self.refused_trial(registration, data, runtime={**RUNTIME, "runtime_contract": contract,
                                                              "inspection": {**RUNTIME["inspection"],
                                                                             "runtime_contract": contract}})
        self.assertEqual(exc.code, "CONFIG_MISMATCH")
        self.world.research_trial(registration, data)

    def test_the_trial_row_is_checked_not_a_caller_supplied_execution(self):
        registration, data = self.registration()
        shifted = {"start": LINE_WINDOW["start"], "trade_start": JAN + 10 * DAY, "end": LINE_WINDOW["end"]}
        exc = self.refused_trial(registration, data, window=shifted)
        self.assertEqual((exc.code, exc.missing), ("WINDOW_MISMATCH", ("window",)))
        seq = self.world.seq()
        exc = refused(trials.open_trial, self.world.conn, "validation", sha(data), RUNTIME,
                      self.world.receipt(registration), LINE_WINDOW, self.world.start(data),
                      register.binder(registration, sha(data)))
        self.assertEqual((exc.code, exc.missing, self.world.seq()), ("BINDING_NOT_ALLOWED", ("purpose",), seq),
                         "a research registration binds a research trial only")
        self.world.research_trial(registration, data)

    def test_an_unknown_registration_cannot_bind(self):
        registration, data = self.registration()
        for ghost in (999_999, "1"):
            with self.subTest(ghost=ghost):
                exc = self.refused_trial(registration, data, binder=register.binder(ghost, sha(data)))
                self.assertEqual(exc.code, "REGISTRATION_INVALID")


@unittest.skipUnless(BINARY, SKIP)
class ConcurrentRegistrationTests(unittest.TestCase):
    def test_two_concurrent_registrations_both_commit(self):
        world, prepared = World("concurrent"), []
        self.addCleanup(world.close)
        for label in ("race-a", "race-b"):
            point = world.publish(f"race root {label}", parent=None)
            prepared.append((label, world.body([point["candidate"]],
                                               {point["candidate"]: world.prechecked(point["source"])})))
        barrier, waited, outcomes = threading.Barrier(2, timeout=60), set(), {}
        real = register.require_line_records

        def collide(*args, **kwargs):
            if threading.get_ident() not in waited:
                waited.add(threading.get_ident())
                barrier.wait()
            return real(*args, **kwargs)

        def race(label: str, body: dict) -> None:
            try:
                outcomes[label] = world.register(body)["replayed"]
            except Refusal as exc:
                outcomes[label] = exc.code

        with patch.object(register, "require_line_records", collide):
            threads = [threading.Thread(target=race, args=item) for item in prepared]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        self.assertEqual(outcomes, {label: False for label, _ in prepared})


@unittest.skipUnless(BINARY, SKIP)
class LineRecordTests(unittest.TestCase):
    """The gates before the next registration, and the control run of a derived registration."""

    def setUp(self):
        self.world = World("records")
        self.addCleanup(self.world.close)
        world = self.world
        self.root_review = world.prechecked(source("root"))
        self.root = world.register(world.body(["rsi@1"], {"rsi@1": self.root_review}))["registration_id"]
        self.root_trial = world.research_trial(self.root, source("root"))
        self.child = world.publish("child")
        self.child_review = world.prechecked(self.child["source"])

    def derived(self, control_trial_id=None, **overrides) -> dict:
        return self.world.body([self.child["candidate"]], {self.child["candidate"]: self.child_review},
                               duties=["G3"], control_trial_id=control_trial_id, **overrides)

    def code(self, body, **kwargs) -> str:
        return refused(self.world.register, body, **kwargs).code

    def test_interpretations_and_the_review_breaker_gate_the_next_registration(self):
        world = self.world

        def supersede(kind, old):
            return judgments.add_judgment(world.profile, kind, world.line["line"], db.head_commit(world.conn),
                                          f"revised {kind}", supersedes=old)["judgment_id"]

        batch = [world.publish(f"batch {index}", parent=None) for index in range(register.REVIEW_EVERY - 1)]
        batched = world.register(world.body([item["candidate"] for item in batch],
                                            {item["candidate"]: world.prechecked(item["source"]) for item in batch}))
        for item in batch[:-1]:  # with the root trial, one research trial short of the breaker (none completed)
            world.research_trial(batched["registration_id"], item["source"])
        unfinished = world.publish("unfinished", parent=None)  # the root trial has no run: not completed yet
        world.register(world.body([unfinished["candidate"]], {
            unfinished["candidate"]: world.prechecked(unfinished["source"])}))
        trial_id = world.seal_run(self.root_trial)
        another = world.publish("second child")
        review = world.prechecked(another["source"])
        body = world.body([another["candidate"]], {another["candidate"]: review}, duties=["G3"],
                          control_trial_id=trial_id)
        exc = refused(world.register, body)
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {self.root_trial}",)))
        first = world.judge("interpretation", subjects=[{"role": "about", "registration_id": self.root}])
        supersede("interpretation", first)  # a superseded interpretation still covers its trial
        world.research_trial(batched["registration_id"], batch[-1]["source"])  # the REVIEW_EVERY-th research trial
        exc = refused(world.register, body)
        self.assertEqual((exc.code, exc.missing), ("REVIEW_DUE", ("recommendation",)))
        world.judge("recommendation", subjects=[{"role": "recommended", "candidate": "rsi@1"}])
        self.assertFalse(world.register(body)["replayed"], "the recommendation clears it")

    def test_the_control_must_be_a_comparable_passed_run_with_economic_evidence(self):
        world = self.world
        trial_id = world.seal_run(self.root_trial)
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.root_trial}])
        exc = refused(world.register, self.derived(control_trial_id=trial_id),
                      runner_argv=[*RUNNER_ARGV, "--symbols", "AAAUSDT"])
        self.assertEqual((exc.code, exc.missing), ("COMPARABILITY_MISMATCH", ("export_sha256",)))
        world.qualification.unavailable.add(trial_id)
        self.assertEqual(self.code(self.derived(control_trial_id=trial_id)), "ECONOMIC_EVIDENCE_UNAVAILABLE")
        world.qualification.unavailable.clear()
        registered = world.register(self.derived(control_trial_id=trial_id))
        self.assertFalse(registered["replayed"])
        self.assertEqual(world.plan(registered["registration_id"])["control_trial_id"], trial_id)

    def test_a_control_that_failed_or_is_no_run_is_refused(self):
        world = self.world
        trial_id = world.seal_run(self.root_trial, "invalid")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.root_trial}])
        self.assertEqual(self.code(self.derived(control_trial_id=trial_id)), "RUN_NOT_PASSED")
        precheck_trial = world.open_precheck(source("root"))
        self.assertEqual(self.code(self.derived(control_trial_id=precheck_trial)), "RUN_NOT_PASSED")

    def test_without_a_control_the_parents_runs_show_its_fault_or_zero_activity(self):
        world = self.world
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.root_trial}])
        restart = self.derived(rationale={"external": "", "local": "the parent's runtime contract no longer runs",
                                          "conjecture": "the same idea holds on the new contract"})
        exc = refused(world.register, restart)
        self.assertEqual((exc.code, exc.missing), ("REGISTRATION_INVALID", ("control_trial_id",)),
                         "a parent without a completed research run shows no fault")
        world.seal_run(self.root_trial, fills=3)
        exc = refused(world.register, restart)
        self.assertEqual((exc.code, exc.missing), ("REGISTRATION_INVALID", ("control_trial_id",)),
                         "another reason, such as a contract that no longer runs, does not excuse the control")
        root = world.publish("restart", parent=None)
        registered = world.register(world.body([root["candidate"]], {
            root["candidate"]: world.prechecked(root["source"])}, comparison=None, rationale=restart["rationale"]))
        self.assertFalse(registered["replayed"], "a root registers without parent or control as before")

    def test_a_parent_run_with_zero_activity_admits_a_child_without_a_control(self):
        self.world.seal_run(self.root_trial, fills=0)
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.root_trial}])
        registered = self.world.register(self.derived(comparison=None))
        self.assertIsNone(self.world.plan(registered["registration_id"])["comparison"])
        self.assertFalse(registered["replayed"])


@unittest.skipUnless(BINARY, SKIP)
class RetryTests(unittest.TestCase):
    """research retries along the retry_of chain of root registrations of rsi@1."""

    def setUp(self):
        self.world = World("retry")
        self.addCleanup(self.world.close)
        self.body = self.world.body(["rsi@1"], {"rsi@1": self.world.prechecked(source("root"))})

    def attempt(self, retry_of: int | None, outcome: str | None) -> tuple[int, int]:
        """Register, bind and finish one attempt (a run status, an original capture outcome or nothing):
        (registration_id, trial_id)."""
        registration = self.world.register({**self.body, "retry_of": retry_of} if retry_of else self.body)[
            "registration_id"]
        trial_id = self.world.research_trial(registration, source("root"))
        if outcome in ("passed", "invalid"):
            self.world.seal_run(trial_id, outcome)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
        elif outcome is not None:
            capture(self.world.conn, trial_id, source("root"), purpose="research", outcome=outcome)
        return registration, trial_id

    def code(self, retry_of: int) -> str:
        return refused(self.world.register, {**self.body, "retry_of": retry_of}).code

    def test_only_the_retry_chain_leaves_its_consumed_trials_unexposed(self):
        """Condition (1): the trials of the retry chain do not count; without the link they do."""
        first, _ = self.attempt(None, "invalid")
        self.assertTrue(self.world.register(self.body)["replayed"], "the same registration again is a replay")
        exc = refused(self.world.register, {**self.body, "conditions": "the pool, once more"})
        self.assertEqual((exc.code, exc.missing), ("SOURCE_ALREADY_EXPOSED", ("rsi@1",)))
        retry = self.world.register({**self.body, "retry_of": first})["registration_id"]
        self.world.research_trial(retry, source("root"))

    def test_a_retry_follows_the_chain_of_invalid_and_interrupted_attempts(self):
        first, _ = self.attempt(None, "invalid")
        second, _ = self.attempt(first, "interrupted")
        third, _ = self.attempt(second, "host_failure")
        self.assertFalse(self.world.register({**self.body, "retry_of": third})["replayed"])

    def test_an_invalid_run_that_a_registration_retries_needs_no_interpretation(self):
        first = self.world.register(self.body)["registration_id"]
        failed = self.world.research_trial(first, source("root"))
        self.world.seal_run(failed, "invalid")
        other = self.world.publish("other", parent=None)
        exc = refused(self.world.register, self.world.body([other["candidate"]], {
            other["candidate"]: self.world.prechecked(other["source"])}))
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {failed}",)))
        retry = self.world.register({**self.body, "retry_of": first})["registration_id"]
        line = self.world.line["line_id"]
        self.assertIsNone(register.require_line_records(self.world.conn, line), "the stored retry exempts it")
        passed = self.world.research_trial(retry, source("root"))
        self.world.seal_run(passed, "passed")
        exc = refused(register.require_line_records, self.world.conn, line)
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {passed}",)),
                         "a valid run still needs its interpretation")

    def test_a_trial_with_a_recovery_bundle_and_no_run_needs_its_interpretation(self):
        registration = self.world.register(self.body)["registration_id"]
        trial = self.world.research_trial(registration, source("root"))
        line = self.world.line["line_id"]
        other = self.world.open_precheck(source("root"))
        product_bundle(self.world.conn, f"trial-{other}-recovery-1", {"manifest.json": b"{}"}, kind="recovery",
                       trial_id=other)
        self.assertIsNone(register.require_line_records(self.world.conn, line), "another trial's recovery")
        product_bundle(self.world.conn, f"trial-{trial}-recovery-1", {"manifest.json": b"{}"}, kind="recovery",
                       trial_id=trial)
        exc = refused(register.require_line_records, self.world.conn, line)
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {trial}",)))

    def test_only_a_retry_on_the_same_line_exempts_an_invalid_run(self):
        first = self.world.register(self.body)["registration_id"]
        failed = self.world.research_trial(first, source("root"))
        self.world.seal_run(failed, "invalid")
        other = second_line(self.world, "rsi-wider", date(2026, 3, 1))
        self.world.register({**self.body, "retry_of": first}, line=other, runner_argv=runner_argv(end="2026-03-01"))
        exc = refused(register.require_line_records, self.world.conn, self.world.line["line_id"])
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {failed}",)),
                         "another line's retry does not repair this line's run")

    def test_an_attempt_without_a_capture_is_not_retried_and_one_captured_without_a_run_is(self):
        first, _ = self.attempt(None, "invalid")
        second, unfinished = self.attempt(first, None)
        self.assertEqual(self.code(second), "RETRY_NOT_ALLOWED")
        # CF-04 ("授权", 2026-11-11): a completed replay whose seal failed may be retried; its capture stays
        capture(self.world.conn, unfinished, source("root"), purpose="research", outcome="completed")
        self.assertFalse(self.world.register({**self.body, "retry_of": second})["replayed"])

    def test_a_passed_run_admits_a_retry_only_without_economic_evidence(self):
        first, trial_id = self.attempt(None, "passed")
        self.assertEqual(self.code(first), "RETRY_NOT_ALLOWED")
        self.world.qualification.unavailable.add(trial_id)
        self.world.register({**self.body, "retry_of": first})
        self.world.qualification.unavailable.clear()


if __name__ == "__main__":
    unittest.main()
