"""The research graph contract: load a graph and check it against schema/graph.schema.json.

The checker covers the subset of JSON Schema the contract uses (type, const, enum, required,
properties, items) so the service needs only the standard library.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schema"
GRAPH_FORMAT = "research-graph@2"
TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def schema(name: str = "graph") -> dict:
    return json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text())


def _is(value: Any, kind: str) -> bool:
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, TYPES[kind])


def problems(value: Any, rule: dict, path: str = "$") -> list[str]:
    """Every place where `value` breaks `rule`, as 'path: reason'."""
    found: list[str] = []
    if "const" in rule and value != rule["const"]:
        return [f"{path}: expected {rule['const']!r}"]
    if "enum" in rule and value not in rule["enum"]:
        return [f"{path}: {value!r} is not one of {rule['enum']}"]
    if "type" in rule:
        kinds = rule["type"] if isinstance(rule["type"], list) else [rule["type"]]
        if not any(_is(value, kind) for kind in kinds):
            return [f"{path}: expected {' or '.join(kinds)}"]
    if isinstance(value, dict):
        found += [f"{path}: missing {key}" for key in rule.get("required", []) if key not in value]
        for key, sub in rule.get("properties", {}).items():
            if key in value:
                found += problems(value[key], sub, f"{path}.{key}")
    if isinstance(value, list) and "items" in rule:
        for index, item in enumerate(value):
            found += problems(item, rule["items"], f"{path}[{index}]")
    return found


def check_graph(graph: dict) -> list[str]:
    """Schema problems plus the cross-references a schema cannot state."""
    found = problems(graph, schema("graph"))
    if found:
        return found
    ids = [c["id"] for c in graph["candidates"]]
    found += [f"$.candidates: duplicate id {i}" for i in sorted({i for i in ids if ids.count(i) > 1})]
    known = set(ids)
    found += [f"$.candidates[{n}].parent: unknown candidate {c['parent']}" for n, c in enumerate(graph["candidates"])
              if c.get("parent") and c["parent"] not in known]
    return found


def load_graph(path: str | Path) -> dict:
    graph = json.loads(Path(path).read_text())
    found = check_graph(graph)
    if found:
        raise ValueError(f"{path} breaks {GRAPH_FORMAT}:\n" + "\n".join(found[:20]))
    return graph
