"""Refusals: their fixed shape, and a catalogue entry for every code the ledger package raises."""

from __future__ import annotations

import ast
from pathlib import Path
import unittest

from ledger.errors import Refusal, refusal
from ledger.refusals import CATALOGUE, refusal_catalogue, refuse


PACKAGE = Path(__file__).resolve().parents[2] / "ledger"


def raised_codes() -> dict[str, list[str]]:
    """Every literal code passed to refuse() or refusal() anywhere in the package, with its sites."""
    found: dict[str, list[str]] = {}
    for path in sorted(PACKAGE.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("refuse", "refusal")
                    and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
                found.setdefault(node.args[0].value, []).append(f"{path.name}:{node.lineno}")
    return found


class RefusalTests(unittest.TestCase):
    def test_every_raised_code_has_a_meaning_and_repair_commands(self):
        codes = raised_codes()
        self.assertIn("NOT_TEMPORARY_PATH", codes)
        for code, sites in codes.items():
            with self.subTest(code=code, sites=sites):
                self.assertIn(code, CATALOGUE)
                entry = refusal_catalogue(code)
                self.assertTrue(entry["message"].strip())
                self.assertTrue(entry["next_actions"] and all(action.strip() for action in entry["next_actions"]))

    def test_a_refusal_has_a_stable_shape_and_the_catalogue_repairs(self):
        raised = refuse("BUNDLE_EXISTS", "bundle x exists", missing=("x",))
        self.assertIsInstance(raised, Refusal)
        self.assertEqual(list(raised.as_dict()), ["code", "message", "missing", "expected", "write_status",
                                                  "operation_id"])
        self.assertEqual(raised.as_dict()["missing"], ["x"])
        self.assertEqual(raised.write_status, "not_written")
        self.assertEqual(list(raised.next_actions), refusal_catalogue("BUNDLE_EXISTS")["next_actions"])
        with self.assertRaises(AttributeError):
            raised.code = "OTHER"

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
