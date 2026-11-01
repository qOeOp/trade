"""The unattended market upkeep: which days and months a round imports, how each refusal is sorted, publication
after every round, the status and the healthcheck; importers stood in for, or throwaway markets; no active
database or real network."""

from datetime import UTC, date, datetime, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pymysql

from ledger.errors import Refusal
from market import aggtrades, follow, metrics, sources, store, universe
from tests.market.dolt import BINARY, SKIP, TemporaryMarket, seed
from tests.market.exchange import Exchange, day_ms, serving, two_sided_trades
from tests.market.test_aggtrades import archive
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


MAR, APR, MAY = date(2025, 3, 1), date(2025, 4, 1), date(2025, 5, 1)


def monthly(symbol: str, *months: date, through=None) -> list[dict]:
    """Quote or aggTrades import receipts holding whole `months` (the last through `through` when given)."""
    found = [{"month": f"{month:%Y-%m}", "through": universe.next_month(month).isoformat(), "symbols": [symbol]}
             for month in months]
    if through is not None:
        found[-1]["through"] = through.isoformat()
    return found


def refused(code: str, *missing: str) -> sources.MarketError:
    return sources.MarketError(f"refused {code}", code=code, missing=missing)


def entries(*symbols: str) -> dict:
    return {symbol: {"rows": 0, "commits": []} for symbol in symbols}


class SortTests(unittest.TestCase):
    def test_each_refusal_retries_or_stops_its_contract_its_kind_or_everything(self):
        for kind, code, expected in (
                ("quotes", "ARCHIVE_NOT_PUBLISHED", "retry"), ("trades", "CONCURRENT_WRITE", "retry"),
                ("trades", "CHECKSUM_MISMATCH", "retry"), ("metrics", "MONTH_EXISTS", "retry"),
                ("bars", "MONTH_EXISTS", "kind"), ("bars", "UNIVERSE_CHANGED", "kind"),
                ("bars", "RULE_VERSION_MISMATCH", "all"), ("quotes", "RULE_VERSION_MISMATCH", "kind"),
                ("trades", "SCHEMA_MISMATCH", "kind"), ("trades", "DIRTY_WORKING_SET", "all"),
                ("quotes", "PUBLISH_REJECTED", "all"), ("quotes", "TERMS_UNKNOWN", "contract"),
                ("trades", "SEQUENCE_GAP", "contract")):
            with self.subTest(kind=kind, code=code):
                self.assertEqual(follow.sort(kind, refused(code)), expected)
        # An error without a code (a full disk) stops instead of downloading gigabytes again every hour.
        self.assertEqual(follow.sort("trades", OSError(28, "No space left on device")), "contract")


class MonthTests(unittest.TestCase):
    def test_bars_finish_the_latest_month_then_move_to_the_next(self):
        bars = [{"month": "2025-01", "through": "2025-01-20", "scope": "all"}]
        self.assertEqual(follow.bar_months(bars, date(2025, 1, 25)), (JAN, date(2025, 1, 25)))
        self.assertEqual(follow.bar_months(bars, date(2025, 2, 3)), (JAN, FEB))
        bars[0]["through"] = "2025-02-01"
        self.assertEqual(follow.bar_months(bars, FEB), (FEB, FEB))  # the first day: members only
        self.assertEqual(follow.bar_months(bars, date(2025, 2, 3)), (FEB, date(2025, 2, 3)))

    def test_the_next_closed_month_past_skipped_ones_and_the_stops(self):
        self.assertEqual(follow.following(monthly("BTCUSDT", JAN, FEB), "BTCUSDT"), MAR)
        self.assertEqual(follow.following(monthly("BTCUSDT", JAN, FEB), "BTCUSDT", [MAR, APR]), MAY)
        self.assertEqual(follow.following(monthly("BTCUSDT", JAN), "ETHUSDT")["code"], follow.NO_HISTORY)
        # A month held short of its end (a manual import before the month closed) can never be completed.
        partial = monthly("BTCUSDT", JAN, FEB, through=date(2025, 2, 10))
        self.assertEqual(follow.following(partial, "BTCUSDT")["code"], follow.PARTIAL_MONTH)

    def test_holes_lie_between_the_first_and_latest_held_month(self):
        self.assertEqual(follow.holes(monthly("BTCUSDT", JAN, APR), "BTCUSDT"), [FEB, MAR])
        self.assertEqual(follow.holes(monthly("BTCUSDT", JAN), "ETHUSDT"), [])


class MonthlyTests(unittest.TestCase):
    """Quotes and aggTrades by closed month, with the archive downloads and the importers stood in for."""

    def setUp(self):
        self.calls: list[tuple] = []
        self.refusals: dict[tuple, list[Exception]] = {}
        self.unpublished: set[tuple] = set()
        self.held: list[dict] = []
        self.cleared: list[tuple] = []
        self.broken: set[tuple] = set()
        for name, side in (("_published", lambda cache, symbol, month: (symbol, month) not in self.unpublished),
                           ("_import", self.importing), ("_listing", lambda kind, profile: self.held),
                           ("_clear", lambda cache, symbol, month: self.cleared.append((symbol, month))),
                           ("_republished", lambda cache, symbol, month: True),
                           ("_sound", lambda cache, symbol, month: (symbol, month) not in self.broken)):
            stand_in = patch.object(follow, name, side_effect=side)
            stand_in.start()
            self.addCleanup(stand_in.stop)

    def importing(self, kind, profile, month, cache, symbols, log):
        self.calls.append((kind, month, tuple(symbols)))
        for symbol in symbols:
            pending = self.refusals.get((symbol, month))
            if pending:
                exc = pending.pop(0)
                if len(symbols) > 1:
                    self.held += [item for other in symbols if other != symbol and (other, month) not in self.refusals
                                  for item in monthly(other, month)]
                raise exc
        return [{"symbol": symbol, "rows": 10, "commit": f"{symbol}-{month:%Y%m}",
                 "through": universe.next_month(month).isoformat()} for symbol in symbols]

    def run_kind(self, kind, imports, today, memory=None, symbols=("BTCUSDT", "ETHUSDT")):
        memory = memory or follow.Memory()
        found = entries(*symbols)
        follow._monthly(kind, {}, imports, list(symbols), Path("."), memory, today, lambda _: None, found)
        return found, memory

    def test_only_closed_months_quotes_one_contract_a_call_and_trades_one_call_per_month(self):
        imports = monthly("BTCUSDT", JAN) + monthly("ETHUSDT", JAN)
        self.run_kind("quotes", imports, date(2025, 3, 10))
        self.assertEqual(self.calls, [("quotes", FEB, ("BTCUSDT",)), ("quotes", FEB, ("ETHUSDT",))])
        self.calls.clear()
        found, _ = self.run_kind("trades", imports, date(2025, 4, 2))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT", "ETHUSDT")), ("trades", MAR, ("BTCUSDT", "ETHUSDT"))])
        self.assertEqual(found["BTCUSDT"]["commits"], ["BTCUSDT-202502", "BTCUSDT-202503"])
        self.calls.clear()
        self.run_kind("trades", monthly("BTCUSDT", JAN, FEB), date(2025, 3, 31))  # March has not closed
        self.assertEqual(self.calls, [])

    def test_a_month_not_fully_published_waits_without_an_import_call(self):
        self.unpublished.add(("ETHUSDT", FEB))
        self.run_kind("trades", monthly("BTCUSDT", JAN) + monthly("ETHUSDT", JAN), date(2025, 3, 2))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",))])

    def test_a_refused_group_reads_which_contracts_committed_and_retries_the_rest_one_by_one(self):
        self.refusals[("ETHUSDT", FEB)] = [refused("SOURCE_UNREACHABLE")]
        imports = monthly("BTCUSDT", JAN) + monthly("ETHUSDT", JAN)
        found, memory = self.run_kind("trades", imports, date(2025, 3, 2))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT", "ETHUSDT")), ("trades", FEB, ("ETHUSDT",))])
        self.assertEqual((found["ETHUSDT"]["commits"], memory.stopped), (["ETHUSDT-202502"], {}))

    def test_a_sequence_gap_downloads_the_month_again_once_then_skips_it(self):
        gap = refused("SEQUENCE_GAP", "BTCUSDT 2025-02-09")
        self.refusals[("BTCUSDT", FEB)] = [gap, gap]
        found, memory = self.run_kind("trades", monthly("BTCUSDT", JAN), date(2025, 4, 2), symbols=("BTCUSDT",))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",))] * 2 + [("trades", MAR, ("BTCUSDT",))])
        self.assertEqual((self.cleared, memory.skipped, memory.stopped), ([("BTCUSDT", FEB)], {("trades", "BTCUSDT"): [FEB]}, {}))
        self.assertEqual(found["BTCUSDT"]["commits"], ["BTCUSDT-202503"])
        # The next round passes the skipped month by, so a gap never makes the follower poll it every hour.
        self.calls.clear()
        self.run_kind("trades", monthly("BTCUSDT", JAN), date(2025, 3, 20), memory, ("BTCUSDT",))
        self.assertEqual(self.calls, [])

    def test_a_gap_on_the_eve_stops_the_contract_since_skipping_the_month_cannot_help(self):
        self.refusals[("BTCUSDT", FEB)] = [refused("SEQUENCE_GAP", "BTCUSDT 2025-01-31")]
        _, memory = self.run_kind("quotes", monthly("BTCUSDT", JAN), date(2025, 4, 2), symbols=("BTCUSDT",))
        self.assertEqual((memory.stopped[("quotes", "BTCUSDT")]["code"], memory.skipped), ("SEQUENCE_GAP", {}))
        self.assertEqual(len(self.calls), 1)

    def test_retries_stops_of_a_contract_and_stops_of_everything(self):
        self.refusals[("BTCUSDT", FEB)] = [refused("CONCURRENT_IMPORT")]
        self.refusals[("ETHUSDT", FEB)] = [refused("TERMS_UNKNOWN")]
        found, memory = self.run_kind("quotes", monthly("BTCUSDT", JAN) + monthly("ETHUSDT", JAN), date(2025, 3, 2))
        self.assertEqual((found["BTCUSDT"]["retry"]["code"], list(memory.stopped)), ("CONCURRENT_IMPORT",
                                                                                     [("quotes", "ETHUSDT")]))
        self.refusals[("BTCUSDT", FEB)] = [refused("DIRTY_WORKING_SET")]
        _, memory = self.run_kind("quotes", monthly("BTCUSDT", JAN) + monthly("ETHUSDT", JAN), date(2025, 3, 2))
        self.assertEqual(list(memory.stopped), ["*"])
        self.assertEqual(self.calls[-1], ("quotes", FEB, ("BTCUSDT",)))  # nothing after a database refusal

    def test_an_import_that_does_not_reach_the_month_end_stops_the_contract(self):
        def short(kind, profile, month, cache, symbols, log):
            return [{"symbol": "BTCUSDT", "rows": 1, "commit": "c", "through": "2025-02-20"}]
        with patch.object(follow, "_import", side_effect=short):
            _, memory = self.run_kind("quotes", monthly("BTCUSDT", JAN), date(2025, 4, 2), symbols=("BTCUSDT",))
        self.assertEqual(memory.stopped[("quotes", "BTCUSDT")]["code"], follow.PARTIAL_MONTH)

    def test_holes_are_tried_once_when_their_archives_are_new_or_republished(self):
        found = entries("BTCUSDT")
        memory = follow.Memory()
        self.refusals[("BTCUSDT", MAR)] = [refused("SEQUENCE_GAP", "BTCUSDT 2025-03-05")]
        follow._holes("trades", {}, monthly("BTCUSDT", JAN, APR), ["BTCUSDT"], Path("."), memory, lambda _: None,
                      found)
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",)), ("trades", MAR, ("BTCUSDT",))])
        self.assertEqual((found["BTCUSDT"]["filled"], memory.stopped), (["2025-02"], {}))
        self.calls.clear()
        with patch.object(follow, "_republished", return_value=False):
            follow._holes("trades", {}, monthly("BTCUSDT", JAN, APR), ["BTCUSDT"], Path("."), memory,
                          lambda _: None, entries("BTCUSDT"))
        self.assertEqual(self.calls, [])
        # A gap still in the archives is found outside the lock: no import call.
        self.broken.add(("BTCUSDT", MAR))
        follow._holes("trades", {}, monthly("BTCUSDT", JAN, APR), ["BTCUSDT"], Path("."), memory, lambda _: None,
                      entries("BTCUSDT"))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",))])


class BarsTests(unittest.TestCase):
    def setUp(self):
        self.ready: set[date] = set()
        self.calls: list[date] = []
        for name, side in (("_bars_ready", lambda cache, symbols, day: day in self.ready),):
            stand_in = patch.object(follow, name, side_effect=side)
            stand_in.start()
            self.addCleanup(stand_in.stop)

    def importing(self, profile, month, cache, symbols=None, log=print):
        self.calls.append(month)
        end = min(universe.next_month(month), self.today)
        return {"month": f"{month:%Y-%m}", "through": end.isoformat(), "scope": "all", "bar_rows": 1,
                "funding_rows": 0, "universe_members": ["BTCUSDT"], "market_commit": f"c{len(self.calls)}"}

    def run_bars(self, through: str, today: date):
        self.today = today
        listing = {"bars": [{"month": "2025-01", "through": through, "scope": "all"}], "members": {JAN: ["BTCUSDT"]}}
        entry = {"rows": 0, "commits": []}
        with patch.object(store, "import_month", side_effect=self.importing):
            follow._bars({}, listing, Path("."), follow.Memory(), today, lambda _: None, entry)
        return entry

    def test_a_month_is_sealed_once_its_last_day_is_archived_then_the_next_month_starts(self):
        self.assertEqual(self.run_bars("2025-01-31", FEB)["commits"], [])  # Jan 31's archives are not out
        self.ready.add(date(2025, 1, 31))
        self.assertEqual(self.run_bars("2025-01-31", FEB)["commits"], ["c1", "c2"])
        self.assertEqual(self.calls, [JAN, FEB])  # January sealed, then February's members

    def test_a_held_last_closed_day_imports_nothing_and_a_late_month_end_is_sealed_after_lag_days(self):
        self.assertEqual(self.run_bars("2025-01-20", date(2025, 1, 20))["commits"], [])
        self.assertEqual(self.run_bars("2025-01-10", date(2025, 1, 20))["commits"], [])  # Jan 19 is not out yet
        self.ready.add(date(2025, 1, 19))
        self.assertEqual(self.run_bars("2025-01-10", date(2025, 1, 20))["commits"], ["c1"])
        # Jan 31 never comes out: LAG_DAYS after it closed January is sealed anyway (its last day from REST),
        # and February waits for its own last closed day.
        late = FEB + timedelta(days=follow.LAG_DAYS + 1)
        self.assertEqual(self.run_bars("2025-01-10", late)["commits"], ["c2"])
        self.assertEqual(self.calls[-1], JAN)


class BarsReadyTests(unittest.TestCase):
    def test_a_contract_archived_the_day_before_is_waited_for_and_one_that_stopped_is_not(self):
        archived = {"BTCUSDT": {"2025-01-30", "2025-01-31"}, "ETHUSDT": {"2025-01-30"}, "OLDUSDT": set()}

        def daily(cache, kind, symbol, interval, days, workers=4):
            return {day: Path(day) for day in days if day in archived[symbol]}
        with patch.object(sources, "daily_archives", side_effect=daily):
            self.assertFalse(follow._bars_ready(Path("."), ["BTCUSDT", "ETHUSDT", "OLDUSDT"], date(2025, 1, 31)))
            archived["ETHUSDT"].add("2025-01-31")
            self.assertTrue(follow._bars_ready(Path("."), ["BTCUSDT", "ETHUSDT", "OLDUSDT"], date(2025, 1, 31)))


class RoundOrderTests(unittest.TestCase):
    """A round with every importer stood in for: what stops what, and the holes once a month."""

    def listing(self) -> dict:
        return {"bars": [{"month": "2025-03", "through": "2025-03-02", "scope": "all"}], "members": {},
                "metrics": [], "quotes": monthly("BTCUSDT", JAN, MAR), "trades": monthly("BTCUSDT", JAN, MAR)}

    def run_round(self, memory, bars=None, monthly_=None, now=None):
        with patch.object(follow, "_listings", side_effect=lambda profile: self.listing()), \
                patch.object(follow, "_bars", side_effect=bars or (lambda *args: None)), \
                patch.object(follow, "_monthly", side_effect=monthly_ or (lambda *args: None)), \
                patch.object(follow, "_holes") as holes:
            status = follow.run_round({}, ["BTCUSDT"], Path("."), memory, lambda: None, now or at(date(2025, 3, 2)),
                                      lambda _: None)
        return status, holes

    def test_a_kind_refusal_stops_only_its_kind_and_a_database_refusal_everything(self):
        memory = follow.Memory()

        def bars(*args):
            raise refused("MONTH_EXISTS", "2025-03")
        status, _ = self.run_round(memory, bars=bars)
        kinds = status["kinds"]
        self.assertEqual((kinds["bars"]["scope"]["state"], kinds["bars"]["scope"]["refusal"]["code"],
                          kinds["quotes"]["BTCUSDT"]["state"]), ("stopped", "MONTH_EXISTS", "caught_up"))

        def monthly_(kind, *args):
            if kind == "trades":
                raise AssertionError("not reached")
            memory.stopped["*"] = {"code": "DIRTY_WORKING_SET", "message": "dirty"}
        status, _ = self.run_round(memory, monthly_=monthly_)
        self.assertEqual({entry["state"] for entries_ in status["kinds"].values() for entry in entries_.values()},
                         {"stopped"})

    def test_the_next_round_is_hourly_while_anything_waits_else_the_next_day(self):
        status, _ = self.run_round(follow.Memory())  # bars hold March 1, the last closed day: all caught up
        self.assertEqual(status["next_round"], "2025-03-03T00:30:00+00:00")
        status, _ = self.run_round(follow.Memory(), now=at(date(2025, 3, 3)))  # March 2 is still to come
        self.assertEqual(status["kinds"]["bars"]["scope"]["state"], "waiting")
        self.assertEqual(status["next_round"], (at(date(2025, 3, 3)) + follow.HOURLY).isoformat())

    def test_a_failure_between_imports_is_retried_and_one_about_the_database_stops_everything(self):
        def monthly_(kind, *args):
            raise refused("MARKET_UNREACHABLE")
        memory = follow.Memory()
        status, _ = self.run_round(memory, monthly_=monthly_)
        self.assertEqual((status["kinds"]["trades"]["BTCUSDT"]["retry"]["code"], memory.stopped),
                         ("MARKET_UNREACHABLE", {}))

        def dirty(kind, *args):
            raise refused("DIRTY_WORKING_SET")
        status, _ = self.run_round(memory, monthly_=dirty)
        self.assertEqual(memory.stopped["*"]["code"], "DIRTY_WORKING_SET")

    def test_holes_are_tried_in_the_first_round_of_each_month(self):
        memory = follow.Memory()
        _, holes = self.run_round(memory)
        self.assertEqual(holes.call_count, 2)  # quotes and trades
        _, holes = self.run_round(memory, now=at(date(2025, 3, 20)))
        holes.assert_not_called()
        _, holes = self.run_round(memory, now=at(date(2025, 4, 1)))
        self.assertEqual(holes.call_count, 2)


class CheckTests(unittest.TestCase):
    def test_healthy_only_while_fresh_and_everything_caught_up_or_waiting(self):
        now = at(FEB)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "status.json"
            self.assertEqual(follow.check(path, now), 1)  # no round yet
            for states, age, expected in ((("caught_up", "waiting"), 0, 0), (("caught_up", "lagging"), 0, 1),
                                          (("stopped",), 0, 1), (("unknown",), 0, 1), (("caught_up",), 27, 1)):
                follow.write_status(path, {"at": (now - timedelta(hours=age)).isoformat(),
                                           "kinds": {"bars": {"scope": {"state": "caught_up"}},
                                                     "trades": {str(n): {"state": s, "skipped": ["2025-01"]}
                                                                for n, s in enumerate(states)}}})
                with self.subTest(states=states, age=age):
                    self.assertEqual(follow.check(path, now), expected)

    def test_publishes_refused_for_longer_than_stale_are_unhealthy(self):
        now = at(FEB)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "status.json"
            for failing, expected in ((None, 0), (25, 0), (27, 1)):
                since = None if failing is None else (now - timedelta(hours=failing)).isoformat()
                follow.write_status(path, {"at": now.isoformat(), "kinds": {"metrics": {"BTCUSDT": {"state": "caught_up"}}},
                                           "publish_failing_since": since})
                with self.subTest(failing=failing):
                    self.assertEqual(follow.check(path, now), expected)


class LoopTests(unittest.TestCase):
    def test_the_first_round_waits_the_start_delay_and_rounds_sleep_in_short_naps(self):
        clock = [at(FEB)]
        naps: list[float] = []
        seen: list[dict] = []

        def sleep(seconds):
            naps.append(seconds)
            clock[0] += timedelta(seconds=seconds)

        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "status.json"

            def round_(profile, symbols, cache, memory, publish, now, log):
                seen.append(json.loads(path.read_text()))  # marked running before the round starts
                return {"at": now.isoformat(), "kinds": {}, "next_round": (now + timedelta(hours=1)).isoformat()}

            lines = []
            with patch.object(follow, "run_round", side_effect=round_):
                last = follow.follow({}, ["BTCUSDT"], Path(temp), path, lambda: None, report=lines.append,
                                     clock=lambda: clock[0], sleep=sleep, rounds=2)
            self.assertEqual(json.loads(path.read_text()), last)
        self.assertEqual(len(lines), 2)
        start = at(FEB) + timedelta(seconds=follow.START_DELAY)
        self.assertEqual(last["at"], (start + timedelta(hours=1)).isoformat())
        self.assertTrue(naps and max(naps) <= follow.NAP and sum(naps) == follow.START_DELAY + 3600)
        self.assertEqual([item["running_since"] for item in seen],
                         [start.isoformat(), (start + timedelta(hours=1)).isoformat()])
        self.assertEqual(seen[0]["at"], start.isoformat())  # the first round has no status before it

    def test_a_run_of_refused_publishes_keeps_its_first_round_until_one_succeeds(self):
        clock = [at(FEB)]
        refusals = iter([{"code": "CONCURRENT_IMPORT"}, {"code": "PUBLISH_FAILED"}, None, {"code": "PUBLISH_FAILED"}])

        def round_(profile, symbols, cache, memory, publish, now, log):
            return {"at": now.isoformat(), "kinds": {}, "publish_refusal": next(refusals),
                    "next_round": (now + timedelta(hours=1)).isoformat()}

        lines = []
        with tempfile.TemporaryDirectory() as temp, patch.object(follow, "run_round", side_effect=round_):
            follow.follow({}, ["BTCUSDT"], Path(temp), Path(temp) / "status.json", lambda: None,
                          report=lines.append, clock=lambda: clock[0], delay=0,
                          sleep=lambda seconds: clock.__setitem__(0, clock[0] + timedelta(seconds=seconds)), rounds=4)
        first, later = at(FEB).isoformat(), (at(FEB) + timedelta(hours=3)).isoformat()
        self.assertEqual([json.loads(line)["publish_failing_since"] for line in lines], [first, first, None, later])

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

    def round(self, profile, memory, now, symbols=("BTCUSDT", "ETHUSDT"), publish=None):
        """A round of metrics only: bars, quotes and aggTrades have their own tests with the importers stood in for."""
        with patch.object(follow, "_bars"), patch.object(follow, "_monthly"), patch.object(follow, "_holes"):
            status = follow.run_round(profile, list(symbols), self.cache, memory, publish or self.publish, now,
                                      lambda _: None)
        return {**status, "contracts": status["kinds"]["metrics"]}

    def test_each_contract_imports_its_own_days_across_the_month_end_and_the_round_publishes_once(self):
        profile = self.market()
        # Feb 3: BTCUSDT has Jan 31, Feb 1 and 2; ETHUSDT's Jan 31 is not out, its February days are.
        days = {"BTCUSDT": [date(2025, 1, 31), FEB, date(2025, 2, 2)], "ETHUSDT": [FEB, date(2025, 2, 2)]}
        with serving(self.exchange(days)):
            status = self.round(profile, follow.Memory(), at(date(2025, 2, 3)))
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
            later = self.round(profile, follow.Memory(), at(date(2025, 2, 4)))
            imported.assert_not_called()
        self.assertEqual((later["contracts"]["BTCUSDT"]["state"], later["contracts"]["ETHUSDT"]["state"]),
                         ("waiting", "lagging"))

    def test_a_held_lock_retries_and_a_content_refusal_stops_only_its_contract_until_restart(self):
        profile = self.market()
        days = {"BTCUSDT": [date(2025, 1, 31)], "ETHUSDT": [date(2025, 1, 31)]}
        stopped = follow.Memory()
        holder = store.connect(profile, "import")
        try:
            store.lock(holder)
            with serving(self.exchange(days)):
                status = self.round(profile, stopped, at(FEB))
        finally:
            holder.close()
        self.assertEqual({entry["retry"]["code"] for entry in status["contracts"].values()}, {"CONCURRENT_IMPORT"})
        self.assertEqual({entry["state"] for entry in status["contracts"].values()}, {"waiting"})
        self.assertEqual(stopped.stopped, {})
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
        stopped = follow.Memory()
        unconfirmed = Refusal("PUBLISH_FAILED", "the push was not confirmed", write_status="not_written")
        with serving(self.exchange({"BTCUSDT": [date(2025, 1, 31)]})):
            status = self.round(profile, stopped, at(FEB), ("BTCUSDT",), publish=refusing(unconfirmed))
        self.assertEqual((status["publish_refusal"]["code"], stopped.stopped), ("PUBLISH_FAILED", {}))
        with serving(Exchange(START)):
            status = self.round(profile, stopped, at(FEB, 1), ("BTCUSDT",))
        self.assertEqual((status["published"], status["contracts"]["BTCUSDT"]["rows"]), ({"head": 1}, 0))
        rejected = Refusal("PUBLISH_REJECTED", "origin has diverged", write_status="not_written")
        with serving(Exchange(START)):
            status = self.round(profile, stopped, at(FEB, 2), ("BTCUSDT",), publish=refusing(rejected))
        self.assertEqual(stopped.stopped["*"]["code"], "PUBLISH_REJECTED")
        with serving(self.exchange({"BTCUSDT": [FEB]})), patch.object(follow.metrics, "import_month") as imported:
            status = self.round(profile, stopped, at(date(2025, 2, 2)), ("BTCUSDT",))
            imported.assert_not_called()
        self.assertEqual(status["contracts"]["BTCUSDT"]["state"], "stopped")
        self.assertEqual(self.published, ["published"])

    def test_an_unreachable_service_while_publishing_or_importing_is_retried_next_round(self):
        profile = self.market(("BTCUSDT",))
        stopped = follow.Memory()
        down = Refusal("LEDGER_UNAVAILABLE", "the service administrator could not connect to publish",
                       write_status="not_written")
        with serving(self.exchange({"BTCUSDT": [date(2025, 1, 31)]})):
            status = self.round(profile, stopped, at(FEB), ("BTCUSDT",), publish=refusing(down))
        self.assertEqual((status["publish_refusal"]["code"], stopped.stopped), ("LEDGER_UNAVAILABLE", {}))
        self.assertEqual(status["contracts"]["BTCUSDT"]["state"], "caught_up")
        lost = store._sql_error(pymysql.err.OperationalError(2013, "Lost connection to MySQL server during query"))
        self.assertEqual(lost.code, "MARKET_UNREACHABLE")
        with serving(self.exchange({"BTCUSDT": [FEB]})), patch.object(follow.metrics, "import_month",
                                                                          side_effect=lost):
            status = self.round(profile, stopped, at(date(2025, 2, 2)), ("BTCUSDT",))
        btc = status["contracts"]["BTCUSDT"]
        self.assertEqual((btc["retry"]["code"], btc["state"], stopped.stopped), ("MARKET_UNREACHABLE", "waiting", {}))

    def test_a_contract_without_history_is_not_imported_and_an_unreadable_market_waits(self):
        profile = self.market(("BTCUSDT",))
        with serving(self.exchange({"SOLUSDT": [date(2025, 1, 31)]})):
            status = self.round(profile, follow.Memory(), at(FEB), ("BTCUSDT", "SOLUSDT"))
        self.assertEqual(status["contracts"]["SOLUSDT"]["refusal"]["code"], follow.NO_HISTORY)
        with store.connect(profile, "reader") as conn:
            self.assertEqual(conn.rows("SELECT COUNT(*) FROM metrics WHERE symbol = 'SOLUSDT'"), [(0,)])
        gone = {**profile, "database": "missing_market"}
        status = self.round(gone, follow.Memory(), at(FEB), ("BTCUSDT",))
        self.assertIsNotNone(status["round_refusal"])
        self.assertEqual((status["contracts"]["BTCUSDT"]["state"], status["published"]), ("unknown", None))
        self.assertEqual(status["next_round"], (at(FEB) + follow.HOURLY).isoformat())


@unittest.skipUnless(BINARY, SKIP)
class MonthlyImportTests(unittest.TestCase):
    """Quotes and aggTrades through the real importers, from cached archives: the follower's calls and their
    receipts agree with what the importers hold."""

    @classmethod
    def setUpClass(cls):
        cls.fixture = TemporaryMarket()
        cls.addClassCleanup(cls.fixture.close)
        cls.temp = tempfile.TemporaryDirectory(prefix="follow-monthly-")
        cls.addClassCleanup(cls.temp.cleanup)

    def setUp(self):
        offline = patch.object(sources, "_get", side_effect=AssertionError("network access in a cached test"))
        offline.start()
        self.addCleanup(offline.stop)

    def market(self, gap_on: date | None = None):
        """A market holding January's bars, quotes and aggTrades of BTCUSDT, and a cache holding every daily
        aggTrades archive from 2024-12-31 through March (a gap on `gap_on`)."""
        import numpy as np
        name = self._testMethodName.removeprefix("test_")[:40]
        profile = self.fixture.add("follow_m_" + name)
        cache = Path(self.temp.name) / name
        times = START + np.arange(1440, dtype=np.int64) * 60_000
        price = np.full(1440, 100 * 10**8, dtype=np.int64)
        columns = {"ts_open": times, **{key: price for key in ("open", "high", "low", "close")},
                   "volume": np.full(1440, 10000, dtype=np.int64)}
        seed(profile, month="2025-01", through="2025-02-01", scope=["BTCUSDT"],
             terms=[("BTCUSDT", {"price_increment": "0.01", "size_increment": "0.001"})],
             bars={("BTCUSDT", "LAST"): columns, ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(1440, np.int64)}})
        identity = 1
        for moment in range(START - store.DAY, day_ms(APR), store.DAY):
            day = datetime.fromtimestamp(moment / 1000, UTC).date()
            rows = two_sided_trades(moment, moment + 3 * 60_000, identity)  # six trades a day, ids contiguous
            identity += len(rows)
            if day == gap_on:
                rows = rows[:3] + rows[4:]
            archive(cache, day.isoformat(), rows)
        store.import_quotes(profile, JAN, cache, symbols=["BTCUSDT"], log=lambda _: None)
        aggtrades.import_month(profile, JAN, cache, ["BTCUSDT"], log=lambda _: None)
        return profile, cache

    def listing(self, profile, kind):
        return follow._listing(kind, profile)

    def test_each_closed_month_after_the_latest_is_imported_once_by_the_real_importers(self):
        profile, cache = self.market()
        memory = follow.Memory()
        for kind in follow.MONTHLY:
            found = entries("BTCUSDT")
            follow._monthly(kind, profile, self.listing(profile, kind), ["BTCUSDT"], cache, memory,
                            date(2025, 3, 31), lambda _: None, found)
            with self.subTest(kind=kind):
                self.assertEqual((len(found["BTCUSDT"]["commits"]), found["BTCUSDT"]["rows"] > 0), (1, True))
                held = follow._held(self.listing(profile, kind), "BTCUSDT")
                self.assertEqual(held, {JAN: FEB, FEB: MAR})
                # Nothing more until March closes: no call, so no lock.
                again = entries("BTCUSDT")
                follow._monthly(kind, profile, self.listing(profile, kind), ["BTCUSDT"], cache, memory,
                                date(2025, 3, 31), lambda _: None, again)
                self.assertEqual(again["BTCUSDT"]["commits"], [])
        self.assertEqual(memory.stopped, {})
        with store.connect(profile, "reader") as conn:
            self.assertEqual(conn.rows("SELECT table_name FROM dolt_status"), [])

    def test_a_month_with_a_sequence_gap_is_skipped_and_the_next_one_imported(self):
        profile, cache = self.market(gap_on=date(2025, 2, 10))
        memory = follow.Memory()
        found = entries("BTCUSDT")
        with patch.object(follow, "_clear"):  # the archive comes again with the same gap
            follow._monthly("trades", profile, self.listing(profile, "trades"), ["BTCUSDT"], cache, memory,
                            APR, lambda _: None, found)
        self.assertEqual((memory.skipped, memory.stopped), ({("trades", "BTCUSDT"): [FEB]}, {}))
        self.assertEqual(follow._held(self.listing(profile, "trades"), "BTCUSDT"), {JAN: FEB, MAR: APR})
        self.assertEqual(follow.holes(self.listing(profile, "trades"), "BTCUSDT"), [FEB])
        # Read through outside the lock, the gap month is unsound and the month after it sound.
        self.assertEqual((follow._sound(cache, "BTCUSDT", FEB), follow._sound(cache, "BTCUSDT", MAR)), (False, True))


if __name__ == "__main__":
    unittest.main()
