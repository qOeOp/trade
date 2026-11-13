"""The Live evidence pack records the bars the source receives, the minute MARKs and funding settlements a replay
uses, and the native reports in the replay's own form; a failed write never changes the run. Live warms its source
at T from Binance's klines as replay and Paper do (engine.history), offline here: a BacktestEngine drives the Live
wrapper and synthetic klines stand in for Binance's."""

import gc
import hashlib
import json
from decimal import Decimal
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import (
    Bar, FundingRateUpdate, InstrumentId, MarkPriceUpdate, Price, Quantity, TraderId, Venue,
)
from nautilus_trader.persistence import DataCatalogConfig

from engine import history, live, live_lifecycle, live_source as live_source_runtime, warmup
from engine.config import Refusal
from engine.live_evidence import EVIDENCE, INSTRUMENTS, MARKET, Evidence
from engine.report import ORDER_EVENTS, write_order_events, write_reports
from engine.run import ACCOUNT_CONTRACT, add_venue
from tests.engine import test_fill_model as fixture
from tests.engine.test_live import SOURCE
from tests.engine.test_live_venue import MARKET_DAY

MINUTE_NS = 60_000_000_000
HOUR_NS = 3600 * 10**9


def rows(output: Path) -> list[dict]:
    path = output / EVIDENCE / MARKET
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def bar(ts: int, close="100.00") -> Bar:
    prices = [Price.from_str(value) for value in ("100.00", "101.00", "99.00", close)]
    return Bar(fixture.BAR_TYPE, *prices, Quantity.from_str("40.000"), ts, ts)


class Twice(fixture.Orders):
    """Two bracket cycles, each its own HEDGING position."""

    def on_bar(self, bar):
        self.count += 1
        if self.count in (2, 6):
            self.count, kept = 1, self.count
            super().on_bar(bar)
            self.count = kept


class LiveEvidenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.output = Path(temp.name)

    def session(self, extra=""):
        path, universe = self.output / "source.py", self.output / "universe.json"
        text = SOURCE + '''    def on_start(self):
        from nautilus_trader.model import BarType
        self.observed.append("start")
        self.subscribe_bars(BarType.from_str("AAAUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
''' + extra
        path.write_text(text)
        universe.write_text('{"membership":{"AAAUSDT":[[0,9999999999999999999]]}}')
        manifest = dict(run_id="evidence", symbols=["AAAUSDT"], strategy_file=str(path), account_id="BINANCE-001",
                        universe_file=str(universe), universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                        source=dict(entry_class="Source", source_sha256=hashlib.sha256(text.encode()).hexdigest()),
                        config=dict(duration_seconds=3600, drawdown_brake="0.15"), market=dict(market_day=MARKET_DAY))
        session = live.Session(manifest, self.output, "run", account_verified=True)
        session.node = Mock()
        return session, live.source_for_run(manifest)

    def test_the_bars_the_source_receives_are_recorded_as_paper_journals_them(self):
        live.strategy_runtime.clear_failures()
        session, loaded = self.session()
        session.sources = live_source_runtime.live_source(loaded, session)
        [source] = session.sources.values()
        engine = BacktestEngine(BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
        try:
            add_venue(engine, fixture.fees())
            engine.add_instrument(fixture.INSTRUMENT)
            engine.add_strategy(source)
            # The source starts at T and hears the minutes after it (engine.history).
            first = history.STATES[str(source.strategy_id)]["at"] + MINUTE_NS - 1_000_000
            engine.add_data([bar(first), bar(first + MINUTE_NS, close="100.50")])
            engine.run()
            earlier = bar(first - MINUTE_NS, close="99.50")
            source._source_on_historical_bars([earlier])
            self.assertEqual(source.observed, ["start", "bar", "bar"])
            recorded = rows(self.output)
            self.assertEqual([(row["kind"], row["ts_event"], row["close"]) for row in recorded],
                             [("bar", first, "100.00"), ("bar", first + MINUTE_NS, "100.50"),
                              ("historical_bar", first - MINUTE_NS, "99.50")])
            self.assertEqual({key: value for key, value in recorded[0].items() if key != "wall_ns"}, {
                "kind": "bar", "bar_type": str(fixture.BAR_TYPE), "instrument_id": str(fixture.INSTRUMENT_ID),
                "ts_event": first, "ts_init": first, "open": "100.00", "high": "101.00", "low": "99.00",
                "close": "100.00", "volume": "40.000"})
            # After a stop request the source hears no further bar, and none is recorded as received.
            (self.output / "STOP").write_text("")
            source.on_bar(bar(first + 2 * MINUTE_NS))
            self.assertEqual(len(rows(self.output)), 3)
            self.assertEqual(source.observed, ["start", "bar", "bar"])
        finally:
            engine.dispose()
            session.node, session.sources = None, {}
            source = engine = None
            gc.collect()
            live.strategy_runtime.clear_failures()

    def warm(self, klines, minutes):
        """Run the Live wrapper of a source declaring three minutes and two quarters of history through its T,
        Binance's klines replaced by `klines`, then feed live minute bars closing `minutes` after T."""
        live.strategy_runtime.clear_failures()
        session, loaded = self.session('''    WARMUP = {"1-MINUTE": 3, "15-MINUTE": 2}
    def on_historical_bars(self, bars):
        self.observed.append((str(bars[0].bar_type).split("-", 2)[2], [bar.ts_event for bar in bars]))
''')
        session.sources = live_source_runtime.live_source(loaded, session)
        [source] = session.sources.values()
        engine = BacktestEngine(BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.ERROR),
                                                     catalogs=[DataCatalogConfig(path=str(session.catalog()))]))
        state = history.STATES[str(source.strategy_id)]
        at = state["at"]

        def feed(data, until):
            engine.add_data(data, None, False, True)
            engine.run(None, until, None, True)
            engine.clear_data()

        try:
            add_venue(engine, fixture.fees())
            engine.add_instrument(fixture.INSTRUMENT)
            engine.add_actor(history.WarmupActor(history.WarmupActorConfig(live=True)))
            engine.add_strategy(source)
            with unittest.mock.patch.object(history.klines, "bars", klines):
                settled = at + history.SETTLE_NS  # the backtest clock fires timers up to its last data
                feed([MarkPriceUpdate(fixture.INSTRUMENT_ID, Price.from_str("100.00"), ts, ts) for ts in (at, settled)],
                     settled)
                if state["thread"]:
                    state["thread"].join(5)
            for second in range(1, 30):
                ts = at + history.SETTLE_NS + second * 200_000_000
                feed([MarkPriceUpdate(fixture.INSTRUMENT_ID, Price.from_str("100.00"), ts, ts)], ts)
            for offset in minutes:
                feed([bar(at + offset - 1_000_000)], at + offset - 1_000_000)
            events = [json.loads(line) for line in (self.output / "events.jsonl").read_text().splitlines()]
            return at, list(source.observed), session, events
        finally:
            engine.dispose()
            session.node, session.sources = None, {}
            source = engine = None
            gc.collect()
            live.strategy_runtime.clear_failures()

    def test_live_warms_its_source_at_t_from_binance_klines_before_on_start(self):
        def klines(instrument_id, period, first_open, end, precisions, proxy_url, get=None):
            step = warmup.period_ns(period)
            kind = warmup.bar_type(instrument_id, period)
            prices = [Price.from_str(value) for value in ("100.00", "101.00", "99.00", "100.00")]
            return [Bar(kind, *prices, Quantity.from_str("40.000"), opened + step - 1_000_000, opened + step - 1_000_000)
                    for opened in range(first_open, end - step + 2_000_000, step)]

        at, observed, session, events = self.warm(klines, (MINUTE_NS, 2 * MINUTE_NS))
        quarter = 15 * MINUTE_NS
        floor = at // quarter * quarter
        self.assertEqual(observed, [
            ("1-MINUTE-LAST-EXTERNAL", [at - 3 * MINUTE_NS + MINUTE_NS * index - 1_000_000 for index in (1, 2, 3)]),
            ("15-MINUTE-LAST-EXTERNAL", [floor - quarter - 1_000_000, floor - 1_000_000]),
            "start", "bar", "bar"])
        self.assertFalse(session.failed or session.stopping)
        warmed = next(event for event in events if event["event"] == "warmup")
        self.assertEqual((warmed["at_ns"], warmed["bars"]), (at, {"1-MINUTE": 3, "15-MINUTE": 2}))
        self.assertEqual([row["kind"] for row in rows(self.output)], ["historical_bar"] * 5 + ["bar"] * 2)

    def test_live_refuses_a_start_whose_history_or_first_minute_does_not_hold(self):
        def short(instrument_id, period, first_open, end, precisions, proxy_url, get=None):
            raise Refusal("WARMUP_INSUFFICIENT", "Binance holds fewer bars")

        def whole(instrument_id, period, first_open, end, precisions, proxy_url, get=None):
            step = warmup.period_ns(period)
            prices = [Price.from_str(value) for value in ("100.00", "101.00", "99.00", "100.00")]
            return [Bar(warmup.bar_type(instrument_id, period), *prices, Quantity.from_str("40.000"),
                        opened + step - 1_000_000, opened + step - 1_000_000)
                    for opened in range(first_open, end - step + 2_000_000, step)]

        for klines, minutes, code in ((short, (), "WARMUP_INSUFFICIENT"),
                                      (whole, (2 * MINUTE_NS,), "WARMUP_NOT_ADJACENT")):
            with self.subTest(code=code):
                _, observed, session, events = self.warm(klines, minutes)
                refused = [event for event in events if event["event"] == "warmup_refused"]
                self.assertEqual([event["code"] for event in refused], [code])
                self.assertTrue(session.failed and session.stopping)
                self.assertEqual("start" in observed, code == "WARMUP_NOT_ADJACENT")
                (self.output / "events.jsonl").unlink()
                (self.output / "evidence").exists() and __import__("shutil").rmtree(self.output / "evidence")

    def test_the_observer_records_each_minutes_first_mark_and_each_funding_settlement(self):
        session, _ = self.session()
        session.record_minute = Mock()
        position = SimpleNamespace(id="P-1", signed_qty=Decimal("0.002"))
        observer = SimpleNamespace(session=session, minute=None, minutes={}, last_marks={}, cadences={},
                                   cache=SimpleNamespace(positions_open=lambda instrument_id: [position]))
        iid, other = fixture.INSTRUMENT_ID, InstrumentId.from_str("ETHUSDT-PERP.BINANCE")
        for ts in (MINUTE_NS + 5, MINUTE_NS + 2_000_000_000, 2 * MINUTE_NS + 7):
            live_lifecycle.Observer.on_mark_price(observer, MarkPriceUpdate(iid, Price.from_str("100.10"), ts, ts))
        # Another contract's first mark of a minute is evidence too; the run's result is journalled once a minute.
        live_lifecycle.Observer.on_mark_price(observer, MarkPriceUpdate(other, Price.from_str("2.50"), 2 * MINUTE_NS + 9,
                                                                        2 * MINUTE_NS + 9))
        settlement = 8 * HOUR_NS
        for ts, following in ((3 * MINUTE_NS, settlement), (settlement + 3, settlement + 8 * HOUR_NS),
                              (settlement + 4, settlement + 8 * HOUR_NS)):
            live_lifecycle.Observer.on_funding_rate(observer, FundingRateUpdate(
                iid, Decimal("0.0001"), ts, ts, None, following))
        recorded = [{key: value for key, value in row.items() if key != "wall_ns"} for row in rows(self.output)]
        self.assertEqual(recorded, [
            {"kind": "mark", "instrument_id": str(iid), "ts_event": MINUTE_NS + 5, "ts_init": MINUTE_NS + 5,
             "value": "100.10"},
            {"kind": "mark", "instrument_id": str(iid), "ts_event": 2 * MINUTE_NS + 7, "ts_init": 2 * MINUTE_NS + 7,
             "value": "100.10"},
            {"kind": "mark", "instrument_id": str(other), "ts_event": 2 * MINUTE_NS + 9, "ts_init": 2 * MINUTE_NS + 9,
             "value": "2.50"},
            {"kind": "funding_settlement", "instrument_id": str(iid), "settlement_ns": settlement,
             "stream_rate": "0.0001", "mark": "100.10", "mark_ts": 2 * MINUTE_NS + 7,
             "positions": [{"position_id": "P-1", "signed_qty": "0.002"}]},
        ])
        self.assertEqual(session.record_minute.call_count, 2)

    def test_reports_from_the_live_cache_equal_the_replays_own(self):
        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                     logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
        try:
            add_venue(engine, fixture.fees())
            engine.add_instrument(fixture.INSTRUMENT)
            engine.add_strategy(Twice("long"))
            data = []
            for index in range(16):
                ts = fixture.START + (index + 1) * MINUTE_NS - 1_000_000
                prices = [Price.from_str(value) for value in (fixture.FLAT if index < 2 else fixture.LOW_NEARER)]
                data += [Bar(fixture.BAR_TYPE, *prices, Quantity.from_str("40.000"), ts, ts),
                         MarkPriceUpdate(fixture.INSTRUMENT_ID, prices[3], ts, ts)]
            engine.add_data(data)
            engine.run()
            self.assertEqual(len(engine.cache.positions_closed()), 2)
            replay = self.output / "replay"
            replay.mkdir()
            write_reports(replay, engine.cache, engine.generate_orders_report(), engine.generate_fills_report(),
                          engine.generate_positions_report(), engine.generate_account_report(venue=Venue("BINANCE")))
            write_order_events(engine.cache.orders(), replay / ORDER_EVENTS)
            failures = Mock()
            Evidence(self.output, failures).reports(engine.cache, Venue("BINANCE"))
            failures.assert_not_called()
            [written] = list((self.output / EVIDENCE).iterdir())
            self.assertTrue(written.name.startswith("reports-"))
            for name in ("orders.csv", "fills.csv", "positions.csv", "account.csv", ORDER_EVENTS):
                self.assertEqual((written / name).read_bytes(), (replay / name).read_bytes(), name)
            self.assertEqual(len((written / "fills.csv").read_text().splitlines()), 5)
            instruments = json.loads((written / INSTRUMENTS).read_text())
            self.assertEqual(list(instruments), [str(fixture.INSTRUMENT_ID)])
            self.assertEqual(instruments[str(fixture.INSTRUMENT_ID)]["price_increment"], "0.01")
        finally:
            engine.dispose()

    def test_a_failed_write_is_journaled_once_and_never_fails_the_run(self):
        session, _ = self.session()
        (self.output / EVIDENCE).write_text("not a directory")
        update = MarkPriceUpdate(fixture.INSTRUMENT_ID, Price.from_str("100.10"), MINUTE_NS, MINUTE_NS)
        session.evidence.mark(update)
        session.evidence.mark(update)
        session.evidence.bar(bar(MINUTE_NS))
        session.evidence.reports(SimpleNamespace(), Venue("BINANCE"))
        events = [json.loads(line) for line in (self.output / "events.jsonl").read_text().splitlines()]
        self.assertEqual([(row["event"], row["part"]) for row in events],
                         [("evidence_unavailable", "market"), ("evidence_unavailable", "reports")])
        self.assertFalse(session.failed or session.journal_failed or session.stopping)
