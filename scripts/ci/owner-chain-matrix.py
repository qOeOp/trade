#!/usr/bin/env python3
"""
Print the Owner chain job matrix for `build.yml` and `owner-chains.yml`, as a
GITHUB_OUTPUT line.

Both workflows used to spell the same two legs out by hand. The legs now live here once, and the
R&D leg becomes one entry per shard of scripts/ci/rd-owner-chain-shards.tsv
(`shard <TAB> component <TAB> test name <TAB> capability`, one row per entry, in run order). The
capability is what the entry needs installed - `browser` (Chrome and the Dashboard's node_modules),
`node` (the node_modules alone) or `-` - and each shard gets two flags from its rows: `browser`, and
`node` for either.
The list is required: a missing list is refused by name rather than read as "run the whole chain
as one job", which would make deleting the list a silent return to the serial chain. The chain
script's --check requires the list to be the shard planner's exact output. The shards come out in
name order, numbers compared as numbers, so the checks list reads shard-1, shard-2, ... whatever
order the planner interleaves their entries in.

`--rd-chain serial` runs the R&D chain as one job instead, every entry after every earlier one on a
single cluster: the meaning the chain had before it was sharded. `build.yml` runs it once a day on
`main`, so a dependency the shard list's declarations miss shows up as a serial pass that its shards
cannot reproduce, or the reverse. The list is still read and checked in that mode, so the one
schedule cannot hide a broken list. A second output line, `rd-chain=<mode>`, tells the report job
which records to read.

Usage: owner-chain-matrix.py [--rd-chain shards|serial] <shards.tsv>
    ->   matrix={"chain": [...]} and rd-chain=<mode>

"""

from __future__ import annotations

import json
import re
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
CAPABILITY_RANK = {"-": 0, "node": 1, "browser": 2}
RD_LIMITS = {"setup-timeout-minutes": 30, "step-timeout-minutes": 70, "job-timeout-minutes": 105}
MARKET_DATA = {
    "key": "market-data",
    "shard": "",
    "component": "",
    "name": "market data owner postgres (ubuntu-22.04)",
    "node": 0,
    "browser": 0,
    "setup-timeout-minutes": 30,
    "step-timeout-minutes": 15,
    "job-timeout-minutes": 50,
    "make": "cargo-test-market-data-owner-postgres-isolated",
}


def rd_rows(path: Path) -> list[list[str]]:
    """
    Return the shard list's rows, `shard, component, test, capability`, in chain order.
    """
    if not path.exists():
        raise SystemExit(
            f"ERROR: there is no shard list at {path}; the R&D chain runs only as its shards.",
        )
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 4 or fields[3] not in CAPABILITY_RANK or not all(fields[:3]):
            raise SystemExit(
                f"ERROR: {path}:{number}: expected shard, component, test name, capability -|node|browser: {line!r}",
            )
        rows.append(fields)
    if not rows:
        raise SystemExit(
            f"ERROR: {path} lists no entries; the R&D chain runs only as its shards.",
        )
    return rows


def rd_shards(rows: list[list[str]], components: dict[str, str] | None = None) -> list[dict]:
    """
    Return one R&D matrix entry per shard, or per selected shard when `components` names
    them; a shard's value there is the one component it runs, or "" for all of it.
    """
    shards: dict[str, int] = {}
    # A narrowed shard still installs what its whole shard needs: the chain's own guard reads the
    # capability per shard, so a narrower install here would refuse a run the shard declares.
    for shard, _component, _test, capability in rows:
        if components is None or shard in components:
            shards[shard] = max(shards.get(shard, 0), CAPABILITY_RANK[capability])
    return [
        {
            "key": "rd-owner",
            "shard": shard,
            "component": (components or {}).get(shard, ""),
            "name": f"rd owner postgres {shard}"
            + (" (one component)" if (components or {}).get(shard) else "")
            + " (ubuntu-22.04)",
            "node": int(capability >= 1),
            "browser": int(capability == 2),
            **RD_LIMITS,
            "make": RD_MAKE,
        }
        for shard, capability in sorted(shards.items(), key=lambda item: shard_order(item[0]))
    ]


def selection(ref: str, rows: list[list[str]]) -> tuple[dict[str, str], bool, str] | None:
    """
    Read a `test-chain/<lane>--only-<selector>` ref into the shards to run (each with
    the one component it is narrowed to, or "" for all of it), whether the Market Data
    leg runs, and a label.

    Returns None for the full matrix: when the ref selects nothing, and when any part
    of the selector is not understood, which is also said on stderr. A selector can
    only narrow a run when every part of it is read exactly; anything else runs
    everything.

    """
    marker = ref.find("--only-")
    if marker < 0:
        return None
    selector = ref[marker + len("--only-") :]
    shards = {row[0] for row in rows}
    chosen: dict[str, str] = {}
    market_data = False
    for token in selector.split("+"):
        shard = re.fullmatch(r"shard-(\d+)", token)
        entry = re.fullmatch(r"entry-(\d+)", token)
        if token == "md":
            market_data = True
        elif shard and f"shard-{shard.group(1)}" in shards:
            chosen[f"shard-{shard.group(1)}"] = ""
        elif entry and 1 <= int(entry.group(1)) <= len(rows):
            row_shard, component = rows[int(entry.group(1)) - 1][:2]
            # Two components of one shard cannot be named at once, so the shard runs whole.
            if chosen.get(row_shard, component) != component:
                component = ""
            chosen[row_shard] = component if chosen.get(row_shard) != "" else ""
        else:
            sys.stderr.write(
                f"NOTICE: selector {selector!r} is not understood (at {token!r}); running the full matrix\n",
            )
            return None
    return chosen, market_data, selector


def rd_serial() -> dict:
    return {
        "key": "rd-owner",
        "shard": "",
        "component": "",
        "name": "rd owner postgres serial (ubuntu-22.04)",
        "node": 1,
        "browser": 1,
        **RD_LIMITS,
        "make": RD_MAKE,
    }


def shard_order(name: str) -> list[int | str]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", name)]


def main() -> int:
    arguments = sys.argv[1:]
    mode = "shards"
    ref = ""
    while arguments[:1] in (["--rd-chain"], ["--selector-ref"]):
        if len(arguments) < 2:
            raise SystemExit(
                "usage: owner-chain-matrix.py [--rd-chain shards|serial] [--selector-ref <ref>] <shards.tsv>",
            )
        if arguments[0] == "--rd-chain":
            mode = arguments[1]
        else:
            ref = arguments[1]
        arguments = arguments[2:]
    if mode not in ("shards", "serial") or len(arguments) != 1:
        raise SystemExit(
            "usage: owner-chain-matrix.py [--rd-chain shards|serial] [--selector-ref <ref>] <shards.tsv>",
        )
    rows = rd_rows(Path(arguments[0]))
    # A serial run is the whole chain by definition, so it takes no selector.
    chosen = selection(ref, rows) if mode == "shards" else None
    if chosen is None:
        legs = [*(rd_shards(rows) if mode == "shards" else [rd_serial()]), MARKET_DATA]
        partial, rd_selection = "", ""
    else:
        components, market_data, partial = chosen
        legs = [*rd_shards(rows, components), *([MARKET_DATA] if market_data else [])]
        rd_selection = " ".join(
            f"{shard}={component}" if component else shard
            for shard, component in sorted(components.items())
        )
    print(f"matrix={json.dumps({'chain': legs}, separators=(',', ':'))}")
    print(f"rd-chain={mode}")
    print(f"rd-partial={partial}")
    print(f"rd-selection={rd_selection}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
