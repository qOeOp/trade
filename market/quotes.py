"""Best bid and ask inferred from Binance aggTrades (market.quotes).

The rule `RULE`: a trade whose buyer is the maker was a sell hitting the best bid, so its price is the
best bid at that moment; a trade whose buyer is the taker lifted the best ask. Each side is carried
forward until that side trades again. When the carried side has gone stale and crosses the fresh one,
the stale side is pushed one price increment off the fresh side (counted, never silent). Every state
change is kept: thinning to per-second extremes was measured to move a liquidation to the second's adverse
extreme up to a second late.

Nothing here is a strategy or an exchange rule: it is the declared derivation an import applies to
the official archives before storing rows, with the checks that refuse a day the derivation cannot
trust (an aggTrade id sequence gap, a time reversal, a price outside the stored scale).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import numpy as np
import pyarrow as pa

from market.sources import _refuse


RULE = "binance-aggtrades-bbo-v1"


@dataclass
class State:
    """One contract's inference state carried from one day to the next."""
    bid: Decimal | None = None
    ask: Decimal | None = None
    last_id: int | None = None


def derive(table: pa.Table, tick: Decimal, state: State, label: str) -> tuple[list[tuple], dict]:
    """The best bid/ask states of one day's aggTrades: [(agg_trade_id, ts, bid, ask)] at every change,
    with the day's readings, continuing `state` (updated in place). Refuses a sequence gap, a time
    reversal or a non-positive price increment."""
    if not isinstance(tick, Decimal) or tick <= 0:
        raise _refuse(f"{label}: price increment {tick} is not positive", "SOURCE_SHAPE", missing=(label,))
    ids = table["agg_trade_id"].to_numpy()
    times = table["transact_time"].to_numpy()
    makers = table["is_buyer_maker"].to_numpy(zero_copy_only=False)
    prices = table["price"].to_pylist()
    if len(ids) == 0:
        raise _refuse(f"{label}: the archive holds no trades", "SOURCE_SHAPE", missing=(label,))
    if np.any(np.diff(ids) != 1) or (state.last_id is not None and int(ids[0]) != state.last_id + 1):
        where = int(np.argmax(np.diff(ids) != 1)) if np.any(np.diff(ids) != 1) else -1
        detail = (f"after agg_trade_id {int(ids[where])} comes {int(ids[where + 1])}" if where >= 0
                  else f"the day starts at agg_trade_id {int(ids[0])}, the day before ended at {state.last_id}")
        raise _refuse(f"{label}: aggTrade ids are not contiguous ({detail})", "SEQUENCE_GAP", missing=(label,))
    if np.any(np.diff(times) < 0):
        raise _refuse(f"{label}: transact_time goes backwards", "SOURCE_SHAPE", missing=(label,))
    rows: list[tuple] = []
    adjustments = 0
    last = (state.bid, state.ask)
    for identity, moment, maker, text in zip(ids.tolist(), times.tolist(), makers.tolist(), prices, strict=True):
        price = Decimal(text)
        if price <= 0:
            raise _refuse(f"{label}: a trade price {text} is not positive", "SOURCE_SHAPE", missing=(label,))
        if maker:
            state.bid = price
        else:
            state.ask = price
        if state.bid is None or state.ask is None:
            continue
        if state.bid >= state.ask:
            adjustments += 1
            if maker:
                state.ask = state.bid + tick
            else:
                state.bid = state.ask - tick
        if (state.bid, state.ask) != last:
            rows.append((identity, moment, state.bid, state.ask))
            last = (state.bid, state.ask)
    state.last_id = int(ids[-1])
    gaps = np.diff(times)
    readings = {"trades": int(len(ids)), "quote_changes": len(rows), "stale_side_adjustments": adjustments,
                "minutes_with_trades": int(len(np.unique(times // 60_000))),
                "trade_gap_max_ms": int(gaps.max()) if len(gaps) else 0,
                "trade_gap_p99_ms": int(np.percentile(gaps, 99)) if len(gaps) else 0}
    return rows, readings


def scaled_rows(symbol: str, rows: list[tuple], scale: int) -> list[tuple]:
    """(symbol, ts, agg_trade_id, bid, ask) with prices as exact integers at `scale`."""
    found = []
    for identity, moment, bid, ask in rows:
        values = []
        for value in (bid, ask):
            integer = value.scaleb(scale)
            if integer != integer.to_integral_value():
                raise _refuse(f"{symbol}: a quote price {value} has more than {scale} decimals", "SCALE_LOSS",
                              missing=(symbol,))
            values.append(int(integer))
        found.append((symbol, moment, identity, values[0], values[1]))
    return found
