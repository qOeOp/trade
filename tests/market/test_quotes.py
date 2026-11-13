"""Best bid/ask inferred from aggTrades (market.quotes) and its import into a market directory from the stored
complete aggTrades: the rule, the refusals, one month of a contract imported as one file, and the coverage and
exports that read it."""

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa

from market import aggtrades, coverage, files, quotes, sources, store, universe
from market.sources import MarketError
from tests.market.directory import directory, forged, read
from tests.market.exchange import Exchange, day_ms, minutes, serving, two_sided_trades, MINUTE, DAY
from tests.helpers import refused

DEC, JAN, FEB, MAR = date(2024, 12, 1), date(2025, 1, 1), date(2025, 2, 1), date(2025, 3, 1)
EIGHT_HOURS = 8 * 3_600_000


def scaled(text: str) -> int:
    """A price as the stored integer (scale 8)."""
    return int(Decimal(text).scaleb(8))


def table(rows: list[tuple]) -> pa.Table:
    """(agg_trade_id, price, transact_time, is_buyer_maker[, raw trade id]) rows as the stored trades the
    derivation reads; the raw trade id defaults to the agg id."""
    raw = pa.array([r[4] if len(r) > 4 else r[0] for r in rows], pa.int64())
    return pa.table({"agg_trade_id": pa.array([r[0] for r in rows], pa.int64()),
                     "price": pa.array([scaled(r[1]) for r in rows], pa.int64()),
                     "first_trade_id": raw, "last_trade_id": raw,
                     "transact_time": pa.array([r[2] for r in rows], pa.int64()), "is_buyer_maker": [r[3] for r in rows]})


class RuleTests(unittest.TestCase):
    def test_each_side_comes_from_its_own_trades_and_is_carried_forward(self):
        rows, readings = quotes.derive(table([(1, "100.00", 1_000, True), (2, "100.02", 1_010, False),
                                              (3, "99.99", 2_000, True)]), Decimal("0.01"), quotes.State(), "t")
        self.assertEqual(rows, [(2, 1_010, scaled("100.00"), scaled("100.02")), (3, 2_000, scaled("99.99"), scaled("100.02"))])
        self.assertEqual(readings, {"trades": 3, "quote_changes": 2, "stale_side_adjustments": 0, "minutes_with_trades": 1,
                                    "trade_gap_max_ms": 990, "trade_gap_p99_ms": 980})

    def test_a_stale_side_that_crosses_is_pushed_one_increment_off_the_fresh_side_and_counted(self):
        state = quotes.State()
        rows, readings = quotes.derive(table([(1, "100.00", 1_000, True), (2, "100.01", 1_001, False),
                                              (3, "100.05", 1_002, True), (4, "99.90", 1_003, False)]),
                                       Decimal("0.01"), state, "t")
        self.assertEqual([(r[2], r[3]) for r in rows], [(scaled("100.00"), scaled("100.01")),
                                                        (scaled("100.05"), scaled("100.06")),
                                                        (scaled("99.89"), scaled("99.90"))])
        self.assertEqual(readings["stale_side_adjustments"], 2)
        self.assertEqual((state.bid, state.ask, state.last_id), (scaled("99.89"), scaled("99.90"), 4))
        crossing = table([(1, "100.00", 1_000, True), (2, "100.01", 1_001, False), (3, "100.05", 1_002, True)])
        rows, _ = quotes.derive(crossing.slice(0, 2), Decimal("0.000000001"), quotes.State(), "t")
        self.assertEqual(len(rows), 1)  # an increment finer than the stored scale is refused only where it pushes
        self.assertEqual(refused(quotes.derive, crossing, Decimal("0.000000001"), quotes.State(), "t",
                                 error=MarketError).code, "SCALE_LOSS")

    def test_the_state_continues_across_days_and_a_sequence_gap_or_time_reversal_refuses(self):
        state = quotes.State()
        quotes.derive(table([(1, "100.00", 1_000, True), (2, "100.01", 1_001, False)]), Decimal("0.01"), state, "day 1")
        rows, _ = quotes.derive(table([(3, "100.01", 90_000_000, False)]), Decimal("0.01"), state, "day 2")
        self.assertEqual(rows, [])  # the same ask again: no change, nothing emitted
        self.assertEqual(refused(quotes.derive, table([(5, "100.00", 100_000_000, True)]), Decimal("0.01"), state,
                                 "day 3", error=MarketError).code, "SEQUENCE_GAP")
        self.assertEqual(refused(quotes.derive, table([(1, "100.00", 2_000, True), (2, "100.01", 1_000, False)]),
                                 Decimal("0.01"), quotes.State(), "t", error=MarketError).code, "SOURCE_SHAPE")

    def test_a_repeated_id_feeds_a_later_distinct_trade_and_any_other_repeat_refuses(self):
        state = quotes.State()
        rows, readings = quotes.derive(table([(1, "100.00", 1_000, True, 1), (1, "100.02", 1_200, False, 3),
                                              (2, "99.99", 1_300, True, 4)]), Decimal("0.01"), state, "day 1")
        self.assertEqual(rows, [(1, 1_200, scaled("100.00"), scaled("100.02")),
                                (2, 1_300, scaled("99.99"), scaled("100.02"))])
        self.assertEqual((readings["trades"], state.last_id, state.last_time, state.last_trade), (3, 2, 1_300, 4))
        rows, _ = quotes.derive(table([(2, "100.01", 90_000_000, False, 6)]), Decimal("0.01"), state, "day 2")
        self.assertEqual(rows, [(2, 90_000_000, scaled("99.99"), scaled("100.01"))])  # continues across days
        for second in [(1, "100.00", 1_000, True, 1), (1, "100.02", 1_000, False, 3), (1, "100.02", 1_200, False, 1)]:
            with self.subTest(second=second), self.assertRaises(MarketError) as caught:
                quotes.derive(table([(1, "100.00", 1_000, True, 1), second]), Decimal("0.01"), quotes.State(), "t")
            self.assertEqual(caught.exception.code, "SEQUENCE_GAP")
        with self.assertRaises(MarketError) as caught:
            quotes.derive(table([(2, "100.01", 90_000_000, False, 4)]), Decimal("0.01"), state, "day 3")
        self.assertEqual(caught.exception.code, "SEQUENCE_GAP")  # the carried raw trade id does not advance

    def test_a_chunk_boundary_never_splits_one_millisecond(self):
        """Several states in one millisecond (a trade burst) straddling the writer's chunk size land in one catalog
        file: the catalog refuses files whose closed time intervals touch."""
        from nautilus_trader.model import InstrumentId
        from nautilus_trader.persistence import ParquetDataCatalog
        from market import export
        iid = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
        rows = [(1_000, 100_00, 101_00), (1_000, 100_00, 102_00), (1_000, 99_00, 102_00), (1_001, 99_00, 103_00),
                (1_002, 98_00, 103_00), (1_002, 98_00, 104_00), (1_002, 97_00, 104_00)]
        with tempfile.TemporaryDirectory() as temp:
            catalog = ParquetDataCatalog(temp)
            with patch.object(export, "CHUNK", 2):
                written = export.write_quotes(catalog, iid, [rows[:2], rows[2:]], 2, "1000", 3, 2)
            back = catalog.query_quote_ticks([str(iid)])
        self.assertEqual((written, [(q.ts_event // 10**6, str(q.bid_price), str(q.ask_price)) for q in back]),
                         (7, [(ts, f"{bid / 100:.2f}", f"{ask / 100:.2f}") for ts, bid, ask in rows]))


def exchange(gap: bool = True) -> Exchange:
    """BTCUSDT bars for January 2025 and aggTrades for 2024-12-31 through 2025-02-28; February's first day
    has an aggTrade id gap when `gap`."""
    found = Exchange(server_time=day_ms(FEB))  # terms observed then: January's last day reads them
    found.contract("BTCUSDT")
    start, end = day_ms(JAN), day_ms(FEB)
    found.klines("monthly", "LAST", "BTCUSDT", "2025-01", minutes(start, end))
    found.klines("monthly", "MARK", "BTCUSDT", "2025-01", minutes(start, end, mark=True))
    found.funding_month("BTCUSDT", "2025-01", [(at + 3, "0.0001") for at in range(start, end, EIGHT_HOURS)])
    found.rest[("LAST1d", "BTCUSDT")] = minutes(start, end)
    identity = 1
    origin = day_ms(date(2024, 12, 31))
    for at in range(origin, day_ms(MAR), DAY):
        rows = two_sided_trades(at, at + DAY, identity, base=2000.0 - 0.02 * ((at - origin) // MINUTE))  # one walk
        identity += len(rows)
        if gap and at == day_ms(FEB):
            rows = rows[:10] + rows[11:]  # one aggTrade missing
        found.aggtrades("BTCUSDT", datetime.fromtimestamp(at / 1000, UTC).date().isoformat(), rows)
    return found


class ImportQuotesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.market = cls.profile = directory(cls.addClassCleanup)
        cls.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        cls.addClassCleanup(shutil.rmtree, cls.cache, True)
        cls.exchange = exchange()
        with serving(cls.exchange):
            cls.bars = store.import_month(cls.market, JAN, cls.cache, 1, ["BTCUSDT"], log=lambda line: None)
            cls.trades = aggtrades.import_month(cls.market, JAN, cls.cache, ["BTCUSDT"], log=lambda line: None)
            cls.result = store.import_quotes(cls.market, JAN, cls.cache, ["BTCUSDT"], log=lambda line: None)
        # February's members: January's last day waits for them.
        forged(cls.market, "universe_month", FEB, rows={"universe_rule": [universe.RULE], "month": [FEB],
                                                        "symbol": ["BTCUSDT"]})

    def refused(self, code: str, call, *args, **kwargs) -> MarketError:
        with self.assertRaises(MarketError) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception

    def test_one_month_of_a_contracts_quotes_is_one_file(self):
        self.assertEqual(self.result["quote_rows"], 31 * 1440 * 2)  # two states a minute
        readings = self.result["per_symbol"]["BTCUSDT"]
        self.assertEqual((readings["trades"], readings["stale_side_adjustments"], readings["eve"]), (31 * 2880, 0, True))
        self.assertEqual(readings["minutes_with_trades"], 31 * 1440)
        stored = read(self.market, "quote")
        first = [tuple(row.values()) for row in stored.select(["ts", "agg_trade_id", "bid", "ask"]).slice(0, 2).to_pylist()]
        market = files.open_market(self.market, "reader")
        self.assertEqual([(entry.relative, entry.start_ms, entry.end_ms) for entry in files.entries(market, "quote")],
                         [("quote/2025-01/BTCUSDT.parquet", day_ms(JAN), day_ms(FEB))])
        self.assertEqual(stored.num_rows, self.result["quote_rows"])
        eve_trades = 2880
        bid = round(2000.0 - 0.02 * 1440, 2)  # the walk continues from the eve: no stale side, no adjustment
        self.assertEqual(first, [(day_ms(JAN) + 100, eve_trades + 1, round(bid * 10**8), round((bid + 0.03) * 10**8)),
                                 (day_ms(JAN) + 200, eve_trades + 2, round(bid * 10**8), round((bid + 0.01) * 10**8))])

    def test_coverage_gives_the_contracts_quote_months_bounds_and_uncovered_parts(self):
        start, end = day_ms(date(2024, 12, 31)), day_ms(FEB) + DAY
        found = coverage.diagnose_coverage(self.profile, None, ["BTCUSDT"], "2024-12-31T00:00:00Z",
                                           "2025-02-02T00:00:00Z", None)
        latest = max(read(self.market, "quote").column("ts").to_pylist())
        self.assertEqual(found["coverage"][0]["quotes"],
                         {"months": [{"month": "2025-01", "rows": self.result["quote_rows"]}],
                          "first_ms": day_ms(JAN) + 100, "last_ms": latest,
                          "uncovered_intervals_ms": [[start, day_ms(JAN)], [day_ms(FEB), end]]})

    def test_a_month_imports_once_and_a_sequence_gap_stores_nothing(self):
        def held():
            return sorted(path.relative_to(self.market["root"]).as_posix()
                          for path in Path(self.market["root"]).rglob("*.parquet"))
        before = held()
        with serving(self.exchange):
            self.refused("MONTH_EXISTS", store.import_quotes, self.market, JAN, self.cache, ["BTCUSDT"], log=lambda _: None)
            self.refused("UNIVERSE_UNKNOWN", store.import_quotes, self.market, MAR, self.cache, None, log=lambda _: None)
            self.refused("SEQUENCE_GAP", aggtrades.import_month, self.market, FEB, self.cache, ["BTCUSDT"],
                         log=lambda _: None)
            refused = self.refused("TRADES_NOT_HELD", store.import_quotes, self.market, FEB, self.cache, ["BTCUSDT"],
                                   log=lambda _: None)  # no aggTrades of the month: nothing to infer from
            self.assertIn("the market holds no 2025-02 aggTrades", refused.message)
        self.assertEqual(held(), before)

    def test_an_export_writes_the_stored_quotes_with_the_max_quantity_as_size(self):
        from nautilus_trader.persistence import ParquetDataCatalog
        from market import export
        start_ns, end_ns = day_ms(JAN) * 10**6, (day_ms(JAN) + 2 * DAY) * 10**6  # the first two days
        with tempfile.TemporaryDirectory() as temp:
            made = export.export_catalogs(self.profile, None, ["BTCUSDT"], start_ns, end_ns, fresh=True, root=Path(temp))
            piece = made["receipts"]["BTCUSDT"]["pieces"][0]
            catalog = ParquetDataCatalog(str(Path(made["root"]) / "BTCUSDT"))
            quotes = catalog.query_quote_ticks([piece["instrument_id"]])
            self.assertEqual((piece["counts"]["quote"], len(quotes), piece["quote_size"]), (2 * 2880, 2 * 2880, "1000"))
            first = quotes[0]
            self.assertEqual((first.ts_event, str(first.bid_size), str(first.ask_size)), (start_ns + 100 * 10**6, "1000.000", "1000.000"))
            self.assertEqual(first.ask_price.as_decimal() - first.bid_price.as_decimal(), Decimal("0.03"))  # the eve's carried ask
            self.assertTrue(all(q.bid_price < q.ask_price for q in quotes[:1000]))

    def test_bars_export_never_reads_quotes_and_preserves_the_consumed_event_stream(self):
        from engine.run import market_events
        from engine.load import read_market
        from market import export
        start_ns, end_ns = day_ms(JAN) * 10**6, (day_ms(JAN) + 2 * DAY) * 10**6
        market_day = files.latest_market_day(files.open_market(self.profile, "reader"))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job = {"profile": self.profile, "market_day": market_day, "symbol": "BTCUSDT", "start_ns": start_ns,
                   "end_ns": end_ns, "path": str(root / "bars" / "BTCUSDT"),
                   "include_quotes": False}
            with patch.object(export, "quote_rows", side_effect=AssertionError("bars must not read quote rows")):
                without = export.export_episode(job)
            with_quotes = export.export_episode({**job, "path": str(root / "quotes" / "BTCUSDT"),
                                                  "include_quotes": True})
            self.assertEqual(without["pieces"][0]["counts"]["quote"], 0)
            self.assertEqual(with_quotes["pieces"][0]["counts"]["quote"], 5760)
            self.assertFalse((root / "bars" / "BTCUSDT" / "data" / "quotes").exists())
            streams = []
            for name in ("bars", "quotes"):
                rows = read_market(root / name, ["BTCUSDT"], market_day, start_ns, end_ns)
                streams.append([(type(e).__name__, e.ts_event, e.ts_init, str(e))
                                for e in market_events(rows, start_ns, end_ns)])
            self.assertEqual(streams[0], streams[1])

    def test_cached_exports_keep_bars_and_quote_content_separate(self):
        from market import export
        start_ns, end_ns = day_ms(JAN) * 10**6, (day_ms(JAN) + DAY) * 10**6
        with tempfile.TemporaryDirectory() as temp:
            args = (self.profile, None, ["BTCUSDT"], start_ns, end_ns)
            bars = export.export_catalogs(*args, root=Path(temp), include_quotes=False)
            quoted = export.export_catalogs(*args, root=Path(temp), include_quotes=True)
            self.assertNotEqual(bars["root"], quoted["root"])
            self.assertEqual((bars["receipts"]["BTCUSDT"]["pieces"][0]["counts"]["quote"],
                              quoted["receipts"]["BTCUSDT"]["pieces"][0]["counts"]["quote"]), (0, 2880))
            self.assertEqual(export.export_catalogs(*args, root=Path(temp), include_quotes=False)["cached"], 1)
            self.assertEqual(export.export_catalogs(*args, root=Path(temp), include_quotes=True)["cached"], 1)



class EveTests(unittest.TestCase):
    def test_the_day_before_reads_the_same_from_the_month_befores_file_as_from_its_archive(self):
        """February's quotes carry January's last day in: from January's stored aggTrades when the market holds
        them, else from the archive, the same bytes either way."""
        cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        self.addCleanup(shutil.rmtree, cache, True)
        made = {}
        with serving(exchange(gap=False)):
            for months in ((JAN, FEB), (FEB,)):
                profile = directory(self.addCleanup)
                store.import_month(profile, JAN, cache, 1, ["BTCUSDT"], log=lambda _: None)
                for month in months:
                    aggtrades.import_month(profile, month, cache, ["BTCUSDT"], log=lambda _: None)
                with patch.object(sources, "fetch_archive", wraps=sources.fetch_archive) as fetched:
                    found = store.import_quotes(profile, FEB, cache, ["BTCUSDT"], log=lambda _: None)
                held = Path(profile["root"]) / "quote" / "2025-02" / "BTCUSDT.parquet"
                made[months] = (held.read_bytes(), found["per_symbol"]["BTCUSDT"]["eve"], fetched.call_count)
        self.assertEqual(made[(JAN, FEB)][1:], (True, 0))  # January's file: no archive read
        self.assertEqual(made[(FEB,)][1:], (True, 1))  # the eve's archive
        self.assertEqual(made[(JAN, FEB)][0], made[(FEB,)][0])
