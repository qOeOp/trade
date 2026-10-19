"""The market database on a throwaway Dolt service, imported month by month from a stand-in exchange:
schema initialization, stitching, the universe rule, the import's refusals, freshness, membership,
coverage, daily returns and a Catalog export the engine streams whole."""

from __future__ import annotations

from datetime import date, datetime, timezone
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from market import coverage, export, lifecycle, read, store, universe
from market.sources import MarketError
from tests.market.dolt import BINARY, SKIP, TemporaryMarket
from tests.market.exchange import DAY, MINUTE, Exchange, day_ms, minutes, serving


JAN, FEB, MAR, APR = (date(2025, month, 1) for month in (1, 2, 3, 4))
LISTED = day_ms(date(2025, 1, 20))  # BBBUSDT's first minute
DELISTED = day_ms(date(2025, 2, 10))  # CCCUSDT's last minute ends here
EIGHT_HOURS = 8 * 3_600_000


def exchange() -> Exchange:
    """BTCUSDT trades throughout; BBBUSDT lists on 2025-01-20; CCCUSDT stops on 2025-02-10 and has left
    exchangeInfo; USDCUSDT (stablecoin) and BTCDOMUSDT (index) are listed. The March MARK archive lacks
    2025-03-15, which its daily archive holds."""
    found = Exchange(server_time=day_ms(date(2025, 4, 2)))
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


@unittest.skipUnless(BINARY, SKIP)
class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)
        cls.profile = cls.fixture.profile
        cls.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        cls.addClassCleanup(shutil.rmtree, cls.cache, True)
        cls.exchange = exchange()
        cls.scope = ["BBBUSDT", "BTCDOMUSDT", "BTCUSDT", "CCCUSDT", "USDCUSDT"]
        cls.results = {}
        with serving(cls.exchange):
            for month in (JAN, FEB):
                cls.results[month] = cls.imported(month)
        cls.fresh_after = {}
        with store.connect(cls.profile, "reader") as conn:
            cls.commits = {FEB: store.resolve_commit(conn, "main")}
        with serving(cls.exchange):
            cls.results[MAR] = cls.imported(MAR)
        with store.connect(cls.profile, "reader") as conn:
            cls.commits[MAR] = store.resolve_commit(conn, "main")
            cls.commits[JAN] = cls.results[JAN]["market_commit"]

    @classmethod
    def imported(cls, month: date, profile: dict | None = None, scope=None) -> dict:
        return store.import_month(profile or cls.profile, month, cls.cache, 1, scope or cls.scope, log=lambda line: None)

    def refused(self, code: str, call, *args, **kwargs) -> MarketError:
        with self.assertRaises(MarketError) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception

    def test_the_first_import_initializes_the_empty_database_and_produces_no_universe(self):
        first = self.results[JAN]
        self.assertEqual(first["universe_members"], [])
        self.assertEqual(first["excluded"], {"BTCDOMUSDT": "index", "USDCUSDT": "stablecoin"})
        self.assertEqual(first["inferred_terms"], ["CCCUSDT"])
        self.assertEqual(first["bar_rows"], 2 * (31 * 1440 + 12 * 1440 + 31 * 1440))
        self.assertEqual(first["derived_findings"], {})  # derived daily bars equal the exchange's
        self.refused("MARKET_EMPTY", store.freshness, self.profile, self.commits[JAN])
        with store.connect(self.profile, "reader") as conn:
            tests = conn.rows(f"SELECT test_name FROM dolt_tests AS OF '{self.commits[JAN]}' ORDER BY test_name")
            schema = conn.rows(f"SELECT version, universe_rule, import_seq FROM market_schema AS OF '{self.commits[JAN]}'")
            terms = dict(conn.rows(f"SELECT symbol, terms_source FROM instrument AS OF '{self.commits[JAN]}'"))
        self.assertEqual([name for (name,) in tests], sorted(name for name, _ in store.TESTS))
        self.assertEqual(schema, [(store.SCHEMA_VERSION, universe.RULE, 1)])
        self.assertEqual(terms, {"BBBUSDT": "exchange_info", "BTCDOMUSDT": "exchange_info", "BTCUSDT": "exchange_info",
                                 "CCCUSDT": "inferred", "USDCUSDT": "exchange_info"})

    def test_members_need_thirty_unbroken_days_and_a_delisted_contract_keeps_its_months(self):
        self.assertEqual(self.results[FEB]["universe_members"], ["BTCUSDT", "CCCUSDT"])  # BBBUSDT: 12 days
        self.assertEqual(self.results[MAR]["universe_members"], ["BBBUSDT", "BTCUSDT"])  # CCCUSDT stopped
        with store.connect(self.profile, "reader") as conn:
            path = universe.membership_path(conn, self.commits[MAR], ns(APR))
            self.refused("UNIVERSE_NOT_COVERING_WINDOW", universe.membership_path, conn, self.commits[MAR],
                         ns(date(2025, 4, 2)))
            self.refused("UNIVERSE_EMPTY_AT_COMMIT", universe.membership_path, conn, self.commits[JAN], ns(FEB))
            self.refused("MARKET_COMMIT_UNRESOLVED", universe.membership_path, conn, "main", ns(FEB))
        self.assertEqual(path["universe_rule"], universe.RULE)
        self.assertEqual(path["membership"], {"BTCUSDT": [[ns(FEB), ns(APR)]], "CCCUSDT": [[ns(FEB), ns(MAR)]],
                                              "BBBUSDT": [[ns(MAR), ns(APR)]]})

    def test_a_month_missing_from_its_monthly_archive_comes_from_the_daily_archive(self):
        third = self.results[MAR]
        self.assertEqual(third["gaps"], {})
        self.assertEqual(third["source_rows"], {"monthly": third["bar_rows"] - 1440, "daily": 1440, "rest": 0})
        self.assertEqual(third["per_symbol"]["BTCUSDT"]["bars"], {"LAST": 31 * 1440, "MARK": 31 * 1440})

    def test_freshness_reads_the_commit_and_the_import_scope(self):
        fresh = store.freshness(self.profile)
        self.assertEqual(fresh, {"commit": self.commits[MAR], "universe_rule": universe.RULE,
                                 "universe_months": ["2025-02", "2025-03"], "symbols": 3, "covered_through": day_ms(APR),
                                 "latest_complete_day": date(2025, 3, 31), "latest_complete_month": "2025-03",
                                 "current_month_through": None, "scope": self.scope})
        self.assertEqual(store.freshness(self.profile, self.commits[FEB])["covered_through"], day_ms(MAR))

    def test_months_import_once_and_in_order_with_one_scope(self):
        with serving(self.exchange):
            self.refused("MONTH_EXISTS", self.imported, MAR)
            self.refused("MONTH_INVALID", self.imported, date(2025, 5, 1))
            self.refused("MONTH_INVALID", self.imported, date(2099, 1, 1))
            self.refused("MONTH_INVALID", self.imported, date(2025, 4, 2))
            self.refused("IMPORT_SCOPE", self.imported, APR, scope=["BTCUSDT"])
            self.refused("IMPORT_SCOPE", self.imported, APR, scope=["BTCUSDT", "BTCUSDT"])
            self.refused("IMPORT_SCOPE", self.imported, APR, {**self.profile, "role": "active"})

    def test_the_accounts_insert_or_read_only(self):
        with store.connect(self.profile, "import") as conn:
            for statement in ("UPDATE bar SET close = 1", "DELETE FROM universe_month", "DROP TABLE funding",
                              "CALL DOLT_RESET('--hard', 'HEAD~1')", "UPDATE dolt_tests SET assertion_value = '1'"):
                with self.subTest(statement=statement):
                    self.refused("MARKET_PERMISSION", conn.rows, statement)
            self.refused("MARKET_SQL_ERROR", conn.rows, "INSERT INTO funding VALUES ('XUSDT', 1, 2)")  # rate CHECK
            conn.raw.rollback()
        with store.connect(self.profile, "reader") as conn:
            self.refused("MARKET_PERMISSION", conn.rows, "INSERT INTO funding VALUES ('XUSDT', 1, 0)")
        self.refused("ROLE_UNKNOWN", store.connect, self.profile, "writer")
        self.refused("MARKET_UNREACHABLE", store.connect, {**self.profile, "database": "market_absent"}, "reader")

    def test_references_resolve_to_one_commit(self):
        with store.connect(self.profile, "reader") as conn:
            self.assertEqual(store.resolve_commit(conn, None), self.commits[MAR])
            self.assertEqual(store.resolve_commit(conn, self.commits[FEB][:12]), self.commits[FEB])
            self.refused("NOT_A_COMMIT", store.resolve_commit, conn, "WORKING")
            self.refused("UNKNOWN_REF", store.resolve_commit, conn, "no-such-branch")
            self.refused("UNKNOWN_REF", store.resolve_commit, conn, "a..b")

    def test_coverage_facts_and_their_refusals(self):
        found = coverage.diagnose_coverage(self.profile, None, ["BBBUSDT", "CCCUSDT"], "2025-02-09T00:00:00Z",
                                           "2025-02-11T00:00:00Z", None)
        bbb, ccc = found["coverage"]
        self.assertEqual((bbb["last"]["missing_minutes"], bbb["member_months"]), (0, ["2025-03-01"]))
        self.assertEqual(ccc["last"]["gap_intervals_ms"], [[DELISTED, DELISTED + DAY]])
        self.assertEqual(ccc["listing_delisting"]["data_bounds_proxy"]["last"],
                         {"first_open_ms": day_ms(JAN), "last_open_ms": DELISTED - MINUTE})
        self.assertEqual(ccc["funding"]["rows"], 3)
        with store.connect(self.profile, "reader") as conn:
            commit, empty = self.commits[MAR], {"ts_open": [], "volume": []}
            self.refused("INTERVAL_INVALID", coverage.coverage_facts, conn, commit, "BTCUSDT", 1, 2, empty, empty, [])
            self.refused("MARKET_COMMIT_INVALID", coverage.coverage_facts, conn, "main", "BTCUSDT", 0, MINUTE, empty,
                         empty, [])
            self.refused("UNKNOWN_SYMBOL", coverage.coverage_facts, conn, commit, "ZZZUSDT", 0, MINUTE, empty, empty, [])
            self.refused("SOURCE_SHAPE", coverage.coverage_facts, conn, commit, "BTCUSDT", 0, 3 * MINUTE,
                         {"ts_open": [MINUTE, 0], "volume": [1, 1]}, empty, [])
        self.refused("EMPTY_SYMBOLS", coverage.diagnose_coverage, self.profile, None, [], "2025-02-09T00:00:00Z",
                     "2025-02-11T00:00:00Z", None)
        self.refused("INTERVAL_INVALID", coverage.diagnose_coverage, self.profile, None, ["BTCUSDT"],
                     "2025-02-09T00:00:00", "2025-02-11T00:00:00Z", None)

    def test_daily_returns_of_btc_and_the_equal_weight_universe(self):
        found = read.daily_returns(self.profile, self.commits[MAR], universe.RULE,
                                   datetime(2025, 3, 2, tzinfo=timezone.utc), datetime(2025, 3, 4, tzinfo=timezone.utc))
        self.assertEqual((found["days"], found["members_per_day"]), (["2025-03-02", "2025-03-03"], [2, 2]))
        self.assertEqual(found["btc"], found["basket"])  # both members walk the same prices
        self.refused("MARKET_RETURNS_WINDOW", read.daily_returns, self.profile, self.commits[MAR], universe.RULE,
                     datetime(2025, 3, 2, 5, tzinfo=timezone.utc), datetime(2025, 3, 2, 9, tzinfo=timezone.utc))
        self.refused("RULE_VERSION_MISMATCH", read.daily_returns, self.profile, self.commits[MAR], "other-v1",
                     datetime(2025, 3, 2, tzinfo=timezone.utc), datetime(2025, 3, 4, tzinfo=timezone.utc))

    def test_an_export_loads_whole_into_the_engine_stream(self):
        from engine import run
        from engine.load import mark_timestamps, read_market
        start, end = ns(MAR), ns(date(2025, 3, 3))
        root = Path(tempfile.mkdtemp(prefix="market-export-test-"))
        self.addCleanup(shutil.rmtree, root, True)
        done = export.export_catalogs(self.profile, None, ["BTCUSDT"], start, end, root=root)
        receipt = done["receipts"]["BTCUSDT"]
        piece, = receipt["pieces"]
        self.assertEqual(piece["counts"], {"last": 2880, "mark": 2880, "funding": 6, "daily": 61,
                                           "instrument_close": 0, "instrument_status": 0})
        self.assertEqual((piece["instrument_id"], piece["catalog_dir"], piece["price_precision"],
                          piece["mark_precision"], receipt["timeframe"]), ("BTCUSDT-PERP.BINANCE", "", 2, 8, "1m"))
        self.assertEqual(receipt["coverage"]["member_months"], ["2025-02-01", "2025-03-01"])
        again = export.export_catalogs(self.profile, None, ["BTCUSDT"], start, end, root=root)
        self.assertEqual((again["exported"], again["cached"]), (0, 1))
        rows = read_market(Path(done["root"]), ["BTCUSDT"], self.commits[MAR], start, end)
        streamed = list(run.market_events(rows, start, end))
        self.assertEqual(len(streamed), 2880 + 2880 + 6)  # the daily warm-up bars are not streamed
        self.assertEqual([type(event).__name__ for event in streamed].count("FundingRateUpdate"), 6)
        first_mark = next(event for event in streamed if type(event).__name__ == "MarkPriceUpdate")
        self.assertEqual(str(first_mark.value), f"{100 + (day_ms(MAR) // MINUTE) % 997 / 100:.2f}345678")
        self.assertEqual(mark_timestamps(rows), 2880)
        self.assertRaises(MarketError, export.export_catalogs, self.profile, None, ["BTCUSDT"], start + 1, end)
        for code, args in (("EXPORT_WINDOW", (["BTCUSDT"], end, start)), ("EXPORT_SCOPE", (["BTCUSDT", "BTCUSDT"], start,
                                                                                            end))):
            with self.subTest(code=code):
                self.refused(code, export.export_catalogs, self.profile, None, *args)
        self.refused("MARKET_COMMIT", export.export_catalogs, self.profile, "no-such-ref", ["BTCUSDT"], start, end)
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
        body = {"format": lifecycle.FORMAT, "market_commit": self.commits[MAR], "episodes": [
            {"symbol": "CCCUSDT", "instrument_id": iid, "start_ns": 0, "sources": ["notice.txt"],
             "events": [status("PRE_CLOSE", closed - 3_600_000_000_000), status("CLOSE", closed),
                        {"type": "InstrumentClose", "instrument_id": iid, "close_price": "100.01",
                         "close_type": "CONTRACT_EXPIRED", "ts_event": closed, "ts_init": closed}]}]}
        files = {"lifecycle.json": json.dumps(body).encode(), "notice.txt": b"the exchange notice"}
        episodes = lifecycle.validate_lifecycle(body, self.commits[MAR], files)
        start, end = ns(FEB), ns(date(2025, 2, 15))
        done = export.export_catalogs(self.profile, self.commits[MAR], ["CCCUSDT"], start, end, episodes, files,
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
        rows = read_market(Path(done["root"]), ["CCCUSDT"], self.commits[MAR], start, end)
        self.assertEqual((rows[0]["coin"], rows[0]["strategy_id"]), ("CCC_E1", "R1-CCC_E1"))
        tail = [(type(event).__name__, getattr(event, "action", None) and event.action.name)
                for event in list(run.market_events(rows, start, end))[-2:]]
        self.assertEqual(tail, [("InstrumentStatus", "CLOSE"), ("InstrumentClose", None)])
        for wrong in ({**body, "market_commit": self.commits[FEB]},
                      {**body, "episodes": [{**body["episodes"][0], "sources": ["absent.txt"]}]},
                      {**body, "episodes": [{**body["episodes"][0], "events": body["episodes"][0]["events"][2:]}]}):
            with self.subTest(wrong=wrong):
                self.refused("LIFECYCLE_INPUT", lifecycle.validate_lifecycle, wrong, self.commits[MAR], files)
        off_grid = {**body, "episodes": [{**body["episodes"][0], "events": [
            *body["episodes"][0]["events"][:2], {**body["episodes"][0]["events"][2], "close_price": "100.015"}]}]}
        self.refused("LIFECYCLE_INPUT", export.export_catalogs, self.profile, self.commits[MAR], ["CCCUSDT"], start, end,
                     lifecycle.validate_lifecycle(off_grid, self.commits[MAR], files), files, True)


@unittest.skipUnless(BINARY, SKIP)
class ImportRefusalTests(unittest.TestCase):
    """What an import refuses on a database another hand changed; each refusal leaves the head as it was."""

    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket("market_changed")
        cls.addClassCleanup(cls.fixture.close)
        cls.profile = cls.fixture.profile
        cls.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        cls.addClassCleanup(shutil.rmtree, cls.cache, True)
        cls.exchange = exchange()
        with serving(cls.exchange):
            for month in (JAN, FEB):
                store.import_month(cls.profile, month, cls.cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)

    def admin(self, statement: str, params=None):
        return self.fixture.admin(self.profile, statement, params)

    def head(self) -> str:
        return self.admin("SELECT hash FROM dolt_branches WHERE name = 'main'")[0][0]

    def refused(self, code: str) -> None:
        before = self.head()
        with serving(self.exchange), self.assertRaises(MarketError) as caught:
            store.import_month(self.profile, MAR, self.cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        self.assertEqual(self.head(), before)

    def committed(self, statement: str, params=None) -> None:
        self.admin(statement, params)
        self.admin("CALL DOLT_COMMIT('-A', '--skip-verification', '-m', 'changed by hand')")

    def undo(self) -> None:
        self.admin("CALL DOLT_RESET('--hard', 'HEAD~1')")

    def test_an_import_refuses_what_it_cannot_append_to(self):
        self.admin("INSERT INTO funding VALUES ('XUSDT', 1, 0)")
        self.refused("DIRTY_WORKING_SET")
        self.admin("CALL DOLT_RESET('--hard')")
        self.committed("INSERT INTO universe_month VALUES (%s, '2025-02-01', 'XUSDT')", (universe.RULE,))
        self.refused("UNIVERSE_CHANGED")
        self.undo()
        self.committed("INSERT INTO universe_month VALUES ('other-rule-v1', '2099-01-01', 'XUSDT')")
        self.refused("DATA_TESTS_FAILED")
        self.assertEqual(self.admin("SELECT COUNT(*) FROM dolt_status")[0][0], 0)
        self.undo()
        self.committed("UPDATE market_schema SET universe_rule = 'other-rule-v1'")
        self.refused("RULE_VERSION_MISMATCH")
        self.undo()
        with serving(self.exchange):
            done = store.import_month(self.profile, MAR, self.cache, 1, ["BTCUSDT", "CCCUSDT"], log=lambda line: None)
        self.assertEqual(done["universe_members"], ["BTCUSDT"])

    def test_a_reader_refuses_a_database_never_imported(self):
        empty = self.fixture.add("market_empty")
        with self.assertRaises(MarketError) as caught:
            store.connect(empty, "reader")
        self.assertEqual(caught.exception.code, "SCHEMA_VERSION_MISMATCH")
        with store.connect(empty, "import") as conn:
            self.assertTrue(conn.empty)


if __name__ == "__main__":
    unittest.main()
