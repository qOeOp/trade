"""A market directory imported month by month from a stand-in exchange: stitching, the universe rule, the
import's refusals, backfills, and its reads: freshness, membership, coverage, daily returns and a Catalog
export the engine streams whole."""

from __future__ import annotations

from datetime import date, datetime, timedelta, UTC
from decimal import Decimal
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq

from market import coverage, export, files, follow, history, instrument, lifecycle, read, series, sources, store, universe
from shared.errors import Refusal
from registration import inputs
from shared import clock
from tests.market.directory import directory, forged, read as rows
from tests.market.exchange import DAY, MINUTE, Exchange, day_ms, minutes, serving, worker_pool
from tests.helpers import assert_refused, refused, tempdir


JAN, FEB, MAR, APR = (date(2025, month, 1) for month in (1, 2, 3, 4))
LISTED = day_ms(date(2025, 1, 20))  # BBBUSDT's first minute
DELISTED = day_ms(date(2025, 2, 10))  # CCCUSDT's last minute ends here
EIGHT_HOURS = 8 * 3_600_000


def exchange() -> Exchange:
    """BTCUSDT trades throughout; BBBUSDT lists on 2025-01-20; CCCUSDT stops on 2025-02-10 and has left
    exchangeInfo; USDCUSDT (stablecoin) and BTCDOMUSDT (index) are listed. The March MARK archive lacks
    2025-03-15, which its daily archive holds."""
    found = Exchange(server_time=day_ms(FEB))  # terms observed then: every market day from January's last day reads them
    for symbol in ("BTCUSDT", "BBBUSDT", "USDCUSDT"):
        found.contract(symbol)
    found.contract("BTCDOMUSDT", underlying="INDEX")
    spans = {"BTCUSDT": (day_ms(JAN), day_ms(APR)), "BBBUSDT": (LISTED, day_ms(APR)),
             "CCCUSDT": (day_ms(JAN), DELISTED)}
    for symbol, (low, high) in spans.items():
        for month in (JAN, FEB, MAR):
            start, end = max(low, day_ms(month)), min(high, day_ms(clock.next_month(month)))
            if start >= end:
                continue
            period = f"{month:%Y-%m}"
            found.klines("monthly", "LAST", symbol, period, minutes(start, end))
            mark = minutes(start, end, mark=True)
            if symbol == "BTCUSDT" and month == MAR:
                gap = (day_ms(date(2025, 3, 15)), day_ms(date(2025, 3, 16)))
                found.klines("daily", "MARK", symbol, "2025-03-15", [row for row in mark if gap[0] <= row[0] < gap[1]])
                mark = [row for row in mark if not gap[0] <= row[0] < gap[1]]
            found.klines("monthly", "MARK", symbol, period, mark)
            found.funding_month(symbol, period, [(at + 3, "0.0001") for at in range(start, end, EIGHT_HOURS)])
        found.rest[("LAST1d", symbol)] = minutes(low, high)
    return found


def ns(day: date) -> int:
    return day_ms(day) * 1_000_000


class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.market = cls.profile = directory(cls.addClassCleanup)
        cls.cache = tempdir(cls.addClassCleanup, prefix="market-cache-")
        cls.exchange = exchange()
        cls.scope = ["BBBUSDT", "BTCDOMUSDT", "BTCUSDT", "CCCUSDT", "USDCUSDT"]
        with serving(cls.exchange):
            cls.results = {month: cls.imported(month) for month in (JAN, FEB, MAR)}
        cls.market_days = {month: result["market_day"] for month, result in cls.results.items()}

    @classmethod
    def imported(cls, month: date, scope=None) -> dict:
        return store.import_month(cls.market, month, cls.cache, 1, scope or cls.scope, log=lambda line: None)

    def test_the_first_import_starts_the_market_and_produces_no_universe(self):
        first = self.results[JAN]
        self.assertEqual(first["universe_members"], [])
        self.assertEqual(first["excluded"], {"BTCDOMUSDT": "index", "USDCUSDT": "stablecoin"})
        self.assertEqual(first["inferred_terms"], ["CCCUSDT"])
        self.assertEqual(first["rows"], 2 * (31 * 1440 + 12 * 1440 + 31 * 1440))
        self.assertEqual(first["derived_findings"], {})  # derived daily bars equal the exchange's
        assert_refused(self, "MARKET_EMPTY", read.freshness, self.profile, self.market_days[JAN])
        # Each month's last day waits for the next month's members, which these imports leave unwritten.
        self.assertEqual(self.market_days, {month: (clock.next_month(month) - timedelta(days=2)).isoformat()
                                        for month in (JAN, FEB, MAR)})
        root = Path(self.profile["root"])
        self.assertEqual(sorted(path.relative_to(root).as_posix() for path in root.rglob("*.parquet")),
                         ["bar/2025-01.parquet", "bar/2025-02.parquet", "bar/2025-03.parquet",
                          "funding/2025-01.parquet", "funding/2025-02.parquet", "funding/2025-03.parquet",
                          "instrument.parquet", "universe_month/2025-02.parquet", "universe_month/2025-03.parquet"])
        market = files.open_market(self.profile, "reader")
        self.assertEqual(files.bar_months_through(market), {JAN: FEB, FEB: MAR, MAR: APR})
        terms = {row["symbol"]: row["terms_source"]
                 for batch in files.read_table(market, date(2025, 1, 31).isoformat(), "instrument") for row in batch.to_pylist()}
        self.assertEqual(terms, {"BBBUSDT": "exchange_info", "BTCDOMUSDT": "exchange_info", "BTCUSDT": "exchange_info",
                                 "CCCUSDT": "inferred", "USDCUSDT": "exchange_info"})

    def test_a_contract_is_listed_from_the_first_day_of_its_run_into_its_first_month(self):
        """#3759: a line's veto years of named contracts start at their listing, not their first universe month."""
        market = files.open_market(self.profile, "reader")
        day = self.market_days[MAR]
        self.assertEqual([store.listed_day(market, day, symbol) for symbol in ("BBBUSDT", "CCCUSDT", "USDCUSDT")],
                         [date(2025, 1, 20), JAN, None])

    def test_members_need_thirty_unbroken_days_and_a_delisted_contract_keeps_its_months(self):
        self.assertEqual(self.results[FEB]["universe_members"], ["BTCUSDT", "CCCUSDT"])  # BBBUSDT: 12 days
        self.assertEqual(self.results[MAR]["universe_members"], ["BBBUSDT", "BTCUSDT"])  # CCCUSDT stopped
        market = files.open_market(self.profile, "reader")
        path = universe.membership_path(market, self.market_days[MAR], ns(APR))
        assert_refused(self, "UNIVERSE_NOT_COVERING_WINDOW", universe.membership_path, market, self.market_days[MAR],
                       ns(date(2025, 4, 2)))
        assert_refused(self, "UNIVERSE_EMPTY_AT_DAY", universe.membership_path, market, self.market_days[JAN], ns(FEB))
        assert_refused(self, "MARKET_DAY_UNRESOLVED", universe.membership_path, market, "main", ns(FEB))
        assert_refused(self, "MARKET_DAY_UNRESOLVED", universe.membership_path, market, self.market_days[MAR][:7],
                       ns(FEB))  # a month, no day
        self.assertEqual(universe.membership_path(market, self.market_days[FEB], ns(MAR))["membership"],
                         {"BTCUSDT": [[ns(FEB), ns(MAR)]], "CCCUSDT": [[ns(FEB), ns(MAR)]]})
        self.assertEqual(path["universe_rule"], universe.RULE)
        self.assertEqual(path["membership"], {"BTCUSDT": [[ns(FEB), ns(APR)]], "CCCUSDT": [[ns(FEB), ns(MAR)]],
                                              "BBBUSDT": [[ns(MAR), ns(APR)]]})

    def test_a_month_missing_from_its_monthly_archive_comes_from_the_daily_archive(self):
        third = self.results[MAR]
        self.assertEqual(third["gaps"], {})
        self.assertEqual(third["source_rows"], {"monthly": third["rows"] - 1440, "daily": 1440, "rest": 0})
        self.assertEqual(third["per_symbol"]["BTCUSDT"]["bars"], {"LAST": 31 * 1440, "MARK": 31 * 1440})

    def test_freshness_reads_the_market_day(self):
        fresh = read.freshness(self.profile)
        self.assertEqual(fresh, {"market_day": self.market_days[MAR], "universe_months": ["2025-02", "2025-03"],
                                 "latest_complete_day": date(2025, 3, 30)})
        self.assertEqual(read.freshness(self.profile, self.market_days[FEB])["latest_complete_day"], date(2025, 2, 27))

    def test_months_import_once_and_in_order(self):
        with serving(self.exchange):
            assert_refused(self, "MONTH_EXISTS", self.imported, MAR)
            assert_refused(self, "MONTH_INVALID", self.imported, date(2025, 5, 1))
            assert_refused(self, "MONTH_INVALID", self.imported, date(2099, 1, 1))
            assert_refused(self, "MONTH_INVALID", self.imported, date(2025, 4, 2))
            assert_refused(self, "EMPTY_SYMBOLS", self.imported, APR, scope=["BTCUSDT", "BTCUSDT"])

    def test_coverage_facts_and_their_refusals(self):
        found = coverage.diagnose_coverage(self.profile, None, ["BBBUSDT", "CCCUSDT"], "2025-02-09T00:00:00Z",
                                           "2025-02-11T00:00:00Z", None)
        bbb, ccc = found["coverage"]
        self.assertEqual((bbb["last"]["missing_minutes"], bbb["member_months"]), (0, ["2025-03-01"]))
        self.assertEqual(ccc["last"]["gap_intervals_ms"], [[DELISTED, DELISTED + DAY]])
        self.assertEqual(ccc["listing_delisting"]["data_bounds_proxy"]["last"],
                         {"first_open_ms": day_ms(JAN), "last_open_ms": DELISTED - MINUTE})
        settled = day_ms(date(2025, 2, 9)) + 3
        self.assertEqual(ccc["funding"], {"rows": 3, "first_ms": settled, "last_ms": settled + 2 * EIGHT_HOURS,
                                          "spacing": [{"spacing_ms": EIGHT_HOURS, "from_ms": settled,
                                                       "to_ms": settled + 2 * EIGHT_HOURS}],
                                          "missing_settlements": []})
        self.assertEqual(bbb["quotes"], {"months": [], "first_ms": None, "last_ms": None,
                                         "uncovered_intervals_ms": [[day_ms(date(2025, 2, 9)), DELISTED + DAY]]})
        terms = {key: value for key, value in bbb["terms"].items() if key != "observed_at"}
        self.assertEqual(terms, {"terms_source": "exchange_info", "price_increment": "0.01", "size_increment": "0.001",
                                 "min_quantity": "0.001", "max_quantity": "1000", "min_notional": "5",
                                 "min_price": "0.01", "max_price": "1000000"})
        market = files.open_market(self.profile, "reader")  # the row an export of the market day trades on
        self.assertEqual(bbb["terms"]["observed_at"], instrument.terms(market, found["market_day"], "BBBUSDT")["observed_at"])
        self.assertEqual((ccc["terms"]["terms_source"], ccc["terms"]["min_notional"]), ("inferred", None))
        market_day, empty = self.market_days[MAR], {"ts_open": [], "volume": []}
        assert_refused(self, "INTERVAL_INVALID", coverage.coverage_facts, market_day, "BTCUSDT", 1, 2, empty,
                       empty, [], {}, [])
        assert_refused(self, "MARKET_DAY_UNRESOLVED", coverage.coverage_facts, "head", "BTCUSDT", 0, MINUTE,
                       empty, empty, [], {}, [])
        assert_refused(self, "UNKNOWN_SYMBOL", coverage.diagnose_coverage, self.profile, None, ["ZZZUSDT"],
                       "2025-02-09T00:00:00Z", "2025-02-11T00:00:00Z", None)
        assert_refused(self, "SOURCE_SHAPE", coverage.coverage_facts, market_day, "BTCUSDT", 0, 3 * MINUTE,
                       {"ts_open": [MINUTE, 0], "volume": [1, 1]}, empty, [], {}, [])
        assert_refused(self, "EMPTY_SYMBOLS", coverage.diagnose_coverage, self.profile, None, [],
                       "2025-02-09T00:00:00Z", "2025-02-11T00:00:00Z", None)
        assert_refused(self, "INTERVAL_INVALID", coverage.diagnose_coverage, self.profile, None, ["BTCUSDT"],
                       "2025-02-09T00:00:00", "2025-02-11T00:00:00Z", None)

    def test_coverage_reads_each_bar_file_once_and_folds_the_months_to_the_whole_read(self):
        start, end, symbols = day_ms(date(2025, 1, 15)), day_ms(date(2025, 3, 20)), ["BTCUSDT", "BBBUSDT", "CCCUSDT"]
        source, read_files = files.file_source, []

        def reading(market, entry):
            read_files.append(entry.relative)
            return source(market, entry)
        with patch.object(files, "file_source", reading), \
                patch.object(coverage, "read_series", side_effect=AssertionError("a read per contract")):
            found = coverage.diagnose_coverage(self.profile, None, symbols, "2025-01-15T00:00:00Z",
                                               "2025-03-20T00:00:00Z", None)
        self.assertEqual(sorted(read_files), ["bar/2025-01.parquet", "bar/2025-02.parquet", "bar/2025-03.parquet"])
        market, at = files.open_market(self.profile, "reader"), found["market_day"]
        stored = history.contract_history(market, at, {symbol: [(0, None)] for symbol in symbols}, start, end)
        for facts in found["coverage"]:
            symbol = facts["symbol"]
            whole = coverage.coverage_facts(
                at, symbol, start, end, coverage.read_bars(market, at, symbol, "LAST", start, end),
                coverage.read_bars(market, at, symbol, "MARK", start, end),
                coverage.read_funding(market, at, symbol, start, end), stored[symbol]["edges"],
                [month for month, member in universe.months_of(market, at) if member == symbol])
            self.assertEqual({**{key: facts[key] for key in whole},
                              "funding": {key: facts["funding"][key] for key in whole["funding"]}}, whole)
        self.assertEqual([facts["last"]["gap_intervals_ms"] for facts in found["coverage"]],
                         [[], [[start, LISTED]], [[DELISTED, end]]])

    def test_coverage_of_a_market_day_folds_a_gap_over_a_month_start_and_one_sided_minutes(self):
        low, high = day_ms(JAN), day_ms(FEB)
        rows_ = [(symbol, kind, at) for symbol, kind, opens in (
            ("AUSDT", "LAST", [low, high - 2 * MINUTE, high + MINUTE, high + 2 * MINUTE]),
            ("AUSDT", "MARK", [low, high - MINUTE, high + MINUTE]), ("BUSDT", "MARK", [high]),
            ("CUSDT", "LAST", [low - MINUTE])) for at in opens]

        def batches(reversed_=False):
            for month in (low - MINUTE, low, high):
                inside = [row for row in rows_ if clock.ms_day(row[2]).replace(day=1) == clock.ms_day(month).replace(day=1)]
                yield pa.RecordBatch.from_pylist([{"symbol": symbol, "price_type": kind, "ts_open": at, "open": 1, "high": 1,
                                                   "low": 1, "close": 1, "volume": int(at == low)}
                                                  for symbol, kind, at in (inside[::-1] if reversed_ else inside)],
                                                 files.BAR.schema)
        root = tempdir(self.addCleanup, prefix="market-coverage-")
        (root / "bar").mkdir()

        def write(reversed_=False):
            for name, batch in zip(("2024-12", "2025-01", "2025-02"), batches(reversed_), strict=True):
                pq.write_table(pa.Table.from_batches([batch]), root / "bar" / f"{name}.parquet", row_group_size=2)
        write()
        market = files.open_market({"root": str(root)}, "reader")
        found = coverage._bar_facts(market, "2025-02-27", ["AUSDT", "BUSDT", "CUSDT", "DUSDT"], low, high + 3 * MINUTE)
        bars, edges = found["AUSDT"]
        facts = bars.facts()
        self.assertEqual(facts["last"], {
            "rows": 4, "first_open_ms": low, "last_open_ms": high + 2 * MINUTE, "missing_minutes": 31 * 1440 - 1,
            "gap_intervals_ms": [[low + MINUTE, high - 2 * MINUTE], [high - MINUTE, high + MINUTE]],
            "zero_volume_minutes": 3})
        self.assertEqual(facts["mark"]["gap_intervals_ms"], [[low + MINUTE, high - MINUTE], [high, high + MINUTE],
                                                            [high + 2 * MINUTE, high + 3 * MINUTE]])
        self.assertEqual(facts["last_mark_unmatched_minutes"], 3)
        self.assertEqual(edges, {"LAST": (low, high + 2 * MINUTE), "MARK": (low, high + MINUTE)})
        self.assertEqual(found["BUSDT"][1], {"LAST": (None, None), "MARK": (high, high)})
        self.assertEqual(found["CUSDT"][1], {"LAST": (low - MINUTE, low - MINUTE), "MARK": (None, None)})
        self.assertEqual(found["DUSDT"][0].facts()["last"]["gap_intervals_ms"], [[low, high + 3 * MINUTE]])
        write(reversed_=True)  # no such file is written (files.write_file): the series of one are not single runs
        assert_refused(self, "SERIES_UNSORTED", coverage._bar_facts, market, "2025-02-27", ["AUSDT", "BUSDT"], low, high + MINUTE)

    def test_daily_returns_of_btc_and_the_equal_weight_universe(self):
        found = read.daily_returns(self.profile, self.market_days[MAR], universe.RULE,
                                   datetime(2025, 3, 2, tzinfo=UTC), datetime(2025, 3, 4, tzinfo=UTC))
        self.assertEqual(found["days"], ["2025-03-02", "2025-03-03"])
        self.assertEqual(found["btc"], found["basket"])  # both members walk the same prices
        assert_refused(self, "MARKET_RETURNS_WINDOW", read.daily_returns, self.profile, self.market_days[MAR],
                       universe.RULE, datetime(2025, 3, 2, 5, tzinfo=UTC), datetime(2025, 3, 2, 9, tzinfo=UTC))
        assert_refused(self, "RULE_VERSION_MISMATCH", read.daily_returns, self.profile, self.market_days[MAR],
                       "other-v1", datetime(2025, 3, 2, tzinfo=UTC), datetime(2025, 3, 4, tzinfo=UTC))

    def test_stored_bars_are_the_exporters_reads_at_the_pinned_market_day_with_their_catalog_times(self):
        market_day, day = self.market_days[MAR], day_ms(date(2025, 3, 2))
        found = read.stored_bars(self.profile, market_day, "BTCUSDT", "MARK", "1m", "2025-03-02T00:00:00Z",
                                 "2025-03-02T00:05:00Z", 3)
        price = f"{100 + (day // MINUTE) % 997 / 100:.2f}345678"
        self.assertEqual((found["market_day"], found["bars"]["count"], found["next_start"]),
                         (market_day, 3, "2025-03-02T00:03:00Z"))
        self.assertEqual(found["bars"]["rows"][0], [day, day + MINUTE - 1, price, price, price, price, "0.0000"])
        whole = read.stored_bars(self.profile, market_day, "BTCUSDT", "LAST", "1m", "2025-03-02T00:00:00Z",
                                 "2025-03-03T00:00:00Z", None)
        market = files.open_market(self.profile, "reader")
        minutes_ = coverage.read_bars(market, market_day, "BTCUSDT", "LAST", day, day + DAY)
        daily = history.daily_bars(market, market_day, "BTCUSDT", 0, None, day + DAY)
        self.assertEqual(([row[0] for row in whole["bars"]["rows"]], whole["next_start"]),
                         (minutes_["ts_open"].tolist(), None))
        self.assertEqual(whole["funding"]["rows"], [[day + 3 + EIGHT_HOURS * k, "0.0001"] for k in range(3)])
        with patch.object(coverage, "read_funding", side_effect=AssertionError("CF-24: bars alone read no funding")):
            bars = read.stored_bars(self.profile, market_day, "BTCUSDT", "LAST", "1m", "2025-03-02T00:00:00Z",
                                    "2025-03-03T00:00:00Z", None, funding=False)
        self.assertEqual((bars["bars"], "funding" in bars), (whole["bars"], False))
        days = read.stored_bars(self.profile, market_day, "BTCUSDT", "LAST", "1d", "2025-03-01T00:00:00Z",
                                "2025-03-03T00:00:00Z", None)
        self.assertEqual([[row[0], row[1], row[5]] for row in days["bars"]["rows"]],
                         [[opened, opened + DAY - 1, f"{close / 10**series.PRICE_SCALE:.8f}"]
                          for opened, close in zip(daily["ts_open"][-2:].tolist(), daily["close"][-2:].tolist(), strict=True)],
                         "the Catalog's daily LAST bars, each stamped on its close")
        earlier = read.stored_bars(self.profile, self.market_days[FEB], "BTCUSDT", "LAST", "1m", "2025-03-02T00:00:00Z",
                                   "2025-03-02T00:05:00Z", None)
        self.assertEqual((earlier["bars"]["count"], earlier["funding"]["count"]), (0, 0))
        window = ("2025-03-02T00:00:00Z", "2025-03-03T00:00:00Z")
        assert_refused(self, "INTERVAL_INVALID", read.stored_bars, self.profile, market_day, "BTCUSDT", "LAST", "1d",
                       "2025-03-02T06:00:00Z", window[1], None)
        assert_refused(self, "INTERVAL_INVALID", read.stored_bars, self.profile, market_day, "BTCUSDT", "MARK", "1d",
                       *window, None)
        assert_refused(self, "UNKNOWN_SYMBOL", read.stored_bars, self.profile, market_day, "ZZZUSDT", "LAST", "1m",
                       *window, None)
        assert_refused(self, "MARKET_DAY_UNRESOLVED", read.stored_bars, self.profile, "no-such-ref", "BTCUSDT", "LAST",
                       "1m", *window, None)

    def test_an_export_is_renamed_into_place_whole_so_a_failure_or_a_second_writer_keeps_what_is_there(self):
        start, end = ns(MAR), ns(date(2025, 3, 2))
        root = tempdir(self.addCleanup, prefix="market-export-test-")
        job = {"profile": self.profile, "market_day": self.market_days[MAR], "symbol": "BTCUSDT", "start_ns": start,
               "end_ns": end, "path": str(root / "market_day" / "key" / "BTCUSDT"), "include_quotes": False}
        target = Path(job["path"])
        first = export.export_episode(job)
        held = {path.relative_to(target): path.read_bytes() for path in target.rglob("*") if path.is_file()}
        failing = patch.object(export, "write_funding", side_effect=RuntimeError("disk full"))
        with failing, self.assertRaises(RuntimeError):
            export.export_episode(job)
        self.assertEqual({path.relative_to(target): path.read_bytes() for path in target.rglob("*") if path.is_file()},
                         held, "a failed export leaves the directory it would have replaced")
        write_funding = export.write_funding

        def meanwhile(*args):  # a second process of the same key, which found no receipt a moment before
            self.assertEqual(export.complete(target), first, "the first writer's export stays readable")
            return write_funding(*args)

        with patch.object(export, "write_funding", side_effect=meanwhile):
            self.assertEqual(export.export_episode(job), first)
        self.assertEqual(sorted(path.name for path in (root / "market_day").iterdir()), ["key"], "no work directory is left")
        self.assertEqual([path.name for path in (root / "market_day" / "key").iterdir()], ["BTCUSDT"])

    def test_a_cached_export_reads_no_bar_file_and_one_missed_reads_each_once(self):
        start, end, day, scope = ns(FEB), ns(date(2025, 2, 15)), self.market_days[MAR], ["CCCUSDT", "BTCUSDT"]
        root = tempdir(self.addCleanup, prefix="market-export-test-")
        done = export.export_catalogs(self.profile, day, scope, start, end, root=root)
        self.assertIsNotNone(done["receipts"]["CCCUSDT"]["pieces"][0]["episode"])
        with patch.object(history, "data_end_stops", side_effect=AssertionError("bars read on a cache hit")), \
                patch.object(universe, "months_of", side_effect=AssertionError("members read on a cache hit")):
            again = export.export_catalogs(self.profile, day, scope, start, end, root=root)
            self.assertEqual((again["cached"], again["receipts"]), (2, done["receipts"]))
        market = files.open_market(self.profile, "reader")
        job = {"profile": self.profile, "market_day": day, "symbol": "BTCUSDT", "start_ns": start, "end_ns": end,
               "path": str(root / "one" / "BTCUSDT"), "include_quotes": False, "months": [FEB, MAR],
               "history": history.contract_history(market, day, {"BTCUSDT": [(0, None)]}, start // 10**6,
                                                   end // 10**6)["BTCUSDT"]}
        read, batches = [], files.file_batches

        def reading(data, table, *args, **kwargs):
            read.append(table)
            return batches(data, table, *args, **kwargs)
        with patch.object(files, "file_batches", reading):
            self.assertEqual(export.export_episode(job), done["receipts"]["BTCUSDT"])
        self.assertEqual((read.count(files.BAR), read.count(files.UNIVERSE_MONTH)), (1, 0))

    def test_the_cache_key_covers_whole_bar_months_after_the_window_but_not_the_one_the_market_day_is_inside(self):
        root = tempdir(self.addCleanup, prefix="market-export-key-")
        (root / "bar").mkdir()
        market = files.open_market({"root": str(root)}, "reader")
        for month in ("2025-01", "2025-02", "2025-03", "2025-04"):
            (root / "bar" / f"{month}.parquet").touch()

        def changed(month: str, market_day: str, end: date) -> bool:
            before = export.files_read(market, market_day, ["BTCUSDT"], day_ms(end), ())
            path = root / "bar" / f"{month}.parquet"
            path.write_bytes(path.read_bytes() + b".")
            return export.files_read(market, market_day, ["BTCUSDT"], day_ms(end), ()) != before
        for expected, *case in ((True, "2025-01", "2025-03-20", FEB), (True, "2025-02", "2025-03-20", FEB),
                                (False, "2025-03", "2025-03-20", FEB), (True, "2025-03", "2025-03-31", FEB),
                                (True, "2025-03", "2025-03-20", date(2025, 3, 2)), (False, "2025-04", "2025-03-31", FEB)):
            with self.subTest(case=case):
                self.assertEqual(changed(*case), expected)

    def test_an_export_loads_whole_into_the_engine_stream(self):
        from engine import run
        from engine.load import read_market
        start, end = ns(MAR), ns(date(2025, 3, 3))
        root = tempdir(self.addCleanup, prefix="market-export-test-")
        done = export.export_catalogs(self.profile, None, ["BTCUSDT"], start, end, root=root)
        receipt = done["receipts"]["BTCUSDT"]
        piece, = receipt["pieces"]
        self.assertEqual(piece["counts"], {"last": 2880, "mark": 2880, "quote": 0, "funding": 6, "daily": 61,
                                           "instrument_close": 0, "instrument_status": 0})
        self.assertEqual((piece["instrument_id"], piece["catalog_dir"], piece["price_precision"],
                          piece["mark_precision"], receipt["timeframe"]), ("BTCUSDT-PERP.BINANCE", "", 2, 8, "1m"))
        self.assertEqual(receipt["coverage"]["member_months"], ["2025-02-01", "2025-03-01"])
        funding = receipt["coverage"]["funding"]
        self.assertEqual(funding, {"rows": 6, "first_ms": day_ms(MAR) + 3, "last_ms": day_ms(MAR) + 5 * EIGHT_HOURS + 3},
                         "the stored receipt counts the settlements; their times stay in the pinned market day")
        again = export.export_catalogs(self.profile, None, ["BTCUSDT"], start, end, root=root)
        self.assertEqual((again["exported"], again["cached"]), (0, 1))
        with patch.object(export, "exporter_sha256", lambda: "f" * 64):  # another exporter never reuses it
            self.assertEqual(export.export_catalogs(self.profile, None, ["BTCUSDT"], start, end, root=root)["exported"], 1)
        stored = Path(self.profile["root"]) / "bar" / "2025-03.parquet"
        moment = stored.stat().st_mtime_ns
        self.addCleanup(os.utime, stored, ns=(moment, moment))
        os.utime(stored, ns=(moment + 1, moment + 1))  # a file read changed since: filling a month changes what a market day holds
        self.assertEqual(export.export_catalogs(self.profile, None, ["BTCUSDT"], start, end, root=root)["exported"], 1)
        os.utime(stored, ns=(moment, moment))
        market = files.open_market(self.profile, "reader")  # streamed file by file, the same daily bars
        whole = coverage.read_bars(market, self.market_days[MAR], "BTCUSDT", "LAST", 0, end // 10**6)
        streamed = history.daily_bars(market, self.market_days[MAR], "BTCUSDT", 0, None, end // 10**6)
        derived = series.derive_bars(whole)
        keep = derived["ts_open"] + DAY <= end // 10**6
        self.assertEqual({k: v.tolist() for k, v in streamed.items()}, {k: v[keep].tolist() for k, v in derived.items()})
        rows = read_market(Path(done["root"]), ["BTCUSDT"], self.market_days[MAR], start, end)
        streamed = list(run.market_events(rows, start, end))
        self.assertEqual(len(streamed), 2880 + 2880 + 6)  # the daily warm-up bars are not streamed
        self.assertEqual([type(event).__name__ for event in streamed].count("FundingRateUpdate"), 6)
        first_mark = next(event for event in streamed if type(event).__name__ == "MarkPriceUpdate")
        self.assertEqual(str(first_mark.value), f"{100 + (day_ms(MAR) // MINUTE) % 997 / 100:.2f}345678")
        self.assertEqual(run.mark_timestamps(rows), 2880)
        self.assertRaises(Refusal, export.export_catalogs, self.profile, None, ["BTCUSDT"], start + 1, end)
        for code, args in (("INTERVAL_INVALID", (["BTCUSDT"], end, start)), ("EMPTY_SYMBOLS", (["BTCUSDT", "BTCUSDT"], start,
                                                                                                end))):
            with self.subTest(code=code):
                assert_refused(self, code, export.export_catalogs, self.profile, None, *args)
        assert_refused(self, "MARKET_DAY_UNRESOLVED", export.export_catalogs, self.profile, "no-such-ref", ["BTCUSDT"],
                       start, end)
        assert_refused(self, "UNKNOWN_SYMBOL", export.export_catalogs, self.profile, None, ["ZZZUSDT"], start, end,
                       fresh=True, root=root)

    def test_a_lifecycle_episode_becomes_a_numbered_native_contract_with_its_events(self):
        from engine import run
        from engine.load import read_market
        iid = "CCCUSDT-E1-PERP.BINANCE"

        def status(action, at):
            return {"type": "InstrumentStatus", "instrument_id": iid, "action": action, "ts_event": at, "ts_init": at,
                    "reason": "delisting", "trading_event": None, "is_trading": None, "is_quoting": None,
                    "is_short_sell_restricted": None}
        closed = DELISTED * 1_000_000
        body = {"format": lifecycle.FORMAT, "market_day": self.market_days[MAR], "episodes": [
            {"symbol": "CCCUSDT", "instrument_id": iid, "start_ns": 0, "sources": ["notice.txt"],
             "events": [status("PRE_CLOSE", closed - 3_600_000_000_000), status("CLOSE", closed),
                        {"type": "InstrumentClose", "instrument_id": iid, "close_price": "100.01",
                         "close_type": "CONTRACT_EXPIRED", "ts_event": closed, "ts_init": closed}]}]}
        files = {"lifecycle.json": json.dumps(body).encode(), "notice.txt": b"the exchange notice"}
        episodes = lifecycle.validate_lifecycle(body, self.market_days[MAR], files)
        start, end = ns(FEB), ns(date(2025, 2, 15))
        done = export.export_catalogs(self.profile, self.market_days[MAR], ["CCCUSDT"], start, end, episodes, files,
                                      fresh=True)
        self.addCleanup(shutil.rmtree, done["root"], True)
        piece, = done["receipts"]["CCCUSDT"]["pieces"]
        self.assertEqual((piece["index"], piece["catalog_dir"], piece["instrument_id"]), (1, "episode-1", iid))
        self.assertEqual({key: piece["counts"][key] for key in ("last", "mark", "funding", "instrument_close",
                                                                "instrument_status")},
                         {"last": 9 * 1440, "mark": 9 * 1440, "funding": 27, "instrument_close": 1,
                          "instrument_status": 2})
        self.assertEqual(piece["missing_minutes"], 0)
        self.assertEqual((Path(done["root"]) / "lifecycle-evidence" / "notice.txt").read_bytes(), b"the exchange notice")
        rows = read_market(Path(done["root"]), ["CCCUSDT"], self.market_days[MAR], start, end)
        self.assertEqual((rows[0]["coin"], rows[0]["strategy_id"]), ("CCC_E1", "R1-CCC_E1"))
        tail = [(type(event).__name__, getattr(event, "action", None) and event.action.name)
                for event in list(run.market_events(rows, start, end))[-2:]]
        self.assertEqual(tail, [("InstrumentStatus", "CLOSE"), ("InstrumentClose", None)])
        relisted = {**body["episodes"][0], "instrument_id": "CCCUSDT-E2-PERP.BINANCE", "events": []}
        for wrong in ({**body, "market_day": self.market_days[FEB]},
                      {**body, "episodes": [{**body["episodes"][0], "sources": ["absent.txt"]}]},
                      {**body, "episodes": [{**body["episodes"][0], "events": body["episodes"][0]["events"][2:]}]},
                      {**body, "episodes": [{**body["episodes"][0], "events": [status("CLOSE", 0)]}, relisted]},
                      {**body, "episodes": [*body["episodes"], {**relisted, "start_ns": "100"}]},
                      {**body, "episodes": [*body["episodes"], "CCCUSDT"]}):
            with self.subTest(wrong=wrong):
                assert_refused(self, "LIFECYCLE_INPUT", lifecycle.validate_lifecycle, wrong, self.market_days[MAR],
                               files)
        off_grid = {**body, "episodes": [{**body["episodes"][0], "events": [
            *body["episodes"][0]["events"][:2], {**body["episodes"][0]["events"][2], "close_price": "100.015"}]}]}
        root = tempdir(self.addCleanup, prefix="market-export-test-")
        assert_refused(self, "LIFECYCLE_INPUT", export.export_catalogs, self.profile, self.market_days[MAR],
                       ["CCCUSDT"], start, end, lifecycle.validate_lifecycle(off_grid, self.market_days[MAR], files),
                       files, True, root)
        self.assertEqual(list(root.iterdir()), [])  # the failed fresh export left nothing behind

    def test_a_contract_whose_trades_stopped_ends_there_without_a_bundle(self):
        from engine import run
        from engine.load import derived_instruments, read_market
        day, iid = self.market_days[MAR], "CCCUSDT-PERP.BINANCE"
        start, end = ns(FEB), ns(date(2025, 2, 15))
        done = export.export_catalogs(self.profile, day, ["CCCUSDT", "BTCUSDT"], start, end, fresh=True)
        self.addCleanup(shutil.rmtree, done["root"], True)
        piece, = done["receipts"]["CCCUSDT"]["pieces"]
        self.assertEqual((piece["index"], piece["catalog_dir"], piece["instrument_id"]), (None, "", iid))
        self.assertEqual(piece["episode"], lifecycle.derived_episode("CCCUSDT", iid, DELISTED * 1_000_000))
        self.assertEqual((piece["counts"]["instrument_status"], piece["counts"]["instrument_close"],
                          piece["last_bar_ns"]), (1, 0, DELISTED * 1_000_000 - 1_000_000))
        self.assertEqual(derived_instruments([piece]), {iid})
        self.assertIsNone(done["receipts"]["BTCUSDT"]["pieces"][0]["episode"])  # it trades on
        rows = read_market(Path(done["root"]), ["CCCUSDT"], day, start, end)
        last = list(run.market_events(rows, start, end))[-1]
        self.assertEqual((type(last).__name__, last.action.name, last.ts_event),
                         ("InstrumentStatus", "CLOSE", DELISTED * 1_000_000))
        # A window that ends by the stop gets no termination; one after it gets the termination and no bar.
        self.assertEqual(history.data_end_stops(files.open_market(self.profile, "reader"), day, ["CCCUSDT"],
                                                DELISTED), {})
        after = export.export_catalogs(self.profile, day, ["CCCUSDT"], ns(date(2025, 2, 20)), ns(date(2025, 2, 25)),
                                       fresh=True)
        self.addCleanup(shutil.rmtree, after["root"], True)
        piece, = after["receipts"]["CCCUSDT"]["pieces"]
        self.assertEqual((piece["last_bar_ns"], piece["counts"]["last"], piece["counts"]["instrument_status"]),
                         (None, 0, 0))
        self.assertEqual(derived_instruments([piece]), {iid})
        self.assertEqual(derived_instruments([{**piece, "episode": {**piece["episode"], "sources": ["notice.txt"]}}]), set())


class HaltTests(unittest.TestCase):
    """CCCUSDT stops on 2025-02-10, shows zero-volume minutes for a week and trades again from 2025-03-05."""

    RESUMED = day_ms(date(2025, 3, 5))

    @classmethod
    def setUpClass(cls):
        cls.profile, cache = directory(cls.addClassCleanup), tempdir(cls.addClassCleanup, prefix="market-cache-")
        found = exchange()
        filler = [(*row[:5], "0", *row[6:]) for row in minutes(DELISTED, DELISTED + 7 * DAY)]
        found.klines("monthly", "LAST", "CCCUSDT", "2025-02", minutes(day_ms(FEB), DELISTED) + filler)
        found.klines("monthly", "LAST", "CCCUSDT", "2025-03", minutes(cls.RESUMED, day_ms(APR), base=7.0))
        found.klines("monthly", "MARK", "CCCUSDT", "2025-03", minutes(cls.RESUMED, day_ms(APR), mark=True, base=7.0))
        found.funding_month("CCCUSDT", "2025-03", [(at + 3, "0.0001") for at in range(cls.RESUMED, day_ms(APR),
                                                                                     EIGHT_HOURS)])
        with serving(found):
            for month in (JAN, FEB, MAR):
                done = store.import_month(cls.profile, month, cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)
        cls.day = done["market_day"]
        # the first traded minute: every 7th LAST minute does not trade, the stop's last minute included
        traded = [row[0] for row in minutes(day_ms(JAN), DELISTED) if row[5] != "0"]
        cls.stop = traded[-1] + MINUTE
        cls.start = next(row[0] for row in minutes(cls.RESUMED, cls.RESUMED + DAY) if row[5] != "0")

    def exported(self, start: date, end: date) -> tuple[dict, list[dict]]:
        done = export.export_catalogs(self.profile, self.day, ["CCCUSDT", "BTCUSDT"], ns(start), ns(end), fresh=True)
        self.addCleanup(shutil.rmtree, done["root"], True)
        self.assertIsNone(done["receipts"]["BTCUSDT"]["pieces"][0]["episode"])
        return done, done["receipts"]["CCCUSDT"]["pieces"]

    def test_a_halt_inside_the_window_splits_the_contract(self):
        from engine.load import derived_instruments, read_market
        done, pieces = self.exported(FEB, date(2025, 3, 20))
        first, second = "CCCUSDT-E1-PERP.BINANCE", "CCCUSDT-E2-PERP.BINANCE"
        self.assertEqual([piece["episode"] for piece in pieces],
                         [lifecycle.derived_episode("CCCUSDT", first, self.stop * 1_000_000),
                          lifecycle.derived_episode("CCCUSDT", second, None, self.start * 1_000_000)])
        self.assertEqual(pieces[0]["last_bar_ns"], self.stop * 1_000_000 - 1_000_000)  # no zero-volume tail
        self.assertEqual(pieces[1]["first_bar_ns"], (self.start + MINUTE - 1) * 1_000_000)
        self.assertEqual([piece["counts"]["instrument_status"] for piece in pieces], [1, 0])
        self.assertEqual(derived_instruments(pieces), {first, second})
        rows = read_market(Path(done["root"]), ["CCCUSDT"], self.day, ns(FEB), ns(date(2025, 3, 20)))
        self.assertEqual([str(row["instrument_id"]) for row in rows], [first, second])
        # the second's daily warm-up holds its own days only: 5..19 March
        self.assertEqual(pieces[1]["counts"]["daily"], 15)
        for broken in (pieces[::-1], pieces[1:], [pieces[0], {**pieces[1], "episode": {
                **pieces[1]["episode"], "start_ns": self.stop * 1_000_000}}], [{**pieces[0], "episode": {
                **pieces[0]["episode"], "events": []}}, pieces[1]]):
            self.assertEqual(derived_instruments(broken), set())

    def test_a_window_that_meets_one_span_keeps_the_contracts_name(self):
        from engine.load import derived_instruments
        name = "CCCUSDT-PERP.BINANCE"
        for label, start, end, episode in (
                ("before the halt", JAN, date(2025, 2, 5), None),
                ("ends in the halt", JAN, date(2025, 3, 1),
                 lifecycle.derived_episode("CCCUSDT", name, self.stop * 1_000_000)),
                ("in the halt", date(2025, 2, 12), date(2025, 2, 25),
                 lifecycle.derived_episode("CCCUSDT", name, self.stop * 1_000_000)),
                ("starts in the halt", date(2025, 2, 12), date(2025, 3, 20),
                 lifecycle.derived_episode("CCCUSDT", name, None, self.start * 1_000_000)),
                ("after it, the same month", date(2025, 3, 10), date(2025, 3, 20),
                 lifecycle.derived_episode("CCCUSDT", name, None, self.start * 1_000_000))):
            with self.subTest(label):
                _, (piece,) = self.exported(start, end)
                self.assertEqual((piece["index"], piece["instrument_id"], piece["episode"]), (None, name, episode))
                self.assertEqual(derived_instruments([piece]), {name} if episode else set())
                if episode and episode["start_ns"]:
                    self.assertGreaterEqual(piece["first_bar_ns"], episode["start_ns"])
                    self.assertEqual(piece["counts"]["daily"], 15)

    def test_the_replay_a_run_is_compared_with_keeps_the_contract_whole(self):
        done = export.export_catalogs(self.profile, self.day, ["CCCUSDT"], ns(FEB), ns(date(2025, 3, 20)), fresh=True,
                                      split_halts=False)
        self.addCleanup(shutil.rmtree, done["root"], True)
        piece, = done["receipts"]["CCCUSDT"]["pieces"]
        self.assertEqual((piece["instrument_id"], piece["episode"]), ("CCCUSDT-PERP.BINANCE", None))
        self.assertGreater(piece["counts"]["daily"], 15 + 40)

    def test_a_resumption_at_a_month_start_waits_whatever_the_window_start(self):
        feb, halt = day_ms(FEB), [(day_ms(FEB) + 5 * DAY, day_ms(MAR))]
        for start in (feb, day_ms(MAR), day_ms(MAR) + 5 * DAY):
            episodes, _ = export.trading_spans("CCCUSDT", halt, None, start * 1_000_000, ns(APR))
            self.assertEqual(episodes[-1]["start_ns"], ns(MAR))

    def test_membership_waits_for_the_month_after_a_resumption(self):
        from engine.load import episode_membership
        resumed = lifecycle.derived_episode("CCCUSDT", "CCCUSDT-PERP.BINANCE", None, self.start * 1_000_000)
        self.assertEqual(episode_membership(((ns(MAR), ns(APR)),), resumed), ())
        self.assertEqual(episode_membership(((ns(MAR), ns(date(2025, 6, 1))),), resumed), ((ns(APR), ns(date(2025, 6, 1))),))
        stated = {**resumed, "sources": ["notice.txt"]}
        self.assertEqual(episode_membership(((ns(MAR), ns(APR)),), stated), ((self.start * 1_000_000, ns(APR)),))


def stamps(market: dict) -> dict:
    """Every file of a market directory with its identity."""
    return {path: (path.stat().st_ino, path.stat().st_mtime_ns) for path in Path(market["root"]).rglob("*.parquet")}


class ImportRefusalTests(unittest.TestCase):
    """What an import refuses on a market another hand changed; each refusal leaves the files as they were."""

    @classmethod
    def setUpClass(cls):
        cls.market = directory(cls.addClassCleanup)
        cls.cache = tempdir(cls.addClassCleanup, prefix="market-cache-")
        cls.exchange = exchange()
        with serving(cls.exchange):
            for month in (JAN, FEB):
                store.import_month(cls.market, month, cls.cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)

    def refused(self, code: str, market: dict | None = None) -> Refusal:
        market = market or self.market
        before = stamps(market)
        with serving(self.exchange):
            caught = refused(store.import_month, market, MAR, self.cache, 1, ["BTCUSDT", "CCCUSDT"],
                             log=lambda line: None)
        self.assertEqual(caught.code, code, caught.message)
        self.assertEqual(stamps(market), before)
        return caught

    def copy(self) -> dict:
        market = directory(self.addCleanup)
        shutil.copytree(self.market["root"], market["root"], dirs_exist_ok=True)
        return market

    def test_an_import_refuses_what_it_cannot_append_to(self):
        market = self.copy()
        planted = forged(market, "universe_month", date(2099, 1, 1), rows={
            "universe_rule": ["other-rule-v1"], "month": [date(2099, 1, 1)], "symbol": ["XUSDT"]})
        failed = self.refused("DATA_TESTS_FAILED", market)
        self.assertEqual(set(failed.missing), {"universe_members_traded_on_the_eve", "universe_members_have_terms",
                                               "universe_rule_is_recorded"})  # XUSDT: no bars, terms or rule
        self.assertEqual(list(Path(market["root"]).rglob(".*.tmp")), [])
        planted.unlink()
        holder = files.open_market(market, "import")
        with files.lock(holder):  # an import running elsewhere
            self.refused("CONCURRENT_IMPORT", market)
        with serving(self.exchange):
            done = store.import_month(market, MAR, self.cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)
        self.assertEqual(done["universe_members"], ["BTCUSDT"])


def on(day: date):
    """The import's clock on `day` at noon UTC: the current month runs through the day before."""
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(day.year, day.month, day.day, 12, tzinfo=tz)
    return patch.object(store, "datetime", Clock)


class LaterImportTests(unittest.TestCase):
    """Imports after the first months: a later terms change, a current month completed and several workers."""

    def database(self, scope=("BTCUSDT",), months=(JAN, FEB), workers: int = 1) -> tuple[dict, Exchange, list]:
        profile = directory(self.addCleanup)
        self.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))  # its own: what is published differs per test
        self.addCleanup(shutil.rmtree, self.cache, True)
        found = exchange()
        with serving(found):
            results = [store.import_month(profile, month, self.cache, workers, list(scope), log=lambda line: None)
                       for month in months]
        return profile, found, results

    def test_a_rebuilt_directory_trades_old_market_days_on_its_earliest_terms(self):
        profile, _, _ = self.database()
        market = files.open_market(profile, "reader")
        rows = [row for batch in files.read_table(market, None, "instrument", ["BTCUSDT"]) for row in batch.to_pylist()]
        market_day = date(2025, 2, 10).isoformat()
        rebuilt = day_ms(date(2026, 11, 4))
        first, later = {**rows[0], "observed_at": rebuilt}, {**rows[0], "observed_at": rebuilt + 1, "price_increment": "0.5"}
        self.write_terms(market, [first, later])
        self.assertEqual(instrument.terms(market, market_day, "BTCUSDT")["observed_at"], rebuilt)
        before_listing = date(2024, 12, 31).isoformat()
        assert_refused(self, "UNKNOWN_SYMBOL", instrument.terms, market, before_listing, "BTCUSDT")

    def write_terms(self, market, rows) -> None:
        table = pa.Table.from_pylist(rows, schema=files.TABLES["instrument"].schema)
        pq.write_table(table, market.root / "instrument.parquet")

    def test_the_input_fingerprint_does_not_follow_the_market_day_or_the_observation(self):
        profile, _, _ = self.database()
        market = files.open_market(profile, "reader")
        market_day = date(2025, 2, 27).isoformat()
        first = self.fingerprint(profile, market_day)
        rows = [row for batch in files.read_table(market, None, "instrument", ["BTCUSDT"]) for row in batch.to_pylist()]
        self.write_terms(market, [{**row, "observed_at": row["observed_at"] + 86_400_000} for row in rows])
        self.assertEqual(self.fingerprint(profile, market_day), first, "only observed later")
        self.write_terms(market, [{**row, "max_quantity": "7"} for row in rows])
        self.assertNotEqual(self.fingerprint(profile, market_day), first, "other terms")

    def test_a_later_terms_row_never_reclassifies_a_contract(self):
        profile, found, _ = self.database(scope=("BBBUSDT", "BTCUSDT", "CCCUSDT"))
        for item in found.info:
            if item["symbol"] == "BTCUSDT":  # a delisting contract reported SETTLING without a contract type
                item["contractType"], item["status"] = "", "SETTLING"
        with serving(found):
            done = store.import_month(profile, MAR, self.cache, 1, ["BBBUSDT", "BTCUSDT", "CCCUSDT"],
                                      log=lambda line: None)
        self.assertEqual(done["universe_members"], ["BBBUSDT", "BTCUSDT"])
        found = rows(profile, "instrument", ["BTCUSDT"])["classification"].to_pylist()
        self.assertEqual([json.loads(item)["contract_type"] for item in found], ["PERPETUAL", ""])  # recorded

    def reused(self, profile, found: Exchange, *, listed: date, **contract) -> dict:
        """CCCUSDT, which stopped in February, is listed again as another contract and trades in March."""
        low = day_ms(listed)
        found.info = [item for item in found.info if item["symbol"] != "CCCUSDT"]
        found.contract("CCCUSDT", onboard=low, **contract)
        found.klines("monthly", "LAST", "CCCUSDT", "2025-03", minutes(low, day_ms(APR)))
        found.klines("monthly", "MARK", "CCCUSDT", "2025-03", minutes(low, day_ms(APR), mark=True))
        found.funding_month("CCCUSDT", "2025-03", [(at + 3, "0.0001") for at in range(low, day_ms(APR), EIGHT_HOURS)])
        found.rest[("LAST1d", "CCCUSDT")] = minutes(low, day_ms(APR))
        with serving(found):
            return store.import_month(profile, MAR, self.cache, 1, ["BBBUSDT", "BTCUSDT", "CCCUSDT"],
                                      log=lambda line: None)

    def test_a_symbol_given_to_an_equity_stops_being_imported(self):
        equity = {"contract_type": "TRADIFI_PERPETUAL", "underlying": "EQUITY"}
        for status in ("TRADING", "BREAK"):
            with self.subTest(status=status):
                profile, found, _ = self.database(scope=("BBBUSDT", "BTCUSDT", "CCCUSDT"))
                done = self.reused(profile, found, listed=date(2025, 3, 5), status=status, **equity)
                self.assertEqual(done["excluded"], {"CCCUSDT": "contract_type:TRADIFI_PERPETUAL"})
                self.assertNotIn("CCCUSDT", done["per_symbol"])
                self.assertEqual(done["universe_members"], ["BBBUSDT", "BTCUSDT"])

    def test_the_months_of_a_coin_before_an_equity_took_its_symbol_are_imported_on_its_own_terms(self):
        scope = ["BBBUSDT", "BTCUSDT", "CCCUSDT", "DDDUSDT"]
        profile = directory(self.addCleanup)
        self.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, self.cache, True)
        found, low = exchange(), day_ms(date(2025, 3, 5))
        found.server_time = day_ms(APR)  # a directory built after the equity listed
        found.contract("CCCUSDT", onboard=low, tick="0.5", step="10", contract_type="TRADIFI_PERPETUAL", underlying="EQUITY")
        for kind in ("LAST", "MARK"):
            found.klines("monthly", kind, "CCCUSDT", "2025-03", minutes(low, day_ms(APR), mark=kind == "MARK"))
        # An equity never a coin before, with marks and funding published before it lists, as Binance does.
        found.contract("DDDUSDT", onboard=low, contract_type="TRADIFI_PERPETUAL", underlying="EQUITY")
        found.klines("monthly", "MARK", "DDDUSDT", "2025-02", minutes(low - 8 * DAY, day_ms(MAR), mark=True))
        found.funding_month("DDDUSDT", "2025-02", [(low - 8 * DAY, "0.0001")])
        found.rest[("LAST1d", "CCCUSDT")] = minutes(low, day_ms(APR))  # REST serves the equity alone
        with serving(found):
            first, second, third = (store.import_month(profile, month, self.cache, 1, scope, log=lambda line: None)
                                    for month in (JAN, FEB, MAR))
        self.assertEqual([item["excluded"] for item in (first, second, third)],
                         [{}, {}, dict.fromkeys(("CCCUSDT", "DDDUSDT"), "contract_type:TRADIFI_PERPETUAL")])
        self.assertEqual((second["per_symbol"]["DDDUSDT"]["rows"], second["per_symbol"]["DDDUSDT"]["funding"]), (0, 0))
        self.assertEqual((first["per_symbol"]["CCCUSDT"]["rows"], second["per_symbol"]["CCCUSDT"]["rows"]),
                         (2 * 31 * 1440, 2 * 9 * 1440))
        self.assertEqual((first["inferred_terms"], second["gaps"], first["derived_findings"]), (["CCCUSDT"], {}, {}))
        self.assertEqual(second["universe_members"], ["BTCUSDT", "CCCUSDT"])
        self.assertEqual(third["universe_members"], ["BBBUSDT", "BTCUSDT"])
        self.assertEqual(rows(profile, "instrument", ["CCCUSDT"])["terms_source"].to_pylist(), ["inferred", "exchange_info"])
        market = files.open_market(profile, "reader")
        for market_day in ("2025-02-28", "2025-03-31"):  # before and after the equity's terms were observed
            terms = instrument.terms(market, market_day, "CCCUSDT")
            self.assertEqual((terms["terms_source"], terms["price_increment"]), ("inferred", "0.01"))

    def test_a_coin_listed_again_is_still_imported(self):
        profile, found, _ = self.database(scope=("BBBUSDT", "BTCUSDT", "CCCUSDT"))
        done = self.reused(profile, found, listed=date(2025, 3, 5))
        self.assertEqual((done["excluded"], done["per_symbol"]["CCCUSDT"]["bars"]["LAST"]), ({}, 27 * 1440))

    def test_which_contract_bears_a_symbol_in_a_month(self):
        def row(at: date, kind: str, underlying: str) -> dict:
            return {"observed_at": day_ms(at), "classification": json.dumps({
                "contract_type": kind, "quote_asset": "USDT", "underlying_type": underlying})}

        def item(kind: str, underlying: str, onboard: date) -> dict:
            return {"symbol": "XUSDT", "contract_type": kind, "underlying_type": underlying, "base_asset": "X",
                    "onboard_date": day_ms(onboard)}
        coin, equity = ("PERPETUAL", "COIN"), ("TRADIFI_PERPETUAL", "EQUITY")
        inferred = {"observed_at": day_ms(date(2025, 4, 10)), "classification": None}
        seen_coin, seen_equity = row(FEB, *coin), row(FEB, *equity)
        old, new = date(2025, 1, 5), date(2025, 3, 5)
        for label, seen, now, expected in (  # eligible in February, March, April
                ("coin then equity", [seen_coin], item(*equity, new), (True, False, False)),
                ("equity then coin", [seen_equity], item(*coin, new), (False, False, True)),
                ("same contract, other type", [seen_coin], item("PERPETUAL_DELIVERING", "COIN", old), (True, True, True)),
                ("premarket graduates", [row(FEB, "PERPETUAL", "PREMARKET")], item(*coin, old), (False, False, False)),
                ("settling", [seen_coin], item("", "COIN", new), (True, True, True)),
                ("gone", [seen_coin], None, (True, True, True)),
                ("equity gone again", [seen_coin, row(new, *equity)], None, (True, False, False)),
                ("equity settling", [seen_coin, row(new, *equity)], item("", "EQUITY", new), (True, False, False)),
                ("coin delivering, gone", [seen_coin, row(new, "PERPETUAL_DELIVERING", "COIN")], None, (True, True, True)),
                ("relisted coin delivering", [seen_coin], item("PERPETUAL_DELIVERING", "COIN", new), (True, True, True)),
                ("equity, then coin settling", [seen_equity, row(new, *coin)], item("", "COIN", new), (False, False, True)),
                ("equity between two coins, gone", [seen_coin, row(new, *equity), row(date(2025, 4, 5), *coin)], None,
                 (True, False, False)),
                ("equity, then a coin again", [seen_coin, row(new, *equity), row(date(2025, 3, 20), *coin)],
                 item(*coin, date(2025, 3, 20)), (True, False, True)),
                ("coin, equity never stored with a type", [seen_coin], item("", "EQUITY", new), (True, False, False)),
                ("equity settling, seen after the month", [seen_coin, row(date(2025, 4, 2), *equity)],
                 item("", "EQUITY", new), (True, False, False)),
                ("equity announced for April", [seen_coin, row(new, *equity)], item(*equity, APR), (True, True, False)),
                ("coin, then premarket graduates", [seen_coin, row(new, "PERPETUAL", "PREMARKET"), row(APR, *coin)],
                 item(*coin, new), (True, False, False)),
                ("first seen settling, relisted, settling", [row(FEB, "", "COIN"), row(new, *coin)],
                 item("", "COIN", new), (False, False, True)),
                ("premarket seen pending graduates", [row(FEB, "PERPETUAL", "PREMARKET")], item(*coin, new),
                 (False, False, False)),
                ("premarket graduates, gone", [row(FEB, "PERPETUAL", "PREMARKET"), row(new, *coin)], None,
                 (False, False, False)),
                ("never seen, after an earlier contract", [], item(*equity, new), (True, False, False)),
                ("never seen premarket", [], item("PERPETUAL", "PREMARKET", new), (False, False, False)),
                ("never seen, delivering", [], item("PERPETUAL_DELIVERING", "COIN", new), (False, False, False)),
                ("never seen, not yet listed", [], item(*equity, date(2025, 4, 11)), (True, True, False)),
                ("equity seen after it listed", [row(APR, *equity)], item(*equity, new), (True, False, False)),
                ("equity seen, gone", [row(APR, *equity)], None, (False, False, False)),
                ("earlier coin inferred", [inferred], item(*equity, new), (True, False, False)),
                ("earlier coin inferred, equity gone", [inferred, row(date(2026, 1, 1), *equity)], None,
                 (False, False, False)),
                ("earlier coin inferred, listed coin", [inferred], item(*coin, new), (True, True, True))):
            with self.subTest(label):
                self.assertEqual(tuple(universe.contract_in_month("XUSDT", seen, now, at)["eligible"]
                                       for at in (FEB, MAR, APR)),
                                 expected)

    def tail(self, found: Exchange, *, close: str | None = None, rate: str = "0.0001", absent: int | None = None):
        """March from public REST only through 2025-03-10 (no March archive published yet)."""
        march = {key: value for key, value in found.archives.items() if "2025-03" in key}
        for key in march:
            del found.archives[key]
        low, high = day_ms(MAR), day_ms(date(2025, 3, 10))
        rows = minutes(low, high)
        if close is not None:  # REST reports another close for one minute than the archive will
            probe = low + 5 * DAY + 10 * MINUTE
            rows = [(r[0], r[1], max(r[2], close) if r[0] == probe else r[2], r[3], close if r[0] == probe else r[4],
                     *r[5:]) for r in rows]
        found.rest[("LAST", "BTCUSDT")] = [row for row in rows if row[0] != absent]  # a minute REST lacked
        found.rest[("MARK", "BTCUSDT")] = minutes(low, high, mark=True)
        found.funding["BTCUSDT"] = [(at + 5, rate) for at in range(low, high, EIGHT_HOURS)]  # REST's own jitter
        return march

    def test_completing_the_current_month_appends_only_its_tail(self):
        profile, found, _ = self.database()
        march = self.tail(found)
        with serving(found), on(date(2025, 3, 10)):
            first = store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        self.assertEqual((first["through"], first["rows"], first["source_rows"]["rest"]),
                         ("2025-03-10", 2 * 9 * 1440, 2 * 9 * 1440))
        found.archives.update(march)
        with serving(found), on(date(2025, 4, 2)):
            done = store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        self.assertEqual((done["through"], done["rows"], done["funding_rows"]), ("2025-04-01", 2 * 22 * 1440, 66))
        stored = rows(profile, "funding", ["BTCUSDT"], day_ms(MAR))["funding_time"].to_pylist()
        self.assertEqual((len(stored), stored[0]), (93, day_ms(MAR) + 5))  # one row per settlement; REST's time stays
        with serving(found):
            assert_refused(self, "MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
                           log=lambda line: None)

    def test_a_crash_between_the_funding_and_the_bars_leaves_no_duplicates(self):
        profile, found, _ = self.database()
        bars = Path(profile["root"]) / "bar" / "2025-03.parquet"
        with serving(found), on(date(2025, 3, 10)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        behind = bars.read_bytes()
        with serving(found), on(date(2025, 3, 20)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        whole = rows(profile, "funding")
        bars.write_bytes(behind)  # the funding renamed into place, the bars not
        with serving(found), on(date(2025, 3, 20)):
            done = store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        self.assertEqual(done["through"], "2025-03-20")
        self.assertTrue(rows(profile, "funding").equals(whole))
        bars.unlink()  # the same on the month's first import: the bars hold none of it
        with serving(found), on(date(2025, 3, 20)):
            done = store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        self.assertEqual(done["through"], "2025-03-20")
        self.assertTrue(rows(profile, "funding").equals(whole))

    def follow_round(self, profile: dict, found: Exchange, day: date) -> dict:
        """A round of bars alone, at noon of `day`, once every archive it asks for is out."""
        scope = follow.Scope([], JAN, JAN, JAN, JAN, bar_symbols=["BTCUSDT"])
        with serving(found), on(day), patch.object(follow, "_bars_ready", return_value=True), \
                patch.object(follow, "_monthly"), patch.object(follow, "_holes"):
            return follow.run_round(profile, scope, self.cache, follow.Memory(),
                                    datetime(day.year, day.month, day.day, 12, tzinfo=UTC), lambda line: None)

    def fingerprint(self, profile: dict, market_day: str) -> str:
        """export_content_sha256 of a fresh export of February at `market_day`, with its membership file."""
        root = tempdir(self.addCleanup, prefix="market-export-")
        done = export.export_catalogs(profile, market_day, ["BTCUSDT"], ns(FEB), ns(MAR), fresh=True, root=root)
        market = files.open_market(profile, "reader")
        membership = root / "membership.json"
        membership.write_text(json.dumps(universe.membership_path(market, market_day, ns(MAR)), sort_keys=True))
        return inputs.export_fingerprint({"root": done["root"], "membership_file": membership, "symbols": ["BTCUSDT"]},
                                         True)["export_content_sha256"]

    def test_on_a_months_first_day_paper_covers_now_after_the_members_and_the_market_day_does_not_change(self):
        profile, found, _ = self.database()
        noon = ns(MAR) + 12 * 3_600_000_000_000
        eve = date(2025, 2, 28).isoformat()
        # Before the members: the newest day is the one before the eve, and paper refuses as it always has.
        self.assertEqual(refused(universe.selection, profile, None, None, noon,
                                 error=Refusal).code, "UNIVERSE_NOT_COVERING_WINDOW")
        assert_refused(self, "MARKET_DAY_UNRESOLVED", files.resolve_day, files.open_market(profile, "reader"), eve)
        self.follow_round(profile, found, MAR)
        self.assertEqual(rows(profile, "bar", ["BTCUSDT"], day_ms(MAR)).num_rows, 0)
        market_day, membership, chosen = universe.selection(profile, None, None, noon)
        self.assertEqual((market_day, chosen), (eve, ["BTCUSDT"]))
        self.assertEqual(membership["membership"]["BTCUSDT"], [[ns(FEB), ns(APR)]])
        # The next round brings March's first day and new terms; the eve's export stays the same.
        before = self.fingerprint(profile, eve)
        self.assertNotEqual(self.fingerprint(profile, date(2025, 2, 27).isoformat()), before)  # it sees the rows
        found.server_time = day_ms(date(2025, 3, 2))
        found.contract("BTCUSDT", tick="0.1")
        self.follow_round(profile, found, date(2025, 3, 2))
        self.assertEqual(files.latest_day(files.open_market(profile, "reader")), MAR)
        self.assertGreater(rows(profile, "bar", ["BTCUSDT"], day_ms(MAR)).num_rows, 0)
        self.assertEqual(self.fingerprint(profile, eve), before)

    def test_the_current_month_on_its_first_day_writes_its_members_only(self):
        scope = ["BBBUSDT", "BTCUSDT", "CCCUSDT"]
        profile, found, _ = self.database(scope=tuple(scope))
        with serving(found), on(MAR):
            first = store.import_month(profile, MAR, self.cache, 1, scope, log=lambda line: None)
            # With March's members the newest day is February's last, which reads them.
            self.assertEqual(first["market_day"], date(2025, 2, 28).isoformat())
            self.assertEqual(store.import_month(profile, MAR, self.cache, 1, scope, log=lambda line: None)
                             ["market_day"], first["market_day"])
            assert_refused(self, "MONTH_INVALID", store.import_month, profile, APR, self.cache, 1, scope,
                           log=lambda line: None)
        self.assertEqual((first["through"], first["rows"], first["funding_rows"], first["universe_members"]),
                         ("2025-03-01", 0, 0, ["BBBUSDT", "BTCUSDT"]))
        self.assertEqual(sorted(set(rows(profile, "universe_month")["month"].to_pylist())), [FEB, MAR])
        with serving(found), on(date(2025, 4, 2)):
            done = store.import_month(profile, MAR, self.cache, 1, scope, log=lambda line: None)
        self.assertEqual((done["through"], done["universe_members"]), ("2025-04-01", ["BBBUSDT", "BTCUSDT"]))
        self.assertEqual(done["rows"], 2 * 2 * 31 * 1440)

    def test_a_first_import_needs_a_closed_day(self):
        profile = directory(self.addCleanup)
        with serving(exchange()), on(MAR):
            assert_refused(self, "MONTH_INVALID", store.import_month, profile, MAR, Path(tempfile.mkdtemp()), 1,
                           ["BTCUSDT"], log=lambda line: None)

    def test_a_stored_minute_the_sources_now_contradict_refuses(self):
        profile, found, _ = self.database()
        march = self.tail(found, close="999.99")
        with serving(found), on(date(2025, 3, 10)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        found.archives.update(march)
        with serving(found), on(date(2025, 4, 2)):
            refused = assert_refused(self, "MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
                                     log=lambda line: None)
        self.assertIn(str(day_ms(MAR) + 5 * DAY + 10 * MINUTE), refused.missing)

    def test_a_minute_the_sources_add_inside_the_imported_part_refuses(self):
        profile, found, _ = self.database()
        absent = day_ms(MAR) + 5 * DAY + 10 * MINUTE
        march = self.tail(found, absent=absent)
        with serving(found), on(date(2025, 3, 10)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        bars = rows(profile, "bar", ["BTCUSDT"], day_ms(MAR))
        self.assertNotIn(("LAST", absent), set(zip(bars["price_type"].to_pylist(), bars["ts_open"].to_pylist(),
                                                   strict=True)))
        found.archives.update(march)  # the archive holds the minute: it lies in the part the first import declared
        with serving(found), on(date(2025, 4, 2)):
            refused = assert_refused(self, "MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
                                     log=lambda line: None)
        self.assertIn(str(absent), refused.missing)

    def test_a_stored_settlement_the_archive_now_contradicts_refuses(self):
        profile, found, _ = self.database()
        march = self.tail(found, rate="0.0002")
        with serving(found), on(date(2025, 3, 10)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        found.archives.update(march)
        with serving(found), on(date(2025, 4, 2)):
            assert_refused(self, "MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
                           log=lambda line: None)

    def test_the_current_month_imported_again_keeps_its_members(self):
        profile, found, _ = self.database()
        march = self.tail(found)
        with serving(found), on(date(2025, 3, 10)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        members = rows(profile, "universe_month", None, day_ms(MAR), day_ms(APR))["symbol"].to_pylist() + ["XUSDT"]
        forged(profile, "universe_month", MAR, rows={
            "universe_rule": [universe.RULE] * len(members), "month": [MAR] * len(members), "symbol": members})
        found.archives.update(march)
        with serving(found), on(date(2025, 4, 2)):
            assert_refused(self, "UNIVERSE_CHANGED", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
                           log=lambda line: None)

    def test_several_workers_give_the_one_worker_result(self):
        scope = ("BBBUSDT", "BTCDOMUSDT", "BTCUSDT", "CCCUSDT", "USDCUSDT")
        with patch.object(store, "ProcessPoolExecutor", worker_pool):  # spawned workers get the stand-in exchange
            _, _, many = self.database(scope=scope, months=(JAN, FEB, MAR), workers=3)
        _, _, one = self.database(scope=scope, months=(JAN, FEB, MAR), workers=1)
        drop = ("seconds",)
        self.assertEqual([{k: v for k, v in r.items() if k not in drop} for r in many],
                         [{k: v for k, v in r.items() if k not in drop} for r in one])

    def test_one_contract_prepared_here_keeps_this_process_pace(self):
        profile, cache = directory(self.addCleanup), Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, cache, True)
        with serving(exchange()), patch.object(sources, "REST_INTERVAL", 0.001), \
                patch.object(sources, "FUNDING_INTERVAL", 0.002):
            for month in (JAN, FEB):  # one job: no pool, whatever the workers
                store.import_month(profile, month, cache, 4, ["BTCUSDT"], log=lambda line: None)
            self.assertEqual((sources.REST_INTERVAL, sources.FUNDING_INTERVAL), (0.001, 0.002))


class NoSourceTests(unittest.TestCase):
    def test_a_month_no_source_holds_asks_no_source_but_its_monthly_archives(self):
        """NEWUSDT onboards after January; RELUSDT was relisted after it, but its January archives are imported;
        GONEUSDT left exchangeInfo before January."""
        found = Exchange(server_time=day_ms(FEB))
        for symbol in ("BTCUSDT", "NEWUSDT", "RELUSDT"):
            found.contract(symbol, onboard=day_ms(date(2025, 2, 10)) if symbol != "BTCUSDT" else day_ms(JAN))
        for symbol in ("BTCUSDT", "RELUSDT"):
            found.klines("monthly", "LAST", symbol, "2025-01", minutes(day_ms(JAN), day_ms(FEB)))
            found.klines("monthly", "MARK", symbol, "2025-01", minutes(day_ms(JAN), day_ms(FEB), mark=True))
            found.funding_month(symbol, "2025-01", [(at + 3, "0.0001") for at in range(day_ms(JAN), day_ms(FEB),
                                                                                         EIGHT_HOURS)])
            found.rest[("LAST1d", symbol)] = minutes(day_ms(JAN), day_ms(FEB))
        profile, cache = directory(self.addCleanup), Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, cache, True)
        with serving(found):
            result = store.import_month(profile, JAN, cache, 1, ["BTCUSDT", "GONEUSDT", "NEWUSDT", "RELUSDT"],
                                        log=lambda line: None)
        self.assertEqual({symbol: sum(item["bars"].values()) for symbol, item in result["per_symbol"].items()},
                         {"BTCUSDT": 2 * 31 * 1440, "GONEUSDT": 0, "NEWUSDT": 0, "RELUSDT": 2 * 31 * 1440})
        asked = [url for url in found.requests if "GONEUSDT" in url or "NEWUSDT" in url]
        self.assertTrue(asked)
        self.assertEqual([url for url in asked if url.startswith(sources.REST) or "/daily/" in url], [])


class BackfillTests(unittest.TestCase):
    """The month just before the earliest stored one, imported after the fact: the stored months untouched, and the
    rows the forward import from that month gives."""

    SCOPE = ["BBBUSDT", "BTCDOMUSDT", "BTCUSDT", "CCCUSDT", "USDCUSDT"]
    TABLES = ("bar", "funding", "universe_month")

    @classmethod
    def setUpClass(cls):
        cls.cache = tempdir(cls.addClassCleanup, prefix="market-cache-")
        cls.exchange = exchange()
        cls.forward = directory(cls.addClassCleanup)
        cls.backfilled = directory(cls.addClassCleanup)
        with serving(cls.exchange):
            for month in (JAN, FEB, MAR):
                cls.imported(cls.forward, month)
            cls.feb = cls.imported(cls.backfilled, FEB)
            cls.stored = (Path(cls.backfilled["root"]) / "bar" / "2025-02.parquet").read_bytes()
            cls.jan = cls.imported(cls.backfilled, JAN)
            cls.mar = cls.imported(cls.backfilled, MAR)

    @classmethod
    def imported(cls, profile: dict, month: date, scope=None) -> dict:
        return store.import_month(profile, month, cls.cache, 1, scope or cls.SCOPE, log=lambda line: None)

    def refused(self, code: str, profile: dict, month: date, scope=None) -> Refusal:
        before = stamps(profile)
        with serving(self.exchange):
            caught = refused(self.imported, profile, month, scope)
        self.assertEqual(caught.code, code, caught.message)
        self.assertEqual(stamps(profile), before)
        return caught

    def market(self, *months: date) -> dict:
        profile = directory(self.addCleanup)
        with serving(self.exchange):
            for month in months:
                self.imported(profile, month)
        return profile

    def test_a_backfill_ends_where_the_forward_import_does(self):
        for table in self.TABLES:
            with self.subTest(table=table):
                self.assertTrue(rows(self.backfilled, table).equals(rows(self.forward, table)))
        terms = [rows(profile, "instrument").drop_columns(["observed_at"])  # equal but for when they were observed
                 for profile in (self.backfilled, self.forward)]
        self.assertTrue(terms[0].equals(terms[1]))
        self.assertEqual(self.jan["universe_members"], [])  # the new first month
        self.assertEqual(self.jan["universe_filled"], {"2025-02": ["BTCUSDT", "CCCUSDT"]})
        self.assertEqual(self.jan["rows"], 2 * (31 * 1440 + 12 * 1440 + 31 * 1440))
        self.assertEqual(self.mar["universe_members"], ["BBBUSDT", "BTCUSDT"])
        self.assertEqual(sorted(set(rows(self.backfilled, "universe_month")["month"].to_pylist())), [FEB, MAR])

    def test_the_stored_months_stay_as_they_were(self):
        self.assertEqual((self.feb["universe_members"], self.feb["market_day"]), ([], date(2025, 2, 27).isoformat()))
        self.assertEqual((Path(self.backfilled["root"]) / "bar" / "2025-02.parquet").read_bytes(), self.stored)

    def test_months_extend_only_at_either_end(self):
        self.refused("MONTH_EXISTS", self.backfilled, JAN)
        self.refused("MONTH_INVALID", self.backfilled, date(2024, 11, 1))  # a month left out
        later = self.market(MAR)
        self.refused("MONTH_INVALID", later, JAN)

    def test_a_backfill_refuses_funding_other_than_it_computes(self):
        profile = self.market(FEB)
        forged(profile, "funding", JAN, rows={"symbol": ["BTCUSDT"], "funding_time": [day_ms(JAN) + 3],
                                              "rate": [Decimal("0.0002")]})
        failed = self.refused("MONTH_EXISTS", profile, JAN)
        self.assertEqual(failed.missing, ("2025-01", "BTCUSDT"))
        # A part of them differs too.
        forged(profile, "funding", JAN, rows={"symbol": ["BTCUSDT"], "funding_time": [day_ms(JAN) + 3],
                                              "rate": [Decimal("0.0001")]})
        self.assertEqual(self.refused("MONTH_EXISTS", profile, JAN).missing[0], "2025-01")

    def test_a_backfill_that_crashed_before_its_bars_goes_on_over_the_same_funding(self):
        profile = self.market(FEB)
        with serving(self.exchange):
            self.imported(profile, JAN)
        whole = {table: rows(profile, table) for table in self.TABLES}
        (Path(profile["root"]) / "bar" / "2025-01.parquet").unlink()  # the funding renamed into place, the bars not
        with serving(self.exchange):
            self.imported(profile, JAN)
        for table, found in whole.items():
            with self.subTest(table=table):
                self.assertTrue(rows(profile, table).equals(found))

    def test_a_month_holding_a_bar_row_is_refused_over_the_same_funding(self):
        profile = self.market(FEB)
        with serving(self.exchange):
            self.imported(profile, JAN)
        bars = Path(profile["root"]) / "bar" / "2025-01.parquet"
        pq.write_table(pq.read_table(bars).slice(0, 1), bars)
        self.refused("MONTH_INVALID", profile, JAN)  # stored bars make it no month before the earliest

    def test_a_backfill_compares_the_members_a_month_already_holds(self):
        expected = rows(self.forward, "universe_month", None, day_ms(FEB), day_ms(MAR))["symbol"].to_pylist()
        profile = self.market(FEB, MAR)
        forged(profile, "universe_month", FEB, rows={"universe_rule": [universe.RULE] * len(expected),
                                                     "month": [FEB] * len(expected), "symbol": expected})
        with serving(self.exchange):
            done = self.imported(profile, JAN)  # members back from the public copy: the same, so it passes
        self.assertEqual(done["universe_filled"], {"2025-02": [], "2025-03": ["BBBUSDT", "BTCUSDT"]})
        other = self.market(FEB, MAR)
        forged(other, "universe_month", FEB, rows={"universe_rule": [universe.RULE], "month": [FEB], "symbol": ["BTCUSDT"]})
        self.refused("UNIVERSE_CHANGED", other, JAN)


class RecoveryTests(unittest.TestCase):
    """A lost directory imported again from the sources: given the same terms, every row comes back."""

    def test_a_directory_imported_again_with_the_same_terms_equals_the_original(self):
        cache = tempdir(self.addCleanup, prefix="market-cache-")
        scope = ["BBBUSDT", "BTCUSDT", "CCCUSDT"]
        original, rebuilt = directory(self.addCleanup), directory(self.addCleanup)
        found = exchange()
        with serving(found):
            for month in (JAN, FEB, MAR):
                store.import_month(original, month, cache, 1, scope, log=lambda line: None)
            shutil.copy(Path(original["root"]) / "instrument.parquet", Path(rebuilt["root"]) / "instrument.parquet")
            for month in (JAN, FEB, MAR):
                done = store.import_month(rebuilt, month, cache, 1, scope, log=lambda line: None)
                self.assertEqual(done["instruments_appended"], 0)
        for table in ("bar", "funding", "universe_month", "instrument"):
            with self.subTest(table=table):
                self.assertTrue(rows(original, table).equals(rows(rebuilt, table)))
