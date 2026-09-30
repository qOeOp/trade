# TrialFamily stops-v1: a stop behind a line, or an ATR stop?

Written before `stops/run.py` exists.

## Question

With the entry held fixed, does a stop behind a structural line pay more per unit of risk than the signal-bar stop or
an ATR stop? Sizing is by risk, so average R net of fees is the measure. Each trade risks the same fraction whatever its
stop distance.

## Entries (held fixed)

The entries are B1, trendline_break_strong and line_break_ridge, frozen as committed. Each enters at the next 4h open.

## Stops (target 2R of each stop; time limit 30 bars; stop first)

| Id | Stop for a long (short mirrored)                                                                              |
| -- | ------------------------------------------------------------------------------------------------------------- |
| S0 | the signal's own stop, the signal bar's opposite extreme (the base)                                           |
| S1 | entry minus 1.5 ATR                                                                                           |
| S2 | behind support: the highest intact confirmed order-3 swing low below the entry, minus 0.25 ATR               |
| S3 | behind the broken line: the line the signal bar broke (the highest level or trend-line value it closed through), minus 0.25 ATR; B1 uses the prior 20-bar high it broke |

- **Unusable stops:** a stop closer than 0.3 ATR or farther than 6 ATR is unusable. That entry is dropped from every
  variant, so all variants score the same entries.
- **Fill model:** the setups-v1 trade function, at 0.06% per side.

## Test and decision

- **Paired measure:** per entry, R(Sk) - R(S0), for k = 1, 2, 3.
- **Development:** BTCUSD and ETHUSDT 2017-2022, with a 95% bootstrap interval.
- **Holdout:** the 20 coins of patterns-v1, 2021-2026, with a 95% coin-then-signal interval, read once.
- **Decision:** a stop beats S0 when both intervals are above zero. The family also reports how often each stop is hit
  and the median stop distance in ATR.
