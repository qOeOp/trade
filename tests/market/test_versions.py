"""The market directory (market.versions) and market.review on throwaway directories; no network but a
loopback server standing in for the public copy."""

from contextlib import contextmanager
from datetime import date
from decimal import Decimal
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq

from market import review, universe, versions
from market.sources import MarketError


DAY = versions.DAY
JAN = 1_735_689_600_000  # 2025-01-01T00:00Z
FEB = JAN + 31 * DAY


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
    return pa.record_batch(columns, schema=versions.TABLES[versions.SCHEMA_VERSION][table].schema)


class Directory(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.profile = {"name": "market", "kind": "market", "root": str(self.root)}

    def importer(self) -> versions.Market:
        return versions.open_market(self.profile, "import")

    def commit(self, files: list[tuple], receipt: dict | None = None) -> str:
        market = self.importer()
        with versions.lock(market):
            entries = [versions.write_file(market, *spec) for spec in files]
            return versions.commit_version(market, entries, receipt or {"import": "binance-quotes",
                                                                         "files": [list(spec[:4]) for spec in files]})

    def rows(self, commit: str, table: str, **filters) -> pa.Table:
        market = versions.open_market(self.profile, "reader")
        batches = list(versions.read_table(market, commit, table, **filters))
        return pa.Table.from_batches(batches, versions.TABLES[versions.SCHEMA_VERSION][table].schema)

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


class VersionId(unittest.TestCase):
    def test_canonical_json_in_dolt_alphabet(self):
        version = {"parent": None, "files": [], "receipts": [], "market_schema": {"version": 3, "a": "é"}}
        commit = versions.version_id(version)
        self.assertRegex(commit, r"\A[0-9a-v]{32}\Z")
        self.assertEqual(commit, versions.version_id(dict(reversed(list(version.items())))))
        self.assertIn("é".encode(), versions.canonical(version))
        digest = hashlib.sha256(versions.canonical(version)).digest()
        self.assertEqual(int(commit, 32), int.from_bytes(digest[:20]))


class WriteAndRead(Directory):
    def test_versions_chain_and_read_back_in_key_order(self):
        first = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN, JAN + 5])])])
        second = self.commit([("quote", "ETHUSDT", JAN, FEB, [quotes("ETHUSDT", [JAN + 1])]),
                              ("quote", "BTCUSDT", FEB, FEB + DAY, [quotes("BTCUSDT", [FEB + 2])])])
        self.assertEqual((self.root / "head").read_text().strip(), second)
        market = versions.open_market(self.profile, "reader")
        self.assertEqual(versions.load_version(market, second)["parent"], first)
        self.assertEqual(list(versions.chain(market)), [second, first])
        table = self.rows(second, "quote")
        self.assertEqual(list(zip(table["symbol"].to_pylist(), table["ts"].to_pylist(), strict=False)),
                         [("BTCUSDT", JAN), ("BTCUSDT", JAN + 5), ("BTCUSDT", FEB + 2), ("ETHUSDT", JAN + 1)])
        self.assertEqual(self.rows(first, "quote").num_rows, 2)  # an old version reads what it read before
        self.assertEqual(self.rows(second, "quote", symbols=["BTCUSDT"], start_ms=JAN + 1, end_ms=FEB + DAY)
                         ["ts"].to_pylist(), [JAN + 5, FEB + 2])
        self.assertEqual(self.rows(second, "agg_trade").num_rows, 0)

    def test_files_of_several_contracts_are_gathered_in_key_order(self):
        commit = self.commit([
            ("bar", None, JAN, JAN + DAY, [bars([("BTCUSDT", "LAST", JAN, 1), ("BTCUSDT", "MARK", JAN, 0),
                                                 ("ETHUSDT", "LAST", JAN, 1)])]),
            ("bar", None, JAN + DAY, JAN + 2 * DAY, [bars([("BTCUSDT", "LAST", JAN + DAY, 1)])])])
        table = self.rows(commit, "bar", symbols=["BTCUSDT"])
        self.assertEqual(list(zip(table["price_type"].to_pylist(), table["ts_open"].to_pylist(), strict=False)),
                         [("LAST", JAN), ("LAST", JAN + DAY), ("MARK", JAN)])

    def test_bar_files_of_one_contract_read_in_key_order(self):
        # bar's key is (symbol, price_type, ts_open): files of one contract in time order are not in key order.
        commit = self.commit([
            ("bar", "BTCUSDT", JAN, JAN + DAY, [bars([("BTCUSDT", "LAST", JAN, 1), ("BTCUSDT", "MARK", JAN, 0)])]),
            ("bar", "BTCUSDT", JAN + DAY, JAN + 2 * DAY, [bars([("BTCUSDT", "LAST", JAN + DAY, 1)])])])
        table = self.rows(commit, "bar")
        self.assertEqual(list(zip(table["price_type"].to_pylist(), table["ts_open"].to_pylist(), strict=False)),
                         [("LAST", JAN), ("LAST", JAN + DAY), ("MARK", JAN)])

    def test_row_groups_are_skipped_only_outside_the_request(self):
        times = [JAN + i for i in range(5)]
        with patch.object(versions, "ROW_GROUP", 2):
            commit = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", times)])])
        sha = json.loads((self.root / "versions" / f"{commit}.json").read_text())["files"][0]["sha256"]
        self.assertEqual(pq.ParquetFile(self.root / "files" / f"{sha}.parquet").num_row_groups, 3)
        for start, end in ((JAN + 1, JAN + 2), (JAN + 2, JAN + 4), (JAN + 1, JAN + 3), (JAN + 4, FEB), (JAN, JAN + 1),
                           (JAN + 5, FEB)):
            self.assertEqual(self.rows(commit, "quote", start_ms=start, end_ms=end)["ts"].to_pylist(),
                             [time for time in times if start <= time < end], (start, end))

    def test_same_rows_make_the_same_file_however_batched(self):
        times = [JAN + i for i in range(10)]
        one = self.commit([("quote", "BTCUSDT", JAN, JAN + DAY, [quotes("BTCUSDT", times)])])
        split = [quotes("BTCUSDT", times).slice(0, 3), quotes("BTCUSDT", times).slice(3)]
        other = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, other, True)
        market = versions.open_market({"root": str(other)}, "import")
        with versions.lock(market):
            entry = versions.write_file(market, "quote", "BTCUSDT", JAN, JAN + DAY, split)
        stored = json.loads((self.root / "versions" / f"{one}.json").read_text())["files"][0]["sha256"]
        self.assertEqual(entry["sha256"], stored)

    def test_imports_names_the_version_that_wrote_each_receipt(self):
        first = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])], {"import": "binance-quotes",
                                                                                          "month": "2025-01"})
        self.commit([("agg_trade", "BTCUSDT", JAN, FEB, [])], {"import": "binance-aggtrades"})
        third = self.commit([("quote", "ETHUSDT", JAN, FEB, [quotes("ETHUSDT", [JAN])])], {"import": "binance-quotes",
                                                                                          "month": "2025-02"})
        market = versions.open_market(self.profile, "reader")
        found = versions.imports(market, third, "binance-quotes")
        self.assertEqual([(item["month"], item["commit"]) for item in found], [("2025-01", first), ("2025-02", third)])

    def test_resolve_commit(self):
        first = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])])
        second = self.commit([("quote", "ETHUSDT", JAN, FEB, [quotes("ETHUSDT", [JAN])])])
        market = versions.open_market(self.profile, "reader")
        self.assertEqual(versions.resolve_commit(market, None), second)
        self.assertEqual(versions.resolve_commit(market, "main"), second)
        self.assertEqual(versions.resolve_commit(market, first[:10]), first)
        for ref in ("zz", "0" * 33, first[:5] + "x"):
            with self.refusal("UNKNOWN_REF"):
                versions.resolve_commit(market, ref)
        twin = first[:6] + ("0" if first[6] != "0" else "1") * 26  # a converted id sharing first's prefix
        with patch.dict(versions.CONVERTED, {twin: "0" * 64}), self.refusal("AMBIGUOUS_REF"):
            versions.resolve_commit(market, first[:6])


class Refusals(Directory):
    def test_row_rules_key_order_interval_and_contract(self):
        market = self.importer()
        with versions.lock(market):
            for batch, symbol in ((quotes("BTCUSDT", [JAN], bid=5, ask=5), "BTCUSDT"),
                                  (quotes("BTCUSDT", [JAN + 2, JAN + 1]), "BTCUSDT"),
                                  (quotes("BTCUSDT", [FEB]), "BTCUSDT"),
                                  (quotes("ETHUSDT", [JAN]), "BTCUSDT"),
                                  (quotes("BTCUSDT", [JAN]).drop_columns(["ask"]), "BTCUSDT")):
                with self.refusal("CHECK_FAILED"):
                    versions.write_file(market, "quote", symbol, JAN, FEB, [batch])
            with self.refusal("CHECK_FAILED"):  # keys must rise across batches too
                versions.write_file(market, "quote", "BTCUSDT", JAN, FEB,
                                    [quotes("BTCUSDT", [JAN + 1]), quotes("BTCUSDT", [JAN + 1])])
        self.assertEqual([path.name for path in (self.root / "files").iterdir()], [])  # no temporary left

    def test_sql_rules_of_other_tables(self):
        market = self.importer()
        with versions.lock(market):
            for table, batch in (("bar", bars([("BTCUSDT", "MARK", JAN, 5)])),
                                 ("bar", bars([("BTCUSDT", "BID", JAN, 0)])),
                                 ("universe_month", members(date(2025, 1, 2), ["BTCUSDT"])),
                                 ("funding", rows_of("funding", symbol=["BTCUSDT"], funding_time=[JAN],
                                                     rate=[Decimal(1)])),
                                 ("instrument", terms("BTCUSDT", JAN).set_column(5, "min_quantity", pa.array(["1"]))),
                                 ("instrument", terms("BTCUSDT", JAN).set_column(2, "terms_source", pa.array(["x"]))),
                                 ("metrics", rows_of("metrics", symbol=["BTCUSDT"], create_time=[JAN + 60_000],
                                                     sum_open_interest=[Decimal(1)],
                                                     count_toptrader_long_short_ratio=[None],
                                                     sum_toptrader_long_short_ratio=[None],
                                                     count_long_short_ratio=[None])),
                                 ("metrics", rows_of("metrics", symbol=["BTCUSDT"], create_time=[JAN],
                                                     sum_open_interest=[Decimal(1)],
                                                     count_toptrader_long_short_ratio=[Decimal(-1)],
                                                     sum_toptrader_long_short_ratio=[None],
                                                     count_long_short_ratio=[None]))):
                with self.refusal("CHECK_FAILED"):
                    versions.write_file(market, table, None, JAN, FEB, [batch])
            # A NULL ratio keeps its rule, as in SQL.
            versions.write_file(market, "metrics", "BTCUSDT", JAN, FEB, [rows_of(
                "metrics", symbol=["BTCUSDT"], create_time=[JAN], sum_open_interest=[Decimal(1)],
                count_toptrader_long_short_ratio=[None], sum_toptrader_long_short_ratio=[None],
                count_long_short_ratio=[None])])

    def test_overlap_with_head_and_within_an_import(self):
        self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])])
        market = self.importer()
        with versions.lock(market):
            with self.refusal("ENTRY_OVERLAP"):
                versions.write_file(market, "quote", "BTCUSDT", FEB - 1, FEB + DAY, [])
            first = versions.write_file(market, "quote", "ETHUSDT", JAN, FEB, [])
            second = versions.write_file(market, "quote", "ETHUSDT", JAN + DAY, FEB, [])
            with self.refusal("ENTRY_OVERLAP"):
                versions.commit_version(market, [first, second], {"import": "binance-quotes"})

    def test_lock_is_exclusive_and_required(self):
        market, other = self.importer(), self.importer()
        with self.assertRaises(RuntimeError):
            versions.write_file(market, "quote", "BTCUSDT", JAN, FEB, [])
        with versions.lock(market):
            with self.refusal("CONCURRENT_IMPORT"), versions.lock(other):
                pass
            with self.assertRaises(RuntimeError), versions.lock(market):
                pass
        with self.refusal("ROLE_UNKNOWN"):
            versions.open_market(self.profile, "writer")

    def test_head_incomplete(self):
        commit = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])])
        version = json.loads((self.root / "versions" / f"{commit}.json").read_text())
        (self.root / "files" / f"{version['files'][0]['sha256']}.parquet").unlink()
        market = self.importer()
        with self.refusal("HEAD_INCOMPLETE"), versions.lock(market):
            pass
        (self.root / "versions" / f"{commit}.json").unlink()
        with self.refusal("HEAD_INCOMPLETE"), versions.lock(versions.Market(self.root, "import", None, True)):
            pass

    def test_a_receipt_head_already_lists(self):
        self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])], {"import": "binance-quotes"})
        market = self.importer()
        with versions.lock(market), self.refusal("CHECK_FAILED"):
            versions.commit_version(market, [], {"import": "binance-quotes"})

    def test_tampered_bytes_are_refused(self):
        commit = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])])
        version_path = self.root / "versions" / f"{commit}.json"
        data_path = self.root / "files" / f"{json.loads(version_path.read_text())['files'][0]['sha256']}.parquet"
        data_path.write_bytes(data_path.read_bytes() + b"\0")
        with self.refusal("HASH_MISMATCH"):
            self.rows(commit, "quote")
        version_path.write_text(version_path.read_text().replace('"price_scale":8', '"price_scale":9'))
        with self.refusal("HASH_MISMATCH"):
            versions.open_market(self.profile, "reader")

    def test_data_tests(self):
        jan = date(2025, 1, 1)
        eve = JAN - DAY
        self.commit([("bar", None, eve, JAN, [bars([("BTCUSDT", "LAST", eve, 0), ("ETHUSDT", "LAST", eve, 3)])]),
                     ("instrument", None, eve, eve + 1, [terms("ETHUSDT", eve)])],
                    {"import": "binance-bars", "month": "2024-12"})
        market = self.importer()
        with versions.lock(market):
            entry = versions.write_file(market, "universe_month", None, JAN, FEB, [members(jan, ["BTCUSDT", "ETHUSDT"])])
            with self.assertRaises(MarketError) as raised:
                versions.commit_version(market, [entry], {"import": "binance-bars", "month": "2025-01"})
            self.assertEqual(raised.exception.code, "DATA_TESTS_FAILED")
            self.assertEqual(sorted(raised.exception.missing),
                             ["universe_members_have_terms", "universe_members_traded_on_the_eve"])
        market = self.importer()
        with versions.lock(market):
            entry = versions.write_file(market, "universe_month", None, JAN, FEB,
                                        [members(jan, ["ETHUSDT"], "another-rule")])
            with self.assertRaises(MarketError) as raised:
                versions.commit_version(market, [entry], {"import": "binance-bars", "month": "2025-01"})
            self.assertEqual(list(raised.exception.missing), ["universe_rule_is_recorded"])
            entry = versions.write_file(market, "universe_month", None, JAN, FEB, [members(jan, ["ETHUSDT"])])
            versions.commit_version(market, [entry], {"import": "binance-bars", "month": "2025-01"})

    def test_upgrade_beyond_known_tables(self):
        market = self.importer()
        with versions.lock(market), self.refusal("SCHEMA_VERSION_MISMATCH"):
            versions.commit_version(market, [], {"import": "market-upgrade"})


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextmanager
def serving(directory: Path):
    handler = functools.partial(Quiet, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


class PublicCopy(Directory):
    def test_reader_fetches_checked_files_into_a_writable_directory(self):
        commit = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN, JAN + 1])])])
        reader = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, reader, True)
        with serving(self.root) as origin:
            market = versions.open_market({"root": str(reader), "origin": origin}, "reader")
            self.assertEqual(market.head, commit)
            self.assertEqual(len(list(versions.read_table(market, commit, "quote"))), 1)
        self.assertTrue((reader / "versions" / f"{commit}.json").is_file())
        self.assertFalse((reader / "head").exists())  # only commit_version writes head

    def test_fetched_bytes_that_do_not_match_are_not_kept(self):
        commit = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])])
        sha = json.loads((self.root / "versions" / f"{commit}.json").read_text())["files"][0]["sha256"]
        served = self.root / "files" / f"{sha}.parquet"
        served.write_bytes(b"not the file")
        reader = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, reader, True)
        with serving(self.root) as origin:
            market = versions.open_market({"root": str(reader), "origin": origin}, "reader")
            with self.refusal("HASH_MISMATCH"):
                list(versions.read_table(market, commit, "quote"))
        self.assertFalse((reader / "files" / f"{sha}.parquet").exists())

    @unittest.skipIf(os.geteuid() == 0, "root writes read-only directories")
    def test_read_only_reader_never_fetches(self):
        self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])])
        reader = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, reader, True)
        reader.chmod(0o555)
        self.addCleanup(reader.chmod, 0o755)
        with serving(self.root) as origin, self.refusal("MARKET_EMPTY"):
            versions.open_market({"root": str(reader), "origin": origin}, "reader")


class Converted(Directory):
    def test_a_converted_version_is_checked_against_its_pinned_hash(self):
        body = versions.canonical({"market_schema": versions.Market(self.root, "reader", None, True).market_schema,
                                   "parent": None, "files": [], "receipts": []})
        pinned = "l1kfbo4b2of54ijpjnpn02ijdm175aqd"
        (self.root / "versions").mkdir()
        (self.root / "versions" / f"{pinned}.json").write_bytes(body)
        (self.root / "head").write_text(pinned)
        with patch.dict(versions.CONVERTED, {pinned: hashlib.sha256(body).hexdigest()}):
            self.assertEqual(versions.open_market(self.profile, "reader").head, pinned)
        with patch.dict(versions.CONVERTED, {pinned: "0" * 64}), self.refusal("HASH_MISMATCH"):
            versions.open_market(self.profile, "reader")
        with self.refusal("HASH_MISMATCH"):  # not converted: its id must be its content's
            versions.open_market(self.profile, "reader")


class Review(Directory):
    def setUp(self):
        super().setUp()
        self.first = self.commit([("quote", "BTCUSDT", JAN, FEB, [quotes("BTCUSDT", [JAN])])])
        self.second = self.commit([("quote", "ETHUSDT", JAN, FEB, [quotes("ETHUSDT", [JAN])])])

    def findings(self, ledger=()) -> list[tuple]:
        market = versions.open_market(self.profile, "reader")
        return [(item["check"], item["commit"]) for item in review.review(market, list(ledger))]

    def forge(self, version: dict) -> str:
        commit = versions.version_id(version)
        (self.root / "versions" / f"{commit}.json").write_bytes(versions.canonical(version))
        (self.root / "head").write_text(commit)
        return commit

    def test_a_clean_market_has_no_findings(self):
        self.assertEqual(self.findings([self.first, self.second]), [])

    def test_unknown_and_off_chain_ledger_commits(self):
        off = self.forge({**json.loads((self.root / "versions" / f"{self.first}.json").read_text()),
                          "parent": None, "receipts": []})
        self.forge(json.loads((self.root / "versions" / f"{self.second}.json").read_text()))
        self.assertEqual(self.findings([self.first, off, "0" * 32]),
                         [("MARKET_COMMIT_UNRESOLVED", "0" * 32), ("HISTORY_REWRITTEN", off)])

    def test_a_child_dropping_its_parents_entries(self):
        second = json.loads((self.root / "versions" / f"{self.second}.json").read_text())
        forged = self.forge({**second, "files": second["files"][1:]})
        self.assertIn(("HISTORY_REWRITTEN", forged), self.findings())

    def test_overlapping_entries_and_bad_bytes(self):
        second = json.loads((self.root / "versions" / f"{self.second}.json").read_text())
        clash = {**second["files"][1], "symbol": None}
        forged = self.forge({**second, "parent": self.second, "files": second["files"] + [clash]})
        data = self.root / "files" / f"{second['files'][0]['sha256']}.parquet"
        data.write_bytes(data.read_bytes()[:-1])
        found = self.findings()
        self.assertIn(("ENTRY_OVERLAP", forged), found)
        self.assertIn("HASH_MISMATCH", [check for check, _ in found])

    def test_a_broken_chain_is_reported(self):
        (self.root / "versions" / f"{self.first}.json").unlink()
        found = self.findings()
        self.assertIn(("MARKET_UNREACHABLE", self.first), found)
        self.assertNotIn(self.first, [commit for check, commit in found if check != "MARKET_UNREACHABLE"])

    def test_unreadable_files_whose_hashes_match_are_reported(self):
        second = json.loads((self.root / "versions" / f"{self.second}.json").read_text())
        stored = []
        for data, suffix in ((b"\xff not json", "json"), (b"PAR1 not parquet", "parquet")):
            sha = hashlib.sha256(data).hexdigest()
            (self.root / "files" / f"{sha}.{suffix}").write_bytes(data)
            stored.append(sha)
        entry = {**second["files"][0], "table": "universe_month", "symbol": None, "sha256": stored[1]}
        forged = self.forge({**second, "parent": self.second, "files": second["files"] + [entry],
                             "receipts": second["receipts"] + [stored[0]]})
        found = self.findings()
        self.assertIn(("HASH_MISMATCH", forged), found)
        self.assertIn(("CHECK_FAILED", forged), found)

    def test_public_head_off_the_local_chain(self):
        public = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, public, True)
        (public / "head").write_text("0" * 32)
        with serving(public) as origin:
            market = versions.open_market({**self.profile, "origin": origin}, "reader")
            self.assertEqual([item["check"] for item in review.review(market, [])], ["HISTORY_REWRITTEN"])


if __name__ == "__main__":
    unittest.main()
