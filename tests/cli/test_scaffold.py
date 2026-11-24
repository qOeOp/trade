"""The `candidate new` scaffold against the current runtime contract: the pinned engine loads it,
constructs its entry class with the runner's inputs, and its sizing helpers read native equity and
round to the instrument's terms. No ledger."""

from __future__ import annotations

import ast
from decimal import Decimal
import hashlib
import re
from pathlib import Path
import unittest

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.model import (
    Bar, MarkPriceUpdate, OmsType, OrderSide, Price, Quantity, StrategyId,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from cli import research_commands
from engine import strategy as strategy_runtime
from engine import run
from engine.config import ACCOUNT_CONTRACT
from engine.load import load_strategy
from market.instrument import build_instrument
from tests.engine.test_fill_model import BAR_NS, BAR_TYPE, INSTRUMENT, INSTRUMENT_ID, START, fees
from tests.helpers import tempdir


TERMS = {"price_increment": "0.01", "size_increment": "0.001", "max_quantity": None, "min_quantity": "0.002",
         "min_notional": "5", "max_price": None, "min_price": None, "terms_source": "inferred", "observed_at": 0}


class ScaffoldTests(unittest.TestCase):
    def setUp(self):
        root = tempdir(self.addCleanup, prefix="scaffold-")
        made = research_commands.candidate_new(str(root / "work"), "fresh", "Fresh")
        source = self.source = Path(made["output"]) / "strategy.py"
        self.loaded = load_strategy(source, "Fresh", hashlib.sha256(source.read_bytes()).hexdigest())
        self.engine = BacktestEngine(BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.OFF,
                                                                               print_config=False)))
        self.addCleanup(self.engine.dispose)
        strategy_runtime.STRATEGIES.clear()
        self.addCleanup(strategy_runtime.STRATEGIES.clear)

    def _strategy(self):
        inputs = run.StrategyInputs(instrument_id="BTCUSDT-PERP.BINANCE", trade_start_ns=123, strategy_id="FRESH-BTC",
                                    universe_membership=[[100, 200]])
        self.engine.add_strategy_from_config(ImportableStrategyConfig(
            strategy_path=f"engine.run:{run._runner_class(self.loaded).__name__}",
            config_path="engine.run:StrategyInputs", config=inputs.__dict__))
        return strategy_runtime.STRATEGIES[inputs.instrument_id]

    def test_the_module_docstring_is_the_header_to_fill_in(self):
        header = ast.get_docstring(ast.parse(self.source.read_bytes()), clean=False)
        self.assertTrue(header.lstrip().startswith("<Strategy name>: "), header[:80])
        self.assertNotIn("```", header)
        self.assertEqual(len([line for line in header.splitlines() if re.match(r"[A-I][1-5] .*: <stance> \|", line)]),
                         27, "one fillable line per duty")

    def test_the_sizing_helpers_read_quote_equity_and_refuse_quantities_below_the_terms(self):
        run.add_venue(self.engine, fees())
        self.engine.add_instrument(build_instrument("BTCUSDT", TERMS, 2, "BTCUSDT-PERP.BINANCE", on_grid=True)[0])
        strategy = self._strategy()
        self.engine.run()
        self.assertEqual(strategy.equity(START), Decimal(ACCOUNT_CONTRACT["starting_balance_usdt"]))
        self.assertEqual(str(strategy.order_quantity(Decimal("1.23456"))), "1.234")
        self.assertEqual(str(strategy.order_quantity("0.002")), "0.002")  # at min_quantity
        self.assertIsNone(strategy.order_quantity(Decimal("0.0015")))  # rounds to 0.001, below min_quantity
        self.assertIsNone(strategy.order_quantity(Decimal("0.0009")))  # below the increment, where make_qty raises
        self.assertIsNone(strategy.order_quantity(0))
        self.assertIsNone(strategy.order_quantity("0.002", price="2000"))  # 4 USDT, below min_notional 5
        self.assertEqual(str(strategy.order_quantity("0.003", price=2000)), "0.003")

    def test_equity_counts_no_fill_or_price_of_the_deciding_minute(self):
        read = []

        scaffold = self.loaded.strategy_class.equity

        class Trades(Strategy):
            equity = scaffold
            instrument_id = INSTRUMENT_ID

            def on_start(self):
                self.subscribe_bars(BAR_TYPE)

            def on_bar(self, bar):
                if len(read) == 2:  # long 10 from 100: close at 102
                    for position in self.cache.positions_open():
                        self.close_position(position)
                read.append([self.equity(bar.ts_event)])
                if len(read) == 4:  # a bar handed over late: later bars are in the cache already
                    read[-1].append(self.equity(bar.ts_event - BAR_NS))
                if len(read) == 1:
                    self.submit_order(self.order_factory.limit(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("10.000"),
                                                               Price.from_str("105.00")))

            def on_order_filled(self, event):  # the same minute's fill is native now, and not yet counted
                read[-1].append(self.equity(event.ts_event))
                read[-1].append(self.equity(event.ts_event + 5 * 10**9))  # a Paper decision some seconds on

        run.add_venue(self.engine, fees())
        self.engine.add_instrument(INSTRUMENT)
        self.engine.add_strategy(Trades(StrategyConfig(strategy_id=StrategyId("T-1"), oms_type=OmsType.HEDGING)))
        data = []
        for minute, (close, mark) in enumerate((("100.00", "100"), ("101.00", "90"), ("102.00", "80"), ("99.00", "70"))):
            at, close = START + (minute + 1) * BAR_NS - 10**6, Price.from_str(close)
            data += [MarkPriceUpdate(INSTRUMENT_ID, Price.from_str(mark + ".00"), at, at),
                     Bar(BAR_TYPE, close, close, close, close, Quantity.from_str("9000.000"), at, at)]
        self.engine.add_data(data)
        self.engine.run()
        self.assertEqual([[str(round(value - Decimal(ACCOUNT_CONTRACT["starting_balance_usdt"]), 2)) for value in found]
                          for found in read],
                         [["0.00"] * 3, ["-0.50"], ["9.50"] * 3, ["18.99", "9.50"]])
