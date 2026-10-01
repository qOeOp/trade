# TrialFamily short-v1: short strategies for weak crypto markets

Written before `short/run.py` exists or any signal below is scored. Crypto only, daily bars, large caps.

## Why

The surviving strategies are long-side: trend T0 (shorts near zero in trend-v1 and on the majors), B1 (shorts +0.03R
against +0.19R for longs), the 4h box break, and oversold O3 (long only). The user points out that the book then
earns much less in bear years. Diagnosis from this research:
- unconditional T0 shorts lose to violent bear-market rallies: a 50-day breakdown is late, and the 20-day exit gives
  back a lot;
- in weak markets every long setup degrades, so a market-regime gate is the natural precondition for a short.

Literature motivating the variants:
- time-series momentum works on both sides in futures (Moskowitz, Ooi and Pedersen, 2012) and in crypto (Liu and
  Tsyvinski, 2021); downside moves in crypto are faster than upside moves (negative skew of drawdowns);
- short-term reversal is pervasive in crypto, so overbought rallies inside downtrends are candidates to fade
  (the mirror of the Connors RSI(2) rule, tested here on the short side only in a bear regime);
- cross-sectional momentum losers keep losing in down markets (Daniel and Moskowitz, 2016, on crashes; the loser leg is
  where the premium sits in bear states).

## Regime

**Bear regime:** BTC's last close below its 200-day mean (known at the signal close). Each gated variant is scored only
in the bear regime; the ungated baseline is reported for reference.

## Variants (signal at a daily close, entry at the next open)

| Id | Signal                                                                                                       | Exit                                                                 |
| -- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| S0 | ungated T0 short: close below the lowest close of the prior 50 days                                          | 2 ATR(20) stop; close above the highest close of the prior 20 days   |
| S1 | S0 in the bear regime                                                                                        | as S0                                                                |
| S2 | fast breakdown in the bear regime: close below the lowest close of the prior 20 days, coin below its own 50-day mean | 2 ATR(20) stop; close above the highest close of the prior 10 days |
| S3 | bear-rally fade: bear regime, coin below its 200-day mean, RSI(2) above 95                                   | stop at the signal high + 0.5 ATR; target half way to the 10-day low; 10 days |
| S4 | failed bounce: bear regime, coin below its 50-day mean, the close back below the prior day's low after a 3-day rally of at least 8% | stop at the 3-day high + 0.5 ATR; target the low before the rally; 10 days |
| C1 | weekly short of the bottom fifth by 28-day return, only in bear-regime weeks                                 | rebalanced weekly, Monday open to Monday open                        |

- S0-S2 use the trend-v1 trade walker and control: random entries of the same coin, year and side with the same
  stop, exit and time limit. One open trade per coin per variant.
- S3 and S4 use the range-v2 scorer and control: random entries matched on year, side, stop in ATR, target in R and
  time limit. Signals with target under 1R or stop over 6 ATR are dropped; one signal per coin per 5 days.
- **Costs:** 0.06% per side. The perpetual funding charge of trend-v1 (0.03% per day against the position) is kept
  for S0-S2 although shorts usually receive funding, so the short results are conservative.
- C1: the short leg return is minus the bottom fifth's return, less turnover costs; it is compared with shorting the
  whole universe in the same weeks (the beta). Universe: the 17 majors plus the 20 large caps.

## Data

- **Development:** the 17 majors, 2018-2022 (bear regimes in 2018, 2019 and 2022).
- **Holdout:** the 17 majors and the 20 large caps of range-v4, 2023-01 to 2026-08, read once. The majors' 2023-2026
  T0 shorts were seen descriptively in trend-v1 (near zero, ungated); no gated short was scored there.

## Decision (per variant)

A variant holds when R minus control is above zero at 95% (coin-then-trade bootstrap) on development and on the holdout;
for C1, when the short leg minus the universe short is above zero at 95% (week bootstrap) on both. Also reported,
descriptive:
- per-year average R, so the bear years can be read;
- whether a holding variant improves the BTC+ETH+SOL trend book in bear years when added at 0.5% risk per trade.
