"""Runtime failure receipts as failure reasons: one reason per distinct failure with its count and the
runner's refusal code, for one-row-per-failure receipts and for receipts that already carry a count."""

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

    def test_a_load_stage_refusal_shows_the_runners_code(self):
        load = {"stage": "load", "exception_type": "Refusal", "code": "BINDING_MISMATCH", "count": 1,
                "message": "strategy binding must contain the exact Dolt revision identity"}
        (found,) = reasons(load)
        self.assertEqual((found["locator"], found["message"]),
                         ("load:unconstructed", "Refusal BINDING_MISMATCH in load: strategy binding must contain the "
                                                "exact Dolt revision identity"))
        (coded,) = reasons({**load, "code": None, "message": "BINDING_MISMATCH: strategy binding is not valid JSON"})
        self.assertEqual(coded["message"], "Refusal in load: BINDING_MISMATCH: strategy binding is not valid JSON")


if __name__ == "__main__":
    unittest.main()
