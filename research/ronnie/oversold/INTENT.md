# TrialFamily oversold-v1: buying crypto after an oversold drop

Written before `oversold/run.py` exists or any signal below is scored. Crypto only, long only, daily bars.

## Why

The user points at LITUSDT, which fell from 5.57 to 3.61 (about -32%) in six days in late September 2026. Two pieces
of evidence point different ways.
- **Literature:** it reports short-term reversal in crypto. Cross-sectionally, coins with low last-day returns
  outperform; reversal is also linked to overreaction and to liquidation cascades.
- **This research:** range-v3 found that fading big hourly volume spikes does worse than random. Daily-scale
  capitulation is a different horizon, so it is tested here.

## Signals (at a daily close; entry at the next open; one signal per coin per 5 days)

| Id | Oversold condition                                                                                           |
| -- | ------------------------------------------------------------------------------------------------------------ |
| O1 | crash: the close is at least 25% below the highest high of the prior 10 days                                |
| O2 | RSI(2) below 5 (the Connors short-term oversold rule)                                                        |
| O3 | capitulation: 3-day return at most -15%, volume at least 2.5 times the prior 20-day mean, and the close in the upper half of the day's range |
| O4 | dip in an uptrend: RSI(2) below 5 and the close above its 200-day mean                                      |

## Exits (all variants)

- **Stop:** the signal day's low minus 0.5 ATR(20).
- **Target:** half of the way back from the close to the highest high of the prior 10 days.
- **Signals dropped:** those whose target is under 1R or whose stop is over 6 ATR.
- **Time and costs:** the time limit is 10 days, the stop is taken first, and the cost is 0.06% per side.
- **Control:** each signal against 20 random entries of the same coin and year, matched on stop in ATR, target in R and
  time limit.
- **Also reported:** the raw forward close-to-close returns at 1, 3, 5 and 10 days after the signal, against the same
  coin's mean over all days (descriptive).

## Data: large caps

- **Development:** the 17 majors (BTC, ETH, BNB, XRP, ADA, SOL, DOGE, LTC, TRX, LINK, DOT, AVAX, BCH, ETC, XLM, ATOM
  and FIL), 2018-2022.
- **Holdout:** the 17 majors 2023-01 to 2026-08, plus the 20 large caps of range-v4 (NEAR, UNI, AAVE, ICP, APT, ARB,
  SUI, OP, INJ, TIA, SEI, PEPE, SHIB, HBAR, ALGO, FET, WLD, IMX, STX and LDO), 2023-01 to 2026-08. No oversold rule has
  been scored on them. The holdout is read once.

## Decision (per variant)

A variant holds when R minus control is above zero at 95% on development (coin-then-signal bootstrap) and on the
holdout.
