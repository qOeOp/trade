"""An export refuses a window with bars in a month whose funding file is missing: the replay would settle no funding
there and nothing else would notice."""

from datetime import date
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest

import numpy as np

from market import export
from market.sources import MarketError
from tests.market.directory import directory, seed
from tests.market.exchange import DAY, MINUTE, day_ms


JAN, FEB = date(2025, 1, 1), date(2025, 2, 1)
EVE = day_ms(FEB) - DAY  # 2025-01-31


class FundingFileTests(unittest.TestCase):
    def setUp(self):
        self.profile = directory(self.addCleanup)
        times = EVE + np.arange(2 * 1440, dtype=np.int64) * MINUTE  # January's last day and February's first
        price = np.full(len(times), 10_000_000_000, dtype=np.int64)
        columns = {"ts_open": times, **{name: price for name in ("open", "high", "low", "close")},
                   "volume": np.full(len(times), 10_000, dtype=np.int64)}
        # January's settlements only: the import that would have written February's file is lost
        self.market_day = seed(self.profile, month="2025-01", through="2025-02-02",
                           terms=[("BTCUSDT", {"price_increment": "0.01", "size_increment": "0.001"})],
                           bars={("BTCUSDT", "LAST"): columns,
                                 ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(len(times), np.int64)}},
                           funding={"BTCUSDT": [(EVE + 8 * 3_600_000 * i, Decimal("0.0001")) for i in range(3)]},
                           members=[(JAN, "BTCUSDT"), (FEB, "BTCUSDT")])
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def export(self, end_ms: int) -> dict:
        return export.export_episode({"profile": self.profile, "market_day": self.market_day, "symbol": "BTCUSDT",
                                      "start_ns": EVE * 10**6, "end_ns": end_ms * 10**6,
                                      "path": str(Path(self.temp.name) / str(end_ms)), "include_quotes": False})

    def test_a_window_reaching_a_month_without_its_funding_file_is_refused(self):
        self.assertEqual(self.export(day_ms(FEB))["pieces"][0]["counts"]["funding"], 3)
        with self.assertRaises(MarketError) as caught:
            self.export(day_ms(FEB) + DAY)
        self.assertEqual((caught.exception.code, caught.exception.missing),
                         ("FUNDING_FILE_MISSING", ("funding/2025-02.parquet",)))


if __name__ == "__main__":
    unittest.main()
