"""The research graph contract: load a graph and check it against schema/graph.schema.json."""
from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schema"
GRAPH_FORMAT = "research-graph@4"


def schema(name: str = "graph") -> dict:
    return json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text())


def _path(error: ValidationError) -> str:
    return "$" + "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in error.absolute_path)


def check_graph(graph: dict) -> list[str]:
    """Schema problems, as 'path: reason', plus the cross-references a schema cannot state."""
    errors = sorted(Draft202012Validator(schema("graph")).iter_errors(graph), key=lambda error: _path(error))
    found = [f"{_path(error)}: {error.message}" for error in errors]
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
