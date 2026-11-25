"""What `validation registration` advises when its time stamp failed."""

from types import SimpleNamespace
import unittest
from unittest import mock

from cli import research_commands
from registration import validation


class WitnessAdviceTests(unittest.TestCase):
    def advised(self, status: str, retry_of: int | None) -> list[str]:
        args = SimpleNamespace(candidate="s@1", window_start="2026-01-01T00:00:00Z", window_end="2026-02-01T00:00:00Z",
                               universe_rule="rule", market_day="head", design="design.json", retry_of=retry_of,
                               op_id=None, market=None, tsa_url=None)
        registered = {"registration_id": 2, "created_at": None, "ledger_commit": "c", "replayed": False,
                      "witness": {"status": status, "stamped_at": None, "error": None}}
        with mock.patch.object(research_commands, "_research"), \
                mock.patch.object(research_commands, "_json_file", return_value={}), \
                mock.patch.object(research_commands.profiles, "market"), \
                mock.patch.object(validation, "validation_register", return_value=registered):
            return research_commands.validation_registration(args)["next_actions"]

    def test_only_a_first_registration_is_told_to_be_witnessed_before_its_window(self):
        self.assertIn("REGISTRATION_TOO_LATE", self.advised("failed", None)[0])
        self.assertEqual(self.advised("failed", 1), [], "it binds by its original registration's witness")
        self.assertEqual(self.advised("stamped", None), [])
