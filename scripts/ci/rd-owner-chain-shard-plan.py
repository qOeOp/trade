#!/usr/bin/env python3
"""
Plans the R&D Owner chain's shards from its declared needs and measured durations.

The shard list is this script's output and nothing else: `--check` in the chain script reruns it
and requires the committed list to be byte-identical, so a hand edit to the list cannot drift away
from the declarations it is derived from.

Inputs:
  - the chain array, read from scripts/ci/test-rd-owner-postgres.bash (chain order);
  - rd-owner-chain-needs.tsv: per entry, the entries it needs (hard, proved by VERIFY), the
    entries it must run after to keep an assertion meaningful, and the entries it replays: run
    again at the start of its component because the state it needs is produced by an entry whose
    own component runs elsewhere. A replay is a copy, not an edge, and it carries the reason and
    what will replace it, which every run of this script prints;
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


def check_replays(
    name: str,
    copies: list[str],
    replay_reason: str,
    edges: list[str],
    position: dict[str, int],
) -> None:
    """
    Refuse a replay that is also an edge, comes after its entry, or gives no reason.
    """
    if copies and replay_reason in ("", "-"):
        fail(
            f"{name} replays {','.join(copies)} without saying why and what replaces the replay",
        )
    if not copies and replay_reason not in ("", "-"):
        fail(f"{name} gives a replay reason but replays nothing")
    for copy in copies:
        if copy in edges:
            fail(f"{name} both needs and replays {copy}; a replay is not an edge")
        if copy not in position or position[copy] >= position[name]:
            fail(f"{name} replays {copy}, which is not a chain entry before it")
    if copies:
        sys.stderr.write(
            f"REPLAY: {name} replays {', '.join(copies)}: {replay_reason}\n",
        )


def entry_declaration(
    name: str,
    fields: tuple[str, str, str, str, str],
    position: dict[str, int],
) -> tuple[list[str], list[str], list[str]]:
    """
    Check one entry's declaration and return its needs, afters and replays.
    """
    needs, after, replays, replay_reason, evidence = fields
    if not evidence.strip():
        fail(f"{NEEDS.name} gives no evidence for {name}")
    hard = [] if needs == "NONE" else needs.split(",")
    soft = [] if after == "-" else after.split(",")
    copies = [] if replays == "-" else replays.split(",")
    for earlier in hard + soft:
        if earlier == "?":
            fail(f"{name} has an unresolved need; resolve it before planning")
        if earlier not in position or position[earlier] >= position[name]:
            fail(f"{name} needs {earlier}, which is not a chain entry before it")
    check_replays(name, copies, replay_reason, hard + soft, position)
    return hard, soft, copies


def read_declarations(
    entries: list[str],
    position: dict[str, int],
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """
    Return each entry's edges (needs and afters) and its replays, for every chain entry.
    """
    edges: dict[str, list[str]] = {}
    replays_of: dict[str, list[str]] = {}
    for name, *fields in read_tsv(NEEDS, 6):
        if name in edges:
            fail(f"{NEEDS.name} declares {name} twice")
        if name not in position:
            fail(f"{NEEDS.name} declares {name}, which is not a chain entry")
        hard, soft, copies = entry_declaration(name, tuple(fields), position)
        edges[name] = hard + soft
        if copies:
            replays_of[name] = copies
    missing = [name for name in entries if name not in edges]
    if missing:
        fail(f"{NEEDS.name} declares nothing for: {', '.join(missing)}")
    return edges, replays_of


def components_of(
    entries: list[str],
    edges: dict[str, list[str]],
) -> dict[str, list[str]]:
    """
    Group entries into connected components, each named by its first entry in chain
    order.
    """
    parent = {name: name for name in entries}

    def root(name: str) -> str:
        while parent[name] != name:
            parent[name] = parent[parent[name]]
            name = parent[name]
        return name

    for name, earlier_entries in edges.items():
        for earlier in earlier_entries:
            parent[root(name)] = root(earlier)
    grouped: dict[str, list[str]] = {}
    for name in entries:
        grouped.setdefault(root(name), []).append(name)
    return {members[0]: members for members in grouped.values()}


def plan(shard_count: int) -> str:
    entries = chain_entries()
    position = {name: index for index, name in enumerate(entries)}
    if len(position) != len(entries):
        fail("the chain array names one test twice")
    edges, replays_of = read_declarations(entries, position)
    named = components_of(entries, edges)
    seconds = {name: float(value) for name, value in read_tsv(DURATIONS, 2)}
    slowest = max(seconds.values()) if seconds else 60.0

    def cost(members: list[str]) -> float:
        # A replayed entry runs in this component too, so its time is this component's time.
        replayed = {copy for name in members for copy in replays_of.get(name, [])}
        return sum(seconds.get(name, slowest) for name in [*members, *sorted(replayed)])

    loads = [0.0] * shard_count
    shard_of: dict[str, int] = {}
    component_of: dict[str, str] = {}
    for first in sorted(
        named,
        key=lambda first: (-cost(named[first]), position[first]),
    ):
        shard = min(range(shard_count), key=lambda index: (loads[index], index))
        loads[shard] += cost(named[first])
        for name in named[first]:
            shard_of[name] = shard
            component_of[name] = first

    lines = [
        "# Generated by scripts/ci/rd-owner-chain-shard-plan.py; do not edit by hand.\n",
        f"# {shard_count} shards; planned seconds per shard: "
        + ", ".join(f"{load:.0f}" for load in loads)
        + "\n",
    ]
    lines.extend(
        f"shard-{shard_of[name] + 1}\t{component_of[name]}\t{name}\t"
        f"{1 if name in BROWSER_ENTRIES else 0}\n"
        for name in entries
    )
    return "".join(lines)


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit() or int(sys.argv[1]) < 1:
        fail("usage: rd-owner-chain-shard-plan.py <shard count>")
    sys.stdout.write(plan(int(sys.argv[1])))


if __name__ == "__main__":
    main()
