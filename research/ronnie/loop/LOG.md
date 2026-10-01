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

**Result B-1:** iteration gate fails. 350 trades, avg R +0.166, but the control earns +0.292, so the edge is -0.126
[-0.363, +0.130]. Shorts -0.264, longs +0.050. Stops 57%: 32% of them within 2 bars (false breaks), and 22% after first
reaching +1R.

### Loop B-2 (registered before running)

- **Single change from B-1:** longs only.
- **Reason:** shorts were weak in B-1 and across earlier families (short-v1, the trend rule's shorts, B1's shorts), a
  repeated finding consistent with crypto's positive drift, not a one-loop tercile.

**Result B-2:** iteration gate fails. 154 trades, avg R +0.445, but the control earns +0.393, so the edge is +0.052
[-0.341, +0.552]; 2018-2020 -0.084, 2021-2022 +0.181. In uptrend years random longs earn almost as much: the break adds
little timing value. Stops 56%, 43% of them within 2 bars.

### Loop B-3 (registered before running)

- **Single change from B-2:** enter after the second consecutive daily close beyond the level (the level not crossed
  by the close before those two).
- **Reason:** 43% of stops come within 2 bars, so false breaks reverse fast. "Wait for a second close" is a common
  community confirmation; it costs a later entry.

**Result B-3:** iteration gate fails. 121 trades, avg R +0.471, control +0.438, edge +0.033 [-0.295, +0.386]. Stops
within 2 bars fell from 43% to 31%, and the later entry gave the gain back.

### Loop B-4 (registered before running)

- **Single change from B-3:** trade a break only when ATR(14) is below ATR(100), that is a break out of compression.
- **Reason:** Crabel (1990) finds narrow-range days precede range expansion; the Bollinger squeeze breakout is a common
  community setup; and the low-volatility gate helped consistently in Family A.

**Result B-4:** iteration gate fails on 20 trades: avg R +0.800, edge +0.327 [-0.723, +1.346]. The sample cannot decide.

### Loop B-5 (registered before running)

- **Single change from B-4:** daily swing levels (order 3) instead of weekly. Longs only, two-close confirmation and
  the compression gate are kept.
- **Reason:** stacking conditions on rare weekly levels left 20 trades. The mechanism under test is the break out of
  compression (Crabel), not the level's rank, and daily levels give several times the sample.

**Result B-5** (after the fix in workflow note 14): iteration gate fails. 74 trades, avg R +0.706, control +0.383,
edge +0.323 [-0.209, +0.917]; 2018-2020 +0.266, 2021-2022 +0.390; stops 46%, 24% of them within 2 bars.

### Loop B-6 (registered before running)

- **Single change from B-5:** drop the two-close confirmation and enter after the first close beyond the level.
- **Reason:** B-3 showed the confirmation adds nothing net (edge +0.052 to +0.033) while it costs trades. The mechanism
  under test, the break out of compression, is untouched.

**Result B-6:** iteration gate fails. 103 trades, avg R +0.464, control +0.327, edge +0.137 [-0.383, +0.738]. Stops
within 2 bars rose from 24% to 39% of stopped trades, so in compression breaks the second close does help. B-3's
reading did not transfer.

**Power note:** at about 100 trades on the iteration tier, the 95% interval spans about +-0.55R, so only edges above
about 0.5R can pass. The +0.3R edges seen here cannot be decided at that size.

### Loop B-7 (registered before running)

- **Single change from B-5:** the broken level is the highest close of the prior 20 days (a Donchian channel) instead of
  a daily swing level.
- **Reason:** the level's rank (weekly or daily swing) showed no decisive role in either family. The Donchian break is
  the standard breakout definition (the Turtle rules; volatility-filtered breakouts in the Crabel line), and it raises
  the sample.

**Result B-7:** iteration gate fails. 78 trades, avg R +0.494, control +0.322, edge +0.172 [-0.395, +0.753]. The
Donchian level did not raise the sample.

### Loop B-8 (registered before running; the last loop of the family budget)

- **Single change from B-5:** execute on 4h bars. The levels are 4h swings of order 3, and the two-close confirmation
  and compression gate are kept in bar units. The trend is the daily trend at the last closed day.
- **Reason:** Crabel's compression work is short-horizon; the 4h box breakout was positive in three samples; 4h bars
  give an order of magnitude more breaks, which the power note says is needed.

**Result B-8:** iteration gate fails. 795 trades, avg R +0.126, control +0.096, edge +0.030 [-0.123, +0.181];
2018-2020 +0.128, 2021-2022 -0.055. With enough trades, the compression-break edge vanishes.

**Family B closes** (budget reached). Breaks of levels in the trend's direction earn in absolute terms (+0.45R a trade
on daily bars, longs) but no more than random longs of the same year. The compression gate with two-close confirmation
looked like +0.3R on daily bars (74 trades) and was +0.03R on 4h bars (795 trades), so the daily figure is most likely
small-sample noise.

## Family C: "a capitulation marks the low" (assume the selling climax holds)

Switch reason: Families A and B both found little timing value in trend-context entries. The one entry in this research
that passed a holdout on its own is oversold O3, a capitulation: a 3-day drop of 15% or more on at least 2.5 times the
20-day volume, closing in the upper half of the day. Its holdout edge was +0.62R [+0.27, +0.93], but each set held
only 30 trades. Sources: Wyckoff's selling climax; liquidation cascades in crypto (forced selling that exhausts the
sell side); short-term reversal in crypto. The family aims to raise the sample without changing the mechanism.

**Tier contamination:** O3's holdout (the 17 majors and the 20 large caps, 2023-2026) overlaps this protocol's
validation tier, which has therefore already been read for this lineage. Family C validates on the final tier only.

### Loop C-1 (registered before running)

- **Baseline:** O3 exactly as in oversold-v1 (`oversold/run.py`), on the iteration tier: stop at the signal low minus
  0.5 ATR(20), target half way back to the prior 10-day high, time limit 10 days.

**Result C-1:** iteration gate fails. 30 trades, avg R +0.175, control -0.148, edge +0.323 [-0.039, +0.732]; it
reproduces oversold-v1's development figure. Deeper drops did best (drops of 26-40%: +0.635; drops of 16-21%: +0.038).
Stops 20%; winners' median MFE 0.82R.

### Loop C-2 (registered before running)

- **Single change from C-1:** the 3-day drop is measured in the coin's own volatility: at least 1.8 ATR(20), the ATR
  taken at the start of the drop. Volume, close position and exits are unchanged.
- **Reason:** a capitulation is extreme relative to a coin's normal moves. Volatility scaling is standard in momentum
  research (Moskowitz, Ooi and Pedersen). The factor 1.8 keeps the average severity at 15%: the median ATR(20) of the
  majors over 2018-2022 is 8.2% of price, and 15/8.2 = 1.84.

**Result C-2:** iteration gate fails. 26 trades, avg R -0.388, edge -0.218 [-0.579, +0.286]. The volatility scaling
admitted drops of 10-16% on calm coins, and those lost (-0.763 for the shallowest third). Stops 50%, 46% of them within
2 bars. Attribution: capitulation is an absolute, not a relative, event. That fits the mechanism: liquidations trigger
at fixed percentage moves set by leverage, not at multiples of volatility.

### Loop C-3 (registered before running)

- **Single change from C-1:** the 15% drop may happen over 1 to 5 days (the largest drop into the signal close over
  those windows), not exactly 3.
- **Reason:** liquidation cascades unfold over one to several days, and the community describes capitulation as a crash
  "within days", not over exactly three. The absolute 15% is kept (C-2's attribution).

**Result C-3:** iteration gate fails. 39 trades, avg R +0.080, control -0.158, edge +0.239 [-0.071, +0.603];
2018-2020 -0.343 (8 trades), 2021-2022 +0.389 (31). Deeper drops did best again (the third time).

### Loop C-4 (registered before running)

- **Change:** no rule change from C-3. The iteration tier is extended under protocol amendment 1 (36 mid and large caps,
  2018-2022).
- **Reason:** C-1 to C-3 cannot decide at 26-39 trades.
