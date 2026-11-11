"""Every command's --help states its contract (what it reads, writes and returns, its main refusals),
as the command line promises its Agents. No ledger."""

from __future__ import annotations

import argparse
import unittest

from cli import main


def _commands(parser):
    """(noun, verb, parser) of every declared command."""
    for noun, noun_parser in next(a for a in parser._actions if isinstance(a.choices, dict)).choices.items():
        for verb, command in next(a for a in noun_parser._actions if isinstance(a.choices, dict)).choices.items():
            yield noun, verb, command


class HelpTests(unittest.TestCase):
    def test_every_command_help_states_its_contract(self):
        commands = list(_commands(main._parser()))
        self.assertEqual({(noun, verb) for noun, verb, _ in commands}, set(main.CONTRACTS))
        for noun, verb, command in commands:
            with self.subTest(command=f"{noun} {verb}"):
                self.assertIn(main._contract(*main.CONTRACTS[(noun, verb)]), command.format_help())

    def test_every_option_has_help(self):
        for noun, verb, command in _commands(main._parser()):
            for action in command._actions:
                if not isinstance(action, argparse._HelpAction):
                    with self.subTest(command=f"{noun} {verb}", option=action.option_strings or action.dest):
                        self.assertTrue(action.help)


if __name__ == "__main__":
    unittest.main()
