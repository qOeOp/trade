"""Symbol validation and path safety in market.export (native_symbol, export_catalogs, export_episode)."""

from __future__ import annotations

from datetime import date
import json
from pathlib import Path
import unittest

import pyarrow as pa

from market import export, files, universe
from shared import clock
from tests.helpers import refused, tempdir


def _market(root: Path) -> dict:
    root.mkdir()
    (root / "lock").touch()
    profile = {"name": "temp", "holds": "market", "kind": "temporary", "root": str(root)}
    jan_1 = date(2025, 1, 1)
    jan_2_ms = clock.day_ms(date(2025, 1, 2))
    market = files.open_market(profile, "import")
    with files.lock(market):
        bar = pa.RecordBatch.from_arrays(
            [pa.array(["BTCUSDT"], pa.string()), pa.array(["LAST"], pa.string()), pa.array([jan_2_ms], pa.int64()),
             pa.array([100_000_000], pa.int64()), pa.array([100_000_000], pa.int64()),
             pa.array([100_000_000], pa.int64()), pa.array([100_000_000], pa.int64()), pa.array([10_000], pa.int64())],
            schema=files.BAR.schema,
        )
        um = pa.RecordBatch.from_arrays(
            [pa.array([universe.RULE], pa.string()), pa.array([jan_1], pa.date32()), pa.array(["BTCUSDT"], pa.string())],
            schema=files.UNIVERSE_MONTH.schema,
        )
        files.place(market, [files.write_file(market, "bar", jan_1, None, [bar]),
                             files.write_file(market, "universe_month", jan_1, None, [um])])
    return profile


class ExportSymbolSafetyTests(unittest.TestCase):
    def test_native_symbol_refuses_path_separators_and_whitespace(self):
        self.assertEqual(export.native_symbol("BTCUSDT"), "BTCUSDT-PERP.BINANCE")
        self.assertEqual(export.native_symbol("币安人生USDT"), "XE5B881E5AE89E4BABAE7949FUSDT-PERP.BINANCE")
        for bad in ("/tmp/pwnUSDT", "../BTCUSDT", "BTC/USDT", "BTC\\USDT", "BTC USDT", "BTC_USDT", "USDT", ""):
            with self.subTest(symbol=bad):
                self.assertEqual(refused(export.native_symbol, bad).code, "SYMBOL_SHAPE")

    def test_export_catalogs_and_episode_refuse_malformed_symbols_before_touching_disk(self):
        base = tempdir(self.addCleanup, prefix="export-symbol-")
        profile = _market(base / "market")
        cache = base / "cache"
        start_ns, end_ns = clock.day_ns(date(2025, 1, 1)), clock.day_ns(date(2025, 1, 2))

        # No directory may be created outside the cache root before refusal.
        escaped_parent = base / "outside-cache" / "created-by-symbol"
        escaped_symbol = str(escaped_parent / "NONEXISTENTUSDT")
        self.assertEqual(
            refused(export.export_catalogs, profile, "2025-01-02", [escaped_symbol], start_ns, end_ns,
                    fresh=False, root=cache, workers=1).code,
            "UNKNOWN_SYMBOL",
        )
        self.assertFalse(escaped_parent.exists())

        # An arbitrary export.json outside the cache root cannot be read as a cache hit.
        spoof_dir = base / "spoof-outside-cache"
        spoof_dir.mkdir()
        (spoof_dir / "export.json").write_text(json.dumps({
            "format": export.FORMAT, "symbol": "FAKE", "timeframe": "1m", "pieces": [{"episode": None}],
        }), encoding="utf-8")
        for bad in (str(spoof_dir), "../spoof-outside-cache", "BTC/USDT", "BTC\\USDT", "BTC USDT"):
            with self.subTest(symbol=bad):
                self.assertEqual(
                    refused(export.export_catalogs, profile, "2025-01-02", [bad], start_ns, end_ns,
                            fresh=False, root=cache, workers=1).code,
                    "UNKNOWN_SYMBOL",
                )

        # export_episode also refuses malformed symbols before creating target.parent.
        episode_parent = base / "outside-episode" / "nested"
        self.assertEqual(
            refused(export.export_episode, {"profile": profile, "market_day": "2025-01-02",
                                            "symbol": "../evil", "start_ns": start_ns, "end_ns": end_ns,
                                            "path": str(episode_parent / "evil"), "include_quotes": False}).code,
            "UNKNOWN_SYMBOL",
        )
        self.assertFalse(episode_parent.exists())


if __name__ == "__main__":
    unittest.main()
