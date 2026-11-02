"""The quote month-existence precheck: half-open month bounds, and only the requested symbols refuse."""

from datetime import date
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from market import sources, store
from tests.market.directory import directory, forged, seed
from tests.market.exchange import day_ms

DEC, JAN, FEB, MAR = date(2024, 12, 1), date(2025, 1, 1), date(2025, 2, 1), date(2025, 3, 1)


class QuotePrecheckTests(unittest.TestCase):
    def precheck(self, profile, symbols):
        """The import's outcome when its precheck passes it on to the archive, or its refusal."""
        with patch.object(sources, "fetch_archive", side_effect=RuntimeError("precheck passed")), \
                tempfile.TemporaryDirectory() as cache:
            try:
                store.import_quotes(profile, JAN, Path(cache), 1, symbols, log=lambda _: None)
            except sources.MarketError as exc:
                return exc.as_dict()
            except RuntimeError as exc:
                return str(exc)
        self.fail("the import ran without its archive")

    def test_half_open_bounds_and_unrequested_symbols(self):
        profile = directory(self.addCleanup)
        seed(profile, month="2025-01", through="2025-02-01", bars={}, terms=[
            (symbol, {"price_increment": "0.01", "size_increment": "0.001"}) for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")])
        for symbol, start, end, at, identity in (("BTCUSDT", DEC, JAN, day_ms(JAN) - 1, 1),
                                                 ("BTCUSDT", FEB, MAR, day_ms(FEB), 2),
                                                 ("ETHUSDT", JAN, FEB, day_ms(JAN) + 1, 3),
                                                 ("SOLUSDT", JAN, FEB, day_ms(JAN), 4)):
            forged(profile, table="quote", symbol=symbol, start_ms=day_ms(start), end_ms=day_ms(end),
                   rows={"symbol": [symbol], "ts": [at], "agg_trade_id": [identity], "bid": [100], "ask": [101]})
        self.assertEqual(self.precheck(profile, ["BTCUSDT"]), "precheck passed")
        refused = self.precheck(profile, ["SOLUSDT", "ETHUSDT", "BTCUSDT"])
        self.assertEqual(refused["code"], "MONTH_EXISTS")
        self.assertEqual(refused["message"], "the market already holds 2025-01 quotes of ['ETHUSDT', 'SOLUSDT']")
        self.assertEqual(refused["missing"], ["2025-01"])


if __name__ == "__main__":
    unittest.main()
