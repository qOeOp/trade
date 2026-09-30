# TrialFamily patterns-v1: breakouts from converging triangles and wedges, raw and confirmed

Written before `patterns/run.py` exists or any pattern signal is scored.

## Pattern (4h bars, decided at the close of bar i)

- **Pivots:** swing pivots of order 5, used only once confirmed (5 bars later).
- **Lines:**
  - the upper line runs through the last two confirmed swing highs;
  - the lower line runs through the last two confirmed swing lows;
  - all four pivots lie within the 80 bars before i, and the earliest of them is at least 20 bars before i.
- **The pattern qualifies if all three hold:**
  - the lines converge: the width at bar i is under 0.6 times the width at the earliest pivot, and the lines have not
    crossed by bar i;
  - the width at bar i is at least 1.5 ATR;
  - the last pivot is at most 30 bars before i.
- **Shapes covered:** every converging shape, meaning symmetric, ascending and descending triangles, and rising and
  falling wedges.
- **Breakout:** bar i closes above the upper line (long) or below the lower line (short), and bar i-1 closed inside.
  A pattern (its four pivots) gives at most one breakout per side.
- **Stop:**
  - long: the lower of the last swing low and the lower line at bar i;
  - short: mirrored, using the last swing high and the upper line.
- **Target:** the measured move, entry plus or minus the pattern's width at its earliest pivot.
- **Filters and exits:** signals whose target is under 1R or whose stop is over 6 ATR are dropped. The time limit is 30
  bars, and the stop is taken first when both are touched.

## Variants (three, fixed)

- **W-raw:** the breakout as above.
- **W-confirm:** the breakout bar must also have a body of at least 0.5 ATR and a close in the outer 30% of its range.
  On crypto, its volume must be at least 1.2 times the mean of the prior 20 bars; FX has no volume.
- **W-retest:** a follow-up entry rather than a filter. Within 10 bars after a W-raw breakout, a bar trades back to
  within 0.25 ATR of the broken line (its value at that bar) and closes back in the breakout direction. Entry is at the
  next open, with the same stop and target levels.

## Test

- **Controls:** each signal against 20 random entries of the same year, side, stop in ATR and target in R (setups-v1
  method). Costs are 0.06% per side on crypto and 0.005% per side on FX.
- **Development:** BTCUSD and ETHUSDT, 2017-2022.
- **FX:** the nine majors, in sample 2017-2022 and out of sample 2023-2026.
- **Holdout (never used by any family):** the first 20 Binance USDT coins in this list with archive bars for both
  2021-06 and 2026-08. List: IOTA, KSM, RUNE, SNX, COMP, BAT, ZIL, ONT, FET, 1INCH, ENJ, KAVA, LRC, SUSHI, YFI, CELO,
  ANKR, STORJ, SXP, IOST, ONE, RVN, ICX. Signals run from 2021-01 to 2026-08, and the holdout is read once.
- **Decision (per variant):**
  - **Crypto:** holds when the development interval (95%) and the holdout coin-then-signal interval (95%) of R minus
    control are both above zero.
  - **FX:** holds when the in-sample (95%) and out-of-sample (90%) intervals are both above zero.
