#!/usr/bin/env python3
"""
Interactive Brokers Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to TWS or IB Gateway. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.interactive_brokers import InteractiveBrokersDataClientConfig
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersDataClientFactory
from vibe_trader.adapters.interactive_brokers import MarketDataType
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import BarType
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


IB = "IB"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "IB-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        InteractiveBrokersDataClientFactory(),
        InteractiveBrokersDataClientConfig(
            host=args.host,
            port=args.port,
            client_id=args.client_id,
            market_data_type=MarketDataType.DELAYED,
        ),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(IB),
            instrument_ids=[instrument_id],
            bar_types=[BarType.from_str(f"{args.instrument}-1-MINUTE-LAST-EXTERNAL")],
            subscribe_book_deltas=True,
            subscribe_quotes=True,
            subscribe_trades=True,
            subscribe_bars=True,
            request_instruments=True,
            request_quotes=True,
            request_trades=True,
            request_bars=True,
            manage_book=True,
            log_data=True,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built Interactive Brokers data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build or run the Interactive Brokers Python data tester.",
    )
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7497)
    parser.add_argument("--client-id", type=int, default=101)
    parser.add_argument("--instrument", default="AAPL=STK.SMART")
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
