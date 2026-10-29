"""Native differential checks for the quote month-existence query: same refusals and writes,
with a bounded primary-key lookup instead of grouping the entire quote table.
"""

from contextlib import nullcontext
from datetime import UTC, date, datetime
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from market import sources, store
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed
from tests.market.exchange import DAY, Exchange, day_ms, serving

JAN, FEB = date(2025, 1, 1), date(2025, 2, 1)
LOOKUP = "SELECT 1 FROM quote WHERE symbol = %s AND ts >= %s AND ts < %s LIMIT 1"
SCAN = "SELECT symbol, COUNT(*) FROM quote WHERE ts >= %s AND ts < %s GROUP BY symbol"
NATIVE_ROWS = store.MarketConnection.rows


def reference_rows(conn, statement, params=None):
    """Run the previous grouped query in place of each new existence probe, leaving the importer native."""
    if statement == LOOKUP:
        symbol, start, end = params
        stored = dict(NATIVE_ROWS(conn, SCAN, (start, end)))
        return [(1,)] if symbol in stored else []
    return NATIVE_ROWS(conn, statement, params)


def exchange(*, gap=False, off_scale=False):
    found = Exchange(server_time=day_ms(FEB) + DAY)
    for index, at in enumerate(range(day_ms(JAN) - DAY, day_ms(FEB), DAY)):
        identity = index * 2 + 1
        price = "100.000000001" if off_scale and index == 15 else f"{100 - index * 0.02:.2f}"
        rows = [(identity, price, "0.5", identity, identity, at + 100, True),
                (identity + 1, f"{100.01 - index * 0.02:.2f}", "0.5", identity + 1, identity + 1, at + 200, False)]
        if gap and index == 15:
            rows = rows[1:]
        found.aggtrades("BTCUSDT", datetime.fromtimestamp(at / 1000, UTC).date().isoformat(), rows)
    return found


@unittest.skipUnless(BINARY, SKIP)
class QuotePrecheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)

    def profiles(self):
        profiles = [self.fixture.add(f"{self._testMethodName[5:]}_{arm}") for arm in ("old", "new")]
        for profile in profiles:
            seed(profile, month="2025-01", through="2025-02-01", bars={}, terms=[
                (symbol, {"price_increment": "0.01", "size_increment": "0.001"})
                for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")])
        return profiles

    def paired_import(self, profiles, symbols, *, found=None):
        outcomes = []
        for index, profile in enumerate(profiles):
            reference = patch.object(store.MarketConnection, "rows", reference_rows) if index == 0 else nullcontext()
            source = serving(found) if found else patch.object(sources, "fetch_archive", side_effect=RuntimeError("precheck passed"))
            with reference, source, tempfile.TemporaryDirectory() as cache:
                try:
                    result = store.import_quotes(profile, JAN, Path(cache), 1, symbols, log=lambda _: None)
                except sources.MarketError as exc:
                    outcomes.append(exc.as_dict())
                except RuntimeError as exc:
                    outcomes.append(str(exc))
                else:
                    outcomes.append({k: v for k, v in result.items() if k not in ("seconds", "market_commit")})
        self.assertEqual(outcomes[0], outcomes[1])
        return outcomes[1]

    def test_half_open_bounds_and_unrequested_symbols(self):
        profiles = self.profiles()
        for profile in profiles:
            with store.connect(profile, "import") as conn:
                conn.many("INSERT INTO quote VALUES (%s, %s, %s, %s, %s)", [
                    ("BTCUSDT", day_ms(JAN) - 1, 1, 100, 101),
                    ("BTCUSDT", day_ms(FEB), 2, 100, 101),
                    ("ETHUSDT", day_ms(JAN) + 1, 3, 100, 101),
                    ("SOLUSDT", day_ms(JAN), 4, 100, 101)])
                store._commit(conn, "test: boundary quotes")
        self.assertEqual(self.paired_import(profiles, ["BTCUSDT"]), "precheck passed")
        refused = self.paired_import(profiles, ["SOLUSDT", "ETHUSDT", "BTCUSDT"])
        self.assertEqual(refused["code"], "MONTH_EXISTS")
        self.assertEqual(refused["message"], "the market database already holds 2025-01 quotes of ['ETHUSDT', 'SOLUSDT']")
        self.assertEqual(refused["missing"], ["2025-01"])

    def test_unresolved_universe_still_refuses_before_the_presence_check(self):
        refused = self.paired_import(self.profiles(), None)
        self.assertEqual(refused["code"], "UNIVERSE_UNKNOWN")

    def test_complete_month_writes_identical_rows_and_receipts(self):
        profiles = self.profiles()
        result = self.paired_import(profiles, ["BTCUSDT"], found=exchange())
        self.assertEqual(result.get("quote_rows"), 62, result)
        snapshots = []
        for profile in profiles:
            with store.connect(profile, "reader") as conn:
                snapshots.append((conn.rows("SELECT * FROM quote ORDER BY symbol, ts, agg_trade_id"),
                                  [{k: v for k, v in item.items() if k != "commit"} for item in store.quote_imports(conn)],
                                  conn.rows("SELECT table_name FROM dolt_status")))
        self.assertEqual(snapshots[0], snapshots[1])
        self.assertEqual(len(snapshots[1][1]), 1)
        self.assertEqual(snapshots[1][2], [])
        refused = self.paired_import(profiles, ["BTCUSDT"])
        self.assertEqual(refused["code"], "MONTH_EXISTS")

    def test_source_refusals_preserve_the_complete_error_and_rollback(self):
        profiles = self.profiles()
        for changes, expected in [({"gap": True}, "SEQUENCE_GAP"), ({"off_scale": True}, "SCALE_LOSS")]:
            with self.subTest(changes=changes):
                refused = self.paired_import(profiles, ["BTCUSDT"], found=exchange(**changes))
                self.assertEqual(refused["code"], expected)
                for profile in profiles:
                    with store.connect(profile, "reader") as conn:
                        self.assertEqual(conn.rows("SELECT COUNT(*) FROM quote"), [(0,)])
                        self.assertEqual(conn.rows("SELECT table_name FROM dolt_status"), [])
                        self.assertEqual(store.quote_imports(conn), [])

    def test_native_plan_uses_the_existing_primary_key_and_stops_at_one(self):
        profile = self.profiles()[1]
        with store.connect(profile, "import") as conn:
            conn.execute("INSERT INTO quote VALUES ('BTCUSDT', %s, 1, 100, 101)", (day_ms(JAN),))
            store._commit(conn, "test: one quote for the native plan")
        with store.connect(profile, "reader") as conn:
            plan = "\n".join(row[0] for row in conn.rows("EXPLAIN FORMAT=tree " + LOOKUP,
                                                       ("BTCUSDT", day_ms(JAN), day_ms(FEB))))
        self.assertIn("IndexedTableAccess(quote)", plan)
        self.assertIn("Limit(1)", plan)
        self.assertIn("quote.symbol,quote.ts,quote.agg_trade_id", plan.replace(" ", ""))
