"""The registration seams: runner arguments and month paths."""

from __future__ import annotations

import unittest

from ledger.errors import Refusal
from registration import comparability, seams


class SeamTests(unittest.TestCase):
    def test_runner_arguments_give_the_window_and_selection(self):
        parsed = seams.current.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00+00:00",
                                              "--symbols", "AAAUSDT", "BBBUSDT", "--account", "x"])
        self.assertEqual(parsed["window"]["start"], parsed["window"]["trade_start"])
        self.assertEqual(parsed["window"]["end"] - parsed["window"]["start"], 32 * 86_400 * 10**9)
        self.assertEqual((parsed["selection"], parsed["lifecycle_bundle"]), ({"symbols": ["AAAUSDT", "BBBUSDT"]}, None))
        self.assertEqual(parsed["execution"], "bars")
        universe = seams.current.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--trade-start",
                                                "2026-01-01T00:00:00Z", "--end", "2026-02-01T00:00:00Z",
                                                "--lifecycle-bundle", "lifecycle-x"])
        self.assertEqual((universe["selection"], universe["lifecycle_bundle"]), ({"universe": True}, "lifecycle-x"))
        self.assertEqual(seams.current.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--end",
                                                      "2026-02-01T00:00:00Z", "--execution=quotes"])["execution"],
                         "quotes")
        with self.assertRaises(ValueError):
            seams.current.runner_inputs(["--start", "2025-12-31T00:00:00", "--end", "2026-02-01T00:00:00Z"])
        with self.assertRaises(Refusal) as caught:  # one unsplit string, as an unquoted shell variable gives
            seams.current.runner_inputs(["--start 2025-12-31T00:00:00Z --end 2026-02-01T00:00:00Z"])
        self.assertEqual(caught.exception.code, "USAGE_ERROR")

    def test_trade_ticks_are_the_entry_s_and_need_the_quote_environment(self):
        window = ["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00Z", "--symbols", "AAAUSDT"]
        quotes = ["--execution", "quotes", "--initial-margin", "0.05", "--maintenance-margin", "0.025"]
        self.assertFalse(seams.current.runner_inputs(window + quotes)["trade_ticks"])
        self.assertTrue(seams.current.runner_inputs(["--trade-ticks", *window, *quotes])["trade_ticks"])
        for argv in (["--trade-ticks", *window], ["--trade-ticks", *window, "--execution", "bars"]):
            with self.assertRaises(Refusal) as caught:
                seams.current.runner_inputs(argv)
            self.assertEqual(caught.exception.code, "TRADE_TICKS_NEED_QUOTES")
        argv, _ = seams.container_runner_args([*window[:4], "--trade-ticks", *quotes, *window[4:]],
                                              {"identity": {"market_commit": "c" * 32}, "symbols": ["AAAUSDT"],
                                               "root": "/x", "membership_file": "/x/membership.json"})
        self.assertNotIn("--trade-ticks", argv)
        self.assertEqual(argv[:len(window) - 2 + len(quotes)], [*window[:4], *quotes])

    def test_the_engine_configuration_is_comparable(self):
        from engine import config
        args = config.parse_configuration(["--describe", "--market-root", "/x/market", "--market-commit", "a" * 32,
                                           "--symbols", "AAAUSDT", "--start", "2025-12-31T00:00:00Z",
                                           "--end", "2026-02-01T00:00:00Z", "--trade-start", "2026-01-01T00:00:00Z"])
        key = comparability.config_key(config.effective_configuration(args).values)
        self.assertEqual((key["symbols"], key["account"]), (["AAAUSDT"], config.ACCOUNT_CONTRACT))


if __name__ == "__main__":
    unittest.main()
