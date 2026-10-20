"""The `candidate new` scaffold against the current runtime contract: the pinned engine loads it and
constructs its entry class with the runner's inputs. No ledger."""

from __future__ import annotations

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
from engine.load import load_strategy


class ScaffoldTests(unittest.TestCase):
    def test_the_scaffold_constructs_under_the_current_runtime_contract(self):
        root = Path(tempfile.mkdtemp(prefix="scaffold-"))
        self.addCleanup(shutil.rmtree, root, True)
        made = main.candidate_new(str(root / "work"), "fresh", "Fresh")
        source = Path(made["output"]) / "strategy.py"
        loaded = load_strategy(source, "Fresh", hashlib.sha256(source.read_bytes()).hexdigest())
        engine = BacktestEngine(BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.OFF,
                                                                          print_config=False)))
        self.addCleanup(engine.dispose)
        run.STRATEGIES.clear()
        self.addCleanup(run.STRATEGIES.clear)
        inputs = run.StrategyInputs(instrument_id="BTCUSDT-PERP.BINANCE", trade_start_ns=123, input_start_ns=100,
                                    strategy_id="FRESH-BTC", catalog_path="/unused", universe_membership=[[100, 200]])
        engine.add_strategy_from_config(ImportableStrategyConfig(
            strategy_path=f"engine.run:{run._runner_class(loaded).__name__}", config_path="engine.run:StrategyInputs",
            config=inputs.__dict__))
        strategy = run.STRATEGIES[inputs.instrument_id]
        self.assertIsInstance(strategy, loaded.strategy_class)
        self.assertEqual((strategy.trade_start_ns, str(strategy.config.strategy_id)), (123, "FRESH-BTC"))


if __name__ == "__main__":
    unittest.main()
