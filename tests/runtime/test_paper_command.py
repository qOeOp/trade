"""If this fails, a paper container could reach the host's network or environment: it must run only the
layout's paper modules, on a named Docker network with a memory limit and the replay stage's hardening, and
pass no variable of the host's."""

from pathlib import Path
import tempfile
import unittest

from ledger.errors import Refusal
from runtime import container


IDENTITY = {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64, "image_digest": "sha256:" + "a" * 64,
            "platform": "linux/arm64", "runtime_contract": "replay-contract@v7"}


class PaperCommandTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.reports = (Path(temp.name), "/reports", False)

    def command(self, module="engine.paper", network="trade-paper-x-1", memory="4g", mounts=None):
        return container.paper_command(IDENTITY, mounts or [self.reports], module, ["--output", "/reports"],
                                       name="trade-paper-x-1-runner", network=network, memory=memory,
                                       labels={"trade.paper.id": "1"})

    def option(self, command: list[str], name: str) -> list[str]:
        return [command[index + 1] for index, value in enumerate(command) if value == name]

    def test_a_paper_container_is_detached_on_its_network_with_the_stage_hardening(self):
        command = self.command()
        self.assertIn("--detach", command)
        self.assertNotIn("--rm", command)
        self.assertEqual(self.option(command, "--network"), ["trade-paper-x-1"])
        self.assertEqual((self.option(command, "--memory"), self.option(command, "--memory-swap")), (["4g"], ["4g"]))
        for flag in ("--read-only", "--cap-drop", "--pids-limit", "--user", "--pull"):
            self.assertIn(flag, command)
        self.assertEqual(self.option(command, "--env"), ["PYTHONDONTWRITEBYTECODE=1"])
        self.assertEqual(command[-4:], ["-m", "engine.paper", "--output", "/reports"])

    def test_each_refusal(self):
        cases = [({"network": "host"}, "ARGV_INVALID"), ({"network": "bridge"}, "ARGV_INVALID"),
                 ({"network": "none"}, "ARGV_INVALID"), ({"network": "a b"}, "ARGV_INVALID"),
                 ({"memory": "unlimited"}, "ARGV_INVALID"), ({"memory": "0g"}, "ARGV_INVALID"),
                 ({"module": "engine.run"}, "MODULE_NOT_IN_LAYOUT"),
                 ({"mounts": [(Path(self.reports[0]), "/inputs", True)]}, "REPORTS_MOUNT_MISSING")]
        for options, code in cases:
            with self.subTest(options=options), self.assertRaises(Refusal) as caught:
                self.command(**options)
            self.assertEqual(caught.exception.code, code)

    def test_a_replay_stage_cannot_run_a_paper_module(self):
        with self.assertRaises(Refusal) as caught:
            container.container_command(IDENTITY, [self.reports], "engine.paper", [], "replay-x")
        self.assertEqual(caught.exception.code, "MODULE_NOT_IN_LAYOUT")


if __name__ == "__main__":
    unittest.main()
