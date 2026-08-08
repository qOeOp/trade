#!/usr/bin/env python3
"""
Sandbox Python execution tester example.

The default path builds a sandbox node and attaches the native Rust ExecTester without
submitting orders. Pass --run to start the node. Pass --live-orders only when you intend
to exercise the simulated matching engine.

"""

from __future__ import annotations

import argparse
from decimal import Decimal

from vibe_trader.adapters.sandbox import SandboxExecutionClientConfig
from vibe_trader.adapters.sandbox import SandboxExecutionClientFactory
from vibe_trader.common import Environment
from vibe_trader.config import LiveRiskEngineConfig
from vibe_trader.live import LiveNode
from vibe_trader.model import AccountId
from vibe_trader.model import ClientId
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Money
from vibe_trader.model import Quantity
from vibe_trader.model import StrategyId
from vibe_trader.model import TimeInForce
from vibe_trader.model import TraderId
from vibe_trader.model import Venue
from vibe_trader.testkit import ExecTesterConfig


SANDBOX = "SANDBOX"


def main() -> None:
    args = parse_args()
    trader_id = TraderId.from_str(args.trader_id)
    account_id = AccountId.from_str(args.account_id)
    venue = Venue.from_str(args.venue)
    instrument_id = InstrumentId.from_str(args.instrument)
    order_qty = Quantity.from_str(args.quantity)

    builder = (
        LiveNode.builder("SANDBOX-EXEC-TESTER-001", trader_id, Environment.SANDBOX)
        .with_reconciliation(False)
        .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
        .add_simulated_exec_client(
            None,
            SandboxExecutionClientFactory(),
            SandboxExecutionClientConfig(
                venue=venue,
                starting_balances=[
                    Money(float(args.starting_balance), Currency.from_str(args.currency)),
                ],
                trader_id=trader_id,
                account_id=account_id,
            ),
        )
    )

    node = builder.build()
    node.add_builtin_strategy(
        "ExecTester",
        ExecTesterConfig(
            strategy_id=StrategyId.from_str("EXEC_TESTER-001"),
            instrument_id=instrument_id,
            client_id=ClientId.from_str(args.venue),
            external_order_claims=[instrument_id],
            order_qty=order_qty,
            subscribe_book=True,
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
        print("Built Sandbox exec tester node. Pass --run to start the node.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build or run the Sandbox Python exec tester.")
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--account-id", default="SANDBOX-001")
    parser.add_argument("--venue", default=SANDBOX)
    parser.add_argument("--instrument", default=f"BTCUSDT.{SANDBOX}")
    parser.add_argument("--quantity", default="0.01")
    parser.add_argument("--currency", default="USD")
    parser.add_argument("--starting-balance", default="100000")
    parser.add_argument("--tob-offset-ticks", type=int, default=500)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--live-orders", action="store_true")
    parser.add_argument("--limit-sells", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
