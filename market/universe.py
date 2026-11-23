"""The common tradable range (`market.classify_contract`, `market.monthly_universe`,
`market.membership_path`, `market.selection`).

A versioned rule, fixed before the data: at the start of each UTC month the members are every
eligible contract that traded on the day before and whose unbroken run of trading days up to it is
at least `LISTED_DAYS` long. Not ranked, no top N; a contract delisted later stays in the months it
qualified for. Eligible: USDT perpetuals of coins, excluding index contracts, other contract types,
non-coin underlyings (equities, commodities and other TRADIFI) and stablecoin base assets.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timedelta
import json
from pathlib import Path

from shared import clock
from shared.errors import Refusal
from shared.files import atomic_write
from shared.refusals import refuse


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
        raise refuse("EXCHANGE_INFO_MALFORMED",
                     f"the exchange metadata of {symbol} lacks its contract type, underlying type or base asset, or "
                     "names another contract", missing=(symbol,))
    if item["underlying_type"] == "INDEX":
        return out("index")
    if item["contract_type"] != "PERPETUAL":
        return out(f"contract_type:{item['contract_type']}")
    if item["underlying_type"] != "COIN":
        return out(f"underlying:{item['underlying_type']}")
    if item["base_asset"] in STABLECOINS:
        return out("stablecoin")
    return out(None)


def item_of(symbol: str, row: dict) -> dict | None:
    """The classification input of a stored terms row: None for inferred terms (no exchange metadata)."""
    if row["classification"] is None:
        return None
    found = json.loads(row["classification"])
    quote = found.get("quote_asset") or ""
    return {"symbol": symbol, "contract_type": found.get("contract_type"), "underlying_type": found.get("underlying_type"),
            "base_asset": symbol[:-len(quote)] if quote and symbol.endswith(quote) else symbol}


def contract_in_month(symbol: str, seen: list[dict], item: dict | None, month: date) -> dict:
    """The classification of the contract that bears `symbol` in `month` (classify_contract's). A contract
    keeps that of its earliest stored observation: later rows are recorded and never reclassify it (a delisting contract
    is reported SETTLING without a contract type). But a symbol can be given to another contract. One listed after
    that observation is another: it is classified by exchangeInfo from its month on, and its first month is imported
    only when both contracts are eligible. Once exchangeInfo no longer states it, a later row naming another underlying
    type stands for it from the month of that row. A symbol never seen is classified by today's exchangeInfo."""
    if not seen:
        return classify_contract(symbol, item)
    first = classify_contract(symbol, item_of(symbol, seen[0]))
    start, end = clock.day_ms(month), clock.day_ms(clock.next_month(month))
    if item is not None and item["contract_type"]:
        onboard = item["onboard_date"]
        if onboard is None or onboard <= seen[0]["observed_at"] or end <= onboard:
            return first
        other = classify_contract(symbol, item)
        return other if onboard <= start or first["eligible"] else first
    if first["eligible"]:
        underlying = (item_of(symbol, seen[0]) or {}).get("underlying_type", "COIN")
        for row in seen[1:]:
            stated = item_of(symbol, row)
            if (row["observed_at"] < end and stated is not None and stated["contract_type"]
                    and stated["underlying_type"] != underlying):
                return classify_contract(symbol, stated)
    return first


def _first_day(value) -> bool:
    return isinstance(value, date) and not isinstance(value, datetime) and value.day == 1


def monthly_universe(classifications: list[dict], trading_days: dict[str, set[date]], month: date) -> list[str]:
    """market.monthly_universe: the sorted member symbols of the month start `month`. A member traded on
    the day before the month and its unbroken run of trading days up to it is at least LISTED_DAYS long."""
    if not _first_day(month):
        raise refuse("MONTH_NOT_FIRST_DAY", f"{month!r} is not a month start", missing=("month",))
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


def merge_months(rows: list[tuple[date, str]]) -> dict[str, list[list[int]]]:
    """Each member month as [month start, next month start) in UTC nanoseconds; touching intervals merge."""
    paths: dict[str, list[list[int]]] = {}
    for month, symbol in sorted(rows, key=lambda row: (row[1], row[0])):
        start, end = clock.day_ns(month), clock.day_ns(clock.next_month(month))
        intervals = paths.setdefault(symbol, [])
        if intervals and intervals[-1][1] == start:
            intervals[-1][1] = end
        else:
            intervals.append([start, end])
    return paths


def rule_of(market, market_day: str | None) -> str:
    """The universe rule of the newest month's rows at the market day (every market day, None included); RULE with no rows."""
    from market import files
    for entry in reversed(files.entries(market, "universe_month", None, None, files._visible("universe_month", market_day, None))):
        for batch in files.file_batches(files.file_bytes(market, entry), files.UNIVERSE_MONTH):
            if batch.num_rows:
                return batch.column("universe_rule")[0].as_py()
    return RULE


def membership_path(market, market_day: str, window_end: int) -> dict:
    """market.membership_path: {universe_rule, membership: {symbol: [[start_ns, end_ns], ...]}} at an exact
    market day."""
    from market import files
    try:
        resolved = files.resolve_day(market, market_day)
    except Refusal as exc:
        raise refuse("MARKET_DAY_UNRESOLVED", f"market day {market_day!r} does not resolve ({exc.code})",
                     missing=(str(market_day),)) from exc
    if resolved != market_day:
        raise refuse("MARKET_DAY_UNRESOLVED", f"{market_day!r} is not an exact market day",
                     missing=(str(market_day),))
    rows = months_of(market, market_day)
    if not rows:
        raise refuse("UNIVERSE_EMPTY_AT_DAY", f"market day {market_day} has no universe month", missing=(market_day,))
    last = max(month for month, _ in rows)
    if clock.day_ns(clock.next_month(last)) < window_end:
        raise refuse("UNIVERSE_NOT_COVERING_WINDOW",
                     f"the universe at {market_day} ends with {last:%Y-%m}, before the window end",
                     missing=(clock.next_month(last).strftime("%Y-%m"),))
    return {"universe_rule": rule_of(market, market_day), "membership": merge_months(rows)}


def selection(market: dict, at: str | None, symbols: list[str] | None, now_ns: int) -> tuple[str, dict, list[str]]:
    """The market day `at` (None: the latest), its membership object for the chosen contracts and the contracts: the
    given ones, or (symbols None, Paper's pool) every member of the current month. A Paper or Live run's universe
    file; Live always names its contracts."""
    from market import files
    opened = files.open_market(market, "reader")
    market_day = files.resolve_day(opened, at)
    found = membership_path(opened, market_day, now_ns)
    members = found["membership"]
    if symbols is None:
        symbols = sorted(symbol for symbol, intervals in members.items()
                         if any(low <= now_ns < high for low, high in intervals))
        if not symbols:
            raise refuse("UNIVERSE_EMPTY", f"market day {market_day} has no member for the current month",
                         missing=("symbols",))
    if not symbols or len(set(symbols)) != len(symbols):
        raise refuse("EMPTY_SYMBOLS", "the contract list is empty or repeats a contract", missing=("symbols",))
    return market_day, {"universe_rule": found["universe_rule"],
                        "membership": {symbol: members.get(symbol, []) for symbol in symbols}}, list(symbols)


def months_of(market, market_day: str | None) -> list[tuple[date, str]]:
    """(month, symbol) rows at the market day, in (month, symbol) order."""
    from market import files
    return [(month, symbol) for batch in files.read_table(market, market_day, "universe_month")
            for month, symbol in zip(*(batch.column(name).to_pylist() for name in ("month", "symbol")), strict=True)]


def month_files(market: dict, symbols: list[str], after: str) -> dict[str, bytes]:
    """The host's month files for a running Paper or Live run (engine.membership): {YYYY-MM: file bytes} for each
    month after `after` (YYYY-MM) that the market's latest market day holds, {"market_day", "members"} with the run's
    contracts in that month's universe. The caller writes each once and never rewrites it."""
    from market import files
    opened = files.open_market(market, "reader")
    market_day = files.resolve_day(opened, None)
    held: dict[str, set[str]] = {}
    for day, symbol in months_of(opened, market_day):
        held.setdefault(f"{day:%Y-%m}", set()).add(symbol)
    return {month: json.dumps({"market_day": market_day, "members": sorted(set(symbols) & held[month])},
                              sort_keys=True).encode()
            for month in sorted(month for month in held if month > after)}


def write_months(market: dict, folder: Path, symbols: list[str], after: str,
                 write: Callable[[Path, bytes], None] = atomic_write) -> list[str]:
    """`folder`/<YYYY-MM>.json for each of month_files' months not yet there, each whole (`write`, by default
    shared.files.atomic_write); a written file is never rewritten. Returns the months written."""
    written = []
    for month, data in month_files(market, symbols, after).items():
        path = folder / f"{month}.json"
        if not path.exists():
            write(path, data)
            written.append(month)
    return written
