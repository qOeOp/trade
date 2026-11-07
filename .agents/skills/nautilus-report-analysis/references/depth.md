# Fill size against published depth

The environment fills every order whole, liquidation fills included, at the best bid or ask in
force and models no depth, so a fill larger than what rested near that price is one the market
could not have taken at that price.

- Binance publishes a depth snapshot about once a minute for every USDⓈ-M contract:
  `https://data.binance.vision/data/futures/um/daily/bookDepth/SYMBOL/SYMBOL-bookDepth-YYYY-MM-DD.zip`
  (with a `.CHECKSUM` beside it), columns `timestamp, percentage, depth, notional`: for each band
  `percentage` (read it as a number; ±1…±5 are among the bands) the resting quantity (`depth`, base units) and notional between the best
  price and that distance. Negative bands are bids (a sell hits them), positive bands are asks (a buy
  hits them). Download into a fresh empty directory under /tmp and verify the checksum first.
- Pair each fill from `tables()` with the last snapshot at or before the fill's time on the same UTC
  day; a fill more than two minutes after the last snapshot, or before the day's first, is unverified
  and counted separately. Compare the fill's quantity with the `-1` band for a sell and the `1` band
  for a buy.
- Report: fills checked, fills exceeding the 1% band (liquidation fills among them, by their
  `LIQUIDATION-` client order id), fills unverified, and the largest ratio of fill quantity to band
  depth. Say the environment fills at the best price without depth and that the quotes are inferred
  from trades. Never scale a fill, its price or the run's result by the depth: the number is a flag
  on the run's realism, not a correction.
