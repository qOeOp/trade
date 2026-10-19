"""The common tradable range (`market.classify_contract`, `market.monthly_universe`,
`market.membership_path`).

A versioned rule, fixed before the data: at the start of each UTC month the members are every
eligible contract that traded on the day before and whose unbroken run of trading days up to it is
at least `listed_days` long. Not ranked, no top N; a contract delisted later stays in the months it
qualified for. Eligible: USDT perpetuals of coins, excluding index contracts, other contract types,
non-coin underlyings (equities, commodities and other TRADIFI) and stablecoin base assets.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from market.sources import _refuse


RULE = "usdt-perp-listed30d-v1"
RULES = {
    RULE: {
        "listed_days": 30,  # uncalibrated example value, fixed with the rule version
        "stablecoins": frozenset({"USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD"}),
        # Index contracts by name, for when exchangeInfo no longer lists them (every one has archives).
        "index_aliases": frozenset({"ALLUSDT", "BLUEBIRDUSDT", "BTCDOMUSDT", "DEFIUSDT", "FOOTBALLUSDT"}),
    },
}


def rule(rule_version: str) -> dict:
    if rule_version not in RULES:
        raise _refuse(f"universe rule {rule_version!r} is not built into this code", "UNIVERSE_RULE_UNKNOWN",
                      missing=(str(rule_version),))
    return RULES[rule_version]


def classify_contract(symbol: str, exchange_info_item: dict | None, rule_version: str) -> dict:
    """market.classify_contract: {symbol, eligible, reason}; reason not_usdt_perpetual, index,
    contract_type:<value>, underlying:<value> or stablecoin, None when eligible."""
    found = rule(rule_version)

    def out(reason: str | None) -> dict:
        return {"symbol": symbol, "eligible": reason is None, "reason": reason}
    if not isinstance(symbol, str) or not symbol.endswith("USDT") or "_" in symbol:
        return out("not_usdt_perpetual")
    item = exchange_info_item
    if item is None:
        if symbol in found["index_aliases"]:
            return out("index")
        return out("stablecoin" if symbol.removesuffix("USDT") in found["stablecoins"] else None)
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
    if item["base_asset"] in found["stablecoins"]:
        return out("stablecoin")
    return out(None)


def _first_day(value) -> bool:
    return isinstance(value, date) and not isinstance(value, datetime) and value.day == 1


def next_month(month: date) -> date:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def monthly_universe(classifications: list[dict], trading_days: dict[str, set[date]], first_month: date,
                     last_month: date, rule_version: str) -> list[tuple[date, str]]:
    """market.monthly_universe: sorted (month, symbol) member rows for every month start in
    [first_month, last_month]. A member traded on the day before the month and its unbroken run of
    trading days up to it is at least listed_days long."""
    listed_days = rule(rule_version)["listed_days"]
    if not _first_day(first_month) or not _first_day(last_month) or last_month < first_month:
        raise _refuse(f"{first_month!r} .. {last_month!r} are not month starts in order", "MONTH_NOT_FIRST_DAY",
                      missing=("first_month", "last_month"))
    known = [day for days in trading_days.values() for day in days]
    needed = (first_month - timedelta(days=listed_days), last_month - timedelta(days=1))
    if not known or min(known) > needed[0] or max(known) < needed[1]:
        raise _refuse(f"trading days {min(known) if known else None} .. {max(known) if known else None} do not "
                      f"cover {needed[0]} .. {needed[1]}", "TRADING_DAYS_INSUFFICIENT",
                      missing=(needed[0].isoformat(), needed[1].isoformat()))
    eligible = sorted({item["symbol"] for item in classifications if item["eligible"]})
    rows, month = [], first_month
    while month <= last_month:
        eve = month - timedelta(days=1)
        for symbol in eligible:
            days = trading_days.get(symbol) or set()
            if eve not in days:
                continue
            start = eve
            while start - timedelta(days=1) in days:
                start -= timedelta(days=1)
            if (month - start).days >= listed_days:
                rows.append((month, symbol))
        month = next_month(month)
    return rows


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


def membership_path(conn, market_commit: str, window_end: int) -> dict:
    """market.membership_path: {universe_rule, membership: {symbol: [[start_ns, end_ns], ...]}} AS OF an
    exact market commit."""
    from market import store
    try:
        commit = store.resolve_commit(conn, market_commit)
    except store.MarketError as exc:
        raise _refuse(f"market commit {market_commit!r} does not resolve ({exc.code})", "MARKET_COMMIT_UNRESOLVED",
                      missing=(str(market_commit),)) from exc
    if commit != market_commit:
        raise _refuse(f"{market_commit!r} is not an exact market commit hash", "MARKET_COMMIT_UNRESOLVED",
                      missing=(str(market_commit),))
    (universe_rule,), = conn.rows(f"SELECT universe_rule FROM market_schema AS OF '{commit}'")
    rows = conn.rows(f"SELECT month, symbol FROM universe_month AS OF '{commit}' WHERE universe_rule = %s",
                     (universe_rule,))
    if not rows:
        raise _refuse(f"market commit {commit} has no universe month", "UNIVERSE_EMPTY_AT_COMMIT", missing=(commit,))
    last = max(month for month, _ in rows)
    if _month_ns(next_month(last)) < window_end:
        raise _refuse(f"the universe at {commit} ends with {last:%Y-%m}, before the window end", "UNIVERSE_NOT_COVERING_WINDOW",
                      missing=(next_month(last).strftime("%Y-%m"),))
    return {"universe_rule": universe_rule, "membership": merge_months(rows)}


def months_of(conn, commit: str) -> list[tuple[date, str]]:
    """(month, symbol) rows of the commit's universe rule AS OF the commit."""
    return conn.rows(f"SELECT u.month, u.symbol FROM universe_month AS OF '{commit}' u JOIN market_schema AS OF "
                     f"'{commit}' s ON u.universe_rule = s.universe_rule ORDER BY u.month, u.symbol")
