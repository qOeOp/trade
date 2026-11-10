"""Stop-loss coverage, one judgment for the research audit, Paper and Live (docs/plans/r1-runtime-contract-20261110.zh.md, 7.2).

A position is covered when its own reduce-only stop orders (those submitted for its position ID) on its closing side,
accepted and neither triggered nor filled (native status ACCEPTED), hold at least its quantity in their unfilled
quantity. Positions are HEDGING, several to a contract (engine.order_rules); the research audit, which reads events
without a stop's position, sums positions and stops per side instead, which order rule 3 makes the same judgment. A gap
counts once it lasts longer than ALLOWANCE_NS of event time, the one execution bar a source has to place its stop.
Live adds LIVE_DETECTION_NS: a stop accepted over REST gets no WebSocket event, and native code sees it only at its
next open-order check.

The module reads plain values, so the audit can apply it to order state rebuilt from events and Paper and Live to
the native cache.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable

ALLOWANCE_NS = 60_000_000_000  # one execution bar (engine.config.EXECUTION_BAR_MINUTES)
LIVE_DETECTION_NS = 30_000_000_000  # open-order check: 5 s threshold + 10 s interval, with margin
STOP_TYPES = frozenset({"STOP_MARKET", "STOP_LIMIT", "TRAILING_STOP_MARKET", "TRAILING_STOP_LIMIT"})


@dataclass(frozen=True)
class Order:
    side: str  # BUY or SELL
    order_type: str  # native OrderType name
    reduce_only: bool
    status: str  # native OrderStatus name
    leaves: Decimal  # unfilled quantity


def native(order) -> Order:
    """A native order's coverage fields."""
    return Order(order.side.name, order.order_type.name, bool(order.is_reduce_only), order.status.name,
                 order.leaves_qty.as_decimal())


def of_position(cache, position) -> list[Order]:
    """The coverage fields of the native orders submitted for `position` (Cache.orders_for_position) on its
    contract."""
    return [native(order) for order in cache.orders_for_position(position.id)
            if order.instrument_id == position.instrument_id]


def stop_quantity(held: Decimal, orders: Iterable[Order]) -> Decimal:
    """The unfilled quantity of the resting stops that close a signed quantity `held`; `orders` are the orders that
    may close it (one position's, or in the audit one side's)."""
    if not held:
        return Decimal(0)
    closing = "SELL" if held > 0 else "BUY"
    return sum((order.leaves for order in orders
                if order.reduce_only and order.order_type in STOP_TYPES and order.side == closing
                and order.status == "ACCEPTED" and order.leaves > 0), Decimal(0))


def covered(held: Decimal, orders: Iterable[Order]) -> bool:
    return stop_quantity(held, orders) >= abs(held)


class Gaps:
    """When each uncovered position's gap began, by event time; `update` returns the keys whose gap just outlasted
    the allowance, once per gap."""

    def __init__(self, allowance_ns: int = ALLOWANCE_NS):
        self.allowance_ns = allowance_ns
        self.since: dict = {}
        self.reported: set = set()

    def update(self, now_ns: int, uncovered: Iterable) -> list:
        keys = set(uncovered)
        self.since = {key: self.since.get(key, now_ns) for key in keys}
        self.reported &= keys
        late = sorted(key for key, since in self.since.items()
                      if now_ns - since > self.allowance_ns and key not in self.reported)
        self.reported.update(late)
        return late
