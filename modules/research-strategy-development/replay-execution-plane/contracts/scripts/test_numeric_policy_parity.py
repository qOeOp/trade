import json
import unittest
from decimal import Decimal, ROUND_CEILING, ROUND_DOWN, ROUND_FLOOR, ROUND_HALF_UP, localcontext
from pathlib import Path


FIXTURE = Path(__file__).parents[1] / "src" / "fixtures" / "numeric-policy-v3-vectors.json"
ROUNDING = {
    "ceil": ROUND_CEILING,
    "floor": ROUND_FLOOR,
    "toward_zero": ROUND_DOWN,
    "half_away_from_zero": ROUND_HALF_UP,
}


def quantize_increment(value: Decimal, increment: str, rounding: str) -> Decimal:
    step = Decimal(increment)
    units = (value / step).to_integral_value(rounding=ROUNDING[rounding])
    return units * step


def canonical(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text


def evaluate(case: dict, derived_increment: str) -> Decimal:
    operation = case["operation"]
    if operation == "basis-point-price":
        basis = Decimal("10000")
        adjustment = Decimal(case["bps"])
        multiplier = basis + adjustment if case["side"] == "buy" else basis - adjustment
        rounding = "ceil" if case["side"] == "buy" else "floor"
        return quantize_increment(Decimal(case["price"]) * multiplier / basis, case["increment"], rounding)
    if operation == "product":
        value = Decimal("1")
        for item in case["values"]:
            value *= Decimal(item)
        return quantize_increment(value / Decimal(case["divisor"]), case["increment"], case["rounding"])
    if operation == "difference-product":
        value = (Decimal(case["minuend"]) - Decimal(case["subtrahend"])) * Decimal(case["multiplier"])
        value *= Decimal(case["direction"])
        return quantize_increment(value, case["increment"], case["rounding"])
    if operation == "weighted-average":
        numerator = (
            Decimal(case["prior_quantity"]) * Decimal(case["prior_price"])
            + Decimal(case["fill_quantity"]) * Decimal(case["fill_price"])
        )
        denominator = Decimal(case["prior_quantity"]) + Decimal(case["fill_quantity"])
        return quantize_increment(numerator / denominator, derived_increment, "half_away_from_zero")
    if operation == "divide":
        return quantize_increment(
            Decimal(case["dividend"]) / Decimal(case["divisor"]),
            derived_increment,
            "half_away_from_zero",
        )
    raise AssertionError(f"unsupported operation: {operation}")


class NumericPolicyParityTest(unittest.TestCase):
    def test_python_decimal_matches_shared_numeric_policy_vectors(self):
        fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(fixture["policy_version"], "rd-replay-number-v3")
        with localcontext() as context:
            context.prec = 80
            for case in fixture["cases"]:
                with self.subTest(case=case["id"]):
                    actual = evaluate(case, fixture["derived_decimal_increment"])
                    self.assertEqual(canonical(actual), case["expected"])


if __name__ == "__main__":
    unittest.main()
