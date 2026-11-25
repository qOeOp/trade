"""Product packages import only downward: a package imports packages of lower layers, never one of its own layer
or a higher one. deploy, the host controller on system Python, is the lowest and imports no product package; ide
imports none and no product package imports it. Inside a package, modules form no new import cycle: the import
edges that close a cycle today are listed in CYCLE_EDGES, and the list only shrinks. Imports inside functions and
TYPE_CHECKING blocks count."""

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
# Module imports that lie on an import cycle inside their package (measured 2026-11-21). Remove a line when its
# cycle is gone; never add one: break the new cycle instead (move the shared code down into its own module).
CYCLE_EDGES = frozenset({
    "engine.live_brake -> engine.live_commands",
    "engine.live_commands -> engine.live_connection",
    "engine.live_commands -> engine.live_session",
    "engine.live_connection -> engine.live_commands",
    "engine.live_session -> engine.live_brake",
    "engine.live_session -> engine.live_commands",
    "engine.live_session -> engine.live_connection",
    "live.credentials -> live.runs",
    "live.runs -> live.credentials",
})


def product_files():
    for package in (*RANK, *ISOLATED):
        for path in sorted((ROOT / package).rglob("*.py")):
            if not SKIPPED.intersection(path.relative_to(ROOT).parts):
                yield package, path


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
    for package, path in product_files():
        for line, target in imported_packages(path):
            if target == package or (target not in RANK and target not in ISOLATED):
                continue
            if package in ISOLATED or target in ISOLATED or RANK[target] >= RANK[package]:
                found.append(f"{path.relative_to(ROOT)}:{line} imports {target}")
    return found


def module_name(path: Path) -> str:
    parts = path.relative_to(ROOT).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def import_graph() -> dict[str, set[str]]:
    """Each product module and the product modules it imports (`from p import m` imports module p.m)."""
    paths = {module_name(path): path for _, path in product_files()}

    def known(name: str) -> str | None:
        while name and name not in paths:
            name = name.rpartition(".")[0]
        return name or None

    graph = {}
    for module, path in paths.items():
        package = module if path.name == "__init__.py" else module.rpartition(".")[0]
        targets = set()
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), str(path))):
            if isinstance(node, ast.Import):
                targets.update(known(alias.name) for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                base = package.split(".")[:len(package.split(".")) - node.level + 1] if node.level else []
                source = ".".join([*base, *([node.module] if node.module else [])])
                for alias in node.names:
                    submodule = f"{source}.{alias.name}"
                    targets.add(submodule if submodule in paths else known(source))
        graph[module] = {target for target in targets if target and target != module}
    return graph


def cycle_edges(graph: dict[str, set[str]]) -> set[str]:
    """The edges inside a strongly connected component: each one closes an import cycle."""
    order: dict[str, int] = {}
    low: dict[str, int] = {}
    stack: list[str] = []
    components = []

    def visit(module: str) -> None:  # Tarjan; the module graph is a few hundred nodes deep at most
        order[module] = low[module] = len(order)
        stack.append(module)
        for target in sorted(graph[module]):
            if target not in order:
                visit(target)
                low[module] = min(low[module], low[target])
            elif target in stack:
                low[module] = min(low[module], order[target])
        if low[module] == order[module]:
            component = set()
            while not component or module not in component:
                component.add(stack.pop())
            components.append(component)

    for module in sorted(graph):
        if module not in order:
            visit(module)
    return {f"{source} -> {target}" for component in components for source in component
            for target in graph[source] & component}


class PackageLayerTests(unittest.TestCase):
    def test_packages_import_only_lower_layers(self):
        self.assertEqual(violations(), [], "move the code to the lower package, or the import to the higher one")

    def test_no_new_import_cycle_inside_a_package(self):
        found = cycle_edges(import_graph())
        self.assertEqual(sorted(found - CYCLE_EDGES), [],
                         "these imports close a new cycle: move the shared code down into a module both can import")
        self.assertEqual(sorted(CYCLE_EDGES - found), [], "these cycles are gone: remove them from CYCLE_EDGES")
