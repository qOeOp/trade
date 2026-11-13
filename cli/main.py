"""The product command line (`cli.main`): noun verb subcommands that print JSON; each command's
--help states its contract.

    uv run --frozen python -m cli.main <noun> <verb> [options] [-- runner arguments]

A ledger is named by `--ledger`: a profile file path, or a profile name in the ledger profile
directory (`TRADE_LEDGER_HOME`, default ~/.local/share/trade/ledgers); without it, the active
research ledger. A market directory is named by `--market` the same way; without it, the active
market profile in the profile directory. Runner arguments (window and instrument scope) follow `--`.

A result is one JSON object on stdout. A refusal is one JSON object on stderr with exit 1: code,
message, missing, expected, write_status (not_written, written or unknown; rerun with operation_id
when unknown) and next_actions, the commands that supply what is missing; a Live refusal (engine/live_errors.py)
holds only code and message. A command that changes the
ledger commits it locally and returns without publishing: the ledger service under compose publishes what
origin lacks every 5 minutes, and `ledger publish` publishes at once. Each command's --help lists what it
reads, writes and returns and its main refusals.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
import textwrap
import tomllib

from cli import (ledger_commands, live_commands, market_commands, paper_commands, replay_commands,
                 research_commands)
from cli.common import RUNNER_EPILOG, Parser, UsageError, _market_refusal, _print, refusal_json
from engine.live_errors import LiveRefusal
from shared.errors import Refusal
from shared.refusals import refuse


# Each group owns its nouns' functions, --help contracts, parsers and dispatch; registered in --help order.
GROUPS = (ledger_commands, research_commands, replay_commands, market_commands, paper_commands, live_commands)
BY_NOUN = {noun: group for group in GROUPS for noun in group.NOUNS}


def _contract(reads: str, writes: str, returns: str, refuses: str) -> str:
    """A command's contract in its --help: what it reads, writes and returns, and its main refusals."""
    return "\n".join(textwrap.fill(text, 100, initial_indent=f"{label:<9}", subsequent_indent=" " * 9)
                     for label, text in (("reads", reads), ("writes", writes), ("returns", returns),
                                         ("refuses", refuses)))


# (reads, writes, returns, main refusals) of each command, shown in its --help.
CONTRACTS: dict[tuple[str, str], tuple[str, str, str, str]] = {
    key: value for group in GROUPS for key, value in group.CONTRACTS.items()}


def product_version() -> str:
    """The product version: pyproject.toml's, the one source a release tag, CHANGELOG.md and the IDE's About name."""
    return tomllib.loads((Path(__file__).resolve().parents[1] / "pyproject.toml").read_text())["project"]["version"]


def _parser() -> Parser:
    parser = Parser(prog="python -m cli.main", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=f"trade-research {product_version()}")
    nouns = parser.add_subparsers(dest="noun", required=True, parser_class=Parser)
    groups = {}

    def verbs(name: str, help_text: str):
        noun = nouns.add_parser(name, help=help_text, description=help_text)
        groups[name] = noun.add_subparsers(dest="verb", required=True, parser_class=Parser)
        return groups[name]

    def verb(group, name: str, help_text: str, epilog: str | None = None):
        return group.add_parser(name, help=help_text, description=help_text, epilog=epilog,
                                formatter_class=argparse.RawDescriptionHelpFormatter)

    def runner(group, name: str, help_text: str):
        return verb(group, name, help_text, RUNNER_EPILOG)

    for commands in GROUPS:
        commands.register(verbs, verb, runner)

    for noun_name, group in groups.items():
        for verb_name, command in group.choices.items():
            notes = command.epilog  # a one-paragraph note is wrapped here; a formatted one keeps its lines
            notes = textwrap.fill(notes, 100) if notes and "\n" not in notes else notes
            contract = CONTRACTS.get((noun_name, verb_name))
            command.epilog = "\n\n".join(part for part in (_contract(*contract) if contract else None, notes) if part)
    return parser


RUNNER_COMMANDS = {("replay", "explore"), ("replay", "precheck"), ("replay", "run"), ("registration", "add")}


def _dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed command."""
    key = (args.noun, args.verb)
    if runner_argv and key not in RUNNER_COMMANDS:
        raise UsageError(f"{args.noun} {args.verb} takes no runner arguments after --")
    return BY_NOUN[args.noun].dispatch(args, runner_argv)


def main(argv: list[str] | None = None) -> int:
    """Parse `<noun> <verb> [options] [-- runner arguments]`, run it, print one JSON result."""
    from market import store
    argv = list(sys.argv[1:] if argv is None else argv)
    runner_argv: list[str] = []
    if "--" in argv:
        split = argv.index("--")
        argv, runner_argv = argv[:split], argv[split + 1:]
    try:
        args = _parser().parse_args(argv)
        result, code = _dispatch(args, runner_argv)
    except UsageError as exc:
        found = refuse("USAGE_ERROR", str(exc))
        _print(sys.stderr, refusal_json(found))
        return 1
    except Refusal as exc:
        _print(sys.stderr, refusal_json(exc))
        return 1
    except LiveRefusal as exc:
        _print(sys.stderr, {"code": exc.code, "message": exc.message})
        return 1
    except store.MarketError as exc:
        _print(sys.stderr, refusal_json(_market_refusal(exc)))
        return 1
    _print(sys.stdout, result)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
