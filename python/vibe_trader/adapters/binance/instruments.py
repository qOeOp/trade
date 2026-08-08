import asyncio

from vibe_trader._libvibe.binance import BinanceDataClientConfig
from vibe_trader._libvibe.binance import _load_binance_instruments


async def load_binance_instruments(config: BinanceDataClientConfig) -> list[object]:
    """
    Load the configured Binance instrument catalogue.

    This is the Python v2 replacement for constructing a cached low-level HTTP client and a
    product-specific v1 instrument provider. The embedded ``instrument_provider`` config controls
    selection, filters, parser warnings, and commission queries.

    """
    return await asyncio.to_thread(_load_binance_instruments, config)
