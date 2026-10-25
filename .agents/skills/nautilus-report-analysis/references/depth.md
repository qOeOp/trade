# Fill size against published depth

Read before reading fill sizes, liquidation prices or slippage of a quote-execution run. The
environment fills every order whole at the best bid or ask in force and models no depth, so a fill
larger than what rested near that price is one the market could not have taken at that price.
This checks size, not the freshness or accuracy of the inferred bid/ask: apply
[quote readiness](../../research-start/references/readiness.md#inferred-quotes-and-low-activity)
separately. The two-minute snapshot pairing below is only a depth-comparison rule, not a quote
freshness cutoff or liquidation suitability threshold.

- Binance publishes a depth snapshot about once a minute for every USDⓈ-M contract:
  `https://data.binance.vision/data/futures/um/daily/bookDepth/SYMBOL/SYMBOL-bookDepth-YYYY-MM-DD.zip`
  (with a `.CHECKSUM` beside it), columns `timestamp, percentage, depth, notional`: for each band
  `percentage` in ±1…±5 the resting quantity (`depth`, base units) and notional between the best
  price and that distance. Negative bands are bids (a sell hits them), positive bands are asks (a buy
  hits them). Download into a fresh empty directory under /tmp and verify the checksum first.
- Pair each fill from `tables()` with the last snapshot at or before the fill's time on the same UTC
  day; a fill more than two minutes after the last snapshot, or before the day's first, is unverified
  and counted separately. Compare the fill's quantity with the `-1` band for a sell and the `1` band
  for a buy.
- Report: fills checked, fills exceeding the 1% band (liquidation fills among them, by their
  `LIQUIDATION-` client order id), fills unverified, and the largest ratio of fill quantity to band
  depth. Say the environment fills at the best price without depth and that the quotes are inferred
  from trades. Never scale a fill, its price or the run's result by the depth.

```python
# uv run --frozen python /tmp/RUNDIR/depth.py, with fills from tables(...)["fills"] and the day's bookDepth CSV
import csv
from datetime import datetime, timezone
rows = sorted((datetime.fromisoformat(r["timestamp"]).replace(tzinfo=timezone.utc), int(r["percentage"]), float(r["depth"]))
              for r in csv.DictReader(open(BOOKDEPTH_CSV)))
def band(at, side):  # the last snapshot at or before `at`, within two minutes
    wanted = -1 if side == "SELL" else 1
    found = [(t, d) for t, p, d in rows if p == wanted and t <= at]
    return found[-1][1] if found and (at - found[-1][0]).total_seconds() <= 120 else None
```
