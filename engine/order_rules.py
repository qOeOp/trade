"""Order rules, one set for replay, Paper and Live (docs/plans/r1-runtime-contract-20261110.zh.md, 7.1).

OrderRules wraps the source's native order commands. A command that breaks a rule is not sent: the runner's
`_breach` records it (replay and Paper refuse the run once the current chunk or tick ends) or raises (Live).

Positions are HEDGING (engine.strategy.source_config, docs/plans/cross-line-fusion-20261111.zh.md, 4): each entry
order opens its own position, so a strategy may hold several long and short positions and pending entries on one
contract at once (user, 2026-11-11).

1. An entry (not reduce-only) is a base-quantity LIMIT or STOP_MARKET order (ENTRY_TYPES; a market entry is a
   marketable limit).
2. The strategy's exposure on the contract (exposure: its open positions at their average open price, its open entries
   at their limit or trigger price, both sides added, plus this entry) is at most ENTRY_EQUITY_MULTIPLE times the
   account's USDT equity (native portfolio equity: balance and unrealized PnL).
3. An exit is reduce-only, names its position, and fits that open position of the strategy in side and quantity; the
   working stops of one position hold at most its quantity, so stops summed per side cover each position exactly
   when they cover the side (engine.audit).
4. No modifications, order lists, emulated triggers, execution algorithms, contingent or linked orders, quote
   quantities or order parameters, and only the venue's own client.
5. A GTD order expires at least GTD_MINIMUM_NS after it is sent (Binance's limit).
6. A strategy cancels and closes only its own orders and positions.
7. No order before the strategy's warm-up has ended and the runner has called its on_start (WARMING).

The source cannot name submit_order_list, bracket, add_exec_algorithm or close_all_positions at all
(engine.load.FORBIDDEN_ORDER_APIS).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable

from nautilus_trader.model import ClientId, Currency, OrderType, Price, TimeInForce, Venue
from nautilus_trader.trading import Strategy

from engine.protection import STOP_TYPES

CODE = "ORDER_RULE"
ENTRY_EQUITY_MULTIPLE = 3  # user, 2026-11-09 (multiple) and 2026-11-10 (of equity, not a fixed USDT cap)
ENTRY_TYPES = frozenset({OrderType.LIMIT, OrderType.STOP_MARKET})  # user, 2026-11-10 ("Also allow stop entries")
GTD_MINIMUM_NS = 600_000_000_000
VENUE = "BINANCE"
WARMING: set[str] = set()  # the strategy IDs whose warm-up has not ended (engine.run)


def _cache(source):
    return Strategy.cache.__get__(source, type(source))


def _strategy_id(source):
    return Strategy.strategy_id.__get__(source, type(source))


def usdt_equity(source) -> Decimal | None:
    """The account's USDT equity in the native portfolio, or None when it is not known."""
    found = Strategy.portfolio.__get__(source, type(source)).equity(Venue(VENUE))
    value = (found or {}).get(Currency.from_str("USDT"))
    return value.as_decimal() if value is not None else None


def entry_price(order):
    """The price an entry is valued at: a stop entry's trigger, otherwise its limit."""
    return order.trigger_price if order.order_type == OrderType.STOP_MARKET else order.price


def violation(source, order, position_id=None, client_id=None, params=None) -> str | None:
    """Why `order` breaks a rule, or None."""
    if str(order.strategy_id) in WARMING:
        return "no order before the warm-up has ended and on_start has run"
    if (order.emulation_trigger is not None or order.contingency_type is not None or order.order_list_id is not None
            or order.parent_order_id is not None or order.linked_order_ids or order.exec_algorithm_id is not None
            or order.is_quote_quantity or params):
        return "only independent base-quantity orders without parameters"
    if client_id not in (None, ClientId(VENUE)):
        return f"orders go through the {VENUE} client"
    if order.strategy_id != _strategy_id(source):
        return "an order carries its own strategy's identity"
    clock = Strategy.clock.__get__(source, type(source))
    if order.time_in_force == TimeInForce.GTD and order.expire_time_ns - clock.timestamp_ns() < GTD_MINIMUM_NS:
        return "a GTD order expires at least 600 seconds after it is sent"
    cache = _cache(source)
    if order.is_reduce_only:
        position = cache.position(position_id) if position_id is not None else None
        if (position is None or not position.is_open or position.strategy_id != order.strategy_id
                or position.instrument_id != order.instrument_id):
            return "an exit names its strategy's open position on the contract"
        if not order.would_reduce_only(position.side, position.quantity):
            return "an exit fits its position's side and quantity"
        if order.order_type.name in STOP_TYPES and stops_held(cache, position.id, order) + \
                order.quantity.as_decimal() > position.quantity.as_decimal():
            return "the working stops of one position hold at most its quantity"
        return None
    if order.order_type not in ENTRY_TYPES:
        return "an entry is a LIMIT or STOP_MARKET order"
    if position_id is not None:
        return "an entry opens a position; it names none"
    equity = usdt_equity(source)
    found = exposure(cache, order) if equity is not None else None
    if equity is None or found is None:
        return "an entry is valued against the native instrument and USDT equity"
    if found > ENTRY_EQUITY_MULTIPLE * equity:
        return (f"the strategy's exposure on the contract with this entry is at most {ENTRY_EQUITY_MULTIPLE} times "
                "USDT equity")
    return None


def stops_held(cache, position_id, order=None) -> Decimal:
    """The unfilled quantity of the open reduce-only stop orders of one position (Cache.orders_for_position), other
    than `order`."""
    return sum((found.leaves_qty.as_decimal() for found in cache.orders_for_position(position_id)
                if not found.is_closed and found.is_reduce_only and found.order_type.name in STOP_TYPES
                and (order is None or found.client_order_id != order.client_order_id)), Decimal(0))


def exposure(cache, order) -> Decimal | None:
    """Rule 2's exposure in USDT for the entry `order`: the notional value of its strategy's open positions on the
    contract at their average open price and of its other open entries at their limit or trigger price, both sides
    added, plus `order` at its limit or trigger price; None when the instrument is unknown or not USDT-settled."""
    instrument = cache.instrument(order.instrument_id)
    if instrument is None:
        return None
    scope = {"instrument_id": order.instrument_id, "strategy_id": order.strategy_id}
    values = [instrument.notional_value(position.quantity, Price(position.avg_px_open, instrument.price_precision))
              for position in cache.positions_open(**scope)]
    values += [instrument.notional_value(found.leaves_qty, entry_price(found)) for found in cache.orders(**scope)
               if not found.is_closed and not found.is_reduce_only and found.client_order_id != order.client_order_id]
    values.append(instrument.notional_value(order.quantity, entry_price(order)))
    if any(str(value.currency) != "USDT" for value in values):
        return None
    return sum((value.as_decimal() for value in values), Decimal(0))


class OrderRules:
    """The rules around the native order commands; `_breach(code, text)` is the runner's."""

    _breach: Callable[[str, str], Any]  # engine.strategy.Subscriptions records; Live raises

    def _order_rule(self, text: str):
        return self._breach(CODE, f"{_strategy_id(self)}: {text}")

    def _orders_allowed(self, order, position_id=None, client_id=None, params=None) -> bool:
        """True when `order` keeps the rules; otherwise the breach is reported (and raised, in Live)."""
        found = violation(self, order, position_id, client_id, params)
        if found is None:
            return True
        self._order_rule(f"{order.client_order_id}: {found}")
        return False

    def submit_order(self, order, position_id=None, client_id=None, params=None):
        if self._orders_allowed(order, position_id, client_id, params):
            return super().submit_order(order, position_id=position_id, client_id=client_id,  # type: ignore[misc]
                                        params=params)
        return None

    def submit_order_list(self, *args, **kwargs):
        return self._order_rule("order lists are not sent")

    def modify_order(self, *args, **kwargs):
        return self._order_rule("orders are not modified")

    def modify_orders(self, *args, **kwargs):
        return self._order_rule("orders are not modified")

    def _foreign(self, client_order_ids) -> list:
        """The IDs of known orders of another strategy (native cancellation ignores an unknown one)."""
        cache = _cache(self)
        return [str(identity) for identity in client_order_ids
                if (found := cache.order(identity)) is not None and found.strategy_id != _strategy_id(self)]

    def cancel_order(self, client_order_id, client_id=None, params=None):
        if params or self._foreign([client_order_id]):
            return self._order_rule(f"{client_order_id}: a strategy cancels only its own orders, without parameters")
        return super().cancel_order(client_order_id, client_id, params)  # type: ignore[misc]

    def cancel_orders(self, client_order_ids, client_id=None, params=None):
        ids = list(client_order_ids)
        if params or self._foreign(ids):
            return self._order_rule("a strategy cancels only its own orders, without parameters")
        return super().cancel_orders(ids, client_id, params)  # type: ignore[misc]

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        if not strategy_only or params:
            return self._order_rule("a strategy cancels only its own orders, without parameters")
        return super().cancel_all_orders(instrument_id, order_side, client_id, True, params)  # type: ignore[misc]

    def close_position(self, position, client_id=None, tags=None, time_in_force=None, reduce_only=None,
                       quote_quantity=None, params=None):
        if (position is None or not position.is_open or position.strategy_id != _strategy_id(self)
                or reduce_only is False or quote_quantity or params or client_id not in (None, ClientId(VENUE))):
            return self._order_rule("a strategy closes only its own open position, by a base-quantity reduction")
        return super().close_position(position, client_id, tags, time_in_force, True, False)  # type: ignore[misc]

    def close_all_positions(self, *args, **kwargs):
        return self._order_rule("positions are closed one at a time")
