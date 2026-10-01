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
