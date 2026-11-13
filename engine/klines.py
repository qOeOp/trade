"""Binance's public USD-M klines as native bars: the history Paper and Live read at their start (engine.history).

No credential: ``fapi/v1/klines`` is public, as the market's archives are. A kline becomes a
``{id}-{period}-LAST-EXTERNAL`` bar stamped at its close time (its open plus the period, less 1 ms), as the market
export and a replay's history are (engine.warmup).
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from decimal import Decimal

from nautilus_trader.model import Bar, Price, Quantity

from engine import warmup

REST_BASE = "https://fapi.binance.com"
LIMIT = 1500  # Binance's most klines per request
INTERVALS = {"1-MINUTE": "1m", "3-MINUTE": "3m", "5-MINUTE": "5m", "15-MINUTE": "15m", "30-MINUTE": "30m",
             "1-HOUR": "1h", "2-HOUR": "2h", "4-HOUR": "4h", "6-HOUR": "6h", "8-HOUR": "8h", "12-HOUR": "12h",
             "1-DAY": "1d"}
NS_PER_MS = 1_000_000


def get_json(url: str, proxy_url: str | None, timeout: float = 10):
    handlers = [urllib.request.ProxyHandler({"https": proxy_url, "http": proxy_url} if proxy_url else {})]
    with urllib.request.build_opener(*handlers).open(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def bars(instrument_id, period: str, first_open_ns: int, last_close_ns: int, precisions: tuple[int, int],
         proxy_url: str | None, get=get_json) -> list[Bar]:
    """The `period` klines of `instrument_id` that open at or after `first_open_ns` and close at or before
    `last_close_ns`, ascending, as bars with the contract's price and size precisions."""
    symbol = str(instrument_id).split("-PERP.")[0]
    kind = warmup.bar_type(instrument_id, period)
    price, size = precisions
    found: list[Bar] = []
    start = first_open_ns
    last_open = last_close_ns + warmup.MILLISECOND_NS - warmup.period_ns(period)
    while start <= last_open:
        query = {"symbol": symbol, "interval": INTERVALS[period], "startTime": start // NS_PER_MS,
                 "endTime": last_open // NS_PER_MS, "limit": LIMIT}
        rows = get(f"{REST_BASE}/fapi/v1/klines?{urllib.parse.urlencode(query)}", proxy_url)
        for row in rows:
            stamp = int(row[6]) * NS_PER_MS
            if int(row[0]) * NS_PER_MS < start or stamp > last_close_ns:
                continue
            o, h, low, c = (Price.from_str(f"{Decimal(value):.{price}f}") for value in row[1:5])
            found.append(Bar(kind, o, h, low, c, Quantity.from_str(f"{Decimal(row[5]):.{size}f}"), stamp, stamp))
        if len(rows) < LIMIT:
            break
        start = int(rows[-1][0]) * NS_PER_MS + warmup.period_ns(period)
    return found
