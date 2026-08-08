#!/usr/bin/env python3
"""
Tardis Python data tester example.

The default path builds a sandbox node and attaches the built-in Rust DataTester without
connecting to Tardis Machine. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.tardis import TardisDataClientConfig
from vibe_trader.adapters.tardis import TardisDataClientFactory
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


TARDIS = "TARDIS"


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = LiveNode.builder(
        "TARDIS-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.SANDBOX,
    ).add_data_client(
        None,
        TardisDataClientFactory(),
        TardisDataClientConfig(tardis_ws_url=args.tardis_ws_url),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(TARDIS),
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
        print("Built Tardis data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the Tardis Python data tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default="BTCUSDT-PERP.BINANCE")
    parser.add_argument("--tardis-ws-url", default=None)
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
