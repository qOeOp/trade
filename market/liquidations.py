"""The recorded liquidation tables (market.files) as `market coverage` reads them: their names and which Bybit contracts
pair with a Binance one. Nothing writes them any more: they hold what Binance's `!forceOrder@arr` and Bybit's
`allLiquidation.{symbol}` pushed, and when each venue was watched, as recorded through 2026-11-04
(docs/plans/market-data-sources.zh.md)."""

from __future__ import annotations


TABLES = {"binance": "binance_force_order", "bybit": "bybit_all_liquidation"}
WATCH = "liquidation_watch"
SIZES = ("1000000", "10000", "1000", "1M")  # contract sizes written into a symbol, before or after its coin


def coin(base: str) -> str:
    """The coin of a contract's base, its size dropped: 1000PEPE and PEPE are PEPE, SHIB1000 is SHIB."""
    for size in SIZES:
        if len(base) > len(size) + 1 and base.startswith(size):
            return base[len(size):]
        if len(base) > len(size) + 1 and base.endswith(size):
            return base[:-len(size)]
    return base


def bybit_symbols(symbol: str, listed: list[str]) -> list[str]:
    """The Bybit contracts of a Binance one among `listed`: the same coin and settlement (Binance's USDT contracts
    are Bybit's USDT ones, its USDC contracts Bybit's PERP ones), dated contracts excluded."""
    for quote, theirs in (("USDT", "USDT"), ("USDC", "PERP")):
        if symbol.endswith(quote):
            wanted = coin(symbol[:-len(quote)])
            return sorted(item for item in listed if item.endswith(theirs) and "-" not in item
                          and coin(item[:-len(theirs)]) == wanted)
    return []
