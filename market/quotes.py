"""Best bid and ask inferred from Binance aggTrades (market.quotes, market.import_quotes).

The rule `RULE`: a trade whose buyer is the maker was a sell hitting the best bid, so its price is the
best bid at that moment; a trade whose buyer is the taker lifted the best ask. Each side is carried
forward until that side trades again. When the carried side has gone stale and crosses the fresh one,
the stale side is pushed one price increment off the fresh side (counted, never silent). Every state
change is kept: thinning to per-second extremes was measured to move a liquidation to the second's adverse
extreme up to a second late.

Nothing here is a strategy or an exchange rule: it is the declared derivation the quote import applies to
the stored complete aggTrades (market.aggtrades) before storing rows, with the checks that refuse a day the
derivation cannot trust (an aggTrade id sequence gap, a time reversal, an increment outside the stored scale).
Prices are integers at the trade scale (files.TRADE_SCALE), as agg_trade stores them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

import numpy as np
import pyarrow as pa

from market import aggtrades, files, store
from market.sources import DAY
from shared import clock
from shared.refusals import refuse


RULE = "binance-aggtrades-bbo-v1"


@dataclass
class State(aggtrades.State):
    """One contract's inference state carried from one day to the next."""
    bid: int | None = None
    ask: int | None = None


def derive(table: pa.Table, tick: Decimal, state: State, label: str) -> tuple[list[tuple], dict]:
    """The best bid/ask states of one day's aggTrades (agg_trade rows): [(agg_trade_id, ts, bid, ask)] at every
    change, with the day's readings, continuing `state` (updated in place). Refuses a sequence gap, a time
    reversal, a non-positive price increment, or one finer than the stored scale where a stale side is pushed."""
    if not isinstance(tick, Decimal) or tick <= 0:
        raise refuse("SOURCE_SHAPE", f"{label}: price increment {tick} is not positive", missing=(label,))
    units = tick.scaleb(files.TRADE_SCALE)
    step = int(units) if units == units.to_integral_value() else None
    ids = table["agg_trade_id"].to_numpy()
    times = table["transact_time"].to_numpy()
    firsts, lasts = table["first_trade_id"].to_numpy(), table["last_trade_id"].to_numpy()
    makers = table["is_buyer_maker"].to_numpy(zero_copy_only=False)
    prices = table["price"].to_numpy()
    if len(ids) == 0:
        raise refuse("SOURCE_SHAPE", f"{label}: no trades", missing=(label,))
    # aggtrades.follows, row against row within the day and the day's first row against the day before.
    steps = np.diff(ids)
    broken = (steps != 1) & ~((steps == 0) & (np.diff(times) > 0) & (firsts[1:] > lasts[:-1]))
    continues = aggtrades.follows(state.last_id, state.last_time, state.last_trade, int(ids[0]), int(times[0]),
                                  int(firsts[0]))
    if np.any(broken) or not continues:
        where = int(np.argmax(broken)) if np.any(broken) else -1
        detail = (f"after agg_trade_id {int(ids[where])} comes {int(ids[where + 1])}" if where >= 0
                  else f"the day starts at agg_trade_id {int(ids[0])}, the day before ended at {state.last_id}")
        raise refuse("SEQUENCE_GAP", f"{label}: aggTrade ids are not contiguous ({detail})", missing=(label,))
    if np.any(np.diff(times) < 0):
        raise refuse("SOURCE_SHAPE", f"{label}: transact_time goes backwards", missing=(label,))
    if np.any(prices <= 0):
        raise refuse("SOURCE_SHAPE", f"{label}: a trade price is not positive", missing=(label,))
    rows: list[tuple] = []
    adjustments = 0
    last = (state.bid, state.ask)
    for identity, moment, maker, price in zip(ids.tolist(), times.tolist(), makers.tolist(), prices.tolist(),
                                              strict=True):
        if maker:
            state.bid = price
        else:
            state.ask = price
        if state.bid is None or state.ask is None:
            continue
        if state.bid >= state.ask:
            if step is None:
                raise refuse("SCALE_LOSS",
                             f"{label}: price increment {tick} has more than {files.TRADE_SCALE} decimals",
                             missing=(label,))
            adjustments += 1
            if maker:
                state.ask = state.bid + step
            else:
                state.bid = state.ask - step
        if (state.bid, state.ask) != last:
            rows.append((identity, moment, state.bid, state.ask))
            last = (state.bid, state.ask)
    state.last_id, state.last_time, state.last_trade = int(ids[-1]), int(times[-1]), int(lasts[-1])
    gaps = np.diff(times)
    readings = {"trades": int(len(ids)), "quote_changes": len(rows), "stale_side_adjustments": adjustments,
                "minutes_with_trades": int(len(np.unique(times // 60_000))),
                "trade_gap_max_ms": int(gaps.max()) if len(gaps) else 0,
                "trade_gap_p99_ms": int(np.percentile(gaps, 99)) if len(gaps) else 0}
    return rows, readings


# market.import_quotes: best bid/ask inferred from the stored complete aggTrades under RULE

def import_quotes(profile: dict, month: date, cache_root: Path, symbols: list[str] | None = None, log=print) -> dict:
    """market.import_quotes: one ended UTC month of inferred best bid/ask (RULE) of `symbols` (default: the
    month's universe members), one file per contract, never written again (store.import_contracts). The trades are
    the contract's agg_trade file of the month, which must be held (TRADES_NOT_HELD). Every state change is stored:
    thinning to per-second extremes moves a liquidation to the second's adverse extreme up to a second late
    (measured), so there is no thinned form."""
    def run(market: files.Market, scope: list[str] | None, start_ms: int, end_ms: int) -> dict:
        return _import_quotes(market, month, start_ms, end_ms, Path(cache_root), scope, log)
    return store.import_contracts(profile, month, symbols, store.closed_month, run,
                                  "the market holds no bars yet; quotes need the contracts' terms")


def _import_quotes(market: files.Market, month: date, start_ms: int, end_ms: int, cache: Path,
                   scope: list[str] | None, log) -> dict:
    label = f"{month:%Y-%m}"
    if scope is None:
        scope = sorted(store._members(market, month))
        if not scope:
            raise refuse("UNIVERSE_UNKNOWN",
                         f"{label} has no universe members in the market; import its bars first or name --symbols",
                         missing=(label,))
    stored = [symbol for symbol in scope if files.entries(market, "quote", [symbol], start_ms, end_ms)]
    if stored:
        raise refuse("MONTH_EXISTS", f"the market already holds {label} quotes of {stored}", missing=(label,))
    latest = {symbol: rows[-1] for symbol, rows in store._terms_history(market).items()}
    jobs = []
    for symbol in scope:
        # The newest stored terms: like the bar import, the price increment is the one observed at import time.
        if symbol not in latest:
            raise refuse("TERMS_UNKNOWN", f"{symbol}: the market holds no contract terms", missing=(symbol,))
        if not files.entries(market, "agg_trade", [symbol], start_ms, end_ms):
            raise refuse("TRADES_NOT_HELD",
                         f"{symbol}: the market holds no {label} aggTrades, which the quotes are inferred from; import "
                         "them first", missing=(symbol,))
        jobs.append({"root": str(market.root), "symbol": symbol, "cache": str(cache), "start": start_ms, "end": end_ms,
                     "tick": latest[symbol]["price_increment"],
                     "trades": files.entries(market, "agg_trade", [symbol], start_ms - DAY, end_ms),
                     "earlier": store.earlier_file(market, "quote", symbol, start_ms)})
    # One contract at a time: a contract-day's derivation is held whole.
    return {"through": clock.ms_day(end_ms).isoformat(), "quote_rule": RULE,
            "per_symbol": store.contract_files(market, jobs, quote_month, 1, log)}


def quote_month(job: dict) -> dict:
    """One contract's month of quotes, written as one file: {written, result}. Each day's trades are read from the
    agg_trade files of `trades`. The day before the month carries the inference into it: read from the file holding
    it, else from its archive (the trade import read the same one), else, unpublished for the contract's first
    quotes, the inference starts cold on the first day."""
    symbol, tick, start, end = job["symbol"], Decimal(job["tick"]), job["start"], job["end"]
    market = store.worker_market(job)
    held: dict[str, pa.Buffer] = {}

    def trades(low: int) -> pa.Table:
        """One UTC day's stored trades, from the file holding it."""
        found: list[pa.RecordBatch] = []
        for entry in job["trades"]:
            if entry.start_ms < low + DAY and entry.end_ms > low:
                if entry.relative not in held:
                    held[entry.relative] = files.file_bytes(market, entry)
                found += files.file_batches(held[entry.relative], files.AGG_TRADE, None, low, low + DAY)
        return pa.Table.from_batches(found, files.AGG_TRADE.schema)

    state = State()
    eve = clock.ms_day(start - DAY).isoformat()
    if any(entry.start_ms < start for entry in job["trades"]):
        derive(trades(start - DAY), tick, state, f"{symbol} {eve}")
        read_eve = True
    else:
        found = aggtrades.eve(Path(job["cache"]), symbol, start, job["earlier"], aggtrades.State())
        if found is not None:
            derive(pa.Table.from_batches(list(found), files.AGG_TRADE.schema), tick, state, f"{symbol} {eve}")
        read_eve = found is not None
    readings = {"trades": 0, "quote_changes": 0, "stale_side_adjustments": 0, "minutes_with_trades": 0,
                "trade_gap_max_ms": 0, "trade_gap_p99_ms": 0}
    written_rows = 0

    def rows():
        # One day at a time: derive, write, drop (a month of BTCUSDT is tens of millions of states).
        nonlocal written_rows
        for low in range(start, end, DAY):
            day = clock.ms_day(low).isoformat()
            found, day_readings = derive(trades(low), tick, state, f"{symbol} {day}")
            if found:
                identities, times, bids, asks = zip(*found, strict=True)
                yield pa.RecordBatch.from_arrays(
                    [pa.array([symbol] * len(found), pa.string()), pa.array(times, pa.int64()),
                     pa.array(identities, pa.int64()), pa.array(bids, pa.int64()), pa.array(asks, pa.int64())],
                    schema=files.QUOTE.schema)
            written_rows += len(found)
            del found
            for key, value in day_readings.items():
                readings[key] = max(readings[key], value) if key.startswith("trade_gap") else readings[key] + value

    written = files.write_file(market, "quote", clock.ms_day(start), symbol, rows())
    return {"written": written, "result": {**readings, "rows": written_rows, "eve": read_eve,
                                           "days": (end - start) // DAY}}
