#!/usr/bin/env python3
"""
Architect AX Python data tester example.

The default path builds a live node and attaches the built-in Rust DataTester without
connecting to AX Exchange. Pass --run to start Sandbox subscriptions.

"""

from __future__ import annotations

import argparse

from vibe_trader.adapters.architect_ax import AX
from vibe_trader.adapters.architect_ax import AxDataClientConfig
from vibe_trader.adapters.architect_ax import AxDataClientFactory
from vibe_trader.adapters.architect_ax import AxEnvironment
from vibe_trader.common import Environment
from vibe_trader.live import LiveNode
from vibe_trader.model import BarType
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig


def main() -> None:
    args = parse_args()
    instrument_id = InstrumentId.from_str(args.instrument)

    builder = (
        LiveNode.builder(
            "AX-DATA-TESTER-001",
            TraderId.from_str(args.trader_id),
            Environment.LIVE,
        )
        .with_delay_post_stop_secs(5)
        .add_data_client(
            None,
            AxDataClientFactory(),
            AxDataClientConfig(environment=AxEnvironment.SANDBOX),
        )
    )

    node = builder.build()
    node.add_builtin_actor(
        "DataTester",
        DataTesterConfig(
            client_id=ClientId.from_str(AX),
            instrument_ids=[instrument_id],
            bar_types=[BarType.from_str(f"{args.instrument}-1-MINUTE-LAST-EXTERNAL")],
            subscribe_book_deltas=True,
            subscribe_quotes=True,
            subscribe_trades=True,
            subscribe_mark_prices=True,
            subscribe_funding_rates=True,
            subscribe_bars=True,
            subscribe_instrument_status=True,
            request_instruments=True,
            request_trades=True,
            request_bars=True,
            request_book_snapshot=True,
            request_funding_rates=True,
            manage_book=True,
            log_data=True,
            stats_interval_secs=0,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built Architect AX data tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build or run the Architect AX Python data tester.",
    )
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--instrument", default=f"XAG-PERP.{AX}")
    parser.add_argument("--run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
