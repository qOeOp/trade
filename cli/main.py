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
import os
from pathlib import Path
import sys
import textwrap
import tomllib

from cli import (ledger_commands, live_commands, market_commands, paper_commands, replay_commands,
                 research_commands)
from cli.common import RUNNER_EPILOG, Parser, _print, refusal_json
from engine.live_errors import LiveRefusal
from shared.errors import Refusal
from shared.refusals import refuse


# Each group declares its nouns (with their help) and commands (cli.common.Command), in --help order.
GROUPS = (ledger_commands, research_commands, replay_commands, market_commands, paper_commands, live_commands)
NOUNS = {noun: text for group in GROUPS for noun, text in group.NOUNS.items()}
COMMANDS = [command for group in GROUPS for command in group.COMMANDS]


def _contract(reads: str, writes: str, returns: str, refuses: str) -> str:
    """A command's contract in its --help: what it reads, writes and returns, and its main refusals."""
    return "\n".join(textwrap.fill(text, 100, initial_indent=f"{label:<9}", subsequent_indent=" " * 9)
                     for label, text in (("reads", reads), ("writes", writes), ("returns", returns),
                                         ("refuses", refuses)))


def product_version() -> str:
    """The product version: pyproject.toml's, the one source a release tag, CHANGELOG.md and the IDE's About name."""
    return tomllib.loads((Path(__file__).resolve().parents[1] / "pyproject.toml").read_text())["project"]["version"]


def build_parser() -> Parser:
    parser = Parser(prog="python -m cli.main", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=f"trade-research {product_version()}")
    nouns = parser.add_subparsers(dest="noun", required=True, parser_class=Parser)
    verbs = {noun: nouns.add_parser(noun, help=text, description=text).add_subparsers(
        dest="verb", required=True, parser_class=Parser) for noun, text in NOUNS.items()}
    for command in COMMANDS:
        notes = command.epilog  # a one-paragraph note is wrapped here; a formatted one keeps its lines
        notes = textwrap.fill(notes, 100) if notes and "\n" not in notes else notes
        epilog = "\n\n".join(part for part in (_contract(*command.contract), notes,
                                                RUNNER_EPILOG if command.runner else None) if part)
        verb = verbs[command.noun].add_parser(command.verb, help=command.help, description=command.help,
                                              epilog=epilog, formatter_class=argparse.RawDescriptionHelpFormatter)
        verb.set_defaults(run=command.run, takes_runner=command.runner)
        for add in command.options:
            add(verb)
    return parser


def _dispatch(args, runner_argv: list[str]) -> tuple[dict, int]:
    """(result, exit code) of one parsed command."""
    if runner_argv and not args.takes_runner:
        raise refuse("USAGE_ERROR", f"{args.noun} {args.verb} takes no runner arguments after --")
    args.runner_argv = runner_argv
    result = args.run(args)
    return result if isinstance(result, tuple) else (result, 0)


def main(argv: list[str] | None = None) -> int:
    """Parse `<noun> <verb> [options] [-- runner arguments]`, run it, print one JSON result."""
    argv = list(sys.argv[1:] if argv is None else argv)
    runner_argv: list[str] = []
    if "--" in argv:
        split = argv.index("--")
        argv, runner_argv = argv[:split], argv[split + 1:]
    try:
        args = build_parser().parse_args(argv)
        result, code = _dispatch(args, runner_argv)
    except Refusal as exc:
        _print(sys.stderr, refusal_json(exc))
        return 1
    except LiveRefusal as exc:
        _print(sys.stderr, {"code": exc.code, "message": exc.message})
        return 1
    try:
        _print(sys.stdout, result)
    except BrokenPipeError:  # the reader stopped early (`| head`): the command itself ran
        _quiet_stdout()
    return code


def _quiet_stdout() -> None:
    """Point stdout at devnull, so the interpreter's exit flush does not raise again on a closed pipe."""
    os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())


def entry() -> int:
    """main() with stdout flushed inside it: a reader that closes the pipe early (`--help | head`, progress lines
    of a long import) ends the command with exit 1 and no traceback, as Python's signal docs recommend."""
    try:
        try:
            return main()
        finally:
            sys.stdout.flush()
    except BrokenPipeError:
        _quiet_stdout()
        return 1


if __name__ == "__main__":
    raise SystemExit(entry())
