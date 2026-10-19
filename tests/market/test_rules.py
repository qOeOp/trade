"""The market data rules that need no Dolt: splicing, exact scaling, derivation and the pool."""

from datetime import date, timedelta
from decimal import Decimal
import unittest

import numpy as np
import pyarrow as pa

from market import export, store, universe
from research.records.common import RecordError


MINUTE = 60_000
T0 = 1_761_512_400_000  # 2025-10-26T21:00:00Z


def klines(rows):
    """Archive-shaped rows: (open_time, open, high, low, close, volume)."""
    return pa.table([pa.array([row[0] for row in rows], pa.int64()),
                     *(pa.array([row[i] for row in rows], pa.string()) for i in range(1, 6)),
                     pa.array([row[0] + MINUTE - 1 for row in rows], pa.int64())], schema=store._SCHEMA)


def minutes(rows):
    return {name: np.array([row[i] for row in rows], np.int64) for i, name in enumerate(export.COLUMNS)}


class SpliceTests(unittest.TestCase):
    def test_identical_duplicates_collapse_and_conflicts_refuse(self):
        first = klines([(T0, "1.0", "1.0", "1.0", "1.0", "5"), (T0 + MINUTE, "2", "2", "2", "2", "0")])
        again = klines([(T0 + MINUTE, "2", "2", "2", "2", "0")])
        merged = store._merge([first, again], 0, 1 << 62, "X")
        self.assertEqual(merged["open_time"].to_pylist(), [T0, T0 + MINUTE])
        conflict = klines([(T0 + MINUTE, "2", "3", "2", "2", "0")])
        with self.assertRaises(RecordError) as caught:
            store._merge([first, conflict], 0, 1 << 62, "X")
        self.assertEqual(caught.exception.code, "SOURCE_CONFLICT")

    def test_a_row_that_is_not_a_closed_minute_is_refused(self):
        table = klines([(T0, "1", "1", "1", "1", "1")])
        table = table.set_column(6, "close_time", pa.array([T0 + 5 * MINUTE - 1], pa.int64()))
        with self.assertRaises(RecordError):
            store._merge([table], 0, 1 << 62, "X")

    def test_missing_runs(self):
        times = np.array([T0, T0 + MINUTE, T0 + 4 * MINUTE])
        self.assertEqual(store.missing(times, T0, T0 + 6 * MINUTE),
                         [(T0 + 2 * MINUTE, T0 + 4 * MINUTE), (T0 + 5 * MINUTE, T0 + 6 * MINUTE)])
        self.assertEqual(store.missing(np.array([], np.int64), T0, T0 + MINUTE), [(T0, T0 + MINUTE)])
        self.assertEqual(store.missing(times[:2], T0, T0 + 2 * MINUTE), [])


class ScalingTests(unittest.TestCase):
    def test_exact_scaling(self):
        values, rounded = store.scaled(pa.array(["0.1878", "126208.5", "0"]), 8, "p")
        self.assertEqual(values.tolist(), [18_780_000, 12_620_850_000_000, 0])
        self.assertEqual(rounded, 0)

    def test_extra_price_decimals_are_refused(self):
        with self.assertRaises(RecordError) as caught:
            store.scaled(pa.array(["0.123456789"]), 8, "p")
        self.assertEqual(caught.exception.code, "SCALE_LOSS")

    def test_a_binary_float_tail_is_rounded_and_counted(self):
        values, rounded = store.scaled(pa.array(["108824285.69999999", "12.5"]), 4, "v", float_tails=True)
        self.assertEqual(values.tolist(), [1_088_242_857_000, 125_000])
        self.assertEqual(rounded, 1)
        with self.assertRaises(RecordError):
            store.scaled(pa.array(["12.34567"]), 4, "v", float_tails=True)

    def test_overflow_is_refused(self):
        with self.assertRaises(RecordError) as caught:
            store.scaled(pa.array(["1000000000000000"]), 8, "v")
        self.assertEqual(caught.exception.code, "SCALE_RANGE")

    def test_significant_decimals_ignore_trailing_zeros(self):
        self.assertEqual(store.significant_decimals(pa.array(["0.0010000", "12", "3.25"])), 3)

    def test_statements_hold_every_row(self):
        rows, _ = store.bar_rows(klines([(T0 + i * MINUTE, "1.5", "2", "1", "1.75", "3.1") for i in range(5)]),
                                 "ABCUSDT", "LAST")
        statements = list(store.insert_statements(rows, "ABCUSDT", "LAST"))
        self.assertEqual(len(statements), 1)
        self.assertEqual(statements[0].count(b"('ABCUSDT','LAST',"), 5)
        self.assertIn(f"('ABCUSDT','LAST',{T0},150000000,200000000,100000000,175000000,31000)".encode(),
                      statements[0])

    def test_inconsistent_bars_and_mark_volume_are_refused(self):
        with self.assertRaises(RecordError):
            store.bar_rows(klines([(T0, "2", "1.5", "1", "1.5", "0")]), "X", "LAST")
        with self.assertRaises(RecordError):
            store.bar_rows(klines([(T0, "1", "1", "1", "1", "2")]), "X", "MARK")


class ArchiveLookupTests(unittest.TestCase):
    def test_an_append_fetches_known_names_and_skips_missing_months(self):
        from market import binance

        class Cache:
            def __init__(self):
                self.asked = []

            def fetch(self, key):
                self.asked.append(key)
                if key.endswith("2026-10.zip"):
                    raise FileNotFoundError(key)
                return key

        cache = Cache()
        found = binance.monthly_archives(cache, "klines", "BTCUSDT", "1m", ["2026-09", "2026-10"])
        self.assertEqual(found, {"2026-09": "data/futures/um/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2026-09.zip"})
        self.assertEqual(len(cache.asked), 2)
        funding = binance.monthly_archives(cache, "fundingRate", "BTCUSDT", None, ["2026-09"])
        self.assertEqual(funding["2026-09"], "data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-09.zip")


class DerivationTests(unittest.TestCase):
    def test_open_high_low_skip_untraded_minutes(self):
        # ALGOUSDT 2025-10-26 21:10: the first minute did not trade and is filled at the prior close.
        bars = minutes([(T0, 1878, 1878, 1878, 1878, 0), (T0 + MINUTE, 1877, 1880, 1876, 1879, 10),
                        (T0 + 2 * MINUTE, 1879, 1879, 1879, 1879, 0), (T0 + 3 * MINUTE, 1879, 1881, 1878, 1880, 4),
                        (T0 + 4 * MINUTE, 1880, 1890, 1870, 1885, 0)])
        derived = export.derive(bars, "5m")
        self.assertEqual({name: derived[name].tolist() for name in export.COLUMNS},
                         {"ts_open": [T0], "open": [1877], "high": [1881], "low": [1876], "close": [1885],
                          "volume": [14]})

    def test_a_bucket_without_trades_uses_every_minute(self):
        bars = minutes([(T0, 5, 6, 4, 5, 0), (T0 + MINUTE, 5, 7, 3, 6, 0)])
        derived = export.derive(bars, "5m")
        self.assertEqual((derived["open"][0], derived["high"][0], derived["low"][0], derived["close"][0]), (5, 7, 3, 6))

    def test_weeks_start_monday_and_partial_buckets_keep_their_minutes(self):
        monday = 1_760_313_600_000  # 2025-10-13T00:00:00Z, a Monday
        bars = minutes([(monday - MINUTE, 1, 1, 1, 1, 1), (monday, 2, 2, 2, 2, 1),
                        (monday + 3 * 86_400_000, 3, 3, 3, 3, 1)])
        weekly = export.derive(bars, "1w")
        self.assertEqual(weekly["ts_open"].tolist(), [monday - 7 * 86_400_000, monday])
        self.assertEqual(weekly["close"].tolist(), [1, 3])
        hourly = export.derive(bars, "1h")
        self.assertEqual(len(hourly["ts_open"]), 3)

    def test_needed_decimals(self):
        self.assertEqual(export.needed_decimals(np.array([12_550_000_000, 100_000_000]), 8), 1)
        self.assertEqual(export.needed_decimals(np.array([123]), 8), 8)


class PoolTests(unittest.TestCase):
    @staticmethod
    def days(first: date, last: date, value: str = "1"):
        count = (last - first).days + 1
        return [(first + timedelta(days=i), Decimal(value)) for i in range(count)]

    def test_listing_age_eve_trading_and_rank(self):
        month = date(2021, 5, 1)
        volumes = {
            "OLDUSDT": self.days(date(2021, 1, 1), date(2021, 5, 3), "10"),
            "NEWUSDT": self.days(date(2021, 4, 5), date(2021, 5, 3), "99"),   # listed 26 days before
            "GONEUSDT": self.days(date(2021, 1, 1), date(2021, 4, 29), "50"),  # stopped before the eve
            "RELISTUSDT": self.days(date(2020, 6, 1), date(2021, 1, 31), "70") + self.days(
                date(2021, 4, 10), date(2021, 5, 3), "70"),                    # current run is 21 days
            "TIEUSDT": self.days(date(2021, 1, 1), date(2021, 5, 3), "10"),
        }
        self.assertEqual(universe.pool(volumes, month, month),
                         [(month, 1, "OLDUSDT", Decimal(300)), (month, 2, "TIEUSDT", Decimal(300))])

    def test_at_most_fifty(self):
        volumes = {f"C{i:03d}USDT": self.days(date(2021, 1, 1), date(2021, 2, 28), str(i)) for i in range(60)}
        pool = universe.pool(volumes, date(2021, 2, 1), date(2021, 2, 1))
        self.assertEqual(len(pool), 50)
        self.assertEqual(pool[0][2], "C059USDT")
        self.assertEqual(pool[-1][1:3], (50, "C010USDT"))

    def test_classification(self):
        info = {"symbols": [
            {"symbol": "BTCUSDT", "contractType": "PERPETUAL", "underlyingType": "COIN", "baseAsset": "BTC"},
            {"symbol": "BTCDOMUSDT", "contractType": "PERPETUAL", "underlyingType": "INDEX", "baseAsset": "BTCDOM"},
            {"symbol": "TSLAUSDT", "contractType": "TRADIFI_PERPETUAL", "underlyingType": "EQUITY", "baseAsset": "TSLA"},
            {"symbol": "USDCUSDT", "contractType": "PERPETUAL", "underlyingType": "COIN", "baseAsset": "USDC"},
        ]}
        split = universe.classify(["BTCUSDT", "BTCDOMUSDT", "TSLAUSDT", "USDCUSDT", "EOSUSDT", "FOOTBALLUSDT",
                                   "BTCUSDT_230331", "ETHBUSD"], info)
        self.assertEqual(split["eligible"], ["BTCUSDT", "EOSUSDT"])
        self.assertEqual(split["excluded"], {"BTCDOMUSDT": "index", "TSLAUSDT": "contract type TRADIFI_PERPETUAL",
                                             "USDCUSDT": "stablecoin", "FOOTBALLUSDT": "index"})


if __name__ == "__main__":
    unittest.main()
