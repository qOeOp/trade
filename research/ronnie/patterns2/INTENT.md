# TrialFamily patterns-v2: flags and pennants after an impulse, traded with the impulse only

Written before `patterns2/run.py` exists or any bar of the holdout below is loaded.

## Why

patterns-v1 found no edge in converging triangles and wedges traded both ways. The one entry that holds in this
research is momentum (B1). The continuation pattern practitioners rate highest is a short pause after a strong impulse,
broken in the impulse's direction.

## Pattern (4h bars, decided at the close of bar i; long shown, short mirrored)

- **Pole:** the pole top `p` is the highest high of bars i-25 to i-5. The pole bottom `b` is the lowest low of bars
  p-12 to p. The height `h[p] - l[b]` must be at least 4 ATR(14) at p.
- **Flag:** the bars p+1 to i-1, from 4 to 20 bars.
  - its low stays above `h[p] - 0.5 x height` (at most a half retracement);
  - its high stays at or below `h[p]`.
- **Breakout:** bar i closes above the flag high, and bar i-1 did not. A pole gives at most one signal.
- **Stop and target:** the stop is at the flag low, and the target at entry plus the pole height.
- **Filters and exits:** signals whose target is under 1R or whose stop is over 6 ATR are dropped. The time limit is 30
  bars.

## Variants (two, fixed)

- **F-raw:** the pattern above.
- **F-trend:** F-raw, with the daily close on the pole's side of its 50-day mean (closed daily bars only).

## Test

- **Scoring:** each signal against 20 random entries of the same year, side, stop in ATR and target in R (as
  patterns-v1). Costs are 0.06% per side on crypto and 0.005% per side on FX.
- **Development:** BTCUSD and ETHUSDT, 2017-2022, at 95%.
- **FX:** the nine majors, in sample 2017-2022 (95%) and out of sample 2023-2026 (90%).
- **Holdout (never used by any family):** PYR, CVX, TLM, SLP, QI, MOVR, AGLD, RAD, XVS, BNT, RLC, CVC, POWR and PHA,
  the rest of the same coverage check, 2022-2026, read once, with a coin-then-signal interval (95%).
- **Decision (per variant):**
  - **Crypto:** holds when the development and holdout intervals of R minus control are both above zero.
  - **FX:** holds when both FX intervals are above zero.
