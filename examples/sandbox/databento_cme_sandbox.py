#!/usr/bin/env python3
"""
Sandbox for Databento live data and CME simulated execution.
"""

from vibe_trader.adapters.databento import DATABENTO
from vibe_trader.adapters.databento import DatabentoDataClientConfig
from vibe_trader.adapters.databento import DatabentoLiveDataClientFactory
from vibe_trader.adapters.sandbox.config import SandboxExecutionClientConfig
from vibe_trader.adapters.sandbox.factory import SandboxLiveExecClientFactory
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LiveExecEngineConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.config import TradingNodeConfig
from vibe_trader.examples.strategies.simpler_quoter import SimpleQuoterStrategy
from vibe_trader.examples.strategies.simpler_quoter import SimpleQuoterStrategyConfig
from vibe_trader.live.node import TradingNode
from vibe_trader.model.identifiers import InstrumentId
from vibe_trader.model.identifiers import TraderId


# Specify instrument to be traded
instrument_id = InstrumentId.from_str("ESZ6.XCME")

instrument_provider = InstrumentProviderConfig(load_ids=frozenset([instrument_id]))

# Configure the trading node:
# For correct subscription operation, you must specify all instruments to be immediately
# subscribed for as part of the data client configuration.
config_data = DatabentoDataClientConfig(
    http_gateway=None,
    instrument_provider=instrument_provider,
    use_exchange_as_venue=True,
    mbo_subscriptions_delay=10.0,
    instrument_ids=[instrument_id],
    parent_symbols={"GLBX.MDP3": {"ES.FUT"}},
)

config_exec = SandboxExecutionClientConfig(
    venue="XCME",
    base_currency="USD",
    starting_balances=["1_000_000 USD"],
    instrument_provider=instrument_provider,
)

config_node = TradingNodeConfig(
    trader_id=TraderId("SANDBOX-001"),
    logging=LoggingConfig(log_level="INFO", use_pyo3=True),
    exec_engine=LiveExecEngineConfig(reconciliation=False),
    data_clients={
        DATABENTO: config_data,
    },
    exec_clients={
        "XCME": config_exec,
    },
    timeout_connection=30.0,
    timeout_reconciliation=5.0,
    timeout_portfolio=5.0,
    timeout_disconnection=10.0,
    timeout_post_stop=2.0,
)

# Instantiate the node with a configuration
node = TradingNode(config=config_node)

# Configure and initialize the quoter strategy
config_quoter = SimpleQuoterStrategyConfig(
    instrument_id=instrument_id,
    tob_offset_ticks=0,
    log_data=False,
)
quoter = SimpleQuoterStrategy(config=config_quoter)

node.trader.add_strategy(quoter)

# Register required client factories with the node
node.add_data_client_factory(DATABENTO, DatabentoLiveDataClientFactory)
node.add_exec_client_factory("XCME", SandboxLiveExecClientFactory)
node.build()


# Stop and dispose of the node with SIGINT/CTRL+C
if __name__ == "__main__":
    try:
        node.run()
    finally:
        node.dispose()
