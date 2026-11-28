"""Runner arguments (`registration.runner_inputs`, `registration.container_runner_args`) and the product checkout's
git gates (`registration.require_current` for research, `registration.require_fresh` for validation): what
registration and replay do with the runner arguments and the product checkout they are given.
"""

from __future__ import annotations

import argparse
from collections.abc import Mapping
from pathlib import Path
import subprocess

from engine import config
from shared import clock
from shared.refusals import refuse


# Runner arguments inside the container. The replay entry writes the strategy, execution binding,
# output and market options itself and mounts the inputs at fixed container paths, so registration and
# every replay probe the same effective configuration (no host path enters it).
RESERVED_RUNNER_OPTIONS = ("--strategy-file", "--strategy-class", "--strategy-sha256", "--execution-binding",
                           "--output", "--describe", "--market-root", "--market-day")
# Read by the entry, not passed to the runner as given: `--universe pool` selects the universe (the entry
# then passes the runner `--universe` with the membership file it wrote), `--symbols` the contracts.
ENTRY_OPTIONS = ("--universe", "--symbols", "--lifecycle-bundle")
# Read by the entry and never passed on: `--trade-ticks` exports the stored aggregate trades as TradeTicks, which
# the runner streams for every contract whose receipt counts them. `--metrics` is read by the entry (it exports
# the stored metrics) and passed on: the runner then requires them, and an image without it refuses the option.
ENTRY_FLAGS = ("--trade-ticks",)
MARKET_ROOT, MEMBERSHIP = "/inputs/market", "/inputs/membership.json"


def require_unreserved(runner_argv: list[str]) -> None:
    """RUNNER_OPTION_RESERVED when the runner arguments name an option the replay entry writes itself."""
    reserved = sorted({option for value in runner_argv if (option := value.split("=", 1)[0]) in RESERVED_RUNNER_OPTIONS})
    if reserved:
        raise refuse("RUNNER_OPTION_RESERVED", "the replay entry writes " + ", ".join(reserved) + " itself",
                     missing=tuple(reserved))


def container_runner_args(runner_argv: list[str], inputs: Mapping) -> tuple[list[str], list[tuple[Path, str, bool]]]:
    """(runner arguments with the inputs at their container paths, the read-only input mounts)."""
    require_unreserved(runner_argv)
    argv, skipping = [], False
    for value in runner_argv:
        option = value.split("=", 1)[0]
        if value in ENTRY_FLAGS:
            skipping = False
            continue
        if option in ENTRY_OPTIONS:
            skipping = "=" not in value
            continue
        if skipping and not value.startswith("--"):
            continue
        skipping = False
        argv.append(value)
    symbols = list(inputs.get("symbols") or (inputs.get("identity") or {}).get("symbols") or ())
    argv += ["--market-root", MARKET_ROOT, "--market-day", inputs["identity"]["market_day"],
             "--universe", MEMBERSHIP]
    if symbols:
        argv += ["--symbols", *symbols]
    return argv, [(Path(inputs["root"]), MARKET_ROOT, True), (Path(inputs["membership_file"]), MEMBERSHIP, True)]


# engine.parse_window and the runner's selection flags

class _RunnerParser(argparse.ArgumentParser):
    def error(self, message):
        raise refuse("USAGE_ERROR", f"runner arguments: {message}",
                     expected="--start T --end T [--trade-start T], --symbols S... or --universe pool, and the other "
                              "runner arguments the command's --help lists")


def runner_inputs(runner_argv: list[str]) -> dict:
    """Window (UTC ns), selection, lifecycle bundle and execution from existing runner flags. Like the runner's own
    parser, no option is read from an abbreviation, and the contracts are chosen explicitly."""
    parser = _RunnerParser(add_help=False, allow_abbrev=False)
    parser.add_argument("--start", required=True)
    parser.add_argument("--trade-start")
    parser.add_argument("--end", required=True)
    scope = parser.add_mutually_exclusive_group(required=True)  # as `paper start` declares them
    scope.add_argument("--symbols", nargs="+")
    scope.add_argument("--universe", choices=("pool",))
    parser.add_argument("--lifecycle-bundle")
    parser.add_argument("--execution", default="bars")  # the runtime owns validation of this value
    parser.add_argument("--trade-ticks", action="store_true")
    parser.add_argument("--metrics", action="store_true")
    # The rest is the runner's, parsed with its own options (no abbreviations, no help): refused here before registration fixes it.
    for action in config.build_parser()._actions:
        if action.dest != "help" and action.option_strings[0] not in parser._option_string_actions:
            action.required = False  # the inputs the entry writes, refused as reserved where the entry writes them
            parser._add_action(action)
    known = parser.parse_args(runner_argv)
    if known.trade_ticks and known.execution != "quotes":
        # In the bar environment a market order fills at once at the previous bar's close, so an order a trade
        # prompts mid-minute would fill at a price up to 59 seconds older than the trade.
        raise refuse("TRADE_TICKS_NEED_QUOTES", "--trade-ticks needs --execution quotes", missing=("--execution",))
    try:
        start, trade_start, end = (clock.moment_ns(clock.utc(text)) if text else None
                                   for text in (known.start, known.trade_start, known.end))
    except ValueError as exc:
        raise refuse("WINDOW_INVALID", f"runner arguments: {exc}", expected="UTC as YYYY-MM-DDTHH:MM:SSZ") from exc
    window = {"start": start, "trade_start": start if trade_start is None else trade_start, "end": end}
    selection: dict[str, list[str] | bool] = {"symbols": list(known.symbols)} if known.symbols else {"universe": True}
    return {"window": window, "selection": selection, "lifecycle_bundle": known.lifecycle_bundle,
            "execution": known.execution, "trade_ticks": known.trade_ticks, "metrics": known.metrics}


# The product checkout

def _git(root: Path, *argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(root), *argv], capture_output=True, text=True, check=False, timeout=120)


def require_fresh(root: Path) -> None:
    """Validation: refuse unless the product checkout's HEAD contains origin's latest main commit; uncommitted
    or untracked files in its work tree are not checked."""

    def stale(why: str):
        return refuse("STALE_CHECKOUT", why, missing=(str(root),))
    inside = _git(root, "rev-parse", "--is-inside-work-tree")
    if inside.returncode or inside.stdout.strip() != "true":
        raise stale(f"{root} is not a git work tree")
    listed = _git(root, "ls-remote", "origin", "refs/heads/main")
    heads = [line.split()[0] for line in listed.stdout.splitlines() if line.strip()]
    if listed.returncode or len(heads) != 1:
        raise stale("the main commit of origin cannot be queried")
    if _git(root, "merge-base", "--is-ancestor", heads[0], "HEAD").returncode:
        raise stale(f"HEAD does not contain origin main {heads[0]}")


def require_current(root: Path) -> None:
    """Research registration and replay: refuse unless the product checkout's HEAD is the locally fetched
    `origin/main` and its work tree has no uncommitted or untracked file, so a run records the commit it ran
    from. No network: the checkout fetches first."""

    def stale(why: str):
        return refuse("STALE_CHECKOUT", why, missing=(str(root),), expected="HEAD = origin/main, clean work tree")
    head = _git(root, "rev-parse", "HEAD")
    main = _git(root, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main")
    if head.returncode:
        raise stale(f"{root} is not a git work tree")
    if main.returncode:
        raise stale(f"{root} has no fetched origin/main")
    if head.stdout.strip() != main.stdout.strip():
        raise stale(f"HEAD {head.stdout.strip()[:9]} is not origin/main {main.stdout.strip()[:9]}")
    changed = _git(root, "status", "--porcelain")
    if changed.returncode or changed.stdout.strip():
        raise stale(f"the work tree has uncommitted or untracked files: {' '.join(changed.stdout.split()[:6])}")
