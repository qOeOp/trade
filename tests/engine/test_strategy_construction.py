"""Source configuration reaches native allocation through each actual runner wrapper."""

import hashlib
import importlib
import json
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import UUID

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.infrastructure import RedisCacheConfig
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.model import (
    AccountType, Bar, BarType, BookType, Currency, InstrumentId, MarkPriceUpdate, Money,
    OmsType, OrderSide, Price, Quantity, Venue,
)
from nautilus_trader.trading import Strategy

from engine import live, paper, run
from engine.config import Refusal
from engine.live_venue import Credentials
from engine.load import load_strategy, source_findings


SOURCE = '''from nautilus_trader.trading import Strategy, StrategyConfig
from nautilus_trader.model import OmsType

class SourceConfig(StrategyConfig):
    def __init__(self, *, history, membership, **kwargs):
        super().__init__()
        self.history = history
        self.membership = membership

class ConfiguredSource(Strategy):
    def __new__(cls, instrument_id, bar_type, **kwargs):
        return Strategy.__new__(cls, SourceConfig(strategy_id=kwargs['strategy_id'],
            oms_type=OmsType.NETTING, use_uuid_client_order_ids=True, manage_gtd_expiry=True,
            history=kwargs['historical_daily_bars'], membership=kwargs['universe_membership']))

    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__()
        self.original_config = self.config
        self.same_inputs = (self.config.history is kwargs['historical_daily_bars']
                            and self.config.membership is kwargs['universe_membership'])

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, orders_denied_or_rejected=False):
        return []

class InheritedSource(ConfiguredSource):
    pass
'''


class ConstructionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "source.py"
        run.clear_failures()
        self.addCleanup(run.clear_failures)

    def load(self, source=SOURCE, entry="ConfiguredSource"):
        self.path.write_text(source)
        return load_strategy(self.path, entry, hashlib.sha256(source.encode()).hexdigest())

    def engine(self):
        engine = BacktestEngine(BacktestEngineConfig(
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
        self.addCleanup(engine.dispose)
        return engine

    def assert_native_config(self, source):
        self.assertIs(source.config, source.original_config)
        self.assertTrue(source.same_inputs)
        self.assertFalse(hasattr(source, "_source_constructor_args"))
        order = source.order_factory.market(InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
                                            OrderSide.BUY, Quantity.from_str("0.001"))
        self.assertEqual(UUID(str(order.client_order_id)).version, 4)

    def test_replay_importable_bridge_preserves_inherited_allocation_and_warmup_once(self):
        source = SOURCE.replace("class ConfiguredSource(Strategy):", "class ConfiguredSource(Strategy):\n    DAILY_WARMUP = True")
        loaded = self.load(source, "InheritedSource")
        inputs = run.StrategyInputs("BTCUSDT-PERP.BINANCE", 123, 100, "SOURCE-001", "/unused", [[0, 1000]])
        engine = self.engine()
        with patch.object(run, "warmup_daily_bars", return_value=["warmup"]) as warmup:
            engine.add_strategy_from_config(ImportableStrategyConfig(
                strategy_path="engine.run:" + run._runner_class(loaded).__name__,
                config_path="engine.run:StrategyInputs", config=inputs.__dict__))
        warmup.assert_called_once()
        self.assert_native_config(run.STRATEGIES[inputs.instrument_id])

    def test_paper_wrapper_preserves_native_allocation(self):
        loaded = self.load()
        inputs = paper.PaperInputs("BTCUSDT-PERP.BINANCE", 123, 100, "SOURCE-001", [[0, 1000]], ["warmup"])
        source = run.configure_strategy(loaded, inputs, paper.paper_class)
        self.engine().add_strategy(source)
        self.assert_native_config(source)

    def test_replay_native_gtd_management_and_stop_use_source_config(self):
        from tests.engine.test_partial_entry_protection import INSTRUMENT

        source = SOURCE.replace("from nautilus_trader.model import OmsType",
                                "from nautilus_trader.model import OmsType, BarType, OrderSide, Price, Quantity, TimeInForce")
        source = source.replace("manage_gtd_expiry=True,", "manage_gtd_expiry=True, manage_stop=True,")
        source = source.replace("        self.original_config = self.config", """        self.original_config = self.config
        self.instrument_id = instrument_id
        self.steps = 0""")
        source = source.replace("    def replay_diagnostics(self):", """    def on_start(self):
        self.subscribe_bars(BarType.from_str(f'{self.instrument_id}-1-MINUTE-LAST-EXTERNAL'))

    def on_bar(self, bar):
        self.steps += 1
        if self.steps in (1, 2):
            self.submit_order(self.order_factory.market(self.instrument_id, OrderSide.BUY, Quantity.from_str('0.001')))
        if self.steps == 1:
            self.submit_order(self.order_factory.limit(self.instrument_id, OrderSide.BUY, Quantity.from_str('0.001'),
                Price.from_str('50.00'), time_in_force=TimeInForce.GTD,
                expire_time=self.clock.timestamp_ns() + 3600_000_000_000))
            self.gtd_timers = self.clock.timer_names()
        if self.steps == 3:
            self.before_stop = [p.quantity for p in self.cache.positions_open(strategy_id=self.strategy_id)]
            self.stop()
            self.managed_exit = self.is_exiting()

    def replay_diagnostics(self):""")
        loaded = self.load(source)
        inputs = run.StrategyInputs(str(INSTRUMENT.id), 0, 0, "SOURCE-001", "/unused", [])
        strategy = run.configure_strategy(loaded, inputs)
        engine = self.engine()
        engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
                         [Money(10000, Currency.from_str("USDT"))], base_currency=Currency.from_str("USDT"),
                         default_leverage=Decimal(1), book_type=BookType.L1_MBP, bar_execution=True,
                         fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)))
        engine.add_instrument(INSTRUMENT)
        engine.add_strategy(strategy)
        bars = []
        bar_type = BarType.from_str(f"{INSTRUMENT.id}-1-MINUTE-LAST-EXTERNAL")
        price = Price.from_str("100.00")
        for step in range(1, 7):
            ts = 1_767_225_600_000_000_000 + step * 60_000_000_000
            bars.extend([MarkPriceUpdate(INSTRUMENT.id, price, ts, ts),
                         Bar(bar_type, price, price, price, price, Quantity.from_str("1000.000"), ts, ts)])
        engine.add_data(bars)
        engine.run()
        self.assertTrue(any(name.startswith("GTD-EXPIRY:") for name in strategy.gtd_timers))
        self.assertEqual(strategy.before_stop, [Quantity.from_str("0.002")])
        self.assertTrue(strategy.managed_exit)
        self.assertEqual(engine.cache.positions_open(), [])
        self.assertEqual(run.FAILURES, [])

    def test_live_wrapper_reads_inputs_once_and_uses_native_factory(self):
        loaded = self.load()
        universe = self.root / "universe.json"
        universe.write_text(json.dumps({"membership": {"BTCUSDT": [[0, 1000]]}}))
        manifest = dict(run_id="constructor", trader_id="LIVE-001", account_id="BINANCE-001",
                        symbols=["BTCUSDT"], universe_file=str(universe),
                        universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                        config={"duration_seconds": 30, "max_notional_per_order": "100"})
        session = live.Session(manifest, self.root, "run")
        with patch.object(live, "read_universe", wraps=live.read_universe) as read_universe, \
                patch.object(live.time, "time_ns", return_value=123) as now:
            node = live.build_node(session, Credentials("fixture", "fixture"),
                                   RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            read_universe.assert_called_once()
            now.assert_called_once()
            self.assertEqual(session.source._replay_input_start_ns, 123)
            self.assert_native_config(session.source)
        finally:
            node.dispose()
            session.node, session.source = None, None

    def test_allocator_type_error_is_not_retried(self):
        source = SOURCE.replace("class SourceConfig(StrategyConfig):", """calls = []
def fail_config():
    calls.append('called')
    raise TypeError('allocator failure')

class SourceConfig(StrategyConfig):""")
        start = source.index("SourceConfig(strategy_id=kwargs['strategy_id']")
        end = source.index("\n\n    def __init__", start)
        source = source[:start] + "fail_config())" + source[end:]
        loaded = self.load(source)
        inputs = run.StrategyInputs("BTCUSDT-PERP.BINANCE", 123, 100, "SOURCE-001", "/unused", [])
        with self.assertRaisesRegex(Refusal, "STRATEGY_CONSTRUCTION_FAILED.*allocator failure"):
            run.configure_strategy(loaded, inputs)
        module = importlib.import_module(loaded.strategy_class.__module__)
        self.assertEqual(module.calls, ["called"])
        self.assertEqual(run.FAILURES[0]["stage"], "constructor")

    def test_allocator_cannot_replace_configured_type(self):
        class Configured(Strategy):
            pass
        with self.assertRaisesRegex(TypeError, "preserve the configured strategy class"):
            run.allocate_strategy(Configured, lambda cls: Strategy(), (), {})


class AllocationReachTests(unittest.TestCase):
    def test_direct_native_allocation_passes_source_check(self):
        self.assertEqual(source_findings(SOURCE.encode()), [])

    def test_class_escape_and_non_native_allocators_are_refused(self):
        alternatives = [
            "return Strategy()",
            "return super().__new__(cls)",
            "return Strategy.__new__(cls)",
            "return Strategy.__new__(cls, config=None)",
            "return Strategy.__new__(cls, *args)",
            "allocate = Strategy.__new__\n        return allocate(cls, None)",
            "cls.submit_order = replacement\n        return Strategy.__new__(cls, None)",
            "return Strategy.__new__(cls, capture(cls))",
            "return Strategy.__new__(cls, cls)",
            "return other_allocator(cls)",
        ]
        for body in alternatives:
            source = ("from nautilus_trader.trading import Strategy\nclass Source(Strategy):\n"
                      "    def __new__(cls, *args, **kwargs):\n        " + body + "\n")
            with self.subTest(body=body):
                self.assertTrue(source_findings(source.encode()))

    def test_native_name_shadowing_and_non_constructor_access_stay_refused(self):
        for extra in ("Strategy = other", "def function(Strategy): pass", "class Strategy: pass",
                      "from collections import deque as Strategy", "def function():\n    Strategy = other",
                      "allocate = Strategy.__new__", "value = Strategy.__mro__"):
            with self.subTest(extra=extra):
                self.assertTrue(source_findings((SOURCE + "\n" + extra + "\n").encode()))
        for changed in (SOURCE.replace("    def __new__", "    @staticmethod\n    def __new__"),
                        SOURCE.replace("    def __new__", "    async def __new__")):
            self.assertTrue(source_findings(changed.encode()))


if __name__ == "__main__":
    unittest.main()
