import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("binance_liquidation_zones_main", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class ParseArgsTests(unittest.TestCase):
    def test_parse_args_requires_any_input(self):
        with self.assertRaisesRegex(ValueError, "provide --symbol or pass"):
            MODULE.parse_args([])

    def test_parse_args_validates_limit_upper_bound(self):
        with self.assertRaisesRegex(ValueError, "--limit cannot be greater than 1000"):
            MODULE.parse_args(["--symbol", "BTCUSDT", "--limit", "1001"])

    def test_parse_args_normalizes_symbol(self):
        config = MODULE.parse_args(["--symbol", "btc/usdt", "--lookback-minutes", "60"])
        self.assertEqual(config.symbol, "BTCUSDT")
        self.assertEqual(config.lookback_minutes, 60)

    def test_parse_args_accepts_file_inputs_without_symbol(self):
        config = MODULE.parse_args(["--aggtrades-file", "/tmp/agg.json", "--snapshot-file", "/tmp/snapshot.json"])
        self.assertEqual(config.symbol, "")
        self.assertEqual(config.aggtrades_file, "/tmp/agg.json")
        self.assertEqual(config.snapshot_file, "/tmp/snapshot.json")


class HelperTests(unittest.TestCase):
    def test_extract_coin_handles_quote_assets(self):
        self.assertEqual(MODULE.extract_coin("BTCUSDT"), "BTC")
        self.assertEqual(MODULE.extract_coin("ETH-USD"), "ETH")
        self.assertEqual(MODULE.extract_coin("SOL"), "SOL")

    def test_build_sample_aggregates_notional(self):
        sample = MODULE.build_sample(
            [
                {"T": 10, "p": "100", "q": "2"},
                {"T": 20, "p": "101", "q": "1.5"},
            ],
            [{"timestamp": "2026-01-01T00:00:00+00:00"}],
            [{"priceMean": 100.5}],
        )

        self.assertEqual(sample["tradeCount"], 2)
        self.assertEqual(sample["inferredLiquidationCount"], 1)
        self.assertEqual(sample["candidateZoneCount"], 1)
        self.assertEqual(sample["totalNotionalUsd"], 351.5)

    def test_build_sample_handles_normalized_trade_shape(self):
        sample = MODULE.build_sample(
            [
                {"timestamp": 10, "price": "100", "quantity": "2", "notional": "200"},
                {"timestamp": 20, "price": "101", "quantity": "1.5", "notional": "151.5"},
            ],
            [],
            [],
        )

        self.assertEqual(sample["firstTimestamp"], 10)
        self.assertEqual(sample["lastTimestamp"], 20)
        self.assertEqual(sample["totalNotionalUsd"], 351.5)

    def test_build_warnings_flags_empty_zones(self):
        warnings = MODULE.build_warnings([], [], [], "network", "network")
        self.assertTrue(any("not a real liquidation feed" in item for item in warnings))
        self.assertTrue(any("no candidate zones" in item for item in warnings))

    def test_load_runtime_modules_shows_install_hint(self):
        with mock.patch.object(MODULE.importlib, "import_module", side_effect=ImportError("missing")):
            with self.assertRaisesRegex(RuntimeError, "python3 -m pip install -r"):
                MODULE.load_liquidator_module()

    def test_unwrap_skill_payload_rejects_failed_wrapper(self):
        with self.assertRaisesRegex(ValueError, "upstream skill payload is not ok"):
            MODULE.unwrap_skill_payload({"ok": False, "error": "boom", "data": None})

    def test_load_aggtrades_payload_accepts_skill_wrapper(self):
        payload = {
            "ok": True,
            "data": {
                "symbol": "BTCUSDT",
                "trades": [{"symbol": "BTCUSDT", "price": "100", "quantity": "1", "timestamp": 1, "isBuyerMaker": True}],
            },
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            path = pathlib.Path(temp_dir) / "agg.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            loaded = MODULE.load_aggtrades_payload(str(path))

        self.assertEqual(loaded["symbol"], "BTCUSDT")
        self.assertEqual(len(loaded["trades"]), 1)

    def test_resolve_symbol_rejects_mismatched_inputs(self):
        with self.assertRaisesRegex(ValueError, "symbol mismatch"):
            MODULE.resolve_symbol(
                "",
                {"symbol": "BTCUSDT", "trades": []},
                {"symbol": "ETHUSDT", "premiumIndex": {}, "openInterest": {}},
            )

    def test_resolve_symbol_can_derive_from_snapshot(self):
        symbol = MODULE.resolve_symbol(
            "",
            None,
            {
                "premiumIndex": {"symbol": "BTCUSDT"},
                "openInterest": {"symbol": "BTCUSDT"},
            },
        )
        self.assertEqual(symbol, "BTCUSDT")


if __name__ == "__main__":
    unittest.main()
