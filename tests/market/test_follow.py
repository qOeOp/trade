"""The unattended metrics upkeep in throwaway markets: which days a round imports, how each refusal is sorted,
publication after every round, the status and the healthcheck; no active database or real network."""

from datetime import UTC, date, datetime, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ledger.errors import Refusal
from market import follow, metrics, sources, store
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed
from tests.market.exchange import Exchange, day_ms, serving
from tests.market.test_metrics import JAN, START, day_text, line, put


FEB = date(2025, 2, 1)


def held(symbol: str, *spans: tuple[str, str, str]) -> list[dict]:
    return [{"month": month, "from": start, "through": through, "symbols": [symbol]} for month, start, through in spans]


def at(day: date, hour=0, minute=40) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


def refusing(exc: Exception):
    def publish():
        raise exc
    return publish


class MissingTests(unittest.TestCase):
    def test_days_after_the_last_held_one_by_month_with_the_month_before_the_last_closed_day(self):
        imports = held("BTCUSDT", ("2025-01", "2025-01-01", "2025-01-31"))
        # Feb 3: Jan 31 is still missing, Feb 1 and 2 have closed.
        self.assertEqual(follow.missing(imports, "BTCUSDT", date(2025, 2, 3)),
                         {JAN: [date(2025, 1, 31)], FEB: [FEB, date(2025, 2, 2)]})
        # Once February holds a later day, January is still looked at while it is the month before.
        imports += held("BTCUSDT", ("2025-02", "2025-02-01", "2025-02-03"))
        self.assertEqual(follow.missing(imports, "BTCUSDT", date(2025, 2, 3)), {JAN: [date(2025, 1, 31)]})
        # In March, January has left the window: its last day is a gap coverage reports, not a missing day it waits for.
        self.assertEqual(follow.missing(imports, "BTCUSDT", date(2025, 3, 2))[FEB][0], date(2025, 2, 3))
        self.assertNotIn(JAN, follow.missing(imports, "BTCUSDT", date(2025, 3, 2)))

    def test_a_long_outage_resumes_from_the_last_held_month_and_never_reaches_before_the_first(self):
        imports = held("BTCUSDT", ("2025-01", "2025-01-10", "2025-02-01"))
        found = follow.missing(imports, "BTCUSDT", date(2025, 4, 2))
        self.assertEqual(sorted(found), [FEB, date(2025, 3, 1), date(2025, 4, 1)])
        self.assertEqual((len(found[FEB]), found[date(2025, 4, 1)]), (28, [date(2025, 4, 1)]))
        # History that starts this month is not extended backwards.
        imports = held("BTCUSDT", ("2025-02", "2025-02-10", "2025-02-12"))
        self.assertEqual(sorted(follow.missing(imports, "BTCUSDT", date(2025, 2, 13))), [FEB])
        self.assertEqual(follow.missing(imports, "BTCUSDT", date(2025, 2, 12)), {})
        self.assertIsNone(follow.missing(imports, "ETHUSDT", date(2025, 2, 12)))


class CheckTests(unittest.TestCase):
    def test_healthy_only_while_fresh_and_every_contract_caught_up_or_waiting(self):
        now = at(FEB)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "status.json"
            self.assertEqual(follow.check(path, now), 1)  # no round yet
            for states, age, expected in ((("caught_up", "waiting"), 0, 0), (("caught_up", "lagging"), 0, 1),
                                          (("stopped",), 0, 1), (("unknown",), 0, 1), (("caught_up",), 27, 1)):
                follow.write_status(path, {"at": (now - timedelta(hours=age)).isoformat(),
                                           "contracts": {str(n): {"state": s} for n, s in enumerate(states)}})
                with self.subTest(states=states, age=age):
                    self.assertEqual(follow.check(path, now), expected)


class LoopTests(unittest.TestCase):
    def test_rounds_sleep_in_short_naps_until_next_round_and_rewrite_the_status(self):
        clock = [at(FEB)]
        naps: list[float] = []

        def sleep(seconds):
            naps.append(seconds)
            clock[0] += timedelta(seconds=seconds)

        def round_(profile, symbols, cache, stopped, publish, now, log):
            return {"at": now.isoformat(), "contracts": {}, "next_round": (now + timedelta(hours=1)).isoformat()}

        lines = []
        with tempfile.TemporaryDirectory() as temp, patch.object(follow, "run_round", side_effect=round_):
            path = Path(temp) / "status.json"
            last = follow.follow({}, ["BTCUSDT"], Path(temp), path, lambda: None, report=lines.append,
                                 clock=lambda: clock[0], sleep=sleep, rounds=2)
            self.assertEqual(json.loads(path.read_text()), last)
        self.assertEqual(len(lines), 2)
        self.assertEqual(last["at"], (at(FEB) + timedelta(hours=1)).isoformat())
        self.assertTrue(naps and max(naps) <= follow.NAP and sum(naps) == 3600)

    def test_no_contracts_is_refused_at_start(self):
        with self.assertRaises(sources.MarketError) as caught:
            follow.follow({}, None, Path("."), Path("status.json"), lambda: None, rounds=1)
        self.assertEqual(caught.exception.code, "IMPORT_SCOPE")


@unittest.skipUnless(BINARY, SKIP)
class RoundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)

    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="follow-test-")
        self.addCleanup(temp.cleanup)
        self.cache = Path(temp.name)
        self.published: list[str] = []
        # A download no stand-in exchange serves fails the test instead of reaching Binance.
        offline = patch.object(sources, "_get", side_effect=AssertionError("network access outside serving()"))
        offline.start()
        self.addCleanup(offline.stop)

    def market(self, symbols=("BTCUSDT", "ETHUSDT")) -> dict:
        """A market holding January 1-30 of each contract."""
        import numpy as np
        profile = self.fixture.add("follow_" + self._testMethodName.removeprefix("test_")[:40])
        times = START - store.DAY + np.arange(2880, dtype=np.int64) * 60_000
        price = np.full(2880, 100 * 10**8, dtype=np.int64)
        columns = {"ts_open": times, **{name: price for name in ("open", "high", "low", "close")},
                   "volume": np.full(2880, 10000, dtype=np.int64)}
        seed(profile, month="2025-01", through="2025-02-01", scope=["BTCUSDT", "ETHUSDT"],
             terms=[("BTCUSDT", {"price_increment": "0.01", "size_increment": "0.001"})],
             bars={("BTCUSDT", "LAST"): columns, ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(2880, np.int64)}},
             members=[(JAN, "BTCUSDT")])
        exchange = Exchange(START)
        for symbol in symbols:
            for n in range(1, 31):
                put(exchange, date(2025, 1, n), day_text(date(2025, 1, n), symbol), symbol)
        with serving(exchange):
            metrics.import_month(profile, JAN, self.cache, list(symbols), log=lambda _: None)
        return profile

    def exchange(self, days: dict[str, list[date]], broken=()) -> Exchange:
        exchange = Exchange(START)
        for symbol, listed in days.items():
            for day in listed:
                text = day_text(day, symbol) + (line(day_ms(day) + 60_000, symbol=symbol) if (symbol, day) in broken
                                                else "")
                put(exchange, day, text, symbol)
        return exchange

    def publish(self):
        self.published.append("published")
        return {"head": len(self.published)}

    def round(self, profile, stopped, now, symbols=("BTCUSDT", "ETHUSDT"), publish=None):
        return follow.run_round(profile, list(symbols), self.cache, stopped, publish or self.publish, now,
                                lambda _: None)

    def test_each_contract_imports_its_own_days_across_the_month_end_and_the_round_publishes_once(self):
        profile = self.market()
        # Feb 3: BTCUSDT has Jan 31, Feb 1 and 2; ETHUSDT's Jan 31 is not out, its February days are.
        days = {"BTCUSDT": [date(2025, 1, 31), FEB, date(2025, 2, 2)], "ETHUSDT": [FEB, date(2025, 2, 2)]}
        with serving(self.exchange(days)):
            status = self.round(profile, {}, at(date(2025, 2, 3)))
        btc, eth = status["contracts"]["BTCUSDT"], status["contracts"]["ETHUSDT"]
        self.assertEqual((btc["state"], btc["rows"], len(btc["commits"]), btc["missing_days"]), ("caught_up", 864, 2, 0))
        self.assertEqual((eth["state"], eth["rows"], eth["missing_from"]), ("waiting", 576, "2025-01-31"))
        self.assertEqual((self.published, status["published"]), (["published"], {"head": 1}))
        self.assertEqual(status["next_round"], (at(date(2025, 2, 3)) + follow.HOURLY).isoformat())
        with store.connect(profile, "reader") as conn:
            self.assertEqual(conn.rows("SELECT symbol, COUNT(*) FROM metrics GROUP BY symbol ORDER BY symbol"),
                             [("BTCUSDT", 33 * 288), ("ETHUSDT", 32 * 288)])
        # A day later nothing is out: no import call (and so no lock); BTCUSDT waits for Feb 3, and ETHUSDT's
        # Jan 31 is now more than LAG_DAYS old.
        with serving(Exchange(START)), patch.object(follow.metrics, "import_month") as imported:
            later = self.round(profile, {}, at(date(2025, 2, 4)))
            imported.assert_not_called()
        self.assertEqual((later["contracts"]["BTCUSDT"]["state"], later["contracts"]["ETHUSDT"]["state"]),
                         ("waiting", "lagging"))
        # With only lagging contracts left, the next round is the next day's.
        with serving(Exchange(START)):
            self.assertEqual(self.round(profile, {}, at(date(2025, 2, 4)), ("ETHUSDT",))["next_round"],
                             "2025-02-05T00:30:00+00:00")

    def test_a_held_lock_retries_and_a_content_refusal_stops_only_its_contract_until_restart(self):
        profile = self.market()
        days = {"BTCUSDT": [date(2025, 1, 31)], "ETHUSDT": [date(2025, 1, 31)]}
        stopped: dict = {}
        holder = store.connect(profile, "import")
        try:
            store.lock(holder)
            with serving(self.exchange(days)):
                status = self.round(profile, stopped, at(FEB))
        finally:
            holder.close()
        self.assertEqual({entry["retry"]["code"] for entry in status["contracts"].values()}, {"CONCURRENT_IMPORT"})
        self.assertEqual({entry["state"] for entry in status["contracts"].values()}, {"waiting"})
        self.assertEqual(stopped, {})
        broken = self.exchange(days, broken={("ETHUSDT", date(2025, 1, 31))})
        self.cache = Path(tempfile.mkdtemp(dir=self.cache))  # the first round cached the sound archives
        with serving(broken):
            status = self.round(profile, stopped, at(FEB, 2))
        self.assertEqual(status["contracts"]["BTCUSDT"]["state"], "caught_up")
        eth = status["contracts"]["ETHUSDT"]
        self.assertEqual((eth["state"], eth["refusal"]["code"]), ("stopped", "SOURCE_SHAPE"))
        with serving(self.exchange(days)), patch.object(follow.metrics, "import_month") as imported:
            self.assertEqual(self.round(profile, stopped, at(FEB, 3))["contracts"]["ETHUSDT"]["state"], "stopped")
            imported.assert_not_called()

    def test_a_failed_publish_is_retried_by_a_round_with_nothing_new_and_a_rejected_one_stops_every_contract(self):
        profile = self.market(("BTCUSDT",))
        stopped: dict = {}
        unconfirmed = Refusal("PUBLISH_FAILED", "the push was not confirmed", write_status="not_written")
        with serving(self.exchange({"BTCUSDT": [date(2025, 1, 31)]})):
            status = self.round(profile, stopped, at(FEB), ("BTCUSDT",), publish=refusing(unconfirmed))
        self.assertEqual((status["publish_refusal"]["code"], stopped), ("PUBLISH_FAILED", {}))
        with serving(Exchange(START)):
            status = self.round(profile, stopped, at(FEB, 1), ("BTCUSDT",))
        self.assertEqual((status["published"], status["contracts"]["BTCUSDT"]["rows"]), ({"head": 1}, 0))
        rejected = Refusal("PUBLISH_REJECTED", "origin has diverged", write_status="not_written")
        with serving(Exchange(START)):
            status = self.round(profile, stopped, at(FEB, 2), ("BTCUSDT",), publish=refusing(rejected))
        self.assertEqual(stopped["*"]["code"], "PUBLISH_REJECTED")
        with serving(self.exchange({"BTCUSDT": [FEB]})), patch.object(follow.metrics, "import_month") as imported:
            status = self.round(profile, stopped, at(date(2025, 2, 2)), ("BTCUSDT",))
            imported.assert_not_called()
        self.assertEqual(status["contracts"]["BTCUSDT"]["state"], "stopped")
        self.assertEqual(self.published, ["published"])

    def test_a_contract_without_history_is_not_imported_and_an_unreadable_market_waits(self):
        profile = self.market(("BTCUSDT",))
        with serving(self.exchange({"SOLUSDT": [date(2025, 1, 31)]})):
            status = self.round(profile, {}, at(FEB), ("BTCUSDT", "SOLUSDT"))
        self.assertEqual(status["contracts"]["SOLUSDT"]["refusal"]["code"], follow.NO_HISTORY)
        with store.connect(profile, "reader") as conn:
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM metrics WHERE symbol = 'SOLUSDT'"), [(0,)])
        gone = {**profile, "database": "missing_market"}
        status = self.round(gone, {}, at(FEB), ("BTCUSDT",))
        self.assertIsNotNone(status["round_refusal"])
        self.assertEqual((status["contracts"]["BTCUSDT"]["state"], status["published"]), ("unknown", None))
        self.assertEqual(status["next_round"], (at(FEB) + follow.HOURLY).isoformat())


if __name__ == "__main__":
    unittest.main()
