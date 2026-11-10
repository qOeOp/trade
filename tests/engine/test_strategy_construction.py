"""The runner's configuration reaches native allocation through each actual runner wrapper, and a source can
neither allocate nor configure the strategy."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import UUID

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.infrastructure import RedisCacheConfig
from nautilus_trader.model import (
    InstrumentId, OmsType, OrderSide, Quantity, StrategyId,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import strategy as strategy_runtime
from engine import live, paper, run
from engine import live_records, live_source as live_source_runtime
from engine.config import Refusal
from engine.live_venue import Credentials
from engine.load import load_strategy, source_findings


SOURCE = '''from nautilus_trader.trading import Strategy

class ConfiguredSource(Strategy):
    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__()
        self.original_config = self.config
        self.history = kwargs['historical_daily_bars']

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
        strategy_runtime.clear_failures()
        self.addCleanup(strategy_runtime.clear_failures)

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
        expected = strategy_runtime.source_config(source.strategy_id)
        for name in strategy_runtime._CONFIG_FIELDS:
            self.assertEqual(getattr(source.config, name), getattr(expected, name), name)
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
        self.assert_native_config(strategy_runtime.STRATEGIES[inputs.instrument_id])

    def test_paper_wrapper_preserves_native_allocation(self):
        loaded = self.load()
        inputs = paper.PaperInputs("BTCUSDT-PERP.BINANCE", 123, 100, "SOURCE-001", [[0, 1000]], ["warmup"])
        source = run.configure_strategy(loaded, inputs, paper.paper_class)
        self.engine().add_strategy(source)
        self.assert_native_config(source)

    def test_live_wrapper_reads_inputs_once_and_uses_native_factory(self):
        loaded = self.load()
        universe = self.root / "universe.json"
        universe.write_text(json.dumps({"membership": {"BTCUSDT": [[0, 1000]]}}))
        manifest = dict(run_id="constructor", trader_id="LIVE-001", account_id="BINANCE-001",
                        symbols=["BTCUSDT"], universe_file=str(universe),
                        universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                        config={"duration_seconds": 30})
        session = live.Session(manifest, self.root, "run")
        with patch.object(live_source_runtime, "read_universe", wraps=live_source_runtime.read_universe) as read_universe, \
                patch.object(live.time, "time_ns", return_value=123) as now:
            node = live.build_node(session, Credentials("fixture", "fixture"),
                                   RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            read_universe.assert_called_once()
            now.assert_called_once()
            self.assertEqual(session.source._replay_input_start_ns, 123)
            self.assert_native_config(session.source)
            self.assertEqual(type(session.source).__module__, "engine.live")
        finally:
            node.dispose()
            session.node, session.source = None, None

    def test_live_dynamic_native_class_retains_library_and_module_entry_context(self):
        loaded = self.load()
        universe = self.root / "universe.json"
        universe.write_text(json.dumps({"membership": {"BTCUSDT": [[0, 1000]]}}))
        manifest = dict(run_id="constructor", trader_id="LIVE-001", account_id="BINANCE-001",
                        symbols=["BTCUSDT"], universe_file=str(universe),
                        universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                        config={"duration_seconds": 30})
        for module_name in ("engine.live", "__main__"):
            with self.subTest(module_name):
                session = live.Session(manifest, self.root, "run")
                node = live.build_node(session, Credentials("fixture", "fixture"),
                                       RedisCacheConfig(host="127.0.0.1", port=1), loaded,
                                       source_module=module_name)
                try:
                    self.assertEqual(type(session.source).__module__, module_name)
                    self.assertEqual(type(session.source).__name__, "LiveSource_" + loaded.content_hash)
                    self.assertEqual(str(session.source.strategy_id), str(live_records.source_strategy_id(manifest)))
                    self.assert_native_config(session.source)
                finally:
                    node.dispose()
                    session.node, session.source = None, None
                    del node

    def test_a_replaced_configuration_is_refused(self):
        identity = StrategyId("SOURCE-001")
        changes = dict(strategy_id=StrategyId("OTHER-001"), order_id_tag="001", oms_type=OmsType.HEDGING,
                       use_uuid_client_order_ids=False, manage_stop=True, manage_gtd_expiry=True,
                       manage_contingent_orders=True, market_exit_reduce_only=False)
        self.assertEqual(set(changes), set(strategy_runtime._CONFIG_FIELDS))
        class Source(Strategy):
            pass
        kept = strategy_runtime.allocate_strategy(Source, identity, (), {})
        Strategy.__init__(kept)
        strategy_runtime.require_source_config(kept, identity)
        for name, value in changes.items():
            with self.subTest(name=name):
                source = strategy_runtime.allocate_strategy(Source, identity, (), {})
                Strategy.__init__(source, StrategyConfig(**{"strategy_id": identity, "oms_type": OmsType.NETTING,
                                                            "use_uuid_client_order_ids": True, name: value}))
                with self.assertRaisesRegex(Refusal, "SOURCE_CONFIG"):
                    strategy_runtime.require_source_config(source, identity)


class AllocationReachTests(unittest.TestCase):
    def test_the_source_neither_allocates_nor_configures_the_strategy(self):
        self.assertEqual(source_findings(SOURCE.encode()), [])
        allocation = "    def __new__(cls, *args, **kwargs):\n        return Strategy.__new__(cls)\n"
        for changed in (
                SOURCE.replace("    def __init__", allocation + "    def __init__", 1),
                SOURCE.replace("    def __init__", "    @staticmethod\n" + allocation + "    def __init__", 1),
                SOURCE.replace("    def __init__", allocation.replace("def", "async def") + "    def __init__", 1),
                SOURCE.replace("import Strategy", "import Strategy, StrategyConfig"),
                SOURCE.replace("import Strategy", "import Strategy, StrategyConfig as Settings"),
                "import nautilus_trader.trading as trading\n" + SOURCE + "Settings = trading.StrategyConfig\n"):
            with self.subTest(changed=changed):
                self.assertTrue([found for found in source_findings(changed.encode())
                                 if "the runner allocates and configures" in found])

    def test_native_constructor_access_stays_refused(self):
        for extra in ("allocate = Strategy.__new__", "value = Strategy.__mro__"):
            with self.subTest(extra=extra):
                self.assertTrue(source_findings((SOURCE + "\n" + extra + "\n").encode()))


if __name__ == "__main__":
    unittest.main()
