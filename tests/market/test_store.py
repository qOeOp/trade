"""The market database on a throwaway Dolt service: accounts, freshness, the pool and a Catalog export."""

from datetime import date
import unittest

import numpy as np
import pyarrow as pa

from market import export, store
from research.records import db
from research.records.common import RecordError
from tests.records.dolt import BINARY, SKIP, TemporaryLedger


MINUTE = 60_000
DAY = 86_400_000
START = 1_759_795_200_000  # 2025-10-07T00:00:00Z
TERMS = ("BTCUSDT", 1, "exchange_info", "0.10", "0.001", "0.001", "1000", "50", "556.80", "4529764")


def minute_rows(price_type: str, start: int, count: int, *, volume: str):
    """Archive-shaped rows walking up one cent a minute; every 7th LAST minute does not trade."""
    rows = []
    for i in range(count):
        price = f"{100000 + i / 100:.2f}"
        traded = volume if price_type == "MARK" or i % 7 else "0"
        rows.append((start + i * MINUTE, price, price, price, price, traded if price_type == "LAST" else "0"))
    return rows


@unittest.skipUnless(BINARY, SKIP)
class MarketDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryLedger("market-test", of="market")
        cls.profile = cls.fixture.profile
        warmup = START - 210 * DAY
        conn = db.connect(cls.profile, "writer")
        try:
            with conn.cursor() as cursor:
                cursor.execute("INSERT INTO instrument VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)", TERMS)
                for price_type, first, count in (("LAST", warmup, (START - warmup) // MINUTE + 2 * 1440),
                                                 ("MARK", START, 2 * 1440)):
                    rows, _ = store.bar_rows(_table(minute_rows(price_type, first, count, volume="1.5")),
                                             "BTCUSDT", price_type)
                    for statement in store.insert_statements(rows, "BTCUSDT", price_type):
                        cursor.execute(statement)
                cursor.executemany("INSERT INTO funding VALUES ('BTCUSDT', %s, %s)",
                                   [(START + 8 * 3_600_000 * k + 2, "0.0001") for k in range(6)])
                cursor.executemany("INSERT INTO daily_volume VALUES ('BTCUSDT', %s, %s)",
                                   [(date(2025, 9, d), "1000") for d in range(1, 31)])
                cursor.execute("INSERT INTO pool VALUES (%s, 1, 'BTCUSDT')", (date(2025, 10, 1),))
                cursor.execute("CALL DOLT_COMMIT('-A', '-m', 'fixture')")
        finally:
            conn.close()

    @classmethod
    def tearDownClass(cls):
        cls.fixture.close()

    def test_the_writer_can_only_insert(self):
        conn = db.connect(self.profile, "writer")
        self.addCleanup(conn.close)
        for statement in ("UPDATE bar SET close = 1", "DELETE FROM pool", "CALL DOLT_RESET('--hard', 'HEAD~1')",
                          "DROP TABLE funding"):
            with self.subTest(statement=statement), self.assertRaises(RecordError):
                db.rows(conn, statement)

    def test_constraints_refuse_impossible_rows(self):
        conn = db.connect(self.profile, "writer")
        self.addCleanup(conn.close)
        for statement in ("INSERT INTO bar VALUES ('XUSDT', 'LAST', 0, 2, 1, 1, 1, 0)",
                          "INSERT INTO bar VALUES ('XUSDT', 'MARK', 0, 1, 1, 1, 1, 5)",
                          "INSERT INTO funding VALUES ('XUSDT', 0, 2)",
                          "INSERT INTO pool VALUES ('2025-10-02', 2, 'XUSDT')",
                          "INSERT INTO instrument VALUES ('XUSDT', 0, 'inferred', '0.1', '1', '1', NULL, NULL, NULL, NULL)"):
            with self.subTest(statement=statement), self.assertRaises(RecordError):
                db.rows(conn, statement)
        self.assertEqual(db.rows(conn, "SELECT COUNT(*) FROM dolt_status")[0][0], 0)

    def test_freshness_and_pool(self):
        fresh = store.freshness(self.profile)
        self.assertEqual((fresh["covered_through"], fresh["latest_complete_month"], fresh["current_month_through"]),
                         ("2025-10-09", "2025-09", "2025-10-08"))
        self.assertEqual(store.read_pool(self.profile)["months"], {"2025-10": ["BTCUSDT"]})

    def test_export_loads_whole_into_the_native_node(self):
        from nautilus_trader.backtest import BacktestDataConfig, BacktestEngineConfig, BacktestNode, \
            BacktestRunConfig, BacktestVenueConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import AccountType, BookType, Currency, InstrumentId, OmsType
        iid = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
        from nautilus_trader.persistence import ParquetDataCatalog
        end = START + 2 * DAY
        result = export.export(self.profile, at=None, symbols=["BTCUSDT"], start=START, end=end, fresh=True)
        self.addCleanup(__import__("shutil").rmtree, result["root"], True)
        receipt = result["receipts"]["BTCUSDT"]
        self.assertEqual(receipt["counts"], {"last": 2880, "mark": 2880, "funding": 6, "daily": 210})
        self.assertEqual((receipt["timeframe"], receipt["episode"]), ("1m", None))
        self.assertEqual((receipt["price_precision"], receipt["price_precision_widened"]), (2, False))
        path = f"{result['root']}/BTCUSDT"
        catalog = ParquetDataCatalog(path)
        bars = catalog.query_bars(["BTCUSDT-PERP.BINANCE"])
        minutes = [bar for bar in bars if str(bar.bar_type) == "BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"]
        # The stored minutes, unchanged: the window's first minute (302,400th of the series) did not trade.
        self.assertEqual(len(minutes), 2880)
        self.assertEqual((str(minutes[0].open), str(minutes[0].close), str(minutes[0].volume)),
                         ("103024.00", "103024.00", "0.000"))
        self.assertEqual(minutes[0].ts_event, (START + MINUTE - 1) * 1_000_000)
        node = BacktestNode([BacktestRunConfig(
            venues=[BacktestVenueConfig(name="BINANCE", oms_type=OmsType.NETTING, account_type=AccountType.MARGIN,
                                        book_type=BookType.L1_MBP, starting_balances=["100000 USDT"],
                                        base_currency=Currency.from_str("USDT"))],
            data=[BacktestDataConfig(data_type="MarkPriceUpdate", catalog_path=path, instrument_id=iid),
                  BacktestDataConfig(data_type="FundingRateUpdate", catalog_path=path, instrument_id=iid),
                  BacktestDataConfig(data_type="Bar", catalog_path=path, instrument_id=iid,
                                     bar_types=["BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"])],
            engine=BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.ERROR)))])
        self.assertEqual(node.run()[0].iterations, 2880 + 2880 + 6)
        from engine.load import mark_timestamps
        self.assertEqual(mark_timestamps([{"catalog_path": __import__("pathlib").Path(path)}]), 2880)
        again = export.export(self.profile, at=None, symbols=["BTCUSDT"], start=START, end=end,
                              root=__import__("pathlib").Path(result["root"]).parent)
        self.assertEqual(again["exported"], 1)


class LifecycleExportTests(unittest.TestCase):
    """A delisting episode bounds the export and its events reach BacktestNode natively."""

    @classmethod
    def setUpClass(cls):
        MarketDatabaseTests.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        cls.fixture.close()

    def test_a_delisting_bounds_the_series_and_delivers_its_events(self):
        from pathlib import Path
        from nautilus_trader.backtest import BacktestDataConfig, BacktestEngineConfig, BacktestNode, \
            BacktestRunConfig, BacktestVenueConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import AccountType, BookType, Currency, InstrumentId, OmsType
        from market import lifecycle
        iid = "BTCUSDT-PERP.BINANCE"
        closed = (START + DAY) * 1_000_000

        def status(action, at):
            return {"type": "InstrumentStatus", "instrument_id": iid, "action": action, "ts_event": at, "ts_init": at,
                    "reason": "delisting", "trading_event": None, "is_trading": None, "is_quoting": None,
                    "is_short_sell_restricted": None}
        body = {"format": lifecycle.FORMAT, "market_commit": None, "episodes": [
            {"symbol": "BTCUSDT", "instrument_id": iid, "start_ns": 0, "sources": ["notice.txt"],
             "events": [status("PRE_CLOSE", closed - 1_800_000_000_000), status("CLOSE", closed)]}]}
        conn = db.connect(self.profile, "reader")
        try:
            body["market_commit"] = store.resolve(conn, None)
        finally:
            conn.close()
        files = {"lifecycle.json": b"{}", "notice.txt": b"the exchange notice"}
        episodes = lifecycle.validate_lifecycle(body, body["market_commit"], files)
        result = export.export(self.profile, at=None, symbols=["BTCUSDT"], start=START, end=START + 2 * DAY,
                               fresh=True, episodes=episodes, lifecycle_files=files)
        self.addCleanup(__import__("shutil").rmtree, result["root"], True)
        receipt = result["receipts"]["BTCUSDT"]
        self.assertEqual(receipt["counts"], {"last": 1440, "mark": 1440, "funding": 3, "daily": 210,
                                             "instrument_close": 0, "instrument_status": 2})
        self.assertEqual(receipt["episode"]["events"][-1]["action"], "CLOSE")
        self.assertEqual((Path(result["root"]) / "lifecycle-evidence" / "notice.txt").read_bytes(), b"the exchange notice")
        path = f"{result['root']}/BTCUSDT"
        data = [BacktestDataConfig(data_type=kind, catalog_path=path, instrument_id=InstrumentId.from_str(iid))
                for kind in ("MarkPriceUpdate", "FundingRateUpdate", "InstrumentStatus")]
        data.append(BacktestDataConfig(data_type="Bar", catalog_path=path, instrument_id=InstrumentId.from_str(iid),
                                       bar_types=[f"{iid}-1-MINUTE-LAST-EXTERNAL"]))
        node = BacktestNode([BacktestRunConfig(
            venues=[BacktestVenueConfig(name="BINANCE", oms_type=OmsType.NETTING, account_type=AccountType.MARGIN,
                                        book_type=BookType.L1_MBP, starting_balances=["100000 USDT"],
                                        base_currency=Currency.from_str("USDT"))],
            data=data, engine=BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.ERROR)))])
        self.assertEqual(node.run()[0].iterations, 1440 + 1440 + 3 + 2)
        for wrong in ({**body, "market_commit": "other"},
                      {**body, "episodes": [{**body["episodes"][0], "sources": ["absent.txt"]}]},
                      {**body, "episodes": [{**body["episodes"][0], "events": [status("CLOSE", closed),
                                                                               status("PRE_CLOSE", closed + 1)]}]}):
            with self.subTest(wrong=wrong), self.assertRaises(lifecycle.LifecycleInput):
                lifecycle.validate_lifecycle(wrong, body["market_commit"], files)


def _table(rows):
    return pa.table([pa.array([row[0] for row in rows], pa.int64()),
                     *(pa.array([row[i] for row in rows], pa.string()) for i in range(1, 6)),
                     pa.array([row[0] + MINUTE - 1 for row in rows], pa.int64())], schema=store._SCHEMA)


if __name__ == "__main__":
    unittest.main()
