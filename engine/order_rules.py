"""Order rules, one set for replay, Paper and Live (docs/plans/r1-runtime-contract-20261110.zh.md, 7.1).

OrderRules wraps the source's native order commands. A command that breaks a rule is not sent: the runner's
`_runner_breach` records it (replay and Paper refuse the run once the current chunk or tick ends) or raises (Live).

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
5. An order is one Nautilus's Binance USD-M client sends (LIVE_TYPES, LIVE_TIME_IN_FORCE, a trailing offset in basis
   points; a post-only order is not GTD), with the default trigger (a MARK_PRICE, LAST_PRICE or other trigger is
   matched on the bar's price in replay and Paper and on another price at Binance). A GTD order is a LIMIT,
   STOP_LIMIT or LIMIT_IF_TOUCHED order (GTD_TYPES), expires on a whole second (Binance keeps an expiry to the
   second and the client denies a fraction of one) and expires at least GTD_LEAD_NS after the strategy submits it,
   by the strategy's clock: Binance's GTD_MINIMUM_NS, which the client requires strictly at its own send time, plus
   SEND_MARGIN_NS, which Live leaves for an entry's account check (engine.live_connection.require_send_time). The
   client's denials are in crates/adapters/binance/src/futures/execution.rs (validate_order,
   determine_futures_order_lifetime), http/client.rs (order_type_to_binance_futures) and common/enums.rs
   (BinanceTimeInForce) of the pinned version. Decided under the user's delegation (2026-11-21;
   docs/plans/order-rules-live-shapes-20261121.zh.md).
6. A strategy cancels and closes only its own orders and positions.
7. An order is on the strategy instance's own contract (CONTRACTS): instances of one source coordinate legs on several
   contracts through state the source shares between them, each ordering on its own (user, 2026-11-13;
   docs/plans/cross-line-fusion-20261111.zh.md, 5.1).
8. No order, close or market exit before the strategy's warm-up has ended and the runner has called its on_start
   (WARMING).

The source cannot name submit_order_list, bracket, add_exec_algorithm or close_all_positions at all
(engine.load.FORBIDDEN_ORDER_APIS).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any
from collections.abc import Callable

from nautilus_trader.model import (
    ClientId, Currency, OrderType, Price, TimeInForce, TrailingOffsetType, TriggerType, Venue,
)
from nautilus_trader.trading import Strategy

from engine.protection import STOP_TYPES, orders_of

CODE = "ORDER_RULE"
ENTRY_EQUITY_MULTIPLE = 3  # user, 2026-11-09 (multiple) and 2026-11-10 (of equity, not a fixed USDT cap)
ENTRY_TYPES = frozenset({OrderType.LIMIT, OrderType.STOP_MARKET})  # user, 2026-11-10 ("Also allow stop entries")
GTD_MINIMUM_NS = 600_000_000_000  # Binance's: an expiry strictly later than this after the client's send time
SEND_MARGIN_NS = 5_000_000_000  # Live sends a GTD entry only with GTD_MINIMUM_NS plus this left
GTD_LEAD_NS = GTD_MINIMUM_NS + SEND_MARGIN_NS
# What the pinned Nautilus sends to Binance USD-M (rule 5); another is OrderDenied before it reaches the venue.
LIVE_TYPES = frozenset({OrderType.MARKET, OrderType.LIMIT, OrderType.STOP_MARKET, OrderType.STOP_LIMIT,
                        OrderType.MARKET_IF_TOUCHED, OrderType.LIMIT_IF_TOUCHED, OrderType.TRAILING_STOP_MARKET})
LIVE_TIME_IN_FORCE = frozenset({TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK, TimeInForce.GTD})
GTD_TYPES = frozenset({OrderType.LIMIT, OrderType.STOP_LIMIT, OrderType.LIMIT_IF_TOUCHED})
TRIGGERS = frozenset({None, TriggerType.NO_TRIGGER, TriggerType.DEFAULT})
TRAILING_OFFSETS = frozenset({None, TrailingOffsetType.NO_TRAILING_OFFSET, TrailingOffsetType.BASIS_POINTS})
VENUE = "BINANCE"
WARMING: set[str] = set()  # the strategy IDs whose warm-up has not ended (engine.run)
CONTRACTS: dict[str, Any] = {}  # strategy ID -> its instance's own InstrumentId (engine.history.Warming._warming_setup)

MARKET_EXIT_TAG = "MARKET_EXIT"  # the native exit's own orders: rc7 does not deny an order that carries it
MARKET_EXIT_DENIAL = "MARKET_EXIT_IN_PROGRESS"  # Nautilus's reason for an entry it denies during a market exit


def native_cache(source):
    """The native cache of `source`, past the source's own read-only `cache` (engine.strategy)."""
    return Strategy.cache.__get__(source, type(source))


def _strategy_id(source):
    return Strategy.strategy_id.__get__(source, type(source))


def denied_exiting(source, order) -> bool:
    """Nautilus denies the entry `order`: the source's market exit runs. The native flag, past a name of the source's
    own."""
    return Strategy.is_exiting(source) and MARKET_EXIT_TAG not in (order.tags or ())


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
    if CONTRACTS.get(str(order.strategy_id)) != order.instrument_id:
        return "an order is on its strategy instance's own contract"
    if order.order_type not in LIVE_TYPES:
        return f"Live cannot send a {order.order_type.name} order"
    if order.time_in_force not in LIVE_TIME_IN_FORCE:
        return f"Live cannot send a {order.time_in_force.name} order"
    if getattr(order, "trailing_offset_type", None) not in TRAILING_OFFSETS:
        return "a trailing offset is in basis points: Live cannot send another"
    if getattr(order, "trigger_type", None) not in TRIGGERS:
        return "an order triggers on the default price: replay and Paper match any other on the bar's price"
    clock = Strategy.clock.__get__(source, type(source))
    if order.time_in_force == TimeInForce.GTD:
        if order.order_type not in GTD_TYPES:
            return ("a GTD order is a LIMIT, STOP_LIMIT or LIMIT_IF_TOUCHED order: Live cannot send a GTD "
                    f"{order.order_type.name} order")
        if order.is_post_only:  # only the GTD_TYPES have the attribute
            return "a GTD order is not post-only: Live cannot send one"
        # expire_time: nanoseconds on every order type (expire_time_ns exists on LimitOrder alone); never absent on GTD
        if order.expire_time % 1_000_000_000:
            return "a GTD order expires on a whole second: Live cannot send a fraction of one"
        if order.expire_time - clock.timestamp_ns() < GTD_LEAD_NS:
            return "a GTD order expires at least 605 seconds after it is submitted"
    cache = native_cache(source)
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
    """The unfilled quantity of the open reduce-only stop orders of one position (engine.protection.orders_of), other
    than `order`."""
    return sum((found.leaves_qty.as_decimal() for found in orders_of(cache, position_id)
                if not found.is_closed and found.is_reduce_only and found.order_type.name in STOP_TYPES
                and (order is None or found.client_order_id != order.client_order_id)), Decimal(0))


def unclosed(cache, scope) -> list:
    """The orders in `scope` that are not closed. Every Cache.orders(**scope) call builds each order the run ever
    sent, so checking each entry against it made a replay's time grow with the square of its orders (doctor
    20261121-02). The open, in-flight and emulated indexes hold every unclosed order except one still INITIALIZED
    (queued to the risk engine). The unfiltered counts are the index sizes, so comparing them with those indexes
    costs no scan of the closed orders; when they show such an order, the IDs in `scope` without the closed ones."""
    every = {*cache.client_order_ids_open(), *cache.client_order_ids_inflight(), *cache.client_order_ids_emulated()}
    if len(every) == cache.orders_total_count() - cache.orders_closed_count():
        ids = {*cache.client_order_ids_open(**scope), *cache.client_order_ids_inflight(**scope),
               *cache.client_order_ids_emulated(**scope)}
    else:
        ids = set(cache.client_order_ids(**scope)) - set(cache.client_order_ids_closed(**scope))
    return [cache.order(identity) for identity in ids]


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
    values += [instrument.notional_value(found.leaves_qty, entry_price(found)) for found in unclosed(cache, scope)
               if not found.is_reduce_only and found.client_order_id != order.client_order_id]
    values.append(instrument.notional_value(order.quantity, entry_price(order)))
    if any(str(value.currency) != "USDT" for value in values):
        return None
    return sum((value.as_decimal() for value in values), Decimal(0))


class OrderRules:
    """The rules around the native order commands; `_runner_breach(code, text)` is the runner's."""

    _runner_breach: Callable[[str, str], Any]  # engine.strategy.Subscriptions records; Live raises

    def _runner_rule(self, text: str):
        return self._runner_breach(CODE, f"{_strategy_id(self)}: {text}")

    def _runner_orders_allowed(self, order, position_id=None, client_id=None, params=None) -> bool:
        """True when `order` keeps the rules; otherwise the breach is reported (and raised, in Live)."""
        found = violation(self, order, position_id, client_id, params)
        if found is None:
            return True
        self._runner_rule(f"{order.client_order_id}: {found}")
        return False

    def submit_order(self, order, position_id=None, client_id=None, params=None):
        if self._runner_orders_allowed(order, position_id, client_id, params):
            return super().submit_order(order, position_id=position_id, client_id=client_id,  # type: ignore[misc]
                                        params=params)
        return None

    def submit_order_list(self, *args, **kwargs):
        return self._runner_rule("order lists are not sent")

    def modify_order(self, *args, **kwargs):
        return self._runner_rule("orders are not modified")

    def modify_orders(self, *args, **kwargs):
        return self._runner_rule("orders are not modified")

    def _runner_foreign(self, client_order_ids) -> list:
        """The IDs of known orders of another strategy (native cancellation ignores an unknown one)."""
        cache = native_cache(self)
        return [str(identity) for identity in client_order_ids
                if (found := cache.order(identity)) is not None and found.strategy_id != _strategy_id(self)]

    def cancel_order(self, client_order_id, client_id=None, params=None):
        if params or self._runner_foreign([client_order_id]):
            return self._runner_rule(f"{client_order_id}: a strategy cancels only its own orders, without parameters")
        return super().cancel_order(client_order_id, client_id, params)  # type: ignore[misc]

    def cancel_orders(self, client_order_ids, client_id=None, params=None):
        ids = list(client_order_ids)
        if params or self._runner_foreign(ids):
            return self._runner_rule("a strategy cancels only its own orders, without parameters")
        return super().cancel_orders(ids, client_id, params)  # type: ignore[misc]

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        if not strategy_only or params:
            return self._runner_rule("a strategy cancels only its own orders, without parameters")
        return super().cancel_all_orders(instrument_id, order_side, client_id, True, params)  # type: ignore[misc]

    def close_position(self, position, client_id=None, tags=None, time_in_force=None, reduce_only=None,
                       quote_quantity=None, params=None):
        # Native close_position sends its MARKET order past submit_order (rules 5 and 8); a GTD one panics natively.
        if str(_strategy_id(self)) in WARMING:
            return self._runner_rule("no close before the warm-up has ended and on_start has run")
        if (position is None or not position.is_open or position.strategy_id != _strategy_id(self)
                or reduce_only is False or quote_quantity or params or client_id not in (None, ClientId(VENUE))):
            return self._runner_rule("a strategy closes only its own open position, by a base-quantity reduction")
        if time_in_force not in (None, TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK):
            return self._runner_rule(f"Live cannot send a {time_in_force.name} MARKET order")
        return super().close_position(position, client_id, tags, time_in_force, True, False)  # type: ignore[misc]

    def market_exit(self):
        # The native exit sends its MARKET closes past submit_order and closes again every 100 ms (rule 8).
        if str(_strategy_id(self)) in WARMING:
            return self._runner_rule("no market exit before the warm-up has ended and on_start has run")
        return super().market_exit()  # type: ignore[misc]

    def close_all_positions(self, *args, **kwargs):
        return self._runner_rule("positions are closed one at a time")
