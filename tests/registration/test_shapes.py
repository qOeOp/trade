"""Registration shapes decided without a ledger: the body schema, the comparison design, and
comparability of execution identities."""

from __future__ import annotations

import copy
from datetime import datetime
import unittest

from ledger import trials
from shared.errors import Refusal
from registration import comparability, register
from tests.registration.world import DESIGN, config


def code(function, *args, **kwargs) -> str:
    try:
        function(*args, **kwargs)
    except Refusal as exc:
        return exc.code
    raise AssertionError(f"{function.__name__} did not refuse")


class DesignTests(unittest.TestCase):
    def test_a_declared_design_has_exactly_eight_fields_in_range(self):
        register.validate_design(DESIGN)
        register.validate_design({**DESIGN, "alpha": 0.4999, "minimum_effect": 0, "seed": 0})
        cases = [None, {**DESIGN, "extra": 1}, {k: v for k, v in DESIGN.items() if k != "seed"},
                 {**DESIGN, "method": "t-test"}, {**DESIGN, "block_days": 0}, {**DESIGN, "resamples": 998},
                 {**DESIGN, "inner_resamples": 98}, {**DESIGN, "seed": -1}, {**DESIGN, "seed": 1.0},
                 {**DESIGN, "block_days": True}, {**DESIGN, "alpha": 0}, {**DESIGN, "alpha": 0.5},
                 {**DESIGN, "alpha": float("nan")}, {**DESIGN, "alpha": "0.05"},
                 {**DESIGN, "minimum_effect": -0.01}, {**DESIGN, "minimum_effect": float("inf")},
                 {**DESIGN, "design_reason": "  "}, {**DESIGN, "design_reason": "x" * (register.TEXT_LIMIT + 1)}]
        for case in cases:
            with self.subTest(case=case):
                self.assertEqual(code(register.validate_design, case), "REGISTRATION_INVALID")


class SchemaTests(unittest.TestCase):
    def body(self) -> dict:
        from tests.registration.world import OUTCOMES
        return {"prediction": {"mechanism": [], "outcomes": dict(OUTCOMES)}, "changed_duties": [],
                "control_trial_id": None, "rationale": {"external": "", "local": "", "conjecture": "a guess"},
                "sources": [], "comparison": dict(DESIGN), "grid": ["rsi@1"], "prechecks": {"rsi@1": 1},
                "conditions": "all"}

    def refusal(self, body) -> Refusal:
        with self.assertRaises(Refusal) as caught:
            register._check_shape(body)
        self.assertEqual(caught.exception.code, "REGISTRATION_INVALID")
        return caught.exception

    def test_a_missing_field_is_named_and_its_description_quoted(self):
        register._check_shape(self.body())
        register._check_shape({**self.body(), "retry_of": 1})
        body = self.body()
        del body["prediction"]
        refused = self.refusal(body)
        self.assertEqual(refused.missing, ("prediction",))
        self.assertIn(register.plan_schema()["properties"]["prediction"]["description"], refused.message)
        refused = self.refusal({**self.body(), "notes": "x"})
        self.assertEqual(refused.missing, ("notes",))

    def test_parent_change_and_window_are_never_written(self):
        """The grid candidates give the parent and change, the line the window: a body naming them is refused."""
        for field, value in (("parent", "rsi@1"), ("change", None), ("window", {"trade_start": "2026-01-01"})):
            with self.subTest(field=field):
                self.assertEqual(self.refusal({**self.body(), field: value}).missing, (field,))

    def test_nested_shapes_are_refused_with_the_field_description(self):
        mutations = [
            lambda b: b["prediction"]["mechanism"].append({"slice": None, "measure": None, "direction": "sideways",
                                                           "duty": "G3", "reason": "r"}),
            lambda b: b["prediction"]["outcomes"].pop("invalid"),
            lambda b: b["prediction"]["outcomes"].update(loss=" "),
            lambda b: b.update(grid=[]),
            lambda b: b.update(grid=[f"rsi@{n}" for n in range(1, 7)]),
            lambda b: b.update(grid=["rsi"]),
            lambda b: b.update(grid=[{"candidate": "rsi@1", "params": {}}]),
            lambda b: b.update(control_trial_id=0),
            lambda b: b.update(rationale={"external": "", "local": "", "conjecture": ""}),
            lambda b: b.update(conditions=""),
            lambda b: b.update(prechecks={"rsi@1": "bad name"}),
            lambda b: b.update(prechecks={"rsi@1": 0}),
            lambda b: b.update(retry_of=0),
        ]
        for mutate in mutations:
            body = copy.deepcopy(self.body())
            mutate(body)
            with self.subTest(body=body):
                refused = self.refusal(body)
                field = refused.missing[0]
                self.assertIn(register.plan_schema()["properties"][field]["description"], refused.message)
        self.assertEqual(self.refusal(["not", "an", "object"]).code, "REGISTRATION_INVALID")
        self.assertEqual(self.refusal({**self.body(), "conditions": float("nan")}).code, "REGISTRATION_INVALID")


DIGEST = "sha256:" + "b" * 64


class ComparabilityTests(unittest.TestCase):
    def identity(self, **overrides) -> dict:
        return {"image_digest": DIGEST, "comparable_config_sha256": trials.comparable_config_sha256(config()),
                "export_sha256": "e" * 64, "input_start": datetime(2025, 12, 31),
                "trade_start": datetime(2026, 1, 1), "trade_end": datetime(2026, 2, 1), **overrides}

    def test_the_comparable_configuration_holds_what_a_replay_reads_beside_the_trial_columns(self):
        """Host locations, what the export content covers, and the window and instruments the trial row holds
        are set aside; anything else in the configuration makes it another one."""
        key = trials.comparable_config_sha256(config(root="/tmp/a"))
        self.assertEqual(key, trials.comparable_config_sha256(config(root="/var/b")))
        self.assertEqual(key, trials.comparable_config_sha256({**config(), "market_day": "n" * 32,
                                                               "universe_sha256": "f" * 64}))
        self.assertEqual(key, trials.comparable_config_sha256(config(
            symbols=["AAAUSDT"], start="2026-01-05T00:00:00Z", trade_start="2026-01-06T00:00:00Z",
            end="2026-01-08T00:00:00Z")))
        self.assertNotEqual(key, trials.comparable_config_sha256(config(account={"balance_usdt": "1"})))
        self.assertNotEqual(key, trials.comparable_config_sha256({**config(), "execution_bar_minutes": 5}))
        self.assertNotIn("market_root", trials.config_key(config()))

    def test_malformed_configurations_are_refused_not_compared(self):
        for value in (None, [], {k: v for k, v in config().items() if k != "account"}):
            with self.subTest(value=value):
                self.assertEqual(code(trials.comparable_config_sha256, value), "IDENTITY_MALFORMED")

    def test_the_execution_environment_makes_runs_incomparable(self):
        """Same image, inputs and window: a bar-environment run and a quote-environment run differ in the effective
        configuration's account, so they are never compared as the same conditions."""
        from engine.config import execution_account

        def under(*environment) -> dict:
            return self.identity(comparable_config_sha256=trials.comparable_config_sha256(
                config(account=execution_account(*environment))))
        bars, quotes, other_rates = under("bars", None), under("quotes", ("0.05", "0.025")), \
            under("quotes", ("0.05", "0.02"))
        run = {"trial_id": 1, "status": "passed", "purpose": "research", **bars}
        comparability.check_comparable(run, bars)
        with self.assertRaises(Refusal) as caught:
            comparability.check_comparable(run, quotes)
        self.assertEqual((caught.exception.code, caught.exception.missing),
                         ("COMPARABILITY_MISMATCH", ("comparable_config_sha256",)))
        self.assertEqual(code(comparability.check_comparable, {**run, **quotes}, other_rates), "COMPARABILITY_MISMATCH")

    def test_check_comparable_names_every_conflict(self):
        execution = self.identity()
        run = {"trial_id": 1, "status": "passed", "purpose": "research", **execution}
        comparability.check_comparable(run, execution)
        comparability.check_comparable({**run, "purpose": "validation"}, execution)
        for changed in ({"status": "invalid"}, {"status": None}, {"purpose": "explore"}, {"purpose": "precheck"}):
            with self.subTest(changed=changed):
                self.assertEqual(code(comparability.check_comparable, {**run, **changed}, execution), "RUN_NOT_PASSED")
        other = self.identity(image_digest="sha256:" + "c" * 64, comparable_config_sha256="0" * 64,
                              export_sha256="f" * 64, trade_start=datetime(2026, 1, 2))
        with self.assertRaises(Refusal) as caught:
            comparability.check_comparable({**run, **other}, execution)
        self.assertEqual((caught.exception.code, caught.exception.missing),
                         ("COMPARABILITY_MISMATCH", ("image_digest", "comparable_config_sha256", "export_sha256",
                                                     "trade_start")))
        comparability.check_comparable({**run, **other, "reproductions": [self.identity()]}, execution)
        with self.assertRaises(Refusal) as caught:
            comparability.check_comparable({**run, "export_sha256": other["export_sha256"],
                                             "reproductions": [{**execution, "image_digest": other["image_digest"]}]},
                                            execution)
        self.assertEqual(caught.exception.code, "COMPARABILITY_MISMATCH",
                         "one identity must hold all: the image of one and the inputs of another never ran")
        self.assertEqual(code(comparability.check_comparable, {**run, "image_digest": None},
                              {**execution, "image_digest": None}), "COMPARABILITY_MISMATCH",
                         "a missing image digest is never equal")
