# TrialFamily timing-v1: must a 4h line break wait for the 4h close?

Written before any variant below is run.

## Question

The entries in combo-v2 act on a 4h close through a line and enter at the next 4h open. The forming 4h bar already
shows 1h, 15m and 5m closes. Acting on the first lower-timeframe close through the same line enters earlier and at a
nearer price. It also takes the breaks that the 4h close later rejects. Which effect is larger?

## Setup

- **Markets:** BTCUSDT and ETHUSDT (development markets), Binance 5m klines resampled to 15m, 1h and 4h, 2018-01 to
  2026-08.
- **Lines:** the lines at each 4h bar come from 4h bars closed before it. The same lines serve all variants.
  - intact swing levels of order 3, 5 and 8, and trend lines through the last two confirmed swings of order 5 and 8,
    as in `line_break_ridge`;
  - within one 4h bar, a horizontal level is fixed and a trend line takes its value at that bar.
- **Event:** the first close through a line on the variant's timeframe inside a 4h bar, in either direction. The side
  is the direction of the break. A line counts once, at its first break.

## Variants

| Variant | Close that triggers | Entry                 | Stop                                               |
| ------- | ------------------- | --------------------- | -------------------------------------------------- |
| 4h      | 4h close            | next 4h open          | 4h bar's opposite extreme                          |
| 1h      | 1h close            | next 1h open          | the forming 4h bar's opposite extreme so far       |
| 15m     | 15m close           | next 15m open         | the forming 4h bar's opposite extreme so far       |
| 5m      | 5m close            | next 5m open          | the forming 4h bar's opposite extreme so far       |

- **Common to every variant:** target 2R, time limit 30 x 4h, and stop first when both are touched in one bar. The path
  is walked on 5m bars.
- **Tiny stops:** a stop distance under 0.1 ATR is widened to 0.1 ATR.
- **Controls:** each variant is matched with random entries of its own. Those entries fall at random 5m-bar opens of
  the same year and side, with the same stop distance in ATR.
- **Reported per variant:** count, win rate, average R net of 0.06% per side, and the difference from its control with
  a 95% bootstrap interval.
- **Also reported:** for the lower-timeframe variants, the share of events whose 4h bar then closes back on the
  original side of the line (false breaks), and their average R.

## Decision (fixed now)

- **Baseline:** the 4h close stays the reference.
- **When an earlier close is better:** a lower-timeframe variant is better only if its edge over control exceeds the
  4h edge over control on both markets. The paired difference interval must also exclude 0.
- **Budget:** one run. This is development data, so a winner would still need future bars.
