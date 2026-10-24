"""v6 -> v7 technical recovery preserves the research source and canonical market selection."""

import copy
import unittest
from unittest.mock import patch

from ledger import strategies
from registration import comparability, precheck, seams
from tests.ledger.dolt import BINARY, RUNTIME, SKIP, source
from tests.registration.test_register import OTHER_RUNTIME, refused
from tests.registration.world import World, capture, config, inspect_stand_in


V6 = "replay-contract@v6"
V7 = "replay-contract@v7"
BAR_DEFAULTS = {"execution": "bars", "liquidation_enabled": False, "margin_model": "default",
                "initial_margin_rate": None, "maintenance_margin_rate": None}
OLD_RUNTIME = {**RUNTIME, "runtime_contract": V6, "inspection": {"runtime_contract": V6}}


def inspect(identity, argv, inputs):
    found = inspect_stand_in(identity, argv, inputs)
    found["effective_config"]["runtime_contract"] = identity["runtime_contract"]
    found["effective_config"]["account"]["bar_execution"] = True
    if identity["runtime_contract"] == V7:
        found["effective_config"]["account"].update(BAR_DEFAULTS)
    return found


class IdentityTests(unittest.TestCase):
    def identities(self):
        old = {"runtime_contract": V6, "effective_config": config(account={"bar_execution": True}),
               "input_identity": {"market_commit": "m" * 32, "universe_rule": "pool-v1", "symbols": ["AAAUSDT"],
                                  "export_content_sha256": "e" * 64, "exporter_source_sha256": "a" * 64}}
        old["effective_config"]["runtime_contract"] = V6
        new = copy.deepcopy(old)
        new["runtime_contract"] = new["effective_config"]["runtime_contract"] = V7
        new["effective_config"]["account"].update(BAR_DEFAULTS)
        new["input_identity"].update(export_content_sha256="f" * 64, exporter_source_sha256="b" * 64)
        return old, new

    def test_source_abi_admission_is_directional_and_does_not_admit_old_images(self):
        self.assertTrue(comparability.source_contract_supported(V6, V7))
        for old, new in ((V7, V6), ("replay-contract@v5", V7), (V6, "replay-contract@v8")):
            self.assertFalse(comparability.source_contract_supported(old, new))

    def test_only_the_declared_bars_migration_can_repin_export_artifacts(self):
        old, new = self.identities()
        untouched = copy.deepcopy(old), copy.deepcopy(new)
        self.assertTrue(comparability.rebuild_identity_matches(old, new))
        self.assertEqual((old, new), untouched)
        for section, key, value in (
            ("input_identity", "market_commit", "n" * 32),
            ("input_identity", "symbols", ["BBBUSDT"]),
            ("input_identity", "membership", {"AAAUSDT": []}),
            ("effective_config", "end", "2026-02-02T00:00:00Z"),
        ):
            changed = copy.deepcopy(new)
            changed[section][key] = value
            self.assertFalse(comparability.rebuild_identity_matches(old, changed))
        for key, value in (("execution", "quotes"), ("liquidation_enabled", True),
                           ("initial_margin_rate", "0.05"), ("starting_balance_usdt", "200000")):
            changed = copy.deepcopy(new)
            changed["effective_config"]["account"][key] = value
            self.assertFalse(comparability.rebuild_identity_matches(old, changed))
        same_contract = copy.deepcopy(old)
        same_contract["input_identity"]["export_content_sha256"] = "f" * 64
        self.assertFalse(comparability.rebuild_identity_matches(old, same_contract))


@unittest.skipUnless(BINARY, SKIP)
class ContractMigrationTests(unittest.TestCase):
    def setUp(self):
        with patch.object(strategies, "RUNTIME_CONTRACT", V6):
            self.world = World("contract-migration")
        self.addCleanup(self.world.close)
        self.old = seams.use(resolve_runtime=lambda ref: dict(OLD_RUNTIME), inspect_runtime=inspect)
        self.old.__enter__()
        self.addCleanup(self.old.__exit__, None, None, None)
        self.data = source("root")
        self.original = self.world.body(["rsi@1"], {"rsi@1": self.review(self.data, OLD_RUNTIME)}, comparison=None)
        self.world.register("registration-v6", self.original)
        self.original_trial = self.finish("registration-v6", self.data, OLD_RUNTIME)

    def review(self, data, runtime):
        effective = config(symbols=["AAAUSDT"], start="2026-01-05T00:00:00Z",
                           trade_start="2026-01-06T00:00:00Z", end="2026-01-08T00:00:00Z")
        effective["runtime_contract"] = runtime["runtime_contract"]
        effective["account"]["bar_execution"] = True
        if runtime["runtime_contract"] == V7:
            effective["account"].update(BAR_DEFAULTS)
        trial = self.world.open_precheck(data, runtime=runtime, effective_config=effective)
        capture(self.world.conn, trial, data)
        return precheck.record_review(self.world.profile, self.world.review_body(trial), "fresh-reviewer")["bundle"]

    def finish(self, bundle, data, runtime):
        trial = self.world.research_trial(bundle, data, runtime=runtime)
        self.world.seal_run(trial)
        self.world.judge("interpretation", subjects=[{"role": "about", "trial_id": trial}])
        return trial

    def on_v7(self):
        return seams.use(resolve_runtime=lambda ref: dict(OTHER_RUNTIME), inspect_runtime=inspect)

    def test_rebuilds_a_root_then_its_child_using_only_v7_controls(self):
        with patch.object(strategies, "RUNTIME_CONTRACT", V6):
            child = self.world.publish("legacy child")
        original = self.world.body([child["candidate"]], {child["candidate"]: self.review(child["source"], OLD_RUNTIME)},
                                   parent="rsi@1", control_trial_id=self.original_trial,
                                   change="cap volume at 5%", duties=["G3"])
        self.world.register("registration-child-v6", original)
        self.finish("registration-child-v6", child["source"], OLD_RUNTIME)
        with self.on_v7():
            rebuilt = {**self.original, "retry_of": "registration-v6",
                       "prechecks": {"rsi@1": self.review(self.data, OTHER_RUNTIME)}}
            self.world.register("registration-v7", rebuilt)
            control = self.finish("registration-v7", self.data, OTHER_RUNTIME)
            body = {**original, "retry_of": "registration-child-v6",
                    "prechecks": {child["candidate"]: self.review(child["source"], OTHER_RUNTIME)}}
            self.assertEqual(refused(self.world.register, "registration-stale-control", body).code,
                             "COMPARABILITY_MISMATCH")
            self.world.register("registration-child-v7", {**body, "control_trial_id": control})
            self.finish("registration-child-v7", child["source"], OTHER_RUNTIME)
        self.assertEqual(self.world.plan("registration-v6")["body"], self.original)
        self.assertEqual(strategies.read_candidate(self.world.conn, "rsi@1")["runtime_contract"], V6)

    def test_a_lost_control_can_only_be_dropped_for_an_unpaired_migration_baseline(self):
        with patch.object(strategies, "RUNTIME_CONTRACT", V6):
            child = self.world.publish("orphaned child")
        original = self.world.body([child["candidate"]], {child["candidate"]: self.review(child["source"], OLD_RUNTIME)},
                                   parent="rsi@1", control_trial_id=self.original_trial,
                                   change="cap volume at 5%", duties=["G3"])
        self.world.register("registration-child-v6", original)
        self.finish("registration-child-v6", child["source"], OLD_RUNTIME)
        with self.on_v7():
            body = {**original, "retry_of": "registration-child-v6", "control_trial_id": None, "comparison": None,
                    "prechecks": {child["candidate"]: self.review(child["source"], OTHER_RUNTIME)}}
            self.assertEqual(refused(self.world.register, "registration-drop-valid", body).code, "RETRY_NOT_ALLOWED")
            self.world.qualification.unavailable.add(self.original_trial)
            changed = copy.deepcopy(body)
            changed["grid"][0]["params"]["cap"] = 2
            self.assertEqual(refused(self.world.register, "registration-change-question", changed).code,
                             "RETRY_NOT_ALLOWED")
            self.world.register("registration-baseline-v7", body)
            self.finish("registration-baseline-v7", child["source"], OTHER_RUNTIME)
            self.assertIsNone(self.world.plan("registration-baseline-v7")["body"]["comparison"])
        self.assertEqual(self.world.plan("registration-child-v6")["body"], original)
