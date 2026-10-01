# TrialFamily range-v6: preconditions that pick boxes more likely to keep ranging

Written before `range6/run.py` exists or any feature below is computed. Crypto only.

## Why

range-v3's diagnosis found that a box-edge test breaks on the tested side 48-70% of the time. The stops of those
breaks eat the gain of the boxes that do keep ranging. The user proposes looking for preconditions that select the
boxes more likely to range, before entering, rather than fading every edge.

## Events

These are range-v2 C entries: a rejection close at a box edge, entry at the next open, stop 0.5 ATR beyond the edge,
target the far edge 0.25 ATR inside. Time limit 30 bars, 0.06% per side. Each is scored against 20 random entries
matched on geometry. The value of an event is its edge, R minus control.

## Candidate preconditions (all known at the signal bar's close)

| Id | Feature | Mechanism behind it |
| --- | --- | --- |
| char90 | the coin's share of the same timeframe's box-edge tests in the prior 90 days that reached the box middle, counting only tests resolved before the signal | the coin's current range-bound character (a quarterly range-v5 HOLD) |
| touches | touches of the traded edge inside the box window | an edge more participants respect |
| width | box width over ATR | a narrow box breaks on one large bar |
| squeeze | ATR(14) over ATR(100) | volatility contraction (could mean an imminent break or a quiet range) |
| speed | move over the 3 bars before the signal bar toward the edge, in ATR | a fast approach breaks, a slow one turns |
| volume | signal-bar volume over the prior 20-bar mean | thin tests lack the push to break |
| htf | the side times the sign of (last closed daily close minus its 50-day mean) | fading with the higher-timeframe trend |

## Selection procedure (fixed now, run on development only)

- **Cuts:** on development events (the 17 majors, 2018-2022, 1h and 4h pooled), each feature is cut at its tercile
  boundaries.
- **First condition:** among the 21 cells (feature by tercile) with at least 150 development events, pick the cell
  with the highest average edge.
- **Second condition:** among cells of other features, add the one that most raises development average edge while
  keeping at least 100 events. Add it only if it raises the edge.
- **Chance check:** the same procedure is run on 200 shuffles of the development edges across events, and the
  selected edge's percentile in that null is reported.
- **Reported:** every cell's edge.

## Holdout (read once) and decision

- **Holdout:** 1h box fades on the 20 non-major large caps of range-v4, 2023-01 to 2026-08. No fade has been scored on
  that timeframe and set; range-v5 read 4h only. The rule uses the development tercile cuts unchanged.
- **Holds:** when two conditions are both met.
  - the selected rule's holdout edge is above zero (95% coin-then-signal interval);
  - the development selection beats the 95th percentile of the shuffle null.
- **Also reported:** the unfiltered holdout fade edge, as the baseline.
