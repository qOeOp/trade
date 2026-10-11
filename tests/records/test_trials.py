"""Every replay reports a well-formed trial before it starts."""

import unittest
from unittest.mock import patch

from research.records.trials import report_trial


IMAGE = "ghcr.io/qoeop/trade-runtime@sha256:" + "b" * 64
GOOD = {"mode": "explore", "strategy_source_sha256": "a" * 64, "coins": ["BTC"], "start": "2026-01-01T00:00:00Z",
        "trade_start": "2026-01-02T00:00:00Z", "end": "2026-02-01T00:00:00Z", "image_ref": IMAGE}


class TrialTests(unittest.TestCase):
    def test_a_trial_is_written_with_a_fresh_operation_id(self):
        with patch("research.records.records.report_trial", return_value={"trial_id": 7}) as write:
            self.assertEqual(report_trial({"name": "x"}, **GOOD), 7)
            report_trial({"name": "x"}, **GOOD)
        first, second = (call.kwargs["op"] for call in write.call_args_list)
        self.assertNotEqual(first, second)  # two replays of one draft are two trials
        self.assertEqual(write.call_args.kwargs["source_sha256"], "a" * 64)

    def test_incomplete_trials_are_refused_before_any_write(self):
        with patch("research.records.records.report_trial") as write:
            for change in ({"mode": "seal"}, {"strategy_source_sha256": "x"}, {"coins": []},
                           {"image_ref": "ghcr.io/qoeop/trade-runtime:main"}):
                with self.subTest(change=change), self.assertRaises(ValueError):
                    report_trial({"name": "x"}, **{**GOOD, **change})
        write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
