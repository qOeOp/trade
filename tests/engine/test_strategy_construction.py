"""The runner's configuration reaches native allocation through each actual runner wrapper, and a source can
neither allocate nor configure the strategy."""

import functools
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
    InstrumentId, MarkPriceUpdate, OmsType, OrderSide, Price, Quantity, StrategyId,
)
from nautilus_trader.persistence import DataCatalogConfig
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import strategy as strategy_runtime
from engine import history, live, order_rules, paper, run
from engine import live_records, live_source as live_source_runtime
from engine.config import Refusal
from engine.live_venue import Credentials
from engine.load import load_strategy, source_findings
from tests.engine import test_fill_model as fixture
from tests.engine.test_warmup import binance
from tests.engine.test_live_venue import MARKET_DAY


SOURCE = '''from nautilus_trader.trading import Strategy

class ConfiguredSource(Strategy):
    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__()
        self.original_config = self.config

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

    def test_replay_importable_bridge_preserves_inherited_allocation_and_declares_its_warmup(self):
        source = SOURCE.replace("class ConfiguredSource(Strategy):",
                                "class ConfiguredSource(Strategy):\n    WARMUP = {'1-DAY': 3, '15-MINUTE': 0}")
        loaded = self.load(source, "InheritedSource")
        inputs = run.StrategyInputs("BTCUSDT-PERP.BINANCE", 123, "SOURCE-001", [[0, 1000]])
        self.addCleanup(order_rules.WARMING.clear)
        self.addCleanup(strategy_runtime.DECLARED.clear)
        self.engine().add_strategy_from_config(ImportableStrategyConfig(
            strategy_path="engine.run:" + run._runner_class(loaded).__name__,
            config_path="engine.run:StrategyInputs", config=inputs.__dict__))
        self.assert_native_config(strategy_runtime.STRATEGIES[inputs.instrument_id])
        self.assertEqual(strategy_runtime.DECLARED["SOURCE-001"], {"1-DAY", "15-MINUTE"})
        self.assertIn("SOURCE-001", order_rules.WARMING)  # until the runner's warm-up calls on_start

    def test_paper_wrapper_preserves_native_allocation(self):
        loaded = self.load()
        inputs = paper.PaperInputs("BTCUSDT-PERP.BINANCE", 123, 100, "SOURCE-001", paper.Membership("BTCUSDT", [(0, 1000)], 1000, None), 123)
        source = run.configure_strategy(loaded, inputs, paper.paper_class)
        self.engine().add_strategy(source)
        self.assert_native_config(source)

    def test_paper_warms_its_source_at_t_from_binance_klines_and_sends_no_order_before_on_start(self):
        source = SOURCE.replace("class ConfiguredSource(Strategy):", """class ConfiguredSource(Strategy):
    WARMUP = {'1-DAY': 2}
    seen = []

    def on_historical_bars(self, bars):
        self.seen.append(('history', [bar.ts_event for bar in bars]))
        self.submit_order(self.order_factory.market(self.instrument, OrderSide.BUY, Quantity.from_str('0.001')))

    def on_start(self):
        self.seen.append(('start',))
""").replace("        self.original_config = self.config\n", "        self.original_config = self.config\n"
                                                    "        self.instrument = instrument_id\n")
        source = "from nautilus_trader.model import OrderSide, Quantity\n" + source
        loaded = self.load(source)
        for registry in (history.STATES, history.ACTORS, order_rules.WARMING, strategy_runtime.DECLARED,
                         strategy_runtime.BREACHES, paper.FETCH):
            registry.clear()
            self.addCleanup(registry.clear)
        catalog = self.root / "catalog"
        catalog.mkdir()
        get, _ = binance()
        paper.FETCH.append(functools.partial(history.fetch, catalog=catalog, proxy_url=None, get=get))
        day = 1_767_225_600_000_000_000
        at = day + 7 * 60_000_000_000  # seven minutes into a day: its aggregation is warmed too
        inputs = paper.PaperInputs(str(fixture.INSTRUMENT_ID), at, at, "SOURCE-001",
                                     paper.Membership("BTCUSDT", [(0, 10**19)], 10**19, None), at)
        engine = BacktestEngine(BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.ERROR),
                                                     catalogs=[DataCatalogConfig(path=str(catalog))]))
        self.addCleanup(engine.dispose)
        run.add_venue(engine, fixture.fees())
        engine.add_instrument(fixture.INSTRUMENT)
        engine.add_actor(history.WarmupActor(history.WarmupActorConfig(live=True)))
        engine.add_strategy(run.configure_strategy(loaded, inputs, paper.paper_class))

        def feed(*stamps):
            engine.add_data([MarkPriceUpdate(fixture.INSTRUMENT_ID, Price.from_str("100.00"), ts, ts) for ts in stamps],
                            None, False, True)
            engine.run(None, stamps[-1], None, True)
            engine.clear_data()

        feed(at, at + history.SETTLE_NS)
        history.STATES["SOURCE-001"]["thread"].join(5)
        feed(*(at + history.SETTLE_NS + index * 200_000_000 for index in range(1, 10)))
        self.assertEqual(loaded.strategy_class.seen, [("history", [day - 86_400_000_000_000 - 1_000_000,
                                                                   day - 1_000_000]), ("start",)])
        self.assertEqual([code for code, _ in strategy_runtime.BREACHES], ["ORDER_RULE"])
        self.assertIn("warm-up has ended", strategy_runtime.BREACHES[0][1])
        self.assertEqual(order_rules.WARMING, set())

    def test_live_wrapper_reads_inputs_once_and_uses_native_factory(self):
        loaded = self.load()
        universe = self.root / "universe.json"
        universe.write_text(json.dumps({"membership": {"BTCUSDT": [[0, 1000]], "ETHUSDT": [[0, 1000]]}}))
        manifest = dict(run_id="constructor", trader_id="LIVE-001", account_id="BINANCE-001",
                        symbols=["BTCUSDT", "ETHUSDT"], universe_file=str(universe),
                        universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                        config={"duration_seconds": 30}, market=dict(market_day=MARKET_DAY))
        session = live.Session(manifest, self.root, "run")
        with patch.object(live_source_runtime, "read_universe", wraps=live_source_runtime.read_universe) as read_universe, \
                patch.object(live.time, "time_ns", return_value=123) as now:
            node = live.build_node(session, Credentials("fixture", "fixture"),
                                   RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            # One read of the universe and one T for every contract's instance.
            read_universe.assert_called_once()
            now.assert_called_once()
            self.assertEqual(len(session.sources), 2)
            for source in session.sources.values():
                self.assertEqual(source._replay_input_start_ns, history.start_at(123))
                self.assert_native_config(source)
                self.assertEqual(type(source).__module__, "engine.live")
        finally:
            node.dispose()
            session.node, session.sources, source = None, {}, None

    def test_live_dynamic_native_class_retains_library_and_module_entry_context(self):
        loaded = self.load()
        universe = self.root / "universe.json"
        universe.write_text(json.dumps({"membership": {"BTCUSDT": [[0, 1000]], "ETHUSDT": [[0, 1000]]}}))
        manifest = dict(run_id="constructor", trader_id="LIVE-001", account_id="BINANCE-001",
                        symbols=["BTCUSDT", "ETHUSDT"], universe_file=str(universe),
                        universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                        config={"duration_seconds": 30}, market=dict(market_day=MARKET_DAY))
        for module_name in ("engine.live", "__main__"):
            with self.subTest(module_name):
                session = live.Session(manifest, self.root, "run")
                node = live.build_node(session, Credentials("fixture", "fixture"),
                                       RedisCacheConfig(host="127.0.0.1", port=1), loaded,
                                       source_module=module_name)
                try:
                    # One instance per contract, each with its own native identity and contract (the user,
                    # 2026-11-13), of one class.
                    self.assertEqual(list(session.sources), ["BTCUSDT", "ETHUSDT"])
                    identities = live_records.strategy_ids(manifest)
                    self.assertEqual(len(set(identities.values())), 2)
                    for symbol, source in session.sources.items():
                        self.assertEqual(type(source).__module__, module_name)
                        self.assertEqual(type(source).__name__, "LiveSource_" + loaded.content_hash)
                        self.assertEqual(str(source.strategy_id), str(identities[symbol]))
                        self.assertEqual(source._live_symbol, symbol)
                        self.assert_native_config(source)
                finally:
                    node.dispose()
                    session.node, session.sources, source = None, {}, None
                    del node

    def test_a_replaced_configuration_is_refused(self):
        identity = StrategyId("SOURCE-001")
        changes = dict(strategy_id=StrategyId("OTHER-001"), order_id_tag="001", oms_type=OmsType.NETTING,
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
                Strategy.__init__(source, StrategyConfig(**{"strategy_id": identity, "oms_type": OmsType.HEDGING,
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
