# TrialFamily goldtrend-v1: the majors trend rule applied to gold

Written before `goldtrend/run.py` exists or any gold trade below is scored. The user asked how gold should be traded
now under the trend rule; the rule was validated only on crypto majors, so it is tested on gold before it is used.

## Rule (unchanged from trend-v1 T0 and majors_trend; nothing is tuned on gold)

- **Entry:** a daily close above the highest close of the prior 50 days; buy at the next open.
- **Stop:** 2 x Wilder ATR(20) below the entry, intraday; a gap below fills at the open.
- **Exit:** a daily close below the lowest close of the prior 20 days, at that close; time limit 250 days.
- **Short side:** the mirror image is scored and reported, but the claim is about the long side, the side the product
  record uses.
- **Costs:** 0.03% per side and a 0.01% per day carry charge (a conservative stand-in for a spot or perpetual swap).

## Data

`TVC:GOLD` daily bars from TradingView (spot gold, 2007 onward), cut at 2026-09-01 so the period matches the other
families. Cross-check (descriptive): `TVC:SILVER` with the same rule.

## Sets

- **Formation (descriptive):** 2008-2018. No parameter is chosen here; it only shows the rule's history.
- **Test:** 2019-01 to 2026-08.

## Controls

Each trade against 20 random entries in the same year and side with the same stop, exit and time limit (the trend-v1
control). Significance is a trade bootstrap of R minus control (one asset, so no coin level).

## Decision

The long rule holds on gold when R minus control is above zero at 95% on the test period. Also reported, descriptive:
- per-year R;
- a 1%-risk long-only book (spot, at most 1x, 0.03% per side) against buy and hold: CAGR, maximum drawdown, Sharpe;
- the rule's current state on the last bar.
