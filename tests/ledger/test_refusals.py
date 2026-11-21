"""Refusals: their fixed shape, and catalogue repairs for every refusal code the product packages and
the command line raise and every failure reason they give."""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
import ast
import multiprocessing
from pathlib import Path
import unittest

from shared.errors import Refusal
from ledger.problems import REASONS
from shared.refusals import CATALOGUE, refuse


ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ("cli", "ledger", "live", "market", "paper", "registration", "replay", "report", "runtime", "shared")


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


def _refused_in_a_worker(code: str) -> None:
    raise refuse(code, "refused in a worker", missing=("x",), expected="y")


class RefusalTests(unittest.TestCase):
    def test_every_raised_code_has_repair_commands(self):
        codes = literal_codes(("refuse", "Refusal"))
        self.assertTrue(codes)
        for code, sites in codes.items():
            with self.subTest(code=code, sites=sites):
                self.assertIn(code, CATALOGUE)
                self.assertTrue(CATALOGUE[code] and all(action.strip() for action in CATALOGUE[code]))

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
        self.assertEqual(raised.next_actions, CATALOGUE["BUNDLE_EXISTS"])

    def test_a_refusal_raised_in_a_worker_process_reaches_its_caller_whole(self):
        with ProcessPoolExecutor(1, mp_context=multiprocessing.get_context("spawn")) as pool:
            with self.assertRaises(Refusal) as caught:
                pool.submit(_refused_in_a_worker, "MONTH_EXISTS").result()
        expected = refuse("MONTH_EXISTS", "refused in a worker", missing=("x",), expected="y")
        self.assertEqual((caught.exception.as_dict(), caught.exception.next_actions),
                         (expected.as_dict(), expected.next_actions))

    def test_malformed_refusals_are_programming_errors(self):
        for kwargs in ({"code": "lower"}, {"code": "OK", "write_status": "maybe"},
                       {"code": "OK", "write_status": "unknown", "operation_id": None}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                Refusal(kwargs.pop("code"), "message", **kwargs)
        self.assertEqual(Refusal("OK", "m", write_status="unknown", operation_id="op:1").operation_id, "op:1")
        with self.assertRaises(KeyError):
            refuse("NOT_IN_THE_CATALOGUE", "m")
