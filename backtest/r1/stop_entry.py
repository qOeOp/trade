"""Build a native STOP_MARKET OTO parent from a Nautilus bracket template."""

from __future__ import annotations

from nautilus_trader.core import UUID4
from nautilus_trader.model import ContingencyType
from nautilus_trader.model import OrderSide
from nautilus_trader.model import OrderType
from nautilus_trader.model import StopMarketOrder
from nautilus_trader.model import TimeInForce
from nautilus_trader.model import TriggerType


def with_buy_stop_parent(orders, instrument_id, quantity, trigger, expire_time: int, ts_init: int):
    """Retain the factory's native OTO/OCO children and generated order IDs."""
    if (
        len(orders) != 3
        or orders[0].order_type != OrderType.LIMIT
        or orders[1].order_type != OrderType.STOP_MARKET
        or orders[2].order_type != OrderType.LIMIT
    ):
        raise RuntimeError("native buy-stop bracket child layout changed")
    old_parent = orders[0]
    orders[0] = StopMarketOrder(
        old_parent.trader_id,
        old_parent.strategy_id,
        instrument_id,
        old_parent.client_order_id,
        OrderSide.BUY,
        quantity,
        trigger,
        TriggerType.DEFAULT,
        TimeInForce.GTD,
        False,
        False,
        UUID4(),
        ts_init,
        expire_time=expire_time,
        contingency_type=ContingencyType.OTO,
        order_list_id=old_parent.order_list_id,
        linked_order_ids=[orders[2].client_order_id, orders[1].client_order_id],
        tags=["ENTRY"],
    )
    return orders
