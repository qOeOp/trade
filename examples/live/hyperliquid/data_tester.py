#!/usr/bin/env python3
"""
Hyperliquid Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to Hyperliquid. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.hyperliquid import HyperliquidDataClientConfig
from vibe_trader.adapters.hyperliquid import HyperliquidDataClientFactory
from vibe_trader.adapters.hyperliquid import HyperliquidEnvironment
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


HYPERLIQUID = "HYPERLIQUID"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "HYPERLIQUID-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        HyperliquidDataClientFactory(),
        HyperliquidDataClientConfig(environment=HyperliquidEnvironment.MAINNET),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(HYPERLIQUID),
            instrument_ids=[instrument_id],
            subscribe_quotes=True,
            subscribe_trades=True,
            subscribe_mark_prices=True,
            subscribe_index_prices=True,
            subscribe_funding_rates=True,
            manage_book=True,
            log_data=True,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built Hyperliquid data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build or run the Hyperliquid Python data tester.",
    )
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default=f"BTC-USD-PERP.{HYPERLIQUID}")
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
