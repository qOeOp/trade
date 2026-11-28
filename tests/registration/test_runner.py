"""Runner arguments with their trade and metrics inputs, and the identity probe they are given to."""

from __future__ import annotations

import unittest

from ledger import execution, trials
from registration import runner, seams
from tests.helpers import refused


class RunnerTests(unittest.TestCase):
    def test_runner_arguments_give_the_window_and_selection(self):
        parsed = runner.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00+00:00",
                                              "--symbols", "AAAUSDT", "BBBUSDT", "--account", "x"])
        self.assertEqual(parsed["window"]["start"], parsed["window"]["trade_start"])
        self.assertEqual(parsed["window"]["end"] - parsed["window"]["start"], 32 * 86_400 * 10**9)
        self.assertEqual((parsed["selection"], parsed["lifecycle_bundle"]), ({"symbols": ["AAAUSDT", "BBBUSDT"]}, None))
        self.assertEqual(parsed["execution"], "bars")
        universe = runner.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--trade-start",
                                                "2026-01-01T00:00:00Z", "--end", "2026-02-01T00:00:00Z",
                                                "--universe", "pool", "--lifecycle-bundle", "lifecycle-x"])
        self.assertEqual((universe["selection"], universe["lifecycle_bundle"]), ({"universe": True}, "lifecycle-x"))
        self.assertEqual(runner.runner_inputs(["--start", "2025-12-31T00:00:00Z", "--end",
                                                      "2026-02-01T00:00:00Z", "--universe", "pool", "--execution=quotes"])["execution"],
                         "quotes")
        for bad in ("2025-12-31T00:00:00", "2025-13-01T00:00:00Z", "yesterday"):
            with self.subTest(time=bad):
                caught = refused(runner.runner_inputs, ["--start", bad, "--end", "2026-02-01T00:00:00Z",
                                                                "--universe", "pool"])
                self.assertEqual(caught.code, "WINDOW_INVALID")
        caught = refused(runner.runner_inputs, ["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00Z",
                                                "--symbols"])
        self.assertEqual((caught.code, caught.missing), ("USAGE_ERROR", ()))
        self.assertIn("--help", caught.expected)
        # one unsplit string, as an unquoted shell variable gives
        caught = refused(runner.runner_inputs, ["--start 2025-12-31T00:00:00Z --end 2026-02-01T00:00:00Z"])
        self.assertEqual(caught.code, "USAGE_ERROR")

    def test_universe_takes_only_pool_and_excludes_symbols(self):
        window = ["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00Z"]
        for valid in ([*window, "--universe", "pool"], [*window, "--universe=pool"]):
            with self.subTest(valid=valid):
                self.assertEqual(runner.runner_inputs(valid)["selection"], {"universe": True})
        # neither is the whole pool chosen by omission (#3816); an abbreviation, which the runner refuses, is
        # refused here too, beside a scope or in place of one (#3791)
        for bad in ([*window, "--universe", "bogus"], [*window, "--universe"],
                    [*window, "--symbols", "AAAUSDT", "--universe", "pool"], window,
                    [*window, "--univ", "pool"], [*window, "--sym", "AAAUSDT"],
                    [*window, "--symbols", "AAAUSDT", "--univ", "pool"], [*window, "--universe", "pool", "--trade", "x"]):
            with self.subTest(bad=bad):
                self.assertEqual(refused(runner.runner_inputs, bad).code, "USAGE_ERROR")

    def test_trade_ticks_are_the_entry_s_and_need_the_quote_environment(self):
        window = ["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00Z", "--symbols", "AAAUSDT"]
        quotes = ["--execution", "quotes", "--initial-margin", "0.05", "--maintenance-margin", "0.025"]
        self.assertFalse(runner.runner_inputs(window + quotes)["trade_ticks"])
        self.assertTrue(runner.runner_inputs(["--trade-ticks", *window, *quotes])["trade_ticks"])
        for argv in (["--trade-ticks", *window], ["--trade-ticks", *window, "--execution", "bars"]):
            self.assertEqual(refused(runner.runner_inputs, argv).code, "TRADE_TICKS_NEED_QUOTES")
        argv, _ = runner.container_runner_args([*window[:4], "--trade-ticks", *quotes, *window[4:]],
                                              {"identity": {"market_day": "c" * 32}, "symbols": ["AAAUSDT"],
                                               "root": "/x", "membership_file": "/x/membership.json"})
        self.assertNotIn("--trade-ticks", argv)
        self.assertEqual(argv[:len(window) - 2 + len(quotes)], [*window[:4], *quotes])

    def test_metrics_are_read_by_the_entry_and_passed_on_to_the_runner_outside_the_effective_configuration(self):
        from engine import config
        window = ["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00Z", "--symbols", "AAAUSDT"]
        self.assertFalse(runner.runner_inputs(window)["metrics"])
        self.assertTrue(runner.runner_inputs([*window[:4], "--metrics", *window[4:]])["metrics"])
        argv, _ = runner.container_runner_args([*window[:4], "--metrics", *window[4:]],
                                              {"identity": {"market_day": "c" * 32}, "symbols": ["AAAUSDT"],
                                               "root": "/x", "membership_file": "/x/membership.json"})
        self.assertEqual(argv[:5], [*window[:4], "--metrics"])
        plain, given = (config.parse_configuration(["--describe", "--market-root", "/x", "--market-day", "a" * 32,
                                                    *window, *extra]) for extra in ([], ["--metrics"]))
        self.assertEqual((plain.metrics, given.metrics), (False, True))
        self.assertEqual(config.effective_configuration(plain), config.effective_configuration(given))

    def test_the_identity_probe_is_given_the_exported_market_to_read(self):
        from unittest import mock
        from runtime import image
        identity = {key: f"<{key}>" for key in execution.IDENTITY_FIELDS}
        with mock.patch.object(image, "inspect_runtime", return_value={}) as probe:
            seams._inspect_runtime(identity, ["--start", "2025-12-31T00:00:00Z", "--end", "2026-02-01T00:00:00Z"],
                                   {"identity": {"market_day": "c" * 32}, "symbols": ["AAAUSDT"],
                                    "root": "/x", "membership_file": "/x/membership.json"})
        self.assertEqual({(str(source), target) for source, target, _ in probe.call_args.args[2]},
                         {("/x", runner.MARKET_ROOT), ("/x/membership.json", runner.MEMBERSHIP)})

    def test_the_engine_configuration_is_comparable(self):
        from engine import config
        args = config.parse_configuration(["--describe", "--market-root", "/x/market", "--market-day", "a" * 32,
                                           "--symbols", "AAAUSDT", "--start", "2025-12-31T00:00:00Z",
                                           "--end", "2026-02-01T00:00:00Z", "--trade-start", "2026-01-01T00:00:00Z"])
        key = trials.config_key(config.effective_configuration(args).values)
        self.assertEqual((key["symbols"], key["account"]), (["AAAUSDT"], config.ACCOUNT_CONTRACT))
