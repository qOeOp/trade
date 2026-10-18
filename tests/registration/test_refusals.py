"""Every refusal code the registration package raises has a meaning and repair commands in the
ledger's refusal catalogue."""

from __future__ import annotations

import ast
from pathlib import Path
import unittest

from ledger.refusals import CATALOGUE, refusal_catalogue


PACKAGE = Path(__file__).resolve().parents[2] / "registration"


def raised_codes() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for path in sorted(PACKAGE.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("refuse", "refusal")
                    and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
                found.setdefault(node.args[0].value, []).append(f"{path.name}:{node.lineno}")
    return found


class RegistrationRefusalTests(unittest.TestCase):
    def test_every_raised_code_has_a_meaning_and_repair_commands(self):
        codes = raised_codes()
        self.assertIn("GRID_ALREADY_ATTEMPTED", codes)
        for code, sites in codes.items():
            with self.subTest(code=code, sites=sites):
                self.assertIn(code, CATALOGUE)
                entry = refusal_catalogue(code)
                self.assertTrue(entry["message"].strip())
                self.assertTrue(entry["next_actions"] and all(action.strip() for action in entry["next_actions"]))


if __name__ == "__main__":
    unittest.main()
