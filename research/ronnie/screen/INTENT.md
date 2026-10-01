# TrialFamily screen-v1: multi-timeframe lines as a room and structure screen before a trade

Written before `screen/run.py` exists and before any entry is split by these screens.

## Why

The user's reading of Ronnie's method: lines on every timeframe map structure and position; a trade at a level is
taken only after the room to the next level against the trade and the structure behind the stop give a good
reward/risk; without that screen every touch is traded and the average reward/risk is poor. Earlier families tested
pieces of this, not the whole:
- filters-v1 had a reward/risk filter among ten, on zone touches, inside a selection that failed on test;
- first-passage showed that no stop/target geometry lifts zone-touch entries above random;
- s2b_levels and exit-v1 X8 used levels as targets, not as a screen deciding whether to trade.
This family applies the screen, fixed in advance, to the surviving entries and to the falsified box fade.

## Lines

Intact swing levels from `mtf/run.py` `level_book` on 4h (order 3), daily (order 3) and weekly (order 2) bars, each
known at the open of the bar containing the entry (built from closed bars only).

## Measures at entry (R = the trade's own stop distance)

- **room:** the distance from the entry to the nearest intact level of any of the three timeframes in the trade's
  direction, in R; infinite when there is none.
- **guard:** whether an intact level of any timeframe lies between the stop and the entry on the stop side (structure
  protecting the stop).

## Screens (keep a trade when)

| Id | Rule                    |
| -- | ----------------------- |
| G1 | room at least 2R        |
| G2 | room at least 1R        |
| G3 | guard                   |
| G4 | G1 and G3               |

## Entries and exits (reused unchanged, `exits/run.py` entries with their baseline exit X0)

B1 (4h), BOX (the 4h box breakout), TREND (daily T0, both sides) and FADE (the range-v2 C box fade, falsified). The
score is the trade's R net of costs under X0.

## Data

- **Development:** the 17 majors, 2018-2022.
- **Holdout:** the 20 large caps of range-v4, 2023-01 to 2026-08, read once.

## Decision

A screen holds for an entry when the kept trades' mean R minus the dropped trades' mean R is above zero at 95%
(coin-then-trade bootstrap) on development and on the holdout. The box fade is rescued only if, in addition, its kept
trades' mean R is above zero at 95% on the holdout. 16 entry-screen pairs; about 0.04 false passes of both sets are
expected by chance.
