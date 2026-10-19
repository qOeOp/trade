"""The registration seams: runner arguments and month paths."""

from __future__ import annotations

import unittest

from registration import comparability, seams


class SeamTests(unittest.TestCase):
    def test_runner_arguments_give_the_window_and_selection(self):
        parsed = seams.current.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00+00:00",
                                              "--symbols", "AAAUSDT", "BBBUSDT", "--account", "x"])
        self.assertEqual(parsed["window"]["start"], parsed["window"]["trade_start"])
        self.assertEqual(parsed["window"]["end"] - parsed["window"]["start"], 32 * 86_400 * 10**9)
        self.assertEqual((parsed["selection"], parsed["lifecycle_bundle"]), ({"symbols": ["AAAUSDT", "BBBUSDT"]}, None))
        universe = seams.current.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--trade-start",
                                                "2026-01-01T00:00:00Z", "--end", "2026-02-01T00:00:00Z",
                                                "--lifecycle-bundle", "lifecycle-x"])
        self.assertEqual((universe["selection"], universe["lifecycle_bundle"]), ({"universe": True}, "lifecycle-x"))
        with self.assertRaises(ValueError):
            seams.current.runner_inputs(["--start", "2025-12-31T00:00:00", "--end", "2026-02-01T00:00:00Z"])

    def test_the_engine_configuration_is_comparable(self):
        from engine import config
        args = config.parse_configuration(["--describe", "--market-root", "/x/market", "--market-commit", "a" * 32,
                                           "--symbols", "AAAUSDT", "--start", "2025-12-31T00:00:00Z",
                                           "--end", "2026-02-01T00:00:00Z", "--trade-start", "2026-01-01T00:00:00Z"])
        key = comparability.config_key(config.effective_configuration(args).values)
        self.assertEqual((key["symbols"], key["account"]), (["AAAUSDT"], config.ACCOUNT_CONTRACT))

    def test_member_months_merge_into_half_open_paths(self):
        paths = seams.membership_from_months([("2025-12", "A"), ("2026-01", "A"), ("2026-03", "A"), ("2025-12", "B")])
        self.assertEqual(paths["A"], [[seams.month_ns("2025-12"), seams.month_ns("2026-02")],
                                      [seams.month_ns("2026-03"), seams.month_ns("2026-04")]])
        self.assertEqual(paths["B"], [[seams.month_ns("2025-12"), seams.month_ns("2026-01")]])
        self.assertEqual(seams.month_ns("1970-02"), 31 * 86_400 * 10**9)


if __name__ == "__main__":
    unittest.main()
