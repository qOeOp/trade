"""The unattended market upkeep: which days and months a round imports, how each refusal is sorted, the status
and the healthcheck; importers stood in for, or throwaway market directories; no
active market or real network."""

from datetime import UTC, date, datetime, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from market import aggtrades, files, follow, metrics, sources, store, universe
from tests.market.directory import directory, read, seed
from tests.market.exchange import Exchange, day_ms, serving, two_sided_trades
from tests.market.test_aggtrades import archive
from tests.market.test_metrics import JAN, START, day_text, line, put


FEB = date(2025, 2, 1)


def days_of(first: date, through: date) -> set[date]:
    """The days from `first` before `through`."""
    return {first + timedelta(days=count) for count in range((through - first).days)}


def scope(symbols=("BTCUSDT",), **kw) -> follow.Scope:
    return follow.Scope(list(symbols), JAN, JAN, JAN, JAN, **kw)


def at(day: date, hour=0, minute=40) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


class MissingTests(unittest.TestCase):
    def test_every_day_from_the_first_before_today_not_held_by_month(self):
        held = days_of(JAN, date(2025, 1, 31))
        # Feb 3: Jan 31 is still missing, Feb 1 and 2 have closed.
        self.assertEqual(follow.missing(held, JAN, date(2025, 2, 3)),
                         {JAN: [date(2025, 1, 31)], FEB: [FEB, date(2025, 2, 2)]})
        # A hole stays due however much later days are held, and a day known to have no archive is left alone.
        held |= days_of(FEB, date(2025, 2, 3))
        self.assertEqual(follow.missing(held, JAN, date(2025, 3, 2)),
                         {JAN: [date(2025, 1, 31)], FEB: sorted(days_of(date(2025, 2, 3), date(2025, 3, 1))),
                          date(2025, 3, 1): [date(2025, 3, 1)]})
        self.assertNotIn(JAN, follow.missing(held, JAN, date(2025, 2, 3), {date(2025, 1, 31)}))

    def test_a_contract_new_to_the_scope_starts_at_the_first_day_and_never_before_it(self):
        self.assertEqual(follow.missing(set(), date(2025, 1, 30), FEB), {JAN: [date(2025, 1, 30), date(2025, 1, 31)]})
        self.assertEqual(follow.missing(set(), FEB, FEB), {})


MAR, APR, MAY = date(2025, 3, 1), date(2025, 4, 1), date(2025, 5, 1)


def refused(code: str, *missing: str) -> sources.MarketError:
    return sources.MarketError(f"refused {code}", code=code, missing=missing)


def entries(*symbols: str) -> dict:
    return {symbol: {"rows": 0} for symbol in symbols}


class SortTests(unittest.TestCase):
    def test_each_refusal_retries_or_stops_its_contract_its_kind_or_everything(self):
        for kind, code, expected in (
                ("quotes", "ARCHIVE_NOT_PUBLISHED", "retry"), ("trades", "CONCURRENT_IMPORT", "retry"),
                ("trades", "CHECKSUM_MISMATCH", "retry"), ("metrics", "MONTH_EXISTS", "retry"),
                ("quotes", "TRADES_NOT_HELD", "retry"), ("bars", "MONTH_EXISTS", "kind"),
                ("bars", "UNIVERSE_CHANGED", "kind"), ("bars", "DATA_TESTS_FAILED", "all"),
                ("quotes", "TERMS_UNKNOWN", "contract"),
                ("trades", "SEQUENCE_GAP", "contract")):
            with self.subTest(kind=kind, code=code):
                self.assertEqual(follow.sort(kind, refused(code)), expected)
        # An error without a code (a full disk) stops instead of downloading gigabytes again every hour.
        self.assertEqual(follow.sort("trades", OSError(28, "No space left on device")), "contract")


class MonthTests(unittest.TestCase):
    def test_bars_finish_the_latest_month_then_move_to_the_next(self):
        through = {JAN: date(2025, 1, 20)}
        self.assertEqual(follow.bar_months(through, JAN, date(2025, 1, 25)), (JAN, date(2025, 1, 25)))
        self.assertEqual(follow.bar_months(through, JAN, date(2025, 2, 3)), (JAN, FEB))
        through[JAN] = FEB
        self.assertEqual(follow.bar_months(through, JAN, FEB), (FEB, FEB))  # the first day: nothing closed
        self.assertEqual(follow.bar_months(through, JAN, date(2025, 2, 3)), (FEB, date(2025, 2, 3)))

    def test_bars_start_at_the_first_month_reach_back_to_it_and_stop_at_a_month_missing_between(self):
        self.assertEqual(follow.bar_months({}, JAN, date(2025, 3, 3)), (JAN, FEB))
        self.assertEqual(follow.bar_months({MAR: APR}, JAN, date(2025, 5, 3)), (FEB, MAR))
        self.assertEqual(follow.bar_months({JAN: FEB, MAR: APR}, JAN, date(2025, 5, 3)), (FEB, MAR))

    def test_the_next_month_after_the_latest_past_skipped_ones(self):
        self.assertEqual(follow.following({JAN, FEB}, JAN), MAR)
        self.assertEqual(follow.following({JAN, FEB}, JAN, [MAR, APR]), MAY)
        self.assertEqual(follow.following(set(), JAN), JAN)  # a contract new to the scope

    def test_holes_lie_between_the_first_month_and_the_latest_held(self):
        self.assertEqual(follow.holes({JAN, APR}, JAN), [FEB, MAR])
        self.assertEqual(follow.holes({MAR}, JAN), [JAN, FEB])
        self.assertEqual(follow.holes(set(), JAN), [])


class MonthlyTests(unittest.TestCase):
    """Quotes and aggTrades by closed month, with the archive downloads and the importers stood in for."""

    def setUp(self):
        self.calls: list[tuple] = []
        self.refusals: dict[tuple, list[Exception]] = {}
        self.unpublished: set[tuple] = set()
        self.months: dict[tuple, set[date]] = {}
        self.cleared: list[tuple] = []
        self.broken: set[tuple] = set()
        for name, side in (("_published", lambda cache, symbol, month: (symbol, month) not in self.unpublished),
                           ("_import", self.importing), ("_held", self.listed),
                           ("_clear", lambda cache, symbol, month: self.cleared.append((symbol, month))),
                           ("_republished", lambda cache, symbol, month: True),
                           ("_sound", lambda cache, symbol, month: (symbol, month) not in self.broken)):
            stand_in = patch.object(follow, name, side_effect=side)
            stand_in.start()
            self.addCleanup(stand_in.stop)

    def listed(self, profile, kind, symbols):
        return {symbol: set(self.months.get((kind, symbol), ())) for symbol in symbols}

    def holding(self, kind, *months, symbols=("BTCUSDT", "ETHUSDT")):
        for symbol in symbols:
            self.months[(kind, symbol)] = set(months)

    def importing(self, kind, profile, month, cache, symbols, log):
        self.calls.append((kind, month, tuple(symbols)))
        done = []
        for symbol in symbols:
            pending = self.refusals.get((symbol, month))
            if pending:
                exc = pending.pop(0)
                raise exc
            self.months.setdefault((kind, symbol), set()).add(month)
            done.append({"symbol": symbol, "rows": 10})
        return done

    def run_kind(self, kind, today, memory=None, symbols=("BTCUSDT", "ETHUSDT")):
        memory = memory or follow.Memory()
        found = entries(*symbols)
        follow._monthly(kind, {}, JAN, list(symbols), Path("."), memory, today, lambda _: None, found)
        return found, memory

    def test_only_closed_months_quotes_one_contract_a_call_and_trades_one_call_per_month(self):
        self.holding("quotes", JAN)
        self.holding("trades", JAN, FEB)
        self.run_kind("quotes", date(2025, 3, 10))
        self.assertEqual(self.calls, [("quotes", FEB, ("BTCUSDT",)), ("quotes", FEB, ("ETHUSDT",))])
        self.calls.clear()
        self.holding("trades", JAN)
        found, _ = self.run_kind("trades", date(2025, 4, 2))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT", "ETHUSDT")), ("trades", MAR, ("BTCUSDT", "ETHUSDT"))])
        self.assertEqual(found["BTCUSDT"]["rows"], 20)
        self.calls.clear()
        self.holding("trades", JAN, FEB)
        self.run_kind("trades", date(2025, 3, 31))  # March has not closed
        self.assertEqual(self.calls, [])

    def test_a_contract_new_to_the_scope_starts_at_the_first_month(self):
        self.run_kind("trades", FEB, symbols=("BTCUSDT",))
        self.assertEqual(self.calls, [("trades", JAN, ("BTCUSDT",))])

    def test_a_month_not_fully_published_waits_and_one_long_closed_is_passed_over(self):
        self.holding("trades", JAN)
        self.unpublished.add(("ETHUSDT", FEB))
        self.run_kind("trades", date(2025, 3, 2))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",))])
        self.calls.clear()
        self.holding("trades", JAN)
        late = MAR + timedelta(days=follow.GIVE_UP_DAYS)
        _, memory = self.run_kind("trades", late)
        self.assertEqual(memory.skipped, {("trades", "ETHUSDT"): [FEB]})
        self.assertEqual(self.calls[:2], [("trades", FEB, ("BTCUSDT",)), ("trades", MAR, ("BTCUSDT", "ETHUSDT"))])

    def test_a_month_not_out_is_passed_over_once_the_closed_month_after_it_is_wholly_out(self):
        self.holding("trades", JAN)
        self.unpublished.add(("ETHUSDT", FEB))
        self.unpublished.add(("ETHUSDT", MAR))
        _, memory = self.run_kind("trades", APR)  # March closed, but it has a day missing too
        self.assertEqual(memory.skipped, {})
        self.assertEqual(self.calls[:2], [("trades", FEB, ("BTCUSDT",)), ("trades", MAR, ("BTCUSDT",))])
        self.calls.clear()
        self.holding("trades", JAN)
        self.unpublished.discard(("ETHUSDT", MAR))
        _, memory = self.run_kind("trades", APR)
        self.assertEqual(memory.skipped, {("trades", "ETHUSDT"): [FEB]})
        self.assertEqual(self.calls[:2], [("trades", FEB, ("BTCUSDT",)), ("trades", MAR, ("BTCUSDT", "ETHUSDT"))])

    def test_quotes_wait_for_the_months_aggtrades_and_pass_a_month_they_passed_by(self):
        self.holding("quotes", JAN)
        self.holding("trades", JAN)
        self.months[("trades", "ETHUSDT")] = {JAN, MAR}  # February passed by, March held
        _, memory = self.run_kind("quotes", date(2025, 4, 2))
        self.assertEqual(self.calls, [("quotes", MAR, ("ETHUSDT",))])
        self.assertEqual(memory.skipped, {("quotes", "ETHUSDT"): [FEB]})

    def test_a_refused_group_reads_which_contracts_were_written_and_retries_the_rest_one_by_one(self):
        self.holding("trades", JAN)
        self.refusals[("ETHUSDT", FEB)] = [refused("SOURCE_UNREACHABLE")]
        found, memory = self.run_kind("trades", date(2025, 3, 2))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT", "ETHUSDT")), ("trades", FEB, ("ETHUSDT",))])
        self.assertEqual((found["ETHUSDT"]["rows"], memory.stopped), (10, {}))

    def test_a_sequence_gap_downloads_the_month_again_once_then_skips_it(self):
        self.holding("trades", JAN, symbols=("BTCUSDT",))
        gap = refused("SEQUENCE_GAP", "BTCUSDT 2025-02-09")
        self.refusals[("BTCUSDT", FEB)] = [gap, gap]
        found, memory = self.run_kind("trades", date(2025, 4, 2), symbols=("BTCUSDT",))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",))] * 2 + [("trades", MAR, ("BTCUSDT",))])
        self.assertEqual((self.cleared, memory.skipped, memory.stopped), ([("BTCUSDT", FEB)], {("trades", "BTCUSDT"): [FEB]}, {}))
        self.assertEqual(found["BTCUSDT"]["rows"], 10)
        # The next round passes the skipped month by, so a gap never makes the follower poll it every hour.
        self.calls.clear()
        self.holding("trades", JAN, symbols=("BTCUSDT",))
        self.run_kind("trades", date(2025, 3, 20), memory, ("BTCUSDT",))
        self.assertEqual(self.calls, [])

    def test_a_gap_on_the_eve_stops_the_contract_since_skipping_the_month_cannot_help(self):
        self.holding("trades", JAN, symbols=("BTCUSDT",))
        self.refusals[("BTCUSDT", FEB)] = [refused("SEQUENCE_GAP", "BTCUSDT 2025-01-31")]
        _, memory = self.run_kind("trades", date(2025, 4, 2), symbols=("BTCUSDT",))
        self.assertEqual((memory.stopped[("trades", "BTCUSDT")]["code"], memory.skipped), ("SEQUENCE_GAP", {}))
        self.assertEqual(len(self.calls), 1)

    def test_retries_stops_of_a_contract_and_stops_of_everything(self):
        self.holding("quotes", JAN)
        self.holding("trades", JAN, FEB)
        self.refusals[("BTCUSDT", FEB)] = [refused("CONCURRENT_IMPORT")]
        self.refusals[("ETHUSDT", FEB)] = [refused("TERMS_UNKNOWN")]
        found, memory = self.run_kind("quotes", date(2025, 3, 2))
        self.assertEqual((found["BTCUSDT"]["retry"]["code"], list(memory.stopped)), ("CONCURRENT_IMPORT",
                                                                                     [("quotes", "ETHUSDT")]))
        self.refusals[("BTCUSDT", FEB)] = [refused("DATA_TESTS_FAILED")]
        _, memory = self.run_kind("quotes", date(2025, 3, 2))
        self.assertEqual(list(memory.stopped), ["*"])
        self.assertEqual(self.calls[-1], ("quotes", FEB, ("BTCUSDT",)))  # nothing after a refusal of the whole market

    def test_holes_are_tried_once_when_their_archives_are_new_or_republished(self):
        self.holding("trades", JAN, APR, symbols=("BTCUSDT",))
        found = entries("BTCUSDT")
        memory = follow.Memory()
        self.refusals[("BTCUSDT", MAR)] = [refused("SEQUENCE_GAP", "BTCUSDT 2025-03-05")]
        follow._holes("trades", {}, JAN, ["BTCUSDT"], Path("."), memory, lambda _: None, found)
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",)), ("trades", MAR, ("BTCUSDT",))])
        self.assertEqual((found["BTCUSDT"]["filled"], memory.stopped), (["2025-02"], {}))
        self.calls.clear()
        self.holding("trades", JAN, APR, symbols=("BTCUSDT",))
        with patch.object(follow, "_republished", return_value=False):
            follow._holes("trades", {}, JAN, ["BTCUSDT"], Path("."), memory, lambda _: None, entries("BTCUSDT"))
        self.assertEqual(self.calls, [])
        # A gap still in the archives is found outside the lock: no import call.
        self.broken.add(("BTCUSDT", MAR))
        follow._holes("trades", {}, JAN, ["BTCUSDT"], Path("."), memory, lambda _: None, entries("BTCUSDT"))
        self.assertEqual(self.calls, [("trades", FEB, ("BTCUSDT",))])

    def test_a_quotes_hole_is_filled_once_the_aggtrades_hold_the_month(self):
        self.holding("quotes", MAR, symbols=("BTCUSDT",))
        self.holding("trades", FEB, MAR, symbols=("BTCUSDT",))
        found = entries("BTCUSDT")
        follow._holes("quotes", {}, JAN, ["BTCUSDT"], Path("."), follow.Memory(), lambda _: None, found)
        self.assertEqual((self.calls, found["BTCUSDT"]["filled"]), ([("quotes", FEB, ("BTCUSDT",))], ["2025-02"]))


class BarsTests(unittest.TestCase):
    def setUp(self):
        self.ready: set[date] = set()
        self.calls: list[date] = []
        for name, side in (("_bars_ready", lambda cache, symbols, day: day in self.ready),):
            stand_in = patch.object(follow, name, side_effect=side)
            stand_in.start()
            self.addCleanup(stand_in.stop)

    def importing(self, profile, month, cache, symbols=None, log=print):
        self.calls.append((month, symbols))
        end = min(universe.next_month(month), self.today)
        return {"month": f"{month:%Y-%m}", "through": end.isoformat(), "bar_rows": 1, "funding_rows": 0,
                "universe_members": ["BTCUSDT"]}

    def run_bars(self, through: date, today: date, bar_symbols=None, members=None):
        self.today = today
        self.calls = []
        listing = {"bars": {JAN: through}, "members": members or {JAN: ["BTCUSDT"]}}
        entry = {"rows": 0}
        with patch.object(store, "import_month", side_effect=self.importing):
            follow._bars({}, listing, scope(bar_symbols=bar_symbols), Path("."), today, lambda _: None, entry)
        return [month for month, _ in self.calls]

    def test_a_month_is_finished_once_its_last_day_is_archived_then_the_next_month_starts(self):
        self.assertEqual(self.run_bars(date(2025, 1, 31), FEB), [])  # Jan 31's archives are not out
        self.ready.add(date(2025, 1, 31))
        self.assertEqual(self.run_bars(date(2025, 1, 31), FEB), [JAN, FEB])  # then February's members, on its first day
        self.ready.add(FEB)
        self.assertEqual(self.run_bars(date(2025, 1, 31), date(2025, 2, 2)), [JAN, FEB])

    def test_a_held_last_closed_day_imports_nothing_and_a_late_month_end_is_finished_after_lag_days(self):
        self.assertEqual(self.run_bars(date(2025, 1, 20), date(2025, 1, 20)), [])
        self.assertEqual(self.run_bars(date(2025, 1, 10), date(2025, 1, 20)), [])  # Jan 19 is not out yet
        self.ready.add(date(2025, 1, 19))
        self.assertEqual(self.run_bars(date(2025, 1, 10), date(2025, 1, 20)), [JAN])
        # Jan 31 never comes out: LAG_DAYS after it closed January is finished anyway (its last day from REST),
        # and February waits for its own last closed day.
        late = FEB + timedelta(days=follow.LAG_DAYS + 1)
        self.assertEqual(self.run_bars(date(2025, 1, 10), late), [JAN])

    def test_a_months_first_day_imports_its_members_once(self):
        self.assertEqual(self.run_bars(FEB, FEB), [FEB])
        self.assertEqual(self.run_bars(FEB, FEB, members={JAN: ["BTCUSDT"], FEB: ["BTCUSDT"]}), [])
        self.assertEqual(self.run_bars(date(2025, 1, 20), date(2025, 1, 20)), [])  # within a month, no such import

    def test_the_import_gets_the_deployments_contracts(self):
        self.ready.add(date(2025, 1, 19))
        self.run_bars(date(2025, 1, 10), date(2025, 1, 20), ["BTCUSDT", "ETHUSDT"])
        self.assertEqual(self.calls, [(JAN, ["BTCUSDT", "ETHUSDT"])])


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

    def listing(self, profile, symbols) -> dict:
        return {"bars": {JAN: FEB, FEB: MAR, MAR: date(2025, 3, 2)}, "members": {}, "metrics": {"BTCUSDT": days_of(JAN, date(2025, 3, 2))},
                "quotes": {"BTCUSDT": {JAN, MAR}}, "trades": {"BTCUSDT": {JAN, MAR}}}

    def run_round(self, memory, bars=None, monthly_=None, now=None):
        with patch.object(follow, "_listings", side_effect=self.listing), \
                patch.object(follow, "_bars", side_effect=bars or (lambda *args: None)), \
                patch.object(follow, "_monthly", side_effect=monthly_ or (lambda *args: None)), \
                patch.object(follow, "_fetched", return_value=False), patch.object(follow, "_holes") as holes:
            status = follow.run_round({}, scope(), Path("."), memory, now or at(date(2025, 3, 2)), lambda _: None)
        return status, holes

    def test_a_kind_refusal_stops_only_its_kind_and_a_market_refusal_everything(self):
        memory = follow.Memory()

        def bars(*args):
            raise refused("MONTH_EXISTS", "2025-03")
        status, _ = self.run_round(memory, bars=bars)
        kinds = status["kinds"]
        self.assertEqual((kinds["bars"]["scope"]["state"], kinds["bars"]["scope"]["refusal"]["code"],
                          kinds["quotes"]["BTCUSDT"]["state"]), ("stopped", "MONTH_EXISTS", "caught_up"))

        def monthly_(kind, *args):
            if kind == "quotes":
                raise AssertionError("not reached")
            memory.stopped["*"] = {"code": "DATA_TESTS_FAILED", "message": "a member did not trade on its eve"}
        status, _ = self.run_round(memory, monthly_=monthly_)
        self.assertEqual({entry["state"] for entries_ in status["kinds"].values() for entry in entries_.values()},
                         {"stopped"})

    def test_the_next_round_is_hourly_while_anything_waits_else_the_next_day(self):
        status, _ = self.run_round(follow.Memory())  # everything holds March 1, the last closed day
        self.assertEqual(status["next_round"], "2025-03-03T00:30:00+00:00")
        status, _ = self.run_round(follow.Memory(), now=at(date(2025, 3, 3)))  # March 2 is still to come
        self.assertEqual(status["kinds"]["bars"]["scope"]["state"], "waiting")
        self.assertEqual(status["next_round"], (at(date(2025, 3, 3)) + follow.HOURLY).isoformat())

    def test_a_failure_between_imports_is_retried_and_one_about_the_market_stops_everything(self):
        def monthly_(kind, *args):
            raise refused("MARKET_UNREACHABLE")
        memory = follow.Memory()
        status, _ = self.run_round(memory, monthly_=monthly_)
        self.assertEqual((status["kinds"]["trades"]["BTCUSDT"]["retry"]["code"], memory.stopped),
                         ("MARKET_UNREACHABLE", {}))

        def failed(kind, *args):
            raise refused("DATA_TESTS_FAILED")
        status, _ = self.run_round(memory, monthly_=failed)
        self.assertEqual(memory.stopped["*"]["code"], "DATA_TESTS_FAILED")

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

            def round_(profile, scoped, cache, memory, now, log):
                seen.append(json.loads(path.read_text()))  # marked running before the round starts
                return {"at": now.isoformat(), "kinds": {}, "next_round": (now + timedelta(hours=1)).isoformat()}

            lines = []
            with patch.object(follow, "run_round", side_effect=round_):
                last = follow.follow({}, scope(), Path(temp), path, report=lines.append,
                                     clock=lambda: clock[0], sleep=sleep, rounds=2)
            self.assertEqual(json.loads(path.read_text()), last)
        self.assertEqual(len(lines), 2)
        start = at(FEB) + timedelta(seconds=follow.START_DELAY)
        self.assertEqual(last["at"], (start + timedelta(hours=1)).isoformat())
        self.assertTrue(naps and max(naps) <= follow.NAP and sum(naps) == follow.START_DELAY + 3600)
        self.assertEqual([item["running_since"] for item in seen],
                         [start.isoformat(), (start + timedelta(hours=1)).isoformat()])
        self.assertEqual(seen[0]["at"], start.isoformat())  # the first round has no status before it

    def test_no_contracts_is_refused_at_start(self):
        with self.assertRaises(sources.MarketError) as caught:
            follow.follow({}, scope(()), Path("."), Path("status.json"), rounds=1)
        self.assertEqual(caught.exception.code, "IMPORT_SCOPE")

class RoundTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="follow-test-")
        self.addCleanup(temp.cleanup)
        self.cache = Path(temp.name)
        # A download no stand-in exchange serves fails the test instead of reaching Binance.
        offline = patch.object(sources, "_get", side_effect=AssertionError("network access outside serving()"))
        offline.start()
        self.addCleanup(offline.stop)

    def market(self, symbols=("BTCUSDT", "ETHUSDT")) -> dict:
        """A market holding January 1-30 of each contract."""
        import numpy as np
        profile = directory(self.addCleanup)
        times = START - store.DAY + np.arange(2880, dtype=np.int64) * 60_000
        price = np.full(2880, 100 * 10**8, dtype=np.int64)
        columns = {"ts_open": times, **{name: price for name in ("open", "high", "low", "close")},
                   "volume": np.full(2880, 10000, dtype=np.int64)}
        seed(profile, month="2025-01", through="2025-02-01",
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

    def round(self, profile, memory, now, symbols=("BTCUSDT", "ETHUSDT")):
        """A round of metrics only: bars, quotes and aggTrades have their own tests with the importers stood in for."""
        with patch.object(follow, "_bars"), patch.object(follow, "_monthly"), patch.object(follow, "_holes"):
            status = follow.run_round(profile, scope(symbols), self.cache, memory, now,
                                      lambda _: None)
        return {**status, "contracts": status["kinds"]["metrics"]}

    def test_each_contract_imports_its_own_days_across_the_month_end(self):
        profile = self.market()
        # Feb 3: BTCUSDT has Jan 31, Feb 1 and 2; ETHUSDT's Jan 31 is not out, its February days are.
        days = {"BTCUSDT": [date(2025, 1, 31), FEB, date(2025, 2, 2)], "ETHUSDT": [FEB, date(2025, 2, 2)]}
        with serving(self.exchange(days)):
            status = self.round(profile, follow.Memory(), at(date(2025, 2, 3)))
        btc, eth = status["contracts"]["BTCUSDT"], status["contracts"]["ETHUSDT"]
        self.assertEqual((btc["state"], btc["rows"], btc["missing_days"]), ("caught_up", 864, 0))
        self.assertEqual((eth["state"], eth["rows"], eth["missing_from"]), ("waiting", 576, "2025-01-31"))
        self.assertEqual(status["next_round"], (at(date(2025, 2, 3)) + follow.HOURLY).isoformat())
        stored = read(profile, "metrics")["symbol"].to_pylist()
        self.assertEqual([stored.count(symbol) for symbol in ("BTCUSDT", "ETHUSDT")], [33 * 288, 32 * 288])
        # A day later nothing is out: no import call (and so no lock); both wait for Feb 3, and ETHUSDT's Jan 31,
        # now older than metrics.SETTLE_DAYS, is listed and not asked for again.
        with serving(Exchange(START)), patch.object(follow.metrics, "import_month") as imported:
            later = self.round(profile, follow.Memory(), at(date(2025, 2, 4)))
            imported.assert_not_called()
        self.assertEqual((later["contracts"]["BTCUSDT"]["state"], later["contracts"]["ETHUSDT"]["state"],
                          later["contracts"]["ETHUSDT"]["unpublished"]), ("waiting", "waiting", ["2025-01-31"]))

    def test_a_held_lock_retries_and_a_content_refusal_stops_only_its_contract_until_restart(self):
        profile = self.market()
        days = {"BTCUSDT": [date(2025, 1, 31)], "ETHUSDT": [date(2025, 1, 31)]}
        stopped = follow.Memory()
        with files.lock(files.open_market(profile, "import")), serving(self.exchange(days)):
            status = self.round(profile, stopped, at(FEB))
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

    def test_an_unreachable_market_while_importing_is_retried_next_round(self):
        profile = self.market(("BTCUSDT",))
        stopped = follow.Memory()
        lost = refused("MARKET_UNREACHABLE")
        with serving(self.exchange({"BTCUSDT": [FEB]})), patch.object(follow.metrics, "import_month",
                                                                          side_effect=lost):
            status = self.round(profile, stopped, at(date(2025, 2, 2)), ("BTCUSDT",))
        btc = status["contracts"]["BTCUSDT"]
        self.assertEqual((btc["retry"]["code"], btc["state"], stopped.stopped), ("MARKET_UNREACHABLE", "waiting", {}))

    def test_a_contract_new_to_the_scope_starts_at_the_first_day_and_an_unreadable_market_waits(self):
        profile = self.market(("BTCUSDT",))
        with serving(self.exchange({"SOLUSDT": [date(2025, 1, 31)]})):
            status = self.round(profile, follow.Memory(), at(FEB), ("BTCUSDT", "SOLUSDT"))
        solana = status["contracts"]["SOLUSDT"]
        self.assertEqual((solana["rows"], solana["unpublished"][0]), (288, "2025-01-01"))
        self.assertEqual(read(profile, "metrics")["symbol"].to_pylist().count("SOLUSDT"), 288)
        gone = {"root": str(Path(profile["root"]) / "missing")}
        status = self.round(gone, follow.Memory(), at(FEB), ("BTCUSDT",))
        self.assertIsNotNone(status["round_refusal"])
        self.assertEqual(status["contracts"]["BTCUSDT"]["state"], "unknown")
        self.assertEqual(status["next_round"], (at(FEB) + follow.HOURLY).isoformat())


class MonthlyImportTests(unittest.TestCase):
    """Quotes and aggTrades through the real importers, from cached archives: the follower's calls agree with the
    files the importers leave."""

    @classmethod
    def setUpClass(cls):
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
        profile = directory(self.addCleanup)
        cache = Path(self.temp.name) / name
        times = START + np.arange(1440, dtype=np.int64) * 60_000
        price = np.full(1440, 100 * 10**8, dtype=np.int64)
        columns = {"ts_open": times, **{key: price for key in ("open", "high", "low", "close")},
                   "volume": np.full(1440, 10000, dtype=np.int64)}
        seed(profile, month="2025-01", through="2025-02-01",
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
        aggtrades.import_month(profile, JAN, cache, ["BTCUSDT"], log=lambda _: None)
        store.import_quotes(profile, JAN, cache, symbols=["BTCUSDT"], log=lambda _: None)
        return profile, cache

    def test_each_closed_month_after_the_latest_is_imported_once_by_the_real_importers(self):
        profile, cache = self.market()
        memory = follow.Memory()
        for kind in follow.MONTHLY:
            found = entries("BTCUSDT")
            follow._monthly(kind, profile, JAN, ["BTCUSDT"], cache, memory, date(2025, 3, 31), lambda _: None, found)
            with self.subTest(kind=kind):
                self.assertGreater(found["BTCUSDT"]["rows"], 0)
                self.assertEqual(follow._held(profile, kind, ["BTCUSDT"]), {"BTCUSDT": {JAN, FEB}})
                # Nothing more until March closes: no call, so no lock.
                again = entries("BTCUSDT")
                follow._monthly(kind, profile, JAN, ["BTCUSDT"], cache, memory, date(2025, 3, 31), lambda _: None, again)
                self.assertEqual(again["BTCUSDT"]["rows"], 0)
        self.assertEqual(memory.stopped, {})
        self.assertEqual(list(Path(profile["root"]).rglob(".*")), [])

    def test_a_month_with_a_sequence_gap_is_skipped_and_the_next_one_imported(self):
        profile, cache = self.market(gap_on=date(2025, 2, 10))
        memory = follow.Memory()
        with patch.object(follow, "_clear"):  # the archive comes again with the same gap
            follow._monthly("trades", profile, JAN, ["BTCUSDT"], cache, memory, APR, lambda _: None, entries("BTCUSDT"))
        self.assertEqual((memory.skipped, memory.stopped), ({("trades", "BTCUSDT"): [FEB]}, {}))
        held = follow._held(profile, "trades", ["BTCUSDT"])["BTCUSDT"]
        self.assertEqual(held, {JAN, MAR})
        self.assertEqual(follow.holes(held, JAN), [FEB])
        # Read through outside the lock, the gap month is unsound and the month after it sound.
        self.assertEqual((follow._sound(cache, "BTCUSDT", FEB), follow._sound(cache, "BTCUSDT", MAR)), (False, True))


if __name__ == "__main__":
    unittest.main()
