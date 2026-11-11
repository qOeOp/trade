"""Runtime failure receipts as failure reasons: one reason per distinct failure with its count, the
runner's refusal before the strategy as the cause, for one-row-per-failure receipts and for
runtime-failure receipts that carry their count, code and overflow record; and the fingerprint
stage a run needs."""

from __future__ import annotations

import json
import unittest

from ledger import problems


PASSED = json.dumps({"passed": True, "findings": []}).encode()


def reasons(*receipts: dict) -> list[dict]:
    data = "".join(json.dumps(item) + "\n" for item in receipts).encode()
    return problems.audit_problems(0, 0, PASSED, data)[0]


class RuntimeFailureTests(unittest.TestCase):
    def test_identical_failures_are_one_reason_with_their_count(self):
        bar = {"stage": "on_bar", "exception_type": "AttributeError", "instrument_id": "AAAUSDT-PERP.BINANCE",
               "message": "'dict' object has no attribute 'as_double'", "traceback": "Traceback ..."}
        found = reasons(*[bar] * 3, {**bar, "message": "another"}, {**bar, "count": 4})
        self.assertEqual([(item["code"], item["locator"]) for item in found],
                         [("RUNTIME_FAILURE_RECORDED", "on_bar:AAAUSDT-PERP.BINANCE")] * 2)
        self.assertTrue(found[0]["message"].endswith("(7 times)"), found[0]["message"])
        self.assertNotIn("times", found[1]["message"])
        self.assertEqual(len(problems.unique(found)), 2, "different messages at one locator stay apart")

    def test_a_refusal_before_the_strategy_is_the_first_reason_with_its_code(self):
        load = {"format": "runtime-failure", "stage": "load", "exception_type": "Refusal", "count": 1,
                "code": "CONTENT_HASH_MISMATCH", "instrument_id": "unconstructed",
                "message": "CONTENT_HASH_MISMATCH: strategy bytes do not match the expected SHA-256"}
        data = (json.dumps(load) + "\n").encode()
        found, _ = problems.audit_problems(1, None, None, data)
        self.assertEqual([item["code"] for item in found],
                         ["RUNNER_REFUSED", "NATIVE_EXIT_NONZERO", "AUDIT_NOT_RUN", "AUDIT_RESULT_MISSING"])
        self.assertEqual((found[0]["locator"], found[0]["message"]),
                         ("load:CONTENT_HASH_MISMATCH",
                          "CONTENT_HASH_MISMATCH in load: strategy bytes do not match the expected SHA-256"))
        replayed = {**load, "stage": "replay", "exception_type": "KeyError", "code": None, "message": "'x'"}
        (during,) = reasons(replayed)
        self.assertEqual((during["code"], during["message"]), ("RUNTIME_FAILURE_RECORDED", "KeyError in replay: 'x'"))

    def test_failures_beyond_the_itemised_records_are_counted_not_listed(self):
        overflow = {"format": "runtime-failure", "stage": "receipt_overflow", "exception_type": "various",
                    "instrument_id": "various", "code": None, "count": 42, "traceback": "",
                    "message": "failures beyond the first 100 distinct records"}
        (found,) = reasons(overflow)
        self.assertEqual((found["code"], found["message"]),
                         ("RUNTIME_FAILURES_NOT_ITEMISED", "42 more failures not itemised"))


class FingerprintTests(unittest.TestCase):
    def test_a_run_needs_a_fingerprint_stage_that_ran_and_exited_0(self):
        def code(fingerprint) -> list[str]:
            capture = {"stages": {"native": {"state": "exited", "exit_code": 0}, "fingerprint": fingerprint}}
            return [item["code"] for item in problems.capture_fingerprint(capture)[1]]
        self.assertEqual(code(None), ["FINGERPRINT_MISSING"])
        self.assertEqual(code({"state": "exited", "exit_code": 3}), ["FINGERPRINT_FAILED"])


if __name__ == "__main__":
    unittest.main()


class ConfigHashTests(unittest.TestCase):
    """The host derives the effective configuration hash the image recorded, writes the coverage receipt the
    image reads and publishes under the contract the image declares; both sides must agree byte for byte."""

    def test_host_and_image_name_the_same_coverage_format_and_runtime_contract(self):
        from engine import config as engine_config, load
        from ledger import coverage, strategies
        self.assertEqual(coverage.FORMAT, load.COVERAGE_FORMAT)
        self.assertEqual(strategies.RUNTIME_CONTRACT, engine_config.RUNTIME_CONTRACT)

    def test_host_and_image_hash_the_same_configuration_alike(self):
        from engine import config as engine_config
        self.assertEqual(problems.HOST_PATH_KEYS, engine_config.HOST_PATH_KEYS)
        value = {"execution": "bars", "label": "名前 ü", "fees": {"maker": 0.0002, "taker": 0.0005},
                 "symbols": ["BTCUSDT"], "market_root": "/host/market", "universe_path": "/host/universe.json"}
        self.assertEqual(problems.config_sha256(value), engine_config.config_sha256(value))

    def test_neither_side_hashes_a_nan(self):
        from engine import config as engine_config
        value = {"leverage": float("nan")}
        with self.assertRaises(ValueError):
            problems.config_sha256(value)
        with self.assertRaises(ValueError):
            engine_config.config_sha256(value)
