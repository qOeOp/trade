"""Paper's TERMS_CHANGED: the contract's terms (engine.config.TERMS_COMPARED) against the market's at the run's market
day, on the instrument the loader gave at start and on Binance's terms read for each entry, as Live admits each entry
(engine.live_venue.require_admission): rc7 does not reload a loaded instrument mid-run (C-172)."""

from __future__ import annotations

from decimal import Decimal

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
