"""Coverage facts (`market.coverage_facts`, `market.diagnose_coverage`).

Facts only, at one pinned market commit: per contract its member months, the gaps and zero-volume
minutes of its one-minute LAST and MARK bars in the input interval, how the two align, and its
funding settlement times. First and last data are proxies of listing and delisting and are marked
unproven; indicator readiness is the Agent's review. Nothing here drops a contract, shortens a
window, fills data or judges an economic failure.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import numpy as np

from market import export, lifecycle, store


FORMAT = "market-coverage-v1"
MINUTE = 60_000
COMMIT = store.HASH_PREFIX
INTERPRETATION = ("Gaps, zero-volume minutes, missing funding and first or last data are input facts. The replay "
                  "entry does not drop contracts, shorten the window, fill data or judge an economic failure from "
                  "them, and does not decide for the strategy whether its indicators are ready.")


def _interval(start_ms: int, end_ms: int) -> None:
    if (not isinstance(start_ms, int) or not isinstance(end_ms, int) or start_ms >= end_ms or start_ms % MINUTE
            or end_ms % MINUTE):
        raise store.MarketError(f"[{start_ms}, {end_ms}) is not a whole-minute interval with start before end",
                                code="INTERVAL_INVALID")


def _series(bars: dict, start_ms: int, end_ms: int, volume: bool) -> dict:
    times = np.asarray(bars["ts_open"], dtype=np.int64)
    if len(times) and (np.any(times % MINUTE) or np.any(np.diff(times) <= 0)):
        raise store.MarketError("bar open times are not whole, strictly increasing minutes", code="INPUT_SHAPE")
    gaps = store.missing(times, start_ms, end_ms)
    found = {"rows": int(len(times)), "first_open_ms": int(times[0]) if len(times) else None,
             "last_open_ms": int(times[-1]) if len(times) else None, "gap_intervals_ms": [list(gap) for gap in gaps],
             "missing_minutes": int(sum((high - low) // MINUTE for low, high in gaps))}
    if volume:
        found["zero_volume_minutes"] = int(np.count_nonzero(np.asarray(bars["volume"]) == 0))
    return found


def coverage_facts(conn, commit: str, symbol: str, start_ms: int, end_ms: int, last_bars: dict, mark_bars: dict,
                   funding_rows: list[tuple[int, Decimal]]) -> dict:
    """The market-coverage-v1 facts of one contract in [start_ms, end_ms) at an exact market commit."""
    _interval(start_ms, end_ms)
    if not isinstance(commit, str) or len(commit) != 32 or not COMMIT.fullmatch(commit):
        raise store.MarketError(f"{commit!r} is not a full market commit hash", code="UNKNOWN_REF")
    if not store.rows(conn, f"SELECT 1 FROM instrument AS OF '{commit}' WHERE symbol = %s LIMIT 1", (symbol,)):
        raise store.MarketError(f"{symbol} is no instrument at {commit}", code="UNKNOWN_SYMBOL", missing=(symbol,))
    last, mark = _series(last_bars, start_ms, end_ms, True), _series(mark_bars, start_ms, end_ms, False)
    unmatched = int(len(np.setxor1d(np.asarray(last_bars["ts_open"]), np.asarray(mark_bars["ts_open"]))))
    months = [value.isoformat() for (value,) in store.rows(
        conn, f"SELECT month FROM pool AS OF '{commit}' WHERE symbol = %s ORDER BY month", (symbol,))]
    bounds = {price_type: {"first_open_ms": low, "last_open_ms": high} for price_type, low, high in store.rows(
        conn, f"SELECT price_type, MIN(ts_open), MAX(ts_open) FROM bar AS OF '{commit}' WHERE symbol = %s "
              "GROUP BY price_type", (symbol,))}
    times = [int(at) for at, _ in funding_rows]
    return {"format": FORMAT, "commit": commit, "symbol": symbol, "input_interval_ms": [start_ms, end_ms],
            "last": last, "mark": mark, "last_mark_unmatched_minutes": unmatched,
            "funding": {"rows": len(times), "first_ms": times[0] if times else None,
                        "last_ms": times[-1] if times else None, "event_times_ms": times,
                        "expected_schedule": "not_established"},
            "member_months": months,
            "listing_delisting": {"status": "unproven",
                                  "data_bounds_proxy": {"last": bounds.get("LAST"), "mark": bounds.get("MARK")},
                                  "reason": "first and last stored data are no exchange listing or delisting fact"},
            "indicator_readiness": {"status": "agent_review_required",
                                    "reason": "whether the strategy's indicators are warmed up is the Agent's review"},
            "interpretation": INTERPRETATION}


def _ms(text: str) -> int:
    try:
        moment = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError as exc:
        raise store.MarketError(f"{text!r} is not an ISO-8601 time", code="INTERVAL_INVALID") from exc
    if moment.utcoffset() != timedelta(0):
        raise store.MarketError(f"{text!r} is not an explicit UTC time", code="INTERVAL_INVALID")
    return int(moment.timestamp() * 1000)


def universe_members(profile: dict, at: str | None, start: str, end: str) -> list[str]:
    """Every universe member of the months [start, end) touches, at the commit `at` names."""
    start_ms, end_ms = _ms(start), _ms(end)
    _interval(start_ms, end_ms)
    first = datetime.fromtimestamp(start_ms / 1000, timezone.utc).date().replace(day=1)
    last = datetime.fromtimestamp((end_ms - 1) / 1000, timezone.utc).date().replace(day=1)
    conn = store.connect(profile, "reader")
    try:
        commit = store.resolve_commit(conn, at)
        return [symbol for (symbol,) in store.rows(
            conn, f"SELECT DISTINCT symbol FROM pool AS OF '{commit}' WHERE month >= %s AND month <= %s "
                  "ORDER BY symbol", (first, last))]
    finally:
        conn.close()


def diagnose_coverage(profile: dict, at: str | None, symbols: list[str], start: str, end: str,
                      lifecycle_bundle: tuple[dict, dict[str, bytes]] | None) -> dict:
    """Coverage facts of an explicit contract list at the commit `at` names, with the validated
    lifecycle episodes of a given lifecycle manifest; facts only, never a partial result."""
    start_ms, end_ms = _ms(start), _ms(end)
    _interval(start_ms, end_ms)
    if not symbols or len(set(symbols)) != len(symbols):
        raise store.MarketError("the contract list is empty or repeats a contract", code="EMPTY_SYMBOLS")
    conn = store.connect(profile, "reader")
    try:
        commit = store.resolve_commit(conn, at)
        episodes = None
        if lifecycle_bundle is not None:
            body, files = lifecycle_bundle
            episodes = lifecycle.validate_lifecycle(body, commit, files)
        found = []
        for symbol in symbols:
            last = export.fetch(conn, commit, symbol, "LAST", start_ms, end_ms)
            mark = export.fetch(conn, commit, symbol, "MARK", start_ms, end_ms)
            funding = export.funding(conn, commit, symbol, start_ms, end_ms)
            found.append(coverage_facts(conn, commit, symbol, start_ms, end_ms, last, mark, funding))
    finally:
        conn.close()
    return {"commit": commit, "scope": "explicit_symbols", "input_interval_ms": [start_ms, end_ms], "coverage": found,
            "lifecycle": None if episodes is None else {symbol: episodes.get(symbol, []) for symbol in symbols},
            "lifecycle_missing": [] if episodes is None else [symbol for symbol in symbols if symbol not in episodes],
            "interpretation": INTERPRETATION}
