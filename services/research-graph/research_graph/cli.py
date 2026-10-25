"""Command line: check, view, render and compare research graphs (standard library only)."""
from __future__ import annotations

import argparse
import importlib
import json
import pkgutil
import sys
from pathlib import Path

from . import compare, contract, layout, renderers


def renderer_names() -> list[str]:
    return sorted(m.name for m in pkgutil.iter_modules(renderers.__path__) if m.ispkg)


def run_render(graph_path: str, out: str, renderer: str) -> Path:
    """graph.json -> out/view.json and the renderer's files in out/."""
    view = layout.build_view(contract.load_graph(graph_path))
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "view.json").write_text(json.dumps(view, ensure_ascii=False, indent=1))
    module = importlib.import_module(f"{renderers.__name__}.{renderer}.render")
    return module.render(view, out_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research-graph", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("check", help="check a graph against research-graph@2")
    command.add_argument("graph")
    command = sub.add_parser("render", help="write view.json and the renderer's page into a directory")
    command.add_argument("graph")
    command.add_argument("--out", required=True, help="output directory (normally under /tmp)")
    command.add_argument("--renderer", default="web", choices=renderer_names())
    command = sub.add_parser("compare", help="compare two graphs of one line; Markdown on stdout")
    command.add_argument("a", help="normally the ledger graph")
    command.add_argument("b", help="normally the session graph")
    command.add_argument("--until", help="ignore candidates, runs and events after this time (ISO 8601)")
    command.add_argument("--json", action="store_true", help="print the structured differences instead")
    args = parser.parse_args(argv)
    if args.command == "check":
        found = contract.check_graph(json.loads(Path(args.graph).read_text()))
        print("\n".join(found) if found else f"{args.graph}: {contract.GRAPH_FORMAT} ok")
        return 1 if found else 0
    if args.command == "render":
        print(run_render(args.graph, args.out, args.renderer))
        return 0
    diff = compare.compare(contract.load_graph(args.a), contract.load_graph(args.b), args.until)
    print(json.dumps(diff, ensure_ascii=False, indent=1) if args.json else compare.markdown(diff))
    return 0


if __name__ == "__main__":
    sys.exit(main())
