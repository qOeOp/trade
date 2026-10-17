"""Market data CLI: import Binance public data, and read freshness and the pool.

The market database is a ledger profile of kind `market` on the research ledger's Dolt service
(`ledger init --kind market`); `--market NAME` selects one, the active one by default. Every
command prints JSON; errors are JSON on stderr with exit code 2.
"""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime
import json
from pathlib import Path
import sys

from research.records.common import RecordError


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--market", help="market profile name (default: the active market database)")
    commands = parser.add_subparsers(dest="command", required=True)
    imported = commands.add_parser("import", help="append Binance public data up to a day and commit once")
    imported.add_argument("--through", type=date.fromisoformat,
                          help="first UTC day not imported (default: today, so through yesterday)")
    imported.add_argument("--cache", type=Path, help="working copies of the archives (default: under the temp dir)")
    imported.add_argument("--workers", type=int, default=4, help="contracts prepared in parallel")
    imported.add_argument("--resume", action="store_true", help="continue an interrupted import's working set")
    status = commands.add_parser("status", help="freshness: pool months, newest day, latest complete month")
    status.add_argument("--at", help="branch, tag or commit (default: main)")
    pool = commands.add_parser("pool", help="the pool by month")
    pool.add_argument("--at", help="branch, tag or commit (default: main)")
    pool.add_argument("--month", help="YYYY-MM (default: every month)")
    return parser


def run(args) -> dict:
    from research.market import store
    from research.records import ledger
    profile = ledger.profile(args.market, of="market")
    if args.command == "import":
        return store.run_import(profile, through=args.through or datetime.now(UTC).date(),
                                cache_root=args.cache or store.default_cache(), workers=args.workers,
                                resume=args.resume, log=lambda line: print(line, file=sys.stderr, flush=True))
    if args.command == "status":
        return store.freshness(profile, args.at)
    return store.read_pool(profile, args.at, args.month)


def main() -> int:
    args = _parser().parse_args()
    try:
        result = run(args)
    except RecordError as exc:
        print(json.dumps({"error": exc.as_dict()}, ensure_ascii=False, default=str), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
