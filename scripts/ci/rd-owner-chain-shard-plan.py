#!/usr/bin/env python3
"""Plans the R&D Owner chain's shards from its declared needs and measured durations.

The shard list is this script's output and nothing else: `--check` in the chain script reruns it
and requires the committed list to be byte-identical, so a hand edit to the list cannot drift away
from the declarations it is derived from.

Inputs:
  - the chain array, read from scripts/ci/test-rd-owner-postgres.bash (chain order);
  - rd-owner-chain-needs.tsv: per entry, the entries it needs (hard, proved by VERIFY) and the
    entries it must run after to keep an assertion meaningful;
  - rd-owner-chain-durations.tsv: per entry, seconds measured on Linux CI.

A component is a connected set under needs and after edges. Its entries share one database and run
in chain order; different components start from the pre-entry-1 state. Components are packed into
shards longest first; an entry without a measured duration counts as the slowest measured one, so
a missing measurement makes the plan more conservative rather than less.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CHAIN = ROOT / "test-rd-owner-postgres.bash"
NEEDS = ROOT / "rd-owner-chain-needs.tsv"
DURATIONS = ROOT / "rd-owner-chain-durations.tsv"
BROWSER_ENTRIES = {
    "tests::strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody",
    "tests::backtest_run_report_browser_acceptance_reads_the_owner_answer",
}


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def chain_entries() -> list[str]:
    source = CHAIN.read_text()
    opening = "readonly rd_owner_postgres_tests=(\n"
    if source.count(opening) != 1:
        fail("the chain array is unavailable")
    body = source[source.index(opening) + len(opening) :]
    body = body[: body.index("\n)\n")]
    return [
        line.strip().strip("'").split("|")[2]
        for line in body.splitlines()
        if line.strip().startswith("'")
    ]


def read_tsv(path: Path, columns: int) -> list[list[str]]:
    rows = []
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != columns:
            fail(f"{path.name}:{number} has {len(fields)} fields, not {columns}")
        rows.append(fields)
    return rows


def plan(shard_count: int) -> str:
    entries = chain_entries()
    position = {name: index for index, name in enumerate(entries)}
    if len(position) != len(entries):
        fail("the chain array names one test twice")

    declared: dict[str, tuple[list[str], list[str], str]] = {}
    for name, needs, after, evidence in read_tsv(NEEDS, 4):
        if name in declared:
            fail(f"{NEEDS.name} declares {name} twice")
        if name not in position:
            fail(f"{NEEDS.name} declares {name}, which is not a chain entry")
        if not evidence.strip():
            fail(f"{NEEDS.name} gives no evidence for {name}")
        hard = [] if needs == "NONE" else needs.split(",")
        soft = [] if after == "-" else after.split(",")
        for earlier in hard + soft:
            if earlier == "?":
                fail(f"{name} has an unresolved need; resolve it before planning")
            if earlier not in position:
                fail(f"{name} needs {earlier}, which is not a chain entry")
            if position[earlier] >= position[name]:
                fail(f"{name} needs {earlier}, which does not run before it")
        declared[name] = (hard, soft, evidence)
    missing = [name for name in entries if name not in declared]
    if missing:
        fail(f"{NEEDS.name} declares nothing for: {', '.join(missing)}")

    seconds = {name: float(value) for name, value in read_tsv(DURATIONS, 2)}
    slowest = max(seconds.values()) if seconds else 60.0

    parent = {name: name for name in entries}

    def root(name: str) -> str:
        while parent[name] != name:
            parent[name] = parent[parent[name]]
            name = parent[name]
        return name

    for name, (hard, soft, _) in declared.items():
        for earlier in hard + soft:
            parent[root(name)] = root(earlier)

    components: dict[str, list[str]] = {}
    for name in entries:
        components.setdefault(root(name), []).append(name)
    # A component is named by its first entry in chain order, so the name moves only when that entry
    # does.
    named = {members[0]: members for members in components.values()}

    def cost(members: list[str]) -> float:
        return sum(seconds.get(name, slowest) for name in members)

    loads = [0.0] * shard_count
    assignment: dict[str, int] = {}
    for first in sorted(named, key=lambda first: (-cost(named[first]), position[first])):
        shard = min(range(shard_count), key=lambda index: (loads[index], index))
        loads[shard] += cost(named[first])
        assignment[first] = shard

    shard_of = {}
    component_of = {}
    for first, members in named.items():
        for name in members:
            shard_of[name] = assignment[first]
            component_of[name] = first

    lines = [
        "# Generated by scripts/ci/rd-owner-chain-shard-plan.py; do not edit by hand.\n",
        f"# {shard_count} shards; planned seconds per shard: "
        + ", ".join(f"{load:.0f}" for load in loads)
        + "\n",
    ]
    for name in entries:
        lines.append(
            f"shard-{shard_of[name] + 1}\t{component_of[name]}\t{name}\t"
            f"{1 if name in BROWSER_ENTRIES else 0}\n"
        )
    return "".join(lines)


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit() or int(sys.argv[1]) < 1:
        fail("usage: rd-owner-chain-shard-plan.py <shard count>")
    sys.stdout.write(plan(int(sys.argv[1])))


if __name__ == "__main__":
    main()
