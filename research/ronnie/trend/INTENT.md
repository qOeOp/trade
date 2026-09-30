# TrialFamily trend-v1: daily trend following and cross-sectional momentum, with lines guiding execution

Written before `trend/run.py` exists or any bar of the holdout below is loaded. Crypto only.

## Why

Across this research the one entry that held on unused coins is momentum: a strong candle through a price. The edge
is real but thin, and fees take half of it. Slower trend following trades less, so costs weigh less. The user also
asks whether lines and multiple timeframes can guide its entry, stop and exit. Each such variant is therefore scored
paired against the plain rule on the same signals.

## Baseline T0 (daily bars, UTC days from Binance hourly klines)

- **Long:** the close is above the highest close of the prior 50 days. Entry is at the next day's open.
- **Stop:** the initial stop is entry minus 2 ATR(20).
- **Exit:** at the close, when the close is below the lowest close of the prior 20 days; or at the stop, intraday, gap
  fills at the open.
- **Short:** mirrored.
- **Limits:** one open trade per coin and side. The time limit is 250 days.
- **Costs:** 0.06% per side, plus funding of 0.03% of notional per day held, always paid. Both are expressed in R.
- **Control:** 20 random entry days on the same coin, year and side, with the same stop and exit rules.

## Line and timeframe variants (paired with T0 on the same signals)

- **E-line, retest entry:** after the signal, a limit order sits at the broken 50-day level for 10 days. The stop is
  2 ATR below the fill and the exit is as in T0. If there is no fill, the trade is missed and counts as 0R.
- **S-line, stop behind structure:** the initial stop is the nearest intact daily swing low of order 3 below the entry,
  minus 0.25 ATR. When that stop lies outside 1 to 6 ATR, T0's 2 ATR stop is used.
- **X-line, target at weekly structure:** take profit at the nearest intact weekly swing level of order 2 beyond the
  entry, when it is at least 2R away. T0's channel exit stays active.
- **F-mtf, weekly filter:** keep a signal only when the last closed weekly close is on its side of the 20-week mean.
  Kept is compared with dropped.

## Cross-sectional momentum C0 (weekly)

- **Rule:** each Monday 00:00 UTC, rank the universe by its 28-day return. Hold the top fifth equally weighted for one
  week, and compare with the whole universe equally weighted.
- **Also reported:** top fifth minus bottom fifth.
- **Costs:** 0.06% per side on turnover.

## Data

- **Development:**
  - T0 and its variants: BTC, ETH and the 15 altcoins of altcoins-v1, 2018-2022.
  - C0: the universe of every coin used so far (the 17 above plus the filters-v2, patterns-v1, mtf-v1, volume-v1,
    volume2-v1 and patterns-v2 sets), 2019-2022.
- **Holdout (never used by any family):** GNO, PUNDIX, HFT, MAGIC, GMX, LQTY, SSV, ID, EDU, ARKM, WLD, APT, ARB, SUI,
  PENDLE, JOE, OSMO, XNO, POLYX and STG. These are the first 20 with archive bars for 2023-07 and 2026-08. Signals run
  2023-10 to 2026-08, and the holdout is read once.

## Decisions (95%; development by bootstrap over trades or weeks, holdout by coin-then-trade or weeks)

- **T0:** holds when R minus control is above zero on both sets. Long and short are also reported apart.
- **Each line variant:** adopted when its paired difference from T0 (F-mtf: kept minus dropped) is above zero on both
  sets.
- **C0:** holds when top minus universe is above zero on both sets.
