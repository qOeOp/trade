# Ronnie's method in 2024-2025, from his own videos

Source: 23 local transcripts (faster-whisper small, recognition errors expected) of his TradingView video ideas,
2024-01 to 2025-03 (`tv/video_ideas.jsonl.gz`; transcripts stay outside the repository). Evidence is cited as the idea
uuid prefix and a time stamp in seconds; quotes are translated. Extracted by two subagents and merged on 2026-10-01.

## Rules he states

1. **Timeframes:**
   - The daily chart sets direction; weekly and monthly closes confirm it; 4h and 1h show the range and the entry
     zone.
   - The larger timeframe dominates: a smaller timeframe against it is a range ("the larger level suppresses the
     smaller", v1 162).
   - No minute charts, except scalping during the US jobs report.
2. **No indicators:** "naked candles" (FkBj 254-271). One mention of Bollinger Bands, on gold (sg0O 427).
3. **Trend:**
   - Up until the swing low that started the move (the "effective low") breaks, however deep the pullback.
   - The flip needs a close beyond it with a large body; two consecutive candles may count as one (Zlp5 180).
4. **Levels are zones, not lines:** prior highs and lows, with the wicks setting the width. The favourite long is a
   broken prior high retested as support (role reversal). Overlapping levels are preferred.
5. **Breakouts count on the close** of the timeframe the level comes from (sg0O 287); "never judge a candle before it
   closes" (sB6l 441). Chart patterns count only after a close through the neckline (daIJ 422).
6. **Fibonacci:**
   - Drawn on the latest move (4h, daily or weekly); in 2025 he anchors on closing prices (daIJ 350).
   - Retracement levels 0.382/0.5/0.618 (0.764 in 2024).
   - Extensions as targets: 100% (AB=CD), then 161.8%; 361.8% and 461.8% for parabolic moves (JMsn 350).
7. **Entries:**
   - The main entry is a with-trend limit order in the support zone; if it misses, he does not chase.
   - After a confirmed break, he prefers the retest to buying the break.
   - Candle patterns are optional confirmation.
8. **Stops:** beyond the whole zone and its longest wick ("a stop must be valid, not small"); the distance depends on
   the timeframe traded (MZNs 413). Being stopped at resistance can mean reversing (JMsn 188).
9. **Sizing and targets:**
   - Position size from the stop distance; larger with the trend, lighter against it (y0yh 95).
   - Reward to risk at least 2.
   - Targets in a ladder: the 4h flip zone, then the daily high, then the weekly high (O2oR 265-318); partial exits at
     major resistance; with-trend winners are held.
10. **Ranges and selection:**
    - No trades in the middle of a range (he splits ranges into quarters, O2oR 552); he waits most of the time.
    - BTC leads the market; he checks the dollar index first.
    - He trades a rotating set of mid-cap altcoins, plus gold and oil.

## Changes since 2018-2021

- **Kept:** daily direction, weekly closes, limit orders at support, Fibonacci retracements, holding winners.
- **New:**
  - zones from prior highs and lows replace round-number lines;
  - trend lines, channels and patterns matter;
  - breakouts need a large-bodied close;
  - stops are always stated, at structure;
  - extensions are routine targets;
  - no indicators.

## Values he never states (a backtest must assume them)

- Swing detection: our default is a daily pivot of order 3.
- Zone width: from the pivot candle's body to its wick, capped at 1 ATR.
- Large body: at least 1.5x the median body of the last 20 bars.
- Limit validity: 10 bars.
- Stop buffer: 0.25 ATR.
- Exits: partial exits versus one target.

## 2026 check (two videos, 2026-08-11 and 2026-09-30, from third-party AI summaries the user supplied)

Evidence quality: AI summaries (WayinVideo) of two YouTube videos (doz72-I2LKM, rO6RJ2QQvss), not his words; YouTube
itself cannot be read from this host.
- **Unchanged:**
  - wait for a pullback to a trend line, horizontal support or Fibonacci retracement rather than chase;
  - a broken prior high retested as support (BNB), and broken support as resistance (BTC 4h);
  - no trades in the middle of a range (SOL);
  - 4h structure for timing;
  - reward to risk judged explicitly (a 1:1 short is "not high conviction");
  - light size.
- **New or louder:**
  - Bollinger Bands are back as context: the weekly close below the weekly middle band as bearish (BTC), and band
    opening and outside-band closes (oil). This differs from 2024-2025's "no indicators".
  - Confluence of a trend line, horizontal support and Fibonacci 0.382/0.5/0.618 for entries (ETH, HYPE).
  - New coins (HYPE).
- **Consequence:** R-1's core rule is still his main method, so R-1 stays frozen. The two new elements are tracked as
  forward-only tags on R-1's records (FORWARD_PLAN, "R-1 tags"), not fitted on read data.

**Bollinger Bands in 2026, consistent across both videos:**
- **The weekly middle band (20-week mean) is the trend divide:** BTC's weekly close below it is bearish; for gold,
  a large-bodied weekly close above it would confirm strength.
- **Daily closes outside the bands mean a strong trend:** hold, take profits in parts, do not counter-trade.
  Shrinking bodies warn that momentum is fading and that price may pull back to the band. This matches Bollinger's own
  rule that closes outside the bands are continuation signals.
- **Entries still come from levels, trend lines and range edges,** not from the bands.
- **Implications:**
  - P-3's band setups (Q-3 the daily middle band as support; Q-4 fading the bands in a squeeze, harmful) were not his
    usage, and Q-4's harm agrees with his "do not counter-trade outside the bands".
  - The forward tag W (the weekly middle band) is the right test of his 2026 use.

**Trend reversal by structure (2026-08-11):** a trend-line break alone is not a reversal; it takes a break of the prior
low followed by a lower high. R-1's flip (a large-bodied close beyond the last confirmed pivot) points the same way but
is looser than his two-step rule. The difference is recorded, not fitted.

**Third 2026 video (2026-09-29, 1sd3b9avepY, AI summary with quotes):**
- **Right-side entries:** wait for the price to reach support and confirm, rather than guessing a bottom. This shifts
  from 2024's resting limits; R-1 is a resting limit (left side).
- **"Double support":** confluence of a rising 4h trend line, a large horizontal support, a Fibonacci retracement and
  the daily Bollinger middle band. The middle band is used as dynamic support in confluence, not only the weekly band.
- **Stops:** beyond the prior low and the key Fibonacci level. 76.4% is the deepest retracement; a break of it means
  the move continues.
- **Targets:** take profit at the prior high. "Position control matters ten thousand times more than direction"; size
  and stop are fixed before entry.
- **Still unstated:** stop distance in numbers, risk per trade, and the partial-exit split.

**His zone width, measured from his drawings:**
- 73 dated rectangles on BTC and ETH in the 2024-2025 video ideas (most rectangles carry no time).
- Median height about 1% of price: 0.27 daily ATR on BTC and 0.16 on ETH (quartiles 0.11-0.49).
- These zones are narrower than R-1's assumed zone, which can reach 1 daily ATR, so his stops are probably closer than
  R-1's.
- R-1 has passed its holdout and stays frozen; a narrow-zone variant would be a new rule (stage 0).
- He never uses TradingView's long/short position tool, but some snapshots write a plan as labelled horizontal lines
  (the labels are part of the image, not the drawing data). Example, BTC on 2025-02-25: sell limits 91,888 (1.5%) and
  89,666 (1%), stop 94,000, targets 86,500 and 81,500. Both filled and stopped in one 4h bar on 2025-03-02 (high
  95,000) before price reached 81,500. R-1's stop for the same zone sat at 98,070 and survived
  (`results/r1_charts/BTC_2025-02-25_vs_ronnie.png`).

## His drawn plans, measured (2026-10-02, `tv_plan_grade.py`, `results/tv_plan_grade.txt`)

- **Source:** the 178 forward-looking projected paths and arrows in his 2024-2025 video ideas (24 symbols). Video frames
  at the moments he says "stop" or "target" confirm the pattern: zone rectangles, a stop line just beyond the zone or the
  prior swing ("a stop inside the zone is a gift"), and targets at the next zone or prior high, often stepped.
- **Geometry:** 90% long; 48% of plans wait for a pullback (median depth 1.7 daily ATR), the rest enter now. The target
  sits a median 3.2 daily ATR from the entry (IQR 1.9-4.7); the drawn horizon is a median 24 days. With a stop 1 ATR
  beyond the entry that is about 3R, close to his spoken "two to three times".
- **Outcome:** against the mirrored plan the drawn direction shows no detectable skill (plan minus mirror -0.05R
  [-0.57, +0.47] at a 1-ATR stop; n 107 filled pairs). The sample is small and the stops are assumed, so this is
  inconclusive, not a closure. It reads 2024-2025 prices; any exit change it informs goes forward-only.

## His written plans, all sources (2026-10-02)

- **2024-2025 video ideas:** one of 245 carries a written plan (the five text labels in all 245 charts belong to the
  2025-02-25 BTC idea). The red horizontal lines in 13 other ideas are support and resistance levels, not plans. The
  public ideas API lists only the 158 text ideas of 2018-2021; the video ideas were reached through `related` lists, and
  the newest found is 2025-03-18.
- **2018-2021 text ideas:** already graded (README, "Grading his declared trades"); 20 of 106 graded trades state a stop.
- **Geometry against R-1 (daily ATR at entry):**

| | stop from entry | first target | target / stop |
| --- | --- | --- | --- |
| his 2018-2021 written stops (20; chart ATR, mostly daily) | median 1.85 (IQR 1.27-2.22) | median 1.66 | median 0.96R |
| his 2025-02-25 plan, first limit 91,888 | 0.62 | TP1 2.55R, TP2 4.92R | |
| his 2025-02-25 plan, second limit 89,666 | 1.27 | TP1 0.73R, TP2 1.88R | |
| R-1 (2,309 development trades) | median 0.75 (IQR 0.56-1.07) | 2R = median 1.51 | 2R |

- **Reading:** his first targets sit close (about 1R in the old ideas), which the old grading found costly; R-1's fixed
  2R target is farther in R and similar in ATR. The sample of written plans is too small to fit his stop or target
  rule; spoken plans in the videos point at levels without prices, so they need frame reading, not transcripts.

## His spoken plans read from video frames (pilot, 2026-10-02; `tv_frame_plans.py`, `results/tv_frame_plans.txt`)

- **Method:** at transcript moments where he says "stop here" or "target here", frames every 2-3 seconds show the
  horizontal line he draws or the cursor's price on the axis. Fourteen moments in ten videos gave twelve plans (nine
  he takes, three he turns down); two moments had no readable level.
- **Stop placement:** beyond the zone edge or swing extreme he names, by a median 0.32 daily ATR (range 0.04-0.98). R-1
  places its stop 0.25 ATR beyond the zone. From entry the stop is 0.2-0.3 daily ATR on his 1h and 4h plans and
  1.0-1.6 on his daily plans (R-1, daily: median 0.75).
- **Targets:** the next zone or prior high; first target a median 2.2R on the plans he takes, often stepped further.
- **What he turns down:** first targets of 0.37R, 0.45R and 1.25R ("the range is too narrow", "chasing, the stop must go
  below the low"). His rule in words: the stop sits where the structure is wrong, not where it is small, and a trade is
  taken only if the next level pays about 2R or more for that stop.
- **Reading:** this matches R-1's geometry (stop just beyond the zone, fixed 2R) more closely than any earlier source.
  Twelve plans read by hand from one analyst's frames are a description, not a test; nothing here changes R-1.
