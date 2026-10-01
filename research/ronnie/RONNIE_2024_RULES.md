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
