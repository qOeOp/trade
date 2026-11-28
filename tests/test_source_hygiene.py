"""Static hygiene of the Python sources, frozen at today's state: no new product module longer than MAX_LINES
(the longer ones are listed in OVERSIZED with caps that only go down); no top-level function or class that nothing
outside the tests uses; every third-party import is declared in pyproject.toml (product packages in the runtime
dependencies, everything else in those or the dev group), every runtime dependency is imported by a product
package, and deploy, which runs on the host's system Python, imports only the standard library."""

import ast
from collections import defaultdict
import importlib.metadata
import re
import subprocess
import sys
import tomllib
import unittest

from tests.test_package_layers import ISOLATED, RANK, ROOT, module_name, product_files


MAX_LINES = 800
# Product modules over MAX_LINES, each with the most lines it may have (measured 2026-11-28). Lower a cap when its
# module shrinks and remove the entry once the module is under MAX_LINES; never raise one or add one: split instead.
OVERSIZED = {
    "cli/research_commands.py": 934,
    "engine/audit.py": 1099,
    "engine/paper.py": 1244,
    "engine/run.py": 938,
    "ide/research_graph/serve.py": 1134,
    "ledger/metrics.py": 994,
    "paper/serve.py": 882,
    "report/status.py": 886,
}
# Runtime dependencies no product module imports by name: nautilus_trader.analysis imports plotly when loaded, and
# Nautilus 2.0.0rc7 declares no dependencies of its own.
INDIRECT = frozenset({"plotly"})
WORD = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def tracked(*patterns: str) -> list[str]:
    return subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z", *patterns], capture_output=True, text=True,
                          check=True).stdout.split("\0")[:-1]


def parsed(path: str) -> ast.Module:
    return ast.parse((ROOT / path).read_text(encoding="utf-8"), path)


def unused_definitions() -> list[str]:
    """Top-level functions and classes of product modules that no consumer outside tests/ names. A module uses a
    name it reads itself or imports by name; another module uses `.name` when it imports the defining module; a
    Python string uses the name it is (getattr) or any word of an import it holds (-c snippets); so does any word
    of a deployment, workflow, image or skill file (healthchecks, skill commands)."""
    modules = {module_name(path): str(path.relative_to(ROOT)) for _, path in product_files()}
    used: dict[str, set[str]] = defaultdict(set)
    words: set[str] = set()
    for path in tracked("*.py"):
        if path.startswith("tests/"):
            continue
        tree = parsed(path)
        module = module_name(ROOT / path)
        package = module if path.endswith("__init__.py") else module.rpartition(".")[0]
        imported, attributes = set(), set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                used[module].add(node.id)
            elif isinstance(node, ast.Attribute):
                attributes.add(node.attr)
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                words.update(WORD.findall(node.value) if "import " in node.value else WORD.fullmatch(node.value)
                             and [node.value] or [])
            elif isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                base = package.split(".")[:len(package.split(".")) - node.level + 1] if node.level else []
                source = ".".join([*base, *([node.module] if node.module else [])])
                for alias in node.names:
                    if f"{source}.{alias.name}" in modules:
                        imported.add(f"{source}.{alias.name}")
                    else:
                        used[source].add(alias.name)
        for target in imported:
            used[target] |= attributes
    for path in tracked(".agents/skills", "deploy", ".github", "engine", "*Dockerfile*", "*.yaml", "*.yml"):
        if not path.endswith((".py", ".lock")) and not path.startswith(("docs/", "docs-site/", "tests/")):
            try:
                words.update(WORD.findall((ROOT / path).read_text(encoding="utf-8")))
            except UnicodeDecodeError:
                continue
    found = []
    for module, path in sorted(modules.items()):
        found.extend(f"{path}:{node.lineno} {node.name}" for node in parsed(path).body
                     if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                     and node.name not in used[module] | words)
    return found


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def requirement(spec: str) -> str:
    return canonical(re.split(r"[\s<>=!~;\[]", spec, maxsplit=1)[0])


def third_party_imports() -> dict[str, set[str]]:
    """Distribution -> the top-level directories whose Python files import it. Local modules (product packages,
    tests, research_graph on the IDE's path, a script's own siblings) and the standard library are left out."""
    distributions = {name: [canonical(dist) for dist in dists]
                     for name, dists in importlib.metadata.packages_distributions().items()}
    local = {*RANK, *ISOLATED, "tests", "research_graph"}
    found: dict[str, set[str]] = defaultdict(set)
    for path in tracked("*.py"):
        siblings = {entry.stem for entry in (ROOT / path).parent.iterdir()}
        for node in ast.walk(parsed(path)):
            names = ([alias.name for alias in node.names] if isinstance(node, ast.Import)
                     else [node.module] if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module
                     else [])
            for name in names:
                top = name.split(".")[0]
                if top in sys.stdlib_module_names or top in local or top in siblings:
                    continue
                for dist in distributions.get(top, [f"undeclared module {top}"]):
                    found[dist].add(path.split("/")[0])
    return found


class SourceHygieneTests(unittest.TestCase):
    def test_no_new_oversized_module(self):
        lengths = {str(path.relative_to(ROOT)): len(path.read_text(encoding="utf-8").splitlines())
                   for _, path in product_files()}
        over = {path: length for path, length in lengths.items() if length > OVERSIZED.get(path, MAX_LINES)}
        self.assertEqual(over, {}, "split these modules: each is over its cap (OVERSIZED, else MAX_LINES)")
        under = sorted(path for path in OVERSIZED if lengths.get(path, 0) <= MAX_LINES)
        self.assertEqual(under, [], "these are under the limit now: remove them from OVERSIZED")

    def test_every_top_level_definition_is_used(self):
        self.assertEqual(unused_definitions(), [], "delete these: nothing outside the tests uses them")

    def test_imports_match_declared_dependencies(self):
        project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        runtime = {requirement(spec) for spec in project["project"]["dependencies"]}
        dev = {requirement(spec) for spec in project["dependency-groups"]["dev"]}
        imports = third_party_imports()
        product = {*RANK, *ISOLATED}
        self.assertEqual(sorted(dist for dist, where in imports.items() if where & product and dist not in runtime),
                         [], "product packages import these: declare them in [project].dependencies")
        self.assertEqual(sorted(dist for dist in imports if dist not in runtime | dev), [],
                         "declare these in the dev dependency group")
        self.assertEqual(sorted(dist for dist, where in imports.items() if "deploy" in where), [],
                         "deploy runs on the host's system Python: use the standard library")
        self.assertEqual(sorted(runtime - {dist for dist, where in imports.items() if where & product}
                                - {canonical(name) for name in INDIRECT}),
                         [], "no product package imports these: drop them from [project].dependencies")
