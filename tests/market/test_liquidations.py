"""The recorded liquidation tables as `market coverage` reads them, in a throwaway market directory: which Bybit
contracts pair with a Binance one, and the rows and watch of an interval; no active market or network."""

from decimal import Decimal
import unittest

from market import coverage, files, liquidations
from tests.market.test_files import DAY, JAN, JAN_1, Directory, rows_of, watch


class BybitPairingTests(unittest.TestCase):
    def test_a_bybit_contract_pairs_with_binance_by_coin_and_settlement(self):
        listed = ["1000PEPEUSDT", "BTCPERP", "BTCUSDT", "BTC-26DEC25", "SHIB1000USDT", "PEPEUSDT"]
        self.assertEqual(liquidations.bybit_symbols("1000SHIBUSDT", listed), ["SHIB1000USDT"])
        self.assertEqual(liquidations.bybit_symbols("1000PEPEUSDT", listed), ["1000PEPEUSDT", "PEPEUSDT"])
        self.assertEqual(liquidations.bybit_symbols("BTCUSDC", listed), ["BTCPERP"])
        self.assertEqual(liquidations.bybit_symbols("ETHUSD_PERP", listed), [])


class CoverageTests(Directory):
    def test_the_recorded_rows_and_their_watch_read_through_a_commit(self):
        price, size = Decimal("2274.93"), Decimal(461)
        at = JAN + 1000
        force_order = rows_of("binance_force_order", symbol=["BTCUSDT"], trade_time=[at], side=["SELL"], price=[price],
                              avg_price=[price], orig_qty=[size], filled_qty=[size], last_filled_qty=[size],
                              status=["FILLED"], event_time=[at + 60], received_at=[at + 70], n=[2])
        all_liquidation = rows_of("bybit_all_liquidation", symbol=["BTCUSDT"], updated_time=[at], side=["Buy"],
                                  size=[size], bankruptcy_price=[price], message_time=[at + 60], received_at=[at + 70],
                                  n=[1])
        bybit_watch = rows_of("liquidation_watch", venue=["bybit"], symbol=["BTCUSDT"], start_time=[JAN + 500],
                              end_time=[JAN + DAY])
        self.write([("binance_force_order", JAN_1, "BTCUSDT", [force_order]),
                    ("bybit_all_liquidation", JAN_1, "BTCUSDT", [all_liquidation]),
                    ("liquidation_watch", JAN_1, None, [watch(JAN), bybit_watch])])
        market = files.open_market(self.profile, "reader")
        commit = files.commit_of(JAN_1)
        watched = coverage.liquidation_watch(market, commit)
        facts = coverage.liquidation_facts(market, commit, "BTCUSDT", JAN - 100, JAN + DAY, watched)
        self.assertEqual(facts["binance"], {"rows": 1, "liquidations": 2, "uncovered_intervals_ms": [[JAN - 100, JAN]]})
        self.assertEqual(facts["bybit"], [{"symbol": "BTCUSDT", "rows": 1, "liquidations": 1,
                                           "uncovered_intervals_ms": [[JAN - 100, JAN + 500]]}])
        self.assertLessEqual({*liquidations.TABLES.values(), liquidations.WATCH}, set(files.UPLOADED))  # stay published

    def test_a_market_with_no_watch_covers_nothing(self):
        market = files.open_market(self.profile, "reader")
        commit = files.commit_of(JAN_1)
        self.assertIsNone(coverage.liquidation_watch(market, commit))
        self.assertEqual(coverage.liquidation_facts(market, commit, "BTCUSDT", JAN, JAN + DAY, None),
                         {"binance": {"rows": 0, "liquidations": 0, "uncovered_intervals_ms": [[JAN, JAN + DAY]]},
                          "bybit": []})


if __name__ == "__main__":
    unittest.main()
