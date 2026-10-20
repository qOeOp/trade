"""Registration on a throwaway ledger: the lock and its refusals, binding a research trial to one grid
point in the trial's own transaction, and the line-record gates before the next registration."""

from __future__ import annotations

import copy
import json
import threading
import unittest
from unittest.mock import patch

from ledger import db, evidence, judgments, strategies, trials
from ledger.errors import Refusal
from registration import register
from tests.ledger.dolt import (BINARY, IDENTITY, MARKET_COMMIT, RUNTIME, SKIP, attempt_binder, context, sha,
                               source)
from tests.registration.world import (DAY, FEB, JAN, LINE_WINDOW, RUNNER_ARGV, World, capture, coverage_bytes,
                                      product_write)

OTHER_DIGEST = "sha256:" + "c" * 64
OTHER_RUNTIME = {**RUNTIME, "image_ref": "ghcr.io/qoeop/trade-runtime@" + OTHER_DIGEST, "image_digest": OTHER_DIGEST}


def refused(function, *args, **kwargs) -> Refusal:
    try:
        function(*args, **kwargs)
    except Refusal as exc:
        return exc
    raise AssertionError(f"{function.__name__} did not refuse")


@unittest.skipUnless(BINARY, SKIP)
class RegisterTests(unittest.TestCase):
    """Registrations of roots and of children of rsi@1; no research trial completes here."""

    @classmethod
    def setUpClass(cls):
        cls.world = world = World("register")
        cls.addClassCleanup(world.close)
        cls.root_review = world.prechecked(source("root"))
        cls.child = world.publish("child")
        cls.child_review = world.prechecked(cls.child["source"])
        world.judge("review_cadence", cadence=50)
        cls.registered = world.register("registration-root", world.body(["rsi@1"], {"rsi@1": cls.root_review},
                                                                          comparison=None))

    def setUp(self):
        self.world = self.__class__.world

    def derived(self, **overrides) -> dict:
        body = self.world.body([self.child["candidate"]], {self.child["candidate"]: self.child_review},
                               parent="rsi@1", change="cap volume at 5%", duties=["G3"])
        body.update(overrides)
        return body

    def code(self, bundle: str, body, **kwargs) -> str:
        seq = self.world.seq()
        exc = refused(self.world.register, bundle, body, **kwargs)
        self.assertEqual(self.world.seq(), seq, "a refused registration writes nothing")
        self.assertEqual(exc.write_status, "not_written")
        return exc.code

    def test_a_registration_locks_the_body_and_the_probed_execution_once(self):
        registered = self.registered
        plan = self.world.plan("registration-root")
        execution = plan["execution"]
        self.assertEqual(execution, registered["execution"])
        self.assertEqual((execution["image_digest"], execution["input_identity"]["market_commit"],
                          execution["input_identity"]["symbols"]), (RUNTIME["image_digest"], MARKET_COMMIT,
                                                                    ["AAAUSDT", "BBBUSDT"]))
        self.assertEqual(plan["body"]["grid"][0]["candidate"], "rsi@1")
        self.assertIsNone(plan["body"]["comparison"], "a root has no control and so no comparison design")
        stored = self.world.service.sql(self.world.profile, "SELECT sha256 FROM evidence WHERE bundle = %s",
                                        ("registration-root",))
        self.assertEqual(stored, [(registered["sha256"],)])
        again = self.world.register("registration-root", self.world.body(["rsi@1"], {"rsi@1": self.root_review},
                                                                          comparison=None))
        self.assertEqual((again["replayed"], again["ledger_commit"], again["sha256"]),
                         (True, registered["ledger_commit"], registered["sha256"]))
        self.assertEqual(self.code("registration-root", self.world.body(["rsi@1"], {"rsi@1": self.root_review},
                                                                         conditions="a narrower pool")),
                         "DUPLICATE_BUNDLE")

    def test_a_derived_registration_writes_its_source_originals_in_the_same_commit(self):
        original = self.world.tmp / "paper.txt"
        original.write_text("capacity limits momentum profits")
        body = self.derived(rationale={"external": "capacity binds (paper.txt)", "local": "parent fills late",
                                       "conjecture": ""})
        registered = self.world.register("registration-derived", body, source_files=[original])
        sources = self.world.plan("registration-derived")["body"]["sources"]
        self.assertEqual(len(sources), 1)
        commits = {commit for (commit,) in self.world.service.sql(
            self.world.profile, "SELECT to_commit FROM dolt_diff_evidence_bundle WHERE to_bundle IN (%s, %s)",
            (sources[0], "registration-derived"))}
        self.assertEqual(commits, {registered["ledger_commit"]})
        self.assertEqual(self.code("registration-no-original", self.derived(
            rationale={"external": "capacity binds", "local": "parent fills late", "conjecture": ""})),
            "SOURCES_REQUIRED")
        self.assertEqual(self.code("registration-no-bundle", self.derived(sources=["source-missing"])),
                         "SOURCES_REQUIRED")
        self.assertEqual(self.code("registration-no-file", self.derived(), source_files=[self.world.tmp / "absent"]),
                         "SOURCES_REQUIRED")

    def test_names_shapes_window_duties_and_predictions_are_checked_before_writing(self):
        for name in ("trial-9-execution", "research-line-2", "source-review-x", "plan-x", "registration-"):
            with self.subTest(name=name):
                self.assertEqual(self.code(name, self.derived()), "REGISTRATION_BUNDLE_NAME")
        self.assertEqual(self.code("bad name", self.derived()), "INVALID_BUNDLE_NAME")
        body = self.derived()
        del body["conditions"]
        self.assertEqual(self.code("registration-shape", body), "REGISTRATION_INVALID")
        self.assertEqual(self.code("registration-shape", self.derived(control_run=1, comparison=None)),
                         "REGISTRATION_INVALID", "a control needs the comparison design")
        self.assertEqual(self.code("registration-shape", self.derived(
            comparison={"method": "paired-circular-log-mean-v1"})), "REGISTRATION_INVALID")
        self.assertEqual(self.code("registration-shape", self.derived(
            window={"trade_start": "2026-01-02", "trade_end": "2026-02-01"})), "WINDOW_MISMATCH")
        for duties in (["Z9"], []):
            with self.subTest(duties=duties):
                self.assertEqual(self.code("registration-shape", self.derived(changed_duties=duties)), "DUTY_UNKNOWN")
        root = self.world.body(["rsi@1"], {"rsi@1": self.root_review}, changed_duties=["A1"])
        self.assertEqual(self.code("registration-shape", root), "DUTY_UNKNOWN")
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
                self.assertEqual(self.code("registration-shape", body), "PREDICTION_INVALID")
        two = self.derived(changed_duties=["G3", "E1"])
        self.assertEqual(self.code("registration-shape", two), "PREDICTION_INVALID")
        root = self.world.body(["rsi@1"], {"rsi@1": self.root_review})
        root["prediction"]["mechanism"] = [{"slice": "made_up", "measure": "unit_return", "direction": "up",
                                            "duty": "B1", "reason": "r"}]
        self.assertEqual(self.code("registration-shape", root), "PREDICTION_INVALID")
        without_slice = self.derived()
        without_slice["prediction"]["mechanism"] = [{"slice": None, "measure": None, "direction": "down",
                                                     "duty": "G3", "reason": "no slice measures queue position"}]
        self.world.register("registration-no-slice", without_slice)

    def test_a_root_may_predict_mechanisms_on_any_duty(self):
        root = self.world.body(["rsi@1"], {"rsi@1": self.root_review})
        root["prediction"]["mechanism"] = [{"slice": "by_period", "measure": "months_won_share", "direction": "up",
                                            "duty": "B1", "reason": "the mispricing persists across months"}]
        self.assertFalse(self.world.register("registration-root-predicted", root)["replayed"])

    def test_lineage_grid_and_references_are_checked_against_the_ledger(self):
        cases = {
            "root with control": self.world.body(["rsi@1"], {"rsi@1": self.root_review}, control_run=1),
            "root with change": self.world.body(["rsi@1"], {"rsi@1": self.root_review}, change="x"),
            "derived without change": self.derived(change=None),
            "unknown parent": self.derived(parent="ghost@1"),
            "no control, no local diagnosis": self.derived(rationale={"external": "", "local": " ",
                                                                      "conjecture": "c"}),
            "unknown grid candidate": self.derived(grid=[{"candidate": "rsi@99", "params": {}}]),
            "repeated grid source": self.derived(grid=[{"candidate": self.child["candidate"], "params": {}}] * 2),
            "unknown retry_of": self.derived(retry_of="registration-ghost"),
            "retry_of outside the registration namespace": self.derived(retry_of="research-line-1"),
        }
        for label, body in cases.items():
            with self.subTest(label=label):
                self.assertEqual(self.code("registration-lineage", body), "REGISTRATION_INVALID")
        self.assertEqual(self.code("registration-lineage", self.derived(change="cap volume at 6%")),
                         "LINEAGE_MISMATCH")
        self.assertEqual(self.code("registration-lineage", self.world.body(
            [self.child["candidate"]], {self.child["candidate"]: self.child_review})), "LINEAGE_MISMATCH")
        with patch.object(strategies, "RUNTIME_CONTRACT", "r0-retired"):
            retired = self.world.publish("retired contract")
        self.assertEqual(self.code("registration-lineage", self.derived(
            grid=[{"candidate": retired["candidate"], "params": {}}])), "CONFIG_MISMATCH")
        self.assertEqual(self.code("registration-lineage", self.derived(control_run=999)), "RUN_NOT_PASSED")

    def test_every_grid_source_needs_a_passing_review_and_no_prior_exposure(self):
        self.assertEqual(self.code("registration-review", self.derived(prechecks={})), "SOURCE_PRECHECK_REQUIRED")
        failing = self.world.publish("fails its precheck")
        bundle = self.world.prechecked(failing["source"], native_exit=1)
        self.assertEqual(self.code("registration-review", self.derived(
            grid=[{"candidate": failing["candidate"], "params": {}}], prechecks={failing["candidate"]: bundle})),
            "SOURCE_PRECHECK_FAILED")
        explored = self.world.publish("explored first")
        review = self.world.prechecked(explored["source"])
        trials.open_trial(self.world.conn, "explore", sha(explored["source"]), RUNTIME,
                          {"identity": {"market_commit": MARKET_COMMIT, "universe_rule": "pool-v1",
                                        "symbols": ["AAAUSDT"], "export_content_sha256": "e" * 64},
                           "input_coverage": b"{}"}, LINE_WINDOW, context(explored["source"], "/tmp/peek"))
        body = self.derived(grid=[{"candidate": explored["candidate"], "params": {}}],
                            prechecks={explored["candidate"]: review})
        self.assertEqual(self.code("registration-exposed", body), "SOURCE_ALREADY_EXPOSED")
        self.assertEqual(self.code("registration-exposed", {**body, "retry_of": "registration-root"}),
                         "SOURCE_ALREADY_EXPOSED")

    def test_only_the_cited_precheck_of_at_most_seven_days_leaves_the_source_unexposed(self):
        long = self.world.publish("prechecked for eight days")
        review = self.world.prechecked(long["source"], days=8)
        body = self.derived(grid=[{"candidate": long["candidate"], "params": {}}], prechecks={long["candidate"]: review})
        self.assertEqual(self.code("registration-long-precheck", body), "SOURCE_ALREADY_EXPOSED")
        week = self.world.publish("prechecked for seven days")
        review = self.world.prechecked(week["source"], days=7)
        self.world.register("registration-week-precheck", self.derived(
            grid=[{"candidate": week["candidate"], "params": {}}], prechecks={week["candidate"]: review}))
        twice = self.world.publish("prechecked twice")
        self.world.prechecked(twice["source"])
        review = self.world.prechecked(twice["source"])
        self.assertEqual(self.code("registration-second-precheck", self.derived(
            grid=[{"candidate": twice["candidate"], "params": {}}], prechecks={twice["candidate"]: review})),
            "SOURCE_ALREADY_EXPOSED")

    def test_registration_needs_a_research_line(self):
        body = self.world.body(["rsi@1"], {"rsi@1": self.root_review})
        with patch("ledger.lines.current_line", return_value=None):
            self.assertEqual(self.code("registration-lineless", body), "RESEARCH_LINE_REQUIRED")
            exc = refused(register.validate, self.world.conn, body, self.registered["execution"], False)
            self.assertEqual(exc.code, "RESEARCH_LINE_REQUIRED")


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

    def registration(self) -> tuple[str, bytes]:
        """A fresh root candidate, prechecked, reviewed and registered alone."""
        self.__class__.count += 1
        point = self.world.publish(f"bind root {self.count}", parent=None)
        review = self.world.prechecked(point["source"])
        bundle = f"registration-bind-{self.count}"
        self.world.register(bundle, self.world.body([point["candidate"]], {point["candidate"]: review}))
        return bundle, point["source"]

    def trial_count(self) -> int:
        return self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM trial")[0][0]

    def refused_trial(self, bundle, data, **kwargs) -> Refusal:
        seq, count = self.world.seq(), self.trial_count()
        exc = refused(self.world.research_trial, bundle, data, **kwargs)
        self.assertEqual((self.world.seq(), self.trial_count()), (seq, count), "a refused binding leaves no trial")
        return exc

    def test_a_bound_trial_consumes_its_grid_point_once_even_when_it_fails(self):
        bundle, data = self.registration()
        trial_id = self.world.research_trial(bundle, data)
        rows = self.world.service.sql(self.world.profile, "SELECT registration_bundle, source_sha256 FROM "
                                                          "registration_attempt WHERE trial_id = %s", (trial_id,))
        self.assertEqual(rows, [(bundle, sha(data))])
        commits = {commit for (commit,) in self.world.service.sql(
            self.world.profile, "SELECT to_commit FROM dolt_diff_trial WHERE to_trial_id = %s UNION ALL SELECT "
                                "to_commit FROM dolt_diff_registration_attempt WHERE to_trial_id = %s",
            (trial_id, trial_id))}
        self.assertEqual(len(commits), 1)
        registered_at, trial_at = self.world.service.sql(
            self.world.profile, "SELECT b.created_at, t.created_at FROM evidence_bundle b, trial t "
                                "WHERE b.bundle = %s AND t.trial_id = %s", (bundle, trial_id))[0]
        self.assertLess(registered_at, trial_at)
        self.assertEqual(self.refused_trial(bundle, data).code, "GRID_ALREADY_ATTEMPTED")
        self.world.seal_run(trial_id, "invalid")
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
        self.assertEqual(self.refused_trial(bundle, data).code, "GRID_ALREADY_ATTEMPTED")

    def test_two_concurrent_bindings_of_one_grid_point_commit_once(self):
        bundle, data = self.registration()
        execution = self.world.plan(bundle)["execution"]
        barrier, outcomes = threading.Barrier(2, timeout=60), {}

        def race(label: str) -> None:
            conn = db.connect(self.world.profile, "writer")
            try:
                def binder(c, trial_id):
                    register.bind(c, bundle, sha(data), trial_id)
                    barrier.wait()
                trials.open_trial(conn, "research", sha(data), RUNTIME,
                                  {"identity": execution["input_identity"],
                                   "input_coverage": coverage_bytes(execution["effective_config"])},
                                  LINE_WINDOW, context(data, f"/tmp/{label}"), binder)
                outcomes[label] = "written"
            except Refusal as exc:
                outcomes[label] = exc.code
            finally:
                conn.close()

        threads = [threading.Thread(target=race, args=(label,)) for label in ("race-a", "race-b")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(outcomes.values()), ["CONCURRENT_WRITE", "written"])
        self.assertEqual(self.world.service.sql(self.world.profile, "SELECT COUNT(*) FROM registration_attempt WHERE "
                                                                    "registration_bundle = %s", (bundle,)), [(1,)])

    def test_a_registration_recorded_after_the_trial_cannot_bind_it(self):
        bundle, data = self.registration()
        plan = self.world.service.sql(self.world.profile, "SELECT content FROM evidence WHERE bundle = %s",
                                      (bundle,))[0][0]

        def late(conn, trial_id):
            evidence.write_files(conn, f"{bundle}-late", {"research-plan.json": bytes(plan)}, f"late:{trial_id}")
            register.bind(conn, f"{bundle}-late", sha(data), trial_id)

        self.assertEqual(self.refused_trial(bundle, data, binder=late).code, "REGISTRATION_TOO_LATE")
        self.world.research_trial(bundle, data)

    def test_the_executed_source_and_execution_must_be_the_registered_ones(self):
        bundle, data = self.registration()
        outsider = self.world.publish("not in the grid", parent=None)["source"]
        self.assertEqual(self.refused_trial(bundle, outsider).code, "SOURCE_MISMATCH")
        execution = copy.deepcopy(self.world.plan(bundle)["execution"])
        execution["input_identity"]["symbols"] = ["AAAUSDT"]
        exc = self.refused_trial(bundle, data, execution=execution)
        self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", ("instruments", "input_identity")))
        execution = copy.deepcopy(self.world.plan(bundle)["execution"])
        execution["effective_config"]["account"] = {"balance_usdt": "1"}
        exc = self.refused_trial(bundle, data, execution=execution)
        self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", ("effective_configuration",)))
        exc = self.refused_trial(bundle, data, runtime=OTHER_RUNTIME)
        self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", ("runtime_image",)))
        exc = self.refused_trial(bundle, data, runtime={**RUNTIME, "runtime_contract": "r1-native-v7"})
        self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", ("runtime_contract",)))
        self.world.research_trial(bundle, data)

    def test_the_trial_row_and_receipt_are_checked_not_a_caller_supplied_execution(self):
        bundle, data = self.registration()
        registered = self.world.plan(bundle)["execution"]
        shifted = {"start": LINE_WINDOW["start"], "trade_start": JAN + 10 * DAY, "end": FEB}
        exc = self.refused_trial(bundle, data, window=shifted)
        self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", ("window",)))
        narrower = copy.deepcopy(registered)
        narrower["input_identity"]["symbols"] = ["AAAUSDT"]
        narrower["effective_config"]["symbols"] = ["AAAUSDT"]
        exc = self.refused_trial(bundle, data, execution=narrower, window=shifted)
        self.assertEqual((exc.code, exc.missing), ("EXECUTION_MISMATCH", ("window", "instruments",
                                                                          "effective_configuration", "input_identity")))
        seq = self.world.seq()
        exc = refused(trials.open_trial, self.world.conn, "validation", sha(data), RUNTIME,
                      {"identity": registered["input_identity"],
                       "input_coverage": coverage_bytes(registered["effective_config"])},
                      LINE_WINDOW, context(data, "/tmp/bind-as-validation"), register.binder(bundle, sha(data)))
        self.assertEqual((exc.code, exc.missing, self.world.seq()), ("EXECUTION_MISMATCH", ("purpose",), seq))
        self.world.research_trial(bundle, data)

    def test_a_bundle_outside_the_registration_namespace_cannot_bind(self):
        bundle, data = self.registration()
        other = self.world.publish("forged plan", parent=None)
        review = self.world.prechecked(other["source"])
        plan = self.world.plan(bundle)
        plan["body"] = self.world.body([other["candidate"]], {other["candidate"]: review})
        path = self.world.tmp / "research-plan.json"
        path.write_text(json.dumps(plan))
        evidence.add_bundle(self.world.conn, "my-plan", [path])  # the public writer of Agent evidence
        exc = self.refused_trial("my-plan", other["source"], execution=plan["execution"],
                                 binder=register.binder("my-plan", sha(other["source"])))
        self.assertEqual(exc.code, "REGISTRATION_INVALID")

    def test_a_missing_or_damaged_registration_bundle_cannot_bind(self):
        bundle, data = self.registration()
        product_write(self.world.conn, "damaged_plan", "registration-damaged", {"research-plan.json": b"{not json"})
        for name, expected in (("registration-ghost", "REGISTRATION_INVALID"),
                               ("registration-damaged", "LEDGER_CORRUPT")):
            with self.subTest(name=name):
                exc = self.refused_trial(bundle, data, binder=register.binder(name, sha(data)))
                self.assertEqual(exc.code, expected)


@unittest.skipUnless(BINARY, SKIP)
class LineRecordTests(unittest.TestCase):
    """The gates before the next registration, and the control run of a derived registration."""

    def setUp(self):
        self.world = World("records")
        self.addCleanup(self.world.close)
        world = self.world
        self.root_review = world.prechecked(source("root"))
        world.register("registration-root", world.body(["rsi@1"], {"rsi@1": self.root_review}))
        self.root_trial = world.research_trial("registration-root", source("root"))
        self.child = world.publish("child")
        self.child_review = world.prechecked(self.child["source"])

    def derived(self, control_run=None, **overrides) -> dict:
        return self.world.body([self.child["candidate"]], {self.child["candidate"]: self.child_review},
                               parent="rsi@1", change="cap volume at 5%", duties=["G3"], control_run=control_run,
                               **overrides)

    def code(self, body, **kwargs) -> str:
        return refused(self.world.register, "registration-child", body, **kwargs).code

    def test_interpretations_cadence_and_due_reviews_gate_the_next_registration(self):
        world = self.world

        def supersede(kind, old, cadence=None):
            return judgments.add_judgment(world.profile, kind, world.line["bundle"], db.head_commit(world.conn),
                                          f"revised {kind}", cadence_trials=cadence, supersedes=old)["judgment_id"]

        self.assertEqual(self.code(self.derived()), "REVIEW_CADENCE_REQUIRED")
        cadence = world.judge("review_cadence", cadence=2)
        world.register("registration-unfinished", self.derived())  # the root trial has no run: not completed yet
        run_id = world.seal_run(self.root_trial)
        another = world.publish("second child")
        review = world.prechecked(another["source"])
        body = world.body([another["candidate"]], {another["candidate"]: review}, parent="rsi@1",
                          change="cap volume at 5%", duties=["G3"], control_run=run_id)
        exc = refused(world.register, "registration-gated", body)
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {self.root_trial}",)))
        first = world.judge("interpretation", subjects=[{"role": "about", "registration_bundle": "registration-root"}])
        supersede("interpretation", first)  # a superseded interpretation still covers its trial
        supersede("review_cadence", cadence, cadence=1)
        self.assertEqual(refused(world.register, "registration-gated", body).code, "REVIEW_DUE")
        world.judge("recommendation", subjects=[{"role": "recommended", "candidate": "rsi@1"}])
        self.assertFalse(world.register("registration-gated", body)["replayed"])

    def test_the_control_must_be_a_comparable_passed_run_with_economic_evidence(self):
        world = self.world
        run_id = world.seal_run(self.root_trial)
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.root_trial}])
        world.judge("review_cadence", cadence=50)
        narrower = world.body([self.child["candidate"]], {self.child["candidate"]: self.child_review},
                              parent="rsi@1", change="cap volume at 5%", duties=["G3"], control_run=run_id)
        exc = refused(world.register, "registration-narrow", narrower,
                      runner_argv=[*RUNNER_ARGV, "--symbols", "AAAUSDT"])
        self.assertEqual((exc.code, exc.missing),
                         ("COMPARABILITY_MISMATCH", ("effective_configuration", "input_identity")))
        world.qualification.unavailable.add(run_id)
        self.assertEqual(self.code(self.derived(control_run=run_id)), "ECONOMIC_EVIDENCE_UNAVAILABLE")
        world.qualification.unavailable.clear()
        registered = world.register("registration-child", self.derived(control_run=run_id))
        self.assertFalse(registered["replayed"])

    def test_a_control_that_failed_or_lacks_its_identity_is_refused(self):
        world = self.world
        run_id = world.seal_run(self.root_trial, "invalid")
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": self.root_trial}])
        world.judge("review_cadence", cadence=50)
        self.assertEqual(self.code(self.derived(control_run=run_id)), "RUN_NOT_PASSED")
        blank = world.publish("blank identity", parent=None)
        review = world.prechecked(blank["source"])
        world.register("registration-blank", world.body([blank["candidate"]], {blank["candidate"]: review}))
        execution = world.plan("registration-blank")["execution"]
        # A stand-in binder: registration.bind refuses a trial whose receipt lacks the configuration.
        trial_id = trials.open_trial(world.conn, "research", sha(blank["source"]), RUNTIME,
                                     {"identity": execution["input_identity"], "input_coverage": b'{"format": "x"}'},
                                     LINE_WINDOW, context(blank["source"], "/tmp/blank"),
                                     attempt_binder("registration-blank", sha(blank["source"])))["trial_id"]
        blank_run = world.seal_run(trial_id)
        world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
        self.assertEqual(self.code(self.derived(control_run=blank_run)), "IDENTITY_MALFORMED")


@unittest.skipUnless(BINARY, SKIP)
class RetryTests(unittest.TestCase):
    """research retries along the retry_of chain of root registrations of rsi@1."""

    def setUp(self):
        self.world = World("retry")
        self.addCleanup(self.world.close)
        self.world.judge("review_cadence", cadence=50)
        self.body = self.world.body(["rsi@1"], {"rsi@1": self.world.prechecked(source("root"))})

    def attempt(self, bundle: str, retry_of: str | None, outcome: str | None) -> int:
        """Register, bind and finish one attempt: a run status, an original capture outcome or nothing."""
        self.world.register(bundle, {**self.body, "retry_of": retry_of} if retry_of else self.body)
        trial_id = self.world.research_trial(bundle, source("root"))
        if outcome in ("passed", "invalid"):
            self.world.seal_run(trial_id, outcome)
            self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial_id}])
        elif outcome is not None:
            capture(self.world.conn, trial_id, source("root"), purpose="research", outcome=outcome)
        return trial_id

    def code(self, bundle: str, retry_of: str) -> str:
        return refused(self.world.register, bundle, {**self.body, "retry_of": retry_of}).code

    def test_a_retry_follows_the_chain_of_invalid_and_interrupted_attempts(self):
        self.attempt("registration-r1", None, "invalid")
        self.attempt("registration-r2", "registration-r1", "interrupted")
        self.attempt("registration-r3", "registration-r2", "host_failure")
        self.assertFalse(self.world.register("registration-r4", {**self.body, "retry_of": "registration-r3"})[
            "replayed"])

    def test_an_invalid_run_that_a_registration_retries_needs_no_interpretation(self):
        self.world.register("registration-r1", self.body)
        failed = self.world.research_trial("registration-r1", source("root"))
        self.world.seal_run(failed, "invalid")
        exc = refused(self.world.register, "registration-other", self.body)
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {failed}",)))
        self.world.register("registration-r2", {**self.body, "retry_of": "registration-r1"})
        line = self.world.line["bundle"]
        self.assertIsNone(register.require_line_records(self.world.conn, line, False), "the stored retry exempts it")
        passed = self.world.research_trial("registration-r2", source("root"))
        self.world.seal_run(passed, "passed")
        exc = refused(register.require_line_records, self.world.conn, line, False)
        self.assertEqual((exc.code, exc.missing), ("INTERPRETATION_REQUIRED", (f"trial {passed}",)),
                         "a valid run still needs its interpretation")

    def test_a_retry_of_a_passed_or_unfinished_attempt_is_refused(self):
        self.attempt("registration-r1", None, "invalid")
        unfinished = self.attempt("registration-r2", "registration-r1", None)
        self.assertEqual(self.code("registration-r3", "registration-r2"), "RETRY_NOT_ALLOWED")
        capture(self.world.conn, unfinished, source("root"), purpose="research", outcome="completed")
        self.assertEqual(self.code("registration-r3", "registration-r2"), "RETRY_NOT_ALLOWED")

    def test_a_passed_run_admits_a_retry_only_without_economic_evidence(self):
        trial_id = self.attempt("registration-r1", None, "passed")
        self.assertEqual(self.code("registration-r2", "registration-r1"), "RETRY_NOT_ALLOWED")
        run_id = self.world.service.sql(self.world.profile, "SELECT run_id FROM run WHERE trial_id = %s",
                                        (trial_id,))[0][0]
        self.world.qualification.unavailable.add(run_id)
        self.world.register("registration-r2", {**self.body, "retry_of": "registration-r1"})
        self.world.qualification.unavailable.clear()


if __name__ == "__main__":
    unittest.main()
