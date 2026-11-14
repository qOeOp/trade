"""The exported instrument's price grid is the one in force from the window's start at the market day, never a
function of the window's end: two windows from one start, one of them holding a minute off the terms' tick, trade on
one grid; a window starting after the contract's last minute off the tick trades on the tick, as Paper and Live do."""

from datetime import date
from decimal import Decimal
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
    def test_windows_from_one_start_share_a_grid_and_one_after_the_last_off_tick_minute_trades_on_the_tick(self):
        from nautilus_trader.persistence import ParquetDataCatalog
        profile = directory(self.addCleanup)
        times = START + np.arange(2 * 1440, dtype=np.int64) * MINUTE
        price = np.full(len(times), 10_010_000_000, dtype=np.int64)  # 100.10, on the 0.10 tick
        off = price.copy()
        off[1440 + 60] = 10_013_000_000  # 100.13 on the second day, as BTCUSDT's older history on the 0.01 grid
        columns = {"ts_open": times, "open": price, "high": off, "low": price, "close": price,
                   "volume": np.full(len(times), 10_000, dtype=np.int64)}
        market_day = seed(profile, month="2025-01", through="2025-02-01",
                      terms=[("BTCUSDT", {"price_increment": "0.10", "size_increment": "0.001"})],
                      bars={("BTCUSDT", "LAST"): columns,
                            ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(len(times), np.int64)}},
                      funding={"BTCUSDT": [(START + 8 * 3_600_000 * i, Decimal("0.0001")) for i in range(6)]},
                      members=[(JAN, "BTCUSDT")])
        with tempfile.TemporaryDirectory() as temp:
            found = {}
            for name, first, last in (("first-day", START, START + DAY), ("both-days", START, START + 2 * DAY),
                                      ("after-the-off-minute", START + DAY + 120 * MINUTE, START + 2 * DAY)):
                path = Path(temp) / name
                receipt = export.export_episode({"profile": profile, "market_day": market_day, "symbol": "BTCUSDT",
                                                 "start_ns": first * 10**6, "end_ns": last * 10**6,
                                                 "path": str(path), "include_quotes": False})
                piece, = receipt["pieces"]
                made, = ParquetDataCatalog(str(path)).instruments()
                found[name] = (piece["price_precision"], piece["price_precision_widened"], str(made.price_increment))
        self.assertEqual(found, {"first-day": (2, True, "0.01"), "both-days": (2, True, "0.01"),
                                 "after-the-off-minute": (2, False, "0.10")})
