#!/usr/bin/env python3
"""
Print the Owner chain job matrix for `build.yml` and `owner-chains.yml`, as a
GITHUB_OUTPUT line.

Both workflows used to spell the same two legs out by hand. The legs now live here once, and the
R&D leg becomes one entry per shard of scripts/ci/rd-owner-chain-shards.tsv
(`shard <TAB> component <TAB> test name <TAB> needs browser 0|1`, one row per entry, in run order).
Until that file exists the R&D leg is a single entry that runs the whole chain, exactly as before.

Usage: owner-chain-matrix.py <shards.tsv>   ->   matrix={"chain": [...]}

"""

from __future__ import annotations

import json
import sys
from pathlib import Path


RD_MAKE = 'cargo-test-rd-owner-postgres-isolated NEXTEST_PROFILE=ci EXTRA_FEATURES="${RUST_TEST_EXTRA_FEATURES}"'

# Common setup: the slowest each part of it took across 45 rd/md chain jobs (2026-09-24) - freeing
# disk 915s, rust-cache 340s, everything else 59s - is 1314s together; 30 minutes leaves room above
# that. Re-measure the parts, not the total, and raise it once any of them routinely nears half of it.
# The step limits are about twice what the chains take (R&D step p90 39.8 min, Market Data 6.4 max,
# 2026-09-19..23); each job limit sits above its step limits added together, so a step timeout, which
# keeps its log, fires before the job limit, which does not. Shards inherit the R&D values until
# their own runs are measured.
RD_LIMITS = {"setup-timeout-minutes": 30, "step-timeout-minutes": 70, "job-timeout-minutes": 105}
MARKET_DATA = {
    "key": "market-data",
    "shard": "",
    "name": "market data owner postgres (ubuntu-22.04)",
    "browser": 0,
    "setup-timeout-minutes": 30,
    "step-timeout-minutes": 15,
    "job-timeout-minutes": 50,
    "make": "cargo-test-market-data-owner-postgres-isolated",
}


def rd_shards(path: Path) -> list[dict]:
    if not path.exists():
        return [
            {
                "key": "rd-owner",
                "shard": "",
                "name": "rd owner postgres (ubuntu-22.04)",
                "browser": 1,
                **RD_LIMITS,
                "make": RD_MAKE,
            },
        ]
    shards: dict[str, int] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 4 or fields[3] not in ("0", "1") or not all(fields[:3]):
            raise SystemExit(
                f"ERROR: {path}:{number}: expected shard, component, test name, browser 0|1: {line!r}",
            )
        shards[fields[0]] = max(shards.get(fields[0], 0), int(fields[3]))
    if not shards:
        raise SystemExit(
            f"ERROR: {path} lists no entries; delete it to run the whole chain as one job.",
        )
    return [
        {
            "key": "rd-owner",
            "shard": shard,
            "name": f"rd owner postgres {shard} (ubuntu-22.04)",
            "browser": browser,
            **RD_LIMITS,
            "make": RD_MAKE,
        }
        for shard, browser in shards.items()
    ]


def main() -> int:
    matrix = {"chain": [*rd_shards(Path(sys.argv[1])), MARKET_DATA]}
    print(f"matrix={json.dumps(matrix, separators=(',', ':'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
