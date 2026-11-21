"""If these fail, the page's view types (ide/web/src/model/types.ts) and the view research_graph/layout.py builds
have drifted apart: a key one side writes the other does not declare, or a key the page needs that is never written.

The objects layout.py builds must carry exactly the keys their TypeScript types declare (an optional key may be
absent). What it passes through from the graph (line, scope, targets, candidates) may carry keys the page does not
read, but every key the page declares there must be one the graph schema (ide/schema/graph.schema.json) allows."""

import copy
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ide"))

from research_graph import layout  # noqa: E402
from tests.research_graph.test_research_graph import GRAPH  # noqa: E402

TYPES = ROOT / "ide" / "web" / "src" / "model" / "types.ts"
WIDGETS = {"summary": "SummaryWidget", "lineage": "LineageWidget", "progress": "ProgressWidget",
           "scatter": "ScatterWidget", "table": "TableWidget", "notes": "NotesWidget",
           "candidate-detail": "DetailWidget", "sources": "SourcesWidget"}
# Views of graph objects layout.py passes through unchanged: checked against the graph schema instead.
PASSED_THROUGH = {"Candidate", "Targets", "View.line", "View.scope", "SummaryWidget.trial_counts"}
CLOSE = {"{": "}", "(": ")", "[": "]", "<": ">"}


def declarations() -> dict[str, str]:
    """Each type alias in types.ts and its definition, comments removed."""
    text = re.sub(r"/\*.*?\*/|//[^\n]*", "", TYPES.read_text(encoding="utf-8"), flags=re.S)
    found = {}
    for match in re.finditer(r"^(?:export )?type (\w+) = ", text, flags=re.M):
        end, depth = match.end(), 0
        while depth or text[end] != ";":
            depth += (text[end] in CLOSE) - (text[end] in CLOSE.values())
            end += 1
        found[match.group(1)] = text[match.end():end].strip()
    return found


def members(body: str) -> dict[str, tuple[bool, str]]:
    """The members of an object type literal `{ ... }`: key -> (optional, type)."""
    found, depth, start = {}, 0, 1
    for index, char in enumerate(body):
        if char in CLOSE:
            depth += 1
        elif char in CLOSE.values():
            depth -= 1
        if (depth == 1 and char in ";,") or depth == 0 and index == len(body) - 1:
            member = body[start:index].strip()
            start = index + 1
            if member:
                key, _, kind = member.partition(":")
                found[key.strip().rstrip("?")] = (key.strip().endswith("?"), kind.strip())
    return found


class Shapes:
    def __init__(self):
        self.named = declarations()

    def object(self, kind: str) -> tuple[str, dict[str, tuple[bool, str]]] | None:
        """The object type a type expression names (through `| null`, `[]`, `Widget &`), with its name."""
        kind = re.sub(r"\s*\|\s*null$", "", kind.strip())
        kind = kind[:-2] if kind.endswith("[]") else kind
        if kind.startswith("("):
            return None
        name = kind if kind in self.named else None
        kind = self.named.get(kind, kind)
        if kind.startswith("Widget & "):
            found = {"type": (False, "string"), **members(kind.removeprefix("Widget & "))}
        elif kind.startswith("{"):
            found = members(kind)
        else:
            return None
        return name or "", found


def check(shapes: Shapes, kind: str, value, path: str, passed: bool = False) -> list[str]:
    """Where `value` breaks the object type `kind`; `path` names it (Type.key) for PASSED_THROUGH."""
    shape = shapes.object(kind)
    if shape is None or value is None:
        return []
    name, found = shape
    path = name or path
    passed = passed or path in PASSED_THROUGH
    if isinstance(value, list):
        return [problem for item in value for problem in check(shapes, kind, item, path, passed)]
    problems = [f"{path}.{key}: declared, never written" for key, (optional, _) in found.items()
                if not optional and key not in value]
    if not passed:
        problems += [f"{path}.{key}: written, not declared" for key in value if key not in found]
    for key, (_, member) in found.items():
        if key in value:
            problems += check(shapes, member, value[key], f"{path}.{key}", passed)
    return problems


def schema_keys(rule: dict) -> dict:
    """The graph schema's object properties, nested, as key -> the same for its value (items for arrays)."""
    rule = rule.get("items", rule)
    return {key: schema_keys(sub) for key, sub in rule.get("properties", {}).items()}


def undeclared_in_schema(shapes: Shapes, kind: str, allowed: dict, path: str) -> list[str]:
    shape = shapes.object(kind)
    if shape is None:
        return []
    problems = []
    for key, (_, member) in shape[1].items():
        if key not in allowed:
            problems.append(f"{path}.{key}: not in the graph schema")
        elif allowed[key]:
            problems += undeclared_in_schema(shapes, member, allowed[key], f"{path}.{key}")
    return problems


class ViewContractTests(unittest.TestCase):
    def test_the_view_carries_the_keys_the_page_declares(self):
        graph = copy.deepcopy(GRAPH)
        graph["events"] += [{"at": "2026-01-01T12:20:00Z", "kind": "approach_change", "ref": "judgment 9",
                             "text": "try another entry"}]
        graph["candidates"].append({"id": "b@2", "parent": None, "created_at": "2026-01-01T12:40:00",
                                    "trials": [{"trial_id": 6, "purpose": "research", "annual_return": 0.2,
                                                "max_drawdown": 0.1, "eligible": True, "at": "2026-01-01T12:50:00"}]})
        graph["gaps"] = ["no holdout yet"]
        graph["line"]["trial_counts"] = {"research_trials": 3, "all_purpose_trials": 5, "sweep_variants": 0,
                                         "undeclared_sweeps": [], "trials_with_sweeps": 0}
        view = layout.build_view(graph)
        shapes = Shapes()
        self.assertEqual([w["type"] for w in view["widgets"]], list(WIDGETS))
        problems = check(shapes, "View", {**view, "widgets": []}, "View")
        for widget in view["widgets"]:
            self.assertEqual([key for key, value in widget.items() if value == []], [], widget["type"])
            problems += check(shapes, WIDGETS[widget["type"]], widget, WIDGETS[widget["type"]])
        self.assertEqual(sorted(set(problems)), [])

    def test_what_the_page_reads_of_the_graph_is_in_the_graph_schema(self):
        graph = schema_keys(json.loads((ROOT / "ide" / "schema" / "graph.schema.json").read_text(encoding="utf-8")))
        shapes = Shapes()
        self.assertEqual(undeclared_in_schema(shapes, "Candidate", {**graph["candidates"], "prediction_class": {}},
                                              "Candidate")
                         + undeclared_in_schema(shapes, members(shapes.named["View"])["line"][1], graph["line"],
                                                "View.line"), [])
