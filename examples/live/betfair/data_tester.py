#!/usr/bin/env python3
"""
Betfair Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to Betfair. Pass --run to connect.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.betfair import BetfairDataClientFactory
from vibe_trader.adapters.betfair import BetfairDataConfig
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


BETFAIR = "BETFAIR"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "BETFAIR-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        BetfairDataClientFactory(),
        BetfairDataConfig(
            account_currency=args.account_currency,
            market_ids=[args.market_id],
            stream_conflate_ms=args.stream_conflate_ms,
        ),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(BETFAIR),
            instrument_ids=[instrument_id],
            subscribe_book_deltas=True,
            subscribe_trades=True,
            subscribe_instrument_status=True,
            can_unsubscribe=False,
            manage_book=True,
            log_data=True,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built Betfair data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the Betfair Python data tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--account-currency", default="GBP")
    parser.add_argument("--market-id", default="1.234567890")
    parser.add_argument("--instrument", default=f"1.234567890-123456.{BETFAIR}")
    parser.add_argument("--stream-conflate-ms", type=int, default=0)
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
