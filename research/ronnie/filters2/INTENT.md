# TrialFamily filters-v2: three filters suggested by the book, tested on 20 coins never used

Written before any bar of the 20 coins below is loaded or any signal on them is scored.

## Why

The descriptive analysis of the 17-coin book suggested three filters. That data is used up, so it cannot test them.
- **Tight stops:** trades with stops under 2% of price paid 0.09R in fees against a gross of 0.11R.
- **Agreement:** trades where two or three strategies fire together did better in both periods of risk-v1.
- **Busy markets:** months with many book-wide signals were much worse. Those are probably choppy markets producing
  false breaks.

## Data (fixed now, chosen by archive coverage, not by result)

- **Coins:** NEAR, UNI, AAVE, ALGO, VET, ICP, SAND, MANA, AXS, EGLD, THETA, XTZ, NEO, ZEC, DASH, CHZ, GRT, CRV, HBAR and
  QTUM against USDT. These are Binance spot hourly klines, taken as the candidates from a coverage check (2021-06 and
  2026-08 both present) in the order checked, dropping EOS, which lacks 2026-08.
- **Period:** signals from 2021-01-01 (or later, as history allows) to 2026-08.
- **Strategies:** B1, trendline_break_strong and line_break_ridge, frozen as committed, scored by
  `combo/harness.score`. The scoring uses its fill model, 0.06% per side, and 20 random controls with the same year,
  side, stop in ATR and target in R.

## Filters

| Id | Keep a signal when                                                                                      |
| -- | ------------------------------------------------------------------------------------------------------- |
| F1 | its stop distance at entry is at least 2% of the entry price                                            |
| F2 | at least two of the three strategies fire on that coin, side and 4h bar                                |
| F3 | the number of signals on all 20 coins in the prior 30 days is at most the median of that count over the prior 365 days |
| F4 | F1 and F2                                                                                               |

## Measures and decision

- **Base:** the edge (R minus control) of all signals, overall and per strategy, with a 95% coin-then-signal bootstrap
  interval. This also replicates combo-v2 on unseen coins.
- **Per filter:**
  - the edge of kept signals;
  - the edge of dropped signals;
  - kept minus dropped, with 95% coin-then-signal bootstrap intervals.
- **Decision:** a filter holds when two conditions are both met.
  - the kept edge interval is above zero;
  - the kept-minus-dropped interval is above zero.
- **Budget:** one run. Nothing is retuned after it. A filter that holds goes into `combo/forward.py` scoring as a
  labelled subset; it does not replace the base.
