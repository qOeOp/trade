"""The market rules that need no Dolt: sources against a stand-in exchange, stitching, gaps,
derivation and its check, exact scaling, the universe rule, native names, episode pieces and the
Catalog writers' refusals."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

import numpy as np
import pyarrow as pa

from market import export, instrument, read, series, sources, store, universe
from market.sources import MarketError
from tests.market.exchange import DAY, MINUTE, Exchange, day_ms, minutes, serving


T0 = day_ms(date(2025, 3, 1))
REAL_GET = sources._get  # the request function itself, before a test serves the stand-in exchange


def klines(rows):
    """Archive-shaped rows: (open_time, open, high, low, close, volume)."""
    return pa.table([pa.array([row[0] for row in rows], pa.int64()),
                     *(pa.array([row[i] for row in rows], pa.string()) for i in range(1, 6)),
                     pa.array([row[0] + MINUTE - 1 for row in rows], pa.int64())], schema=sources.KLINE_SCHEMA)


def bars(rows):
    return {name: np.array([row[i] for row in rows], np.int64) for i, name in enumerate(series.COLUMNS)}


class Refusals(unittest.TestCase):
    def refused(self, code: str, call, *args, **kwargs):
        with self.assertRaises(MarketError) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception


class SourceTests(Refusals):
    def setUp(self):
        self.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, self.cache, True)
        self.exchange = Exchange(server_time=T0)
        self.exchange.contract("BTCUSDT")
        self.exchange.klines("monthly", "LAST", "BTCUSDT", "2025-03", minutes(T0, T0 + 3 * MINUTE))
        serving_context = serving(self.exchange)
        serving_context.__enter__()
        self.addCleanup(serving_context.__exit__, None, None, None)

    def test_an_archive_is_checked_against_its_checksum_and_cached(self):
        key = f"{sources.UM}/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2025-03.zip"
        path = sources.fetch_archive(self.cache, key)
        self.assertEqual(path.read_bytes(), self.exchange.archives[key])
        asked = len(self.exchange.requests)
        self.assertEqual(sources.fetch_archive(self.cache, key), path)  # verified copy: no request
        self.assertEqual(len(self.exchange.requests), asked)
        path.write_bytes(b"corrupted copy")
        self.assertEqual(sources.fetch_archive(self.cache, key).read_bytes(), self.exchange.archives[key])
        good = self.exchange.archives[key]
        self.exchange.get = lambda url, **_: (b"0" * 64 + b"  x\n") if url.endswith(".CHECKSUM") else good
        with serving(self.exchange):
            shutil.rmtree(self.cache / sources.UM)
            self.refused("CHECKSUM_MISMATCH", sources.fetch_archive, self.cache, key)
        self.assertFalse((self.cache / key).exists())

    def test_unpublished_and_unreachable_sources_are_coded(self):
        self.refused("ARCHIVE_NOT_PUBLISHED", sources.fetch_archive, self.cache, f"{sources.UM}/monthly/x.zip")
        found = sources.monthly_archives(self.cache, "klines", "BTCUSDT", "1m", ["2025-02", "2025-03"])
        self.assertEqual(list(found), ["2025-03"])
        self.refused("SOURCE_SHAPE", sources.monthly_archives, self.cache, "fundingRate", "BTCUSDT", "1m", ["2025-03"])
        self.refused("SOURCE_SHAPE", sources.monthly_archives, self.cache, "klines", "BTC/USDT", "1m", ["2025-03"])
        self.refused("SOURCE_SHAPE", sources.monthly_archives, self.cache, "klines", "BTCUSDT", "1m", ["2025-3"])

    def test_http_answers_map_to_their_codes(self):
        """Through the real request path: 400 with Binance -1121 is an unknown contract, another 400 a
        malformed request, a lasting 503 unreachable."""
        class Answer:
            def __init__(self, status, body):
                self.status, self.body, self.headers, self.will_close = status, body, {}, False

            def read(self):
                return self.body

        class Connection:
            def __init__(self, answer):
                self.answer = answer

            def request(self, *_, **__):
                pass

            def getresponse(self):
                return self.answer
        cases = (("SOURCE_UNKNOWN_SYMBOL", Answer(400, b'{"code":-1121,"msg":"Invalid symbol."}')),
                 ("SOURCE_SHAPE", Answer(400, b'{"code":-1100,"msg":"Illegal characters found in parameter."}')),
                 ("SOURCE_UNREACHABLE", Answer(503, b"busy")))
        for code, answer in cases:
            with self.subTest(code=code), mock.patch.object(sources, "_connection", lambda host, a=answer: Connection(a)), \
                    mock.patch.object(sources.time, "sleep", lambda seconds: None):
                self.refused(code, REAL_GET, f"{sources.REST}/fapi/v1/klines?symbol=X", attempts=2)

    def test_rest_pages_return_closed_rows_and_refuse_unknown_contracts(self):
        rows = minutes(T0, T0 + 4000 * MINUTE)
        self.exchange.rest[("LAST", "BTCUSDT")] = rows
        found = sources.rest_klines("LAST", "BTCUSDT", "1m", T0, T0 + 3500 * MINUTE)
        self.assertEqual([row[0] for row in found], [row[0] for row in rows[:3500]])  # three pages
        self.assertEqual(sources.rest_klines("LAST", "BTCUSDT", "1m", T0, T0 + 10 * MINUTE, now_ms=T0 + 5 * MINUTE)[-1][0],
                         T0 + 4 * MINUTE)  # the minute still open at `now` is not returned
        self.refused("SOURCE_SHAPE", sources.rest_klines, "LAST", "BTCUSDT", "1m", T0 + 1, T0 + MINUTE)
        self.refused("SOURCE_SHAPE", sources.rest_klines, "LAST", "BTCUSDT", "3m", T0, T0 + MINUTE)
        self.refused("SOURCE_UNKNOWN_SYMBOL", sources.rest_klines, "MARK", "GONEUSDT", "1m", T0, T0 + MINUTE)
        self.exchange.funding["BTCUSDT"] = [(T0 + k * 8 * 3_600_000 + 3, "0.0001") for k in range(1500)]
        funding = sources.rest_funding("BTCUSDT", T0, T0 + 1200 * 8 * 3_600_000)
        self.assertEqual((len(funding), funding[0]), (1200, (T0 + 3, "0.0001")))
        self.refused("SOURCE_SHAPE", sources.rest_funding, "BTCUSDT", T0, T0)

    def test_exchange_info_terms_are_verbatim_and_complete(self):
        observed, listed = sources.rest_exchange_info()
        self.assertEqual(observed, T0 + 3_600_000)
        self.assertEqual({key: listed[0][key] for key in ("symbol", "price_increment", "size_increment",
                                                          "contract_type", "underlying_type")},
                         {"symbol": "BTCUSDT", "price_increment": "0.01", "size_increment": "0.001",
                          "contract_type": "PERPETUAL", "underlying_type": "COIN"})
        del self.exchange.info[0]["filters"]
        self.refused("SOURCE_SHAPE", sources.rest_exchange_info)


class StitchTests(Refusals):
    """Monthly, then daily archives, then public REST, one series without a visible seam."""

    def setUp(self):
        self.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, self.cache, True)
        self.exchange = Exchange(server_time=T0)
        self.exchange.contract("BTCUSDT")
        context = serving(self.exchange)
        context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)

    def test_monthly_daily_and_rest_fill_each_other_and_report_what_none_holds(self):
        march = minutes(T0, T0 + 3 * DAY)
        held = [row for row in march if not (T0 + DAY <= row[0] < T0 + 2 * DAY)]  # the monthly file lacks day 2
        self.exchange.klines("monthly", "LAST", "BTCUSDT", "2025-03", held)
        self.exchange.klines("daily", "LAST", "BTCUSDT", "2025-03-02",
                             [row for row in march if T0 + DAY <= row[0] < T0 + 2 * DAY - 10 * MINUTE])
        self.exchange.rest[("LAST", "BTCUSDT")] = [row for row in march if row[0] >= T0 + 2 * DAY - 5 * MINUTE]
        table, gaps, used = series.stitch_series(self.cache, "BTCUSDT", "LAST", T0, T0 + 3 * DAY, False, True)
        self.assertEqual(gaps, [(T0 + 2 * DAY - 10 * MINUTE, T0 + 2 * DAY - 5 * MINUTE)])
        self.assertEqual(used, {"monthly": 2 * 1440, "daily": 1430, "rest": 5})
        self.assertEqual(table["open_time"].to_pylist(), sorted(table["open_time"].to_pylist()))
        self.assertEqual(table.column_names, list(sources.COLUMNS))

    def test_a_contract_unknown_to_rest_has_nothing_more_once_it_stopped_trading(self):
        self.exchange.klines("monthly", "LAST", "GONEUSDT", "2025-03", minutes(T0, T0 + 10 * MINUTE))
        table, gaps, _ = series.stitch_series(self.cache, "GONEUSDT", "LAST", T0, T0 + DAY, False, False)
        self.assertEqual((table.num_rows, gaps), (10, []))
        self.refused("SOURCE_UNKNOWN_SYMBOL", series.stitch_series, self.cache, "GONEUSDT", "LAST", T0, T0 + DAY,
                     True, True)

    def test_conflicting_or_unclosed_minutes_and_unknown_price_types_refuse(self):
        first = klines([(T0, "1.0", "1.0", "1.0", "1.0", "5"), (T0 + MINUTE, "2", "2", "2", "2", "0")])
        tagged = series._tagged(first, 0)
        merged = series._merge([tagged, series._tagged(first.slice(1), 1)], 0, 1 << 62, "X")
        self.assertEqual(merged["open_time"].to_pylist(), [T0, T0 + MINUTE])
        conflict = klines([(T0 + MINUTE, "2", "3", "2", "2", "0")])
        self.refused("SOURCE_CONFLICT", series._merge, [tagged, series._tagged(conflict, 2)], 0, 1 << 62, "X")
        unclosed = first.set_column(6, "close_time", pa.array([T0 + 5 * MINUTE - 1, T0 + 2 * MINUTE - 1], pa.int64()))
        self.refused("SOURCE_SHAPE", series._merge, [series._tagged(unclosed, 0)], 0, 1 << 62, "X")
        self.refused("PRICE_TYPE_UNKNOWN", series.stitch_series, self.cache, "BTCUSDT", "INDEX", T0, T0 + DAY, False,
                     True)


class ShapeTests(Refusals):
    """An archive row outside its own period or off the minute grid refuses before any trimming."""

    def setUp(self):
        self.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, self.cache, True)
        self.exchange = Exchange(server_time=T0)
        context = serving(self.exchange)
        context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)

    def test_microsecond_rows_refuse(self):
        rows = [(r[0] * 1000, *r[1:6], r[6] * 1000 + 999, r[7]) for r in minutes(T0, T0 + 10 * MINUTE)]
        self.exchange.klines("monthly", "LAST", "OLDUSDT", "2025-03", rows)
        self.refused("SOURCE_SHAPE", series.stitch_series, self.cache, "OLDUSDT", "LAST", T0, T0 + DAY, False, False)

    def test_rows_of_another_period_refuse(self):
        self.exchange.klines("monthly", "LAST", "OLDUSDT", "2025-03", minutes(T0 - 5 * MINUTE, T0 + 5 * MINUTE))
        self.refused("SOURCE_SHAPE", series.stitch_series, self.cache, "OLDUSDT", "LAST", T0, T0 + DAY, False, False)
        self.exchange.klines("daily", "LAST", "NEWUSDT", "2025-03-02", minutes(T0, T0 + 5 * MINUTE))  # day 1's rows
        self.refused("SOURCE_SHAPE", series.stitch_series, self.cache, "NEWUSDT", "LAST", T0, T0 + 2 * DAY, False, True)

    def test_duplicates_agree_by_value_at_the_stored_scale(self):
        first = series._tagged(klines([(T0, "1.50", "1.5", "1.5", "1.5", "2.0")]), 0)
        same = series._tagged(klines([(T0, "1.5", "1.50000000", "1.5", "1.5", "2")]), 2)
        self.assertEqual(series._merge([first, same], 0, 1 << 62, "X").num_rows, 1)
        other = series._tagged(klines([(T0, "1.5", "1.5", "1.5", "1.50000001", "2")]), 2)
        self.refused("SOURCE_CONFLICT", series._merge, [first, other], 0, 1 << 62, "X")


class FundingSlotTests(Refusals):
    """One settlement per hour slot across sources: equal rates are one row, different ones conflict."""

    def setUp(self):
        self.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, self.cache, True)
        self.exchange = Exchange(server_time=T0)
        self.exchange.contract("BTCUSDT")
        context = serving(self.exchange)
        context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)
        self.feb = day_ms(date(2025, 2, 1))  # February has no archive: REST covers February and March

    def settle(self, rate_rest: str):
        hours = range(self.feb, T0 + DAY, 8 * 3_600_000)
        self.exchange.funding_month("BTCUSDT", "2025-03", [(at + 3, "0.0001") for at in hours if at >= T0])
        self.exchange.funding["BTCUSDT"] = [(at + 5, rate_rest) for at in hours]

    def test_jittered_times_of_one_settlement_are_one_row(self):
        self.settle("0.0001")
        found = store.funding(self.cache, "BTCUSDT", self.feb, T0 + DAY, trading=True)
        self.assertEqual(len(found), 28 * 3 + 3)
        self.assertEqual(found[-3:], [(T0 + 3, "0.0001"), (T0 + 8 * 3_600_000 + 3, "0.0001"),
                                      (T0 + 16 * 3_600_000 + 3, "0.0001")])  # the archive's times are kept

    def test_one_slot_with_two_rates_conflicts(self):
        self.settle("0.0002")
        self.refused("SOURCE_CONFLICT", store.funding, self.cache, "BTCUSDT", self.feb, T0 + DAY, trading=True)
        self.exchange.funding_month("ETHUSDT", "2025-03", [(T0 + 3, "0.0001"), (T0 + 600_000, "0.0001")])
        self.refused("SOURCE_SHAPE", store.funding, self.cache, "ETHUSDT", T0, T0 + DAY, trading=True)


class GapTests(Refusals):
    def test_missing_intervals_are_half_open_and_zero_volume_is_not_a_gap(self):
        times = np.array([T0, T0 + MINUTE, T0 + 4 * MINUTE])
        facts = series.missing_intervals(times, T0, T0 + 6 * MINUTE, MINUTE, np.array([0, 3, 0]))
        self.assertEqual(facts, {"intervals": [(T0 + 2 * MINUTE, T0 + 4 * MINUTE), (T0 + 5 * MINUTE, T0 + 6 * MINUTE)],
                                 "missing_count": 3, "present_count": 3, "first_ms": T0, "last_ms": T0 + 4 * MINUTE,
                                 "zero_volume_count": 2})
        self.assertEqual(series.missing_intervals(times, T0, T0, MINUTE)["intervals"], [])
        self.refused("GRID_MISALIGNED", series.missing_intervals, np.array([T0, T0 + 1]), T0, T0 + DAY, MINUTE)
        self.refused("GRID_MISALIGNED", series.missing_intervals, times, T0, T0 + DAY, MINUTE, np.array([1]))


class DerivationTests(Refusals):
    def test_open_high_low_skip_untraded_minutes(self):
        derived = series.derive_bars(bars([(T0, 1878, 1878, 1878, 1878, 0), (T0 + MINUTE, 1877, 1880, 1876, 1879, 10),
                                           (T0 + 2 * MINUTE, 1879, 1879, 1879, 1879, 0),
                                           (T0 + 3 * MINUTE, 1879, 1881, 1878, 1880, 4),
                                           (T0 + 4 * MINUTE, 1880, 1890, 1870, 1885, 0)]), "15m")
        self.assertEqual({name: derived[name].tolist() for name in series.COLUMNS},
                         {"ts_open": [T0], "open": [1877], "high": [1881], "low": [1876], "close": [1885],
                          "volume": [14]})

    def test_untraded_buckets_use_every_minute_and_weeks_start_monday(self):
        derived = series.derive_bars(bars([(T0, 5, 6, 4, 5, 0), (T0 + MINUTE, 5, 7, 3, 6, 0)]), "15m")
        self.assertEqual([derived[name][0] for name in ("open", "high", "low", "close")], [5, 7, 3, 6])
        monday = day_ms(date(2025, 10, 13))
        weekly = series.derive_bars(bars([(monday - MINUTE, 1, 1, 1, 1, 1), (monday, 2, 2, 2, 2, 1),
                                          (monday + 3 * DAY, 3, 3, 3, 3, 1)]), "1w")
        self.assertEqual((weekly["ts_open"].tolist(), weekly["close"].tolist()), ([monday - 7 * DAY, monday], [1, 3]))

    def test_derivation_refuses_unknown_timeframes_unsorted_input_and_overflow(self):
        self.refused("TIMEFRAME_UNKNOWN", series.derive_bars, bars([(T0, 1, 1, 1, 1, 1)]), "5m")
        self.refused("INPUT_UNSORTED", series.derive_bars, bars([(T0 + MINUTE, 1, 1, 1, 1, 1), (T0, 1, 1, 1, 1, 1)]),
                     "1h")
        big = np.iinfo(np.int64).max // 2 + 1
        self.refused("VOLUME_OVERFLOW", series.derive_bars, bars([(T0, 1, 1, 1, 1, big), (T0 + MINUTE, 1, 1, 1, 1, big)]),
                     "1h")

    def test_the_check_against_native_bars_reports_findings_without_changing_either(self):
        derived = bars([(T0, 100_000_000, 120_000_000, 90_000_000, 110_000_000, 50_000),
                        (T0 + DAY, 110_000_000, 110_000_000, 110_000_000, 110_000_000, 10_000)])
        native = bars([(T0, 100_000_001, 120_000_000, 90_000_000, 110_000_000, 50_000),
                       (T0 + 2 * DAY, 1, 1, 1, 1, 1)])
        found = series.check_derived(derived, native, "1d", 2, 3)  # the open differs below two decimals
        self.assertEqual([(item["ts_open"], item["kind"]) for item in found],
                         [(T0 + DAY, "bucket_only_derived"), (T0 + 2 * DAY, "bucket_only_native")])
        self.assertEqual(series.check_derived(derived, native, "1d", 8, 3)[0],
                         {"ts_open": T0, "kind": "value_mismatch", "field": "open", "derived_value": 100_000_000,
                          "native_value": 100_000_001})
        self.assertEqual(derived["open"][0], 100_000_000)  # neither side is changed
        self.refused("GRID_MISALIGNED", series.check_derived, bars([(T0 + MINUTE, 1, 1, 1, 1, 1)]), native, "1d", 2, 3)
        self.refused("PRECISION_INVALID", series.check_derived, derived, native, "1d", -1, 3)


class ScalingTests(Refusals):
    def test_exact_scaling_and_float_tails(self):
        values, rounded = store.scaled(pa.array(["0.1878", "126208.5", "0"]), 8, "p")
        self.assertEqual((values.tolist(), rounded), ([18_780_000, 12_620_850_000_000, 0], 0))
        values, rounded = store.scaled(pa.array(["108824285.69999999", "12.5"]), 4, "v", float_tails=True)
        self.assertEqual((values.tolist(), rounded), ([1_088_242_857_000, 125_000], 1))
        self.refused("SCALE_LOSS", store.scaled, pa.array(["0.123456789"]), 8, "p")
        self.refused("SCALE_LOSS", store.scaled, pa.array(["12.34567"]), 4, "v", float_tails=True)
        self.refused("SCALE_RANGE", store.scaled, pa.array(["1000000000000000"]), 8, "v")
        self.assertEqual(store.significant_decimals(pa.array(["0.0010000", "12", "3.25"])), 3)

    def test_inconsistent_bars_and_mark_volumes_refuse(self):
        self.refused("SOURCE_SHAPE", store.bar_rows, klines([(T0, "2", "1.5", "1", "1.5", "0")]), "X", "LAST")
        self.refused("SOURCE_SHAPE", store.bar_rows, klines([(T0, "1", "1", "1", "1", "3")]), "X", "MARK")
        self.assertEqual(store.bar_rows(klines([(T0, "1", "1", "1", "1", "0")]), "X", "MARK")[0]["volume"].tolist(), [0])


class UniverseTests(Refusals):
    RULE = universe.RULE

    def test_classification_reasons(self):
        def item(symbol, contract_type="PERPETUAL", underlying="COIN", base=None):
            return {"symbol": symbol, "contract_type": contract_type, "underlying_type": underlying,
                    "base_asset": base or symbol.removesuffix("USDT")}
        cases = {"BTCUSDT": (item("BTCUSDT"), None), "BTCDOMUSDT": (item("BTCDOMUSDT", underlying="INDEX"), "index"),
                 "XAUUSDT": (item("XAUUSDT", "TRADIFI_PERPETUAL", "COMMODITY"), "contract_type:TRADIFI_PERPETUAL"),
                 "OPENAIUSDT": (item("OPENAIUSDT", underlying="PREMARKET"), "underlying:PREMARKET"),
                 "USDCUSDT": (item("USDCUSDT"), "stablecoin"), "FOOTBALLUSDT": (None, "index"),
                 "FDUSDUSDT": (None, "stablecoin"), "EOSUSDT": (None, None),
                 "BTCUSDT_250328": (None, "not_usdt_perpetual"), "ETHBTC": (None, "not_usdt_perpetual")}
        for symbol, (given, reason) in cases.items():
            with self.subTest(symbol=symbol):
                found = universe.classify_contract(symbol, given, self.RULE)
                self.assertEqual((found["eligible"], found["reason"]), (reason is None, reason))
        self.refused("UNIVERSE_RULE_UNKNOWN", universe.classify_contract, "BTCUSDT", None, "usdt-perp-top50-30d-v1")
        self.refused("EXCHANGE_INFO_MALFORMED", universe.classify_contract, "BTCUSDT", item("ETHUSDT"), self.RULE)
        self.refused("EXCHANGE_INFO_MALFORMED", universe.classify_contract, "BTCUSDT", {"symbol": "BTCUSDT"}, self.RULE)

    @staticmethod
    def days(first: date, last: date) -> set[date]:
        return {first + timedelta(days=i) for i in range((last - first).days + 1)}

    def test_a_member_traded_the_eve_after_thirty_unbroken_days_and_stays_after_delisting(self):
        trading = {"OLDUSDT": self.days(date(2021, 1, 1), date(2021, 6, 3)),
                   "NEWUSDT": self.days(date(2021, 4, 5), date(2021, 6, 3)),       # 26 days before May
                   "GONEUSDT": self.days(date(2021, 1, 1), date(2021, 5, 10)),     # delisted in May
                   "RELISTUSDT": self.days(date(2020, 6, 1), date(2021, 1, 31)) | self.days(date(2021, 4, 10),
                                                                                           date(2021, 6, 3)),
                   "STABLEUSDT": self.days(date(2021, 1, 1), date(2021, 6, 3))}
        classes = [universe.classify_contract(symbol, None, self.RULE) for symbol in trading]
        classes[-1] = {"symbol": "STABLEUSDT", "eligible": False, "reason": "stablecoin"}
        rows = universe.monthly_universe(classes, trading, date(2021, 5, 1), date(2021, 6, 1), self.RULE)
        self.assertEqual(rows, [(date(2021, 5, 1), "GONEUSDT"), (date(2021, 5, 1), "OLDUSDT"),
                                (date(2021, 6, 1), "NEWUSDT"), (date(2021, 6, 1), "OLDUSDT"),
                                (date(2021, 6, 1), "RELISTUSDT")])
        self.refused("MONTH_NOT_FIRST_DAY", universe.monthly_universe, classes, trading, date(2021, 5, 2),
                     date(2021, 6, 1), self.RULE)
        self.refused("MONTH_NOT_FIRST_DAY", universe.monthly_universe, classes, trading, date(2021, 6, 1),
                     date(2021, 5, 1), self.RULE)
        self.refused("TRADING_DAYS_INSUFFICIENT", universe.monthly_universe, classes, trading, date(2020, 6, 1),
                     date(2021, 5, 1), self.RULE)

    def test_member_months_merge_into_intervals(self):
        paths = universe.merge_months([(date(2025, 12, 1), "A"), (date(2026, 1, 1), "A"), (date(2026, 3, 1), "A"),
                                       (date(2025, 12, 1), "B")])
        ns = universe._month_ns
        self.assertEqual(paths["A"], [[ns(date(2025, 12, 1)), ns(date(2026, 2, 1))],
                                      [ns(date(2026, 3, 1)), ns(date(2026, 4, 1))]])
        self.assertEqual(paths["B"], [[ns(date(2025, 12, 1)), ns(date(2026, 1, 1))]])
        self.assertEqual(ns(date(1970, 2, 1)), 31 * 86_400 * 10**9)


class NativeTests(Refusals):
    def test_native_names_number_episodes_and_spell_non_ascii_coins(self):
        self.assertEqual(export.native_symbol("BTCUSDT"), {"instrument_id": "BTCUSDT-PERP.BINANCE",
                                                           "strategy_tag": "BTC", "short_name": "BTC"})
        self.assertEqual(export.native_symbol("1000PEPEUSDT", 2)["instrument_id"], "1000PEPEUSDT-E2-PERP.BINANCE")
        self.assertEqual(export.native_symbol("1000PEPEUSDT")["short_name"], "PEPE")
        found = export.native_symbol("币安人生USDT")
        self.assertEqual(found["instrument_id"], "XE5B881E5AE89E4BABAE7949FUSDT-PERP.BINANCE")
        self.assertEqual(found["short_name"], "币安人生")
        self.refused("SYMBOL_SHAPE", export.native_symbol, "BTC-USDT")
        self.refused("SYMBOL_SHAPE", export.native_symbol, "ETHBTC")
        self.refused("EPISODE_INDEX", export.native_symbol, "BTCUSDT", 0)

    def test_episodes_split_a_reused_ticker_and_drop_half_minutes(self):
        def status(iid, action, at):
            return {"type": "InstrumentStatus", "instrument_id": iid, "action": action, "ts_event": at, "ts_init": at}
        first, second = "AIAUSDT-E1-PERP.BINANCE", "AIAUSDT-E2-PERP.BINANCE"
        ended = (T0 + 10 * MINUTE + 30_000) * 1_000_000  # mid-minute
        episodes = [{"instrument_id": first, "start_ns": T0 * 1_000_000, "events": [status(first, "CLOSE", ended)]},
                    {"instrument_id": second, "start_ns": (T0 + 20 * MINUTE) * 1_000_000, "events": []}]
        raw = {"last": bars([(T0 + i * MINUTE, 1, 1, 1, 1, 1) for i in range(30)]),
               "mark": bars([(T0 + i * MINUTE, 1, 1, 1, 1, 0) for i in range(30)]),
               "daily_source": bars([]), "funding": [(T0 + 5 * MINUTE, Decimal("0.0001")),
                                                     (T0 + 25 * MINUTE, Decimal("0.0002"))]}
        pieces = export.split_episodes("AIAUSDT", episodes, raw, T0 * 1_000_000, (T0 + DAY) * 1_000_000)
        self.assertEqual([(piece["index"], piece["catalog_dir"], len(piece["last"]["ts_open"]), len(piece["funding"]))
                          for piece in pieces], [(1, "episode-1", 10, 1), (2, "episode-2", 10, 1)])
        single = export.split_episodes("AIAUSDT", None, raw, 0, 1)
        self.assertEqual((single[0]["catalog_dir"], single[0]["instrument_id"]), ("", "AIAUSDT-PERP.BINANCE"))
        overlapping = [episodes[0], {**episodes[1], "start_ns": (T0 + 5 * MINUTE) * 1_000_000}]
        self.refused("EPISODE_ORDER", export.split_episodes, "AIAUSDT", overlapping, raw, 0, 1)
        self.refused("EPISODE_SHAPE", export.split_episodes, "AIAUSDT", [{**episodes[0], "instrument_id": second}],
                     raw, 0, 1)
        self.refused("EPISODE_SHAPE", export.split_episodes, "AIAUSDT", [{"instrument_id": first, "events": []}],
                     raw, 0, 1)


class WriterTests(Refusals):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="market-writers-"))
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_writers_refuse_unsorted_or_inexact_data(self):
        from nautilus_trader.model import InstrumentId
        from nautilus_trader.persistence import ParquetDataCatalog
        catalog = ParquetDataCatalog(str(self.root))
        iid = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
        backwards = bars([(T0 + MINUTE, 100, 100, 100, 100, 1), (T0, 100, 100, 100, 100, 1)])
        fine = bars([(T0, 1_000_000_000, 1_000_000_000, 1_000_000_000, 1_000_000_000, 10_000)])
        bar_type = f"{iid}-1-MINUTE-LAST-EXTERNAL"
        self.refused("BARS_UNSORTED", export.write_bars, catalog, bar_type, backwards, MINUTE, 2, 3, 8, 4)
        self.refused("BAR_RAW_INEXACT", export.write_bars, catalog, bar_type,
                     bars([(T0, 123_456_789, 123_456_789, 123_456_789, 123_456_789, 1)]), MINUTE, 2, 3, 8, 4)
        self.assertEqual(export.write_bars(catalog, bar_type, fine, MINUTE, 2, 3, 8, 4), 1)
        self.refused("MARK_UNSORTED", export.write_marks, catalog, iid, backwards, MINUTE, 8, 8)
        self.refused("MARK_INEXACT", export.write_marks, catalog, iid,
                     bars([(T0, 1, 1, 1, 123_456_789, 0)]), MINUTE, 2, 8)
        self.refused("FUNDING_UNSORTED", export.write_funding, self.root, str(iid),
                     [(T0, Decimal("0.0001")), (T0, Decimal("0.0001"))])
        self.refused("FUNDING_RATE_SHAPE", export.write_funding, self.root, str(iid), [(T0, "x")])
        self.refused("FUNDING_RATE_SHAPE", export.write_funding, self.root, str(iid), [(T0, Decimal("NaN"))])
        self.assertEqual(export.write_funding(self.root, str(iid), []), 0)

    def test_instruments_take_terms_widen_precision_only_and_settle_in_usdt(self):
        terms = {"symbol": "BTCUSDT", "observed_at": 1, "terms_source": "exchange_info", "price_increment": "0.10",
                 "size_increment": "0.001", "min_quantity": "0.001", "max_quantity": "1000", "min_notional": "50",
                 "min_price": "556.80", "max_price": "4529764"}
        made, record = instrument.build_instrument("BTCUSDT", terms, 3, "BTCUSDT-PERP.BINANCE")
        self.assertEqual((str(made.price_increment), made.price_precision, record["price_precision_widened"]),
                         ("0.001", 3, True))
        self.assertEqual(str(instrument.build_instrument("BTCUSDT", terms, 2, "BTCUSDT-PERP.BINANCE")[0].price_increment),
                         "0.10")
        self.refused("PRECISION_NARROWED", instrument.build_instrument, "BTCUSDT", terms, 1, "BTCUSDT-PERP.BINANCE")
        self.refused("TERMS_INVALID", instrument.build_instrument, "BTCUSDT", {**terms, "price_increment": "0"}, 2,
                     "BTCUSDT-PERP.BINANCE")
        self.refused("TERMS_INVALID", instrument.build_instrument, "BTCUSDT", {**terms, "min_price": "9999999"}, 2,
                     "BTCUSDT-PERP.BINANCE")
        self.refused("UNSUPPORTED_QUOTE", instrument.build_instrument, "BTCUSDC", terms, 2, "BTCUSDC-PERP.BINANCE")


class ReturnTests(unittest.TestCase):
    def test_the_basket_weighs_the_month_members_that_have_a_return(self):
        closes = {"BTCUSDT": {"2026-01-31": 100, "2026-02-01": 110, "2026-02-02": 99},
                  "AAA": {"2026-01-31": 10, "2026-02-01": 11},
                  "BBB": {"2026-01-31": 20, "2026-02-01": 18, "2026-02-02": 18}}
        found = read.returns_from(closes, {"2026-02": {"AAA", "BBB"}}, ["2026-02-01", "2026-02-02"])
        self.assertAlmostEqual(found["btc"][0], 0.1)
        self.assertAlmostEqual(found["btc"][1], -0.1)
        self.assertAlmostEqual(found["basket"][0], (0.1 - 0.1) / 2)
        self.assertEqual((found["basket"][1], found["members_per_day"]), (0.0, [2, 1]),
                         "AAA stopped trading: it drops out after its last return")


if __name__ == "__main__":
    unittest.main()
