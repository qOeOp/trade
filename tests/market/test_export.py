"""Symbol validation and path safety in market.export (native_symbol, export_catalogs, export_episode)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

from market import export, files, universe
from shared import clock
from tests.helpers import refused, tempdir
from tests.market.directory import seed


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


class ExportMetricsRatioTests(unittest.TestCase):
    def test_shown_ratio_handles_extreme_ratios_without_division_by_zero(self):
        for name in export.ACCOUNT_RATIOS:
            self.assertEqual(export.shown_ratio(name, Decimal("19999")), Decimal("10000.0000"))
            self.assertEqual(export.shown_ratio(name, Decimal("19999.0001")), Decimal("19999.0001"))
            self.assertEqual(export.shown_ratio(name, Decimal("50000.12345")), Decimal("50000.1235"))

    def test_export_catalogs_with_metrics_handles_extreme_long_short_ratios(self):
        import numpy as np
        base = tempdir(self.addCleanup, prefix="export-extreme-ratio-")
        profile = {"name": "temp", "holds": "market", "kind": "temporary", "root": str(base / "market")}
        (base / "market").mkdir()
        (base / "market" / "lock").touch()
        jan_1 = date(2025, 1, 1)
        start_ms = clock.day_ms(jan_1)
        times = start_ms + np.arange(1440, dtype=np.int64) * 60_000
        price = np.full(1440, 100 * 10**8, dtype=np.int64)
        cols = {"ts_open": times, **{k: price for k in ("open", "high", "low", "close")},
                "volume": np.full(1440, 10000, dtype=np.int64)}
        seed(profile, month="2025-01", through="2025-01-02",
             terms=[("BTCUSDT", {"price_increment": "0.01", "size_increment": "0.001"})],
             bars={("BTCUSDT", "LAST"): cols, ("BTCUSDT", "MARK"): {**cols, "volume": np.zeros(1440, np.int64)}},
             funding={"BTCUSDT": [(start_ms, "0.0001")]},
             members=[(jan_1, "BTCUSDT")])
        market = files.open_market(profile, "import")
        dec = files.METRICS.schema.field("sum_open_interest").type
        batch = pa.RecordBatch.from_arrays(
            [pa.array(["BTCUSDT"], pa.string()), pa.array([start_ms], pa.int64()),
             pa.array([Decimal("1000.5")], dec), pa.array([Decimal("19999.0001")], dec),
             pa.array([Decimal("2.5")], dec), pa.array([Decimal("50000.123456")], dec)],
            schema=files.METRICS.schema,
        )
        with files.lock(market):
            files.place(market, [files.write_file(market, "metrics", jan_1, "BTCUSDT", [batch])])
        low_ns, high_ns = clock.day_ns(jan_1), clock.day_ns(date(2025, 1, 2))
        found = export.export_catalogs(profile, "2025-01-01", ["BTCUSDT"], low_ns, high_ns,
                                       fresh=True, root=base / "cache", workers=1, include_metrics=True)
        path, = (Path(found["root"]) / "BTCUSDT" / "data" / "metrics").rglob("*.parquet")
        table = pq.read_table(path)
        self.assertEqual(table.column("count_toptrader_long_short_ratio").to_pylist(), [Decimal("19999.0001")])
        self.assertEqual(table.column("count_long_short_ratio").to_pylist(), [Decimal("50000.1235")])


if __name__ == "__main__":
    unittest.main()
