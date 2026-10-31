# Capital use

Read before reading capital use, drawdown, holding structure or capacity. Capital use is the
context for drawdown and for the holding structure: read it first.

- Capital use is computed by the code at seal time and read from the run report, never
  recomputed: (1) time-weighted average notional over every bar of the trade window, flat bars
  counting zero, with its share of equity at the same time; (2) the peak notional, labelled as
  sampled per bar, not a tick extreme; (3) the peak locked margin, from the account, resting orders
  included; (4) time in market, the share of bars holding a position. An exposure row labelled with
  bar time T holds what was open after every event before the next bar, valued at T's MARK; a bar
  without rows held nothing. Never revalue positions or derive capital use from the account report
  alone. When the run has no exposure readings, it cannot answer capital questions: say so and put
  it in the limitations.
- Participation answers capacity questions, when size could be large against minute volume. Read
  the run report's `capital.participation@1`, sealed from the engine's per-fill minute volumes
  and never recomputed. It gives each market fill's quantity over its minute's LAST volume,
  weighted by count: the median, p95, p99 and maximum. It also gives `minute_max`, the most one
  contract filled in one minute over that minute's volume. Fills with no bar, on zero volume, above
  the volume, and the engine's own settlement and liquidation fills are counted apart. Read the
  values under the run's execution mode. Each fill's row is in `reports/fill_volumes.csv` of the
  kept directory or of a reproduction.
- When the reading is null (a run on an image without it), compute it from that directory instead.
  Take the fills from `tables()` and divide each fill's quantity by the volume of that instrument's
  one-minute LAST bar at the run's market commit (market database, read only). A fill at T belongs
  to the bar opening at T floored to the minute. Give the same figures, and say whether fills are
  weighted by count or by quantity. Record what you computed as a `search_exposure` judgment (the
  research-round skill's next decision).

```python
# uv run --frozen python /tmp/RUNDIR/participation.py, with fill from tables(...)["fills"]
from decimal import Decimal
from cli.main import market_profile
from ledger.metrics import utc_ns
from market.store import connect
with connect(market_profile(None), "reader") as market:  # None: the active market profile
    t_ms = utc_ns(fill["ts_event"]) // 1_000_000
    (raw,), = market.rows("SELECT volume FROM bar AS OF %s WHERE symbol = %s AND price_type = "
                          "'LAST' AND ts_open = %s", (MARKET_COMMIT, fill["instrument_id"].split("-")[0],
                                                      t_ms // 60_000 * 60_000))
    volume = Decimal(raw) / 10 ** market.volume_scale  # stored integer, scale a power of ten
```

- Read it against the fill model. Each bar's open, high, low and close each offer a quarter of the
  bar's volume at that price, refreshed on every bar. A resting limit order takes at most that
  quarter for each of the bar's prices it crosses, so it fills in pieces over several bars; a low
  value means many bars were needed, not low impact. A market order takes the quarter at the close
  and the rest in one fill one tick worse, in the same bar. Its participation is not capped, so a
  value above a quarter means the backtest filled more than the bar offered at that price, and
  above one more than the minute traded. Treat both as capacity warnings on modelled fills, never as
  measured execution quality.
