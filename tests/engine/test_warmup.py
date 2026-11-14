"""The WARMUP declaration and the replay's warm-up (docs/plans/r1-runtime-contract-20261110.zh.md, 3 and 5): each
declared history arrives once, adjacent, before on_start; no order goes out before it; the first aggregated bar is
complete; an instance waits for its history or, without one, the replay is refused. A declared funding history is the
last settlements before T, the same native updates in replay (the export) and in Paper and Live (Binance's REST)."""

import hashlib
import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path

import numpy as np
from nautilus_trader.model import Bar, BarType, NautilusDataType, Price, Quantity
from nautilus_trader.persistence import ParquetDataCatalog

from decimal import Decimal

from engine import history, klines, run, warmup
from market import export
from engine.config import Refusal, parse_window, utc_text
from engine.load import load_strategy, read_market
from tests.engine.test_stream import DAY, DAYS, END, MIN, START, contract
from tests.helpers import refused

NS = 10**6  # per millisecond
WARMED = '''
from decimal import Decimal
from nautilus_trader.model import BarType, OrderSide
from nautilus_trader.trading import Strategy


class Warmed(Strategy):
    """Records each history and bar it receives and when its on_start runs; subscribes to every declared period."""

    WARMUP = DECLARED

    def __init__(self, instrument_id, bar_type, **kw):
        super().__init__()
        self.iid, self.seen = instrument_id, []

    def on_historical_bars(self, bars):
        self.seen.append(("history", str(bars[0].bar_type), [bar.ts_event for bar in bars], self.clock.timestamp_ns()))
        if ORDER_IN_HISTORY:
            instrument = self.cache.instrument(self.iid)
            self.submit_order(self.order_factory.limit(self.iid, OrderSide.BUY, instrument.make_qty(Decimal("0.001")),
                                                       bars[-1].close))

    def on_historical_funding_rates(self, updates):
        self.seen.append(("funding history", [update.to_dict() for update in updates], self.clock.timestamp_ns()))

    def on_funding_rate(self, update):
        self.seen.append(("funding", update.to_dict()))

    def on_start(self):
        self.seen.append(("start", self.clock.timestamp_ns()))
        if "FUNDING" in self.WARMUP:
            self.subscribe_funding_rates(self.iid)
        for period in (period for period in self.WARMUP if period != "FUNDING"):
            self.subscribe_bars(BarType.from_str(f"{self.iid}-1-MINUTE-LAST-EXTERNAL" if period == "1-MINUTE" else
                                                 f"{self.iid}-{period}-LAST-INTERNAL@1-MINUTE-EXTERNAL"))
        ON_START

    def on_bar(self, bar):
        self.seen.append(("bar", str(bar.bar_type), bar.ts_event, str(bar.open), str(bar.high), str(bar.low),
                          str(bar.close), str(bar.volume)))

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []
'''


def source(root: Path, declared: dict, order_in_history=False, on_start="pass"):
    path = root / f"warmed_{hashlib.sha256(repr((declared, order_in_history, on_start)).encode()).hexdigest()[:8]}.py"
    path.write_text(WARMED.replace("DECLARED", repr(declared)).replace("ORDER_IN_HISTORY", str(order_in_history))
                    .replace("ON_START", on_start))
    return load_strategy(path, "Warmed", hashlib.sha256(path.read_bytes()).hexdigest())


def minutes(row) -> list[Bar]:
    return sorted(ParquetDataCatalog(str(row["catalog_path"])).query_bars(
        [f"{row['instrument_id']}-1-MINUTE-LAST-EXTERNAL"]), key=lambda bar: bar.ts_event)


class DeclarationTests(unittest.TestCase):
    def test_a_declaration_maps_kline_periods_to_whole_numbers_of_bars(self):
        class Valid:
            WARMUP = {"1-DAY": 3, "15-MINUTE": 0, "1-MINUTE": 60}

        class Funded:
            WARMUP = {"FUNDING": 9, "1-DAY": 3}

        self.assertEqual(warmup.declared(Valid), (("1-MINUTE", 60), ("15-MINUTE", 0), ("1-DAY", 3)))
        self.assertEqual(warmup.declared(object), ())
        self.assertEqual((warmup.declared(Funded), warmup.declared_funding(Funded), warmup.declared_funding(Valid)),
                         ((("1-DAY", 3),), 9, 0))
        for value in ({"2-DAY": 1}, {"1-WEEK": 1}, {"15-MINUTE": -1}, {"15-MINUTE": 1.0}, {"15-MINUTE": True},
                      {"1-DAY": "3"}, ["1-DAY"], True, {"FUNDING": -1}, {"FUNDING": "9"}, {"funding": 9}):
            with self.subTest(value=value):
                self.assertEqual(refused(warmup.declared, type("Invalid", (), {"WARMUP": value}),
                                         error=Refusal).code, "WARMUP_INVALID")

    def test_a_derived_bar_follows_the_daily_rule_and_only_complete_buckets(self):
        kind = BarType.from_str("AAAUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL")

        def minute(index, low, high, close, volume):
            stamp = index * 60_000 * NS + 60_000 * NS - NS
            return Bar(kind, Price.from_str(f"{close - 1}.00"), Price.from_str(f"{high}.00"),
                       Price.from_str(f"{low}.00"), Price.from_str(f"{close}.00"), Quantity.from_str(volume),
                       stamp, stamp)

        bars = [minute(0, 1, 50, 10, "0.000"), minute(1, 8, 12, 11, "2.000"), minute(2, 9, 13, 12, "1.000"),
                minute(3, 2, 99, 20, "0.000"), minute(4, 11, 14, 13, "1.000")]
        found = warmup.derive(bars, "3-MINUTE", "AAAUSDT-PERP.BINANCE", 0)
        # The second bucket (minutes 3 to 5) has no later minute, so it is not known to be complete.
        self.assertEqual(len(found), 1)
        bar = found[0]
        self.assertEqual(str(bar.bar_type), "AAAUSDT-PERP.BINANCE-3-MINUTE-LAST-EXTERNAL")
        self.assertEqual((str(bar.open), str(bar.high), str(bar.low), str(bar.close), str(bar.volume)),
                         ("10.00", "13.00", "8.00", "12.00", "3.000"))  # traded minutes 1 and 2 set open, high, low
        self.assertEqual(bar.ts_event, 3 * 60_000 * NS - NS)
        self.assertEqual(warmup.derive(bars, "3-MINUTE", "AAAUSDT-PERP.BINANCE", 60_000 * NS), [])

    def test_a_start_waits_for_adjacent_histories(self):
        quarter = 15 * 60_000 * NS
        stamps = {"15-MINUTE": [index * quarter - NS for index in (1, 2, 3, 5, 6)]}
        self.assertTrue(warmup.adjacent(stamps["15-MINUTE"], 3 * quarter + 7 * 60_000 * NS, "15-MINUTE", 3))
        self.assertFalse(warmup.adjacent(stamps["15-MINUTE"], 4 * quarter, "15-MINUTE", 4))
        self.assertFalse(warmup.adjacent(stamps["15-MINUTE"], 5 * quarter, "15-MINUTE", 2))  # bucket 4 is missing
        self.assertEqual(warmup.first_start(stamps, (("15-MINUTE", 2),), quarter, 10 * quarter), 2 * quarter)
        self.assertEqual(warmup.first_start(stamps, (("15-MINUTE", 2),), 4 * quarter, 10 * quarter), 6 * quarter)
        self.assertIsNone(warmup.first_start(stamps, (("15-MINUTE", 3),), 4 * quarter, 10 * quarter))
        self.assertEqual(warmup.first_start(stamps, (("15-MINUTE", 0),), quarter + 1, 10 * quarter),
                         quarter + 60_000 * NS)


class FundingTests(unittest.TestCase):
    """Settlement times carry Binance's millisecond jitter (2025-10-02T08:00:00.013Z in the archive and REST)."""
    ROWS = [(1_759_363_200_000, "0.00007784"), (1_759_392_000_013, "0.00010000"), (1_759_420_800_000, "-0.00002100"),
            (1_759_449_600_000, "0E-10")]

    def test_the_history_is_the_updates_the_replay_streams(self):
        with tempfile.TemporaryDirectory() as root:
            export.write_funding(Path(root), IID, [(at, Decimal(rate)) for at, rate in self.ROWS])
            streamed = ParquetDataCatalog(root).query(NautilusDataType.FundingRateUpdate, identifiers=[IID])
        built = [warmup.funding_update(IID, at * NS, rate) for at, rate in self.ROWS]
        self.assertEqual([update.to_dict() for update in built], [update.to_dict() for update in streamed])
        self.assertEqual([str(update.rate) for update in built], ["0.00007784", "0.0001", "-0.000021", "0"])

    def test_the_history_is_the_last_settlements_before_t_and_a_start_waits_for_them(self):
        updates = [warmup.funding_update(IID, at * NS, rate) for at, rate in self.ROWS]
        at = 1_759_392_000_000 * NS  # the hour of the jittered settlement, which is after it
        self.assertEqual([update.ts_event for update in warmup.funding_history(updates, at, 2)],
                         [1_759_363_200_000 * NS])
        self.assertEqual(warmup.funding_history(updates, at + 60_000 * NS, 2), updates[:2])
        self.assertEqual(warmup.funding_history(updates, 1_759_363_200_000 * NS, 2), updates[:1])  # known at T
        stamps = [update.ts_event for update in updates]
        self.assertEqual(warmup.funding_start(stamps, 2), 1_759_392_060_000 * NS)
        self.assertEqual(warmup.funding_start(stamps, 1), 1_759_363_200_000 * NS)
        self.assertEqual(warmup.funding_start(stamps, 0), 0)
        self.assertIsNone(warmup.funding_start(stamps, 5))

    def test_binance_answers_the_last_settlements_before_t_page_by_page(self):
        hour = 3_600_000
        times = [1_759_276_800_000 + index * 8 * hour + (13 if index % 5 == 0 else 0) for index in range(2500)]
        asked = []

        def get(url, proxy_url):
            asked.append(url)
            query = dict(urllib.parse.parse_qsl(url.split("?")[1], strict_parsing=True))
            held = [at for at in times if at <= int(query["endTime"])][-int(query["limit"]):]
            return [{"symbol": "AAAUSDT", "fundingTime": at, "fundingRate": "0.00010000", "markPrice": "1"}
                    for at in held]
        hour = (times[2400] - 13) * NS  # its settlement is 13 ms later: known only at the next minute
        found = klines.settlements(IID, hour, 1500, None, get)
        self.assertEqual([update.ts_event for update in found], [stamp * NS for stamp in times[900:2400]])
        self.assertIn("endTime=" + str(hour // NS), asked[0])
        at = hour + 60_000 * NS
        found = klines.settlements(IID, at, 1500, None, get)
        self.assertEqual([update.ts_event for update in found], [stamp * NS for stamp in times[901:2401]])
        self.assertEqual(len(asked), 4)
        self.assertEqual(len(klines.settlements(IID, times[3] * NS, 10, None, get)), 4)
        with tempfile.TemporaryDirectory() as root:
            answers, settled = history.fetch(IID, at, (), (2, 3), Path(root), None, get, funding=9)
            self.assertEqual((answers, settled), ([], found[-9:]))
            self.assertEqual(refused(history.fetch, IID, times[3] * NS, (), (2, 3), Path(root), None, get,
                                     funding=9, error=Refusal).code, "WARMUP_INSUFFICIENT")


    def test_a_start_at_a_settlement_hour_waits_until_binance_publishes_it(self):
        hour = 3_600_000

        def binance_funding(times):
            def get(url, proxy_url):
                query = dict(urllib.parse.parse_qsl(url.split("?")[1], strict_parsing=True))
                held = [at for at in times if at <= int(query["endTime"])][-int(query["limit"]):]
                return [{"fundingTime": at, "fundingRate": "0.0001"} for at in held]
            return get
        base = 1_759_276_800_000
        published = [base + index * 8 * hour for index in range(4)]
        at = (base + 4 * 8 * hour) * NS  # the fifth settlement's hour
        with self.assertRaises(history.FundingPending):
            history.settlements(IID, at, 3, None, binance_funding(published))
        found = history.settlements(IID, at, 3, None, binance_funding([*published, base + 32 * hour]))
        self.assertEqual([update.ts_event for update in found], [stamp * NS for stamp in [*published, base + 32 * hour][-3:]])
        # Stamped 13 ms after its hour, it is published but not yet known at T.
        found = history.settlements(IID, at, 3, None, binance_funding([*published, base + 32 * hour + 13]))
        self.assertEqual([update.ts_event for update in found], [stamp * NS for stamp in published[-3:]])
        self.assertEqual(len(history.settlements(IID, at - 60_000 * NS, 3, None, binance_funding(published))), 3)


class ReplayWarmupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        contract(self.root / "market", "AAAUSDT", np.arange(DAYS * 1440), [], seed=1)
        self.rows = read_market(self.root / "market", ["AAAUSDT"], "c" * 32, START * NS, END * NS)
        self.universe = {"AAAUSDT": ((0, 10**20),)}

    def tearDown(self):
        self.temp.cleanup()

    def replay(self, loaded, trade_start_ms):
        window = parse_window(utc_text(START * NS), utc_text(trade_start_ms * NS), utc_text(END * NS))
        output = self.root / f"out-{trade_start_ms}-{loaded.content_hash[:8]}"
        output.mkdir()
        finished, strategies, limitations = run.replay(self.rows, window, loaded, self.universe, output)
        finished.engine.dispose()
        return strategies["AAA"].seen, limitations

    def test_each_history_arrives_once_adjacent_before_on_start_and_the_first_aggregated_bars_are_whole(self):
        loaded = source(self.root, {"1-MINUTE": 30, "15-MINUTE": 8, "1-HOUR": 0})
        start = START + 3 * 3_600_000 + 7 * MIN  # inside a quarter and an hour: both aggregations need warming
        seen, limitations = self.replay(loaded, start)
        at = start * NS
        histories = [event for event in seen if event[0] == "history"]
        self.assertEqual([event[1].split("-", 2)[2] for event in histories],
                         ["1-MINUTE-LAST-EXTERNAL", "15-MINUTE-LAST-EXTERNAL"])
        for event, (period, count) in zip(histories, (("1-MINUTE", 30), ("15-MINUTE", 8)), strict=True):
            first, last = warmup.history_range(at, period, count)
            self.assertEqual(event[2], list(range(first, last + 1, warmup.period_ns(period))))
            self.assertEqual(event[3], at)
        self.assertEqual(seen.index(next(event for event in seen if event[0] == "start")), 2)
        self.assertEqual(seen[2], ("start", at))
        self.assertFalse(any(event[0] == "bar" and event[2] < at for event in seen))
        # The first aggregated bars after T cover their whole buckets, minutes before T included; a native
        # aggregation is stamped at its bucket's end, the history 1 ms before.
        source_minutes = minutes(self.rows[0])
        for period in ("15-MINUTE", "1-HOUR"):
            expected = next(bar for bar in warmup.derive(source_minutes, period, self.rows[0]["instrument_id"], 0)
                            if bar.ts_event > at)
            first = next(event for event in seen if event[0] == "bar" and f"-{period}-" in event[1])
            self.assertEqual(first[2:], (expected.ts_event + NS, str(expected.open), str(expected.high), str(expected.low),
                                         str(expected.close), str(expected.volume)))
        self.assertFalse(any("warm-up first holds" in item for item in limitations))

    def test_an_instance_waits_for_its_history_and_without_one_the_replay_is_refused(self):
        # The export's daily bars: the first day is complete, the second is not.
        catalog = ParquetDataCatalog(str(self.rows[0]["catalog_path"]))
        catalog.write_bars(warmup.derive(minutes(self.rows[0]), "1-DAY", self.rows[0]["instrument_id"], 0))
        seen, limitations = self.replay(source(self.root, {"1-DAY": 1}), START + 3_600_000)
        self.assertEqual(seen[0][2], [(START + DAY) * NS - NS])
        self.assertEqual(seen[1], ("start", (START + DAY) * NS))
        self.assertTrue(any("warm-up first holds at 2026-01-02" in item for item in limitations), limitations)
        # Derived histories start at the window's start: eight quarters first hold two hours in.
        seen, _ = self.replay(source(self.root, {"15-MINUTE": 8}), START)
        self.assertEqual(next(event for event in seen if event[0] == "start"), ("start", (START + 2 * 3_600_000) * NS))
        self.assertEqual(refused(self.replay, source(self.root, {"1-DAY": 2}), START + 3_600_000,
                                 error=Refusal).code, "WARMUP_INSUFFICIENT")

    def test_the_funding_history_arrives_before_on_start_and_the_start_waits_for_it(self):
        settlements = [START + hour * 3_600_000 for hour in range(0, 48, 8)]
        contract(self.root / "funded", "BBBUSDT", np.arange(DAYS * 1440), settlements, seed=2)
        self.rows = read_market(self.root / "funded", ["BBBUSDT"], "c" * 32, START * NS, END * NS)
        loaded = source(self.root, {"FUNDING": 2, "15-MINUTE": 0})

        def replayed(trade_start_ms):
            window = parse_window(utc_text(START * NS), utc_text(trade_start_ms * NS), utc_text(END * NS))
            output = self.root / f"funded-{trade_start_ms}"
            output.mkdir()
            finished, strategies, limitations = run.replay(self.rows, window, loaded, {"BBBUSDT": ((0, 10**20),)},
                                                           output)
            finished.engine.dispose()
            return strategies["BBB"].seen, limitations
        streamed = [update.to_dict() for update in run._small_events(self.rows[0], "FundingRateUpdate")]
        at = (START + 16 * 3_600_000) * NS  # the third settlement is at T: known then, so in the history
        seen, _ = replayed(at // NS)
        self.assertEqual(seen[:2], [("funding history", streamed[1:3], at), ("start", at)])
        self.assertEqual([event[1] for event in seen if event[0] == "funding"], streamed[3:])
        seen, _ = replayed(at // NS + MIN)
        self.assertEqual(seen[:2], [("funding history", streamed[1:3], at + MIN * NS), ("start", at + MIN * NS)])
        self.assertEqual([event[1] for event in seen if event[0] == "funding"], streamed[3:])
        # Two settlements are first known at the second (8 hours in).
        seen, limitations = replayed(START)
        self.assertEqual(seen[:2], [("funding history", streamed[:2], (START + 8 * 3_600_000) * NS),
                                    ("start", (START + 8 * 3_600_000) * NS)])
        self.assertTrue(any("warm-up first holds at 2026-01-01T08:00" in item for item in limitations), limitations)
        self.assertEqual(json.loads(json.dumps(streamed))[0]["rate"], "0.0001")

    def test_no_order_before_on_start_no_request_and_no_undeclared_aggregation(self):
        cases = (
            (source(self.root, {"15-MINUTE": 2}, order_in_history=True), "ORDER_RULE", "warm-up has ended"),
            (source(self.root, {"15-MINUTE": 0}, on_start=(
                "self.request_bars(BarType.from_str(f'{self.iid}-1-MINUTE-LAST-EXTERNAL'))")),
             "SUBSCRIPTION_OUTSIDE_CONTRACT", "declare history in WARMUP"),
            (source(self.root, {"15-MINUTE": 0}, on_start=(
                "self.subscribe_bars(BarType.from_str(f'{self.iid}-5-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL'))")),
             "SUBSCRIPTION_OUTSIDE_CONTRACT", "a period WARMUP declares"),
        )
        for loaded, code, text in cases:
            with self.subTest(code=code, text=text):
                with self.assertRaises(Refusal) as caught:
                    self.replay(loaded, START + 3_600_000)
                self.assertEqual(caught.exception.code, code)
                self.assertIn(text, str(caught.exception))


IID = "AAAUSDT-PERP.BINANCE"


def binance(gaps=()):
    """A stand-in for fapi/v1/klines: every kline in the asked window, `gaps` (open times in ms) left out, at most
    klines.LIMIT a page; the URLs asked are kept."""
    asked = []

    def get(url, proxy_url):
        asked.append(url)
        query = dict(urllib.parse.parse_qsl(url.split("?")[1], strict_parsing=True))
        step = warmup.period_ns(next(period for period, name in klines.INTERVALS.items()
                                     if name == query["interval"])) // 1_000_000
        opens = [stamp for stamp in range(int(query["startTime"]), int(query["endTime"]) + 1, step)
                 if stamp not in gaps][:klines.LIMIT]
        return [[stamp, "100.123", "101.2", "99.3", "100.4", "12.3456", stamp + step - 1] for stamp in opens]
    return get, asked


class KlineTests(unittest.TestCase):
    def test_klines_become_bars_stamped_at_their_close_page_by_page(self):
        get, asked = binance()
        start = 1_767_225_600_000 * NS  # 2026-01-01
        found = klines.bars(IID, "1-MINUTE", start, start + 2000 * 60_000 * NS - NS, (2, 3), None, get)
        self.assertEqual(len(found), 2000)
        self.assertEqual(len(asked), 2)
        self.assertEqual([bar.ts_event for bar in found[:2]], [start + 60_000 * NS - NS, start + 120_000 * NS - NS])
        self.assertEqual(found[-1].ts_event, start + 2000 * 60_000 * NS - NS)
        self.assertEqual((str(found[0].bar_type), str(found[0].open), str(found[0].volume)),
                         (f"{IID}-1-MINUTE-LAST-EXTERNAL", "100.12", "12.346"))

    def test_a_symbol_of_any_script_is_percent_encoded_in_the_url(self):
        get, asked = binance()
        start = 1_767_225_600_000 * NS
        found = klines.bars("币安人生USDT-PERP.BINANCE", "1-MINUTE", start, start + 2 * 60_000 * NS - NS, (2, 3), None,
                            get)
        self.assertEqual(len(found), 2)
        self.assertTrue(asked[0].isascii())
        self.assertIn("symbol=%E5%B8%81%E5%AE%89%E4%BA%BA%E7%94%9FUSDT&", asked[0])

    def test_t_is_a_whole_minute_at_least_half_a_minute_ahead(self):
        minute = 60_000 * NS
        self.assertEqual(history.start_at(10 * minute + 29_000 * NS), 11 * minute)
        self.assertEqual(history.start_at(10 * minute + 31_000 * NS), 12 * minute)
        self.assertEqual(history.start_at(10 * minute), 11 * minute)


class FetchTests(unittest.TestCase):
    DECLARED = (("1-MINUTE", 3), ("15-MINUTE", 2), ("1-DAY", 0))

    def test_the_catalog_holds_every_request_once_and_each_request_gets_its_bars(self):
        at = 1_767_225_600_000 * NS + 7 * 60_000 * NS  # seven minutes into a quarter and a day
        with tempfile.TemporaryDirectory() as root:
            get, _ = binance()
            answers, settled = history.fetch(IID, at, self.DECLARED, (2, 3), Path(root), None, get)
            planned = history.requests(at, self.DECLARED)
            self.assertEqual([(role, period) for role, period, _, _ in planned],
                             [("warm", "15-MINUTE"), ("warm", "1-DAY"), ("history", "1-MINUTE"),
                              ("history", "15-MINUTE")])
            for (role, period, first, last), found in zip(planned, answers, strict=True):
                step = warmup.period_ns("1-MINUTE" if role == "warm" else period)
                self.assertEqual([bar.ts_event for bar in found], list(range(first + step - NS if role == "warm"
                                                                             else first, last + 1, step)))
            catalog = ParquetDataCatalog(root)
            self.assertEqual(len(catalog.query_bars([f"{IID}-1-MINUTE-LAST-EXTERNAL"])), 7)
            self.assertEqual(len(catalog.query_bars([f"{IID}-15-MINUTE-LAST-EXTERNAL"])), 2)

    def test_a_history_binance_lacks_is_refused(self):
        at = 1_767_225_600_000 * NS + 7 * 60_000 * NS
        get, _ = binance(gaps={at // NS - 2 * 60_000})  # the second of the three minutes
        with tempfile.TemporaryDirectory() as root, self.assertRaises(Refusal) as caught:
            history.fetch(IID, at, self.DECLARED, (2, 3), Path(root), None, get)
        self.assertEqual(caught.exception.code, "WARMUP_INSUFFICIENT")
