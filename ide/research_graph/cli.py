"""Command line: check, compare and serve research graphs (standard library only)."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from . import compare, contract


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ide.py", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    command = sub.add_parser("check", help="check a graph against research-graph@3")
    command.add_argument("graph")
    command = sub.add_parser("compare", help="compare two graphs of one line; Markdown on stdout")
    command.add_argument("a", help="normally the ledger graph")
    command.add_argument("b", help="normally the session graph")
    command.add_argument("--until", help="ignore candidates, runs and events after this time (ISO 8601)")
    command = sub.add_parser("serve", help="serve a ledger's research graph as a page that follows the ledger")
    command.add_argument("--ledger", required=True, help="ledger profile the product reads (a reader-only profile)")
    command.add_argument("--market", help="market profile the Runs page's daily bars are read from (default: the active one)")
    command.add_argument("--product", default=str(Path(__file__).resolve().parents[2]),
                         help="product checkout whose command line is run (default: this one)")
    command.add_argument("--host", default="127.0.0.1", help="address to listen on")
    command.add_argument("--port", type=int, default=8765)
    command.add_argument("--allow-host", action="append", default=[], dest="hosts",
                         help="Host header a page may use (default: 127.0.0.1:PORT and localhost:PORT); repeatable")
    command.add_argument("--agent", help="URL of the chat service (ide/agent) that /api/agent/ requests go to")
    command.add_argument("--paper", help="URL of the paper daemon (python -m cli.main paper serve) that /api/paper/ "
                                         "requests go to")
    command.add_argument("--research", help="internal research mirror controller for /api/research/sync")
    command.add_argument("--setup", help="URL of `ledger service run --setup`, for a deployment's first start")
    command.add_argument("--live-socket", type=Path, help="private Unix socket of the operator's Live controller")
    command.add_argument("--live-router", help="trusted login router's Docker DNS name for Live TCP-peer checks")
    command.add_argument("--overview", help="URL of the Market page's data service (ide/overview) that /api/overview/ GETs go to")
    command.add_argument("--market-import", help="status file of the market-import service (market follow) that "
                                                 "/api/market-import answers")
    args = parser.parse_args(argv)
    if args.command == "check":
        found = contract.check_graph(json.loads(Path(args.graph).read_text()))
        print("\n".join(found) if found else f"{args.graph}: {contract.GRAPH_FORMAT} ok")
        return 1 if found else 0
    if args.command == "serve":
        from . import serve
        product = Path(args.product)
        build = subprocess.run(["git", "-C", str(product), "rev-parse", "HEAD"], capture_output=True, text=True,
                               check=True).stdout.strip()
        serve.serve(serve.Product(product, args.ledger, args.market), build, args.host, args.port, args.hosts, args.agent,
                    args.paper, Path(args.market_import) if args.market_import else None, args.overview, args.research,
                    args.setup, live_socket=args.live_socket, live_router=args.live_router)
        return 0
    diff = compare.compare(contract.load_graph(args.a), contract.load_graph(args.b), args.until)
    print(compare.markdown(diff))
    return 0


if __name__ == "__main__":
    sys.exit(main())
