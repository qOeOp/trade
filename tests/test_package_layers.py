"""Product packages import only downward: a package imports packages of lower layers, never one of its own layer
or a higher one. deploy, the host controller on system Python, is the lowest and imports no product package; ide
imports none and no product package imports it. Imports inside functions and TYPE_CHECKING blocks count."""

import ast
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
# Lowest first.
LAYERS = (
    ("deploy",),
    ("shared", "engine"),
    ("market",),
    ("ledger",),
    ("runtime",),
    ("registration",),
    ("report",),
    ("replay",),
    ("paper", "live"),
    ("cli",),
)
ISOLATED = ("ide",)
RANK = {package: rank for rank, layer in enumerate(LAYERS) for package in layer}
SKIPPED = {"node_modules", ".venv", "__pycache__"}


def imported_packages(path: Path):
    """(line, top-level package) of each absolute import in the file."""
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), str(path))):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield node.lineno, node.module.split(".")[0]


def violations() -> list[str]:
    found = []
    for package in (*RANK, *ISOLATED):
        for path in sorted((ROOT / package).rglob("*.py")):
            if SKIPPED.intersection(path.relative_to(ROOT).parts):
                continue
            for line, target in imported_packages(path):
                if target == package or (target not in RANK and target not in ISOLATED):
                    continue
                if package in ISOLATED or target in ISOLATED or RANK[target] >= RANK[package]:
                    found.append(f"{path.relative_to(ROOT)}:{line} imports {target}")
    return found


class PackageLayerTests(unittest.TestCase):
    def test_packages_import_only_lower_layers(self):
        self.assertEqual(violations(), [], "move the code to the lower package, or the import to the higher one")


if __name__ == "__main__":
    unittest.main()
