"""The runner seals the observed exposure rows reproducibly and refuses an incomplete observation."""

import csv
import gzip
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from engine.report import EXPOSURE_COLUMNS, ExposureWriter
from engine.run import capital_findings


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
        from tests.engine import test_partial_entry_protection as native

        class Partial(Strategy):
            def __init__(self):
                super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
                self.count = 0

            def on_start(self):
                self.subscribe_bars(native.BAR_TYPE)

            def on_bar(self, bar):
                self.count += 1
                if self.count in (2, 5):
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.BUY,
                                                                 Quantity.from_str("2.000")))
                if self.count in (4, 7):
                    self.submit_order(self.order_factory.market(native.INSTRUMENT_ID, OrderSide.SELL,
                                                                 Quantity.from_str("1.000"), reduce_only=True))

        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                  logging=LoggerConfig(stdout_level=LogLevel.OFF, print_config=False)))
        self.addCleanup(engine.dispose)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "exposures.csv.gz"
            run.add_venue(engine)
            engine.add_instrument(native.INSTRUMENT)
            engine.add_strategy(Partial())
            observer = run.capital_observer((str(native.INSTRUMENT_ID),), path)
            engine.add_actor(observer)
            data, base = [], int(native.START.timestamp() * 10**9)
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

    def test_missed_timestamps_and_unvalued_positions_fail_the_run(self):
        complete = SimpleNamespace(timestamps=3, findings=[])
        self.assertEqual(capital_findings(complete, 3), [])
        missed = SimpleNamespace(timestamps=2, findings=["capital observation cannot value X at 1", "capital observation cannot value X at 1"])
        self.assertEqual(capital_findings(missed, 3), [
            "capital observation cannot value X at 1",
            "CAPITAL_TIMESTAMP_COUNT_MISMATCH: capital observation valued 2 of 3 input timestamps"])


if __name__ == "__main__":
    unittest.main()
