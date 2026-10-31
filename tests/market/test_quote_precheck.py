"""The quote month-existence precheck: half-open month bounds, and only the requested symbols refuse."""

from datetime import date
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from market import sources, store
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed
from tests.market.exchange import day_ms

JAN, FEB = date(2025, 1, 1), date(2025, 2, 1)


@unittest.skipUnless(BINARY, SKIP)
class QuotePrecheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)

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
        profile = self.fixture.add("half_open_bounds")
        seed(profile, month="2025-01", through="2025-02-01", bars={}, terms=[
            (symbol, {"price_increment": "0.01", "size_increment": "0.001"}) for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")])
        with store.connect(profile, "import") as conn:
            conn.many("INSERT INTO quote VALUES (%s, %s, %s, %s, %s)", [
                ("BTCUSDT", day_ms(JAN) - 1, 1, 100, 101),
                ("BTCUSDT", day_ms(FEB), 2, 100, 101),
                ("ETHUSDT", day_ms(JAN) + 1, 3, 100, 101),
                ("SOLUSDT", day_ms(JAN), 4, 100, 101)])
            store._commit(conn, "test: boundary quotes")
        self.assertEqual(self.precheck(profile, ["BTCUSDT"]), "precheck passed")
        refused = self.precheck(profile, ["SOLUSDT", "ETHUSDT", "BTCUSDT"])
        self.assertEqual(refused["code"], "MONTH_EXISTS")
        self.assertEqual(refused["message"], "the market database already holds 2025-01 quotes of ['ETHUSDT', 'SOLUSDT']")
        self.assertEqual(refused["missing"], ["2025-01"])


if __name__ == "__main__":
    unittest.main()
