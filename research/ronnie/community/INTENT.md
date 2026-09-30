# TrialFamily community-v1: do other traders draw our lines, and do their lines hold?

Written before any community drawing is fetched or read.

## Question

Our horizontal levels and trend lines are drawn by rule from confirmed swing pivots. Two questions follow.
- **Do we draw where people draw?** Do other traders on TradingView draw their lines where our rules draw them?
- **Do their lines matter?** Do the lines those traders draw hold better than the same lines moved away?
If people draw where we draw and their lines carry no information, our lines are "correct" and the lines themselves
are the problem. If people draw elsewhere and their lines hold, our line rules are wrong.

## Data

- **Ideas:** TradingView ideas on `BINANCE:<COIN>USDT` for the 17 coins of `combo/forward.py`, from the public ideas
  listing (at most 1000 per symbol, newest first). At most 150 ideas per coin are sampled with a fixed seed, and each
  idea's chart record is fetched.
- **Drawings kept:** horizontal lines and rays (`LineToolHorzLine`, `LineToolHorzRay`). Also trend lines and rays
  (`LineToolTrendLine`, `LineToolRay`) whose two anchors both lie before the publish time.
- **Bars:** Binance public hourly klines plus TradingView's feed, the same as `combo/forward.py`.
- **Price window:** only lines within 5 ATR(4h, 14) of the last close before publishing are used.

## Our lines at publish time

These use 4h bars closed before the publish time only.
- **Levels:** intact swing levels of order 3, 5 and 8. A level is added once its pivot confirms and removed at the first
  close beyond it (as in `line_break_ridge`).
- **Trend lines:** trend lines through the last two confirmed swings of order 5 and 8, falling highs or rising lows.

## Measures

- **A. Agreement (horizontal).** The distance in ATR from each community level to the nearest of our levels. It is
  compared with the same level moved 1 to 4 ATR up or down (100 draws). Reported as the share within 0.25 ATR, and the
  median.
- **B. Agreement (sloped).** The same measure for community trend lines: the distance between line values at the
  publish time, restricted to our lines of the same slope sign.
- **C. Reaction, community.** The first touch after publishing, on 1h bars with the ATR of the last 4h bar, as in
  `tv_effect.react` with a 60 x 4h horizon.
  - **Held:** price moves 1 ATR away on the rejecting side first.
  - **Broke:** a close lands 1 ATR beyond the level first.
  Each community level is compared with the same level moved 1 to 4 ATR (100 draws). The result is the held rate minus
  the moved held rate, with a 95% interval from a bootstrap over ideas.
- **D. Reaction, ours.** The same reaction test for our nearest level above and nearest level below price at each
  publish time, against moved copies.
- **E. Consensus.** Community levels drawn within 0.25 ATR of each other by at least three different authors, within
  72 hours on the same coin, as one cluster. Its reaction is compared with moved copies, as in C.

## Decisions (fixed now)

- **Agreement:** we draw where people draw if the within-0.25-ATR share in A is at least 1.5 times the moved share.
- **Information:** a set of lines carries information if its held-minus-moved interval excludes 0 and the point
  estimate is at least +3 points.
- **Budget:** one run of A to E. No retuning of thresholds, windows or line rules after the result is read. Any later
  variant is a new family.

## Amendment (2026-09-30, after inspecting the drawing format of eight BTC ideas, before any measure was run)

- **Flat trend lines count as horizontal.** Current charts often draw a horizontal level with the trend-line tool,
  both anchors at one price. Such a line is treated as a horizontal level, not a trend line.
- **Chart layouts:** layouts can hold several charts. Drawings are read from every chart whose symbol is the coin's
  USDT or USD market, and a drawing repeated across charts counts once.
- **Zones:** rectangle zones are common, so their two edges run through measures A and C as a separate "zone edge" row.
  They do not enter the decisions above.
