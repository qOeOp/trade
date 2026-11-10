"""Paper admission by memory (paper/runs.py, docs/plans/paper-admission-by-memory.zh.md)."""

from __future__ import annotations

from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from shared.errors import Refusal
from paper import runs

PROFILE = SimpleNamespace(service_root=Path("/srv/x"), database="paper")
RUNNING = [{"name": "a-runner", "running": True}, {"name": "a-egress", "running": True},
           {"name": "b-runner", "running": False}]


class AdmissionTests(unittest.TestCase):
    def state(self, reserved: int, host: int | None, budget: str = "3g") -> dict:
        with mock.patch.object(runs, "limits", return_value=reserved) as limits, \
                mock.patch.object(runs, "_host_available", return_value=host), \
                mock.patch.dict("os.environ", {runs.BUDGET_ENV: budget}):
            found = runs.memory_state(PROFILE, RUNNING)
        limits.assert_called_once_with(["a-runner", "a-egress"])
        return found

    def refused(self, need: int, reserved: int, host: int | None) -> str:
        with mock.patch.object(runs, "limits", return_value=reserved), \
                mock.patch.object(runs, "_host_available", return_value=host), \
                mock.patch.dict("os.environ", {runs.BUDGET_ENV: "3g"}), self.assertRaises(Refusal) as caught:
            runs.admit(PROFILE, need, RUNNING)
        self.assertEqual(caught.exception.code, "PAPER_MEMORY_FULL")
        return caught.exception.message

    def test_a_runner_reserves_by_its_contracts_in_steps(self):
        one, many = runs.mib(runs.runner_memory(1)), runs.mib(runs.runner_memory(21))
        self.assertEqual((one % runs.RUNNER_STEP_MIB, many % runs.RUNNER_STEP_MIB), (0, 0))
        self.assertGreater(many, one)
        self.assertGreaterEqual(one, runs.RUNNER_BASE_MIB + runs.RUNNER_PER_CONTRACT_MIB)

    def test_free_memory_is_the_budget_less_running_limits_and_the_hosts_headroom(self):
        self.assertEqual(self.state(1024, None)["free"], 2048)
        self.assertEqual(self.state(1024, 2500)["free"], 2500 - runs.HEADROOM_MIB)
        self.assertEqual(self.state(4096, 8000)["free"], 0)
        self.assertEqual(self.state(0, None, "2g")["budget"], 2048)

    def test_a_run_beyond_the_budget_or_the_headroom_is_refused_with_its_numbers(self):
        self.assertIn("reserve 2560 of the 3072 MiB", self.refused(768, 2560, None))
        self.assertIn("host has 1500 MiB available", self.refused(768, 0, 1500))
        with mock.patch.object(runs, "limits", return_value=0), \
                mock.patch.object(runs, "_host_available", return_value=None):
            runs.admit(PROFILE, 768, RUNNING)

    def test_the_host_reading_is_meminfo_available_or_none(self):
        with tempfile.TemporaryDirectory() as root:
            meminfo = Path(root) / "meminfo"
            meminfo.write_text("MemTotal:        7596168 kB\nMemAvailable:    4231492 kB\n")
            with mock.patch.object(runs, "MEMINFO", meminfo):
                self.assertEqual(runs._host_available(), 4132)
            with mock.patch.object(runs, "MEMINFO", Path(root) / "absent"):
                self.assertIsNone(runs._host_available())


if __name__ == "__main__":
    unittest.main()


class SealCollectTests(unittest.TestCase):
    """A sealed run's working copy and containers go: the capture bundle is what it is read from."""

    def run_with(self, root, stored, present):
        profile = SimpleNamespace(database="paper", service_root=root.parent)
        calls = []
        with mock.patch.object(runs.db, "connect"), \
                mock.patch.object(runs.records, "read_paper_run", return_value={"paper_id": 7}), \
                mock.patch.object(runs.records, "seal_of", return_value=stored), \
                mock.patch.object(runs.records, "capture", return_value={}), \
                mock.patch.object(runs.records, "seal_paper_run", return_value={"bundle": "paper-7-capture"}), \
                mock.patch.object(runs, "run_dir", return_value=root), \
                mock.patch.object(runs, "_running", return_value=False), \
                mock.patch.object(runs, "_logs", return_value=b""), mock.patch.object(runs, "_state", return_value=None), \
                mock.patch.object(runs, "containers", side_effect=lambda _: list(present)), \
                mock.patch.object(runs, "_docker", side_effect=lambda *args, **_: calls.append(args)):
            runs.seal.__wrapped__(profile, 7)  # without the cross-process lock
        return calls

    def test_sealing_removes_the_directory_and_sealing_again_collects_what_is_left(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / "7"
            (root / "out").mkdir(parents=True)
            calls = self.run_with(root, None, [])
            self.assertFalse(root.exists())
            self.assertIn(("network", "rm", runs.names(SimpleNamespace(database="paper", service_root=Path(name)), 7)["network"]), calls)

            (root / "out").mkdir(parents=True)  # left by an earlier controller
            self.run_with(root, {"status": "complete"}, [])
            self.assertFalse(root.exists())

    def test_a_directory_stays_while_the_containers_cannot_be_removed(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name) / "7"
            (root / "out").mkdir(parents=True)
            with self.assertRaisesRegex(RuntimeError, "could not be removed"):
                self.run_with(root, {"status": "complete"}, [{"paper_id": 7, "role": "runner", "running": False}])
            self.assertTrue(root.exists())
