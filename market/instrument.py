"""Contract terms (`market.terms`, `market.build_instrument`).

A replay uses one terms snapshot per contract: the latest observed at the pinned market commit
(CURRENT_SNAPSHOT_APPROXIMATION). Fees and margins are not exchange facts and are not stored: the
exporter writes the assumed margins into the engine instrument and records the whole assumption in the
receipt, from which the replay takes the venue's maker and taker rates.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from market.sources import _refuse


TERMS = ("price_increment", "size_increment", "min_quantity", "max_quantity", "min_notional", "min_price",
         "max_price")
SNAPSHOT = ("symbol", "observed_at", "terms_source", *TERMS)
QUOTE = "USDT"
# Account terms Binance does not publish per contract (uncalibrated example values).
ASSUMED = {"maker_fee": "0.0002", "taker_fee": "0.0005", "margin_init": "0.1", "margin_maint": "0.1"}
APPROXIMATION = "CURRENT_SNAPSHOT_APPROXIMATION"


def terms(conn, commit: str, symbol: str) -> dict:
    """market.terms: the latest terms row of `symbol` observed at the exact market commit."""
    found = conn.dicts(f"SELECT {', '.join(SNAPSHOT)} FROM instrument AS OF '{commit}' WHERE symbol = %s "
                       "ORDER BY observed_at DESC LIMIT 1", (symbol,))
    if not found:
        raise _refuse(f"{symbol}: no terms at market commit {commit}", "NO_TERMS", missing=(symbol,))
    return found[0]


def decimals(increment: str) -> int:
    return len(increment.split(".")[1]) if "." in increment else 0


def _positive(value) -> bool:
    try:
        return isinstance(value, str) and Decimal(value).is_finite() and Decimal(value) > 0
    except InvalidOperation:
        return False


def build_instrument(symbol: str, terms: dict, price_precision: int, native_id: str):
    """market.build_instrument: (engine CryptoPerpetual, terms record) from a terms snapshot, the price
    precision the exported data needs and the native instrument ID."""
    from nautilus_trader.model import CryptoPerpetual, Currency, InstrumentId, Money, Price, Quantity, Symbol
    if not _positive(terms.get("price_increment")) or not _positive(terms.get("size_increment")):
        raise _refuse(f"{symbol}: the increments are not positive decimal strings", "TERMS_INVALID", missing=(symbol,))
    for low, high in (("min_quantity", "max_quantity"), ("min_price", "max_price")):
        if terms.get(low) is not None and terms.get(high) is not None and Decimal(terms[low]) > Decimal(terms[high]):
            raise _refuse(f"{symbol}: {low} {terms[low]} exceeds {high} {terms[high]}", "TERMS_INVALID",
                          missing=(symbol,))
    exchange = decimals(terms["price_increment"])
    if price_precision < exchange:
        raise _refuse(f"{symbol}: price precision {price_precision} is narrower than the exchange's {exchange}",
                      "PRECISION_NARROWED", missing=(symbol,))
    if not symbol.endswith(QUOTE):
        raise _refuse(f"{symbol} does not settle in {QUOTE}", "UNSUPPORTED_QUOTE", missing=(symbol,))
    usdt = Currency.from_str(QUOTE)
    base_currency = Currency.from_str(symbol.removesuffix(QUOTE))
    increment = terms["price_increment"] if exchange == price_precision else format(
        Decimal(1).scaleb(-price_precision), "f")
    size = terms["size_increment"]

    def optional(key, kind):
        return kind(terms[key]) if terms.get(key) is not None else None
    instrument = CryptoPerpetual(
        instrument_id=InstrumentId.from_str(native_id), raw_symbol=Symbol(symbol),
        base_currency=base_currency, quote_currency=usdt, settlement_currency=usdt, is_inverse=False,
        price_precision=price_precision, size_precision=decimals(size),
        price_increment=Price.from_str(increment), size_increment=Quantity.from_str(size), ts_event=0, ts_init=0,
        multiplier=Quantity.from_str("1"), lot_size=Quantity.from_str(size),
        max_quantity=optional("max_quantity", Quantity.from_str), min_quantity=optional("min_quantity", Quantity.from_str),
        # Money takes its amount as f64: Nautilus itself calls __float__ on a Decimal
        min_notional=(Money(float(Decimal(terms["min_notional"])), usdt) if terms.get("min_notional") is not None
                      else None),
        max_price=optional("max_price", Price.from_str), min_price=optional("min_price", Price.from_str),
        margin_init=Decimal(ASSUMED["margin_init"]), margin_maint=Decimal(ASSUMED["margin_maint"]))
    record = {"terms_source": terms["terms_source"], "terms_observed_at": terms["observed_at"],
              "price_precision": price_precision, "price_precision_widened": price_precision != exchange,
              "assumed": dict(ASSUMED), "historical_terms": APPROXIMATION}
    return instrument, record
