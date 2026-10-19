"""Which contracts exist, their daily quote volume and the monthly pool.

The pool is the data layer's fixed universe, not a strategy choice: at the start of each UTC
month, among USDT perpetuals that have traded for at least 30 days and still trade on the day
before, excluding index contracts and stablecoin pairs, the 50 with the highest quote volume over
the previous 30 UTC days (all of them when fewer than 50 qualify). Delisted contracts count.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from market import binance


POOL_RULE = "usdt-perp-top50-30d-v1"
POOL_SIZE = 50
LISTED_DAYS = 30
VOLUME_DAYS = 30
FIRST_MONTH = ARCHIVES_BEGIN = date(2020, 1, 1)
# Index contracts that are no longer in exchangeInfo, where `underlyingType` would say INDEX.
DELISTED_INDEX = frozenset({"BLUEBIRDUSDT", "FOOTBALLUSDT"})
STABLE_BASES = frozenset({"USDC", "BUSD", "TUSD", "FDUSD", "USDP", "DAI", "USDE", "PYUSD", "USD1", "RLUSD"})


def classify(archive_symbols: list[str], exchange_info: dict) -> dict:
    """Split archive symbols into eligible USDT perpetuals and the excluded ones, with reasons."""
    info = {item["symbol"]: item for item in exchange_info["symbols"]}
    eligible, excluded = [], {}
    for symbol in archive_symbols:
        if not symbol.endswith("USDT") or "_" in symbol:
            continue  # other margins and delivery contracts are not USDT perpetuals
        item = info.get(symbol)
        if symbol in DELISTED_INDEX or (item and item.get("underlyingType") == "INDEX"):
            excluded[symbol] = "index"
        elif item and item.get("contractType") != "PERPETUAL":
            excluded[symbol] = f"contract type {item.get('contractType')}"
        elif item and item.get("underlyingType") != "COIN":
            excluded[symbol] = f"underlying {item.get('underlyingType')}"
        elif (item["baseAsset"] if item else symbol.removesuffix("USDT")) in STABLE_BASES:
            excluded[symbol] = "stablecoin"
        else:
            eligible.append(symbol)
    return {"eligible": eligible, "excluded": excluded}


def day_ms(value: date) -> int:
    return int(datetime(value.year, value.month, value.day, tzinfo=UTC).timestamp() * 1000)


def ms_day(value: int) -> date:
    return datetime.fromtimestamp(value / 1000, UTC).date()


def months(first: date, last: date):
    current = first.replace(day=1)
    while current <= last:
        yield current
        current = (current.replace(year=current.year + 1, month=1) if current.month == 12
                   else current.replace(month=current.month + 1))


def _days(first: date, end: date):
    while first < end:
        yield first
        first += timedelta(days=1)


def daily_volume(cache: binance.Cache, symbol: str, until: date, *, trading: bool,
                 since: date | None = None) -> list[tuple[date, str]]:
    """(UTC day, quote volume) of every closed daily kline in [since, until).

    `trading`: exchangeInfo lists the contract as trading, so days up to `until` are expected.

    Monthly archives first; daily archives for days a monthly archive lacks and for months without
    one; public REST for days before the first archive (contracts listed before 2020), for days no
    archive holds yet and for any day still missing inside the run.
    """
    rows = {}
    keys = [key for key in binance.archive_keys("monthly", "klines", symbol, "1d")
            if (since is None or binance.period(key) >= since.strftime("%Y-%m"))
            and binance.period(key) <= until.strftime("%Y-%m")]
    for path in cache.fetch_all(keys, workers=4):
        rows.update((ms_day(row[0]), row) for row in binance.kline_rows(path))
    if since is None:
        first = min(rows, default=until)
        if first == ARCHIVES_BEGIN:
            rows.update((ms_day(row[0]), row)
                        for row in binance.rest_klines("LAST", symbol, "1d", day_ms(date(2019, 1, 1)), day_ms(first)))
    else:
        first = since
    last = max(rows, default=first - timedelta(days=1))
    wanted = {day for day in _days(first, until if trading else last) if day not in rows}
    for stem in sorted({day.strftime("%Y-%m") for day in wanted}):
        found = [key for key in binance.archive_keys("daily", "klines", symbol, "1d", stem)
                 if date.fromisoformat(binance.period(key)) in wanted]
        for path in cache.fetch_all(found, workers=4):
            rows.update((ms_day(row[0]), row) for row in binance.kline_rows(path))
    if trading:
        tail = max(rows, default=first - timedelta(days=1)) + timedelta(days=1)
        if tail < until:
            rows.update((ms_day(row[0]), row)
                        for row in binance.rest_klines("LAST", symbol, "1d", day_ms(tail), day_ms(until)))
    span = sorted(day for day in rows if day >= first)
    for before, after in zip(span, span[1:]):
        if (after - before).days > 1:
            rows.update((ms_day(row[0]), row) for row in binance.rest_klines(
                "LAST", symbol, "1d", day_ms(before + timedelta(days=1)), day_ms(after)))
    found = sorted((day, row) for day, row in rows.items() if (since is None or day >= since) and day < until)
    for day, row in found:
        if row[6] != row[0] + 86_400_000 - 1:
            raise binance.SourceError(f"{symbol} {day}: not a closed UTC daily kline")
    return [(day, row[7]) for day, row in found]


def pool(volumes: dict[str, list[tuple[date, Decimal]]], first: date, last: date) -> list[tuple]:
    """(month, rank, symbol, 30-day quote volume) for every month start in [first, last].

    `volumes` holds each symbol's daily quote volume by UTC day. A contract is listed for 30 days
    when its current unbroken run of daily klines started at least 30 days before the month, and
    still trades when that run includes the day before the month.
    """
    by_symbol = {symbol: dict(rows) for symbol, rows in volumes.items()}
    result = []
    for month in months(first, last):
        eve = month - timedelta(days=1)
        ranked = []
        for symbol, days in by_symbol.items():
            if eve not in days:
                continue
            start = eve
            while start - timedelta(days=1) in days:
                start -= timedelta(days=1)
            if (month - start).days < LISTED_DAYS:
                continue
            window = [days.get(month - timedelta(days=offset)) for offset in range(1, VOLUME_DAYS + 1)]
            ranked.append((-sum(value for value in window if value is not None), symbol))
        ranked.sort()
        result += [(month, rank, symbol, -negative)
                   for rank, (negative, symbol) in enumerate(ranked[:POOL_SIZE], start=1)]
    return result
