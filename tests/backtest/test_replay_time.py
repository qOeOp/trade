"""Replay time identities must not depend on the machine's timezone."""

import contextlib
import io
import json
import os
import subprocess
import sys
import unittest

from backtest.r1.replay_util import _ns, _utc_datetime
from backtest.r1.run_portfolio import effective_configuration, parse_configuration


ARGV = [
    "--catalog-root", "/inputs/catalog", "--daily-root", "/inputs/daily",
    "--quantity-csv", "/inputs/quantity.csv", "--coins", "BTC",
    "--start", "2025-01-01T00:00:00Z", "--end", "2025-01-02T00:00:00Z",
    "--trade-start", "2025-01-01T01:00:00Z", "--output", "/reports",
    "--strategy-file", "/unused.py", "--strategy-class", "Unused",
    "--strategy-sha256", "a" * 64, "--signal-variant", "fixture", "--exit-variant", "fixture",
]


class ReplayTimeTests(unittest.TestCase):
    def test_explicit_offsets_preserve_config_text_and_resolve_to_one_instant(self):
        expected = effective_configuration(parse_configuration(ARGV))
        actual = effective_configuration(parse_configuration(ARGV + [
            "--start", "2025-01-01T09:00:00+09:00",
            "--end", "2025-01-01T19:00:00-05:00",
            "--trade-start", "2025-01-01T10:00:00+09:00",
        ]))
        for field in ("start", "end", "trade_start"):
            self.assertEqual(_ns(actual[field]), _ns(expected[field]))
        self.assertEqual(actual["start"], "2025-01-01T09:00:00+09:00")
        self.assertEqual(expected["start"], "2025-01-01T00:00:00Z")

    def test_utc_and_tokyo_hosts_return_identical_start_end_and_trade_start(self):
        script = """
import json, sys, time
from backtest.r1.replay_util import _ns
from backtest.r1.run_portfolio import effective_configuration, parse_configuration
time.tzset()
config = effective_configuration(parse_configuration(json.loads(sys.argv[1])))
print(json.dumps({key: [config[key], _ns(config[key])] for key in ('start', 'end', 'trade_start')}, sort_keys=True))
"""
        outputs = []
        for timezone in ("UTC", "Asia/Tokyo"):
            result = subprocess.run([sys.executable, "-c", script, json.dumps(ARGV)],
                                    env={**os.environ, "TZ": timezone, "PYTHONDONTWRITEBYTECODE": "1"},
                                    capture_output=True, text=True, check=True)
            outputs.append(json.loads(result.stdout))
        self.assertEqual(outputs[0], outputs[1])

    def test_each_time_argument_rejects_naive_and_invalid_inputs(self):
        for field in ("--start", "--end", "--trade-start"):
            for value in ("2025-01-01T00:00:00", "2025-01-01", "2025-02-30T00:00:00Z",
                          "2025-01-01T00:00:00+25:00", "0001-01-01T00:00:00+14:00",
                          "9999-12-31T23:59:59-12:00", "invalid", ""):
                with self.subTest(field=field, value=value), contextlib.redirect_stderr(io.StringIO()) as errors:
                    with self.assertRaises(SystemExit):
                        parse_configuration(ARGV + [field, value])
                    self.assertIn(field, errors.getvalue())

    def test_interval_and_subminute_values_are_rejected_before_execution(self):
        for extra in (
            ["--end", "2025-01-01T00:00:00Z"],
            ["--end", "2024-12-31T00:00:00Z"],
            ["--trade-start", "2024-12-31T23:55:00Z"],
            ["--trade-start", "2025-01-02T00:00:00Z"],
            ["--start", "2025-01-01T00:01:00Z"],
            ["--end", "2025-01-02T00:00:01Z"],
            ["--trade-start", "2025-01-01T01:00:00.000001Z"],
        ):
            with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit):
                    parse_configuration(ARGV + extra)
                self.assertIn("five-minute-aligned", errors.getvalue())

    def test_time_precision_cannot_be_silently_truncated(self):
        for value in ("2025-01-01T00:00:00.000000001Z",
                      "2025-01-01T00:00:00.0000009Z",
                      "2025-01-01T00:00:00.123456789Z",
                      "2025-01-01T00:00:00,0000009+09:00",
                      "2025-01-01T00:00:00+00:00:00.000001",
                      "2025-01-01T00:00:00+09:00:00.0000001"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    _ns(value)
                for field in ("--start", "--end", "--trade-start"):
                    with self.subTest(field=field), contextlib.redirect_stderr(io.StringIO()) as errors:
                        with self.assertRaises(SystemExit):
                            parse_configuration(ARGV + [field, value])
                        self.assertIn(field, errors.getvalue())
        self.assertEqual(_ns("1970-01-01T00:00:00.123456Z"), 123456000)

    def test_default_trade_start_and_nanoseconds_use_the_same_parser(self):
        args = parse_configuration([value for index, value in enumerate(ARGV) if index not in (12, 13)])
        self.assertEqual(effective_configuration(args)["trade_start"], args.start)
        self.assertEqual(_ns("2025-01-01T09:00:00+09:00"), _ns("2025-01-01T00:00:00Z"))
        self.assertEqual(_ns("1970-01-01T00:00:00.000001Z"), 1000)
        with self.assertRaisesRegex(ValueError, "explicit Z or UTC offset"):
            _utc_datetime("2025-01-01T00:00:00")


if __name__ == "__main__":
    unittest.main()
