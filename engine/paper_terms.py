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

from engine import klines
from engine.config import terms_changed

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
