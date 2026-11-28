"""The runner seals the observed exposure rows reproducibly and refuses an incomplete observation."""

import csv
import gzip
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from engine.report import EXPOSURE_COLUMNS, ExposureWriter
from engine.report import capital_findings


ROWS = [(1_767_225_899_999_000_000, "AAAUSDT-PERP.BINANCE-R1-AAA", "100.00000000 USDT", "-1.00000000 USDT", "-0.10000000 USDT")]


class CapitalExposureTests(unittest.TestCase):
    def test_exposure_report_bytes_repeat_and_read_back(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = Path(temp) / "a.csv.gz", Path(temp) / "b.csv.gz"
            for path in (first, second):
                writer = ExposureWriter(path)
                for row in ROWS:
                    writer.write(row)
                writer.close()
            self.assertEqual(first.read_bytes(), second.read_bytes())
            rows = list(csv.reader(io.StringIO(gzip.decompress(first.read_bytes()).decode())))
        self.assertEqual(rows, [list(EXPOSURE_COLUMNS), [str(value) for value in ROWS[0]]])

    def test_observer_retains_native_partial_realizations(self):
        from decimal import Decimal
        from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, StrategyId, TraderId
        from nautilus_trader.trading import Strategy, StrategyConfig
        from engine import run
        from tests.engine import test_fill_model as native

        class Partial(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.count = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                # Every order after the first names the one HEDGING position, so it changes in place.
                self.count += 1
                held = self.cache.positions_open(strategy_id=self.strategy_id)
                named = held[0].id if held else None
                if self.count in (2, 5):
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("2.000")), position_id=named)
                if self.count in (4, 7):
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.SELL,
                                                                 Quantity.from_str("1.000"), reduce_only=True),
                                      position_id=named)

        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                  logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
        self.addCleanup(engine.dispose)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "exposures.csv.gz"
            run.add_venue(engine, native.fees())
            engine.add_instrument(native.INSTRUMENT)
            engine.add_strategy(Partial())
            observer = run.capital_observer((str(native.INSTRUMENT_ID),), path)
            engine.add_actor(observer)
            data, base = [], native.START
            for i, value in enumerate((100, 110, 90, 85, 90, 80, 75, 75)):
                ts = base + (i + 1) * native.BAR_NS - 1_000_000
                price = Price.from_str(f"{value:.2f}")
                data += [MarkPriceUpdate(native.INSTRUMENT_ID, price, ts, ts),
                         Bar(native.BAR_TYPE, price, price, price, price, Quantity.from_str("1000.000"), ts, ts)]
            engine.add_data(data)
            engine.run()
            observer.finish(engine.cache)
            rows = list(csv.DictReader(io.StringIO(gzip.decompress(path.read_bytes()).decode())))
        self.assertEqual(observer.findings, [])
        self.assertEqual(Decimal(rows[0]["realized_pnl"].split()[0]), Decimal("-0.11000000"), "entry commission")
        self.assertEqual(Decimal(rows[-1]["realized_pnl"].split()[0]), Decimal("-46.94666667"),
                         "two partial exits, including native commissions")
        self.assertEqual(rows[-1]["realized_pnl"], str(engine.cache.positions_open()[0].realized_pnl))

    def observe(self, prices, plan):
        """The exposure rows (position ID and unrealized PnL per label), the labels and the observer's findings of a
        replay of one-minute `prices`, trading 1.000 by `plan`: {bar number: [(seconds after the bar, action)]}, the
        action "buy" (a new position), "sell" (closing the open one) or "reopen" (a buy naming the first position's
        ID, which HEDGING reuses once that position closed)."""
        from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
        from nautilus_trader.common import LoggerConfig, LogLevel
        from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, StrategyId, TraderId
        from nautilus_trader.trading import Strategy, StrategyConfig
        from engine import run
        from tests.engine import test_fill_model as native

        class Plan(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.count, self.first = 0, None

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.count += 1
                for seconds, action in plan.get(self.count, ()):
                    if seconds:
                        self.clock.set_time_alert_ns(f"{self.count}-{action}", bar.ts_event + seconds * 10**9,
                                                     lambda event, action=action: self.act(action))
                    else:
                        self.act(action)

            def act(self, action):
                held = self.cache.positions_open(strategy_id=self.strategy_id)
                side = OrderSide.SELL if action == "sell" else OrderSide.BUY
                named = held[0].id if action == "sell" else self.first if action == "reopen" else None
                self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, side, Quantity.from_str("1.000"),
                                                             reduce_only=action == "sell"), position_id=named)

            def on_position_opened(self, event):
                self.first = self.first or event.position_id

        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                  logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
        self.addCleanup(engine.dispose)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "exposures.csv.gz"
            run.add_venue(engine, native.fees())
            engine.add_instrument(native.INSTRUMENT)
            engine.add_strategy(Plan())
            observer = run.capital_observer((str(native.INSTRUMENT_ID),), path)
            engine.add_actor(observer)
            data, labels = [], []
            for i, value in enumerate(prices):
                ts = native.START + (i + 1) * native.BAR_NS - 1_000_000
                price = Price.from_str(f"{value:.2f}")
                labels.append(ts)
                data += [MarkPriceUpdate(native.INSTRUMENT_ID, price, ts, ts),
                         Bar(native.BAR_TYPE, price, price, price, price, Quantity.from_str("1000.000"), ts, ts)]
            engine.add_data(data)
            engine.run()
            observer.finish(engine.cache)
            rows = list(csv.DictReader(io.StringIO(gzip.decompress(path.read_bytes()).decode())))
        held = [[(row["position_id"], row["unrealized_pnl"]) for row in rows if int(row["ts_event_ns"]) == label]
                for label in labels]
        opened = sorted(engine.cache.positions(), key=lambda position: position.ts_opened)
        return held, [str(position.id) for position in opened], observer.findings

    def test_a_row_holds_the_positions_as_of_its_own_timestamp(self):
        # One position closes and another opens on fills 30 s after bar T: row T holds the first, valued at T's MARK,
        # and not the second, as the account read at or before T holds neither fill (issue 3652).
        held, (first, second), findings = self.observe((100, 90, 95, 95), {1: [(0, "buy")], 2: [(30, "sell"),
                                                                                                   (30, "buy")]})
        self.assertEqual(findings, [])
        self.assertEqual(held, [[(first, "0.00000000 USDT")], [(first, "-10.00000000 USDT")],
                                [(second, "5.00000000 USDT")], [(second, "5.00000000 USDT")]])

    def test_a_reused_position_id_is_held_in_the_cycle_open_at_the_label(self):
        # A HEDGING position ID closed and reopened by an order naming it keeps its earlier cycle only as a native
        # snapshot; the row of T holds whichever cycle was open at T.
        held, ids, findings = self.observe((100, 100, 100, 90, 95, 95),
                                           {1: [(0, "buy")], 4: [(20, "sell"), (40, "reopen")]})
        self.assertEqual((findings, len(set(ids))), ([], 1))
        self.assertEqual(held[3:5], [[(ids[0], "-10.00000000 USDT")], [(ids[0], "5.00000000 USDT")]],
                         "closed 20 s and reopened 40 s after T")
        held, ids, findings = self.observe((100, 100, 100, 90, 95, 95),
                                           {1: [(0, "buy")], 2: [(0, "sell")], 3: [(0, "reopen")], 4: [(20, "sell")]})
        self.assertEqual((findings, held[1], held[4]), ([], [], []))
        self.assertEqual(held[3], [(ids[0], "-10.00000000 USDT")], "reopened before T, closed again 20 s after it")

    def test_missed_timestamps_and_unvalued_positions_fail_the_run(self):
        complete = SimpleNamespace(timestamps=3, findings=[])
        self.assertEqual(capital_findings(complete, 3), [])
        missed = SimpleNamespace(timestamps=2, findings=["capital observation cannot value X at 1", "capital observation cannot value X at 1"])
        self.assertEqual(capital_findings(missed, 3), [
            "capital observation cannot value X at 1",
            "CAPITAL_TIMESTAMP_COUNT_MISMATCH: capital observation valued 2 of 3 input timestamps"])
