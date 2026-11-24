"""Paper's TERMS_CHANGED: the contract's terms (engine.config.TERMS_COMPARED) against the market's at the run's market
day, on the instrument the loader gave at start and on Binance's terms read for each entry, as Live admits each entry
(engine.live_venue.require_admission): rc7 does not reload a loaded instrument mid-run (C-172).

As Live's account observation, an entry's read runs off the node's thread: the entry waits in QUEUE, unsent, while
bars, timers and reduce-only orders go on, and the recorder's tick (`release`) sends it, or refuses it, once its read is
done, entries in the order they came. An entry its source cancels while it waits is never sent: once its read is
done it ends as CANCELED (engine.unsent), after the source's callback as a venue's answer would come."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from nautilus_trader.model import ExecAlgorithmId, OrderSide, StrategyId
from nautilus_trader.trading import ExecutionAlgorithm, ExecutionAlgorithmConfig, Strategy

from engine import klines, unsent
from engine.config import terms_changed
from engine.order_rules import native_cache
from engine.strategy import source_config

ENTRY_GATE = ExecAlgorithmId("PAPER-GATE")  # ends an entry its source cancelled while it waited (engine.unsent)
CANCELLER_ID = StrategyId("PAPER-unsent")  # its order ID tag is no contract's (lower case)
CANCELLER: Strategy | None = None  # the run's strategy that gives those commands and no other

# rc7's Binance loader gives every USD-M perpetual these margin rates (probe 2026-11-11; upstream
# nautechsystems/nautilus_trader#5531, open); neither the Sandbox's config nor rc7's Python cache can replace
# them. Nautilus locks notional x rate / leverage, Binance notional / leverage:
# the Sandbox's leverage is --leverage x this rate, and a loaded contract with other rates stops the run
# (TERMS_CHANGED; docs/plans/r1-2d-leverage-terms-20261111.zh.md).
LOADER_MARGIN = Decimal("0.1")


def loaded(market: dict, instrument) -> list[str]:
    """The differences of the loaded instrument (None: the loader gave none) from the market's terms and the rates its
    leverage is set from."""
    if instrument is None:
        return ["the loader gave no instrument"]
    changed = terms_changed(market, {
        "price_increment": instrument.price_increment, "size_increment": instrument.size_increment,
        "min_notional": instrument.min_notional.as_decimal() if instrument.min_notional else None})
    return changed + [f"{name}: {rate}, leverage set from {LOADER_MARGIN}" for name, rate in
                      (("margin_init", instrument.margin_init), ("margin_maint", instrument.margin_maint))
                      if Decimal(str(rate)) != LOADER_MARGIN]


def entry(market_terms: dict, instrument_id: str, proxy_url: str | None) -> list[str]:
    """The differences of Binance's terms of the contract now (engine.klines.terms) from the market's (`market_terms`,
    by symbol); terms Binance does not give are one too."""
    try:
        return terms_changed(market_terms[klines.symbol(instrument_id)], klines.terms(instrument_id, proxy_url))
    except Exception as exc:  # the network, or an answer without the contract's filters
        return [f"Binance's terms were not read ({type(exc).__name__}: {exc})"]


@dataclass
class Entry:
    instrument_id: str
    order: Any
    send: Callable[[], Any]  # the order rules' submit, bound to the order
    end: Callable[[], Any]  # the native cancel of the unsent order (engine.unsent), bound to the order
    canceled: bool = False  # the source cancelled it while it waited
    changed: list[str] | None = None  # the read's differences once it is done
    thread: threading.Thread = field(init=False)


QUEUE: list[Entry] = []


def queue(read: Callable[[str], list[str]], instrument_id: str, order, send: Callable[[], Any],
          end: Callable[[], Any]) -> None:
    """Queue an entry and start its read (`read`: `entry` with the market's terms bound; it never raises)."""
    item = Entry(instrument_id, order, send, end)

    def work():
        item.changed = read(instrument_id)
    item.thread = threading.Thread(target=work, name=f"terms-{order.client_order_id}", daemon=True)
    QUEUE.append(item)
    item.thread.start()


def cancel(instrument_id: str, match: Callable[[Any], bool]) -> set:
    """The source of `instrument_id` cancels its waiting entries whose order matches; their client order IDs."""
    found = [item for item in QUEUE if item.instrument_id == instrument_id and match(item.order)]
    for item in found:
        item.canceled = True
    return {item.order.client_order_id for item in found}


def release(record: Callable[..., None], stop: Callable[[str], None], *, stopping: bool, final: bool = False) -> None:
    """On the node's thread, the queued entries whose read is done (every one when `final`), in order: on other terms
    the entry is refused and the run stops (TERMS_CHANGED); while the run is stopping it is not sent; else it is sent.
    One its source cancelled is ended natively instead of either."""
    while QUEUE and (final or not QUEUE[0].thread.is_alive()):
        item = QUEUE.pop(0)
        fields = {"instrument_id": item.instrument_id, "client_order_id": str(item.order.client_order_id)}
        if item.changed:
            record("refusal", code="TERMS_CHANGED", changed=item.changed, **fields)
            stop("TERMS_CHANGED")
            stopping = True
        if item.canceled:
            item.end()
        elif item.changed:
            pass  # refused
        elif stopping or item.changed is None:
            record("entry_not_sent", reason="the run is stopping", **fields)
        else:
            item.send()


def add_gate(node) -> None:
    """What ends a cancelled entry natively (engine.unsent), on the run's node."""
    global CANCELLER
    CANCELLER = Strategy(source_config(CANCELLER_ID))  # type: ignore[call-arg]
    node.add_strategy(CANCELLER)
    node.add_exec_algorithm(ExecutionAlgorithm(ExecutionAlgorithmConfig(exec_algorithm_id=ENTRY_GATE)))


class Waiting:
    """The source's cancels reach its entries that wait in QUEUE, which the native cache does not hold; before the order
    rules (OrderRules comes after this class)."""

    _paper_instrument_id: str
    _paper_entry_terms: Any
    _orders_allowed: Any

    def _wait(self, order, send, end) -> None:
        queue(self._paper_entry_terms, self._paper_instrument_id, order, send, end)

    def _end_waiting(self, order, position_id, client_id, params) -> None:
        """End a cancelled entry. An unsent order keeps the order rules too, as in a replay, which checks it before
        its cancel."""
        if native_cache(self).order(order.client_order_id) is not None:  # an order the source submitted before
            super().cancel_order(order.client_order_id, None, None)  # type: ignore[misc]
        elif self._orders_allowed(order, position_id, client_id, params):
            assert CANCELLER is not None  # add_gate's
            unsent.cancel(CANCELLER, order, ENTRY_GATE)

    def cancel_order(self, client_order_id, client_id=None, params=None):
        if not params and cancel(self._paper_instrument_id, lambda order: order.client_order_id == client_order_id):
            return None
        return super().cancel_order(client_order_id, client_id, params)  # type: ignore[misc]

    def cancel_orders(self, client_order_ids, client_id=None, params=None):
        ids = list(client_order_ids)
        if not params:
            waiting = cancel(self._paper_instrument_id, lambda order: order.client_order_id in ids)
            ids = [identity for identity in ids if identity not in waiting]
            if waiting and not ids:
                return None
        return super().cancel_orders(ids, client_id, params)  # type: ignore[misc]

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        if strategy_only and not params and str(instrument_id) == self._paper_instrument_id:
            cancel(self._paper_instrument_id,
                   lambda order: order_side in (None, OrderSide.NO_ORDER_SIDE, order.side))
        return super().cancel_all_orders(instrument_id, order_side, client_id, strategy_only,  # type: ignore[misc]
                                         params)
