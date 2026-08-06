#!/usr/bin/env python3
"""
DYdX Python execution tester example.

The default path builds a live node and attaches the native Rust ExecTester without
connecting to dYdX or submitting orders. Pass --run to connect. Pass --live-orders only
when the account is funded and you intend to test live order flow.

"""

from __future__ import annotations

import argparse
from decimal import Decimal

from vibe_trader.adapters.dydx import DydxDataClientConfig
from vibe_trader.adapters.dydx import DydxDataClientFactory
from vibe_trader.adapters.dydx import DydxExecClientConfig
from vibe_trader.adapters.dydx import DydxExecutionClientFactory
from vibe_trader.adapters.dydx import DydxNetwork
from vibe_trader.common import Environment
from vibe_trader.config import LiveRiskEngineConfig
from vibe_trader.live import LiveNode
from vibe_trader.model import AccountId
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId
from vibe_trader.model import Quantity
from vibe_trader.model import StrategyId
from vibe_trader.model import TimeInForce
from vibe_trader.model import TraderId
from vibe_trader.testkit import ExecTesterConfig


DYDX = "DYDX"
SMOKE_PRIVATE_KEY = "0x0000000000000000000000000000000000000000000000000000000000000001"
SMOKE_WALLET_ADDRESS = "dydx1abc123"


def main() -> None:
    args = parse_args()
    trader_id = TraderId.from_str(args.trader_id)
    account_id = AccountId.from_str(args.account_id)
    instrument_id = InstrumentId.from_str(args.instrument)
    order_qty = Quantity.from_str(args.quantity)

    builder = (
        LiveNode.builder("DYDX-EXEC-TESTER-001", trader_id, Environment.LIVE)
        .with_reconciliation(args.run)
        .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
        .add_data_client(
            None,
            DydxDataClientFactory(),
            DydxDataClientConfig(network=DydxNetwork.MAINNET),
        )
        .add_exec_client(
            None,
            DydxExecutionClientFactory(),
            DydxExecClientConfig(
                trader_id=trader_id,
                account_id=account_id,
                network=DydxNetwork.MAINNET,
                private_key=None if args.run else SMOKE_PRIVATE_KEY,
                wallet_address=None if args.run else SMOKE_WALLET_ADDRESS,
            ),
        )
    )

    node = builder.build()
    node.add_builtin_strategy(
        "ExecTester",
        ExecTesterConfig(
            strategy_id=StrategyId.from_str("EXEC_TESTER-001"),
            instrument_id=instrument_id,
            client_id=ClientId.from_str(DYDX),
            external_order_claims=[instrument_id],
            order_qty=order_qty,
            subscribe_quotes=True,
            subscribe_trades=True,
            open_position_on_start_qty=Decimal(args.quantity) if args.live_orders else None,
            open_position_on_first_quote=args.live_orders,
            open_position_time_in_force=TimeInForce.IOC,
            enable_limit_buys=args.live_orders,
            enable_limit_sells=args.live_orders and args.limit_sells,
            tob_offset_ticks=args.tob_offset_ticks,
            use_post_only=True,
            cancel_orders_on_stop=args.live_orders,
            close_positions_on_stop=args.live_orders,
            reduce_only_on_stop=False,
            dry_run=not args.live_orders,
            log_data=False,
        ),
    )

    if args.run:
        node.run()
    else:
        print("Built dYdX exec tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the dYdX Python exec tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--account-id", default="DYDX-001")
    parser.add_argument("--instrument", default=f"ETH-USD-PERP.{DYDX}")
    parser.add_argument("--quantity", default="0.001")
    parser.add_argument("--tob-offset-ticks", type=int, default=500)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--live-orders", action="store_true")
    parser.add_argument("--limit-sells", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
