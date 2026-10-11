"""Every native replay reports one trial through a single interface (stored in Dolt by WS2)."""

import json
import tempfile
import unittest
from pathlib import Path

from research.records.trials import hand_off_run, report_trial


TRIAL = {"strategy_source_sha256": "a" * 64, "coins": ["BTC", "ETH"], "start": "2025-01-01T00:00:00Z",
         "trade_start": "2025-01-02T00:00:00Z", "end": "2025-02-01T00:00:00Z", "image_digest": "sha256:" + "b" * 64}


class TrialReportTests(unittest.TestCase):
    def test_exploration_trial_is_written_once_into_its_run_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            trial = report_trial(mode="explore", run_dir=Path(folder), **TRIAL)
            self.assertEqual(json.loads((Path(folder) / "trial.json").read_text()), trial)
            with self.assertRaises(FileExistsError):
                report_trial(mode="explore", run_dir=Path(folder), **TRIAL)
        self.assertEqual(trial["window"], {"start": TRIAL["start"], "trade_start": TRIAL["trade_start"], "end": TRIAL["end"]})
        self.assertIsNone(trial["run_id"])

    def test_incomplete_or_inconsistent_trials_are_refused(self):
        for changes in ({"mode": "sealed"}, {"mode": "explore", "run_id": "RUN"}, {"mode": "other"},
                        {"mode": "explore", "image_digest": "latest"}, {"mode": "explore", "coins": []},
                        {"mode": "explore", "strategy_source_sha256": "draft"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                report_trial(**{**TRIAL, **changes})

    def test_hand_off_carries_the_run_directory_and_audit_result(self):
        handed = hand_off_run(mode="explore", run_dir=Path("/tmp/run"), audit={"passed": False, "findings": ["x"]})
        self.assertEqual((handed["run_dir"], handed["audit_passed"], handed["audit_findings"]), ("/tmp/run", False, ["x"]))
        self.assertFalse(hand_off_run(mode="sealed", run_dir=Path("/tmp/run"), audit=None, run_id="R")["audit_passed"])


if __name__ == "__main__":
    unittest.main()
