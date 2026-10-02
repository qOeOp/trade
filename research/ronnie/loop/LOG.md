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

**Result C-4:** iteration gate fails on the halves rule. 76 trades, avg R +0.166, control -0.144, edge +0.310
[+0.092, +0.552] (the pooled interval passes); 2018-2020 -0.191 (15 trades), 2021-2022 +0.433 (61 trades). Stops 24%,
61% of them within 2 bars, after a median MFE of 0.06R: the stopped trades die at once, while the crash continues.

**Feature-key bug (workflow note 17):** the attribution features of every loop were keyed by (time, side) without the
coin, so coins signalling on the same day overwrote each other. Gates and decompositions are unaffected. Recomputed
terciles (`loop/reattribution.txt`):
- **A2:** its reason (touched levels lose least in A1) does not survive: corrected, -0.209 against -0.255.
- **A8:** the low-volatility pattern survives in A2, A3, A6 and A7 (not in A1).
- **C-2:** its reading (shallow drops lose) survives.

### Loop C-5 (registered before running)

- **Single change from C-4:** a confirmation entry. A buy stop at the signal day's high is valid for the next 2 bars;
  otherwise the signal is cancelled. Stop, target and time limit as before.
- **Reason:** the C-4 decomposition shows stopped trades dying within 2 bars with no favourable move. In Family A the
  same confirmation cut immediate stops from 31% to 12% of stopped trades (A3).

**Result C-5:** iteration gate fails on 15 trades: avg R +0.160, edge +0.249 [-0.228, +0.728]. Raising the entry to the
signal day's high left most signals with a target under 1R, so they were dropped. The confirmation that helped Family A
conflicts with the near target of a capitulation bounce, so it does not transfer.

## Family A reopened (protocol amendment 2)

The systematic attribution of A3 (411 trades) flags two reliable features:
- **BTC's trend:** IC +0.12, ICIR 2.6 over four years, Q5-Q1 +0.47R [+0.23, +0.70]; only the top quintile is positive.
- **Prior touches:** reliably negative, IC -0.11, Q5-Q1 -0.62R [-0.97, -0.18].

### Loop A9 (registered before running)

- **Single change from A3:** trade only with the market. Longs only when BTC's last daily close is above its 200-day
  mean, shorts only when it is below.
- **Reason:** BTC's trend is a reliable factor in A3 (market beta: a coin's support holds when the whole market is
  strong). The cut is the natural 200-day line.

**Result A9:** iteration gate fails, but better than A3. 321 trades, avg R +0.071, edge -0.085 [-0.240, +0.086];
2018-2020 -0.138, 2021-2022 -0.051. In the systematic attribution, BTC's trend stays reliable, but the gain is
concentrated in its top quintile (+0.41R); prior touches stay reliably negative (Q5-Q1 -0.66R).
- **Caveat:** the year-matched control does not neutralise the market regime within a year, so BTC's trend may be
  market timing rather than level skill (workflow note 25).

### Loop A10 (registered before running)

- **Single change from A9:** fresh levels only, with no prior touch.
- **Reason:** prior touches are reliably negative in A3 and A9. The community's supply-and-demand practice (Seiden)
  holds that the first retest of a zone is the strongest, because each test absorbs resting orders. It also explains
  A2's failure.

**Result A10:** iteration gate fails; avg R positive for the first time in this lineage. 142 trades, avg R +0.201,
edge +0.073 [-0.149, +0.299]; 2018-2020 -0.028, 2021-2022 +0.139. Through flagged factors the edge moved from -0.157
(A3) to -0.085 (A9) to +0.073 (A10). Stops 37%, 9% of them within 2 bars.

**Family A closes again; A11 is not run.** The only flagged factor in A10 is the volatility ratio, with a positive IC
(higher volatility better), the opposite of the low-volatility pattern of the weekly-level lineage (A5-A8). It was
flagged at t 2.01 among 10 features tested, so about one false flag is expected. A factor whose sign flips across
related configurations does not meet the bar (workflow note 26).

## Ledger-driven loops (protocol amendment 3: no budget)

The first cross-loop ledger (`loop/ledger.txt`):
- **Family A, admissible factors:** BTC's trend (flagged in A3, A4 and A9, positive), the coin's trend (A3 and A9,
  positive) and prior touches (A3 and A9, negative). The volatility ratio is excluded by the refinement.
- **Family B:** no factor is flagged in any loop.
- **Family C:** nothing can be flagged (rare events). Under the rare-event rule, the stop width has a negative IC in all
  5 loops (mean -0.45), and the target R a positive IC in all 5 (mean +0.16).

### Loop A11 (registered before running)

- **Change:** no rule change from A10; the sample is expanded to the extended iteration tier (53 coins, 2018-2022).
- **Reason:** A10's pooled interval spans +-0.22R on 142 trades: the gate fails for power.

**Result A11:** iteration gate fails. 346 trades on 53 coins, avg R +0.055, edge -0.081 [-0.236, +0.074]; 2018-2020
-0.284, 2021-2022 +0.002. A10's edge does not hold on the wider tier, and no factor is flagged on it.

**Loop C-6 (not run).** The ledger admits the target R for Family C (positive IC in all 5 loops; C-4 Q5-Q1 +0.575
[+0.079, +1.169]). At the community's natural minimum of 1:2, only 5 of C-4's 76 trades qualify (the 75th percentile
of target R is 1.7). Sizing that loop meant looking at those 5 trades' edge on the iteration tier (+0.206 against
+0.317 for the rest). The look is recorded in the census as a "peek" trial (workflow note 27).

### Loop A12 (registered before running)

- **Change from A9:** the levels are round numbers instead of swing levels: multiples of half a decade (for a price p,
  the step is 10^floor(log10 p) / 2), with supports below the close and resistances above. Run on the extended
  iteration tier.
- **Reason (cited mechanism):** Osler (2003) finds take-profit orders clustered at round numbers, so trends reverse
  there more often. The ledger offers no admissible factor for Family A at a natural threshold.

**Result A12:** iteration gate fails, significantly negative. 1,189 trades, avg R +0.012, edge -0.131 [-0.221, -0.038].
Round-number supports do worse than random.

**Beta check of BTC's trend (`attrib.beta_check`, workflow note 25):** random longs opened every 3 days on every coin,
with a standard geometry, earn +0.274R (A3 coins) and +0.340R (A12 coins) in the top BTC-trend quintile, against about
zero in the other quintiles. That is the same pattern as the trades. BTC's trend in Family A is market timing, not
level skill, so A9's gain was beta.

**Family A: terminal.** Every apparent gain over 12 loops resolved into one of three things:
- small-sample noise: A5-A8, and A10, which does not hold on the extended tier (A11);
- market timing: A9;
- a failing mechanism: A12.
The ledger has no admissible change left that is not beta, and the cited mechanisms tried (Osler's clustering at
watched levels and at round numbers; community zones; confirmation; fresh zones) are spent. Support bounces show no
detectable edge over random entries on daily crypto bars.

### Loop B-9 (registered before running)

- **Change from B-2 (longs, weekly breaks):** the broken level is a round number (multiples of half a decade). The
  rule fires on a daily close above a round number that the prior close was below, in the daily uptrend. Run on the
  extended iteration tier.
- **Reason (cited mechanism):** Osler (2003) finds stop-loss orders clustered just beyond round numbers, so crossing
  one triggers a cascade and a fast move. The ledger offers no flagged factor for Family B in 8 loops.

**Result B-9:** iteration gate fails. 1,053 trades, avg R +0.220, edge -0.095 [-0.233, +0.043]; 2018-2020 -0.277,
2021-2022 +0.011. Stops 59%, 27% of them within 2 bars. Round-number breaks are no better than random.

### Loop B-10 (registered before running)

- **Change from B-2:** the break day's volume must be at least 1.5 times its prior 20-day mean. Run on the extended
  iteration tier.
- **Reason (cited mechanism):** "breakouts need volume" (O'Neil's CANSLIM rule; common community practice). The
  decomposition puts 27-43% of stops within 2 bars (false breaks), the part volume confirmation is meant to remove.
  The ledger does not support it (the volume ratio's mean IC in Family B is -0.05), so it is the cited-mechanism path.

**Result B-10:** iteration gate fails. 192 trades, avg R +0.341, edge -0.074 [-0.395, +0.283]. Volume did not remove
false breaks: stops within 2 bars rose to 44% of stopped trades.

**Family B: terminal.** Over 10 loops, breaks in the trend's direction earned +0.2R to +0.5R a trade but never more
than random entries of the same year and side. The return is the regime (long in an uptrend) and the exit that lets
winners run, not the break as an entry. This matches Family A's beta finding and trend-v1's note that the exit carries
the trend rule. No flagged factor appeared in any loop, and the cited mechanisms are spent: Osler's cascades at round
numbers, Crabel's compression, volume confirmation, two-close confirmation and Donchian channels.

## Family D: "a 4h box break runs" (the range-v3 X1 lineage)

Why this family: of the surviving entries it is the closest to significance. It made +0.31R above random on
development, +0.18R on 14 unused coins and +0.13R on 37 large caps, each short of the 95% rule. Sources: Brock,
Lakonishok and LeBaron's trading-range break; Osler's stop cascades beyond levels; Crabel's range expansion.

**Tier contamination:** range-v4 read the 37 large caps over 2023-2026, which includes this protocol's validation tier.
Family D validates on the final tier only.

### Loop D-1 (registered before running)

- **Baseline:** range-v3 X1 unchanged on 4h bars of the iteration tier: a 4h close beyond the 60-bar box known at the
  bar before, entry at the next open, stop at the box middle, target one box width, time limit 30 bars; targets under
  1R dropped.

**Result D-1:** the iteration gate passes, the first loop to do so. 126 trades, avg R +0.362, edge +0.309
[+0.052, +0.554]; 2018-2020 +0.490, 2021-2022 +0.168. Stops 23%, 3% of them within 2 bars. No factor is flagged.
The iteration tier is the set on which X1 was found (range-v3 development), so this pass is not independent; the final
tier is the test.

### D-1 final read (registered before running)

The rules are unchanged. The read is once, on the final tier (12 never-used coins, from listing to 2026-08), at a level
deflated over the final reads so far: carry K1 and D-1, so k = 2 and the interval is 97.5%. It holds when the interval
excludes zero. Also reported: per year, per coin, and the IC decay of the common features.

**Result D-1 final read:** fails at the deflated level. 109 trades on the 12 never-used coins, avg R +0.241, control
+0.016, edge +0.225 [-0.090, +0.542] (97.5% interval).
- **By year:** 2023 -0.429 (5 trades), 2024 +0.310, 2025 +0.211, 2026 +0.285.
- **By coin:** 8 of 12 coins positive.
- **IC decay:** no common feature keeps its iteration relation.
- **Lineage:** X1 is now positive in four independent samples (development +0.31, 14 unused coins +0.18, 37 large caps
  +0.13, final tier +0.23), each short of its own bar. The final tier is spent for this lineage; the forward record
  (`combo/forward.py`, `box_break`) is the remaining clean test.

### Diagnosis of C-4 under amendment 4 (`loop/diagnose_c.py`, `loop/diagnose_c.txt`; no rule change)

Three competing explanations of the stopped trades (61% of stops come within 2 bars):
- **H1, the market is still crashing:** BTC's concurrent 3-day drop and the breadth of signals.
- **H2, longs are not flushed:** funding is still positive.
- **H3, an idiosyncratic collapse that keeps going:** a large coin-minus-BTC drop.

Discriminating splits (edge, stop rate):
- **BTC 3-day return at or below -10%:** -0.019, 47% stopped (36 trades). Otherwise +0.606, 8% stopped (40).
- **Coin drop minus BTC drop at or below -15%:** +0.612, 10% stopped (41). Otherwise -0.043, 46% stopped (35).
- **Funding:** 3-day funding below zero gives +0.480 (46 trades), otherwise +0.263 (19). A weak split.
- **Breadth:** 3 or more coins signalling within a day gives +0.373 (61 trades), otherwise +0.053 (15). This is the
  opposite of H1's breadth signature.

Reading: H1 and H3 point at one mechanism. A capitulation that rides a BTC crash continues; an idiosyncratic
capitulation against a steadier market reverts. H3 as stated (idiosyncratic collapses keep going) is rejected, and
breadth is not the problem: BTC's own crash is. This matches Da, Liu and Schaumburg (2014, "A closer look at the
short-term return reversal"): short-term reversal lives in the residual, not in the market component, which carries
momentum.

Ablation: without the volume condition, edge -0.180 [-0.278, -0.072] on 705 trades; without the close-in-upper-half
condition, -0.070 on 265 trades. Both components carry the edge and stay.

### Loop C-6 (registered before running; amendment 4)

- **Structural change from C-4:** the signal is an idiosyncratic capitulation. The coin's largest drop over 1 to 5 days,
  minus BTC's return over the same window, is at most -15%. The 15% threshold is reused, not re-chosen. Volume, close
  position and exits are unchanged.
- **Explanation it rests on:** H1/H3 above, with Da, Liu and Schaumburg (2014).
- **Power:** about 40-50 trades on the extended tier; the minimum detectable edge is about 0.35R.
- **Predicted:** edge about +0.45R with a lower bound about +0.1. The split was seen on this tier, so the in-sample
  estimate is optimistic; the final tier is the test.

**Result C-6:** the iteration gate passes. 30 trades, avg R +0.417, control -0.162, edge +0.579 [+0.302, +0.854];
2018-2020 +0.210 (3 trades), 2021-2022 +0.619 (27). Stops 7%. The prediction was +0.45 with a lower bound of +0.1;
the realised +0.58 with a lower bound of +0.30 is above it, as expected for an in-sample split. The first half holds
3 trades, so the halves rule tests little there (workflow note 19).

### C-6 final read (registered before running)

The rules are unchanged. The read is once, on the final tier, deflated over the final reads (carry K1, D-1, C-6), so
k = 3 and the interval is 98.33%. It holds when the interval excludes zero. Capitulations are rare, so the read has
little power. The verdict is recorded either way, and the forward record follows.

**Result C-6 final read:** undecided. 7 trades, avg R +0.077, control -0.076, edge +0.153 [-0.595, +0.868] (98.33%
interval). It fails the bar, but on 7 trades the read has no power. The final tier is spent for this lineage. C-6 joins
the forward record (`combo/candidates/oversold_idio.py`).

### Diagnosis of D-1 under amendment 4 (`loop/diagnose_d.py`, `loop/diagnose_d.txt`; iteration tier only)

Competing explanations of where the edge is lost:
- **H1, the target cuts winners:** rejected. The 41 trades that hit the target (median 1.67R) reach a median MFE of
  2.23R over the full 30 bars; only 17% reach twice the target. The time-only exit lowers the edge (+0.212 against
  +0.309).
- **H2, false breaks from narrow boxes or small breakout bars:** rejected. Stopped trades have about the same box width
  (5.3 against 5.8 ATR), slightly larger breakout bodies (1.47 against 1.29 ATR) and similar volume.
- **H3, beta:** rejected. Shorts carry more edge than longs (+0.413 against +0.210), and random entries show no BTC-trend
  pattern (beta check flat).

Ablation, measured by the lower bound of the edge interval (amendment 4):
- **Time-only exit:** lower bound -0.087.
- **Stop 1 ATR beyond the broken edge, instead of the box middle:** edge +0.396, lower bound -0.035. The two halves are
  more balanced (+0.385 and +0.405), but the R unit changes with the stop (workflow note 35).
- **No entry-beyond-middle condition:** identical trades; the condition never binds.

**Outcome:** no explanation survives, and no ablation raises the lower bound, so the diagnosis admits no structural
change. D-1 is a local optimum in every direction tested; its limit is sample size, not a flaw. It stays the
candidate, and its forward record (`box_break`) decides. A loop that ends with "do not change" is a valid outcome.

## Carry K1: final read relayed by the gatekeeper

A fresh-context subagent read `carry/final.txt` and relayed only its decision line: **"K1 on the final tier HOLDS"**.
K1 has now held on development (17 majors, 2020-2022), on the holdout (37 coins, 2023-2026) and on the final tier
(12 never-used coins). The iterating agent has not read the final details.

## Family E: "the box edge holds" (box fade, redone under amendments 4-6)

Earlier rounds (range-v1 to v6, rangex) fell short with filters and preconditions; this family redoes it with the
diagnosis-first protocol. Final tier: the reserve (amendment 6).

### Loop E-1 (registered before running)

- **Baseline:** range-v2 C on 4h bars of the iteration tier. A bar reaches a 60-bar box edge (within 0.25 ATR) and
  closes back in its outer half; entry at the next open; stop 0.5 ATR beyond the edge; target the far edge minus
  0.25 ATR; time limit 30 bars.
- **Next:** a diagnosis package follows the run, with four competing explanations:
  - **H1, regime:** fades against the daily trend lose and fades with it win.
  - **H2, entry timing:** fades after a sweep beyond the edge (Wyckoff spring or upthrust) beat first touches.
  - **H3, box quality:** boxes with more touches and a longer life hold better.
  - **H4, stop hunts:** stops 0.5 ATR beyond the edge sit where stop orders cluster (Osler), so price often returns
    inside the box after the stop.

**Result E-1:** iteration gate fails. 176 trades, avg R -0.165, edge -0.121 [-0.469, +0.235]. Stops 66%: 35% of them
within 2 bars, 21% after first reaching +1R. The target R is reliably negative (IC -0.19): the farther the far edge,
the worse.

### Diagnosis of E-1 (`loop/diagnose_e.py`, `loop/diagnose_e.txt`)

- **H1, regime:** rejected. Fades with the daily trend -0.149, against it -0.099.
- **H2, sweep on the signal bar:** rejected, reversed. Fades whose signal bar swept beyond the edge -0.234 (76% stopped),
  others -0.066.
- **H3, faded edge touched 3 or more times:** +0.471 (31 trades, 52% stopped) against -0.248 (145, 70%). A strong split,
  but small. It conflicts in sign with Family A's prior-touch factor (different constructs: tests of a range edge here,
  retests of a swing level there). Box age is unusable: the rolling box shifts every bar, so the measure was always 0
  (workflow note 37).
- **H4, stop hunts:** supported. 63% of stopped trades closed back inside the box within 6 bars of the stop. A wider
  stop (1.5 ATR) did worse (-0.197), so the stop's distance is not the cure.
- **Ablations:** a target at the box middle (-0.159) and dropping the close condition (-0.215) both do worse.
- **Beta check:** no consistent BTC-trend pattern.

### Loop E-2 (registered before running; amendment 4)

- **Structural change (entry model):** trade the failed break instead of the first touch. A 4h close beyond the box
  edge (the box known at the bar before the break) is followed within 6 bars by a close back inside the box. Entry at
  the next open, toward the far edge; stop 0.25 ATR beyond the extreme of the break excursion; target the far edge
  minus 0.25 ATR; time limit 30 bars.
- **Explanation it rests on:** H4 (63% of stopped fades re-entered the box). Sources: Wyckoff's spring and upthrust,
  the price-action "failed breakout", and Osler's stop clustering beyond levels.
- **Power:** about 60 trades on the 17 majors is too few, so it runs on the extended tier (about 180 expected).
- **Predicted:** edge +0.15, with a lower bound near -0.1 (uncertain).

**Result E-2:** iteration gate fails. 190 trades, avg R -0.132, edge -0.106 [-0.352, +0.181]; 2018-2020 -0.408,
2021-2022 +0.036. The prediction (+0.15) missed by 0.26R. Price returns inside the box after a failed break, but it does
not travel to the far edge: the median MFE before the stop is 0.28R. H4's re-entry is real but not tradeable as an entry.

### Loop E-3 (registered before running; amendment 4)

- **Change from E-1 (a filter, with a power check):** fade only box edges touched at least 3 times in the box window.
- **Explanation it rests on:** H3 (+0.471 on 31 trades against -0.248 on 145). Osler's clustering at watched levels;
  the community view that a range edge respected repeatedly is defended.
- **Power:** about 95 trades expected on the extended tier, a minimum detectable edge of about 0.35R, against a 0.7R
  split in E-1.
- **Predicted:** edge +0.2, with a lower bound near -0.1.

**Result E-3:** iteration gate fails. 112 trades, avg R -0.160, edge -0.099 [-0.421, +0.265]. E-1's H3 split did not
replicate on the extended tier; like Family A's small splits, it was noise. The prediction (+0.2) missed by 0.3R.

**Family E: terminal**, now on mechanism-level evidence, not filter exhaustion:
- a first touch of a box edge usually breaks (E-1, 66% stopped);
- after a failed break, price returns inside the box but does not travel to the far edge (E-2, median MFE 0.28R);
- well-tested edges do not hold either (E-3).
4h box edges in crypto show no reversal power beyond random entries.

## Family F: "the trend line marks the turn" (trend-line breaks, under amendments 4-6)

Start from the surviving trend-line entry, combo-v2 `trendline_break_strong`. It was +0.09-0.14R on crypto and is in
the forward record. The line runs through the last two confirmed 4h swing pivots of order 8 (falling highs or rising
lows). A signal is the first close beyond the line by a strong bar (body at least 1 ATR, close in the outer 30%). Stop
at the signal bar's opposite extreme, target 2R, time limit 30 bars. Final tier: the reserve (amendment 6).

### Loop F-1 (registered before running)

- **Baseline:** `trendline_break_strong` unchanged, on 4h bars of the iteration tier.
- **Next:** a diagnosis package follows.

**Result F-1:** the iteration gate passes. 994 trades, avg R +0.222, edge +0.230 [+0.106, +0.349]; 2018-2020 +0.363,
2021-2022 +0.108. Stops 47%, 14% of them within 2 bars. BTC's trend is reliable and monotone (Q1 +0.01 to Q5 +0.39);
part of the edge may be beta, which a diagnosis must check.

### F-1 reserve read (registered before running)

The rules are unchanged. The read is once, on the reserve tier (20 never-used coins), PASS/FAIL at 95% (the reserve's
first read, k = 1). A fresh-context subagent runs `loop/gatekeeper.py family_f F-1 reserve` and relays the verdict line.

### Diagnosis of F-1 (`loop/diagnose_f.py`, `loop/diagnose_f.txt`; iteration tier only)

- **H1, beta:** rejected. Random longs are flat across BTC-trend quintiles 1-4 (+0.13R only in Q5), while the
  trend-line longs earn in every quintile (+0.27 even in Q1). Longs carry more than shorts (+0.363 against +0.114).
- **The strong-candle condition carries the edge:** without it, edge +0.102 on 3,552 trades.
- **H2, the exit:** supported. With a time-only exit (no 2R target), edge +0.323 [+0.131, +0.559], both halves positive
  (+0.486 and +0.173); the lower bound rises from +0.106. The stop is unchanged, so the R unit is the same. The same
  finding holds in an independent lineage: exit-v1 found the time-only exit best for B1.
- **H3, line quality:** not tested in this package.

### Loop F-2 (registered after the F-1 diagnosis)

- **Structural change (exit model):** no 2R target; exit at the time limit (30 4h bars) or at the stop.
- **No ex-ante prediction:** F-2's iteration result is the diagnosis ablation above, seen before this registration. Its
  test is the reserve read: once, PASS/FAIL at 97.5% (the reserve's second read, k = 2), via the gatekeeper subagent.

## Family G: "a box break regresses into the box" (the user's hypothesis after Family E)

**Path statistics after 4h box breaks** (`loop/paths_breaks.py`, `loop/paths_breaks.txt`; extended iteration tier, 374
breaks; descriptive, recorded as a diagnosis):
- **Returns:** a close back inside the box within 6 / 12 / 30 bars in 56% / 66% / 77% of breaks.
- **Depth:** the box middle is reached in 30%, the far edge in 9%.
- **Runs:** price runs at least half a box width beyond the edge in 60% of breaks (39% before any return).
- **Marginal breaks** (a close within 0.5 ATR of the edge) return within 12 bars in 80%.

Reading: breaks usually come back, but shallowly. They often run first, retest the edge, and continue. That fits D-1
(continuation, stop at the middle, which holds 70% of the time) and E-2 (no travel to the far edge).

### Loop G-1 (registered before running; amendment 4)

- **Change (entry model):** fade marginal breaks. After the first 4h close beyond the box (X1 definition), if that close
  is within 0.5 ATR of the edge, enter against the break at the next open. Stop 0.25 ATR beyond the break bar's extreme;
  target the box middle; time limit 12 bars. Extended iteration tier.
- **Explanation:** 80% of marginal breaks return inside within 12 bars (Osler's stop runs just beyond levels; the
  price-action "failed breakout").
- **Risk named in advance:** the return is shallow (31% reach the middle).
- **Predicted** (shrunk for the agent's upward bias, workflow note 39): edge about 0, with a lower bound near -0.2.

**Result G-1:** iteration gate fails, significantly negative. 199 trades, avg R -0.471, edge -0.381 [-0.667, -0.045].
Stops 81%: 70% of them within 2 bars, with a median MFE of 0.00R before the stop. Marginal breaks run past the break
bar's extreme first and return later: the regression comes after the run, so a fade is stopped before it. The
prediction (about 0) missed by -0.38R.

### Loop G-2 (registered before running; amendment 4)

- **Change (entry model, using the regression for the continuation trade):** after an X1 break, place a limit order at
  the broken edge for 12 bars instead of entering at the next open. Stop at the box middle; target one box width from
  the edge; time limit 30 bars after the fill. Extended iteration tier.
- **Explanation:** 77% of breaks return inside, and the middle holds 70% of the time, so a fill at the edge buys the
  continuation at a better price.
- **Risk named in advance:** adverse selection. The 23% that never return are the strongest runs, and earlier retest
  entries (trend-v1 E-line, setups P3) lost to the market entry.
- **Predicted (shrunk):** edge +0.15, with a lower bound near -0.1.

**Result G-2:** the iteration gate passes (extended tier). 302 trades, avg R +0.294, edge +0.247 [+0.071, +0.433];
2018-2020 +0.423, 2021-2022 +0.157. Stops 44%, 13% of them within 2 bars. The prediction (+0.15, lower bound -0.1) was
beaten.

**Comparison with the market entry on the same coins (D-1x, recorded as a comparison):** 358 trades, avg R +0.219,
edge +0.188 [+0.028, +0.344]; 2021-2022 +0.070. In R, the retest looks better, but its stop is closer (median 2.60
against 3.16 ATR), which inflates R (workflow note 35). In ATR units the two entries are alike: edge +0.615 against
+0.590 ATR, return +0.756 against +0.705 ATR. So the retest does not catch more of the move. It buys the same move with
less risk: under fixed-risk sizing it earns more per trade (+0.29R against +0.22R, about 89R against 78R in total).

**The user's hypothesis, answered:**
- **Breaks do regress:** 77% close back inside within 30 bars.
- **But shallowly and after a run,** so fading them loses (G-1).
- **The regression is useful as an entry for the continuation (G-2),** at the same edge per unit of price and a better
  edge per unit of risk.

G-2 goes to the reserve tier through the gatekeeper after F-1 and F-2.

**Result F-1 reserve read (relayed by the gatekeeper subagent):** "F-1 final: FAIL at 95.00% (k=1)". The iterating agent
has not seen the details (sealed in `loop/sealed/F-1_reserve.json`).

### Reserve reads of F-2 and G-2 (registered before running)

- **F-2:** k = 2, PASS/FAIL at 97.5%.
- **G-2:** k = 3, PASS/FAIL at 98.33%.
- Both run once each, rules unchanged, by a fresh-context gatekeeper subagent that relays only the verdict lines.

**Result F-2 and G-2 reserve reads (relayed by the gatekeeper subagent):** "F-2 final: FAIL at 97.50% (k=2)" and
"G-2 final: FAIL at 98.33% (k=3)". Details are sealed; the iterating agent has not seen them.

**State of the reserve tier:** three candidates that passed iteration (F-1, F-2, G-2) all fail on it. The reserve is
spent for the box and trend-line lineages. Their candidates (`trendline`, `box_break` and B1 variants) continue in the
forward record.

**Result of the majors-slice reads (relayed by the gatekeeper subagent, three-level verdicts):**
- F-1 majors: FAIL (edge positive, interval spans zero) at 98.75% (k=4)
- F-2 majors: FAIL (edge positive, interval spans zero) at 98.75% (k=4)
- G-2 majors: FAIL (edge positive, interval spans zero) at 98.75% (k=4)
- C-6 majors: FAIL (edge positive, interval spans zero) at 98.75% (k=4)

All four point the right way on the strategies' own universe; none is significant at the deflated level. That reads
"needs data", not "wrong mechanism". The clean data source is the forward record:
- F-1 (`trendline`) and C-6 (`oversold_idio`) are already in it;
- F-2 joins as `trendline_time`;
- G-2 cannot join yet: its limit entry at the broken edge does not fit the forward harness, which supports only market
  entries at the next open (workflow note 42).

## Date-clustered re-read of the survivors (`loop/reread_clustered.py`, `loop/reread_clustered.txt`)

Weekly-block bootstrap next to the coin-clustered one, on development or iteration data only:
- **Breakout lineages barely change:**
  - F-1 [+0.113, +0.353];
  - F-2 [+0.117, +0.551];
  - D-1 [+0.092, +0.525];
  - D-1x [+0.008, +0.367];
  - G-2 [+0.044, +0.447].
  Their trades spread over 83-233 weeks.
- **The capitulation lineage widens most:**
  - C-4 [+0.017, +0.577] (76 trades in only 21 weeks);
  - C-6 [+0.160, +0.946] (30 trades in 12 weeks).
  These are a dozen or two market events, not dozens of independent trades.
- **T0, O3 (development) and X1 (37 large caps)** still span zero.

Retrospective flaw 1 is real, but it matters mainly for clustered event strategies.

## Visual trade review of F-2 (the user's suggestion; `loop/trade_cards.py`, `loop/visual_hypotheses_f2.py`)

Trade cards (60 bars before and 40 after entry, entry, stop, exit, and BTC below) of F-2's 6 worst and 6 best trades:
- **Worst:** stopped within 1-2 bars, in wick-heavy chop, with the stop inside normal wick size, and BTC flat.
- **Best:** a very flat, narrow range for 40-60 bars before the break, a one-way run after it, BTC moving the same way,
  and a stop tiny relative to the run (10-38R).

Three hypotheses, quantified on all 994 iteration trades, each with a beta check on random entries:
- **H-a, compression before the break (40-bar range in ATR):** IC -0.080, the same sign in both halves and in all 5
  years (t -2.88); buckets from about +0.4 (flat) to +0.17 (wide); Q5-Q1 interval spans zero. Random entries show the
  same gradient (+0.46 to +0.05): mostly generic volatility mean reversion, not trend-line skill. The trades stay
  positive in every bucket.
- **H-b, stop inside the noise:** rejected, reversed. The tightest stops relative to noise do best (+0.66): they are
  stopped more often but win more R. The visual impression was the cost side only.
- **H-c, BTC moving with the trade:** rejected (IC +0.009).

Reading: visual review generated three concrete hypotheses that tables did not. Judged on extremes, two of the three
were wrong and the third mostly generic. Visual review is a hypothesis generator, not a decision rule.

## Family E reopened (the user's instruction: continue box-range R&D), under amendment 4 and the visual pipeline (note 44)

Plan:
- E-1 on the extended iteration tier (E-1x), for power;
- trade cards (worst, best and a random sample), with failure modes coded and counted;
- a hypothesis list across categories (entry, exit, regime, session, approach, data), each quantified by IC and
  buckets on all trades and beta-checked;
- then one structural change.

### Loop E-1x (registered before running)

E-1's rule unchanged (range-v2 C on 4h), on the extended iteration tier: the baseline for the reopened family.

**Result E-1x:** iteration gate fails. 519 trades, avg R -0.225, edge -0.173 [-0.370, +0.014]. Reliable factors: the
stop width (positive; entries deeper inside the box) and the target R (negative), the same geometry seen twice.

**Visual review** (worst, best and random 6):
- **Losers and the random sample:** price was carried into the edge by a persistent move (a steady rally into the top
  for shorts, a grind lower into the bottom for longs), often with BTC moving the same way. The edge was just where
  the trend was going.
- **Winners:** mostly longs after a sharp few-bar drop into the bottom with a V-shaped reversal.

**Hypotheses quantified** (`loop/hypotheses_e1x.py`, `loop/hypotheses_e1x.txt`, 519 trades, beta-checked):
- **H1, a persistent approach breaks the edge:** the direction holds (efficiency ratio IC -0.077, t -2.27, the same sign
  in both halves). The most persistent quintile is at -0.47, the rest at -0.10 to +0.01. Random entries show no such
  gradient, so the effect is specific, but the Q5-Q1 interval spans zero (not flagged).
- **H1b, a sharp spike reverts:** rejected, reversed. The strongest 4-bar spike into the edge is the worst quintile
  (-0.52). The V-shaped winners were chosen extremes.
- **H2, longs beat shorts:** shorts lose significantly (week-clustered -0.256 [-0.479, -0.013]); longs -0.108, not
  significant.
- **H3, BTC toward the edge:** rejected.
- **H4, entry depth:** reliable, and it survives in ATR units (Q1-Q2 -0.33 and -0.40 ATR, Q4-Q5 +0.04 and -0.04). It is
  not an R-unit artefact.

Reading: the losses come from entering at the edge while price still carries momentum into it. The entry is too early.

### Loop E-4 (registered before running; amendment 4)

- **Structural change (entry model):** confirm the rejection before entering. After a bar reaches the edge (within
  0.25 ATR), wait up to 6 bars for a close back inside at least 1 ATR from the edge; enter at the next open. Stop
  0.5 ATR beyond the extreme of the touch; target the far edge minus 0.25 ATR; time limit 30 bars. Both sides; the long
  side is left for the next loop (one change per loop).
- **Explanations it rests on:** H1 and H4 above.
- **Predicted (shrunk, note 39):** edge about -0.05, with a lower bound near -0.25.

**Result E-4:** iteration gate fails, but better on every measure. 516 trades, avg R -0.150, edge -0.111
[-0.276, +0.053]; the lower bound rose from -0.370 and stops within 2 bars fell from 33% to 21% of stopped trades. The
prediction (-0.05) missed by -0.06, closer than earlier loops.

### Loop E-5 (registered before running, before looking at E-4 by side)

- **Change from E-4:** longs only.
- **Reason:** shorts lost significantly in E-1x (H2), and short sides were weak across families (short-v1, trend,
  B1).
- **Predicted:** edge about 0, with a lower bound near -0.25.

**Result E-5:** iteration gate fails. 271 trades, avg R -0.123, edge -0.084 [-0.292, +0.125]. The prediction (0)
missed by -0.08.

### Diagnosis of E-5 (`loop/diagnose_e5.py`, `loop/diagnose_e5.txt`, trade cards)

Ablations:
- **Target at the box middle:** edge -0.039 (-0.034 ATR).
- **Time-only exit:** edge +0.022 [-0.286, +0.482], +0.156 ATR; 2018-2020 -0.257, 2021-2022 +0.152. The first
  non-negative box-fade variant. It agrees with F-2 and B1: fixed targets cut winners, in three lineages.
- **Skipping persistent approaches** (efficiency ratio at least 0.5): no change (-0.088).

Visual review: the worst and random losers cluster in the 2022 bear market, with "box bottoms" that look like steps of
a decline (lower highs). Quantified:
- **BTC's trend:** IC -0.097. Long fades did best when BTC was deepest below its 200-day mean (Q1 +0.35). This is the
  reverse of the visual impression; deep-bear bottoms behave like capitulations. Not flagged.
- **Box internal slope (60 bars) and lower-high count:** IC +0.011 and -0.047, no relation.

**Where Family E stands:**
- **Slope:** the reopened loops moved the edge from -0.173 (E-1x) to -0.111 (E-4, confirmed entry), to -0.084 (E-5,
  longs), to +0.022 with a time exit (ablation), with a slope flattening at about zero.
- **Visual hypotheses:** of seven from three reviews, five were rejected or reversed on all trades. One (persistent
  approach) held in direction but did not reach the flag. Only the structural changes, the confirmation entry and the
  time exit, moved the result.
- **Reading:** both working changes turn the fade toward a short-term momentum trade (enter after price has already
  moved 1 ATR away from the edge, then let it run). The edge reversal itself still shows no power.

## Family H: "the spread of a correlated pair ranges" (pairs mean reversion; from the external search, amendment 8)

Why: single crypto prices trend, which explains a dozen failed single-coin range loops. The series that range are the
spreads of correlated coins. External priors:
- **Fil and Kristoufek (2020), "Pairs Trading in Cryptocurrency Markets", 26 Binance coins:** the distance method is
  about flat on daily bars (-0.07% a month); the cointegration method makes +1.36% a month, Sharpe 1.1; intraday is
  stronger but sensitive to costs.
- **Tadi et al. (2023), "Copula-Based Trading of Cointegrated Cryptocurrency Pairs", Binance USDT-M hourly, 2021-2023:**
  3-week formation, 1-week trading, entry at |z| 2, exit at |z| 1.
These are priors, not evidence (both are in-sample studies, sensitive to costs).

### Loop H-1 (registered before running; parameters from the literature, not tuned)

- **Bars and coins:** 4h bars of the 17 majors (iteration tier, 2018-2022).
- **Formation:** each week, regress log A on log B over the prior 3 weeks (126 bars), for every pair (136). Engle-Granger
  ADF t-statistic on the residual; keep the 5 most negative below -3.37 (the 5% two-variable critical value).
- **Trading, for the next week (42 bars):** z is the residual over its formation mean and standard deviation.
  - Enter when |z| reaches 2: short the rich leg, long the cheap leg, hedge ratio beta, gross notional split 1 : |beta|.
  - Exit when |z| falls to 1, on a stop at |z| 4, or at the end of the trading week.
- **Costs:** 0.12% of gross notional per round trip (two legs, 0.06% per side).
- **Score:** net return per trade on gross notional.
  - Gate (market-neutral, benchmark cash): mean net return above zero with a week-clustered 95% interval above zero,
    positive in both halves (2018-2020 and 2021-2022).
  - Comparison: the same rules on 5 randomly chosen pairs per week (does cointegration selection add value?).
- **Predicted (shrunk, note 39):** about 0 per trade, with a lower bound near -0.1%.

**H-1 first run discarded (bug, workflow note 47).** -0.197% per trade on 5,348 trades with a 12% win rate. A
diagnosis showed 465 of 578 sampled exits were stops, 70% on the entry bar. Out of sample, spreads often start the
trading week already beyond |z| 4. The code entered any |z| at least 2, was stopped at once, and re-entered on the
next bar, churning costs. Fixed to implement the registered rule as meant: no entry at |z| 4 or beyond, and a pair
stopped out is not traded again that week (the standard pairs-trading convention). H-1 is rerun under the same
registration.

**Result H-1 (after the fix):** iteration gate fails, significantly negative. 1,185 trades, mean net -0.423%
[-0.610%, -0.238%] (week-clustered), win 41%; both halves negative. Random pairs under the same rules lose more
(-0.646%), so selection helps but does not suffice. The prediction (about 0) missed by -0.42%.

### Diagnosis of H-1 (three explanations)

- **H1, cointegration breaks out of sample:** supported, strongly. Only 6% of the selected pairs stay cointegrated in
  their trading week (median ADF t -1.72), and 58% end the week beyond |z| 2. The spread's level drifts away from the
  formation mean.
- **H2, the entry is early:** partly. Stops (43%, -2.04% gross) outnumber reversions (37%, +1.57%); time exits 19%
  (-0.33%).
- **H3, costs:** rejected. The gross is already -0.303% a trade.

### Loop H-2 (registered before running; amendment 4)

- **Structural change (signal):** z is measured against a rolling mean and standard deviation of the last 60 bars
  (10 days), not the fixed formation statistics. The hedge ratio still comes from the 3-week formation; selection,
  thresholds and exits are unchanged.
- **Explanation it rests on:** H1, the drifting spread level. It is a common practice (rolling z-scores, as in Chan,
  "Algorithmic Trading").
- **Predicted:** about -0.1% a trade, with a lower bound near -0.3%.

**Result H-2:** iteration gate fails, worse. 1,431 trades, mean net -0.497% [-0.776%, -0.238%], win 53%: small wins
back to the rolling mean, large divergence losses. The prediction (-0.1%) missed by -0.4%. At 4h, spreads behave more
like trends than ranges, consistent with Fil and Kristoufek, who find pairs reversion on intraday (5m, 1h) bars and
not on daily bars.

### Loop H-3 (registered before running; amendment 4)

- **Structural change (timeframe):** 1h bars with Tadi et al.'s windows: 3-week formation (504 bars) and 1-week
  trading (168 bars). Entry at |z| 2, exit at |z| 1, stop at |z| 4. Fixed formation statistics (H-1's signal; H-2's
  rolling z did worse).
- **Explanation it rests on:** the literature locates crypto pairs reversion at intraday frequency.
- **Predicted:** about -0.2% a trade, with a lower bound near -0.4% (more trades, so costs weigh more).

**Result H-3:** iteration gate fails. 1,565 trades, mean net -0.191% [-0.321%, -0.067%] (week-clustered, after a NaN
fix in `attrib.week_boot`), win 51%; gross -0.071%, so it stays negative even at maker costs (-0.111% at 0.04% a round
trip). Random pairs -0.595%. The prediction (-0.2%) was right. Moving from 4h to 1h more than halved the loss.

### Loop H-4 (registered before running; amendment 4)

- **Structural change (window):** a 90-day formation (2,160 1h bars) and 14-day trading (336 bars), the windows of the
  2026 adaptive copula pairs study. Everything else as H-3.
- **Explanation it rests on:** H-1's diagnosis (cointegration from 3 weeks does not persist). A longer formation should
  select relationships that last.
- **Predicted:** about -0.1% a trade, with a lower bound near -0.25%.

**Result H-4:** iteration gate fails, worse. 536 trades, mean net -0.740% [-1.306%, -0.203%]; random pairs -1.146%. The
prediction (-0.1%) missed by -0.64%.

**Family H so far:**

| loop | bars | formation / trading | net per trade |
| --- | --- | --- | --- |
| H-1 | 4h | 3 weeks / 1 week | -0.423% |
| H-2 | 4h, rolling z | 3 weeks / 1 week | -0.497% |
| H-3 | 1h | 3 weeks / 1 week | -0.191% |
| H-4 | 1h | 90 days / 14 days | -0.740% |

Reading: the shorter the bars and the holding, the better. Longer windows let spreads trend, so crypto pairs reversion
lives at short horizons, as Fil and Kristoufek found (profits at 5 minutes, none daily). Cointegration selection beats
random pairs in every loop, so selection carries information, but no loop's gross return covers even maker costs.

**Next admissible step:** 15m or 5m bars, where the literature locates the effect. It needs 15m/5m archives (about
1,000 monthly files for 17 coins) and an honest execution model: at that frequency the result depends on maker fills,
which OHLC bars cannot simulate. Without a fill model, a positive gross at 5m would not be evidence of a tradable edge.

## Carry K1: decomposition (diagnosis) and loop K1b (from external research, section 1)

**Decomposition of K1** (annualised per held coin-day; fractions):

| year | anchor | excess | basis | cost | pinned share |
| --- | --- | --- | --- | --- | --- |
| 2020 | 0.082 | 0.194 | +0.004 | -0.018 | 41% |
| 2021 | 0.088 | 0.368 | -0.000 | -0.014 | 32% |
| 2022 | 0.065 | 0.000 | +0.002 | -0.024 | 50% |
| 2023 | 0.089 | 0.047 | +0.003 | -0.020 | 42% |
| 2024 | 0.093 | 0.097 | +0.003 | -0.009 | 34% |
| 2025 | 0.072 | 0.000 | +0.002 | -0.023 | 38% |
| 2026 | 0.070 | 0.002 | +0.023 | -0.095 | 28% |

Reading:
- **The anchor:** K1's return is the funding anchor (about 7-9% a year while held, an interest component) plus excess
  funding that appears only in overheated bull phases (2020, 2021, 2024).
- **The decay:** in 2022, 2025 and 2026 the excess is about zero, and K1 churns around the anchor. Its 0.01% entry
  threshold equals the anchor (external research, section 1), so costs reach -9.5% in 2026.

### Loop K1b (registered before running)

- **Change:** enter when the 7-day mean funding is at least 0.015% per 8h (1.5x the anchor); exit when the 3-day mean
  falls below 0.01% (the anchor). This puts a band between entry and exit and targets excess demand.
- **Evidence:** the 17 majors 2020-2022 (development tier of carry-v1), against K1. 2023-2026 has been read before and
  is shown descriptively only.
- **Predicted:** close to K1 in 2020-2021, fewer trades and lower costs in 2022, and 1-3 points a year better overall.

**Result K1b:** no improvement, slightly worse. Development: +19.9% a year [+14.6%, +25.6%] against K1's +20.9%,
holding 35% of coin-days against 51%. 2023-2026 (descriptive): +4.2% against +5.9%. The prediction (+1 to +3 points)
was wrong in sign. The band cut churn but gave up the anchor income (about 7-9% a year while held), which is part of
K1's return, interest-like or not. The decomposition is the useful result: K1 earns the anchor rate in ordinary times
and excess funding in overheated phases. Its value therefore depends on the alternative yield on USDT. K1 stays as
validated; K1b is not adopted.

## Trend line: portfolio-level comparison (from external research, section 2; loop T-1)

### Loop T-1 (registered before running)

- **Books:** daily, long only, on the 17 majors over 2018-2022 (iteration tier), with the same sizing for every book:
  each coin weighted by a 25% volatility target over its 90-day realised volatility, divided by 17, gross at most 1x,
  and 0.1% a side on weight changes.
  - B0: buy-and-hold (volatility-sized).
  - B1: the regime baseline, long while the close is above its 200-day mean (AQR's point).
  - B2: T0 as a state, entered on a close above the 50-day closing high and exited on a close below the 20-day closing
    low.
  - B3: the Zarattini, Pagani and Barbon ensemble: nine Donchian lookbacks {5, 10, 20, 30, 60, 90, 150, 250, 360}, each
    trailing a stop at max(prior stop, channel midpoint); exposure is the share of sub-models long.
- **Measures:** Sharpe, CAGR, maximum drawdown and the 2022 return, plus a weekly block bootstrap of the Sharpe
  difference of B2 and B3 against B1.
- **Decision:** if neither B2 nor B3 beats B1 beyond the interval, the trend return is regime exposure, and the simpler
  rule is adopted.
- **Predicted:** B3 about 0.1-0.2 higher Sharpe than B2 with a smaller drawdown; B1 about equal to B2.
- **Caveat:** the 17 majors are survivors, so only the relative ranking is evidence here.

**Result T-1** (`trend/books.py`, `trend/books.txt`):

| book | Sharpe | CAGR | max DD | 2022 |
| --- | --- | --- | --- | --- |
| B0 buy-and-hold (vol-sized) | 0.66 | +10.4% | -31.4% | -25% |
| B1 above the 200-day mean | 0.86 | +8.0% | -15.5% | -6% |
| B2 T0 | 1.17 | +9.8% | -15.6% | -11% |
| B3 Donchian ensemble, midpoint trail | 1.45 | +9.3% | -7.6% | -4% |

- **Sharpe against B1 (weekly bootstrap):** B2 +0.20 [-0.34, +0.72]; **B3 +0.46 [+0.10, +0.80]**.
- **B3** is the first trend rule to beat the regime baseline at the portfolio level, with half T0's drawdown. It came
  directly from the external research.
- **T0** does not beat the 200-day rule beyond the interval, consistent with the regime diagnosis.
- **The prediction:** B3 was predicted 0.1-0.2 above B2; it came out 0.28 above.
- **Levels:** CAGRs are low because the sizing (25% per coin over 17 coins) keeps the average gross at 0.07-0.27. Only
  Sharpe and drawdown are comparable here.

Next for this lineage:
- a point-in-time universe (survivorship);
- a clean read: B3 has never been run on 2023-2026 or on post-2023 listings, but the trend lineage has seen the
  2023-2026 majors, so the post-2023 coins or the forward record are the clean tests.

## Breakouts: session window (diagnosis; external research section 3, hypothesis 4)

Breaks whose bar closes between Sunday 23:00 and Monday 23:00 UTC, against the rest (edge, week-clustered):
- **F-2:** +0.250 [-0.114, +0.635] (195 trades) against +0.340 [+0.111, +0.594] (799).
- **D-1x:** -0.005 (51) against +0.219 [+0.047, +0.397] (307).
- **G-2:** -0.015 (42) against +0.289 [+0.090, +0.488] (260).

The window is worse, not better, in all three; no weekday is consistently favoured. The practitioner claim (BTC
intraday trend) does not transfer to 4h breaks. Rejected, as predicted (no effect).

## Bear-market line: cross-sectional funding long-short (loop X-1; external research section 5, hypothesis 1)

### Loop X-1 (registered before running)

- **Rule:** each day, rank the 17 majors by trailing 3-day funding (sum of settlements). Long the 3 lowest and short the
  3 highest, equal dollar weights, perpetual prices, rebalanced daily, 0.06% a side on turnover.
- **Score:** daily return, price only (excluding funding) and, separately, including the funding paid and received.
- **Gate:** the price-only mean is above zero with a week-clustered 95% interval above zero, and it is positive in both
  halves (2020; 2021-2022), on the iteration tier (17 majors, 2020-2022).
- **Sources:** Chi et al. (2023), the basis as the strongest cross-sectional predictor; BIS "Crypto Carry", high carry
  precedes unwinds. Against: Presto Labs, about zero next-week R-squared on a single asset.
- **Predicted:** price-only about 0 with a negative lower bound; slightly positive including funding.

**Result X-1** (`carry/xfunding.py`, `carry/xfunding.txt`): the gate passes formally, with caveats.
- **Price only:** +139.7% a year [+29.9%, +285.4%] (weekly bootstrap); 2020 +2.2%, 2021-2022 +202.3%; by year 2020
  +2.2% (mean basis +12%), 2021 +434%, 2022 -29.9%.
- **Including funding:** +183.0% [+70.9%, +325.6%]; 2022 +6.7%.

Diagnosis:
- **Concentration:**
  - the top 10 days carry 66% of the total (2021-01-28, DOGE in the long leg on its pump, +126% in one day);
  - without them the result is +0.14% a day (+52% a year), and the daily median is +0.27%;
  - by coin, DOGE, FIL and BNB lead.
- **Not a reversal proxy:**
  - a 3-day-return reversal long-short loses in all three years;
  - the daily correlation of the two spreads is 0.45, and their short legs overlap 23%.
  - So funding carries information beyond recent returns.
- **The bear year (the user's goal):** price-only -30% in 2022; only funding income makes it positive.
- **Prior against:** carry-v1's P1 (time-series deciles, 7 days) found high funding followed by higher returns on the
  2023-2026 coins.

### X-1 validation read (registered before running)

- **Data:** the 17 majors plus the 20 large caps, 2023-01 to 2026-08.
- **Rule:** unchanged, with the legs scaled to the universe (Q = round(N x 3/17), 7 a side for 37 coins). Price-only
  score.
- **Contamination, stated:** carry-v1 read these coins and period (K1, K2, P1) with other constructions.
- **Verdict:** three-level verdict at 95% from `carry/xfunding.py validate`, run by a fresh-context gatekeeper subagent;
  details sealed in `loop/sealed/X-1_validate.json`.

**Result X-1 validation read (relayed by the gatekeeper subagent):** "X-1 validate: FAIL (edge at or below zero) at 95%".
On the 37 coins over 2023-2026, the cross-sectional funding long-short does not earn on price. Its development result
was a 2021 (and DOGE) effect, as the diagnosis suspected, and it agrees with carry-v1's P1 prior. The bear-market line
has no surviving short-side or long-short rule; long/cash trend (T-1's ensemble) and carry remain its tools.

## Trend line: point-in-time universe (loop T-2; external research section 2, hypothesis 2)

### Loop T-2 (registered before running)

- **Universe:** each month, the 20 Binance spot USDT pairs with the highest median daily quote volume over the prior 30
  days, among pairs listed at least 365 days, delisted pairs included (`loop/fetch_universe.py`, 665 symbols).
  Stablecoins and leveraged tokens are excluded.
- **Books:** T-1's books (B0 buy-and-hold, B1 above the 200-day mean, B2 T0, B3 Donchian ensemble), with the same sizing
  (25% volatility target per coin over 20), over 2018-2022. A coin leaving the universe is exited at the month's change.
- **Gate:** B3's Sharpe above B1's, with a weekly-bootstrap interval of the difference above zero.
- **Predicted:** all levels lower than T-1 (survivorship removed); B3 about 0.3 above B1, with a lower bound near zero.
- **If it passes:** one gatekeeper read on the same construction over 2023-2026 (three-level verdict).

**Result T-2** (`trend/books_pit.py`, `trend/books_pit.txt`): the gate passes.
- **The universe:** 70 symbols passed through it over 2018-2022, including later collapses and delistings (LUNA, FTT,
  BCHABC, ERD and others).

| book | Sharpe | CAGR | max DD | 2022 |
| --- | --- | --- | --- | --- |
| B0 buy-and-hold | 0.40 | +5.5% | -32.4% | -27% |
| B1 above the 200-day mean | 0.56 | +5.5% | -19.0% | -10% |
| B2 T0 | 0.91 | +7.4% | -15.2% | -10% |
| B3 Donchian ensemble | 0.98 | +6.2% | -9.0% | -6% |

- **Sharpe against B1:** B2 +0.33 [-0.18, +0.84]; **B3 +0.40 [+0.05, +0.75]**.
- **Levels drop with survivorship removed** (B3's Sharpe from 1.45 to 0.98), but B3's lead over the regime baseline
  holds (+0.46 to +0.40), as predicted (about +0.3).

### T-2 validation read (registered before running)

The same construction over 2023-01 to 2026-08, once, via `trend/books_pit.py validate` and a fresh-context
gatekeeper subagent. Three-level verdict on Sharpe(B3) - Sharpe(B1) at 95%; details sealed in
`loop/sealed/T-2_validate.json`. Contamination, stated: the trend lineage has seen the 2023-2026 majors (T0
descriptive and the majors slice); B3 itself was never run there.

**Verdict T-2 validate:** FAIL (edge positive, interval spans zero) at 95%. B3's lead over the regime baseline
replicates in sign on 2023-2026 but is not significant there; details sealed. B3 joins the forward record on the 17
majors (`trend/forward_b3.py`, daily weights from 2026-10-01, scored on closed days) so the question is decided on data
no one has seen.

## Breakouts: OI change and taker flow at the break (diagnosis S-1; external research section 3)

Majors only, 2021-12 to 2022-12 (the metrics archive starts there for alts). Edge against random, week-clustered:

| lineage | n | OI rising | OI falling | taker top tercile in break direction | rest |
| --- | --- | --- | --- | --- | --- |
| F-2 | 295 | +0.014 | +0.022 | +0.130 [-0.50, +1.09] | -0.060 |
| D-1 | 47 | +0.020 | +0.173 | -0.076 | +0.172 |
| G-2 | 35 | +0.121 | +0.260 | +0.117 (n 7) | +0.216 |

- **IC of taker flow in the break direction:** F-2 -0.03, D-1 +0.23 (Q5-Q1 +1.13 [+0.13, +2.19]), G-2 +0.19.
- **IC of OI change:** F-2 -0.12, D-1 -0.25, G-2 -0.07.
- **Reading:** the signs disagree across lineages, and the one nominal interval (D-1 taker) rests on 47 trades among
  several looks. OI confirmation ("new money behind the break") is rejected; taker flow is inconclusive. Not adopted as
  a filter; the data is too short to test on alts before 2021-12.

## Ensemble N-1: return streams, correlation and effective N (registered before running; external research section 6, step 1)

- **Streams, weekly, 2018-2022 (carry from 2020):**
  - K1 carry (17 majors, `carry/daily.csv.gz`);
  - B3 Donchian-ensemble book and B1 regime book (`trend/books.py`);
  - D-1 box break, G-2 retest, F-2 trend-line time exit, C-6 idiosyncratic capitulation (iteration trade logs, 1R per
    trade, booked in the entry week);
  - B0 buy-and-hold for beta.
- **Measures:** Pearson correlation of weekly returns, the same in bear years (2018, 2022), and an effective N from the
  eigenvalues of the correlation matrix of the five candidate rules (K1, B3, D-1, F-2, C-6): (sum l)^2 / sum l^2.
- **Falsifier:** effective N of 2 or less, or a mean bear-year correlation among the timing rules above 0.8.
- **Predicted:** D-1 and G-2 correlate strongly (same events), F-2 moderately with them, K1 near zero with all, B3
  positive with B0; effective N about 3.5.
- **Approximation, stated:** trades are booked in their entry week, not over their life; that blurs correlation
  between rules that hold for days.

**Result N-1** (`loop/ensemble.py`, `loop/ensemble_n1.txt`): the falsifier is not triggered.
- **Effective N of K1, B3, D-1, F-2, C-6: 4.24** (predicted about 3.5).
- **Mean bear-year correlation among the timing rules: +0.05.**
- **As predicted:** D-1 and G-2 correlate (+0.39; +0.61 in bear years), so G-2 is a variant, not a new rule; F-2 is
  nearly independent of them (+0.12).
- **Not predicted:** K1 correlates +0.63 with B3 over all weeks (both earn in bull phases, when funding is rich) but
  +0.04 in bear years. K1 is not the diversifier it looked like in a crash, only outside one.
- **Caveat:** sparse trade streams (C-6 trades in 5% of weeks) have low correlation partly by construction.

## Ensemble N-2: a pre-registered book with no fitted weights (registered before running; section 6, step 2)

- **Construction:** each rule's weekly stream is scaled to 10% annual volatility by its trailing 26-week standard
  deviation (shifted one week, at least 13 weeks); the book is the plain mean of the scaled streams. No weights are fit.
- **Book A:** K1, B3, D-1, F-2, C-6 on 2020-2022. **Book T:** the four timing rules on 2018-2022.
- **Compared with:** each rule alone under the same scaling, and B0. Drawdowns are compared after rescaling every
  series to 10% realised volatility (descriptive).
- **Falsifier:** the book's Sharpe not above the best single rule's, or its drawdown not below half of B0's.
- **Predicted:** Book A fails against K1 alone (K1's Sharpe is very high on 2020-2022); Book T beats B3 (about 1.6
  against 1.4) with a drawdown well under half of B0's.
- **Approximations, stated:** trades are booked in the entry week, so drawdowns are understated; overlapping
  same-coin signals are not merged.

**Rerun N-2 (bug):** the first run divided by a zero trailing volatility for C-6, which trades in 5% of weeks, and
printed NaN (two census rows with NaN). Fix: where the trailing 26-week volatility is zero or undefined, use the
expanding volatility; a stream with no history contributes 0. Logged as a rerun.

**Result N-2** (`loop/ensemble.py n2`, `loop/ensemble_n2.txt`):

| book | weeks | Sharpe | best single | book - best (weekly bootstrap) | max DD at 10% vol | B0 max DD |
| --- | --- | --- | --- | --- | --- | --- |
| A (K1, B3, D-1, F-2, C-6), 2020-07 to 2022 | 130 | 2.99 | K1 4.34 | -1.38 [-3.13, +0.30] | -6.1% | -15.6% |
| T (B3, D-1, F-2, C-6), 2018-07 to 2022 | 235 | 2.04 | F-2 1.71 | +0.34 [-0.54, +1.11] | -6.7% | -18.1% |

- **Book A:** falsifier triggered, as predicted: on 2020-2022, K1 alone dominates any mix.
- **Book T:** falsifier not triggered; above the best single rule and its drawdown under half of B0's, as predicted.
  The lead is not significant. Book T is positive every year (2018 +1.2%, 2022 +8.3%).
- **What this does not show:** these are iteration-tier streams on which F-2, D-1 and C-6 were selected, so every
  single-rule Sharpe here is in-sample; the book's value is the diversification ratio, not the level. Drawdowns are
  understated (entry-week booking). C-6's scaled stream is erratic (Sharpe 0.26) because its volatility estimate rests
  on a few trades.
- **Next (section 6, step 3):** CSCV/PBO over construction variants on the same history, before any holdout read.

## Ensemble N-3: CSCV / probability of backtest overfitting over construction variants (registered before running; section 6, step 3)

- **Variants (24):** a volatility window of 13, 26 or 52 weeks; equal risk or raw (unscaled) streams; the rule set T
  (B3, D-1, F-2, C-6), T without C-6, T with G-2 for D-1, T with B1 for B3; equal weights or cluster weights (trend, 4h
  breakouts {D-1 or G-2, F-2}, capitulation, each cluster one share).
- **CSCV:** the 235 weeks of 2018-07 to 2022 in 12 blocks; all 924 half splits. In each split the in-sample best
  variant by Sharpe is ranked out of sample; PBO is the share of splits where it ranks below the median.
- **Falsifier:** PBO above 0.5.
- **Predicted:** about 0.3; the variants are highly correlated, so selection among them costs little.
- **Limit, stated:** PBO covers only the construction choice, not the choice of rules, which were selected on this
  same history.

**Result N-3** (`loop/ensemble.py n3`, `loop/ensemble_n3.txt`): **PBO 0.29**, falsifier not triggered (predicted about
0.3).
- **Count deviation:** 32 variants were run, not the 24 registered (4 rule sets x 4 scalings x 2 weightings; the
  registration miscounted).
- **In-sample best Sharpe 2.66, out of sample 2.11 on average.** Full-period Sharpe ranges from 0.75 to 2.52, with a
  median of 1.95; the frozen book (T, risk26, equal) has 2.04, near the median.
- **The best variants are the "raw" ones;** they divide by a full-sample standard deviation, which is look-ahead, so
  they are not candidates. The frozen book stays as registered; it is not switched to the in-sample best.

## Ensemble N-4: one read of the frozen book on the majors slice (registered before running; section 6, step 4)

- **Book:** frozen as in N-2 (B3, D-1, F-2, C-6; trailing 26-week equal risk; equal weights), warmed up on the
  iteration streams. Read once on the 17 majors over 2023-01 to 2026-08 by `loop/gatekeeper_book.py`, run by a
  fresh-context gatekeeper subagent; details sealed in `loop/sealed/N-4_majors.json`.
- **Two three-level verdicts at 97.5% (k = 2), weekly bootstrap:** the book's mean weekly return above zero (against
  cash), and Sharpe(book) minus Sharpe(B0) above zero.
- **Contamination, stated:** this slice is not clean. F-2, D-1's lineage and C-6 were each read on it ("edge positive,
  interval spans zero"); B3 was not. So a positive sign is expected. The read asks only whether diversification lifts
  the book to significance.
- **Predicted:** against cash, FAIL (edge positive, interval spans zero); against buy-and-hold, FAIL (edge positive,
  interval spans zero).

### Loop C-7: beta-adjusted residual trigger (registered before running; external research section 4, hypothesis 1)

- **Change from C-6 (one):** the drop is the coin's return minus beta x BTC's return over the same 1-5 days, with beta
  from daily returns over the 60 days before the window; everything else is C-6 (O3 volume and close filters, stop,
  target, 10 days, extended iteration tier).
- **Source:** Blitz, Huij, Lansdorp and Verbeek (2013): reversal on factor residuals beats reversal on raw returns.
- **Falsifier:** edge below +0.2R.
- **Predicted:** a similar count to C-6 (about 25-35 trades); high-beta alts lose some BTC-crash signals, so the
  edge is similar or slightly higher, about +0.5R.

**Result C-7:** the iteration gate passes, and the falsifier is not triggered. 29 trades, avg R +0.530, edge +0.665
[+0.366, +0.936] (week-clustered [+0.37, +1.07], 14 weeks); 2018-20 +0.57 (n 6), 2021-22 +0.69 (n 23).
- **Against C-6 (+0.579, 30 trades):** 26 of the 29 trades are the same events (3 new, 4 dropped). The residual
  definition re-labels the same capitulations, so the +0.09R difference is noise, not a gain.
- **Reading:** beta adjustment adds nothing measurable on daily majors and mid caps; it is not a new candidate and it
  spends no holdout. The binding limit stays the event count (14 independent weeks), which is what hypothesis 4 (a 4h
  event definition) targets.
- **Census:** an accidental second run (to read the header) is logged as a rerun.

### Loop C-8: the idiosyncratic capitulation on 4h bars (registered before running; section 4, hypothesis 4)

- **Rule:** on a 4h bar, the coin's return minus BTC's over 6-30 bars at most -10%; volume at least 2.5x the mean of
  the prior 120 bars; a close in the upper half of the bar. Long at the next open; stop at the low minus 0.5 ATR(20);
  target half way back to the prior 60-bar high (at least 1R); 24 bars (4 days); spacing 30 bars. Extended iteration
  tier, costs as always.
- **Falsifier (from the research):** costs erase the edge (edge at or below 0), or events fall in fewer than 25
  distinct weeks.
- **Predicted:** about 80-150 trades in 30-50 weeks; edge about +0.2R, smaller than C-6's because a 10% 4h drop is a
  milder event.

**Result C-8:** the iteration gate fails. 632 trades in 130 weeks, avg R +0.057, edge +0.074 [-0.054, +0.204]
(week-clustered [-0.14, +0.31]); 2018-20 +0.07 (n 216), 2021-22 +0.08 (n 416); 2021 is negative (-0.08).
- **Falsifier, as registered:** not triggered (edge above zero, 130 weeks), but the edge is a quarter of C-6's and not
  significant. Predicted +0.2R on 80-150 trades; it gave 4-5x the trades at a third of the edge.
- **Decomposition:** 43% stopped (C-6: 7%); a 4h -10% residual is a routine move, not a capitulation.
- **Reading:** more independent events can be bought only by diluting the event; the edge lives in the rare daily
  extremes. The capitulation line stays power-limited; its path to more data is more coins (post-2022 listings) on the
  daily definition, not a faster bar. No successor on 4h.

## Bear markets X-2: funding-extreme crash overlay (registered before running; external research section 5, hypothesis 3)

- **Flag:** BTC's 7-day mean funding above its trailing 365-day 90th percentile and BTC perpetual open interest up more
  than 20% over 14 days. Data: BTC funding from 2020, open interest from 2020-09, so the flag exists from 2021-01 to
  2022-12 (the iteration period; open interest for 2023 onward is not fetched).
- **Measures:** BTC's next-30-day return (mean and 5th percentile) on flagged against unflagged days; the number of
  distinct episodes (flags more than 14 days apart); the B3 book (`trend/books.py`) with all exposure cut to zero while
  flagged, against B3 itself.
- **Falsifier:** the flagged state's next-30-day mean and lower tail no worse than unconditional.
- **Predicted:** few episodes (3-6, around the 2021 tops); flagged next-30-day mean worse. With so few episodes no
  inference is possible either way; a pass would earn only a forward flag, not a rule.

**Result X-2** (`loop/overlay_x2.py`, `loop/overlay_x2.txt`): **falsified.**
- **The flag fired on 7 of 790 days in 2 episodes** (2021-02-06, 2021-03-14); the window starts 2020-11 because the
  365-day percentile needs 300 days.
- **The flagged next-30-day BTC return:** mean +19.3% and 5th percentile +8.9%, against +3.3% and -28.9% on all days.
  Both episodes were followed by rallies, not crashes; the 2021-04 and 2021-11 tops were never flagged (open interest
  did not rise 20% in 14 days at the funding peak).
- **B3 with the overlay:** Sharpe 1.52 against 1.78; the same drawdown, a lower return.
- **Reading:** "crowded longs precede crashes" did not mark either 2021 top on BTC. Two episodes allow no inference,
  and the rule as stated is closed; the trend book's own exit already handles the tops.

## Breakouts D-2: box lookback ensemble (registered before running; external research section 3, Zarattini, Pagani and Barbon)

- **Change:** D-1x (60-bar box, extended iteration tier) re-run with box lengths of 30, 120 and 240 bars, everything
  else fixed (width 4-15 ATR, two touches a side, stop at the middle, target one width, 30 bars).
- **Measures:** the edge per lookback, and the pooled edge of the union of all four (week-clustered).
- **Falsifier (fragility):** the 60-bar edge is the highest and the other three average below half of it; then the
  D-1 result was a lucky parameter and the lineage is downgraded.
- **Predicted:** positive edges at every lookback (+0.1 to +0.25), no sharp peak at 60; pooled about +0.15.

**Result D-2:** the fragility falsifier triggers, narrowly.

| box length | trades | edge | week-clustered 95% |
| --- | --- | --- | --- |
| 30 | 218 | +0.103 | [-0.10, +0.30] |
| 60 (D-1x) | 358 | +0.188 | [+0.01, +0.37] |
| 120 | 207 | +0.169 | [-0.01, +0.36] |
| 240 | 84 | -0.010 | [-0.20, +0.18] |
| pooled union | 867 (833 distinct) | +0.143 | [+0.03, +0.26] |

- **The other three average +0.087 against half of 60's, +0.094.** Per the registration, the lineage is downgraded:
  part of D-1's edge is the choice of 60 bars. The profile is a plateau from 60 to 120 that falls off at 240, where few
  boxes qualify; it is not a single spike.
- **The pooled union matches the prediction** (+0.14 against +0.15) and its week-clustered interval excludes zero, but
  it is an iteration read on data that chose D-1. In the catalogue, D-1 is now "box break, lookbacks 60-120", with
  its stated edge cut to about +0.14.

## Breakouts S-2: funding as a crowding veto (diagnosis, registered before running; section 3, hypothesis 3)

- **Split:** long breaks of F-2, D-1x and G-2 on coins with funding data (17 majors, 2020-2022), by whether the coin's
  7-day mean funding at the break is above its trailing 365-day 90th percentile.
- **Falsifier:** the crowded longs' edge is not below the rest by at least 0.2R (week-clustered), consistently in all
  three lineages.
- **Predicted:** no consistent effect (S-1 found none for open interest); expected to fail.

**Result S-2:** immaterial, so it cannot be tested. The crowded state (6-8% of coin-days on the majors, 2020-07 to
2022) covers 5 of 262 F-2 longs and none of the D-1x or G-2 longs. Breaks rarely happen in a crowded week, so a veto
would change about 2% of trades whatever its effect. Closed; the breakout funding/OI/taker/session line (S-0 to S-2)
found no conditioning variable.

## Trend lines F-3: line quality (attribution, registered before running)

- **Features of each F-2 trade's line:** span (bars between the two pivots), slope (absolute, ATR per bar), age (bars
  from the second pivot to the break), pivot gap (price difference of the two pivots in ATR), and the break bar's
  body in ATR.
- **Test:** the systematic attribution (IC, ICIR, buckets, reliability flag) on the 994 F-2 iteration trades.
- **Falsifier:** no feature reliable; then line quality is closed, as Ronnie's line rules were.
- **Predicted:** none reliable; at most a weak positive span IC (longer lines, more traders watching).

**Result F-3** (`loop/diagnose_f3.py`): **no feature is reliable**, so line quality is closed. Every |t| is below 1.4.
- **Span:** IC -0.03, the opposite of the prediction. The longest-span quintile is the weakest (+0.07 against +0.34 to
  +0.47), but the Q5-Q1 interval [-0.61, +0.12] spans zero.
- **Gap and slope:** both slightly negative (steep, deep lines are not better).
- **Body:** IC +0.08 with non-monotone buckets.
- **Reading:** as with Ronnie's lines, which line is drawn does not matter. What F-1/F-2 capture is a strong 4h bar
  ending a pullback, and the line only times it. No successor.

**Verdict N-4 (gatekeeper relay):**
- book against cash: FAIL (edge positive, interval spans zero) at 97.50% (k=2);
- book Sharpe against buy-and-hold: FAIL (edge positive, interval spans zero) at 97.50% (k=2).

Both as predicted. Diversification does not lift the book to significance on 2023-2026 majors (a contaminated slice).
The frozen book is the next forward candidate: its components are already recorded daily (B3, box_break, trendline_time,
oversold_idio), so the book can be scored from those records without a new script until a decision date is set.

## Forward plan (decision dates and criteria)

`loop/FORWARD_PLAN.md`, from `loop/forward_plan.py`: an interim date of 2027-04-01 (kill checks only) and a decision
date of 2027-10-01, with per-candidate kill and admit thresholds from bootstrapped backtest paths.
- **Power:** book T needs about 2.6 years at half its in-sample Sharpe, B3 5.8, C-6 alone 19, K1 0.7.
- **K1 is already at its kill line:** its last two holdout years are below the 52-week threshold.

### Loop K1p: carry timed on the premium index (registered before running; external research section 1, hypothesis 2)

- **Rule:** long spot, short perpetual while the premium index says the perpetual trades rich. Enter when the 3-day
  mean of the daily premium-index close is above 0; exit when the last daily close is below 0. Costs, coins and
  accounting as K1 (17 majors, development 2020-2022, per notional).
- **Why:** funding is a lagged, clamped transform of the premium, pinned at the 0.01% anchor for a wide band of
  premiums (BitMEX Research). The premium itself says directly whether shorts are paid beyond the anchor.
- **Compared with:** K1 (+20.9% a year [+15.7, +26.4] on development).
- **Gate:** K1p's annual return above K1's, with a weekly-bootstrap interval of the difference above zero.
- **If it passes:** one gatekeeper read of the difference on the reserve tier (2023-2026, never used for carry).
- **Predicted:** no better. The premium is noisier than the 7-day funding mean, so more round trips (0.3% each) eat
  the gain; about +15-20% a year.

**Result K1p** (`carry/k1p.py`, `carry/k1p.txt`): the gate fails, worse than predicted.
- **K1p:** +11.4% a year [+5.8, +17.5], held 43% of coin-days, 456 entries; 2022 -7.8%.
- **K1:** +20.9%, 51% held, 138 entries.
- **Difference:** -9.4% a year [-11.1, -7.7].
- **Reading:** the daily premium flips sign often, so K1p trades 3.3x as often and pays the 0.3% round trip each time;
  in 2022 it was short the perpetual into negative-premium days. K1's slow, lagged funding mean is a feature: it keeps
  the position through noise. No reserve read is spent.
- **Carry line, state:** K1b (entry band) and K1p (premium timing) both lose to K1. The decay is structural, as the
  external research says, and K1 is at its forward kill line. The remaining carry ideas (an AR forecast, OI growth)
  refine timing, which these two loops show is not where K1's return comes from; they are deprioritised.

### Loop C-6u: C-6 on coins it has never seen, 2018-2022 (registered before running; section 4, hypothesis 1, "more coins")

- **Sample:** every Binance spot USDT pair in `loop/.cache/universe_1d.csv.gz` (665 symbols, delisted included) except
  the 53 coins of the extended iteration tier, stablecoins and leveraged tokens; 2018-2022 only, so no holdout tier is
  touched. A signal counts only if the coin's 30-day median quote volume before it is at least $5M (tradability).
- **Rule:** C-6 unchanged (daily; coin minus BTC over 1-5 days at most -15%; 2.5x volume on quote volume; close in the
  upper half; stop at the low minus 0.5 ATR; target half way back; 10 days), scored with the same random-entry control.
- **Falsifier (research section 4):** edge on the new coins below +0.2R, or its week-clustered interval spanning zero
  with at least 25 independent weeks.
- **Predicted:** many more trades (100-200) in more weeks; edge lower than on the iteration tier (smaller, less liquid
  coins revert less cleanly), about +0.3R, week-clustered interval above zero.

**Result C-6u** (`loop/c6_universe.py`): too few events to read.
- **Data:** 304 never-used symbols, 280 of them with at least 260 days before 2023. The rule fired 30 times on the
  first 400 symbols scanned and 9 times after the $5M liquidity filter (a diagnostic count, made to check a
  suspiciously low result; the data was verified sound, e.g. ICX with 3,002 days and no BTC gaps).
- **The registered read:** 7 trades on 6 coins in 5 weeks, edge -0.61 (week-clustered [-0.92, -0.27]).
- **Falsifier:** the 25-week condition cannot be met. On 7 trades no inference is possible, and the sign is not
  evidence either way.
- **Reading:** an idiosyncratic capitulation with 2.5x volume and a strong close is a large-cap event; small coins
  rarely produce it on liquid volume. The "more coins" route to power is exhausted for the daily definition, and the
  4h route dilutes it (C-8). Under the closure criteria being written, C-6 is parked (positive, under-powered), not
  closed.

### Loop D-3: box break with a time-only exit (registered before running; section 3, hypothesis 5)

- **Change from D-1x (one):** no target; exit at the stop (box middle) or after 30 bars. Same coins, tier and costs.
- **Sources:** Zarattini and Aziz (SSRN 4416622; a 10R target that is almost never hit, so in practice a time exit);
  our own F-2 and B1 time-exit results.
- **Falsifier:** edge not above D-1x's +0.188 (iteration, extended tier).
- **Predicted:** a small gain, about +0.05R, from letting the right tail run.

**Result D-3:** falsified. 366 trades (358 in D-1x; 8 more pass the target check), avg R +0.214, edge +0.155
[-0.012, +0.329]; 2018-20 +0.40, 2021-22 +0.03.
- **Below D-1x's +0.188,** so the one-width target stays.
- **Reading:** unlike a trend-line break or B1, a box break's move is bounded. One box width is roughly the move it
  makes, and 13% of the stopped trades had already reached +1R first. The time exit is not a general improvement; it
  depends on the setup.

## Closure audit rescues: A8x and B-5x (registered before running)

The closure audit (`loop/closure_audit.py`) finds two positive near-misses that were never retested at power: A8
(weekly support bounce in low volatility, +0.41 on 51 trades, 33 weeks) and B-5 (daily-level break out of compression,
+0.32 on 74 trades). STRATEGIES.md said A8 "resolved on wider data (A9-A12)", but A9-A12 tested other variants. That
was wrong.
- **Change:** none to the rules; each is run on the extended iteration tier. Only the 36 coins new to the family count
  as the replication; the 17 discovery coins are reported apart.
- **Status rule (loop/CRITERIA.md):** on the new coins, a week-clustered interval above zero revives the variant; an
  upper bound below +0.10R closes it; anything else parks it, with the data needed stated.
- **Predicted:** both shrink toward zero on new coins (regression to the mean after selection); parked or closed.

**Result of the rescues (week-clustered):**

| variant | new 36 coins | discovery 17 coins | status |
| --- | --- | --- | --- |
| A8x | -0.234 (91 trades) [-0.52, +0.06] | +0.407 (51) [-0.02, +0.80] | **closed**: the upper bound on new coins is below +0.10R |
| B-5x | +0.056 (66) [-0.43, +0.56] | +0.323 (74) [-0.16, +0.82] | **parked**: inconclusive, the detectable edge is about 0.7R |

Both shrank on new coins, as predicted. A8 is now properly closed, on evidence and not by assertion. B-5's
mechanism (a break out of compression) is not ruled out; it is inconclusive and does not need its own line, because
the trend book carries breakouts at the portfolio level.

## Pre-loop closure audit and rescues R-1 (flags) and R-2 (pure crash) (registered before running)

The pre-loop family audit (by a subagent, against `loop/CRITERIA.md`) flags two closures that rest on an inconclusive
positive holdout and were never retested:
- **patterns-v2 F-raw** (a flag after an impulse, 4h): holdout +0.116 [-0.028, +0.266] on 894 trades.
- **oversold O1** (close at least 25% below the 10-day high, daily): holdout +0.103 [-0.020, +0.230] on 895 trades.

Both rules are unchanged and run on coins new to each lineage over 2018-2022:
- **R-1:** F-raw on the extended iteration tier minus BTC and ETH (51 coins; its development used only BTC and ETH).
- **R-2:** O1 on the 36 extended coins (its development used the 17 majors) plus the never-used universe coins of C-6u
  with the same $5M liquidity filter.

Status rule (CRITERIA): a week-clustered interval above zero with an estimate of at least +0.10R makes the rule
active; an upper bound below +0.10R closes it; anything else parks it.

Predicted: both close to their holdout estimates (+0.05 to +0.10), so equivalent-null or parked; neither active.

**Result R-1 / R-2 (week-clustered):**
- **R-1, F-raw on 51 new coins:** 2,293 trades in 235 weeks, edge -0.128 [-0.253, +0.014]. **Closed**
  (equivalent-null); the holdout +0.116 does not replicate.
- **R-2, O1 on the 36 extended coins:** 1,113 trades, +0.011 [-0.149, +0.189] (inconclusive).
- **R-2, O1 on 169 never-used universe coins:** 2,990 trades, -0.079 [-0.234, +0.086] (equivalent-null).
- **R-2 pooled, as registered:** 4,103 trades in 160 weeks, -0.055 [-0.208, +0.103]. **Parked** by the rule, because the
  upper bound is 0.003 above SESOI, even though the estimate is negative. The rule is applied as written, not
  re-read; O1 is parked at the lowest priority, with no revisit planned.

## Bucket audit (registered before running; the user's question: can a test universe of one kind kill a rule that works in another?)

- **Asset buckets:** majors (the 17 iteration coins), mid caps (the 36 extended coins) and small caps (never-used
  universe coins, where a test reached them). **Context buckets:** BTC above or below its 200-day mean (bull or bear),
  and volatility above or below its long-run level (ATR(14)/ATR(100) at the entry).
- **Files:** the closed and parked loop variants with the most data: A8x, A11, A12, B-5x, B-9, B-10, C-8, E-1x, E-4,
  E-5, G-1, R-1, R-2.
- **Per cell:** the edge with a week-clustered bootstrap. Per bucket: the interaction (bucket minus the rest of that
  variant). One-sided p-values, Holm across all cells at 5%.
- **A bucket hit only means "investigate".** Reviving a rule in one bucket needs a mechanism stated before looking and a
  confirmation on new coins of that bucket (subgroup-credibility criteria).
- **Also a coverage table:** which asset classes and buckets each family was ever tested on. A family is closed only for
  the buckets it was tested on.
- **Predicted:** no cell survives Holm; one or two nominal hits, as expected by chance across about 100 cells.

**Result, bucket audit** (`loop/bucket_audit.py`, `loop/bucket_audit.txt`): 75 cells across 13 variants. **No cell
survives Holm**, as predicted.
- **One nominal hit:** A8x on the majors (+0.41, p 0.03), which is A8's discovery sample, so a selection artifact; the
  new-coin test answered it (-0.23).
- **Next strongest:** B-5x in low volatility (+0.29, p 0.07) and C-8 in low volatility (+0.22, p 0.09).
- **Small caps (R-2):** -0.08.
- **Bug fixed before reading:** the first Holm computation used the wrong rank inside the running maximum; it did not
  change any flag.

**Coverage, by asset class** (from the pre-loop audit and the loop files):

| family | crypto majors | crypto mid caps | crypto small caps | FX | gold, commodities | equity indices |
| --- | --- | --- | --- | --- | --- | --- |
| A support bounce | yes | yes | no | no | no | no |
| A12/B-9 round numbers | yes | yes | no | no | no | no |
| B break continuation | yes | yes | no | no | no | no |
| E box fade, range v1-v6 | yes | yes | no | yes (range-v1, inconclusive) | no | no |
| G-1 fading breaks | yes | yes | no | no | no | no |
| flags F-raw | BTC, ETH | yes | 14 small (holdout) | yes (patterns-v2 FX) | no | no |
| O1 pure crash | yes | yes | yes | no | no | no |
| setups B1, P1-P3, R1 | yes | no | 15 unseen | yes | no | no |
| trend T0, B3 | yes | point-in-time top 20 | no | no | gold, silver (T0 only) | no |
| capitulation C-6 | yes | yes | yes (7 trades) | no | no | no |

- **Under CRITERIA, a closure covers only the cells it tested.** The loop families A, B, E and G are "closed for crypto
  majors and mid caps, 2018-2022" and untested elsewhere.
- **FX is the largest gap with a prior.** Osler's FX order-flow studies predict support/resistance and round-number
  effects there, which is exactly what families A and A12/B-9 tested in crypto only.

## FX bucket (registered before running; CRITERIA section C, rule 2)

- **Prior:** Osler (2000, 2003). In FX, support/resistance levels interrupt trends, take-profit orders clustered at
  round numbers make them reverse, and stop-losses just beyond make crossings run. Families A (support bounce) and
  A12/B-9 (round numbers) were tested on crypto only, where Osler's mechanism has weak support (clustering yes,
  tradable reversals mostly not).
- **Variants (3, one-to-one transfers of the crypto rules), on 9 FX pairs, daily, 2017-2022:**
  - A3fx: A3's swing-level bounce with the trigger entry; no BTC gate.
  - A12fx: the round-number bounce, round numbers at the big and half figures (a step of 1/200 of a decade:
    EURUSD 0.005, USDJPY 0.5).
  - B-9fx: the round-number break continuation, same step.
- **Costs:** 0.01% a side. **Directions:** all positive (Osler).
- **Gates:** Holm across the three at 5%; status by CRITERIA (SESOI +0.10R). FX 2023-2026 is kept for one gatekeeper
  read if any variant becomes active.
- **Predicted:** inconclusive or null for all three. Osler's effects are intraday and last hours to days, and daily bars
  with 20-day holds blur them; a 4h or hourly version is the successor if A12fx or B-9fx points positive.

**Result, FX bucket (week-clustered, SESOI +0.10R):**

| variant | trades | edge | interval | status |
| --- | --- | --- | --- | --- |
| A3fx swing-level bounce | 325 | -0.121 | [-0.286, +0.048] | closed (equivalent-null) |
| A12fx round-number bounce | 1,077 | -0.136 | [-0.231, -0.040] | closed (harmful) |
| B-9fx round-number break | 774 | -0.126 | [-0.250, +0.003] | closed (equivalent-null) |

- **No variant points positive,** so the registered intraday successor does not run.
- **Pairs:** only single pairs are positive (EURUSD +0.30 in A3fx, AUDUSD +0.29 in B-9fx). Each has about 40 trades, and
  9 pairs x 3 variants makes 27 cells, so they are chance by the subgroup criteria.
- **Scope:** the level and round-number families are now closed for crypto majors, mid caps and daily FX 2017-2022.
  They remain untested in intraday FX (Osler's own horizon, which needs an execution model) and in commodities
  (no prior, so not opened, per CRITERIA C rule 2).
- **Small caps:** reversal in small, illiquid coins has a prior (Ficura 2023), but as a weekly cross-sectional effect,
  a different construct from the box fade. Fieberg et al. (2024) find it economically negligible after costs. It is
  recorded as an untested idea and not opened.

## Stage-4 pooled read P-1 (registered before running; CRITERIA section A, stage 4)

- **Rules (frozen, unchanged):** D-1 box break, G-2 retest, F-1 and F-2 trend-line break (one lineage, two exits), C-6
  idiosyncratic capitulation, B1 4h momentum.
- **Pooled data:** every post-2022 holdout coin of the loop: the validation 20, final 12, reserve 20 and majors 17 (69
  coins), 2023-01 to 2026-08, all included whatever their earlier verdicts. No development data. Trades duplicated
  across tiers are counted once.
- **Statistic:** the pooled edge with a week-clustered bootstrap standard error (week clustering handles the same-day
  correlation across coins); t = edge / SE.
- **Stage 4 passes** when t >= 3.0 (Harvey, Liu and Zhu) and the edge >= SESOI (+0.10R). Otherwise the stage-2
  three-level verdict is reported.
- **Run by a fresh-context gatekeeper** (`loop/gatekeeper_pool.py`); details sealed in `loop/sealed/P-1_pool.json`.
- **Contamination, stated:** most of these coins were read before, rule by rule. Stage 4 is by definition the pooling of
  those reads, so this is not a new holdout. It is the joint judgment the criteria require, with no read dropped.
- **Predicted:** no rule reaches t >= 3. D-1 and F-1 come nearest (t about 2-2.5); C-6 has too few trades; B1 is below
  SESOI.

## Cross-asset read X-3: the frozen B3 trend book outside crypto (registered before running; CRITERIA C rule 2)

- **Prior:** Moskowitz, Ooi and Pedersen (2012), and Hurst, Ooi and Pedersen (2017). Time-series momentum is positive in
  every asset class.
- **Rule:** B3 exactly as in `trend/books.py` (Donchian ensemble 5-360 days, midpoint trailing stop, long only, 25%
  volatility target per instrument divided by N, gross at most 1), costs 0.03% a side.
- **Universe (daily, TradingView), in three buckets:**
  - commodities: gold, silver, WTI, Brent, natural gas, copper;
  - equity indices: S&P 500, Nasdaq 100, Dow, DAX, Nikkei, FTSE;
  - FX: the 9 pairs from FXCM hourly data.
  - Period: 2008-01 to 2026-08 where data exists. All of it is new to B3.
- **Gates, three-level, weekly bootstrap, Holm over the two:** (1) B3 book Sharpe above zero (against cash); (2) Sharpe(B3)
  minus Sharpe(B1, the 200-day regime book) above zero. Buckets are reported as Sharpe per bucket, descriptive, with
  their count disclosed.
- **Run by the gatekeeper** (`loop/gatekeeper_xasset.py`); details sealed in `loop/sealed/X-3_xasset.json`.
- **Predicted:** against cash, PASS (Sharpe 0.4-0.8, long-only trend on commodities and indices over 18 years); against
  the regime book, FAIL (edge positive, interval spans zero). Long-only loses the short side the literature uses, so
  FX contributes little.

**Verdict P-1 (gatekeeper relay):**
- D-1: stage 4 FAIL (edge positive, interval spans zero)
- G-2: stage 4 FAIL (edge positive, interval spans zero)
- F-1: stage 4 FAIL (interval above zero, t below 3 or edge below SESOI)
- F-2: stage 4 FAIL (edge positive, interval spans zero)
- C-6: stage 4 FAIL (edge positive, interval spans zero)
- B1: stage 4 FAIL (edge positive, interval spans zero)

As predicted, no rule reaches t >= 3. Pooled over all 69 post-2022 holdout coins, every rule keeps a positive sign, and
F-1 is the only one whose pooled week-clustered interval excludes zero. F-1 is the strongest single rule, still short of
the stage-4 bar. All six stay at stage 3 (forward). The holdout universe is now exhausted for these lineages: no
further pooled read on 2023-2026 crypto is admissible, so new evidence can come only from forward data.

**Verdict X-3 (gatekeeper relay):**
- B3 cross-asset against cash: FAIL (edge positive, interval spans zero) at 97.5%
- B3 minus B1 cross-asset: FAIL (edge positive, interval spans zero) at 97.5%

- **The first prediction was wrong:** a PASS against cash was expected. The frozen long-only B3 is positive outside
  crypto but not significant over 2008-2026 on 21 instruments.
- **The second verdict is as predicted.**
- **Reading:** the cross-asset literature's strong result is for long-short trend following on futures, with
  diversified volatility scaling. B3 is long-only by design (crypto), and some series carry roll jumps. No variant is
  tried on this data, because the read is spent; a long-short trend book would be a new registered rule, at stage 0.
- **For the trend line:** consistent in sign with crypto (T-1, T-2, validation), adding no significance. It stays at
  stage 3 (forward).

## Decay diagnosis D-R (registered before running; the user's question: is the recent weakness regime or decay?)

- **Data (open, already read; no sealed tier is touched):** trendline_break_strong (F-1) on 15 coins
  (`combo/holdout_events.csv.gz`), B1 on 15 unseen coins (`altcoins/events.csv.gz`), T0 on 37 coins
  (`trend/trades.csv.gz`); 2018-2022 against 2023-2026.
- **Regimes at entry, from BTC daily closes known at the entry (thresholds fixed as terciles of 2018-2022):**
  - volatility: 30-day realised;
  - trend: 60-day efficiency ratio, |net change| / sum of |daily changes|.
- **Decomposition:**
  - expected 2023-2026 edge = the sum over regime cells of (2023-2026 share x 2018-2022 edge in that cell);
  - "regime shift" = expected minus the 2018-2022 edge;
  - "within-regime decay" = the actual 2023-2026 edge minus expected, with a week-clustered bootstrap interval from a
    regression of edge on a post-2022 dummy plus the regime cells.
- **Reading:**
  - within-regime decay near zero, with a negative regime shift: the weakness is the market state (it can come back);
  - significantly negative within-regime decay: the edge itself shrank.
- **Predicted:** mixed. Trend-type rules (F-1, T0) lose mostly through the regime (fewer efficient trends after 2022);
  B1 shows some within-regime decay.

**Result D-R** (`loop/decay_diagnosis.py`, `loop/decay_diagnosis.txt`): the prediction was wrong. **The regime did not
turn against the rules; the edge shrank within the same regimes.**
- **The market state after 2022:** BTC was in its 2018-2022 low-volatility tercile on 85% of days (33% before). Trend
  efficiency was unchanged (35/31/34%).
- **Low volatility was the best cell before 2022** for F-1 (+0.36) and B1 (+0.18), so the regime mix alone predicts
  better results after 2022 (regime shift +0.14 for F-1, +0.06 for B1, +0.22 for T0).
- **Within-regime decay (post-2022 coefficient, week-clustered):**
  - F-1: -0.23 [-0.45, -0.02], significant; low volatility +0.36 to +0.15, high trend +0.35 to +0.06.
  - B1: -0.07 [-0.26, +0.11], not significant; its overall edge barely moved (+0.111 to +0.099).
  - T0: -0.51 [-1.30, +0.24], not significant and wide; high-trend cells still best (+1.60 before, +0.47 after).
- **Reading:**
  - F-1's timing edge decayed. That is structural or maturity decay (types 2 and 4), not a temporary regime, and refits
    cannot fix it.
  - B1's timing edge held; its book losses in 2025-2026 come from market direction, not from timing.
  - T0 still earns in efficient trends, but they paid less after 2022.
- **Caveat:** "low volatility" after 2022 is lower than anything in the 2018-2022 tercile, so part of the "decay" could
  be an extreme-low-volatility state that has no counterpart before 2022.
- **Consequences, none of them refits:**
  - F-1/F-2's expected edge in the forward plan is taken at the post-2022 level (about +0.10R), not the development
    level.
  - The sequential test's H1 (half the backtest Sharpe) is already close to that.
  - The catalogue notes the decay.

## Coin-volatility bucket V-1 (registered before running; the user's hypothesis)

- **Hypothesis (direction stated):** after 2022, the rules earn more on coins whose own volatility is high (volatile new
  or small coins) than on calm coins.
- **Data:** the same open sets as D-R (F-1 on 15 coins, B1 on 15 unseen coins, T0 on 37 coins). The coin's own 30-day
  realised volatility at entry comes from `loop/.cache/universe_1d.csv.gz`, with terciles fixed within each rule on
  2018-2022.
- **Test:** the post-2022 interaction (high-volatility tercile minus the rest), week-clustered bootstrap; Holm over the
  three rules.
- **Prior against:** Ficura (2023), momentum in large, liquid coins and reversal in small ones; Fieberg et al. (2024),
  small-coin effects vanish after costs; D-R, the rules were worst on high BTC-volatility days.
- **Predicted:** no positive interaction survives Holm; the high-volatility tercile is no better, and possibly worse.
- **Limit, stated:** these are Binance-listed coins only. Nothing here transfers to on-chain DEX tokens (rug pulls, MEV,
  liquidity withdrawal).

**Result V-1** (`loop/coin_vol_bucket.py`, `loop/coin_vol_bucket.txt`): **the hypothesis is rejected in the opposite
direction.** After 2022, the most volatile coins were the worst.

| rule | low vol, 2018-22 / 2023-26 | mid | high | post-2022 high minus rest |
| --- | --- | --- | --- | --- |
| B1 | +0.18 / +0.16 | +0.10 / +0.05 | +0.06 / -0.20 | -0.33 [-0.62, -0.05] |
| F-1 | +0.26 / +0.18 | +0.17 / -0.02 | +0.13 / -0.43 | -0.56 [-0.88, -0.23] |
| T0 | +1.04 / +0.24 | -0.47 / +0.15 | +0.72 / -0.03 | -0.22 [-0.68, +0.19] |

- **No positive interaction** (Holm p = 1 for all three).
- **The reverse is consistent across rules and periods:** the calmest tercile is the best or near-best for the two 4h
  rules before and after 2022, and it decays least (B1 +0.18 to +0.16). High-volatility coins went from weak to clearly
  negative.
- **This matches Ficura (2023):** momentum in large, liquid coins and reversal in small, volatile ones.
- **Not adopted:** "trade only calm coins" was not the registered direction. As a filter it would be a new rule, to be
  registered and confirmed on new data, not adopted from this split.

## Candidate CF: calm-coin filter (registered for the forward record only; from V-1)

- **Rule:** take a B1, b1_time, trendline or trendline_time signal only when the coin's 30-day realised volatility
  before the signal is at or below the 2018-2022 lower tercile of that rule. The cut-offs are fixed now in
  `loop/calm_filter.json`: B1 and b1_time 78.8% a year; trendline and trendline_time 82.5%.
- **Status:** stage 0. It came from looking at V-1, so no historical data counts as evidence for it. Only forward
  signals logged after 2026-10-01 count.
- **Mechanics:** no change to the record. Volatility is computed at scoring time from prices before each signal.
- **Decision on 2027-10-01** (with the forward plan): the forward edge of calm signals minus the rest, week-clustered.
  The filter is admitted only if that interval is above zero. One year will likely be too short; the record continues
  if it is undecided.
- **Falsifier:** the calm minus rest difference at or below zero over the first forward year.

## Family P: the original Ronnie trading plan under the new workflow (loop P-1, registered before running)

The plan (`ronnie_plan.py`): F2 weekly direction, the R1/R2/R4/R5 zone map, the F1 Bollinger state, and setups S1-S5.
It was tested once, on BTC alone (Bitstamp, 2017-2022 and 2023-2026): portfolio Sharpe -0.14 and -0.43, judged failed
by its own kill rule. Under CRITERIA it is unaudited: one instrument gives no power, and the setups were never judged
with a random-entry control on a broad universe.

- **Stage 0, priors from this session's research (EXTERNAL_RESEARCH; CRITERIA sources):**
  - S2b (large-body breakout) is momentum, supported by the breakout and time-series momentum literature; as B1 it is
    already active.
  - S1 (zone bounce) and S5 (a sweep of resistance, then a short): support for levels exists only in intraday FX
    (Osler). Loop A closed bounces in crypto and daily FX, and G-1 closed fading breaks.
  - S3 (range play) and S4 (layered Fibonacci pullback): Fibonacci ratios were no better than random ratios
    (`run_controls.py`); no academic support was found.
- **Rule:** the plan frozen with its declared defaults. Nothing is tuned.
- **Data:** the extended iteration tier (53 coins, 2018-2022), never used for the plan. Holdout tiers are untouched for
  S1, S3, S4 and S5.
- **Scoring:** each plan trade is re-scored by the loop engine at its fill bar (entry, stop and target as filled) with
  20 matched random entries (same year, side, stop in ATR, target in R, hold). Edge per setup, week-clustered
  interval, status by CRITERIA (SESOI +0.10R); Holm over the five setups for "active".
- **Predicted:** S2b active or positive; S1, S3 and S5 equivalent-null or harmful; S4 inconclusive (few trades). The
  plan as a whole is not positive.

**Rerun P-1 (suspected bug, not the cause):** the stop was rebuilt from the plan's own ATR instead of the engine's.
Results were identical, so the two ATRs agree and this was not a bug.

**Rerun P-1 (the real cause):** `engine.score` (through `range2/run.py:93`) silently drops trades whose target is below
1R. 90% of S4's trades have targets below 1R (the impulse extreme lies close to the layered fills), and those earn
+0.12R in the plan's own fills. The engine kept only the 10% with targets of at least 1R, which lose -0.18R, so S4
looked harmful from selection alone. Family P now scores without that filter, with controls matched on target R as
before. Every earlier loop had targets of at least 1R by design, so no earlier result is affected (workflow note 54).

**Closure re-check for the silent filter:** families with targets possibly below 1R were rescored without it.
- E-1x: -0.165 [-0.330, +0.005] (529 trades, 2% previously dropped).
- E-4: -0.108 [-0.237, +0.024] (6% dropped).
- E-5: -0.102 [-0.282, +0.079] (5% dropped).
- G-1: -0.396 [-0.611, -0.144] (none dropped).
Every closure stands.

**Result P-1** (`loop/family_p.py`, `loop/p-1_plan.txt`; edge against matched random entries, week-clustered):

| setup | trades | edge | interval | status |
| --- | --- | --- | --- | --- |
| S1 zone bounce (limit) | 6,656 | -0.058 | [-0.130, +0.013] | closed (equivalent-null), 53 coins |
| S2b large-body breakout | 135 | +0.289 | [-0.360, +0.901] | inconclusive (starved: as B1 alone it has thousands of trades) |
| S3 range play | 327 | -0.032 | [-0.126, +0.069] | closed (equivalent-null) |
| S4 layered Fibonacci pullback | 5,151 | +0.060 | [+0.013, +0.105] | positive but below SESOI; longs +0.10, shorts +0.04 |
| S5 sweep short | 600 | +0.008 | [-0.100, +0.112] | inconclusive (upper bound 0.012 above SESOI) |
| the whole plan | 12,869 | -0.004 | | not positive, as predicted |

- **Predictions:** S1 and S3 closed as predicted; S2b inconclusive only because it was starved; S4 better than
  predicted.
- **Diagnosis:**
  - S1 makes half the plan's trades with no edge, and it occupies the risk budget and cooldowns that S2b needs.
  - S4 carries a small but real timing edge. Two competing explanations: Fibonacci levels matter, or any layered
    pullback inside the weekly trend works.

### Loop P-2 (registered before running; amendment 4: one structural change plus a discriminating test)

- **P-2a, structural:** the plan without its two closed setups (S1, S3). The same risk rules then allocate to S2b, S4
  and S5. Prediction: S2b trades rise severalfold, its edge stays positive, and the plan's pooled edge turns positive
  (about +0.05 to +0.10).
- **P-2b, discriminating test for S4:** S4 with placebo ratios (0.30, 0.45, 0.70) in place of (0.382, 0.5, 0.618),
  same weights, inside P-2a.
  - If the edge is the same (difference within +-0.03), it comes from "a layered pullback inside the trend", not from
    Fibonacci.
  - If clearly lower, Fibonacci levels matter.
  - Prediction: the same; Fibonacci ratios were no better than random ratios on BTC (`run_controls.py`).
- **Status rule as in P-1.** No holdout is read in this loop.

**Result P-2:**
- **P-2a (S1 and S3 removed):** the plan's pooled edge turns positive, +0.059 (5,889 trades), as predicted.
  - S2b stays at 135 trades, so the starvation explanation is wrong. S2b inside the plan is limited by the plan's own
    filters (F2 weekly direction, the F1 state), not by S1's use of the risk budget.
  - Standalone (B1) it trades thousands of times and is active.
- **P-2b (placebo ratios 0.30/0.45/0.70):** S4 +0.056 [+0.012, +0.099] against +0.060 with Fibonacci, a difference
  within the registered +-0.03. **The edge is not Fibonacci**: it comes from layered limit entries on a pullback inside
  the weekly trend, as predicted.
- **State of the plan:**
  - S1 and S3 closed (53 coins, equivalence).
  - S2b is better as B1, already active.
  - S4 is a small, real timing edge, about +0.06, below SESOI, whatever the ratios. Parked as "positive, below SESOI";
    a candidate for an ensemble at small weight (CARVER), not a strategy alone.
  - S5 parked (upper bound +0.109).
  - Further variant searches on S4 on this data (sides, ratios, filters) would be selection on read data. Its only
    clean next step is a stage-2 read, and the ladder's stage 1 (edge >= SESOI) is not met, so none is spent.

## Loop P-3: the Ronnie plan drawn faithfully, multi-timeframe with 1h execution (registered before running)

Built from EXTERNAL_RESEARCH section 7: Ronnie's own rules first, generic practice where he states none. All higher
timeframe values come from closed bars only (daily bars close at the next day's start; weekly bars at the week's end).
- **Direction (two screens; Elder's 5x rule and Ronnie's alignment):** up when the last closed weekly 13-EMA is above
  the prior week's and the last closed daily close is above its 20-day mean; down when both are reversed. Variants Q-1
  to Q-3 trade only in that direction; Q-4 ignores it (a range).
- **Execution:** 1h bars. A 1h trigger is a rejection: the bar reaches the level and closes back on the trade side,
  with a body in the trade's direction. Entry at the next 1h open. Fee 0.06% a side. One open trade per variant per
  coin, then a 24-bar spacing.
- **Variants (4 plus one control):**
  - **Q-1 big-swing Fibonacci:**
    - Anchor: the impulse between the last two confirmed daily pivots of order 21 (Ronnie's anchors; the ZigZag-scale
      swing of the sources), in the direction of the bias.
    - Entry: a 1h rejection inside the 0.5-0.618 retracement band.
    - Stop: 0.1 daily ATR beyond 0.786 (the common invalidation).
    - Target: the impulse extreme (Ronnie's TP1, the prior high).
    - One trade per impulse.
  - **Q-1p control:** Q-1 with a non-Fibonacci band 0.42-0.53 and a stop beyond 0.70 (the Tsinaslanidis control).
  - **Q-2 break, retest, confirm at round numbers (his 2024+ entry):**
    - Levels: round numbers with a step of a tenth of a decade (BTC 1,000; ETH 100).
    - A daily close through a level in the bias direction arms it for 10 days.
    - Entry: a 1h rejection at the level (within 0.25 daily ATR) that closes back beyond it.
    - Stop: 0.5 daily ATR beyond the level. Target: 2R (he gives the next round number or the prior high; 2R is our
      stated assumption).
  - **Q-3 daily middle band as support:**
    - In the bias direction, with daily BandWidth higher than 5 days before (bands opening).
    - Entry: a 1h rejection at the daily 20-day mean (within 0.25 daily ATR).
    - Stop: 0.5 daily ATR beyond the mean. Target: the daily band on the trade side.
  - **Q-4 squeeze as a range (his reading):**
    - When daily BandWidth is in the bottom 10% of its last 125 days, fade a 1h rejection at the daily outer band.
    - Stop: 0.5 daily ATR beyond the band. Target: the middle band. Hold at most 240 1h bars.
- **Hold:** at most 720 1h bars (30 days) for Q-1 to Q-3.
- **Data:** the extended iteration tier (53 coins), 2018-2022, hourly from Binance.
- **Scoring:** matched random entries on 1h bars (same year, side, stop in 1h ATR, target in R, hold); edge,
  week-clustered interval, CRITERIA status; Holm over Q-1 to Q-4 for "active".
- **Fibonacci test:** Q-1 minus Q-1p. If within +-0.03R, the levels are not Fibonacci-specific.
- **Priors and predictions:**
  - Q-1 inconclusive or slightly positive (the S4 pullback edge was +0.06), with Q-1p about equal.
  - Q-2 inconclusive (G-2's retest was positive; round-number breaks in crypto and FX were closed).
  - Q-3 equivalent-null (Bollinger edges decayed, Fang et al.).
  - Q-4 equivalent-null or harmful (range fades are closed).
  - No variant active.

**Result P-3** (`loop/family_q.py`, `loop/p-3_plan.txt`; 53 coins, 2018-2022, 1h execution, week-clustered):

| variant | trades | edge | interval | status |
| --- | --- | --- | --- | --- |
| Q-1 big-swing Fibonacci (0.5-0.618, daily order-21 anchors) | 139 | -0.004 | [-0.242, +0.232] | inconclusive (low power) |
| Q-1p non-Fibonacci control | 184 | -0.045 | [-0.228, +0.160] | inconclusive |
| Q-2 break, retest, confirm at round numbers | 1,566 | +0.019 | [-0.101, +0.142] | inconclusive |
| Q-3 daily middle band as support | 804 | -0.057 | [-0.219, +0.123] | inconclusive |
| Q-4 squeeze as a range (fade the bands) | 794 | -0.205 | [-0.331, -0.070] | harmful |

- **No variant is active,** as predicted.
- **Q-4 is harmful,** as predicted: a squeeze read as a range loses when fading the bands, consistent with the closed
  range-fade families.
- **The Fibonacci test (Q-1 minus Q-1p, +0.041)** is beyond the registered +-0.03, but both intervals span about
  +-0.2R, so it says nothing either way.
- **Q-1 sides:** shorts +0.42 (48 trades) and longs -0.23 (91); with this many split cells it is noise by the subgroup
  rules.
- **Status:**
  - Q-4 closed (harmful).
  - Q-1, Q-2 and Q-3 parked: each upper bound is above SESOI (+0.23, +0.14, +0.12), and the estimates are about zero
    or negative.
  - **The faithful drawing did not reveal a hidden edge.** Drawn the way Ronnie and the practitioner sources describe,
    on 1h execution, the plan's techniques are no better than matched random entries on 53 coins. The only positive
    edges in the plan remain S2b (as B1) and the layered pullback S4 (+0.06).
  - Big-swing Fibonacci (139 trades) needs about 4x the data to reach a detectable edge of 0.1R. That is the
    resolvable gap, and new coins or forward data are the only clean source.

## Loop P-4: Ronnie's 2024-2025 method from his own videos (registered before running)

Source: `RONNIE_2024_RULES.md` (23 transcripts of his 2024-2025 videos). It differs from P-3: no indicators (P-3's
Bollinger variants were not his current method); zones from prior highs and lows; trend flips only on a large-bodied
close through the effective low; limit entries in zones; stops beyond the zone; reward to risk at least 2.
- **Common (daily bars, 53 coins, 2018-2022):**
  - Pivots of order 3 (assumption).
  - Large body: at least 1.5x the median body of the last 20 days.
  - Trend state: up after a large-bodied close above the last confirmed pivot high; down after one below the last
    confirmed pivot low; otherwise unchanged (his "effective low" rule).
  - Limit orders are valid 10 days and fill at the limit, or at the open if it gaps through.
  - Hold at most 60 days; fee 0.06% a side.
- **R-1 role reversal (his favourite long):**
  - Trigger: in an up trend, a large-bodied daily close above a pivot high.
  - Entry: a limit at that pivot high (the broken level).
  - Stop: 0.25 ATR below the zone's lower edge (the pivot candle's body top, at most 1 ATR below the high).
  - Target: 2R.
  - Down trends are mirrored (with-trend shorts only).
- **R-2 Fibonacci on the latest move:**
  - The impulse runs from the effective low (the pivot low before the up flip) to the highest close since, anchored
    on closes (his 2025 practice).
  - Entry: a limit at the 0.5 retracement.
  - Stop: 0.25 ATR beyond the effective low (the trend's invalidation).
  - Target: the 100% extension from the fill (AB=CD, his stated target), about 2R by construction.
  - Mirrored for down trends.
- **R-3:** R-1 on altcoins, only when BTC's trend state agrees ("BTC leads"); BTC itself unfiltered.
- **Scoring:** matched random entries (same year, side, stop in ATR, target in R), week-clustered; CRITERIA statuses;
  Holm over R-1 to R-3 for "active".
- **Predicted:**
  - R-1 positive but inconclusive (G-2, a retest of a broken box edge, was +0.25 on 4h);
  - R-2 about zero (the S4 pullback +0.06; Fibonacci itself showed nothing);
  - R-3 about R-1;
  - none active.

**Result P-4** (`loop/family_r.py`, `loop/p-4_plan.txt`; week-clustered):

| variant | trades | edge | interval | status |
| --- | --- | --- | --- | --- |
| R-1 role reversal (retest of a broken pivot high/low, with the trend) | 650 | +0.211 | [+0.066, +0.364]; Holm level [+0.040, +0.394] | **active (stage 1)** |
| R-2 Fibonacci 0.5 on the latest move, target 100% extension | 423 | +0.073 | [-0.108, +0.255] | inconclusive |
| R-3 R-1 with the BTC filter | 613 | +0.235 | Holm level [+0.028, +0.453] | active, not distinct from R-1 |

- **R-1 checks:**
  - both halves positive (2018-20 +0.24, 2021-22 +0.20);
  - every year 2019-2022 positive, 2022 bear +0.18 (2018: 10 trades, -0.76);
  - majors +0.16, mid caps +0.25;
  - longs +0.32, shorts +0.11;
  - 41% of trades reach 2R, 58% are stopped.
  - No look-ahead: pivots are used 3 days after the pivot bar, breaks on closes, limits from the next bar.
- **Better than predicted** (positive but inconclusive was expected). The first rule from Ronnie's own method to pass
  stage 1.
- **Its sibling G-2** (the retest of a broken 4h box edge) was positive on the extended tier and failed its reserve read
  (sign sealed); P-1 pooled it as positive, interval spanning zero.

### R-1 stage-2 read (registered before running)

- **Data:** R-1 frozen, on all 69 post-2022 holdout coins (validation 20, final 12, reserve 20, majors 17), 2023-01 to
  2026-08. R-1 was never read there.
- **Run by a fresh-context gatekeeper** (`loop/gatekeeper_r1.py`); one three-level verdict at 95% (a single candidate in
  this batch); week-clustered; details sealed in `loop/sealed/R-1_holdout.json`.
- **Contamination, stated:** the coins were read before for other rules, including the sibling G-2. R-1 itself, its
  level definition and its trend rule never touched 2023-2026, and its mechanism came from his 2024-2025 videos, which
  were watched for method, not scored.
- **Predicted:** FAIL (edge positive, interval spans zero), from the usual shrinkage of 26-58% and the post-2022
  decay seen in D-R.

**Verdict R-1 holdout (gatekeeper relay):** PASS at 95%, meaning the week-clustered interval is above zero on the 69
post-2022 holdout coins. This beats the prediction (FAIL, edge positive, interval spans zero).
- **CRITERIA stage 2 also requires the estimate to be at least SESOI (+0.10R).** The gatekeeper script printed only
  the interval verdict and wrote the SESOI bit to the sealed file.
- **A follow-up relay of that bit was denied** by the permission system: it reads the sealed file directly. It was not
  retried by any other route and is surfaced to the user. Until then, R-1's stage-2 status is "interval above zero,
  SESOI unconfirmed".
- **Process defect (workflow note 55):** the gatekeeper's printed verdict must carry every condition of the stage it
  judges.

**Rerun of the R-1 holdout read (authorized by the user on 2026-10-02):** the gatekeeper script now also prints the
stage-2 verdict with both conditions (interval above zero and estimate at least SESOI). It recomputes from the raw
data; the sealed file is not read. A deterministic rerun of the same registered read, logged as a rerun.

**Verdict R-1 holdout (rerun relay):** PASS at 95%; **stage 2 PASS**, meaning the interval is above zero and the
estimate is at least SESOI on the 69 post-2022 holdout coins.
- **R-1 is the second rule of the study to pass a holdout read** (after carry K1), and the first from Ronnie's own
  method.
- **It moves to stage 3, forward:** `roleflip/forward.py` logs the resting limit orders armed at each daily close
  (37 coins: the 17 majors and the 20 validation large caps), and scores fills after logging. This is the forward
  harness's first limit-order record (workflow note 43). It runs in the daily routine.
- **Gate U (CRITERIA D):** not yet met. R-1 has two independent positive samples (development and holdout), and gate U
  needs three; the forward record is the third.
- **Sequential test:** about 90 trades a year on 37 coins.
  - If the live edge equals the development edge (+0.21R; per-trade standard deviation about 1.4R), the scale-up bound
    is reached in about 170 trades, roughly two years.
  - At half the edge, about 680 trades, roughly seven years.

## Exit iteration X-R1: R-1's stop and target (registered before running; the user asked for our own stop and target iteration)

- **Entries unchanged** (R-1's trigger and limit). Only the stop and target vary.
- **Grid (45):**
  - zone cap of 0.25, 0.5 or 1.0 daily ATR (0.25 is his measured zone width; 1.0 is R-1);
  - stop buffer of 0.1, 0.25 or 0.5 ATR;
  - target of 1.5R, 2R, 3R, structure (the nearest confirmed pivot beyond the entry; 3R if none; his stated target)
    or none (the 60-day exit).
- **Data:** development only (53 coins, 2018-2022).
- **Metric:** Sharpe of the weekly R stream at a fixed risk per trade, which is comparable across stop widths (not R per
  trade).
- **Selection rule (fixed now):** the variant with the best mean Sharpe over itself and its neighbours (one step in zone
  cap or buffer, same target). A plateau, not the peak.
- **Overfitting check:** CSCV PBO over the 45 variants, 12 blocks. If PBO > 0.5, no variant is adopted and R-1 stays.
- **Validation:** none on the holdout, which R-1 already spent. The chosen variant (R-1x) is recorded forward beside
  R-1. Entries are identical, so the decision on 2027-10-01 is the paired per-trade difference, week-clustered, above
  zero.
- **Predicted:** a narrower zone (0.25-0.5) with a structure or 2-3R target edges out R-1. PBO about 0.3. The gain is
  modest (Sharpe +0.1 to +0.3).

**Result X-R1** (`loop/r1_exits.py`, `loop/r1_exits.txt`):
- **Grid baseline:** R-1 as registered (zone cap 1.0, buffer 0.25, 2R) has Sharpe 1.80 on 862 trades. The grid scores
  from the first bar with its own walk, so its counts differ from P-4's 650.
- **Plateau choice (0.5, 0.5, 1.5R):** Sharpe 1.95, neighbourhood 1.90. The best single cell is (0.5, 0.25, 2R) at 1.99.
- **PBO 0.45:** under the 0.5 bar but close to a coin flip, so the differences between exits are mostly noise.
- **By dimension:**
  - targets: 1.5R 1.63, 2R 1.59, 3R 1.52, none 1.43, structure (his prior-high target) 1.12;
  - buffers: 0.1 1.21, 0.25 1.59, 0.5 1.58;
  - zone caps: 0.25 (his measured width) 1.41, 0.5 1.51, 1.0 1.46.
- **Reading:**
  - Fixed 1.5-2R targets beat his structure targets clearly.
  - Stops tighter than 0.25 ATR beyond the zone hurt.
  - His narrow zones are no better.
  - R-1's registered exit sits on the plateau already.
- **Per the registered rule, R-1x (0.5, 0.5, 1.5R) joins the forward record beside R-1.** Same orders, so the
  2027-10-01 decision is the paired per-trade difference. The predicted gain was +0.1 to +0.3 Sharpe; +0.15 came.

**R-1 slot note (found 2026-10-02 while building the scan):** `family_r.signals` marks a coin busy for 60 days from
each fill (`busy = k + HOLD`), even after an early stop or target. The rule that passed stages 1 and 2 is therefore
"at most one R-1 trade per coin per 60 days". This was not intended and is not Ronnie's rule, but it is the tested rule.
- The forward scorer now applies it.
- Every armed order stays logged, so the lock-free version can be reported as an untested diagnostic.
- Workflow note 56.

### R-1 with the slot side effect removed (R-1u; registered before running; the user's decision)

- **The bug:** the slot was held 60 days from each fill. The corrected rule frees a coin's slot at the trade's exit
  (stop, target or 60-day limit): at most one open R-1 trade per coin. Nothing else changes.
- `family_r.SLOT = "exit"` is now the default; "hold" reproduces the old runs.
- **Development rerun (P-4, logged as a rerun):** prediction: more trades (about 1.5x) and a similar edge, +0.15 to
  +0.25.
- **Holdout rerun by the gatekeeper (logged as a rerun):** the corrected rule on the same 69 coins.
  - Contamination, stated: R-1's read on these coins passed, and R-1u shares most of its trades. This read checks that
    the correction does not break the result; it is not new independent evidence.
  - Prediction: stage 2 PASS.
- **If both hold,** R-1u replaces R-1 as the forward record's official rule; the 60-day slot version is no longer
  reported.

**Result, development rerun of R-1u:** 3,781 trades (650 before), edge +0.338 [+0.255, +0.428]; longs +0.39, shorts
+0.27.
- **Better than predicted** (about 1.5x the trades and +0.15 to +0.25 were expected).
- **By year:** 2018 -0.25 (52 trades); 2019-2022 +0.31, +0.39, +0.38, +0.30.
- **Clustering check:** 61% of trades follow the same coin's previous trade within 10 days. These are staircase
  re-entries: break, retest, the next break. At most one trade per coin per day.
  - First trade of each 10-day cluster: +0.250 [+0.136, +0.367] (1,475).
  - Follow-on trades: +0.395 [+0.309, +0.482] (2,306).
- **Reading:** the 60-day slot was suppressing the strategy's own continuation entries, not hiding a defect.

**Verdict, R-1u holdout rerun (gatekeeper relay):** PASS at 95%; stage 2 PASS (69 post-2022 coins).
- **The correction holds** on the read the original rule passed (contaminated as stated; not new independent
  evidence).
- **R-1u replaces R-1 as the official rule:** one open trade per coin, with the slot freed at the exit. The forward
  scorer and `roleflip/scan.py` use it.
- **R-1x** (the X-R1 exit) was chosen on the locked version; it stays a paired forward comparison on the same orders.
- **Forward pace:** about 14 trades per coin-year in development, so about 500 a year on the 37 forward coins. At the
  development edge the sequential scale-up bound is near 70 trades (about two months); at half the edge, near 260
  (about six months). Clustering (61% follow-on trades) makes the effective count lower than the raw count.

**Slot audit across all families (2026-10-02, the user's question):** a lock held for the whole hold period after a
fill appears in family_r (R-1, R-2; fixed) and family_q (P-3: 720 1h bars, 240 for Q-4).
- Every other family uses a signal spacing (A, B, C, O3/C-6, range), one trade per box or line (D, F, G), a lock to
  the fill bar (E), a lock to the exit (T0), or real positions (the Ronnie plan's simulator, the combo portfolio).
  None of these suppresses trades after an exit.
- P-3 is rerun with the slot freed at the exit (logged as reruns). Prediction: more trades, the statuses unchanged
  (Q-1 to Q-3 parked, Q-4 harmful).

**Result, P-3 rerun with the slot freed at the exit:**
- Q-1: 149 trades, -0.020 [-0.248, +0.205]; parked.
- Q-1p: 199 trades, -0.049.
- Q-2: 7,280 trades, -0.057 [-0.137, +0.027]; **now closed (equivalent-null)**, from parked.
- Q-3: 1,423 trades, -0.025 [-0.165, +0.125]; parked.
- Q-4: 1,393 trades, -0.214 [-0.319, -0.104]; harmful.
- Fibonacci test: +0.030.

The lock under-stated R-1 but did not hide an edge in P-3. With 4.6x the trades, the round-number break-and-retest
excludes a meaningful edge.

## Loop R-F: Ronnie's four Fibonacci uses on R-1u (registered before running; the user's request)

His four uses (`RONNIE_2024_RULES.md`): an entry zone (0.382, 0.5-0.618), a stop beyond 0.786, targets at the 100% and
161.8% extensions, and Fibonacci as part of a confluence.
- **Impulse for each R-1u break:** A is the last confirmed order-3 pivot low before the break (mirrored for shorts); B
  is the most extreme high from A through the break bar. All known at the break.
- **Variants (11), each with the same R-1u orders unless stated:**

| id | change from R-1u | placebo (non-Fibonacci ratios) |
| --- | --- | --- |
| base | R-1u (zone stop, 2R) | - |
| F1 | target = fill + 1.00 x (B - A) | F1p: 1.15 x |
| F2 | stop 0.1 ATR beyond the 0.786 retracement of A-B | F2p: 0.86 |
| F3 | only orders whose broken level lies within 0.25 ATR of the 0.382/0.5/0.618 retracement | F3p: 0.32/0.44/0.70 |
| F4 | limit at the 0.5 retracement instead of the broken level; stop beyond 0.786; target 1.00 extension | F4p: 0.44 / 0.86 / 1.15 |
| FULL | F3 filter + F2 stop + F1 target | FULLp: all placebo ratios |

- **Data:** development (53 coins, 2018-2022); slot freed at the exit; matched random-entry controls.
- **Metrics:** Sharpe of weekly R at fixed risk (exits), edge against random entries (filters); week-clustered.
  CSCV PBO over the 11.
- **Fibonacci-specific value:** each variant minus its placebo.
- **Adoption (forward-only, paired with R-1u; the holdout is spent):** a variant whose Sharpe is above R-1u's and
  above its placebo's, with PBO <= 0.5.
- **Predicted:**
  - F1 a little below R-1u (a fixed 2R beat structure targets in X-R1);
  - F2 about equal;
  - F3 and F4 no better than their placebos;
  - FULL about R-1u;
  - each variant minus placebo about 0.
  - No adoption expected.

**Result R-F** (`loop/r1_fib.py`, `loop/r1_fib.txt`; development, Sharpe of weekly R at fixed risk):

| variant | trades | avg R | edge | Sharpe | placebo Sharpe |
| --- | --- | --- | --- | --- | --- |
| base R-1u | 3,781 | +0.335 | +0.338 | 3.02 | - |
| F1 target 1.00 extension | 2,721 | +0.613 | +0.464 | 2.79 | 2.78 (1.15) |
| F2 stop beyond 0.786 | 1,631 | +0.337 | +0.232 | 2.10 | 2.12 (0.86) |
| F3 confluence filter | 2,138 | +0.261 | +0.296 | 2.31 | 2.50 |
| F4 entry at 0.5 | 1,626 | +0.235 | +0.134 | 1.30 | 1.58 |
| FULL | 1,430 | +0.313 | +0.218 | 1.85 | 1.92 |

- **PBO 0.01:** the in-sample best is R-1u in nearly every split.
- **No variant adopted,** as predicted.
- **Fibonacci-specific value** (variant minus placebo) is -0.28 to +0.02: the ratios carry nothing beyond nearby
  non-Fibonacci numbers, consistent with S4 and P-3.
- **The ideas behind his uses do carry something:**
  - Extension targets raise R per trade (+0.61 against +0.34), but 1.15 does the same as 1.00. The value is "let the
    trade run the impulse's length", not the ratio.
  - It costs trades, because the coin's slot stays occupied longer.
- **A split exit** (part at 2R, the rest to the impulse extension; his partial profit-taking) is a new rule. It is not
  tested on read data and would be forward-only.
