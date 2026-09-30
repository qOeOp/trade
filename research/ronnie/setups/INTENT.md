# Research Intent: setup types beyond the breakout (TrialFamily setups-v1)

Registered 2026-09-30, before `setups/run.py` was written or run. Scratch research outside every Owner path, with the
same discipline as filters-v1: definitions and defaults fixed here, nothing tuned, a protected period read once.

## Question

Do trend-pullback or range setups have an edge that the level-based entries lack, and does any hold in crypto, in FX,
or both?

## Setups (4h bars; signals on a closed bar, entry at the next open; 30-bar time exit; stop first when both touch)

- B1 breakout (reference): ronnie_bt S2b at its defaults: body >= 1.5 ATR, close in the outer 25% of the bar, close
  beyond the prior 20-bar extreme. Stop at the signal bar's far end, target 2R.
- P1 trend pullback to the average: the daily close is on the trade's side of its 50-day SMA (known at the day's
  close), and 4h EMA20 is on the trade's side of EMA50. The bar touches EMA20 and closes back beyond it in the trade's
  direction (close beyond open). Stop 0.25 ATR beyond the bar, target 2R. A 6-bar cooldown per market and side.
- P2 Fibonacci pullback: take the last confirmed swing (pivot order 3) from a pivot low to a later pivot high for a
  long, or the mirror for a short. The swing must span at least 3 ATR, with the daily trend as in P1. Within 30 bars of
  the swing's end and before price breaks either end, a bar trades into the 38.2-61.8% retracement and closes back
  beyond the 61.8% level in the trade's direction. Stop 0.25 ATR beyond the 78.6% level; target the swing extreme;
  skipped when that is less than 1R. One signal per swing.
- P3 breakout, retest, confirm: a bar closes beyond the prior 20-bar extreme (the level). Within the next 10 bars a bar
  trades back through the level and closes beyond it again in the breakout's direction. Stop 0.25 ATR beyond that bar,
  target 2R. One signal per breakout.
- R1 range fade: Bollinger(20, 2) bandwidth sits in its bottom 30% over 120 bars, and the 20-bar net move is under
  2 ATR. A bar trades through the upper band and closes back inside with close below open, for a short; mirror for a
  long. Target the middle band at the signal bar; stop 0.25 ATR beyond the bar; skipped when the target is under 1R.

## Markets, costs, periods

- Crypto: BTC/USD (Bitstamp) and ETH/USDT (Binance), cost 0.06% per side.
- FX: EURUSD, GBPUSD, USDJPY, AUDUSD, NZDUSD, USDCAD, USDCHF, GBPJPY and EURAUD (FXCM bid), cost 0.005% per side.
- In-sample 2017-2022; out-of-sample 2023-2026, read once per setup and market class.
- Every signal is scored on its own, with no one-position limit.

## Control and decision

- Control: each signal gets 20 random entries in the same market and year, on the same side, with the same stop
  distance in ATR and the same target in R.
- A setup holds in a market class only when:
  1. in sample, the 95% bootstrap interval of its avgR minus the control lies above zero; and
  2. out of sample, the same difference is positive with its 90% interval above zero.
- This makes ten tests in all (five setups by two classes), counted in the trial census.
