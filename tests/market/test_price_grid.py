"""The exported instrument's price grid is the contract's at the market commit, never the window's: two windows of
one commit, one of them holding a minute off the terms' tick, trade on one grid."""

from datetime import date
from pathlib import Path
import tempfile
import unittest

import numpy as np

from market import export
from tests.market.directory import directory, seed
from tests.market.exchange import DAY, MINUTE, day_ms


JAN = date(2025, 1, 1)
START = day_ms(JAN)


class PriceGridTests(unittest.TestCase):
    def test_two_windows_of_one_commit_get_one_grid(self):
        from nautilus_trader.persistence import ParquetDataCatalog
        profile = directory(self.addCleanup)
        times = START + np.arange(2 * 1440, dtype=np.int64) * MINUTE
        price = np.full(len(times), 10_010_000_000, dtype=np.int64)  # 100.10, on the 0.10 tick
        off = price.copy()
        off[1440 + 60] = 10_013_000_000  # 100.13 on the second day, as BTCUSDT's older history on the 0.01 grid
        columns = {"ts_open": times, "open": price, "high": off, "low": price, "close": price,
                   "volume": np.full(len(times), 10_000, dtype=np.int64)}
        commit = seed(profile, month="2025-01", through="2025-02-01",
                      terms=[("BTCUSDT", {"price_increment": "0.10", "size_increment": "0.001"})],
                      bars={("BTCUSDT", "LAST"): columns,
                            ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(len(times), np.int64)}},
                      members=[(JAN, "BTCUSDT")])
        with tempfile.TemporaryDirectory() as temp:
            found = {}
            for name, days in (("first-day", 1), ("both-days", 2)):
                path = Path(temp) / name
                receipt = export.export_episode({"profile": profile, "commit": commit, "symbol": "BTCUSDT",
                                                 "start_ns": START * 10**6, "end_ns": (START + days * DAY) * 10**6,
                                                 "path": str(path), "include_quotes": False})
                piece, = receipt["pieces"]
                made, = ParquetDataCatalog(str(path)).instruments()
                found[name] = (piece["price_precision"], piece["price_precision_widened"], str(made.price_increment))
        self.assertEqual(found, {"first-day": (2, True, "0.01"), "both-days": (2, True, "0.01")})


if __name__ == "__main__":
    unittest.main()
