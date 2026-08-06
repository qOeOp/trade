#!/usr/bin/env python3
"""
BitMEX Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to BitMEX. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.bitmex import BitmexDataClientConfig
from vibe_trader.adapters.bitmex import BitmexDataClientFactory
from vibe_trader.adapters.bitmex import BitmexEnvironment
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


BITMEX = "BITMEX"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "BITMEX-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        BitmexDataClientFactory(),
        BitmexDataClientConfig(environment=BitmexEnvironment.TESTNET),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(BITMEX),
            instrument_ids=[instrument_id],
            subscribe_quotes=True,
            subscribe_trades=True,
            subscribe_mark_prices=True,
            subscribe_index_prices=True,
            subscribe_funding_rates=True,
            subscribe_instrument_status=True,
            manage_book=True,
            log_data=True,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built BitMEX data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the BitMEX Python data tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default=f"XBTUSD.{BITMEX}")
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
