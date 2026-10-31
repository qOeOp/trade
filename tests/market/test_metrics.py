"""Open interest and long/short ratio imports in throwaway markets; no active database or real network."""

from datetime import UTC, date, datetime
from decimal import Decimal
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from cli import main
from market import coverage, metrics, sources, store
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed
from tests.market.exchange import Exchange, day_ms, serving, zipped


JAN = date(2025, 1, 1)
START = day_ms(JAN)
HEADER = ",".join(metrics.COLUMNS) + "\n"


def stamp(at: int) -> str:
    return datetime.fromtimestamp(at / 1000, UTC).strftime("%Y-%m-%d %H:%M:%S")


def line(at: int, oi="1000.5000000000000000", ratios=("1.25", "2.50000000", "0.75"), symbol="BTCUSDT") -> str:
    return f"{stamp(at)},{symbol},{oi},123.45,{ratios[0]},{ratios[1]},{ratios[2]},0.9\n"


def day_text(day: date, symbol="BTCUSDT", skip=()) -> str:
    low = day_ms(day)
    # The archive's rows are not in time order.
    return HEADER + "".join(line(at, oi=f"{1000 + (at - low) // metrics.STEP}.5", symbol=symbol)
                            for at in reversed(range(low, low + store.DAY, metrics.STEP)) if at not in skip)


def put(exchange: Exchange, day: date, text: str, symbol="BTCUSDT") -> None:
    key = sources.metrics_key(symbol, day.isoformat())
    exchange.put(key, zipped(Path(key).name.removesuffix(".zip") + ".csv", text))


def path_of(root: Path, text: str) -> Path:
    path = Path(root) / "day.zip"
    path.write_bytes(zipped("day.csv", text))
    return path


class ParseTests(unittest.TestCase):
    def test_exact_keeps_every_decimal_and_refuses_what_the_column_cannot_hold(self):
        self.assertEqual(metrics.exact("95916.9940000000000000", "oi"), "95916.9940000000000000")
        self.assertEqual(metrics.exact("0.0000000000000001", "ratio"), "0.0000000000000001")
        self.assertEqual(metrics.exact("0", "ratio"), "0")
        self.assertEqual(metrics.exact("9" * 22 + ".5", "oi"), "9" * 22 + ".5")
        for text in ("0.00000000000000001", "1" + "0" * 22, "1E+1000000000", "1E-1000000000"):
            with self.subTest(text=text), self.assertRaises(sources.MarketError) as caught:
                metrics.exact(text, "oi")
            self.assertEqual(caught.exception.code, "SCALE_LOSS")
        for text in ("-1", "NaN", "Infinity", "oops"):
            with self.subTest(text=text), self.assertRaises(sources.MarketError) as caught:
                metrics.exact(text, "oi")
            self.assertEqual(caught.exception.code, "SOURCE_SHAPE")

    def test_rows_come_in_time_order_with_identical_repeats_merged_and_empty_ratios_kept_empty(self):
        a, b = START, START + metrics.STEP
        text = HEADER + line(b, ratios=("", "2.5", "")) + line(a) + line(a) + line(b, ratios=("", "2.5", ""))
        with tempfile.TemporaryDirectory() as temp:
            found, readings = metrics.rows(path_of(temp, text), "BTCUSDT", "2025-01-01")
        self.assertEqual(found, [("BTCUSDT", a, "1000.5000000000000000", "1.25", "2.50000000", "0.75"),
                                 ("BTCUSDT", b, "1000.5000000000000000", None, "2.5", None)])
        self.assertEqual(readings, {"rows": 2, "repeated_rows": 2,
                                    "empty": {"count_toptrader_long_short_ratio": 1, "sum_toptrader_long_short_ratio": 0,
                                              "count_long_short_ratio": 1}})

    def test_a_row_that_cannot_be_stored_as_given_refuses_the_day(self):
        cases = {
            "two rows differ": HEADER + line(START) + line(START, oi="1"),
            "off the grid": HEADER + line(START + 60_000),
            "another day": HEADER + line(START + store.DAY),
            "another contract": HEADER + line(START, symbol="ETHUSDT"),
            "no open interest": HEADER + line(START, oi=""),
            "a negative ratio": HEADER + line(START, ratios=("-1", "1", "1")),
            "another header": HEADER.replace("create_time", "time") + line(START),
            "a short row": HEADER + "2025-01-01 00:00:00,BTCUSDT,1\n",
            "a zoned time": HEADER + line(START).replace("00:00:00", "00:00:00Z"),
        }
        with tempfile.TemporaryDirectory() as temp:
            for name, text in cases.items():
                with self.subTest(name), self.assertRaises(sources.MarketError) as caught:
                    metrics.rows(path_of(temp, text), "BTCUSDT", "2025-01-01")
                self.assertEqual(caught.exception.code, "SOURCE_SHAPE")


@unittest.skipUnless(BINARY, SKIP)
class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="metrics-test-")
        self.addCleanup(temp.cleanup)
        self.cache = Path(temp.name)

    def market(self):
        profile = self.fixture.add("metrics_" + self._testMethodName.removeprefix("test_")[:40])
        # The eve and first day of the month: the commit tests check a member traded on its eve.
        times = START - store.DAY + np.arange(2880, dtype=np.int64) * 60_000
        price = np.full(2880, 100 * 10**8, dtype=np.int64)
        columns = {"ts_open": times, **{name: price for name in ("open", "high", "low", "close")},
                   "volume": np.full(2880, 10000, dtype=np.int64)}
        commit = seed(profile, month="2025-01", through="2025-02-01", scope=["BTCUSDT", "ETHUSDT"],
                      terms=[("BTCUSDT", {"price_increment": "0.01", "size_increment": "0.001"})],
                      bars={("BTCUSDT", "LAST"): columns,
                            ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(2880, np.int64)}},
                      members=[(JAN, "BTCUSDT")])
        return profile, commit

    def exchange(self, days, symbol="BTCUSDT", **kw) -> Exchange:
        exchange = Exchange(START)
        for day in days:
            put(exchange, day, day_text(day, symbol, **kw), symbol)
        return exchange

    def test_month_stored_exactly_one_commit_restricted_account_coverage_and_cli_publication(self):
        profile, before = self.market()
        days = [date(2025, 1, n) for n in range(1, 32)]
        skip = {START + 7 * metrics.STEP}
        with serving(self.exchange(days, skip=skip)), \
                patch.object(main.publication, "unpublished", return_value=True), \
                patch.object(main.publication, "publish", return_value={"checked": True}) as publish, \
                patch("sys.stdout", new_callable=io.StringIO) as out, patch("sys.stderr", new_callable=io.StringIO):
            rc = main.main(["market", "import-metrics", "--market", profile["name"], "--month", "2025-01",
                            "--cache-root", str(self.cache)])
        result = json.loads(out.getvalue())
        self.assertEqual(rc, 0, result)
        self.assertEqual(publish.call_args.args[2], "market-import:" + profile["database"])
        imported, = result["imports"]  # the month's universe members: BTCUSDT only
        self.assertEqual((imported["symbols"], imported["from"], imported["through"]), (["BTCUSDT"], "2025-01-01",
                                                                                        "2025-02-01"))
        self.assertEqual(result["metrics_rows"], 31 * 288 - 1)
        self.assertEqual(imported["readings"]["BTCUSDT"]["2025-01-01"]["rows"], 287)
        self.assertEqual(imported["unpublished"], {"BTCUSDT": []})
        with store.connect(profile, "reader") as conn:
            first, = conn.rows("SELECT * FROM metrics ORDER BY create_time LIMIT 1")
            self.assertEqual(first, ("BTCUSDT", START, Decimal("1000.5"), Decimal("1.25"), Decimal("2.5"),
                                     Decimal("0.75")))
            self.assertEqual(conn.rows(f"SELECT COUNT(*) FROM metrics AS OF '{before}'"), [(0,)])
            self.assertEqual(conn.rows("SELECT table_name FROM dolt_status"), [])
            receipt = json.loads(conn.rows("SELECT message FROM dolt_log WHERE commit_hash = %s",
                                           (imported["market_commit"],))[0][0])
            self.assertEqual(len(receipt["archives"]["BTCUSDT"]), 31)
            facts = coverage.metrics_facts(conn, imported["market_commit"], "BTCUSDT", START,
                                           day_ms(date(2025, 2, 1)) + store.DAY, store.metrics_imports(conn))
        part, = facts["imports"]
        self.assertEqual((part["rows"], part["missing_rows"], part["empty"]["count_long_short_ratio"]),
                         (31 * 288 - 1, 1, 0))
        self.assertEqual((facts["first_ms"], facts["uncovered_intervals_ms"]),
                         (START, [[day_ms(date(2025, 2, 1)), day_ms(date(2025, 2, 1)) + store.DAY]]))
        with store.connect(profile, "import") as conn, self.assertRaises(sources.MarketError):
            conn.execute("UPDATE metrics SET sum_open_interest = 0")
        with serving(self.exchange(days)), self.assertRaises(sources.MarketError) as caught:
            metrics.import_month(profile, JAN, self.cache, ["BTCUSDT"], log=lambda _: None)
        self.assertEqual(caught.exception.code, "MONTH_EXISTS")

    def test_export_gives_the_rows_visible_in_the_window_by_the_rule_only_on_request(self):
        import pyarrow.parquet as parquet
        from market import export
        from engine import run
        profile, _ = self.market()
        with serving(self.exchange([JAN])):
            metrics.import_month(profile, JAN, self.cache, ["BTCUSDT"], log=lambda _: None)
        low, high = START * 10**6, (START + store.DAY) * 10**6
        found = export.export_catalogs(profile, None, ["BTCUSDT"], low, high, fresh=True, root=self.cache, workers=1,
                                       include_metrics=True)
        receipt = found["receipts"]["BTCUSDT"]
        # Visible in the window: create_time + 8 min in [00:00, 24:00), so 00:00 through 23:50.
        self.assertEqual((receipt["metrics_rule"], receipt["pieces"][0]["counts"]["metrics"]),
                         (export.METRICS_RULE, 287))
        path, = (Path(found["root"]) / "BTCUSDT" / "data" / "metrics").rglob("*.parquet")
        table = parquet.read_table(path)
        self.assertEqual(table.schema.metadata[b"rule"].decode(), export.METRICS_RULE)
        self.assertEqual(table.column("ts_init").to_pylist()[:2], [low + 8 * 60 * 10**9, low + 13 * 60 * 10**9])
        self.assertEqual(table.column("ts_event").to_pylist()[-1], high - 5 * 60 * 10**9)
        row = {"catalog_path": str(Path(found["root"]) / "BTCUSDT"),
               "instrument_id": run.InstrumentId.from_str(receipt["pieces"][0]["instrument_id"])}
        first = next(run._metrics_events(row))
        self.assertEqual(first.data, run.Metrics(row["instrument_id"], Decimal("1000.5"), Decimal("1.25"),
                                                 Decimal("2.5"), Decimal("0.75"), low + 5 * 60 * 10**9,
                                                 low + 8 * 60 * 10**9))
        self.assertEqual(run.months_missing(row, "Metrics", low, high), [])
        plain = export.export_catalogs(profile, None, ["BTCUSDT"], low, high, fresh=True, root=self.cache, workers=1)
        self.assertNotIn("metrics", plain["receipts"]["BTCUSDT"]["pieces"][0]["counts"])
        self.assertNotIn("metrics_rule", plain["receipts"]["BTCUSDT"])
        self.assertFalse(list(Path(plain["root"]).rglob("metrics")))

    def test_later_import_appends_days_published_since_and_records_gaps_before_the_last(self):
        profile, _ = self.market()
        early = [date(2025, 1, 1), date(2025, 1, 3)]  # the 2nd is never published; the 4th onward not yet
        with serving(self.exchange(early)):
            first, = metrics.import_month(profile, JAN, self.cache, ["BTCUSDT"], log=lambda _: None)["imports"]
        self.assertEqual((first["from"], first["through"], first["unpublished"]),
                         ("2025-01-01", "2025-01-04", {"BTCUSDT": ["2025-01-02"]}))
        later = early + [date(2025, 1, n) for n in range(4, 32)]
        with serving(self.exchange(later)):
            second, = metrics.import_month(profile, JAN, self.cache, ["BTCUSDT"], log=lambda _: None)["imports"]
        self.assertEqual((second["from"], second["through"], second["unpublished"]),
                         ("2025-01-04", "2025-02-01", {"BTCUSDT": []}))
        with store.connect(profile, "reader") as conn:
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM metrics"), [(30 * 288,)])
            facts = coverage.metrics_facts(conn, second["market_commit"], "BTCUSDT", START, day_ms(date(2025, 2, 1)),
                                           store.metrics_imports(conn))
        self.assertEqual([(part["from"], part["through"]) for part in facts["imports"]],
                         [("2025-01-01", "2025-01-04"), ("2025-01-04", "2025-02-01")])
        self.assertEqual(facts["uncovered_intervals_ms"], [])
        with serving(Exchange(START)), self.assertRaises(sources.MarketError) as caught:
            metrics.import_month(profile, date(2025, 2, 1), self.cache, ["BTCUSDT"], log=lambda _: None)
        self.assertEqual(caught.exception.code, "ARCHIVE_NOT_PUBLISHED")

    def test_a_refused_contract_rolls_back_alone_and_names_the_earlier_commit(self):
        profile, before = self.market()
        days = [date(2025, 1, n) for n in range(1, 32)]
        exchange = self.exchange(days)
        for day in days:
            text = day_text(day, "ETHUSDT")
            if day == days[-1]:
                text += line(day_ms(day) + 60_000, symbol="ETHUSDT")
            put(exchange, day, text, "ETHUSDT")
        with serving(exchange), self.assertRaises(sources.MarketError) as caught:
            metrics.import_month(profile, JAN, self.cache, ["ETHUSDT", "BTCUSDT"], log=lambda _: None)
        self.assertEqual(caught.exception.code, "SOURCE_SHAPE")
        with store.connect(profile, "reader") as conn:
            head = store.resolve_commit(conn, "main")
            self.assertIn(f"committed meanwhile: BTCUSDT {head}", caught.exception.message)
            self.assertEqual(conn.rows("SELECT symbol, COUNT(*) FROM metrics GROUP BY symbol"), [("BTCUSDT", 31 * 288)])
            self.assertEqual(conn.rows("SELECT table_name FROM dolt_status"), [])
            self.assertEqual([item["commit"] for item in store.metrics_imports(conn)], [head])
            self.assertEqual(conn.rows("SELECT parent_hash FROM dolt_commit_ancestors WHERE commit_hash = %s", (head,)),
                             [(before,)])

    def test_upgrade_adds_the_table_to_a_database_that_lacks_it(self):
        from ledger import db
        profile, _ = self.market()
        self.fixture.admin(profile, "DROP TABLE metrics")
        self.fixture.admin(profile, "CALL DOLT_COMMIT('-A', '--skip-verification', '-m', 'drop metrics')")
        with serving(self.exchange([JAN])), self.assertRaises(sources.MarketError) as caught:
            metrics.import_month(profile, JAN, self.cache, ["BTCUSDT"], log=lambda _: None)
        self.assertEqual(caught.exception.code, "SCHEMA_MISMATCH")
        self.assertEqual(db.upgrade_market(profile)["created"], ["metrics"])
        self.assertEqual(db.upgrade_market(profile)["created"], [])


if __name__ == "__main__":
    unittest.main()
