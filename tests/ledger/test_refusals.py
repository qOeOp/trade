"""Refusals: their fixed shape, and a catalogue entry for every refusal code the product packages and
the command line raise (the market package's coded errors included) and every failure reason they give."""

from __future__ import annotations

import ast
from pathlib import Path
import unittest

from ledger.errors import Refusal, refusal
from ledger.problems import REASONS
from ledger.refusals import CATALOGUE, MARKET_CATALOGUE, refusal_catalogue, refuse


ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ("cli", "ledger", "qualification", "registration", "replay", "report", "runtime")


def literal_codes(names: tuple[str, ...]) -> dict[str, list[str]]:
    """Every literal code passed to a call named one of `names` (or `module.name`) in the packages, with its sites."""
    found: dict[str, list[str]] = {}
    for package in PACKAGES:
        for path in sorted((ROOT / package).glob("*.py")):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if not isinstance(node, ast.Call) or not node.args:
                    continue
                func = node.func.id if isinstance(node.func, ast.Name) else (
                    node.func.attr if isinstance(node.func, ast.Attribute) else None)
                if (func in names and isinstance(node.args[0], ast.Constant)
                        and isinstance(node.args[0].value, str)):
                    found.setdefault(node.args[0].value, []).append(f"{package}/{path.name}:{node.lineno}")
    return found


class RefusalTests(unittest.TestCase):
    def test_every_raised_code_has_a_meaning_and_repair_commands(self):
        codes = literal_codes(("refuse", "refusal"))
        self.assertTrue(codes)
        for code, sites in codes.items():
            with self.subTest(code=code, sites=sites):
                self.assertIn(code, CATALOGUE)
                entry = refusal_catalogue(code)
                self.assertTrue(entry["message"].strip())
                self.assertTrue(entry["next_actions"] and all(action.strip() for action in entry["next_actions"]))

    def test_every_market_error_code_has_a_meaning_and_repair_commands(self):
        codes: dict[str, list[str]] = {}
        for path in sorted((ROOT / "market").glob("*.py")):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func.id if isinstance(node.func, ast.Name) else (
                    node.func.attr if isinstance(node.func, ast.Attribute) else None)
                if func not in ("_refuse", "MarketError"):
                    continue
                code = "MARKET_REFUSED"
                if func == "_refuse" and len(node.args) > 1 and isinstance(node.args[1], ast.Constant):
                    code = node.args[1].value
                code = next((keyword.value.value for keyword in node.keywords if keyword.arg == "code"
                             and isinstance(keyword.value, ast.Constant)), code)
                codes.setdefault(code, []).append(f"market/{path.name}:{node.lineno}")
        self.assertTrue(codes)
        for code, sites in codes.items():
            with self.subTest(code=code, sites=sites):
                self.assertTrue(refusal_catalogue(code)["next_actions"])

    def test_a_market_reference_refusal_prints_the_market_repair(self):
        from cli.main import _market_refusal, refusal_json
        from market.sources import MarketError
        for code, (meaning, repairs) in MARKET_CATALOGUE.items():
            with self.subTest(code=code):
                self.assertIn(code, CATALOGUE)
                self.assertTrue(meaning.strip() and repairs)
                printed = refusal_json(_market_refusal(MarketError("no such market ref", code=code)))
                self.assertEqual(printed["next_actions"], list(repairs))

    def test_every_failure_reason_given_has_a_meaning(self):
        codes = literal_codes(("reason",))
        self.assertTrue(codes)
        for code, sites in codes.items():
            with self.subTest(code=code, sites=sites):
                self.assertTrue(REASONS[code].strip())

    def test_a_refusal_has_a_stable_shape_and_the_catalogue_repairs(self):
        raised = refuse("BUNDLE_EXISTS", "bundle x exists", missing=("x",))
        self.assertIsInstance(raised, Refusal)
        self.assertEqual(raised.as_dict()["missing"], ["x"])
        self.assertEqual(raised.write_status, "not_written")
        self.assertEqual(list(raised.next_actions), refusal_catalogue("BUNDLE_EXISTS")["next_actions"])

    def test_malformed_refusals_are_programming_errors(self):
        for kwargs in ({"code": "lower"}, {"code": "OK", "write_status": "maybe"},
                       {"code": "OK", "write_status": "unknown", "operation_id": None}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                refusal(kwargs.pop("code"), "message", **kwargs)
        self.assertEqual(refusal("OK", "m", write_status="unknown", operation_id="op:1").operation_id, "op:1")
        with self.assertRaises(KeyError):
            refuse("NOT_IN_THE_CATALOGUE", "m")


if __name__ == "__main__":
    unittest.main()
