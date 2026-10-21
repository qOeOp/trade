"""Registration shapes decided without a ledger: the body schema, the comparison design, and
comparability of execution identities."""

from __future__ import annotations

import copy
import unittest

from ledger.errors import Refusal
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
        return {"prediction": {"mechanism": [], "outcomes": dict(OUTCOMES)}, "changed_duties": [], "parent": None,
                "control_run": None, "change": None,
                "rationale": {"external": "", "local": "", "conjecture": "a guess"}, "sources": [],
                "comparison": dict(DESIGN), "grid": [{"candidate": "rsi@1", "params": {}}],
                "conditions": "all", "window": {"trade_start": "2026-01-01", "trade_end": "2026-02-01"}}

    def refusal(self, body) -> Refusal:
        with self.assertRaises(Refusal) as caught:
            register._check_shape(body)
        self.assertEqual(caught.exception.code, "REGISTRATION_INVALID")
        return caught.exception

    def test_a_missing_field_is_named_and_its_description_quoted(self):
        body = self.body()
        del body["prediction"]
        refused = self.refusal(body)
        self.assertEqual(refused.missing, ("prediction",))
        self.assertIn(register.plan_schema()["properties"]["prediction"]["description"], refused.message)
        refused = self.refusal({**self.body(), "notes": "x"})
        self.assertEqual(refused.missing, ("notes",))

    def test_nested_shapes_are_refused_with_the_field_description(self):
        mutations = [
            lambda b: b["prediction"]["mechanism"].append({"slice": None, "measure": None, "direction": "sideways",
                                                           "duty": "G3", "reason": "r"}),
            lambda b: b["prediction"]["outcomes"].pop("invalid"),
            lambda b: b["prediction"]["outcomes"].update(loss=" "),
            lambda b: b.update(grid=[]),
            lambda b: b.update(grid=[{"candidate": f"rsi@{n}", "params": {}} for n in range(1, 7)]),
            lambda b: b.update(grid=[{"candidate": "rsi", "params": {}}]),
            lambda b: b.update(control_run=0),
            lambda b: b.update(parent="no-revision"),
            lambda b: b.update(rationale={"external": "", "local": "", "conjecture": ""}),
            lambda b: b.update(window={"trade_start": "2026-01-01"}),
            lambda b: b.update(conditions=""),
            lambda b: b.update(prechecks={"rsi@1": "bad name"}),
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


class ComparabilityTests(unittest.TestCase):
    def identity(self, **overrides) -> dict:
        return {"market_database": "market", "market_commit": "m" * 32, "universe_rule": "pool-v1",
                "symbols": ["AAAUSDT"], "membership": {"AAAUSDT": [[0, 1]]}, "export_content_sha256": "e" * 64,
                "exporter_source_sha256": "f" * 64, **overrides}

    def test_keys_drop_host_locations_and_check_times_only(self):
        value = config(root="/tmp/a")
        key = comparability.config_key(value)
        self.assertNotIn("market_root", key)
        self.assertNotIn("universe_path", key)
        self.assertEqual(key, comparability.config_key(config(root="/var/b")))
        self.assertNotEqual(key, comparability.config_key(config(account={"balance_usdt": "1"})))
        self.assertIn("market_root", value)
        inputs = self.identity(export_root="/tmp/x", root="/tmp/y", checked="2026-01-01T00:00:00Z")
        self.assertEqual(comparability.input_key(inputs), self.identity())
        self.assertNotEqual(comparability.input_key(self.identity(market_commit="n" * 32)),
                            comparability.input_key(self.identity()))

    def test_malformed_identities_are_refused_not_compared(self):
        for value in (None, [], {k: v for k, v in config().items() if k != "account"}):
            with self.subTest(value=value):
                self.assertEqual(code(comparability.config_key, value), "IDENTITY_MALFORMED")
        for value in (None, {"market_commit": "m"}, {k: v for k, v in self.identity().items()
                                                     if k != "export_content_sha256"}):
            with self.subTest(value=value):
                self.assertEqual(code(comparability.input_key, value), "IDENTITY_MALFORMED")

    def test_check_comparable_names_every_conflict(self):
        execution = {"image_digest": "sha256:" + "b" * 64, "effective_config": config(),
                     "input_identity": self.identity()}
        run = {"run_id": 1, "status": "passed", "purpose": "research", **execution}
        comparability.check_comparable(run, execution)
        for changed in ({"status": "invalid"}, {"status": None}, {"purpose": "explore"}, {"purpose": "precheck"}):
            with self.subTest(changed=changed):
                self.assertEqual(code(comparability.check_comparable, {**run, **changed}, execution), "RUN_NOT_PASSED")
        other = {"image_digest": "sha256:" + "c" * 64, "effective_config": config(account={"balance_usdt": "1"}),
                 "input_identity": self.identity(market_commit="n" * 32)}
        with self.assertRaises(Refusal) as caught:
            comparability.check_comparable({**run, **other}, execution)
        self.assertEqual((caught.exception.code, caught.exception.missing),
                         ("COMPARABILITY_MISMATCH", ("runtime_image", "effective_configuration", "input_identity")))
        self.assertEqual(code(comparability.check_comparable, {**run, "effective_config": None}, execution),
                         "IDENTITY_MALFORMED")


if __name__ == "__main__":
    unittest.main()
