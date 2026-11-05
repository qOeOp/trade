"""The common tradable range (`market.classify_contract`, `market.monthly_universe`,
`market.membership_path`).

A versioned rule, fixed before the data: at the start of each UTC month the members are every
eligible contract that traded on the day before and whose unbroken run of trading days up to it is
at least `LISTED_DAYS` long. Not ranked, no top N; a contract delisted later stays in the months it
qualified for. Eligible: USDT perpetuals of coins, excluding index contracts, other contract types,
non-coin underlyings (equities, commodities and other TRADIFI) and stablecoin base assets.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from market.sources import _refuse


RULE = "usdt-perp-listed30d-v1"
LISTED_DAYS = 30  # uncalibrated example value, fixed with the rule
STABLECOINS = frozenset({"USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD"})
# Index contracts by name, for when exchangeInfo no longer lists them (every one has archives).
INDEX_ALIASES = frozenset({"ALLUSDT", "BLUEBIRDUSDT", "BTCDOMUSDT", "DEFIUSDT", "FOOTBALLUSDT"})


def classify_contract(symbol: str, exchange_info_item: dict | None) -> dict:
    """market.classify_contract: {symbol, eligible, reason}; reason not_usdt_perpetual, index,
    contract_type:<value>, underlying:<value> or stablecoin, None when eligible."""

    def out(reason: str | None) -> dict:
        return {"symbol": symbol, "eligible": reason is None, "reason": reason}
    if not isinstance(symbol, str) or not symbol.endswith("USDT") or "_" in symbol:
        return out("not_usdt_perpetual")
    item = exchange_info_item
    if item is None:
        if symbol in INDEX_ALIASES:
            return out("index")
        return out("stablecoin" if symbol.removesuffix("USDT") in STABLECOINS else None)
    if (not isinstance(item, dict) or item.get("symbol") != symbol
            or not all(isinstance(item.get(key), str) for key in ("contract_type", "underlying_type", "base_asset"))):
        raise _refuse(f"the exchange metadata of {symbol} lacks its contract type, underlying type or base asset, or "
                      "names another contract", "EXCHANGE_INFO_MALFORMED", missing=(symbol,))
    if item["underlying_type"] == "INDEX":
        return out("index")
    if item["contract_type"] != "PERPETUAL":
        return out(f"contract_type:{item['contract_type']}")
    if item["underlying_type"] != "COIN":
        return out(f"underlying:{item['underlying_type']}")
    if item["base_asset"] in STABLECOINS:
        return out("stablecoin")
    return out(None)


def _first_day(value) -> bool:
    return isinstance(value, date) and not isinstance(value, datetime) and value.day == 1


def next_month(month: date) -> date:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def monthly_universe(classifications: list[dict], trading_days: dict[str, set[date]], month: date) -> list[str]:
    """market.monthly_universe: the sorted member symbols of the month start `month`. A member traded on
    the day before the month and its unbroken run of trading days up to it is at least LISTED_DAYS long."""
    if not _first_day(month):
        raise _refuse(f"{month!r} is not a month start", "MONTH_NOT_FIRST_DAY", missing=("month",))
    members, eve = [], month - timedelta(days=1)
    for symbol in sorted({item["symbol"] for item in classifications if item["eligible"]}):
        days = trading_days.get(symbol) or set()
        if eve not in days:
            continue
        start = eve
        while start - timedelta(days=1) in days:
            start -= timedelta(days=1)
        if (month - start).days >= LISTED_DAYS:
            members.append(symbol)
    return members


def _month_ns(month: date) -> int:
    return int(datetime(month.year, month.month, 1, tzinfo=UTC).timestamp()) * 10**9


def merge_months(rows: list[tuple[date, str]]) -> dict[str, list[list[int]]]:
    """Each member month as [month start, next month start) in UTC nanoseconds; touching intervals merge."""
    paths: dict[str, list[list[int]]] = {}
    for month, symbol in sorted(rows, key=lambda row: (row[1], row[0])):
        start, end = _month_ns(month), _month_ns(next_month(month))
        intervals = paths.setdefault(symbol, [])
        if intervals and intervals[-1][1] == start:
            intervals[-1][1] = end
        else:
            intervals.append([start, end])
    return paths


def rule_of(market, commit: str | None) -> str:
    """The universe rule of the newest month's rows at the commit (every commit, None included); RULE with no rows."""
    from market import files
    for entry in reversed(files.entries(market, "universe_month", None, None, files._visible("universe_month", commit, None))):
        for batch in files.file_batches(files.file_bytes(market, entry), files.UNIVERSE_MONTH):
            if batch.num_rows:
                return batch.column("universe_rule")[0].as_py()
    return RULE


def membership_path(market, market_commit: str, window_end: int) -> dict:
    """market.membership_path: {universe_rule, membership: {symbol: [[start_ns, end_ns], ...]}} at an exact
    market commit."""
    from market import files
    from market.sources import MarketError
    try:
        commit = files.resolve_commit(market, market_commit)
    except MarketError as exc:
        raise _refuse(f"market commit {market_commit!r} does not resolve ({exc.code})", "MARKET_COMMIT_UNRESOLVED",
                      missing=(str(market_commit),)) from exc
    if commit != market_commit:
        raise _refuse(f"{market_commit!r} is not an exact market commit", "MARKET_COMMIT_UNRESOLVED",
                      missing=(str(market_commit),))
    rows = months_of(market, commit)
    if not rows:
        raise _refuse(f"market commit {commit} has no universe month", "UNIVERSE_EMPTY_AT_COMMIT", missing=(commit,))
    last = max(month for month, _ in rows)
    if _month_ns(next_month(last)) < window_end:
        raise _refuse(f"the universe at {commit} ends with {last:%Y-%m}, before the window end", "UNIVERSE_NOT_COVERING_WINDOW",
                      missing=(next_month(last).strftime("%Y-%m"),))
    return {"universe_rule": rule_of(market, commit), "membership": merge_months(rows)}


def months_of(market, commit: str | None) -> list[tuple[date, str]]:
    """(month, symbol) rows at the commit, in (month, symbol) order."""
    from market import files
    return [(month, symbol) for batch in files.read_table(market, commit, "universe_month")
            for month, symbol in zip(*(batch.column(name).to_pylist() for name in ("month", "symbol")), strict=True)]
