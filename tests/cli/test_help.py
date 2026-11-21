"""Every command's --help states its contract (what it reads, writes and returns, its main refusals),
as the command line promises its Agents. No ledger."""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
import unittest
from unittest import mock

from cli import main


def _commands(parser):
    """(noun, verb, parser) of every declared command."""
    for noun, noun_parser in next(a for a in parser._actions if isinstance(a.choices, dict)).choices.items():
        for verb, command in next(a for a in noun_parser._actions if isinstance(a.choices, dict)).choices.items():
            yield noun, verb, command


class HelpTests(unittest.TestCase):
    def test_every_option_has_help(self):
        for noun, verb, command in _commands(main.build_parser()):
            for action in command._actions:
                if not isinstance(action, argparse._HelpAction):
                    with self.subTest(command=f"{noun} {verb}", option=action.option_strings or action.dest):
                        self.assertTrue(action.help)

    def test_version_names_the_pyproject_version(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as done:
            main.main(["--version"])
        self.assertEqual((done.exception.code, out.getvalue()), (0, f"trade-research {main.product_version()}\n"))
        self.assertRegex(main.product_version(), r"^[0-9]+\.[0-9]+\.[0-9]+$")


class UsageRefusalTests(unittest.TestCase):
    """A command line the parser refuses is USAGE_ERROR carrying that command's usage line and options, with a
    note for runner arguments without -- and for --line on a command its registration binds; nothing runs."""

    def refused(self, *argv: str) -> dict:
        err, ran, dispatch = io.StringIO(), mock.Mock(), main._dispatch

        def parsed(args, runner_argv):  # the parsed command would run `ran`, never the product
            args.run = ran
            return dispatch(args, runner_argv)
        with contextlib.redirect_stderr(err), mock.patch.object(main, "_dispatch", parsed):
            self.assertEqual(main.main(list(argv)), 1)
        ran.assert_not_called()
        refusal = json.loads(err.getvalue())
        self.assertEqual(refusal["code"], "USAGE_ERROR")
        self.assertIn("listed under `expected`", refusal["next_actions"][0])
        return refusal

    def test_the_refusal_carries_the_commands_usage_and_options(self):
        refusal = self.refused("research", "state", "--bogus")
        self.assertEqual(refusal["message"], "unrecognized arguments: --bogus")
        self.assertTrue(refusal["expected"].startswith("usage: python -m cli.main research state "))
        self.assertIn("--history-before HISTORY_BEFORE", refusal["expected"])
        self.assertNotIn("reads ", refusal["expected"])  # the contract stays in --help
        refusal = self.refused("hypothesis", "compare", "--registration", "1")
        self.assertEqual(refusal["message"], "the following arguments are required: --trial-id")
        self.assertIn("--trial-id TRIAL_ID", refusal["expected"])
        refusal = self.refused("candidate", "list", "--", "--start", "x")
        self.assertEqual(refusal["message"], "candidate list takes no runner arguments after --")
        self.assertTrue(refusal["expected"].startswith("usage: python -m cli.main candidate list "))

    def test_runner_arguments_without_the_separator_are_named(self):
        refusal = self.refused("replay", "precheck", "--candidate", "s@1", "--market-day", "head", "--output", "/tmp/o",
                               "--symbols", "BTCUSDT", "--start", "2024-01-01T00:00:00Z")
        self.assertEqual(refusal["message"], "unrecognized arguments: --symbols BTCUSDT --start 2024-01-01T00:00:00Z; "
                                             "runner arguments go after --")
        refusal = self.refused("replay", "precheck", "--candidate", "s@1", "--market-day", "head", "--output", "/tmp/o",
                               "--bogus", "--", "--start", "2024-01-01T00:00:00Z")
        self.assertEqual(refusal["message"], "unrecognized arguments: --bogus")
        self.assertNotIn("runner", self.refused("research", "state", "--start", "x")["message"])

    def test_a_line_on_a_command_its_registration_binds_is_still_refused_and_says_why(self):
        bound = "this command takes the research line from the registration (--registration), not --line"
        refusal = self.refused("replay", "run", "--registration", "5", "--candidate", "s@1", "--line", "l")
        self.assertEqual(refusal["message"], f"unrecognized arguments: --line l; {bound}")
        refusal = self.refused("hypothesis", "compare", "--registration", "1", "--trial-id", "2", "--line=l")
        self.assertEqual(refusal["message"], f"unrecognized arguments: --line=l; {bound}")
        self.assertNotIn("registration", self.refused("candidate", "list", "--line", "l")["message"])


class ClosedPipeTests(unittest.TestCase):
    """A reader that stops early (`| head`) ends the command quietly: no traceback, the command's own exit code."""

    def _closed_pipe(self) -> int:
        read, write = os.pipe()
        os.close(read)  # nothing reads: the first write fails with EPIPE
        self.addCleanup(os.close, write)
        return write

    def test_result_printed_into_a_closed_pipe_keeps_the_exit_code(self):
        rows = {"rows": [{"trial": n} for n in range(20_000)]}  # larger than any pipe buffer
        out = os.fdopen(os.dup(self._closed_pipe()), "w")
        self.addCleanup(out.close)
        with mock.patch.object(main, "_dispatch", return_value=(rows, 0)), mock.patch.object(sys, "stdout", out):
            self.assertEqual(main.main(["research", "state"]), 0)

    def test_help_into_a_closed_pipe_exits_without_traceback(self):
        done = subprocess.run([sys.executable, "-m", "cli.main", "--help"], stdout=self._closed_pipe(),
                              stderr=subprocess.PIPE, text=True, check=False)
        self.assertEqual((done.returncode, done.stderr), (1, ""))
