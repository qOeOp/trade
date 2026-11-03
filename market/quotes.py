"""Best bid and ask inferred from Binance aggTrades (market.quotes).

The rule `RULE`: a trade whose buyer is the maker was a sell hitting the best bid, so its price is the
best bid at that moment; a trade whose buyer is the taker lifted the best ask. Each side is carried
forward until that side trades again. When the carried side has gone stale and crosses the fresh one,
the stale side is pushed one price increment off the fresh side (counted, never silent). Every state
change is kept: thinning to per-second extremes was measured to move a liquidation to the second's adverse
extreme up to a second late.

Nothing here is a strategy or an exchange rule: it is the declared derivation an import applies to
the stored complete aggTrades (market.aggtrades) before storing rows, with the checks that refuse a day the
derivation cannot trust (an aggTrade id sequence gap, a time reversal, an increment outside the stored scale).
Prices are integers at the stored scale (series.PRICE_SCALE), as agg_trade stores them.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import numpy as np
import pyarrow as pa

from market import series
from market.sources import _refuse


RULE = "binance-aggtrades-bbo-v1"


@dataclass
class State:
    """One contract's inference state carried from one day to the next."""
    bid: int | None = None
    ask: int | None = None
    last_id: int | None = None
    last_time: int | None = None
    last_trade: int | None = None  # the previous trade's last raw trade id


def derive(table: pa.Table, tick: Decimal, state: State, label: str) -> tuple[list[tuple], dict]:
    """The best bid/ask states of one day's aggTrades (agg_trade rows): [(agg_trade_id, ts, bid, ask)] at every
    change, with the day's readings, continuing `state` (updated in place). Refuses a sequence gap, a time
    reversal, a non-positive price increment, or one finer than the stored scale where a stale side is pushed."""
    if not isinstance(tick, Decimal) or tick <= 0:
        raise _refuse(f"{label}: price increment {tick} is not positive", "SOURCE_SHAPE", missing=(label,))
    units = tick.scaleb(series.PRICE_SCALE)
    step = int(units) if units == units.to_integral_value() else None
    ids = table["agg_trade_id"].to_numpy()
    times = table["transact_time"].to_numpy()
    firsts, lasts = table["first_trade_id"].to_numpy(), table["last_trade_id"].to_numpy()
    makers = table["is_buyer_maker"].to_numpy(zero_copy_only=False)
    prices = table["price"].to_numpy()
    if len(ids) == 0:
        raise _refuse(f"{label}: no trades", "SOURCE_SHAPE", missing=(label,))
    # Binance's archive gives one id twice to two distinct trades (SOLUSDT 2025-07-16): a repeated id later
    # in time whose raw trade ids follow the previous trade's is a trade of its own (user, 2026-10-31); an
    # identical or same-moment repeat is not.
    steps = np.diff(ids)
    broken = (steps != 1) & ~((steps == 0) & (np.diff(times) > 0) & (firsts[1:] > lasts[:-1]))
    continues = (state.last_id is None or int(ids[0]) == state.last_id + 1
                 or (int(ids[0]) == state.last_id and state.last_time is not None and state.last_trade is not None
                     and int(times[0]) > state.last_time and int(firsts[0]) > state.last_trade))
    if np.any(broken) or not continues:
        where = int(np.argmax(broken)) if np.any(broken) else -1
        detail = (f"after agg_trade_id {int(ids[where])} comes {int(ids[where + 1])}" if where >= 0
                  else f"the day starts at agg_trade_id {int(ids[0])}, the day before ended at {state.last_id}")
        raise _refuse(f"{label}: aggTrade ids are not contiguous ({detail})", "SEQUENCE_GAP", missing=(label,))
    if np.any(np.diff(times) < 0):
        raise _refuse(f"{label}: transact_time goes backwards", "SOURCE_SHAPE", missing=(label,))
    if np.any(prices <= 0):
        raise _refuse(f"{label}: a trade price is not positive", "SOURCE_SHAPE", missing=(label,))
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
                raise _refuse(f"{label}: price increment {tick} has more than {series.PRICE_SCALE} decimals",
                              "SCALE_LOSS", missing=(label,))
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
