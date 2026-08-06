#!/usr/bin/env python3
"""
Deribit Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to Deribit. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.deribit import DeribitDataClientConfig
from vibe_trader.adapters.deribit import DeribitDataClientFactory
from vibe_trader.adapters.deribit import DeribitEnvironment
from vibe_trader.adapters.deribit import DeribitProductType
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


DERIBIT = "DERIBIT"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "DERIBIT-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        DeribitDataClientFactory(),
        DeribitDataClientConfig(
            product_types=[DeribitProductType.FUTURE],
            environment=DeribitEnvironment.TESTNET,
        ),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(DERIBIT),
            instrument_ids=[instrument_id],
            subscribe_quotes=True,
            subscribe_trades=True,
            subscribe_index_prices=True,
            subscribe_mark_prices=True,
            subscribe_instrument_status=True,
            request_trades=True,
            manage_book=True,
            log_data=True,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built Deribit data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the Deribit Python data tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default=f"BTC-PERPETUAL.{DERIBIT}")
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
