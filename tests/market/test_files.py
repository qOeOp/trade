"""The market directory (market.files) on throwaway directories."""

from datetime import date
from decimal import Decimal
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq

from market import files, series, universe
from market.sources import MarketError


DAY = files.DAY
JAN = 1_735_689_600_000  # 2025-01-01T00:00Z
FEB = JAN + 31 * DAY
JAN_1, FEB_1 = date(2025, 1, 1), date(2025, 2, 1)


def quotes(symbol: str, times: list[int], bid: int = 100, ask: int = 101) -> pa.RecordBatch:
    return pa.record_batch({"symbol": [symbol] * len(times), "ts": times, "agg_trade_id": list(range(len(times))),
                            "bid": [bid] * len(times), "ask": [ask] * len(times)})


def bars(rows: list[tuple[str, str, int, int]]) -> pa.RecordBatch:
    symbol, price_type, ts_open, volume = zip(*rows, strict=False)
    return pa.record_batch({"symbol": list(symbol), "price_type": list(price_type), "ts_open": list(ts_open),
                            "open": [10] * len(rows), "high": [12] * len(rows), "low": [9] * len(rows),
                            "close": [11] * len(rows), "volume": list(volume)})


def members(month: date, symbols: list[str], rule: str = universe.RULE) -> pa.RecordBatch:
    return pa.record_batch({"universe_rule": [rule] * len(symbols), "month": pa.array([month] * len(symbols)),
                            "symbol": symbols})


def terms(symbol: str, at: int) -> pa.RecordBatch:
    nothing = pa.array([None], pa.string())
    return pa.record_batch({"symbol": [symbol], "observed_at": [at], "terms_source": ["inferred"],
                            "price_increment": ["0.1"], "size_increment": ["0.001"], "min_quantity": nothing,
                            "max_quantity": nothing, "min_notional": nothing, "min_price": nothing,
                            "max_price": nothing, "classification": nothing})


def rows_of(table: str, **columns) -> pa.RecordBatch:
    return pa.record_batch(columns, schema=files.TABLES[table].schema)


def metrics(symbol: str, times: list[int]) -> pa.RecordBatch:
    nothing = [None] * len(times)
    return rows_of("metrics", symbol=[symbol] * len(times), create_time=times, sum_open_interest=[Decimal(1)] * len(times),
                   count_toptrader_long_short_ratio=nothing, sum_toptrader_long_short_ratio=nothing,
                   count_long_short_ratio=nothing)


class Directory(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.profile = {"name": "market", "kind": "market", "root": str(self.root)}

    def importer(self) -> files.Market:
        return files.open_market(self.profile, "import")

    def write(self, specs: list[tuple]) -> None:
        """Files of (table, month, symbol, batches) written and placed in the order given."""
        market = self.importer()
        with files.lock(market):
            files.place(market, [files.write_file(market, *spec) for spec in specs])

    def rows(self, commit: str | None, table: str, **filters) -> pa.Table:
        market = files.open_market(self.profile, "reader")
        batches = list(files.read_table(market, commit, table, **filters))
        return pa.Table.from_batches(batches, files.TABLES[table].schema)

    def refusal(self, code: str):
        test = self

        class Refusal:
            def __enter__(self):
                return self

            def __exit__(self, kind, error, trace):
                test.assertIsInstance(error, MarketError, f"expected {code}")
                test.assertEqual(error.code, code, error.message)
                return True
        return Refusal()


class WriteAndRead(Directory):
    def test_paths_say_what_the_files_hold_and_read_back_in_key_order(self):
        self.write([("quote", JAN_1, "BTCUSDT", [quotes("BTCUSDT", [JAN, JAN + 5])]),
                    ("quote", JAN_1, "ETHUSDT", [quotes("ETHUSDT", [JAN + 1])]),
                    ("quote", FEB_1, "BTCUSDT", [quotes("BTCUSDT", [FEB + 2])])])
        self.assertTrue((self.root / "quote" / "2025-01" / "BTCUSDT.parquet").is_file())
        self.assertTrue((self.root / "quote" / "2025-02" / "BTCUSDT.parquet").is_file())
        table = self.rows(None, "quote")
        self.assertEqual(list(zip(table["symbol"].to_pylist(), table["ts"].to_pylist(), strict=False)),
                         [("BTCUSDT", JAN), ("BTCUSDT", JAN + 5), ("BTCUSDT", FEB + 2), ("ETHUSDT", JAN + 1)])
        self.assertEqual(self.rows(None, "quote", symbols=["BTCUSDT"], start_ms=JAN + 1, end_ms=FEB + DAY)
                         ["ts"].to_pylist(), [JAN + 5, FEB + 2])
        self.assertEqual(self.rows(None, "agg_trade").num_rows, 0)

    def test_files_of_several_contracts_are_gathered_in_key_order(self):
        self.write([("bar", date(2024, 12, 1), None, [bars([("BTCUSDT", "LAST", JAN - DAY, 1)])]),
                    ("bar", JAN_1, None, [bars([("BTCUSDT", "LAST", JAN, 1), ("BTCUSDT", "MARK", JAN, 0),
                                                ("ETHUSDT", "LAST", JAN, 1)])])])
        table = self.rows(None, "bar", symbols=["BTCUSDT"])
        self.assertEqual(list(zip(table["price_type"].to_pylist(), table["ts_open"].to_pylist(), strict=False)),
                         [("LAST", JAN - DAY), ("LAST", JAN), ("MARK", JAN)])

    def test_row_groups_are_skipped_only_outside_the_request(self):
        times = [JAN + i for i in range(5)]
        with patch.object(files, "ROW_GROUP", 2):
            self.write([("quote", JAN_1, "BTCUSDT", [quotes("BTCUSDT", times)])])
        self.assertEqual(pq.ParquetFile(self.root / "quote" / "2025-01" / "BTCUSDT.parquet").num_row_groups, 3)
        for start, end in ((JAN + 1, JAN + 2), (JAN + 2, JAN + 4), (JAN + 1, JAN + 3), (JAN + 4, FEB), (JAN, JAN + 1),
                           (JAN + 5, FEB)):
            self.assertEqual(self.rows(None, "quote", start_ms=start, end_ms=end)["ts"].to_pylist(),
                             [time for time in times if start <= time < end], (start, end))

    def test_an_import_reads_what_it_has_written_and_nobody_else_does(self):
        self.write([("funding", JAN_1, None, [rows_of("funding", symbol=["BTCUSDT"], funding_time=[JAN],
                                                      rate=[Decimal("0.1")])])])
        market = self.importer()
        with files.lock(market):
            files.write_file(market, "funding", JAN_1, None, [rows_of(
                "funding", symbol=["BTCUSDT"], funding_time=[JAN + 1], rate=[Decimal("0.2")])])
            files.write_file(market, "funding", FEB_1, None, [rows_of(
                "funding", symbol=["BTCUSDT"], funding_time=[FEB], rate=[Decimal("0.3")])])
            mine = pa.Table.from_batches(list(files.read_table(market, None, "funding")))
            self.assertEqual(mine["funding_time"].to_pylist(), [JAN + 1, FEB])
            self.assertEqual(self.rows(None, "funding")["funding_time"].to_pylist(), [JAN])
        # Unplaced: the temporary files are gone, the file as it was.
        self.assertEqual(self.rows(None, "funding")["funding_time"].to_pylist(), [JAN])
        self.assertEqual(sorted(path.name for path in (self.root / "funding").iterdir()), ["2025-01.parquet"])


class Commits(Directory):
    def test_a_commit_keeps_the_shape_the_ledger_stores(self):
        self.assertEqual(files.commit_of(date(2026, 11, 3)), "20261103000000000000000000000000")
        self.assertRegex(files.commit_of(date(2026, 11, 3)), r"\A[0-9a-v]{32}\Z")

    def test_resolve_commit(self):
        with self.refusal("MARKET_EMPTY"):
            files.resolve_commit(self.importer(), None)
        self.write([("bar", JAN_1, None, [bars([("BTCUSDT", "LAST", JAN, 1), ("BTCUSDT", "LAST", JAN + 2 * DAY, 1)])])])
        market = files.open_market(self.profile, "reader")
        newest = files.commit_of(date(2025, 1, 3))
        for ref in (None, "", "main", "head", newest):
            self.assertEqual(files.resolve_commit(market, ref), newest)
        self.assertEqual(files.resolve_commit(market, files.commit_of(JAN_1)), files.commit_of(JAN_1))
        for ref in (files.commit_of(date(2025, 1, 4)), "20250230000000000000000000000000", "2025010300000000",
                    "20250103000000000000000000000001", "nope", "0" * 32):
            with self.refusal("UNKNOWN_REF"):
                files.resolve_commit(market, ref)

    def test_the_newest_day_is_the_earlier_of_bars_and_followed_metrics(self):
        self.write([("bar", JAN_1, None, [bars([("BTCUSDT", "LAST", JAN + 9 * DAY, 1)])])])
        market = files.open_market(self.profile, "reader")
        self.assertEqual(files.latest_day(market), date(2025, 1, 10))
        self.write([("metrics", JAN_1, "BTCUSDT", [metrics("BTCUSDT", [JAN + 7 * DAY])]),
                    ("metrics", JAN_1, "ETHUSDT", [metrics("ETHUSDT", [JAN + 8 * DAY])])])
        self.assertEqual(files.latest_day(market), date(2025, 1, 8))
        self.assertEqual(files.resolve_commit(market, files.commit_of(date(2025, 1, 8))), files.commit_of(date(2025, 1, 8)))

    def test_a_contract_whose_metrics_stopped_long_ago_holds_nothing_back(self):
        self.write([("bar", FEB_1, None, [bars([("BTCUSDT", "LAST", FEB + 9 * DAY, 1)])]),
                    ("metrics", date(2024, 6, 1), "OLDUSDT", [metrics("OLDUSDT", [JAN - 200 * DAY])]),
                    ("metrics", FEB_1, "BTCUSDT", [metrics("BTCUSDT", [FEB + 9 * DAY])])])
        self.assertEqual(files.latest_day(files.open_market(self.profile, "reader")), date(2025, 2, 10))

    def test_a_months_last_day_waits_for_the_next_months_members(self):
        last = date(2025, 1, 31)
        self.write([("bar", JAN_1, None, [bars([("BTCUSDT", "LAST", series._day_ms(last), 1)])])])
        market = files.open_market(self.profile, "reader")
        self.assertEqual(files.latest_day(market), date(2025, 1, 30))
        with self.refusal("UNKNOWN_REF"):
            files.resolve_commit(market, files.commit_of(last))
        self.write([("universe_month", FEB_1, None, [members(FEB_1, ["BTCUSDT"])])])
        self.assertEqual(files.latest_day(market), last)
        self.assertEqual(files.resolve_commit(market, None), files.commit_of(last))

    def test_reads_at_a_commit_end_with_its_day_per_table(self):
        day = JAN + 2 * DAY  # 2025-01-03
        commit = files.commit_of(date(2025, 1, 3))
        self.write([("bar", JAN_1, None, [bars([("BTCUSDT", "LAST", day + DAY - 60_000, 1), ("BTCUSDT", "LAST", day + DAY, 1)])]),
                    ("universe_month", JAN_1, None, [members(JAN_1, ["BTCUSDT"])]),
                    ("universe_month", FEB_1, None, [members(FEB_1, ["ETHUSDT"])]),
                    ("instrument", None, None, [terms("BTCUSDT", day + 2 * DAY - 1)]),
                    ("metrics", JAN_1, "BTCUSDT", [metrics("BTCUSDT", [day + DAY - 300_000, day + DAY])])])
        self.assertEqual(self.rows(commit, "bar")["ts_open"].to_pylist(), [day + DAY - 60_000])
        self.assertEqual(self.rows(commit, "metrics")["create_time"].to_pylist(), [day + DAY - 300_000])
        self.assertEqual(self.rows(commit, "universe_month")["symbol"].to_pylist(), ["BTCUSDT"])
        # The universe through the month of the day after: the eve of a month reads its members.
        self.assertEqual(self.rows(files.commit_of(date(2025, 1, 30)), "universe_month").num_rows, 1)
        self.assertEqual(self.rows(files.commit_of(date(2025, 1, 31)), "universe_month").num_rows, 2)
        # Terms observed through the day after the commit's day: its data is imported then.
        self.assertEqual(self.rows(commit, "instrument").num_rows, 1)
        self.assertEqual(self.rows(files.commit_of(date(2025, 1, 2)), "instrument").num_rows, 0)


class Refusals(Directory):
    def test_row_rules_key_order_interval_and_contract(self):
        market = self.importer()
        with files.lock(market):
            for batch, symbol in ((quotes("BTCUSDT", [JAN], bid=5, ask=5), "BTCUSDT"),
                                  (quotes("BTCUSDT", [JAN + 2, JAN + 1]), "BTCUSDT"),
                                  (quotes("BTCUSDT", [FEB]), "BTCUSDT"),
                                  (quotes("ETHUSDT", [JAN]), "BTCUSDT"),
                                  (quotes("BTCUSDT", [JAN]).drop_columns(["ask"]), "BTCUSDT")):
                with self.refusal("CHECK_FAILED"):
                    files.write_file(market, "quote", JAN_1, symbol, [batch])
            with self.refusal("CHECK_FAILED"):  # keys must rise across batches too
                files.write_file(market, "quote", JAN_1, "BTCUSDT",
                                 [quotes("BTCUSDT", [JAN + 1]), quotes("BTCUSDT", [JAN + 1])])
        self.assertEqual(list((self.root / "quote" / "2025-01").iterdir()), [])  # no temporary left

    def test_row_rules_of_other_tables(self):
        market = self.importer()
        with files.lock(market):
            for table, month, batch in (("bar", JAN_1, bars([("BTCUSDT", "MARK", JAN, 5)])),
                                        ("bar", JAN_1, bars([("BTCUSDT", "BID", JAN, 0)])),
                                        ("universe_month", JAN_1, members(date(2025, 1, 2), ["BTCUSDT"])),
                                        ("funding", JAN_1, rows_of("funding", symbol=["BTCUSDT"], funding_time=[JAN],
                                                                   rate=[Decimal(1)])),
                                        ("instrument", None, terms("BTCUSDT", JAN).set_column(
                                            5, "min_quantity", pa.array(["1"]))),
                                        ("instrument", None, terms("BTCUSDT", JAN).set_column(
                                            2, "terms_source", pa.array(["x"]))),
                                        ("metrics", JAN_1, metrics("BTCUSDT", [JAN + 60_000])),
                                        ("metrics", JAN_1, rows_of("metrics", symbol=["BTCUSDT"], create_time=[JAN],
                                                                   sum_open_interest=[Decimal(1)],
                                                                   count_toptrader_long_short_ratio=[Decimal(-1)],
                                                                   sum_toptrader_long_short_ratio=[None],
                                                                   count_long_short_ratio=[None]))):
                symbol = "BTCUSDT" if table == "metrics" else None
                with self.refusal("CHECK_FAILED"):
                    files.write_file(market, table, month, symbol, [batch])
            # A null ratio keeps its rule.
            files.write_file(market, "metrics", JAN_1, "BTCUSDT", [metrics("BTCUSDT", [JAN])])

    def test_lock_is_exclusive_and_required(self):
        market, other = self.importer(), self.importer()
        with self.assertRaises(RuntimeError):
            files.write_file(market, "quote", JAN_1, "BTCUSDT", [])
        with files.lock(market):
            with self.refusal("CONCURRENT_IMPORT"), files.lock(other):
                pass
            with self.assertRaises(RuntimeError), files.lock(market):
                pass
        with self.refusal("ROLE_UNKNOWN"):
            files.open_market(self.profile, "writer")

    def test_a_killed_import_leaves_nothing_the_next_one_keeps(self):
        (self.root / "bar").mkdir()
        leftover = self.root / "bar" / ".abc.tmp"
        leftover.write_bytes(b"half")
        market = self.importer()
        with files.lock(market):
            self.assertFalse(leftover.exists())

    def test_a_file_changed_under_the_import_places_nothing(self):
        # A writer the lock does not reach: a process on the host beside the container's.
        self.write([("quote", JAN_1, "BTCUSDT", [quotes("BTCUSDT", [JAN])]),
                    ("quote", JAN_1, "ETHUSDT", [quotes("ETHUSDT", [JAN])])])
        target = self.root / "quote" / "2025-01" / "ETHUSDT.parquet"
        before = (self.root / "quote" / "2025-01" / "BTCUSDT.parquet").read_bytes()
        market = self.importer()
        with files.lock(market):
            first = files.write_file(market, "quote", JAN_1, "BTCUSDT", [quotes("BTCUSDT", [JAN + 1])])
            second = files.write_file(market, "quote", JAN_1, "ETHUSDT", [quotes("ETHUSDT", [JAN + 1])])
            copy = target.with_name("copy")
            shutil.copy(target, copy)
            os.replace(copy, target)
            with self.refusal("CONCURRENT_IMPORT"):
                files.place(market, [first, second])
        self.assertEqual((self.root / "quote" / "2025-01" / "BTCUSDT.parquet").read_bytes(), before)

    def test_a_file_read_before_it_changed_is_checked_from_the_read(self):
        self.write([("quote", JAN_1, "BTCUSDT", [quotes("BTCUSDT", [JAN])])])
        target = self.root / "quote" / "2025-01" / "BTCUSDT.parquet"
        market = self.importer()
        with files.lock(market):
            list(files.read_table(market, None, "quote"))
            copy = target.with_name("copy")
            shutil.copy(target, copy)
            os.replace(copy, target)
            written = files.write_file(market, "quote", JAN_1, "BTCUSDT", [quotes("BTCUSDT", [JAN + 1])])
            with self.refusal("CONCURRENT_IMPORT"):
                files.place(market, [written])

    def test_data_tests(self):
        eve = JAN - DAY
        self.write([("bar", date(2024, 12, 1), None, [bars([("BTCUSDT", "LAST", eve, 0), ("ETHUSDT", "LAST", eve, 3)])]),
                    ("instrument", None, None, [terms("ETHUSDT", eve)])])
        market = self.importer()
        with files.lock(market):
            written = files.write_file(market, "universe_month", JAN_1, None, [members(JAN_1, ["BTCUSDT", "ETHUSDT"])])
            self.assertEqual(sorted(files.data_tests(market)),
                             ["universe_members_have_terms", "universe_members_traded_on_the_eve"])
            written = files.write_file(market, "universe_month", JAN_1, None, [members(JAN_1, ["ETHUSDT"], "another-rule")])
            self.assertEqual(files.data_tests(market), ["universe_rule_is_recorded"])
            written = files.write_file(market, "universe_month", JAN_1, None, [members(JAN_1, ["ETHUSDT"])])
            self.assertEqual(files.data_tests(market), [])
            files.place(market, [written])


if __name__ == "__main__":
    unittest.main()
