# Autonomous R&D loop: log

Each loop is registered here (hypothesis, source, change, run) and committed before it runs; its result, attribution
and next step are appended after the run.

## Family A: "support holds in a trend" (assume the level holds while the trend is intact)

Sources:
- Osler (2000, FRBNY Economic Policy Review, "Support for Resistance"; 2003, Journal of Finance): published support and
  resistance levels predict intraday trend interruptions, explained by clustered take-profit orders at levels and
  stop-loss orders just beyond them.
- Time-series momentum in crypto (Rohrbach et al., 2017; "Dynamic time series momentum of cryptocurrencies", 2021):
  trends persist, so a level in the trend's direction has the trend behind it.
- Community practice (buy support in an uptrend, sell resistance in a downtrend, enter on a rejection candle, stop
  beyond the level, target the prior swing).
- This research: unconditional level fades fail because a tested edge usually breaks (range-v3: 48-70% of tests);
  4h EMA20 pullbacks on BTC and ETH were flat (setups-v1 P1). Hence: trend-aligned only, daily levels, rejection
  confirmation.

### Loop A1 (registered before running)

- **Hypothesis:** in a daily uptrend (close above the 200-day mean and the 50-day mean above the 200-day mean), an
  intact daily swing-low support (order 3, `level_book`) that is tested and rejected holds; mirror for downtrends and
  resistance.
- **Signal:** the day's low reaches within 0.25 ATR(14) of the support and the day closes above it; entry at the next
  open.
- **Exits:** stop at the support minus 1 ATR; target the highest high of the prior 20 days; time limit 20 days;
  signals with target under 1R or stop over 6 ATR are dropped; one signal per coin per 5 days.

**Result A1:** iteration gate fails. 781 trades, avg R -0.120, edge -0.252 [-0.374, -0.130]; 2018-2020 -0.216,
2021-2022 -0.276. Random entries of the same geometry earn +0.132, so the entry selects bad moments.

**Attribution A1:**
- **Stops:** 62% of trades are stopped.
- **Every tercile is negative.** The losses are smallest for levels touched at least once before (-0.130 against
  -0.351 for untouched levels), for recent levels (age 1-4 bars, -0.120), early in the trend (-0.162 against -0.346 far
  from the 200-day mean), and with wider stops (-0.175 against -0.325).
- **Sides:** longs and shorts are alike (-0.265 and -0.242).

### Loop A2 (registered before running)

- **Single change from A1:** trade only levels with at least two prior touches.
- **Reason:** the A1 attribution (touched levels lose least), Osler's order clustering at widely watched levels, and
  the community rule that a level tested more often is stronger.

**Result A2:** iteration gate fails. 225 trades, avg R -0.139, edge -0.287 [-0.482, -0.061]. The A1 attribution did not
carry over: among the A2 trades, more touches were no better, so tercile attribution is chasing noise.

**Attribution A1/A2 (new decomposition, `engine.decompose`):**
- **When the stops come:** 62% of trades are stopped, but only about 30% of those within 2 bars.
- **How little the trade moves first:** the median favourable excursion before the stop is 0.26-0.29R, and only 9%
  of stopped trades first reached +1R.
- **Reading:** the level "holds" for a day, the bounce has no follow-through, and the level breaks later. This fits
  Osler: levels interrupt trends rather than reverse them.

### Loop A3 (registered before running)

- **Single change from A1 (A2's touch rule is dropped):** enter only on confirmation. A buy stop at the rejection
  day's high (a sell stop at its low for shorts) is valid for the next 2 bars and filled at the trigger, or at the open
  on a gap; otherwise the signal is cancelled. Stop and target are unchanged.
- **Reason:** the decomposition shows bounces without follow-through. The community's "wait for confirmation" rule
  and the price-action signal-bar trigger keep only the bounces that move.

**Result A3:** iteration gate fails, but it is the best so far. 411 trades, avg R -0.037, edge -0.157 [-0.294, -0.014];
2018-2020 -0.097, 2021-2022 -0.194.

**Attribution A3:**
- **Immediate stops fall:** stops within 2 bars drop from 31% to 12% of stopped trades, so confirmation removes the
  bounces that fail at once.
- **Stalled trades remain:** 47% of trades are still stopped, after a median MFE of 0.45R. The trade stalls, then
  fails.

### Loop A4 (registered before running)

- **Single change from A3:** add a time stop. Exit at the close of the 5th bar if the trade has not yet reached +1R.
  The control trades get the same time stop.
- **Reason:** the decomposition shows stall-then-fail losses. The time stop ("if it does not work quickly, get out")
  is a standard practitioner rule (Van Tharp; Brooks).

**Result A4:** iteration gate fails. 411 trades, avg R -0.069, edge -0.128 [-0.230, -0.026]. The time stop lowered
both the trades and their controls (control +0.059 from +0.120), so the narrower gap is not progress: the absolute
result got worse. The time stop is dropped.

### Loop A5 (registered before running)

- **Single change from A3:** levels from weekly swing points (order 2 on weekly bars, known at the open of the week),
  instead of daily order-3 swings. Confirmation entry, stop, target and time limit as in A3.
- **Reason:** Ronnie's titles lean on weekly levels; the community holds that higher-timeframe levels are stronger;
  that fits Osler's mechanism of orders clustering at widely watched levels. The daily swings tested so far are minor
  levels.

**Result A5:** iteration gate fails, but it is the first positive loop. 58 trades, avg R +0.240, edge +0.123
[-0.265, +0.518]; 2018-2020 +0.649 (21 trades), 2021-2022 -0.175 (37 trades). Stops fall to 34% of trades, 10% of
them within 2 bars. Weekly levels hold better, but they are touched rarely: the sample is too small to decide.
(The "age" feature mixes weekly and daily bar indices here and is not usable.)

### Loop A6 (registered before running)

- **Single change from A5:** execute on 4h bars. The levels stay weekly and the trend stays daily (the last closed
  day). Touch, confirmation, stop (level minus 1 ATR of the execution bars), target (the prior 20-bar high) and time
  limit (20 bars) keep their bar-unit definitions.
- **Reason:** higher-timeframe location with a lower-timeframe trigger is the multi-timeframe practice of Ronnie and the
  community. It raises the number of tests of the weekly levels without loosening the level definition.

**Result A6:** iteration gate fails. 125 trades, avg R +0.014, edge -0.032 [-0.342, +0.250]; 2018-2020 +0.099,
2021-2022 -0.113. The 4h execution diluted A5.

**Attribution so far (A1-A6):**
- **Level size:** weekly levels beat daily swings (A5 against A3).
- **Entry:** confirmation beats a next-open entry (A3 against A1).
- **Volatility:** low-volatility tests (ATR14 below ATR100) did best in A2, A3 and A6.
- **Period:** 2018-2020 beats 2021-2022 in every loop.

### Loop A7 (registered before running)

- **Single change from A5:** a touch tolerance of 0.5 ATR instead of 0.25.
- **Reason:** traders draw levels as zones, not lines, and Osler finds stop orders clustered just beyond levels. A zone
  raises the number of tests of the weekly levels without lowering the level's rank.

**Result A7:** iteration gate fails; the best loop so far. 81 trades, avg R +0.262, edge +0.163 [-0.162, +0.490];
2018-2020 +0.556, 2021-2022 -0.033. Stops 31%, 8% of them within 2 bars.

### Loop A8 (registered before running; the last loop of the family budget)

- **Single change from A7:** trade only when ATR(14) is below ATR(100), that is volatility below its long-run level.
- **Reason:** the low-volatility advantage appeared in the same direction in four loops (A2, A3, A6, A7), not once.
  Mechanism: levels hold in quiet markets and break in volatile ones. The cut is the natural 1.0, not a tercile
  boundary.

**Result A8:** iteration gate fails narrowly. 51 trades, avg R +0.450, edge +0.407 [-0.041, +0.858]; 2018-2020 +0.609,
2021-2022 +0.287; stops 35%, 6% of them within 2 bars.

**Family A closes** (budget of 8 loops reached). The edge against random rose from -0.252 (A1) to +0.407 (A8) through
three changes that each had a mechanism: weekly levels, confirmation entries, and the low-volatility gate. The final
configuration has too few trades to decide, and it was reached by inspecting the iteration tier eight times, so its
estimate is optimistic. Under the protocol it is not sent to validation. It is recorded as a near miss for the
forward record.

## Family B: "a broken level runs" (assume the break continues)

Switch reason: Family A's attribution (levels interrupt rather than reverse; bounces lack follow-through) and Osler's
second finding: after a level is crossed, clustered stop orders make the move unusually fast. Sources also include
the trading-range break of Brock, Lakonishok and LeBaron (1992) and crypto time-series momentum. The surviving
breakout entries of this research (B1, the 4h box break, daily trend) belong to this family; Family B asks whether
weekly levels make the break stronger.

### Loop B-1 (registered before running)

- **Signal:** in the daily trend of Family A (close and 50-day mean above the 200-day mean for longs; mirror for
  shorts), the day closes beyond an intact weekly swing level (order 2) in the trend's direction that the prior day's
  close had not crossed. Entry at the next open.
- **Exits:** stop at the broken level minus 1 ATR(14) (back inside); target 3R; time limit 20 days; stops over 6 ATR
  dropped; one signal per coin per 5 days.
