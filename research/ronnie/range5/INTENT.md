# TrialFamily range-v5: the instrument as a factor - do some coins stay range-bound, and does fading boxes work on them?

Written before `range5/run.py` exists or any measure below is computed. Crypto only (PAXG, a gold-backed token, is
included as the gold reference the user named).

## Why

The user points out that instruments differ in character: gold tends to trend up, while crude oil swings inside
ranges. A range strategy should therefore be run on range-bound instruments, as a trend strategy is on trending ones.
range-v3 gated fades by the market's state at the moment (variance ratio, ADX). It never asked whether a coin's own
character is range-bound, and whether that character persists. Persistence is what makes the idea tradable.

## Universe and periods

- **Coins:** the 37 large caps of range-v4 (17 majors and 20 large caps) plus PAXG, on Binance hourly klines resampled
  to 4h and 1d.
- **Walk-forward years:** 2019 to 2026 (2026 runs to August). Each coin enters a year once it has a full prior year.

## Character scores (computed from the prior calendar year only)

- **VR, the daily variance ratio:** VR(5) of daily log returns, where a lower value means more mean-reverting.
- **HOLD, box-edge holding:** among 4h box-edge tests in the prior year (range-v2 boxes; the bar reaches within 0.5
  ATR of an edge), the share where price then reached the box middle before closing 1 ATR beyond the edge. A higher
  value means more range-bound.

## Trades (unchanged rules from earlier families, 4h)

- **FADE:** range-v2 C, the rejection close at a box edge (stop 0.5 ATR beyond the edge, target the far edge, 0.25 ATR
  inside).
- **BREAK:** range-v3 X1, the box breakout (stop at the box middle, target one box width).
- **Scoring:** both are scored against 20 random entries matched on year, side, stop in ATR, target in R and time
  limit, at 0.06% per side.

## Tests and decisions (fixed)

- **T1, persistence:**
  - **Measure:** across coin-years, the Spearman correlation between the prior-year score and the same coin's FADE
    edge (R minus control) in the year.
  - **Bootstrap:** 95% interval by bootstrapping coins.
  - **Decision:** character persists if the HOLD correlation (positive) or the minus-VR correlation is above zero.
- **T2, allocation by character:** each year, rank coins by HOLD.
  - **Rule:** FADE is traded only on the top third and BREAK only on the bottom third.
  - **Comparisons:** each against the same trade on all coins and on the other thirds.
  - **Decision:** the allocation holds if top-third FADE has edge above zero (95% coin-then-signal interval) and above
    all-coin FADE, or bottom-third BREAK has edge above zero and above all-coin BREAK.
- **Also reported:** each coin's average scores (PAXG among them), and the same allocation with VR in place of HOLD
  (not decided).
- **Status:** these coins were used before for other rules, and the 2023-2026 large-cap breakout results of range-v4
  are known. A positive result is therefore a lead for the forward record, not a final verdict.
