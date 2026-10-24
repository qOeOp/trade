"""Best bid/ask inferred from aggTrades (market.quotes) and its import: the rule, the thinning, the refusals,
one month imported as one commit, and `market upgrade` adding the table to an existing database."""

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa

from ledger import db
from market import quotes, sources, store, universe
from market.sources import MarketError
from tests.market.dolt import BINARY, SKIP, TemporaryMarket
from tests.market.exchange import Exchange, day_ms, minutes, serving, two_sided_trades, MINUTE, DAY

DEC, JAN, FEB, MAR = date(2024, 12, 1), date(2025, 1, 1), date(2025, 2, 1), date(2025, 3, 1)
EIGHT_HOURS = 8 * 3_600_000


def table(rows: list[tuple]) -> pa.Table:
    """(agg_trade_id, price, transact_time, is_buyer_maker) rows as the source table the derivation reads."""
    return pa.table({"agg_trade_id": pa.array([r[0] for r in rows], pa.int64()), "price": [r[1] for r in rows],
                     "transact_time": pa.array([r[2] for r in rows], pa.int64()), "is_buyer_maker": [r[3] for r in rows]})


class RuleTests(unittest.TestCase):
    def test_each_side_comes_from_its_own_trades_and_is_carried_forward(self):
        rows, readings = quotes.derive(table([(1, "100.00", 1_000, True), (2, "100.02", 1_010, False),
                                              (3, "99.99", 2_000, True)]), Decimal("0.01"), quotes.State(), "t")
        self.assertEqual(rows, [(2, 1_010, Decimal("100.00"), Decimal("100.02")), (3, 2_000, Decimal("99.99"), Decimal("100.02"))])
        self.assertEqual(readings, {"trades": 3, "quote_changes": 2, "stale_side_adjustments": 0, "minutes_with_trades": 1,
                                    "trade_gap_max_ms": 990, "trade_gap_p99_ms": 980})

    def test_a_stale_side_that_crosses_is_pushed_one_increment_off_the_fresh_side_and_counted(self):
        state = quotes.State()
        rows, readings = quotes.derive(table([(1, "100.00", 1_000, True), (2, "100.01", 1_001, False),
                                              (3, "100.05", 1_002, True), (4, "99.90", 1_003, False)]),
                                       Decimal("0.01"), state, "t")
        self.assertEqual([(r[2], r[3]) for r in rows], [(Decimal("100.00"), Decimal("100.01")),
                                                        (Decimal("100.05"), Decimal("100.06")),
                                                        (Decimal("99.89"), Decimal("99.90"))])
        self.assertEqual(readings["stale_side_adjustments"], 2)
        self.assertEqual((state.bid, state.ask, state.last_id), (Decimal("99.89"), Decimal("99.90"), 4))

    def test_the_state_continues_across_days_and_a_sequence_gap_or_time_reversal_refuses(self):
        state = quotes.State()
        quotes.derive(table([(1, "100.00", 1_000, True), (2, "100.01", 1_001, False)]), Decimal("0.01"), state, "day 1")
        rows, _ = quotes.derive(table([(3, "100.01", 90_000_000, False)]), Decimal("0.01"), state, "day 2")
        self.assertEqual(rows, [])  # the same ask again: no change, nothing emitted
        with self.assertRaises(MarketError) as gap:
            quotes.derive(table([(5, "100.00", 100_000_000, True)]), Decimal("0.01"), state, "day 3")
        self.assertEqual(gap.exception.code, "SEQUENCE_GAP")
        with self.assertRaises(MarketError) as reversed_time:
            quotes.derive(table([(1, "100.00", 2_000, True), (2, "100.01", 1_000, False)]), Decimal("0.01"),
                          quotes.State(), "t")
        self.assertEqual(reversed_time.exception.code, "SOURCE_SHAPE")

    def test_thinning_keeps_each_seconds_lowest_bid_highest_ask_and_last_state(self):
        rows = [(1, 1_000, Decimal("10"), Decimal("12")), (2, 1_100, Decimal("9"), Decimal("12")),
                (3, 1_200, Decimal("9"), Decimal("13")), (4, 1_300, Decimal("10"), Decimal("11")),
                (5, 2_000, Decimal("10"), Decimal("11"))]
        self.assertEqual(quotes.thin(rows), [rows[1], rows[2], rows[3], rows[4]])
        self.assertEqual(quotes.thin([]), [])

    def test_scaled_rows_are_exact_integers_or_refused(self):
        self.assertEqual(quotes.scaled_rows("X", [(7, 5, Decimal("1.5"), Decimal("1.51"))], 8),
                         [("X", 5, 7, 150_000_000, 151_000_000)])
        with self.assertRaises(MarketError) as lost:
            quotes.scaled_rows("X", [(7, 5, Decimal("1.123456789"), Decimal("2"))], 8)
        self.assertEqual(lost.exception.code, "SCALE_LOSS")


def exchange() -> Exchange:
    """BTCUSDT bars for January 2025 and aggTrades for 2024-12-31 through 2025-02-28; February's first day
    has an aggTrade id gap."""
    found = Exchange(server_time=day_ms(MAR))
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
        if at == day_ms(FEB):
            rows = rows[:10] + rows[11:]  # one aggTrade missing
        found.aggtrades("BTCUSDT", datetime.fromtimestamp(at / 1000, UTC).date().isoformat(), rows)
    return found


@unittest.skipUnless(BINARY, SKIP)
class ImportQuotesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)
        cls.profile = cls.fixture.profile
        cls.cache = Path(tempfile.mkdtemp(prefix="market-cache-"))
        cls.addClassCleanup(shutil.rmtree, cls.cache, True)
        cls.exchange = exchange()
        with serving(cls.exchange):
            store.import_month(cls.profile, JAN, cls.cache, 1, ["BTCUSDT"], log=lambda line: None)
            cls.result = store.import_quotes(cls.profile, JAN, cls.cache, 1, ["BTCUSDT"], log=lambda line: None)

    def refused(self, code: str, call, *args, **kwargs) -> MarketError:
        with self.assertRaises(MarketError) as caught:
            call(*args, **kwargs)
        self.assertEqual(caught.exception.code, code, caught.exception.message)
        return caught.exception

    def test_one_month_of_quotes_is_one_commit_with_the_rule_in_its_message(self):
        self.assertEqual(self.result["quote_rows"], 31 * 1440 * 2)  # two states a minute survive the thinning
        readings = self.result["per_symbol"]["BTCUSDT"]
        self.assertEqual((readings["trades"], readings["stale_side_adjustments"], readings["eve_archive"]), (31 * 2880, 0, True))
        self.assertEqual(readings["minutes_with_trades"], 31 * 1440)
        with store.connect(self.profile, "reader") as conn:
            (count,), = conn.rows("SELECT COUNT(*) FROM quote")
            first = conn.rows("SELECT ts, agg_trade_id, bid, ask FROM quote ORDER BY ts, agg_trade_id LIMIT 2")
            done = store.quote_imports(conn)
            bars = store.imports(conn)
        self.assertEqual(count, self.result["quote_rows"])
        eve_trades = 2880
        bid = round(2000.0 - 0.02 * 1440, 2)  # the walk continues from the eve: no stale side, no adjustment
        self.assertEqual(first, [(day_ms(JAN) + 100, eve_trades + 1, round(bid * 10**8), round((bid + 0.03) * 10**8)),
                                 (day_ms(JAN) + 200, eve_trades + 2, round(bid * 10**8), round((bid + 0.01) * 10**8))])
        self.assertEqual([(item["month"], item["quote_rule"], item["symbols"]) for item in done],
                         [("2025-01", quotes.RULE, ["BTCUSDT"])])
        self.assertEqual([item["month"] for item in bars], ["2025-01"])  # quote commits are not bar imports

    def test_a_month_imports_once_and_a_sequence_gap_stores_nothing(self):
        with serving(self.exchange):
            self.refused("MONTH_EXISTS", store.import_quotes, self.profile, JAN, self.cache, 1, ["BTCUSDT"], log=lambda _: None)
            self.refused("UNIVERSE_UNKNOWN", store.import_quotes, self.profile, JAN, self.cache, 1, None, log=lambda _: None)
            self.refused("SEQUENCE_GAP", store.import_quotes, self.profile, FEB, self.cache, 1, ["BTCUSDT"], log=lambda _: None)
            with patch.object(quotes, "RULE", "another-rule-v9"):
                self.refused("RULE_VERSION_MISMATCH", store.import_quotes, self.profile, FEB, self.cache, 1, ["BTCUSDT"],
                             log=lambda _: None)
        with store.connect(self.profile, "reader") as conn:
            (count,), = conn.rows("SELECT COUNT(*) FROM quote WHERE ts >= %s", (day_ms(FEB),))
            dirty = conn.rows("SELECT table_name FROM dolt_status")
        self.assertEqual((count, dirty), (0, []))

    def test_upgrade_adds_a_missing_table_and_is_otherwise_a_no_op(self):
        self.assertEqual(db.upgrade_market(self.profile)["created"], [])
        config = db._known_service(Path(self.profile["service"]))
        admin = db._admin(config, database=self.profile["database"])
        try:
            with admin.cursor() as cursor:
                cursor.execute("DROP TABLE quote")
                cursor.execute("CALL DOLT_COMMIT('-A', '--skip-verification', '-m', 'test: drop quote')")
        finally:
            admin.close()
        made = db.upgrade_market(self.profile)
        self.assertEqual(made["created"], ["quote"])
        self.assertIsNotNone(made["commit"])
        with store.connect(self.profile, "reader") as conn:
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM quote"), [(0,)])
            self.assertEqual(conn.rows("SELECT table_name FROM dolt_status"), [])


if __name__ == "__main__":
    unittest.main()
