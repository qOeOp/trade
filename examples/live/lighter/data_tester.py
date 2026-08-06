#!/usr/bin/env python3
"""
Lighter Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to Lighter. Pass --run to start subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.lighter import LIGHTER
from vibe_trader.adapters.lighter import LighterDataClientConfig
from vibe_trader.adapters.lighter import LighterDataClientFactory
from vibe_trader.adapters.lighter import LighterEnvironment
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import BarType
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


def main() -> None:
    args = parse_args()
    lighter_environment = lighter_environment_from_name(args.lighter_environment)
    instrument_id = InstrumentId.from_str(args.instrument)
    request_funding_rates = args.subscribe_funding_rates and "-SPOT." not in args.instrument.upper()

    builder = LiveNode.builder(
        "LIGHTER-DATA-TESTER-001",
        TraderId.from_str(args.trader_id),
        Environment.LIVE,
    ).add_data_client(
        None,
        LighterDataClientFactory(),
        LighterDataClientConfig(environment=lighter_environment),
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(LIGHTER),
            instrument_ids=[instrument_id],
            bar_types=[BarType.from_str(f"{args.instrument}-1-MINUTE-LAST-EXTERNAL")],
            subscribe_book_deltas=True,
            subscribe_quotes=True,
            subscribe_trades=True,
            subscribe_funding_rates=request_funding_rates,
            request_instruments=True,
            request_trades=True,
            request_bars=True,
            request_funding_rates=request_funding_rates,
            manage_book=True,
            log_data=True,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built Lighter data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the Lighter Python data tester.")
    parser.add_argument("--lighter-environment", choices=["testnet", "mainnet"], default="testnet")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default=f"BTC-PERP.{LIGHTER}")
    parser.add_argument(
        "--subscribe-funding-rates",
        action=argparse.BooleanOptionalAction,
        default=True,
    )
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


def lighter_environment_from_name(name: str) -> LighterEnvironment:
    if name == "mainnet":
        return LighterEnvironment.MAINNET

    return LighterEnvironment.TESTNET


if __name__ == "__main__":
    main()
