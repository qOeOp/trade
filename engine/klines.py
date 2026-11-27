"""Binance's public USD-M klines as native bars, and its funding-rate history as native settlements: the history Paper
and Live read at their start (engine.history).

No credential: ``fapi/v1/klines``, ``fapi/v1/fundingRate`` and ``fapi/v1/fundingInfo`` are public, as the market's
archives are. A kline becomes a ``{id}-{period}-LAST-EXTERNAL`` bar stamped at its close time (its open plus the
period, less 1 ms), as the market export and a replay's history are (engine.warmup). A settlement becomes the update a
replay streams for it (engine.warmup.funding_update): the endpoint answers the monthly archives' times, jitter
included, and rates (probed on BTCUSDT 2025-10: all 93 equal), which the market stores.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from decimal import Decimal

from nautilus_trader.model import Bar, Price, Quantity

from engine import warmup

REST_BASE = "https://fapi.binance.com"
LIMIT = 1500  # Binance's most klines per request
FUNDING_LIMIT = 1000  # Binance's most settlements per request
INTERVALS = {"1-MINUTE": "1m", "3-MINUTE": "3m", "5-MINUTE": "5m", "15-MINUTE": "15m", "30-MINUTE": "30m",
             "1-HOUR": "1h", "2-HOUR": "2h", "4-HOUR": "4h", "6-HOUR": "6h", "8-HOUR": "8h", "12-HOUR": "12h",
             "1-DAY": "1d"}
NS_PER_MS = 1_000_000
# A terms read that fails for a passing reason (a dropped connection, 429, a 5xx) is sent again, at most this many times
# in all, after 1 s, then 2 s; another 4xx (a ban among them) is not.
TERMS_READ_ATTEMPTS = 3


def get_json(url: str, proxy_url: str | None, timeout: float = 10):
    handlers = [urllib.request.ProxyHandler({"https": proxy_url, "http": proxy_url} if proxy_url else {})]
    with urllib.request.build_opener(*handlers).open(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def bars(instrument_id, period: str, first_open_ns: int, last_close_ns: int, precisions: tuple[int, int],
         proxy_url: str | None, get=get_json, base: str | None = None) -> list[Bar]:
    """The `period` klines of `instrument_id` that open at or after `first_open_ns` and close at or before
    `last_close_ns`, ascending, as bars with the contract's price and size precisions. `base`: the REST origin
    (REST_BASE, production, when None; a Live run's environment: engine.live_venue.VENUES)."""
    symbol = str(instrument_id).split("-PERP.")[0]
    kind = warmup.bar_type(instrument_id, period)
    price, size = precisions
    found: list[Bar] = []
    start = first_open_ns
    last_open = last_close_ns + warmup.MILLISECOND_NS - warmup.period_ns(period)
    while start <= last_open:
        query = {"symbol": symbol, "interval": INTERVALS[period], "startTime": start // NS_PER_MS,
                 "endTime": last_open // NS_PER_MS, "limit": LIMIT}
        rows = get(f"{base or REST_BASE}/fapi/v1/klines?{urllib.parse.urlencode(query)}", proxy_url)
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


def settlements(instrument_id, at_ns: int, count: int, proxy_url: str | None, get=get_json,
                base: str | None = None) -> list:
    """The last `count` funding settlements of `instrument_id` at or before `at_ns`, ascending, as native updates;
    fewer when Binance holds fewer. With only an end time, the endpoint answers the latest settlements up to it."""
    symbol = str(instrument_id).split("-PERP.")[0]
    found: list = []
    end_ms = at_ns // NS_PER_MS
    while len(found) < count:
        asked = min(FUNDING_LIMIT, count - len(found))
        query = {"symbol": symbol, "endTime": end_ms, "limit": asked}
        rows = get(f"{base or REST_BASE}/fapi/v1/fundingRate?{urllib.parse.urlencode(query)}", proxy_url)
        page = sorted((int(row["fundingTime"]), str(row["fundingRate"])) for row in rows
                      if int(row["fundingTime"]) <= end_ms)
        found[:0] = [warmup.funding_update(instrument_id, at * NS_PER_MS, rate) for at, rate in page[-asked:]]
        if len(page) < asked:
            break
        end_ms = page[0][0] - 1
    return found


def funding_interval(instrument_id, proxy_url: str | None, get=get_json, base: str | None = None) -> int:
    """The funding interval of `instrument_id` now, in nanoseconds (``fapi/v1/fundingInfo``). Binance changes it between
    1, 4 and 8 hours and settles at its multiples from the epoch (2026-11-15 probe: every trading perpetual's next
    funding time, and every settlement in the last 500 of ten contracts, changes included). The endpoint listed every
    trading perpetual in that probe; one it leaves out has Binance's default, 8 hours."""
    symbol = str(instrument_id).split("-PERP.")[0]
    rows = get(f"{base or REST_BASE}/fapi/v1/fundingInfo", proxy_url)
    hours = next((int(row["fundingIntervalHours"]) for row in rows if row["symbol"] == symbol), 8)
    return hours * 3600 * 1_000_000_000


def symbol(instrument_id) -> str:
    return str(instrument_id).split("-PERP.")[0]


def contract(instrument_id, proxy_url: str | None) -> dict:
    """Binance's public fapi/v1/exchangeInfo row of the contract now, which Paper reads for each entry, as Live does
    (engine.paper_terms.entry)."""
    for attempt in range(1, TERMS_READ_ATTEMPTS + 1):
        try:
            answer = get_json(f"{REST_BASE}/fapi/v1/exchangeInfo", proxy_url)
            break
        except OSError as exc:
            status = getattr(exc, "code", None)  # an HTTP status (urllib.error.HTTPError), else a connection failure
            if attempt == TERMS_READ_ATTEMPTS or isinstance(status, int) and 400 <= status < 500 and status != 429:
                raise
            time.sleep(attempt)
    rows = [row for row in answer["symbols"] if row["symbol"] == symbol(instrument_id)]
    if len(rows) != 1:
        raise ValueError(f"Binance has no unique USD-M instrument {symbol(instrument_id)}")
    return rows[0]
