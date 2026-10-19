"""The replay window: explicit UTC, the one-minute execution grid, never the machine's timezone."""

import json
import os
import subprocess
import sys
import unittest

from engine.config import Refusal, effective_configuration, ns as _ns, parse_configuration, parse_window


ARGV = [
    "--market-root", "/inputs/market", "--market-commit", "c" * 32, "--symbols", "BTCUSDT",
    "--start", "2025-01-01T00:00:00Z", "--end", "2025-01-02T00:00:00Z",
    "--trade-start", "2025-01-01T01:00:00Z", "--output", "/reports",
    "--strategy-file", "/unused.py", "--strategy-class", "Unused",
    "--strategy-sha256", "a" * 64,
]


class ReplayTimeTests(unittest.TestCase):
    def code(self, argv) -> str:
        with self.assertRaises(Refusal) as caught:
            parse_configuration(argv)
        return caught.exception.code

    def test_explicit_offsets_resolve_to_one_instant_and_one_normal_form(self):
        expected = effective_configuration(parse_configuration(ARGV)).values
        actual = effective_configuration(parse_configuration(ARGV + [
            "--start", "2025-01-01T09:00:00+09:00",
            "--end", "2025-01-01T19:00:00-05:00",
            "--trade-start", "2025-01-01T10:00:00+09:00",
        ])).values
        self.assertEqual({key: actual[key] for key in ("start", "trade_start", "end")},
                         {"start": "2025-01-01T00:00:00Z", "trade_start": "2025-01-01T01:00:00Z",
                          "end": "2025-01-02T00:00:00Z"})
        self.assertEqual(actual, expected)

    def test_utc_and_tokyo_hosts_return_identical_windows(self):
        script = """
import json, sys, time
from engine.config import parse_configuration
time.tzset()
window = parse_configuration(json.loads(sys.argv[1])).window
print(json.dumps([window.start_ns, window.trade_start_ns, window.end_ns, window.start, window.end]))
"""
        outputs = []
        for timezone in ("UTC", "Asia/Tokyo"):
            result = subprocess.run([sys.executable, "-c", script, json.dumps(ARGV)],
                                    env={**os.environ, "TZ": timezone, "PYTHONDONTWRITEBYTECODE": "1"},
                                    capture_output=True, text=True, check=True)
            outputs.append(json.loads(result.stdout))
        self.assertEqual(outputs[0], outputs[1])

    def test_each_boundary_needs_an_explicit_valid_utc_time(self):
        for field in ("--start", "--end", "--trade-start"):
            for value, code in (("2025-01-01T00:00:00", "WINDOW_TIMEZONE_MISSING"),
                                ("2025-01-01", "WINDOW_TIMEZONE_MISSING"),
                                ("2025-02-30T00:00:00Z", "WINDOW_TIMESTAMP_INVALID"),
                                ("2025-01-01T00:00:00+25:00", "WINDOW_TIMESTAMP_INVALID"),
                                ("0001-01-01T00:00:00+14:00", "WINDOW_TIMESTAMP_INVALID"),
                                ("invalid", "WINDOW_TIMESTAMP_INVALID"), ("", "WINDOW_TIMESTAMP_INVALID"),
                                ("2025-01-01T00:00:00.000000001Z", "WINDOW_TIMESTAMP_INVALID"),
                                ("2025-01-01T00:00:00,0000009+09:00", "WINDOW_TIMESTAMP_INVALID"),
                                ("2025-01-01T00:00:00+00:00:00.000001", "WINDOW_TIMESTAMP_INVALID")):
                with self.subTest(field=field, value=value):
                    self.assertEqual(self.code(ARGV + [field, value]), code)

    def test_boundaries_lie_on_the_minute_grid_in_order(self):
        for extra, code in ((["--end", "2025-01-01T00:00:00Z"], "WINDOW_ORDER_INVALID"),
                            (["--end", "2024-12-31T00:00:00Z"], "WINDOW_ORDER_INVALID"),
                            (["--trade-start", "2024-12-31T23:59:00Z"], "WINDOW_ORDER_INVALID"),
                            (["--trade-start", "2025-01-02T00:00:00Z"], "WINDOW_ORDER_INVALID"),
                            (["--end", "2025-01-02T00:00:01Z"], "WINDOW_NOT_ALIGNED"),
                            (["--trade-start", "2025-01-01T01:00:00.000001Z"], "WINDOW_NOT_ALIGNED")):
            with self.subTest(extra=extra):
                self.assertEqual(self.code(ARGV + extra), code)
        window = parse_configuration(ARGV + ["--start", "2025-01-01T00:01:00Z"]).window  # one-minute execution
        self.assertEqual(window.start_ns, _ns("2025-01-01T00:01:00Z"))
        self.assertEqual(parse_window("2025-01-01T00:00:00Z", None, "2025-01-01T00:10:00Z", 5).end_ns,
                         _ns("2025-01-01T00:10:00Z"))
        with self.assertRaises(Refusal) as caught:
            parse_window("2025-01-01T00:01:00Z", None, "2025-01-01T00:10:00Z", 5)
        self.assertEqual(caught.exception.code, "WINDOW_NOT_ALIGNED")

    def test_arguments_and_contracts_are_checked_before_execution(self):
        without_output = [value for index, value in enumerate(ARGV) if index not in (12, 13)]
        self.assertEqual(self.code(without_output), "REPLAY_ARGUMENT_MISSING")
        self.assertEqual(self.code(ARGV + ["--symbols", "BTCUSDT", "BTCUSDT"]), "SYMBOL_DUPLICATE")
        self.assertEqual(self.code(ARGV + ["--risk-budget-bps", "25"]), "UNKNOWN_OPTION")

    def test_default_trade_start_and_nanoseconds_use_the_same_parser(self):
        config = parse_configuration([value for index, value in enumerate(ARGV) if index not in (10, 11)])
        self.assertEqual(config.window.trade_start_ns, config.window.start_ns)
        self.assertEqual(_ns("2025-01-01T09:00:00+09:00"), _ns("2025-01-01T00:00:00Z"))
        self.assertEqual(_ns("1970-01-01T00:00:00.000001Z"), 1000)


if __name__ == "__main__":
    unittest.main()
