#!/usr/bin/env python3
"""
Bybit Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to Bybit. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.bybit import BybitDataClientConfig
from vibe_trader.adapters.bybit import BybitDataClientFactory
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitProductType
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


BYBIT = "BYBIT"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "BYBIT-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        BybitDataClientFactory(),
        BybitDataClientConfig(
            product_types=[BybitProductType.LINEAR],
            environment=BybitEnvironment.MAINNET,
        ),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(BYBIT),
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
        print("Built Bybit data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the Bybit Python data tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default=f"BTCUSDT-LINEAR.{BYBIT}")
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
