"""Command line: check, render, compare and serve research graphs (standard library only)."""
from __future__ import annotations

import argparse
import importlib
import json
import os
import pkgutil
import subprocess
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
    parser = argparse.ArgumentParser(prog="ide.py", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("check", help="check a graph against research-graph@3")
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
    command = sub.add_parser("serve", help="serve a ledger's research graph as a page that follows the ledger")
    command.add_argument("--ledger", required=True, help="ledger profile the product reads (a reader-only profile)")
    command.add_argument("--market", help="market profile the Runs page's daily bars are read from (default: the active one)")
    command.add_argument("--product", default=str(Path(__file__).resolve().parents[2]),
                         help="product checkout whose command line is run (default: this one)")
    command.add_argument("--host", default="127.0.0.1", help="address to listen on")
    command.add_argument("--port", type=int, default=8765)
    command.add_argument("--allow-host", action="append", default=[], dest="hosts",
                         help="Host header a page may use (default: 127.0.0.1:PORT and localhost:PORT); repeatable")
    command.add_argument("--poll", type=float, default=5.0, help="seconds between head reads while a page is open")
    command.add_argument("--agent", help="URL of the chat service (ide/agent) that /api/agent/ requests go to")
    command.add_argument("--paper", help="URL of the paper daemon (python -m cli.main paper serve) that /api/paper/ "
                                         "requests go to")
    command.add_argument("--market-import", help="status file of the market-import service (market follow) that "
                                                 "/api/market-import answers")
    args = parser.parse_args(argv)
    if args.command == "check":
        found = contract.check_graph(json.loads(Path(args.graph).read_text()))
        print("\n".join(found) if found else f"{args.graph}: {contract.GRAPH_FORMAT} ok")
        return 1 if found else 0
    if args.command == "render":
        print(run_render(args.graph, args.out, args.renderer))
        return 0
    if args.command == "serve":
        from . import serve
        product = Path(args.product)
        build = os.environ.get("TRADE_IDE_BUILD") or subprocess.run(
            ["git", "-C", str(product), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        serve.serve(serve.Product(product, args.ledger, args.market), build, args.host, args.port, args.hosts, args.poll, args.agent,
                    args.paper, Path(args.market_import) if args.market_import else None)
        return 0
    diff = compare.compare(contract.load_graph(args.a), contract.load_graph(args.b), args.until)
    print(json.dumps(diff, ensure_ascii=False, indent=1) if args.json else compare.markdown(diff))
    return 0


if __name__ == "__main__":
    sys.exit(main())
