"""The liquidation import from the recorder's spool: recorded spool samples (tests/market/spool, 2026-11-02) and
lines built in their format, read into rows and watch intervals and imported into throwaway market directories; the
round of market follow that imports them and the recorder's retirement of published days; no active market or
network."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

from market import coverage, follow, liquidations, record, review, series, sources, store, versions
from tests.market.directory import directory, forged, head, read, seed
from tests.market.test_metrics import JAN, START


SAMPLES = Path(__file__).with_name("spool")
SAMPLE_DAY = date(2026, 11, 2)
DAY = date(2025, 3, 10)
LOW = series._day_ms(DAY)
MIDNIGHT = LOW + store.DAY
NOW = datetime(2025, 3, 11, 0, 30, tzinfo=UTC)
OFFSET = 1_000_000  # wall minus monotonic clock of the built lines


def line(at: int, conn: str, event: str, text: str | None = None, mono: int | None = None) -> str:
    value: dict = {"at": at, "mono": at - OFFSET if mono is None else mono, "conn": conn, "event": event}
    if text is not None:
        value["text"] = text
    return json.dumps(value, separators=(",", ":")) + "\n"


def force_order(symbol: str, trade: int, event: int | None = None, **order) -> str:
    body = {"s": symbol, "S": "SELL", "o": "LIMIT", "f": "IOC", "q": "5", "p": "1.50", "ap": "1.5", "X": "FILLED",
            "l": "2", "z": "5", "T": trade, "ps": symbol.split("_")[0], "st": 1, **order}
    return json.dumps({"e": "forceOrder", "E": trade + 60 if event is None else event, "o": body})


def all_liquidation(stamp: int, *rows: tuple[str, int, str, str, str]) -> str:
    return json.dumps({"topic": f"allLiquidation.{rows[0][0]}", "type": "snapshot", "ts": stamp,
                       "data": [{"T": at, "s": symbol, "S": side, "v": size, "p": price}
                                for symbol, at, side, size, price in rows]})


def subscribe(conn: str, number: int, *symbols: str) -> str:
    return json.dumps({"req_id": f"{conn}-{number}", "op": "subscribe",
                       "args": [f"allLiquidation.{symbol}" for symbol in symbols]})


def answer(conn: str, number: int, success=True) -> str:
    return json.dumps({"success": success, "ret_msg": "" if success else "error:handler not found", "conn_id": "c",
                       "req_id": f"{conn}-{number}", "op": "subscribe"})


def beats(conn: str, start: int, stop: int, step: int = 15_000) -> list[tuple[int, str]]:
    """A live connection's pongs every `step` ms in [start, stop)."""
    return [(at, line(at, conn, "pong")) for at in range(start, stop, step)]


class Spool:
    """A spool directory of built lines: {venue: {day: [(at, line)]}}, each file in arrival order."""

    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="liquidation-spool-")
        self.root = Path(self.temp.name)

    def write(self, venue: str, *items: tuple[int, str]) -> None:
        for at, text in sorted(items, key=lambda item: item[0]):
            target = liquidations.path(self.root, venue, series._ms_day(at))
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("a", encoding="utf-8") as stream:
                stream.write(text)

    def samples(self) -> None:
        for venue in liquidations.VENUES:
            target = liquidations.path(self.root, venue, SAMPLE_DAY)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(SAMPLES / f"{venue}.jsonl", target)

    def close(self) -> None:
        self.temp.cleanup()


class ReadTests(unittest.TestCase):
    def setUp(self):
        self.spool = Spool()
        self.addCleanup(self.spool.close)

    def scan(self, venue: str, day: date = DAY) -> liquidations._Scan:
        return liquidations.scan(self.spool.root, venue, day)

    def test_the_recorded_samples_read_as_every_pushed_row_with_its_checks_and_their_watch(self):
        self.spool.samples()
        binance = self.scan("binance", SAMPLE_DAY)
        self.assertEqual(len(binance.rows), 26)
        # A coin-margined contract arrives on the same stream: pair ETHUSD, st 2.
        self.assertIn(("ETHUSD_PERP", 1793611933084, "SELL", Decimal("2274.93"), Decimal("2285.98"), Decimal("461"),
                       Decimal("461"), Decimal("46"), "FILLED", 1793611934091),
                      binance.rows)
        self.assertEqual(dict(binance.spans), {"": [[1793611853650, 1793612348643]]})  # from its open
        bybit = self.scan("bybit", SAMPLE_DAY)
        self.assertEqual(len(bybit.rows), 28)  # two of the messages carry several rows
        self.assertEqual(len(bybit.spans), 20)  # the two subscribe requests' contracts, from their answers
        self.assertEqual(bybit.spans["1000BONKPERP"], [[1793611853882, 1793612068675]])

    def test_a_watch_breaks_at_a_wall_clock_gap_a_clock_jump_an_unreadable_line_a_restart_and_a_close(self):
        start = LOW + 3_600_000
        self.spool.write("binance", (start, line(start, "binance-1", "open", liquidations.URLS["binance"])),
                         *beats("binance-1", start + 1000, start + 61_000),
                         # 46 s without a line (host sleep with a live socket), then on again
                         *beats("binance-1", start + 106_000, start + 136_000),  # 106 and 121 s
                         # the monotonic clock stood still for 5 s of wall clock
                         (start + 140_000, line(start + 140_000, "binance-1", "pong", mono=start + 135_000 - OFFSET)),
                         (start + 150_000, line(start + 150_000, "binance-1", "pong", mono=start + 145_000 - OFFSET)),
                         (start + 151_000, '{"at":17936118\n'),  # cut short by a crash (the recorder ends it)
                         (start + 152_000, line(start + 152_000, "binance-1", "pong", mono=start + 147_000 - OFFSET)),
                         # the recorder restarted: binance-1 again, a new connection
                         (start + 160_000, line(start + 160_000, "binance-1", "open", liquidations.URLS["binance"])),
                         (start + 170_000, line(start + 170_000, "binance-1", "pong")),
                         (start + 175_000, line(start + 175_000, "binance-1", "close", "stopped")))
        self.assertEqual(self.scan("binance").spans[""],
                         [[start, start + 46_000], [start + 106_000, start + 121_000], [start + 140_000, start + 150_000],
                          [start + 152_000, start + 152_000], [start + 160_000, start + 170_000]])
        self.assertEqual(self.scan("binance").unreadable[DAY], 1)

    def test_a_row_received_too_early_ends_the_watch_at_the_last_row_in_time_until_the_clock_jumps(self):
        start = LOW + 3_600_000
        self.spool.write("binance", (start, line(start, "binance-1", "open", liquidations.URLS["binance"])),
                         *beats("binance-1", start + 1000, start + 61_000),
                         (start + 20_000, line(start + 20_000, "binance-1", "frame", force_order("BTCUSDT", start + 19_900))),
                         # the wall clock lags 5 s behind the venue's (host sleep paused the VM, both clocks with it)
                         (start + 40_000, line(start + 40_000, "binance-1", "frame",
                                               force_order("ETHUSDT", start + 45_000, event=start + 45_100))),
                         *beats("binance-1", start + 61_000, start + 121_000),
                         # then the wall clock is set right: it jumps 5 s against the monotonic one
                         *[(at, line(at, "binance-1", "pong", mono=at - OFFSET - 5_000))
                           for at in range(start + 126_000, start + 160_000, 15_000)])
        found = self.scan("binance")
        self.assertEqual(found.spans[""], [[start, start + 20_000], [start + 126_000, start + 156_000]])
        self.assertEqual((found.early[DAY], len(found.rows)), (1, 2))  # the early row is kept, as received

    def test_a_watch_runs_through_midnight_into_both_days_and_bybit_keeps_its_subscriptions(self):
        start = MIDNIGHT - 120_000
        self.spool.write("bybit", (start, line(start, "bybit-1", "open", liquidations.URLS["bybit"])),
                         (start + 1, line(start + 1, "bybit-1", "subscribe", subscribe("bybit-1", 1, "BTCUSDT", "XUSDT"))),
                         (start + 2, line(start + 2, "bybit-1", "subscribe", subscribe("bybit-1", 2, "YUSDT"))),
                         (start + 90, line(start + 90, "bybit-1", "frame", answer("bybit-1", 1))),
                         (start + 95, line(start + 95, "bybit-1", "frame", answer("bybit-1", 2, success=False))),
                         *beats("bybit-1", start + 10_000, MIDNIGHT + 300_000))
        before = self.scan("bybit")  # the next day is read until 2 x HEARTBEAT past midnight
        self.assertEqual(dict(before.spans), {"BTCUSDT": [[start + 90, MIDNIGHT + 70_000]],
                                              "XUSDT": [[start + 90, MIDNIGHT + 70_000]]})
        self.assertEqual(before.refused, [{"at": start + 95, "symbols": ["YUSDT"], "ret_msg": "error:handler not found"}])
        self.assertEqual(liquidations._union(before.spans["BTCUSDT"], LOW, MIDNIGHT), [[start + 90, MIDNIGHT]])
        after = self.scan("bybit", DAY + timedelta(days=1))
        self.assertEqual(liquidations._union(after.spans["BTCUSDT"], MIDNIGHT, MIDNIGHT + store.DAY),
                         [[MIDNIGHT, MIDNIGHT + 295_000]])

    def test_a_connection_opened_before_the_day_before_or_elsewhere_watches_nothing_but_its_rows_count(self):
        at = LOW + 1000
        self.spool.write("binance", *beats("binance-7", LOW, LOW + 60_000),
                         (at, line(at, "binance-7", "frame", force_order("BTCUSDT", at - 900))),
                         (LOW + 2000, line(LOW + 2000, "binance-8", "open", "wss://fstream.binance.com/ws/!forceOrder@arr")),
                         *beats("binance-8", LOW + 3000, LOW + 60_000))
        found = self.scan("binance")
        self.assertEqual((dict(found.spans), len(found.rows)), ({}, 1))
        self.assertEqual(liquidations.URLS, {"binance": record.BINANCE, "bybit": record.BYBIT})

    def test_every_pushed_key_is_stored_or_checked(self):
        at = LOW + 1000

        def refused(text: str, venue="binance") -> str:
            spool = Spool()
            self.addCleanup(spool.close)
            spool.write(venue, (at, line(at, f"{venue}-1", "frame", text)))
            with self.assertRaises(sources.MarketError) as caught:
                liquidations.scan(spool.root, venue, DAY)
            return caught.exception.code

        self.assertEqual(refused(force_order("BTCUSDT", at, extra="1")), "SOURCE_SHAPE")  # an unknown key
        self.assertEqual(refused(force_order("BTCUSDT", at, f="GTC")), "SOURCE_SHAPE")
        self.assertEqual(refused(force_order("BTCUSDT", at, X="filled ")), "SOURCE_SHAPE")
        partial = liquidations.binance_row(json.loads(force_order("BTCUSDT", at, q="6", X="PARTIALLY_FILLED")), "x")
        self.assertEqual(partial[5:9], (6, 5, 2, "PARTIALLY_FILLED"))  # stored, not refused
        self.assertEqual(refused(force_order("BTCUSDT", at, st=2)), "SOURCE_SHAPE")  # a USD-M pair
        self.assertEqual(refused(force_order("BTCUSDT", at, ap="1e3")), "SOURCE_SHAPE")  # no exact decimal
        self.assertEqual(refused(force_order("BTCUSDT", at, ap="0.0000000000001")), "SCALE_LOSS")
        self.assertEqual(refused(force_order("BTCUSDT", at, z="0.000000001", q="0.000000001")), "SCALE_LOSS")
        self.assertEqual(refused('{"e":"forceOrder"'), "SOURCE_SHAPE")  # no JSON
        self.assertEqual(refused(all_liquidation(at, ("BTCUSDT", at, "Buy", "1", "2"))[:-1] + ',"cs":1}', "bybit"),
                         "SOURCE_SHAPE")
        self.assertEqual(refused(all_liquidation(at, ("BTCUSDT", at, "Long", "1", "2")), "bybit"), "SOURCE_SHAPE")
        self.assertEqual(refused('{"success":true,"ret_msg":"","conn_id":"c","req_id":"","op":"auth"}', "bybit"),
                         "SOURCE_SHAPE")
        # 1.50 and 1.5 are one value, so one key.
        self.assertEqual(hash(liquidations._decimal("1.50", "p", versions.PRICE)), hash(Decimal("1.5")))

    def test_pending_days_are_closed_days_after_the_latest_import(self):
        for day in (DAY, DAY + timedelta(days=1), DAY + timedelta(days=2)):
            at = series._day_ms(day)
            self.spool.write("binance", (at, line(at, "binance-1", "pong")))
        self.assertEqual(liquidations.pending(self.spool.root, [], datetime(2025, 3, 12, 0, 4, tzinfo=UTC)), [DAY])
        with self.assertRaises(sources.MarketError) as caught:  # a wrong path or mount is no quiet market
            liquidations.pending(self.spool.root / "elsewhere", [], NOW)
        self.assertEqual(caught.exception.code, "SPOOL_MISSING")
        self.assertEqual(liquidations.pending(self.spool.root, [{"day": "2025-03-10"}],
                                              datetime(2025, 3, 13, 0, 30, tzinfo=UTC)),
                         [DAY + timedelta(days=1), DAY + timedelta(days=2)])

    def test_a_bybit_contract_pairs_with_binance_by_coin_and_settlement(self):
        listed = ["1000PEPEUSDT", "BTCPERP", "BTCUSDT", "BTC-26DEC25", "SHIB1000USDT", "PEPEUSDT"]
        self.assertEqual(liquidations.bybit_symbols("1000SHIBUSDT", listed), ["SHIB1000USDT"])
        self.assertEqual(liquidations.bybit_symbols("1000PEPEUSDT", listed), ["1000PEPEUSDT", "PEPEUSDT"])
        self.assertEqual(liquidations.bybit_symbols("BTCUSDC", listed), ["BTCPERP"])
        self.assertEqual(liquidations.bybit_symbols("ETHUSD_PERP", listed), [])
        self.assertGreater(liquidations.HEARTBEAT, 2 * record.PING * 1000)


class RetireTests(unittest.TestCase):
    def test_only_days_published_and_a_week_old_are_retired_and_none_without_a_status(self):
        with tempfile.TemporaryDirectory() as temp:
            root, status = Path(temp) / "spool", Path(temp) / "status.json"
            for venue in record.VENUES:
                (root / venue).mkdir(parents=True)
                for n in range(1, 6):
                    (root / venue / f"2025-03-0{n}.jsonl").write_text("{}\n")
            today = date(2025, 3, 12)  # the days through March 4 were imported 7 days ago or more
            self.assertEqual(record.retire(root, status, today), [])
            status.write_text(json.dumps({"kinds": {"liquidations": {"spool": {"published_through": "2025-03-03"}}}}))
            # The last published day stays: the next day's import reads it.
            self.assertEqual(sorted(path.name for path in record.retire(root, status, today)),
                             ["2025-03-01.jsonl"] * 2)
            status.write_text(json.dumps({"kinds": {"liquidations": {"spool": {"published_through": "2025-03-06"}}}}))
            self.assertEqual(sorted(path.name for path in record.retire(root, status, today)),
                             [f"2025-03-0{n}.jsonl" for n in (2, 2, 3, 3, 4, 4)])

    def test_a_line_a_crash_cut_short_is_ended_before_the_next_one(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "binance").mkdir()
            target = Path(root) / "binance" / "2026-11-02.jsonl"
            target.write_text('{"at":1793611853650,"mo')
            spool = record.Spool(Path(root), "binance")
            with patch.object(record, "_now", return_value=(1793611860000, 5)):
                spool.write("binance-1", "open", "wss://x")
            spool.close()
            self.assertEqual(target.read_text().splitlines()[1], '{"at":1793611860000,"mono":5,"conn":"binance-1",'
                                                                 '"event":"open","text":"wss://x"}')


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.spool = Spool()
        self.addCleanup(self.spool.close)

    def market(self) -> dict:
        profile = directory(self.addCleanup)
        # The eve and first day of the month: data_tests checks a member traded on its eve.
        times = START - store.DAY + np.arange(2880, dtype=np.int64) * 60_000
        price = np.full(2880, 100 * 10**8, dtype=np.int64)
        columns = {"ts_open": times, **{name: price for name in ("open", "high", "low", "close")},
                   "volume": np.full(2880, 10000, dtype=np.int64)}
        seed(profile, month="2025-01", through="2025-02-01", scope=["BTCUSDT"],
             terms=[("BTCUSDT", {"price_increment": "0.01", "size_increment": "0.001"})],
             bars={("BTCUSDT", "LAST"): columns, ("BTCUSDT", "MARK"): {**columns, "volume": np.zeros(2880, np.int64)}},
             members=[(JAN, "BTCUSDT")])
        return profile

    def imported(self, profile: dict, now: datetime = NOW) -> dict | None:
        return liquidations.import_next(profile, self.spool.root, log=lambda _: None, now=now)

    def test_the_recorded_day_is_one_version_with_its_readings_watch_and_coverage(self):
        profile = self.market()
        self.spool.samples()
        now = datetime(2026, 11, 3, 0, 30, tzinfo=UTC)
        found = self.imported(profile, now)
        assert found is not None
        binance, bybit = found["readings"]["binance"], found["readings"]["bybit"]
        self.assertEqual((found["day"], binance["rows"], bybit["rows"], found["liquidation_rows"]),
                         ("2026-11-02", 26, 28, 54))
        self.assertEqual((binance["repeated_rows"], binance["merged_rows"], binance["unreadable_lines"]), (0, 0, 0))
        self.assertLess(abs(binance["lag_ms"]["median"]), 1000)
        self.assertEqual(head(profile), found["market_commit"])
        market = versions.open_market(profile, "reader")
        low, high = series._day_ms(SAMPLE_DAY), series._day_ms(SAMPLE_DAY + timedelta(days=1))
        added = [entry for entry in market.version["files"] if entry["table"] not in ("instrument", "bar", "universe_month")]
        self.assertEqual([(entry["table"], entry["symbol"], entry["start_ms"], entry["end_ms"]) for entry in added],
                         [(table, None, low, high) for table in (*liquidations.TABLES.values(), liquidations.WATCH)])
        self.assertTrue(all(entry["table"] in versions.UPLOADED for entry in added))  # published to the public copy
        stored = read(profile, "binance_force_order")
        row, = stored.filter(stored.column("symbol").to_numpy(zero_copy_only=False) == "ETHUSD_PERP").to_pylist()
        self.assertEqual(row, {"symbol": "ETHUSD_PERP", "trade_time": 1793611933084, "side": "SELL",
                               "price": Decimal("2274.93"), "avg_price": Decimal("2285.98"), "orig_qty": Decimal(461),
                               "filled_qty": Decimal(461), "last_filled_qty": Decimal(46), "status": "FILLED",
                               "event_time": 1793611934091, "received_at": 1793611934020, "n": 1})
        watch = read(profile, liquidations.WATCH).to_pylist()
        self.assertEqual([(item["symbol"], item["start_time"], item["end_time"]) for item in watch
                          if item["venue"] == "binance"], [("", 1793611853650, 1793612348643)])
        self.assertEqual(len({item["symbol"] for item in watch if item["venue"] == "bybit"}), 20)
        receipt, = versions.receipts(market, market.head, liquidations.IMPORT)
        self.assertEqual({key: receipt[key] for key in ("day", "readings")},
                         {"day": "2026-11-02", "readings": json.loads(json.dumps(found["readings"]))})
        watched = coverage.liquidation_watch(market, market.head)
        facts = coverage.liquidation_facts(market, market.head, "1000BONKUSDT", 1793611800000, 1793612400000, watched)
        self.assertEqual(facts["binance"]["uncovered_intervals_ms"],
                         [[1793611800000, 1793611853650], [1793612348643, 1793612400000]])
        self.assertEqual([(item["symbol"], item["uncovered_intervals_ms"]) for item in facts["bybit"]],
                         [("1000BONKUSDT", [[1793611800000, 1793611853882], [1793612068675, 1793612400000]])])
        self.assertEqual(review.review(market, []), [])
        self.assertIsNone(self.imported(profile, now))  # a day is imported once
        self.assertEqual(head(profile), found["market_commit"])

    def test_repeats_on_one_connection_count_and_on_two_connections_merge_across_midnight(self):
        profile = self.market()
        a, b = MIDNIGHT - 30_000, MIDNIGHT - 20_000
        late = MIDNIGHT - 50  # received by binance-2 before midnight and by binance-3 after it
        twice = force_order("BTCUSDT", a, S="BUY")
        shared = force_order("ETHUSDT", late - 900, event=late - 40)
        self.spool.write("binance", (a - 60_000, line(a - 60_000, "binance-2", "open", liquidations.URLS["binance"])),
                         (b - 30_000, line(b - 30_000, "binance-3", "open", liquidations.URLS["binance"])),
                         *beats("binance-2", a - 59_000, MIDNIGHT + 30_000), *beats("binance-3", b - 29_000, MIDNIGHT + 60_000),
                         (a + 100, line(a + 100, "binance-2", "frame", twice)),
                         (a + 200, line(a + 200, "binance-2", "frame", twice)),
                         (late, line(late, "binance-2", "frame", shared)),
                         (MIDNIGHT + 30, line(MIDNIGHT + 30, "binance-3", "frame", shared)),
                         (MIDNIGHT + 5_000, line(MIDNIGHT + 5_000, "binance-3", "frame",
                                                 force_order("SOLUSDT", MIDNIGHT + 4_000))))
        first = self.imported(profile, NOW + timedelta(days=1))
        assert first is not None
        self.assertEqual({key: first["readings"]["binance"][key] for key in ("rows", "liquidations", "repeated_rows")},
                         {"rows": 2, "liquidations": 3, "repeated_rows": 1})
        self.assertEqual(first["readings"]["bybit"]["rows"], 0)  # no spool of Bybit: no rows, no watch
        second = self.imported(profile, NOW + timedelta(days=1))
        assert second is not None
        self.assertEqual((second["day"], second["readings"]["binance"]["rows"],
                          second["readings"]["binance"]["merged_rows"]), ("2025-03-11", 1, 0))
        self.assertIsNone(self.imported(profile, NOW + timedelta(days=1)))
        stored = read(profile, "binance_force_order")
        self.assertEqual(sorted(zip(*(stored.column(name).to_pylist() for name in ("symbol", "n", "received_at")), strict=True)),
                         [("BTCUSDT", 2, a + 100), ("ETHUSDT", 1, late), ("SOLUSDT", 1, MIDNIGHT + 5_000)])
        watch = read(profile, liquidations.WATCH)
        self.assertEqual(list(zip(watch.column("start_time").to_pylist(), watch.column("end_time").to_pylist(), strict=True)),
                         [(a - 60_000, MIDNIGHT), (MIDNIGHT, MIDNIGHT + 56_000)])
        market = versions.open_market(profile, "reader")
        self.assertEqual(sorted(entry["table"] for entry in market.version["files"] if entry["start_ms"] >= LOW),
                         ["binance_force_order", "binance_force_order", "liquidation_watch", "liquidation_watch"])
        self.assertEqual(review.review(market, []), [])

    def test_a_row_of_the_day_before_seen_again_on_its_connection_refuses_the_day(self):
        profile = self.market()
        late = MIDNIGHT - 50
        again = force_order("ETHUSDT", late - 900, event=late - 40)
        self.spool.write("binance", (late - 60_000, line(late - 60_000, "binance-2", "open", liquidations.URLS["binance"])),
                         *beats("binance-2", late - 59_000, MIDNIGHT + 30_000),
                         (late, line(late, "binance-2", "frame", again)),
                         (MIDNIGHT + 30, line(MIDNIGHT + 30, "binance-2", "frame", again)))
        # The first day holds the row once; on the second day its connection has seen it twice.
        self.assertEqual(self.imported(profile, NOW + timedelta(days=1))["readings"]["binance"]["rows"], 1)
        held = head(profile)
        with self.assertRaises(sources.MarketError) as caught:
            self.imported(profile, NOW + timedelta(days=1))
        self.assertEqual(caught.exception.code, "STORED_ROW_DIFFERS")
        self.assertEqual(head(profile), held)

    def test_two_connections_that_disagree_refuse_the_day(self):
        profile = self.market()
        before = head(profile)
        at = LOW + 3_600_000
        self.spool.write("binance", (at, line(at, "binance-1", "frame", force_order("BTCUSDT", at - 900, event=at))),
                         (at + 5, line(at + 5, "binance-2", "frame", force_order("BTCUSDT", at - 900, event=at + 7))))
        with self.assertRaises(sources.MarketError) as caught:
            self.imported(profile)
        self.assertEqual(caught.exception.code, "STREAMS_DISAGREE")
        self.assertEqual(head(profile), before)

    def test_a_market_written_before_the_liquidation_tables_takes_them_and_an_open_day_waits(self):
        profile = self.market()
        self.spool.write("binance", (LOW, line(LOW, "binance-1", "pong")))
        self.assertIsNone(self.imported(profile, datetime(2025, 3, 11, 0, 4, tzinfo=UTC)))  # 5 minutes of grace
        forged(profile, schema={"version": 4})  # an old version file's table version, which is not read
        found = self.imported(profile)
        assert found is not None
        self.assertEqual(found["liquidation_rows"], 0)  # a day without rows or watch is its receipt alone
        market = versions.open_market(profile, "reader")
        self.assertEqual([entry["table"] for entry in market.version["files"] if entry["start_ms"] >= LOW], [])

    def test_review_finds_a_liquidation_key_in_two_files(self):
        profile = self.market()
        at = LOW + 1000
        self.spool.write("binance", (at, line(at, "binance-1", "frame", force_order("BTCUSDT", at - 900))))
        self.imported(profile)
        row = read(profile, "binance_force_order").to_pydict()
        forged(profile, table="binance_force_order", start_ms=MIDNIGHT, end_ms=MIDNIGHT + store.DAY,
               rows={**row, "received_at": [MIDNIGHT + 1]})
        findings = review.review(versions.open_market(profile, "reader"), [])
        self.assertEqual([item["check"] for item in findings], ["CHECK_FAILED"])
        self.assertIn("binance_force_order holds 1 keys in more than one row", findings[0]["detail"])

    def test_a_round_imports_each_closed_day_publishes_and_tells_the_recorder_what_it_may_retire(self):
        profile = self.market()
        for day in (DAY, DAY + timedelta(days=1)):
            at = series._day_ms(day) + 1000
            self.spool.write("binance", (at, line(at, "binance-1", "frame", force_order("BTCUSDT", at - 900))))
        now = NOW + timedelta(days=1)

        def round_(memory, publish=lambda: {"head": 1}):
            with patch.object(follow, "_bars"), patch.object(follow, "_monthly"), patch.object(follow, "_holes"):
                return follow.run_round(profile, [], Path("."), memory, publish, now, lambda _: None,
                                        self.spool.root)["kinds"]["liquidations"]["spool"]

        entry = round_(follow.Memory())
        self.assertEqual((entry["state"], entry["rows"], len(entry["commits"]), entry["through"],
                          entry["published_through"]), ("caught_up", 2, 2, "2025-03-12", "2025-03-12"))
        # A market that does not publish (publish answers None) leaves nothing for the recorder to retire.
        self.assertNotIn("published_through", round_(follow.Memory(), lambda: None))
        at = series._day_ms(DAY + timedelta(days=2)) + 1000
        self.spool.write("binance", (at, line(at, "binance-1", "frame", force_order("BTCUSDT", at - 900, st=2))))
        memory, now = follow.Memory(), now + timedelta(days=1)

        def refused():
            raise sources.MarketError("busy", code="PUBLISH_FAILED")
        entry = round_(memory, refused)
        self.assertEqual((entry["state"], entry["refusal"]["code"], entry["through"]), ("stopped", "SOURCE_SHAPE",
                                                                                         "2025-03-12"))
        self.assertNotIn("published_through", entry)


if __name__ == "__main__":
    unittest.main()
