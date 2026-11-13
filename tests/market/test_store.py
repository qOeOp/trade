"""A market directory imported month by month from a stand-in exchange: stitching, the universe rule, the
import's refusals, backfills, and its reads: freshness, membership, coverage, daily returns and a Catalog
export the engine streams whole."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
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

from market import coverage, export, files, follow, instrument, lifecycle, read, series, sources, store, universe
from market.sources import MarketError
from paper import runs
from registration import inputs
from tests.market.directory import directory, forged, read as rows
from tests.market.exchange import DAY, MINUTE, Exchange, day_ms, minutes, serving, worker_pool


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
            start, end = max(low, day_ms(month)), min(high, day_ms(universe.next_month(month)))
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
        cls.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        cls.addClassCleanup(shutil.rmtree, cls.cache, True)
        cls.exchange = exchange()
        cls.scope = ["BBBUSDT", "BTCDOMUSDT", "BTCUSDT", "CCCUSDT", "USDCUSDT"]
        with serving(cls.exchange):
            cls.results = {month: cls.imported(month) for month in (JAN, FEB, MAR)}
        cls.market_days = {month: result["market_day"] for month, result in cls.results.items()}

    @classmethod
    def imported(cls, month: date, scope=None) -> dict:
        return store.import_month(cls.market, month, cls.cache, 1, scope or cls.scope, log=lambda line: None)

    def refused(self, code: str, call, *args, **kwargs) -> MarketError:
        with self.assertRaises(MarketError) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception

    def test_the_first_import_starts_the_market_and_produces_no_universe(self):
        first = self.results[JAN]
        self.assertEqual(first["universe_members"], [])
        self.assertEqual(first["excluded"], {"BTCDOMUSDT": "index", "USDCUSDT": "stablecoin"})
        self.assertEqual(first["inferred_terms"], ["CCCUSDT"])
        self.assertEqual(first["bar_rows"], 2 * (31 * 1440 + 12 * 1440 + 31 * 1440))
        self.assertEqual(first["derived_findings"], {})  # derived daily bars equal the exchange's
        self.refused("MARKET_EMPTY", store.freshness, self.profile, self.market_days[JAN])
        # Each month's last day waits for the next month's members, which these imports leave unwritten.
        self.assertEqual(self.market_days, {month: (universe.next_month(month) - timedelta(days=2)).isoformat()
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

    def test_members_need_thirty_unbroken_days_and_a_delisted_contract_keeps_its_months(self):
        self.assertEqual(self.results[FEB]["universe_members"], ["BTCUSDT", "CCCUSDT"])  # BBBUSDT: 12 days
        self.assertEqual(self.results[MAR]["universe_members"], ["BBBUSDT", "BTCUSDT"])  # CCCUSDT stopped
        market = files.open_market(self.profile, "reader")
        path = universe.membership_path(market, self.market_days[MAR], ns(APR))
        self.refused("UNIVERSE_NOT_COVERING_WINDOW", universe.membership_path, market, self.market_days[MAR],
                     ns(date(2025, 4, 2)))
        self.refused("UNIVERSE_EMPTY_AT_DAY", universe.membership_path, market, self.market_days[JAN], ns(FEB))
        self.refused("MARKET_DAY_UNRESOLVED", universe.membership_path, market, "main", ns(FEB))
        self.refused("MARKET_DAY_UNRESOLVED", universe.membership_path, market, self.market_days[MAR][:7], ns(FEB))  # a month, no day
        self.assertEqual(universe.membership_path(market, self.market_days[FEB], ns(MAR))["membership"],
                         {"BTCUSDT": [[ns(FEB), ns(MAR)]], "CCCUSDT": [[ns(FEB), ns(MAR)]]})
        self.assertEqual(path["universe_rule"], universe.RULE)
        self.assertEqual(path["membership"], {"BTCUSDT": [[ns(FEB), ns(APR)]], "CCCUSDT": [[ns(FEB), ns(MAR)]],
                                              "BBBUSDT": [[ns(MAR), ns(APR)]]})

    def test_a_month_missing_from_its_monthly_archive_comes_from_the_daily_archive(self):
        third = self.results[MAR]
        self.assertEqual(third["gaps"], {})
        self.assertEqual(third["source_rows"], {"monthly": third["bar_rows"] - 1440, "daily": 1440, "rest": 0})
        self.assertEqual(third["per_symbol"]["BTCUSDT"]["bars"], {"LAST": 31 * 1440, "MARK": 31 * 1440})

    def test_freshness_reads_the_market_day(self):
        fresh = store.freshness(self.profile)
        self.assertEqual(fresh, {"market_day": self.market_days[MAR], "universe_rule": universe.RULE,
                                 "universe_months": ["2025-02", "2025-03"], "symbols": 3,
                                 "covered_through": day_ms(date(2025, 3, 31)), "latest_complete_day": date(2025, 3, 30),
                                 "latest_complete_month": "2025-02", "current_month_through": day_ms(date(2025, 3, 31))})
        self.assertEqual(store.freshness(self.profile, self.market_days[FEB])["covered_through"], day_ms(date(2025, 2, 28)))

    def test_months_import_once_and_in_order(self):
        with serving(self.exchange):
            self.refused("MONTH_EXISTS", self.imported, MAR)
            self.refused("MONTH_INVALID", self.imported, date(2025, 5, 1))
            self.refused("MONTH_INVALID", self.imported, date(2099, 1, 1))
            self.refused("MONTH_INVALID", self.imported, date(2025, 4, 2))
            self.refused("IMPORT_SCOPE", self.imported, APR, scope=["BTCUSDT", "BTCUSDT"])

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
        self.refused("INTERVAL_INVALID", coverage.coverage_facts, market, market_day, "BTCUSDT", 1, 2, empty, empty, [])
        self.refused("MARKET_DAY_INVALID", coverage.coverage_facts, market, "main", "BTCUSDT", 0, MINUTE, empty,
                     empty, [])
        self.refused("UNKNOWN_SYMBOL", coverage.coverage_facts, market, market_day, "ZZZUSDT", 0, MINUTE, empty, empty, [])
        self.refused("SOURCE_SHAPE", coverage.coverage_facts, market, market_day, "BTCUSDT", 0, 3 * MINUTE,
                     {"ts_open": [MINUTE, 0], "volume": [1, 1]}, empty, [])
        self.refused("EMPTY_SYMBOLS", coverage.diagnose_coverage, self.profile, None, [], "2025-02-09T00:00:00Z",
                     "2025-02-11T00:00:00Z", None)
        self.refused("INTERVAL_INVALID", coverage.diagnose_coverage, self.profile, None, ["BTCUSDT"],
                     "2025-02-09T00:00:00", "2025-02-11T00:00:00Z", None)

    def test_daily_returns_of_btc_and_the_equal_weight_universe(self):
        found = read.daily_returns(self.profile, self.market_days[MAR], universe.RULE,
                                   datetime(2025, 3, 2, tzinfo=timezone.utc), datetime(2025, 3, 4, tzinfo=timezone.utc))
        self.assertEqual(found["days"], ["2025-03-02", "2025-03-03"])
        self.assertEqual(found["btc"], found["basket"])  # both members walk the same prices
        self.refused("MARKET_RETURNS_WINDOW", read.daily_returns, self.profile, self.market_days[MAR], universe.RULE,
                     datetime(2025, 3, 2, 5, tzinfo=timezone.utc), datetime(2025, 3, 2, 9, tzinfo=timezone.utc))
        self.refused("RULE_VERSION_MISMATCH", read.daily_returns, self.profile, self.market_days[MAR], "other-v1",
                     datetime(2025, 3, 2, tzinfo=timezone.utc), datetime(2025, 3, 4, tzinfo=timezone.utc))

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
        daily = export.daily_bars(market, market_day, "BTCUSDT", 0, None, day + DAY)
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
        self.refused("INTERVAL_INVALID", read.stored_bars, self.profile, market_day, "BTCUSDT", "LAST", "1d",
                     "2025-03-02T06:00:00Z", window[1], None)
        self.refused("INTERVAL_INVALID", read.stored_bars, self.profile, market_day, "BTCUSDT", "MARK", "1d", *window, None)
        self.refused("NO_TERMS", read.stored_bars, self.profile, market_day, "ZZZUSDT", "LAST", "1m", *window, None)
        self.refused("UNKNOWN_REF", read.stored_bars, self.profile, "no-such-ref", "BTCUSDT", "LAST", "1m", *window,
                     None)

    def test_an_export_is_renamed_into_place_whole_so_a_failure_or_a_second_writer_keeps_what_is_there(self):
        start, end = ns(MAR), ns(date(2025, 3, 2))
        root = Path(tempfile.mkdtemp(prefix="market-export-test-"))
        self.addCleanup(shutil.rmtree, root, True)
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

    def test_an_export_loads_whole_into_the_engine_stream(self):
        from engine import run
        from engine.load import read_market
        start, end = ns(MAR), ns(date(2025, 3, 3))
        root = Path(tempfile.mkdtemp(prefix="market-export-test-"))
        self.addCleanup(shutil.rmtree, root, True)
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
        streamed = export.daily_bars(market, self.market_days[MAR], "BTCUSDT", 0, None, end // 10**6)
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
        self.assertRaises(MarketError, export.export_catalogs, self.profile, None, ["BTCUSDT"], start + 1, end)
        for code, args in (("EXPORT_WINDOW", (["BTCUSDT"], end, start)), ("EXPORT_SCOPE", (["BTCUSDT", "BTCUSDT"], start,
                                                                                            end))):
            with self.subTest(code=code):
                self.refused(code, export.export_catalogs, self.profile, None, *args)
        self.refused("MARKET_DAY_UNKNOWN", export.export_catalogs, self.profile, "no-such-ref", ["BTCUSDT"], start, end)
        self.refused("NO_TERMS", export.export_catalogs, self.profile, None, ["ZZZUSDT"], start, end, fresh=True,
                     root=root)

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
        for wrong in ({**body, "market_day": self.market_days[FEB]},
                      {**body, "episodes": [{**body["episodes"][0], "sources": ["absent.txt"]}]},
                      {**body, "episodes": [{**body["episodes"][0], "events": body["episodes"][0]["events"][2:]}]}):
            with self.subTest(wrong=wrong):
                self.refused("LIFECYCLE_INPUT", lifecycle.validate_lifecycle, wrong, self.market_days[MAR], files)
        off_grid = {**body, "episodes": [{**body["episodes"][0], "events": [
            *body["episodes"][0]["events"][:2], {**body["episodes"][0]["events"][2], "close_price": "100.015"}]}]}
        root = Path(tempfile.mkdtemp(prefix="market-export-test-"))
        self.addCleanup(shutil.rmtree, root, True)
        self.refused("LIFECYCLE_INPUT", export.export_catalogs, self.profile, self.market_days[MAR], ["CCCUSDT"], start, end,
                     lifecycle.validate_lifecycle(off_grid, self.market_days[MAR], files), files, True, root)
        self.assertEqual(list(root.iterdir()), [])  # the failed fresh export left nothing behind


def stamps(market: dict) -> dict:
    """Every file of a market directory with its identity."""
    return {path: (path.stat().st_ino, path.stat().st_mtime_ns) for path in Path(market["root"]).rglob("*.parquet")}


class ImportRefusalTests(unittest.TestCase):
    """What an import refuses on a market another hand changed; each refusal leaves the files as they were."""

    @classmethod
    def setUpClass(cls):
        cls.market = directory(cls.addClassCleanup)
        cls.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        cls.addClassCleanup(shutil.rmtree, cls.cache, True)
        cls.exchange = exchange()
        with serving(cls.exchange):
            for month in (JAN, FEB):
                store.import_month(cls.market, month, cls.cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)

    def refused(self, code: str, market: dict | None = None) -> MarketError:
        market = market or self.market
        before = stamps(market)
        with serving(self.exchange), self.assertRaises(MarketError) as caught:
            store.import_month(market, MAR, self.cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        self.assertEqual(stamps(market), before)
        return caught.exception

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
        results = []
        with serving(found):
            for month in months:
                results.append(store.import_month(profile, month, self.cache, workers, list(scope),
                                                  log=lambda line: None))
        return profile, found, results

    def refused(self, code: str, call, *args, **kwargs) -> MarketError:
        with self.assertRaises(MarketError) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception

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
        self.refused("NO_TERMS", instrument.terms, market, before_listing, "BTCUSDT")
        empty = {"ts_open": [], "volume": []}
        self.refused("UNKNOWN_SYMBOL", coverage.coverage_facts, market, before_listing, "BTCUSDT", 0, MINUTE, empty, empty, [])

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
        self.assertEqual((first["through"], first["bar_rows"], first["source_rows"]["rest"]),
                         ("2025-03-10", 2 * 9 * 1440, 2 * 9 * 1440))
        found.archives.update(march)
        with serving(found), on(date(2025, 4, 2)):
            done = store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        self.assertEqual((done["through"], done["bar_rows"], done["funding_rows"]), ("2025-04-01", 2 * 22 * 1440, 66))
        stored = rows(profile, "funding", ["BTCUSDT"], day_ms(MAR))["funding_time"].to_pylist()
        self.assertEqual((len(stored), stored[0]), (93, day_ms(MAR) + 5))  # one row per settlement; REST's time stays
        with serving(found):
            self.refused("MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
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
                                    datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc), lambda line: None)

    def fingerprint(self, profile: dict, market_day: str) -> str:
        """export_content_sha256 of a fresh export of February at `market_day`, with its membership file."""
        root = Path(tempfile.mkdtemp(prefix="market-export-"))
        self.addCleanup(shutil.rmtree, root, True)
        done = export.export_catalogs(profile, market_day, ["BTCUSDT"], ns(FEB), ns(MAR), fresh=True, root=root)
        market = files.open_market(profile, "reader")
        membership = root / "membership.json"
        membership.write_text(json.dumps(universe.membership_path(market, market_day, ns(MAR)), sort_keys=True))
        return inputs.export_fingerprint({"root": done["root"], "membership_file": membership},
                                         True)["export_content_sha256"]

    def test_on_a_months_first_day_paper_covers_now_after_the_members_and_the_market_day_does_not_change(self):
        profile, found, _ = self.database()
        noon = ns(MAR) + 12 * 3_600_000_000_000
        eve = date(2025, 2, 28).isoformat()
        # Before the members: the newest day is the one before the eve, and paper refuses as it always has.
        with self.assertRaises(MarketError) as caught:
            runs._membership(profile, None, None, noon)
        self.assertEqual(caught.exception.code, "UNIVERSE_NOT_COVERING_WINDOW")
        self.refused("UNKNOWN_REF", files.resolve_day, files.open_market(profile, "reader"), eve)
        self.follow_round(profile, found, MAR)
        self.assertEqual(rows(profile, "bar", ["BTCUSDT"], day_ms(MAR)).num_rows, 0)
        market_day, membership, chosen = runs._membership(profile, None, None, noon)
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
            self.refused("MONTH_INVALID", store.import_month, profile, APR, self.cache, 1, scope, log=lambda line: None)
        self.assertEqual((first["through"], first["bar_rows"], first["funding_rows"], first["universe_members"]),
                         ("2025-03-01", 0, 0, ["BBBUSDT", "BTCUSDT"]))
        self.assertEqual(sorted(set(rows(profile, "universe_month")["month"].to_pylist())), [FEB, MAR])
        with serving(found), on(date(2025, 4, 2)):
            done = store.import_month(profile, MAR, self.cache, 1, scope, log=lambda line: None)
        self.assertEqual((done["through"], done["universe_members"]), ("2025-04-01", ["BBBUSDT", "BTCUSDT"]))
        self.assertEqual(done["bar_rows"], 2 * 2 * 31 * 1440)

    def test_a_first_import_needs_a_closed_day(self):
        profile = directory(self.addCleanup)
        with serving(exchange()), on(MAR):
            self.refused("MONTH_INVALID", store.import_month, profile, MAR, Path(tempfile.mkdtemp()), 1, ["BTCUSDT"],
                         log=lambda line: None)

    def test_a_stored_minute_the_sources_now_contradict_refuses(self):
        profile, found, _ = self.database()
        march = self.tail(found, close="999.99")
        with serving(found), on(date(2025, 3, 10)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        found.archives.update(march)
        with serving(found), on(date(2025, 4, 2)):
            refused = self.refused("MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
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
            refused = self.refused("MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
                                   log=lambda line: None)
        self.assertIn(str(absent), refused.missing)

    def test_a_stored_settlement_the_archive_now_contradicts_refuses(self):
        profile, found, _ = self.database()
        march = self.tail(found, rate="0.0002")
        with serving(found), on(date(2025, 3, 10)):
            store.import_month(profile, MAR, self.cache, 1, ["BTCUSDT"], log=lambda line: None)
        found.archives.update(march)
        with serving(found), on(date(2025, 4, 2)):
            self.refused("MONTH_EXISTS", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
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
            self.refused("UNIVERSE_CHANGED", store.import_month, profile, MAR, self.cache, 1, ["BTCUSDT"],
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


class BackfillTests(unittest.TestCase):
    """The month just before the earliest stored one, imported after the fact: the stored months untouched, and the
    rows the forward import from that month gives."""

    SCOPE = ["BBBUSDT", "BTCDOMUSDT", "BTCUSDT", "CCCUSDT", "USDCUSDT"]
    TABLES = ("bar", "funding", "universe_month")

    @classmethod
    def setUpClass(cls):
        cls.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        cls.addClassCleanup(shutil.rmtree, cls.cache, True)
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

    def refused(self, code: str, profile: dict, month: date, scope=None) -> MarketError:
        before = stamps(profile)
        with serving(self.exchange), self.assertRaises(MarketError) as caught:
            self.imported(profile, month, scope)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        self.assertEqual(stamps(profile), before)
        return caught.exception

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
        self.assertEqual(self.jan["bar_rows"], 2 * (31 * 1440 + 12 * 1440 + 31 * 1440))
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
        cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, cache, True)
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


if __name__ == "__main__":
    unittest.main()
