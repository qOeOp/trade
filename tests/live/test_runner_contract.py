"""What one RUNNER_CONTRACT number promises a control that takes over a running runner.

docs/plans/live-continuous-step6-adopt-20261113.zh.md: a release hands the runners of a busy account to a new control
only where the runner's runtime and the control declare the same number (engine/live.py). These tests hold both
halves to the code: the arguments the control starts a runner with and the exit statuses and events the runner ends
in (engine/live.py), and how the control reads a start from them (live/runs.py), against the baseline recorded from
the first control declaring the number (`runner-contract-N.json`). A change to either half fails here: raise
RUNNER_CONTRACT and record its own baseline.
"""

import json
import os
from pathlib import Path
from unittest.mock import patch

from engine import live as runner
from engine.live import RUNNER_CONTRACT
from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import runs, state
from tests.live.test_runs import LiveFixture


BASELINE = Path(__file__).with_name(f"runner-contract-{RUNNER_CONTRACT}.json")
RAISE = ("a control of this runner contract would start or read a running runner differently: raise engine/live.py "
         "RUNNER_CONTRACT and record its own baseline (docs/plans/live-continuous-step6-adopt-20261113.zh.md)")


def reading(fixture: LiveFixture, sample: dict) -> dict:
    """How the control reads one start: the run's state and stop reason, and whether it starts it again."""
    directory, out = fixture.directory, fixture.directory / "out"
    state.append(fixture.root / "account.jsonl", "reserved", fixture.run_id)
    state.append(directory / "lifecycle.jsonl", "launch_requested", fixture.run_id, mode=sample["mode"],
                 container="runner", credentials_path=str(fixture.credentials))
    for row in sample["events"]:
        state.append(out / "events.jsonl", row["event"], fixture.run_id, **{k: v for k, v in row.items() if k != "event"})
    for name in sample["files"]:
        (out / name).write_text("{}" if name == "armed.json" else "")
    container = {"State": sample["container"]}
    with patch.object(runs, "_runner", return_value=container):
        view = runs.observe(fixture.root, fixture.run_id)
    return {"state": view["state"], "stop_reason": view["stop_reason"], "exit_code": view["exit_code"],
            "starts_again": runs._interrupted(directory, runs._latest_launch(directory))}


class RunnerContractTests(LiveFixture):
    def setUp(self):
        super().setUp()
        self.assertTrue(BASELINE.is_file(), RAISE)
        self.baseline = json.loads(BASELINE.read_text())

    def test_the_control_starts_each_mode_with_the_arguments_the_runner_takes(self):
        for mode, argv in self.baseline["runner_args"].items():
            with self.subTest(mode=mode):
                self.assertEqual(host_runtime.runner_args(mode), argv, RAISE)
                with patch.object(runner, "execute", return_value=0) as execute:
                    self.assertEqual(runner.main(argv), 0, RAISE)
                self.assertEqual(execute.call_args.args[0].mode, mode)

    def test_the_runner_ends_in_the_exit_statuses_and_events_the_control_reads(self):
        statuses = self.baseline["exit_statuses"]
        self.assertEqual(runner.INTERRUPTED, statuses["interrupted"], RAISE)
        for failure, status in ((LiveRefusal("LIVE_MODE", "refused"), statuses["refused"]),
                                (RuntimeError("signed url"), statuses["unresolved"])):
            with patch.object(runner, "execute", side_effect=failure):
                self.assertEqual(runner.main(self.baseline["runner_args"]["run"]), status, RAISE)
        vocabulary = self.baseline["events"]
        self.assertEqual(sorted(runner.ENDED_EVENTS), vocabulary["ended"], RAISE)
        self.assertEqual(sorted(runs.RUN_ENDED), vocabulary["ended"], RAISE)
        self.assertEqual(runs.FLAT, vocabulary["flat"], RAISE)

    def test_the_control_reads_each_recorded_start_as_it_did(self):
        for sample in self.baseline["samples"]:
            with self.subTest(sample=sample["name"]):
                self.setUp()
                self.assertEqual(reading(self, sample), sample["reading"], RAISE)
                self.assertFalse(os.path.lexists(self.directory / "out" / "STOP") and sample["reading"]["starts_again"])
