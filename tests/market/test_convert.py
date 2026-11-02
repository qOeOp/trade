"""market.convert on a throwaway Dolt market: pinned commits become versions under their own ids, the latest
commit the version after them, and the check report compares every table with Dolt."""

from datetime import date
import io
from decimal import Decimal
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pyarrow as pa

from cli import main
from market import convert, store, versions
from market.sources import MarketError
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed


DAY = versions.DAY
JAN = 1_735_689_600_000  # 2025-01-01T00:00Z
FEB = JAN + 31 * DAY
TERMS = [(symbol, {"price_increment": "0.01", "size_increment": "0.001"}) for symbol in ("BTCUSDT", "ETHUSDT")]


def minutes(start: int, count: int, volume: int = 1) -> dict:
    times = start + np.arange(count, dtype=np.int64) * 60_000
    price = np.full(count, 100 * 10**8, dtype=np.int64)
    return {"ts_open": times, **{name: price for name in ("open", "high", "low", "close")},
            "volume": np.full(count, volume, dtype=np.int64)}


def bars(start: int, count: int) -> dict:
    return {(symbol, kind): minutes(start, count, 1 if kind == "LAST" else 0)
            for symbol, _ in TERMS for kind in ("LAST", "MARK")}


def imported(profile: dict, message: dict, statement: str, rows: list[tuple]) -> str:
    with store.connect(profile, "import") as conn:
        conn.many(statement, rows)
        conn.execute("UPDATE market_schema SET import_seq = import_seq + 1")
        commit = store._commit(conn, json.dumps(message, separators=(",", ":")))
        conn.raw.commit()
    return commit


@unittest.skipUnless(BINARY, SKIP)
class Convert(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)

    def setUp(self):
        self.profile = self.fixture.add("convert_" + self._testMethodName.removeprefix("test_")[:40])
        self.first = seed(self.profile, month="2025-01", through="2025-01-16", terms=TERMS, bars=bars(JAN, 60),
                          funding={"BTCUSDT": [(JAN, "0.0001")]})
        seed(self.profile, month="2025-01", through="2025-02-01", terms=[], bars=bars(FEB - DAY, 30),
             funding={"BTCUSDT": [(JAN + 20 * DAY, "-0.0002")]})
        self.second = imported(
            self.profile, {"import": store.QUOTE_IMPORT, "month": "2025-01", "through": "2025-02-01",
                           "quote_rule": "rule-v1", "symbols": ["BTCUSDT"], "archives": {}, "readings": {}},
            "INSERT INTO quote VALUES (%s, %s, %s, %s, %s)", [("BTCUSDT", JAN + 5, 1, 100, 101),
                                                              ("BTCUSDT", JAN + 9, 2, 100, 102)])
        self.trades = imported(
            self.profile, {"import": store.TRADE_IMPORT, "month": "2025-01", "through": "2025-02-01",
                           "symbols": ["ETHUSDT"], "codec": "c", "archives": {}, "readings": {}},
            "INSERT INTO agg_trade VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", [("ETHUSDT", JAN, 7, 5, 1, 7, 7, True)])
        self.latest = seed(self.profile, month="2025-02", through="2025-02-02", terms=[], bars=bars(FEB, 10),
                           members=[(date(2025, 2, 1), "BTCUSDT"), (date(2025, 2, 1), "ETHUSDT")])
        self.root = Path(tempfile.mkdtemp()) / "market"
        self.addCleanup(shutil.rmtree, self.root.parent, True)
        self.pinned = (("main", (self.first, self.second)),)

    def convert(self, **options) -> dict:
        with patch.dict(versions.CONVERTED, clear=True):
            return convert.convert(self.profile, self.root, workers=2, pinned=self.pinned, log=lambda line: None,
                                   **options)

    def test_pinned_commits_keep_their_ids_and_every_table_matches_dolt(self):
        found = self.convert()
        self.assertEqual(found["findings"], [])
        first, second, latest = found["versions"]
        self.assertEqual((first["commit"], second["commit"], latest["dolt_commit"]),
                         (self.first, self.second, self.latest))
        self.assertEqual((first["parent"], second["parent"], latest["parent"]), (None, self.first, self.second))
        self.assertEqual(found["head"], latest["commit"])
        self.assertEqual((self.root / "head").read_text().strip(), latest["commit"])
        self.assertEqual(sorted(found["converted"]), sorted([self.first, self.second]))
        self.assertEqual(latest["rows"]["bar"], {"dolt": 400, "files": 400})
        self.assertEqual(second["rows"]["agg_trade"], {"dolt": 0, "files": 0})
        self.assertEqual(latest["schema_version"], versions.SCHEMA_VERSION)

        version = json.loads((self.root / "versions" / f"{latest['commit']}.json").read_text())
        self.assertEqual(versions.version_id(version), latest["commit"])
        spans = [(entry["table"], entry["symbol"], entry["start_ms"], entry["end_ms"]) for entry in version["files"]]
        self.assertEqual(spans, [
            ("bar", None, JAN, JAN + 15 * DAY), ("funding", None, JAN, JAN + 15 * DAY),
            ("instrument", None, 1, 2),
            ("bar", None, JAN + 15 * DAY, FEB), ("funding", None, JAN + 15 * DAY, FEB),
            ("quote", "BTCUSDT", JAN, FEB),
            ("agg_trade", "ETHUSDT", JAN, FEB),
            ("bar", None, FEB, FEB + DAY), ("universe_month", None, FEB, FEB + 28 * DAY)])
        receipts = [json.loads((self.root / "files" / f"{sha}.json").read_text())["import"]
                    for sha in version["receipts"]]
        self.assertEqual(receipts, ["binance-bars", "binance-bars", "binance-quotes", "binance-aggtrades",
                                    "binance-bars"])

        with patch.dict(versions.CONVERTED, found["converted"]):
            market = versions.open_market({"root": str(self.root)}, "reader")
            quotes = pa.Table.from_batches(list(versions.read_table(market, self.second, "quote")))
            self.assertEqual(quotes.to_pylist(), [
                {"symbol": "BTCUSDT", "ts": JAN + 5, "agg_trade_id": 1, "bid": 100, "ask": 101},
                {"symbol": "BTCUSDT", "ts": JAN + 9, "agg_trade_id": 2, "bid": 100, "ask": 102}])
            trades = pa.Table.from_batches(list(versions.read_table(market, market.head, "agg_trade")))
            self.assertEqual(trades.column("is_buyer_maker").to_pylist(), [True])
            self.assertEqual(versions.read_table(market, self.first, "funding").__next__().column("rate").to_pylist(),
                             [Decimal("0.0001000000")])
            terms = versions.read_table(market, self.first, "instrument").__next__().column("classification")
            self.assertEqual(terms[0].as_py(), json.dumps({"contract_type": "PERPETUAL", "quote_asset": "USDT",
                                                           "underlying_sub_types": [], "underlying_type": "COIN"}))

    def test_the_same_dolt_history_gives_the_same_bytes(self):
        found = self.convert()
        self.root = Path(tempfile.mkdtemp()) / "again"
        self.addCleanup(shutil.rmtree, self.root.parent, True)
        self.assertEqual(self.convert()["converted"], found["converted"])

    def test_refusals(self):
        self.root.mkdir()
        (self.root / "stray").write_text("x")
        with self.assertRaises(MarketError) as raised:
            self.convert()
        self.assertEqual(raised.exception.code, "LEDGER_EXISTS")
        (self.root / "stray").unlink()
        self.pinned = (("main", (self.second, self.first)),)
        with self.assertRaises(MarketError) as raised:
            self.convert()
        self.assertEqual(raised.exception.code, "HISTORY_REWRITTEN")

    def test_command_checks_the_ledgers_pinned_commits(self):
        with patch("sys.stdout", new_callable=io.StringIO), patch("sys.stderr", new_callable=io.StringIO) as err:
            code = main.main(["market", "convert", "--market", self.profile["name"], "--into", str(self.root)])
        self.assertEqual((code, json.loads(err.getvalue())["code"]), (1, "HISTORY_REWRITTEN"))

    def test_a_metrics_import_is_one_file_per_contract_from_its_first_day(self):
        imported(self.profile, {"import": store.METRICS_IMPORT, "month": "2025-02", "from": "2025-02-01",
                                "through": "2025-02-02", "symbols": ["BTCUSDT"], "archives": {}, "readings": {}},
                 "INSERT INTO metrics VALUES (%s, %s, %s, %s, %s, %s)", [("BTCUSDT", FEB, "12.5", None, None, None)])
        found = self.convert()
        self.assertEqual(found["findings"], [])
        version = json.loads((self.root / "versions" / f"{found['head']}.json").read_text())
        self.assertEqual([(entry["symbol"], entry["start_ms"], entry["end_ms"]) for entry in version["files"]
                          if entry["table"] == "metrics"], [("BTCUSDT", FEB, FEB + DAY)])

    def test_rows_an_import_adds_outside_its_interval_are_reported(self):
        late = imported(self.profile, {"import": store.IMPORT, "month": "2025-02", "through": "2025-02-03",
                                       "universe_rule": "r", "scope": "all"},
                        "INSERT INTO bar VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        [("BTCUSDT", "LAST", JAN + 3 * DAY, *[100 * 10**8] * 4, 1)])
        found = self.convert()
        self.assertIn({"check": "CHECK_FAILED", "commit": late, "detail": "bar: the commit adds 1 rows, its files hold 0"},
                      found["findings"])

    def test_an_import_changing_stored_rows_is_refused(self):
        self.fixture.admin(self.profile, "UPDATE quote SET bid = 99 WHERE agg_trade_id = 2")
        self.fixture.admin(self.profile, "CALL DOLT_COMMIT('-a', '-m', %s, '--author', 'market_writer <w@x>')",
                           (json.dumps({"import": store.QUOTE_IMPORT, "month": "2025-02", "through": "2025-02-02",
                                        "symbols": []}),))
        with self.assertRaises(MarketError) as raised:
            self.convert()
        self.assertEqual(raised.exception.code, "HISTORY_REWRITTEN")
        self.assertIn("1 modified", str(raised.exception))

    def test_an_administrator_commit_changing_rows_is_refused(self):
        self.fixture.admin(self.profile, "DELETE FROM quote WHERE agg_trade_id = 2")
        self.fixture.admin(self.profile, "CALL DOLT_COMMIT('-a', '-m', 'market tables')")
        self.pinned = (("main", (self.first,)),)
        with self.assertRaises(MarketError) as raised:
            self.convert()
        self.assertEqual(raised.exception.code, "HISTORY_REWRITTEN")


if __name__ == "__main__":
    unittest.main()
