# TrialFamily exit-v1: do bar-by-bar exits (trailing, structure, wicks, trend lines) improve strategies with an entry edge?

Written before `exits/run.py` exists or any exit below is scored. Crypto only.

## Why

Every strategy so far used static exits: a fixed stop and target, or a channel exit. A production program sees each
bar and can adjust. Two claims follow, and both are tested.
- **Claim 1:** dynamic exits improve strategies whose entries carry an edge (momentum), by letting winners run.
- **Claim 2:** dynamic exits cannot rescue strategies whose entries carry no edge. With entries at random, any exit rule
  based on past prices has zero expected value before costs.
  - **Falsification:** claim 2 fails if a dynamic exit turns the box fade positive.
- **Untested exits:** support and resistance used dynamically (structure trailing), wick rejections and trend-line
  breaks were never tested as exits. Fixed level targets and level stops were (S2b, stops-v1, trend-v1); they return
  here as a replication.

## Entries (fixed, unchanged rules)

| Id | Entry | Initial stop | Baseline exit (X0) |
| --- | --- | --- | --- |
| B1 | 4h large-body breakout (`combo/portfolio.b1_signals`) | signal bar's opposite extreme | 2R target, 30 bars |
| BOX | 4h box breakout (range-v3 X1) | box middle | one box width target, 30 bars |
| TREND | daily 50-day closing breakout, long and short (trend-v1 T0) | 2 ATR(20) | 20-day closing channel |
| FADE | 4h box fade (range-v2 C), for the falsification test | 0.5 ATR beyond the edge | far edge, 30 bars |

## Exits (each keeps the entry's initial stop unless it raises it)

- **Holding cap:** 120 bars on 4h and 250 days on daily, except where an exit states its own limit.
- **X1, ATR trailing:** stop = max(stop, highest high since entry - 3 ATR(14)), mirrored for shorts. No target.
- **X2, breakeven:** after the price reaches +1R, the stop moves to entry. The baseline target and time limit stay.
- **X3, partial:** half closes at +1R, and the rest trails as in X1.
- **X4, time only:** exit at the close of bar 30 (4h) or day 20 (daily), with the initial stop.
- **X5, structure trailing:** the stop rises to just below (0.1 ATR) each newly confirmed order-3 swing low formed after
  entry (above for shorts). No target.
- **X6, wick rejection:** exit at the close of a bar against the position. For longs, that is an upper wick at least
  twice the body and at least 0.5 ATR, with the close in the bar's lower 40%. The initial stop stays.
- **X7, trend-line break:** exit at the first close through the line of the last two confirmed order-5 swing lows
  (rising, for longs; mirrored for shorts) that exist after entry. The initial stop stays.
- **X8, level target (replication):** the target is the nearest prior confirmed order-3 swing high above entry (below
  for shorts), when at least 1R away. The initial stop stays.
- **Common:** stop first within a bar, gaps fill at the open, and the cost is 0.06% per side. R is measured on the
  initial risk.

## Data and decisions

- **Development:** the 17 majors, 2018-2022.
- **Holdout:** the 20 non-major large caps of range-v4, 2023-01 to 2026-08, read once.
- **Claim 1:** an exit is adopted for an entry (B1, BOX, TREND) when its paired average-R difference against X0 is
  above zero at 95% (coin-then-trade bootstrap) on development and on the holdout.
- **Claim 2:** it stands unless some exit gives FADE an average R above zero at 95% on both sets.
