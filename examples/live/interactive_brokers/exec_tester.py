#!/usr/bin/env python3
"""
Interactive Brokers Python execution tester example.

The default path builds a live node and attaches the native Rust ExecTester without
connecting to TWS or IB Gateway. Pass --run to connect. Pass --live-orders only when the
account is funded and you intend to test live order flow.

"""

from __future__ import annotations

import argparse
from decimal import Decimal

from vibe_trader.adapters.interactive_brokers import InteractiveBrokersDataClientConfig
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersDataClientFactory
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersExecClientConfig
from vibe_trader.adapters.interactive_brokers import InteractiveBrokersExecutionClientFactory
from vibe_trader.adapters.interactive_brokers import MarketDataType
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


IB = "IB"


def main() -> None:
    args = parse_args()
    trader_id = TraderId.from_str(args.trader_id)
    account_id = AccountId.from_str(args.account_id)
    instrument_id = InstrumentId.from_str(args.instrument)
    order_qty = Quantity.from_str(args.quantity)

    builder = (
        LiveNode.builder("IB-EXEC-TESTER-001", trader_id, Environment.LIVE)
        .with_reconciliation(args.run)
        .with_risk_engine_config(LiveRiskEngineConfig(bypass=True))
        .add_data_client(
            None,
            InteractiveBrokersDataClientFactory(),
            InteractiveBrokersDataClientConfig(
                host=args.host,
                port=args.port,
                client_id=args.client_id,
                market_data_type=MarketDataType.DELAYED,
            ),
        )
        .add_exec_client(
            None,
            InteractiveBrokersExecutionClientFactory(trader_id, account_id),
            InteractiveBrokersExecClientConfig(
                host=args.host,
                port=args.port,
                client_id=args.client_id,
                account_id=args.ib_account_id,
            ),
        )
    )

    node = builder.build()
    node.add_builtin_strategy(
        "ExecTester",
        ExecTesterConfig(
            strategy_id=StrategyId.from_str("EXEC_TESTER-001"),
            instrument_id=instrument_id,
            client_id=ClientId.from_str(IB),
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
        print("Built Interactive Brokers exec tester node. Pass --run to connect.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build or run the Interactive Brokers Python exec tester.",
    )
    parser.add_argument("--trader-id", default="TESTER-001")
    parser.add_argument("--account-id", default="IB-001")
    parser.add_argument("--ib-account-id", default="U1234567")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7497)
    parser.add_argument("--client-id", type=int, default=101)
    parser.add_argument("--instrument", default="AAPL=STK.SMART")
    parser.add_argument("--quantity", default="1")
    parser.add_argument("--tob-offset-ticks", type=int, default=500)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--live-orders", action="store_true")
    parser.add_argument("--limit-sells", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    main()
