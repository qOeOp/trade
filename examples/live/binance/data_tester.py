#!/usr/bin/env python3
"""
Binance Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to Binance. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.binance import BinanceDataClientConfig
from vibe_trader.adapters.binance import BinanceDataClientFactory
from vibe_trader.adapters.binance import BinanceEnvironment
from vibe_trader.adapters.binance import BinanceProductType
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


BINANCE = "BINANCE"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "BINANCE-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        BinanceDataClientFactory(),
        BinanceDataClientConfig(
            product_type=BinanceProductType.SPOT,
            environment=BinanceEnvironment.LIVE,
        ),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(BINANCE),
            instrument_ids=[instrument_id],
            subscribe_book_at_interval=True,
            book_interval_ms=args.book_interval_ms,
            manage_book=True,
            log_data=True,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built Binance data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the Binance Python data tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default=f"BTCUSDT.{BINANCE}")
    parser.add_argument("--book-interval-ms", type=int, default=10)
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
