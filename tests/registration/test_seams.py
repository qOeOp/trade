"""The seams to later phases: runner arguments, month paths, and today's runtime code behind them."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from ledger.errors import Refusal
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

    def test_todays_runner_configuration_is_comparable_under_the_engine_design_keys(self):
        from types import SimpleNamespace
        from engine import run
        args = SimpleNamespace(market_root="/x/market", market_commit="a" * 32, pool=None, symbols=["AAAUSDT"],
                               start="2025-12-31T00:00:00Z", end="2026-02-01T00:00:00Z", trade_start="2026-01-01T00:00:00Z")
        key = comparability.config_key(seams.design_config(run.effective_configuration(args)))
        self.assertEqual((key["symbols"], key["account"]), (["AAAUSDT"], run.ACCOUNT_CONTRACT))

    def test_member_months_merge_into_half_open_paths(self):
        paths = seams.membership_from_months([("2025-12", "A"), ("2026-01", "A"), ("2026-03", "A"), ("2025-12", "B")])
        self.assertEqual(paths["A"], [[seams.month_ns("2025-12"), seams.month_ns("2026-02")],
                                      [seams.month_ns("2026-03"), seams.month_ns("2026-04")]])
        self.assertEqual(paths["B"], [[seams.month_ns("2025-12"), seams.month_ns("2026-01")]])
        self.assertEqual(seams.month_ns("1970-02"), 31 * 86_400 * 10**9)

    def test_todays_runtime_errors_become_coded_refusals(self):
        from research.records import runtime
        from research.records.common import RecordError
        identity = {"image_ref": "x@sha256:" + "b" * 64, "image_digest": "sha256:" + "b" * 64, "platform": "linux/arm64",
                    "runtime_contract": "r1-native-v5", "build_revision": None}
        cases = [("resolve", lambda: seams.DEFAULT.resolve_runtime("x:main"), RecordError("no pull"),
                  "RUNTIME_UNAVAILABLE"),
                 ("inspect_runtime", lambda: seams.DEFAULT.inspect_runtime(identity, [], {
                     "root": "/tmp/r", "membership_file": "/tmp/m", "identity": {"market_commit": "m"}}),
                  RecordError("probe failed"), "RUNTIME_PROBE_INVALID"),
                 ("require_main_build", lambda: seams.DEFAULT.require_main_build(identity, {}),
                  RecordError("not on main", code="RUNTIME_NOT_MAIN"), "RUNTIME_NOT_MAIN")]
        for name, call, error, expected in cases:
            with self.subTest(name=name), patch.object(runtime, name, side_effect=error), \
                    self.assertRaises(Refusal) as caught:
                call()
            self.assertEqual(caught.exception.code, expected)


if __name__ == "__main__":
    unittest.main()
