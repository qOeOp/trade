# Research Intent: filters on level-touch entries (TrialFamily filters-v1)

Registered 2026-09-30, before any filter result was computed. Scratch research outside every Owner path; it mirrors
the R&D Owner's discipline (docs/owners/rd.md): a falsifiable intent, a sealed trial budget, a census of every trial,
a protected holdout read once, and an iteration decision of repair, ready, or stop.

## Hypothesis

Ronnie's core entry is a touch of a horizontal support or resistance level that holds. Unfiltered, it has shown no
edge in any test here. Hypothesis: a small set of filters chosen on training data turns that entry positive on data
the selection never saw, by more than the same selection procedure achieves on random entries.

## Base signal

`s6_confirm.run_confirm(mode="zone_only", k=3)` on 4h bars, every parameter at its declared default. A 4h bar touches
the nearest zone (ronnie_plan.build_zones on 4h pivots) and closes back; entry at the next open; stop beyond the bar and
the zone; target the next zone, at least 2R; 60-bar time exit. R is net of the BTC cost model (maker/taker fees, 8-hourly
funding), a rough stand-in for FX spread and swap.

## Markets and data

BTC/USD (Bitstamp), ETH/USDT (Binance hourly klines), and nine FX majors (FXCM hourly bid candles): EURUSD, GBPUSD,
USDJPY, AUDUSD, NZDUSD, USDCAD, USDCHF, GBPJPY, EURAUD. The hourly bars are resampled to 4h and to UTC days.

## Candidate filters (fixed now; each is a yes/no at the signal bar, known at its close)

1. weekly trend agrees: the side equals ronnie_plan.weekly_direction (weekly close vs 20-week SMA and 12-week return)
2. daily trend agrees: the side agrees with the daily close against its 50-day SMA
3. calm: 4h ATR below its 120-bar median
4. squeeze: Bollinger bandwidth in its bottom 30% within the last 10 bars (ronnie_plan features "squeezed")
5. resonance: the signal level lies within 0.5 4h-ATR of a daily zone that overlaps a weekly zone (tv_mtf)
6. trend line: a valid 4h trend line (s6 line rule) lies inside the zone +- 0.25 ATR
7. reward/risk >= 3 at entry
8. tested level: the zone has at least 3 touches
9. strong candle: signal bar body >= 60% of its range
10. tight stop: stop distance at or below the market's median stop distance in the training segment

## Trial budget (sealed)

Every combination of up to three filters: 1 + 10 + 45 + 120 = 176 trials, each scored on every segment. Nothing else is
searched in this family: no filter thresholds, base parameters or markets are tuned.

## Segments (purge: a trade belongs to the segment of its entry; 10-day embargo at each boundary)

- train 2017-01-01 .. 2020-12-21
- validation 2021-01-01 .. 2022-12-21
- test (protected) 2023-01-01 .. 2026-09-30, read once, for the single selected combination and the unfiltered base

## Selection rule

Among combinations with at least 30 train trades and 15 validation trades pooled over all markets, and a positive
train avgR, pick the highest validation avgR. Ties go to fewer filters.

## Falsifier and null

The same selection procedure runs on 50 placebo event sets. Each set has one random-bar entry per real event, same
market, year, side, and stop and target geometry in ATR, with the filters evaluated at the random bar. The intent is
falsified unless the selected combination's test avgR (a) exceeds the unfiltered base's test avgR and (b) exceeds the
95th percentile of the placebo-selected combinations' test avgR.

## Stop rule

Iteration 1 decides. Falsified: stop the family and search no further filters on this base. Passed: the result is
READY_FOR_SELECTION in scratch terms only; it authorizes nothing beyond a written report. Repair is allowed only for a
defect in data or code, never because of a result, and every repaired run stays in the census.

## Census

`filters/census.csv` records every trial (combination x segment, real and placebo summaries) and
`filters/decision.md` the iteration decision.
