"""What one RUNNER_CONTRACT number promises a control that takes over a running runner.

docs/plans/live-continuous-step6-adopt-20261113.zh.md: a release hands the runners of a busy account to a new control
only where the runner's runtime and the control declare the same number (engine/live.py). These tests hold both
halves to the code: the arguments the control starts a runner with and the exit statuses and events the runner ends
in (engine/live.py), and how the control reads a start from them (live/runs.py), against the baseline recorded from
the first control declaring the number (`runner-contract-N.json`). A change to either half fails here: raise
RUNNER_CONTRACT and record its own baseline in place of the old one.
"""

import json
import os
from pathlib import Path
from unittest.mock import patch

from engine import live as runner
from engine import live_connection
from engine.live import RUNNER_CONTRACT
from engine.live_errors import LiveRefusal
from live import host as host_runtime
from live import runs, state
from tests.live.test_runs import LiveFixture


BASELINE = Path(__file__).with_name(f"runner-contract-{RUNNER_CONTRACT}.json")
RAISE = ("a control of this runner contract would start or read a running runner differently: raise engine/live.py "
         "RUNNER_CONTRACT and record its own baseline in place of the old one "
         "(docs/plans/live-continuous-step6-adopt-20261113.zh.md)")


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
    with patch.object(runs, "inspect_runner", return_value=container):
        view = runs.observe(fixture.root, fixture.run_id)
    return {"state": view["state"], "stop_reason": view["stop_reason"], "exit_code": view["exit_code"],
            "starts_again": runs._interrupted(directory, runs.latest_launch(directory))}


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

    def test_the_control_and_the_runner_name_the_same_control_files(self):
        files = self.baseline["control_files"]
        self.assertEqual(files, {"stop": "STOP", "switch": live_connection.SWITCH}, RAISE)
        self.assertEqual(runs.SWITCH, files["switch"], RAISE)

    def test_a_start_that_ended_to_warm_up_again_is_an_interruption_that_starts_again(self):
        # engine.live_connection.rewarm: a non-ending event and the interrupted status, so this number holds.
        sample = {"mode": "run", "files": ["armed.json"],
                  "events": [{"event": "connecting", "mode": "run"},
                             {"event": "entries_closed", "reason": "bars_missing"},
                             {"event": "stopping", "reason": "rewarming", "source_reason": None},
                             {"event": "rewarming", "mode": "run"}],
                  "container": {"Running": False, "Status": "exited", "ExitCode": runner.INTERRUPTED}}
        self.assertEqual(reading(self, sample), {"state": "interrupted", "stop_reason": None, "exit_code": 3,
                                                 "starts_again": True})
        self.assertNotIn("rewarming", runner.ENDED_EVENTS)
        # A failed warm-up after it starts the run once more (the user, 2026-11-13): the same reading.
        self.setUp()
        sample["events"] = [{"event": "connecting", "mode": "run"},
                            {"event": "warmup_refused", "code": "WARMUP_NOT_ADJACENT", "retry": True},
                            {"event": "stopping", "reason": "rewarming", "source_reason": None},
                            {"event": "rewarming", "mode": "run", "retry": True}]
        self.assertEqual(reading(self, sample), {"state": "interrupted", "stop_reason": None, "exit_code": 3,
                                                 "starts_again": True})

