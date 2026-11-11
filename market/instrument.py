"""Contract terms (`market.terms`, `market.build_instrument`).

A replay uses one terms snapshot per contract: the latest observed at the pinned market day, or the earliest
in a directory rebuilt since (`visible`, CURRENT_SNAPSHOT_APPROXIMATION). Fees and margins are not exchange facts and are not stored: the
exporter writes the assumed margins into the engine instrument and records the whole assumption in the
receipt, from which the replay takes the venue's maker and taker rates.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from market import files
from market.sources import _refuse


TERMS = ("price_increment", "size_increment", "min_quantity", "max_quantity", "min_notional", "min_price",
         "max_price")
SNAPSHOT = ("symbol", "observed_at", "terms_source", *TERMS)
QUOTE = "USDT"
# Account terms Binance does not publish per contract (uncalibrated example values).
ASSUMED = {"maker_fee": "0.0002", "taker_fee": "0.0005", "margin_init": "0.1", "margin_maint": "0.1"}
APPROXIMATION = "CURRENT_SNAPSHOT_APPROXIMATION"


def _rows(market: files.Market, market_day: str | None, symbol: str) -> list[dict]:
    return [row for batch in files.read_table(market, market_day, "instrument", [symbol]) for row in batch.to_pylist()]


def visible(market: files.Market, market_day: str, symbol: str) -> dict | None:
    """The terms row a replay of the market day trades on: the latest observed by the market day. A directory rebuilt later
    observed its terms after that market day, so a contract with bars at the market day takes its earliest row; a contract
    without bars there, not yet listed, has none."""
    found = _rows(market, market_day, symbol)
    if found:
        return max(found, key=lambda row: row["observed_at"])
    if not any(batch.num_rows for batch in files.scan(market, market_day, "bar", [symbol])):
        return None
    return min(_rows(market, None, symbol), key=lambda row: row["observed_at"], default=None)


def terms(market: files.Market, market_day: str, symbol: str) -> dict:
    """market.terms: the terms row of `symbol` at the exact market day (`visible`)."""
    found = visible(market, market_day, symbol)
    if found is None:
        raise _refuse(f"{symbol}: no terms at market day {market_day}", "NO_TERMS", missing=(symbol,))
    return {key: found[key] for key in SNAPSHOT}


def decimals(increment: str) -> int:
    return len(increment.split(".")[1]) if "." in increment else 0


def _positive(value) -> bool:
    try:
        return isinstance(value, str) and Decimal(value).is_finite() and Decimal(value) > 0
    except InvalidOperation:
        return False


def build_instrument(symbol: str, terms: dict, price_precision: int, native_id: str, *, on_grid: bool):
    """market.build_instrument: (engine CryptoPerpetual, terms record) from a terms snapshot, the price
    precision the exported data needs, the native instrument ID and whether every exported price is a whole
    multiple of the terms' price increment."""
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
    # A current tick of 0.10 shares its decimals with history on the 0.01 grid; Nautilus skips any fill
    # off the instrument's grid, so prices off the terms' grid take the finest step their precision allows
    increment = terms["price_increment"] if exchange == price_precision and on_grid else format(
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
              "price_precision": price_precision,
              "price_precision_widened": Decimal(increment) != Decimal(terms["price_increment"]),
              "assumed": dict(ASSUMED), "historical_terms": APPROXIMATION}
    return instrument, record
