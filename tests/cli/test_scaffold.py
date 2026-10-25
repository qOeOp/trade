"""The `candidate new` scaffold against the current runtime contract: the pinned engine loads it,
constructs its entry class with the runner's inputs, and its sizing helpers read native equity and
round to the instrument's terms. No ledger."""

from __future__ import annotations

from decimal import Decimal
import hashlib
from pathlib import Path
import shutil
import tempfile
import unittest

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig

from cli import main
from engine import run
from engine.config import ACCOUNT_CONTRACT
from engine.load import load_strategy
from market.instrument import build_instrument
from tests.engine.test_fill_model import fees


TERMS = {"price_increment": "0.01", "size_increment": "0.001", "max_quantity": None, "min_quantity": "0.002",
         "min_notional": "5", "max_price": None, "min_price": None, "terms_source": "inferred", "observed_at": 0}


class ScaffoldTests(unittest.TestCase):
    def setUp(self):
        root = Path(tempfile.mkdtemp(prefix="scaffold-"))
        self.addCleanup(shutil.rmtree, root, True)
        made = main.candidate_new(str(root / "work"), "fresh", "Fresh")
        source = Path(made["output"]) / "strategy.py"
        self.loaded = load_strategy(source, "Fresh", hashlib.sha256(source.read_bytes()).hexdigest())
        self.engine = BacktestEngine(BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.OFF,
                                                                               print_config=False)))
        self.addCleanup(self.engine.dispose)
        run.STRATEGIES.clear()
        self.addCleanup(run.STRATEGIES.clear)

    def _strategy(self):
        inputs = run.StrategyInputs(instrument_id="BTCUSDT-PERP.BINANCE", trade_start_ns=123, input_start_ns=100,
                                    strategy_id="FRESH-BTC", catalog_path="/unused", universe_membership=[[100, 200]])
        self.engine.add_strategy_from_config(ImportableStrategyConfig(
            strategy_path=f"engine.run:{run._runner_class(self.loaded).__name__}",
            config_path="engine.run:StrategyInputs", config=inputs.__dict__))
        return run.STRATEGIES[inputs.instrument_id]

    def test_the_scaffold_constructs_under_the_current_runtime_contract(self):
        strategy = self._strategy()
        self.assertIsInstance(strategy, self.loaded.strategy_class)
        self.assertEqual((strategy.trade_start_ns, str(strategy.config.strategy_id)), (123, "FRESH-BTC"))

    def test_the_sizing_helpers_read_quote_equity_and_refuse_quantities_below_the_terms(self):
        run.add_venue(self.engine, fees())
        self.engine.add_instrument(build_instrument("BTCUSDT", TERMS, 2, "BTCUSDT-PERP.BINANCE")[0])
        strategy = self._strategy()
        self.engine.run()
        self.assertEqual(strategy.equity(), Decimal(ACCOUNT_CONTRACT["starting_balance_usdt"]))
        self.assertEqual(str(strategy.order_quantity(Decimal("1.23456"))), "1.234")
        self.assertEqual(str(strategy.order_quantity("0.002")), "0.002")  # at min_quantity
        self.assertIsNone(strategy.order_quantity(Decimal("0.0015")))  # rounds to 0.001, below min_quantity
        self.assertIsNone(strategy.order_quantity(Decimal("0.0009")))  # below the increment, where make_qty raises
        self.assertIsNone(strategy.order_quantity(0))
        self.assertIsNone(strategy.order_quantity("0.002", price="2000"))  # 4 USDT, below min_notional 5
        self.assertEqual(str(strategy.order_quantity("0.003", price=2000)), "0.003")


if __name__ == "__main__":
    unittest.main()
