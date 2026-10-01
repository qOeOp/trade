# Ronnie strategy research (scratch, not product code)

Exploratory backtests of a trading plan distilled from the Ronnie Trading Guide (Luoni Jiaoyi Zhinan), on BTC/USD, outside every Owner path.
Nothing here is admitted, deployed or wired into the product; it is kept on this branch only so a later
session can resume. Every script runs from this directory after `python fetch_data.py`
(needs `pandas` and `numpy`).

## Data

`fetch_data.py` rebuilds `btc_1h.csv`, `btc_4h.csv`, `btc_1d.csv` from Bitstamp BTC/USD 1-minute bars
(github.com/ff137/bitstamp-btcusd-minute-data), 2017-01 to the latest daily update. Spot, not perpetual;
funding is a constant 0.01%/8h estimate. In-sample 2017-2022, out-of-sample 2023 onward (run once).

## Results so far (avg R = net P&L per trade / stop distance, fees and funding included)

| Script | What | IS avg R | OOS avg R | Verdict |
|---|---|---|---|---|
| `ronnie_bt.py` | S2b large-body breakout, 4h, stop at signal bar, 2R, 30-bar exit | +0.29 (217) | +0.24 (172) | Only survivor. Beats 300 random-entry controls (0 of 300), 27/27 parameter cells positive. Crypto only: ETH is positive, nine FX majors are not (see `s2b_levels.py` below) |
| `ronnie_plan.py` + `run_plan.py` | Full plan: F2 weekly direction, R1/R2/R4/R5 map, F1 Bollinger state, S1-S5 | portfolio Sharpe -0.14 | -0.43 | Fails its own kill rule |
| `run_controls.py` | Placebo zones, placebo Fibonacci ratios, with/without F1/F2 | | | Zones no better than zones displaced at random; Fibonacci no better than random ratios |
| `s6_confluence.py` | Zone x trend line confluence, limit at the intersection | -0.21 | -0.35 | Worse than 95% of random entries (adverse selection) |
| `s6_confirm.py` / `run_1h.py` | Same, enter after a rejection bar closes back | 4h: -0.11 / 1h: -0.22 | 4h: +0.25 (42 trades) / 1h: -0.19 | Not distinguishable from random on 4h; significantly negative on 1h |

Engine cross-check (`export_orders.py`, `path1m.py`, `replay/`): the same orders replayed through the repository's
`BacktestEngine` on 1-minute bars agree with the Python matcher on 99.5-100% of trade outcomes (mean gap 0.02-0.03 R),
so the negative results are not a matching artifact. `replay/` must run with `use_market_order_acks=true` and
`reject_stop_orders=false`; with the engine defaults bracket children are rejected and positions run unprotected.

## Ronnie's own calls (YouTube titles only)

`yt*.py` list all 1,636 videos of youtube.com/@Ronnie-Trading-Guide through the innertube API (the only YouTube host the
cloud container could reach); `yt/out*.jsonl` annotate the 1,026 BTC titles; `yt_verify.py` checks them against price.
Support holds 62% vs 60% for random levels; upside targets reached 42% vs 60% for the mirrored target; direction
50-53%. Titles are summaries, so this is weak evidence either way.

## Why the drawing rules probably failed, and the next step

The mechanical zones come from short-term 4h/1h pivots; Ronnie's titles lean on weekly levels, and his lines are
redrawn as the market moves. His real drawings are published on TradingView as `Ronnie_Dong`
(tradingview.com/u/Ronnie_Dong, same QQ/TG as the YouTube channel) and in his Bilibili videos
(space.bilibili.com/489629226). The TradingView half is done (below). Bilibili is not scraped yet.

## TradingView ideas (scraped 2026-09-30)

`tv_fetch.py` lists every idea through `tradingview.com/api/v1/ideas/?by=Ronnie_Dong` and reads each idea page's
embedded record, which carries the full published chart state. It writes:

- `tv/ideas.jsonl`: 158 ideas (the profile's `charts_total`), with publish time, symbol, interval, long/short flag, title,
  text, and the author's timestamped updates;
- `tv/drawings.jsonl.gz`: 2,083 drawings, each with its tool type, every anchor's UTC time and price, text, and style.
  Anchors placed past the chart's future timescale are extrapolated by whole bars and marked `time_est`: 99 callout
  label boxes and 6 arrows, exact on 24x7 symbols and approximate across FX weekends;
- `tv/raw/<uuid>.json.gz`: the lossless page record, including the bars shown on the chart at publish time;
- `tv/snap/<uuid>.webp`: the published snapshot; the full-size PNG is at `image_url`.

What the data shows:

- **Dates:** every idea was published between 2018-03-28 and 2021-01-28 (2018: 103, 2019: 39, 2020: 10, 2021: 6). He has
  published nothing on TradingView since, so it cannot show how he draws after 2021.
- **Symbols:** 38 ideas are BTC (Bitfinex, Gemini, Coinbase, BitMEX, Binance). The rest are gold, oil, FX majors, ETH and
  altcoins.
- **Timeframes:** mostly daily (89) and 4h (48), then weekly (16) and 1h (5).
- **Revisions:** there is one chart per idea, so revisions are text only. 303 updates: 225 notes, 60 "target reached",
  1 "stop reached", 7 manual closes and 10 "trade active". These labels are self-reported and incomplete, so they are
  not a track record.
- **Minds:** TradingView's short posts can only be listed per symbol without logging in, so they are not collected.

## Calibrating the map to his lines (2026-09-30)

`tv_calibrate.py` measures his lines on the bars each idea's chart showed, using all 137 unique ideas across every
symbol, with distances in ATR of the chart's timeframe. `tv_effect.py` tests BTC only. Outputs are in `results/tv_*.txt`.

- **Horizontal lines:** 85% are typed round numbers (at most 4 significant digits; his clicked text anchors almost never
  are). They sit only slightly closer to pivots than the same line moved 1-4 ATR: within 0.25 ATR of an order>=5 pivot
  68% vs 58%, order>=13 35-44% vs 28%. They are touched no more often than the moved lines. The pivot a line matches is
  old: median 132 bars before publish.
- **Trend lines, channels and Fibonacci:** these carry structure. A trend line passes through 1.29 order>=5 pivots on
  average, against 0.31 for the same line moved; 43% pass through two or more, against 4%. Fibonacci anchors sit on
  order>=21 pivots 70% of the time, against 12% for a random bar.
- **Zone map vs his lines:** the default map (k=3, 6 reactions per side) covers 28% of his horizontal lines, the same
  as moved lines (29%). The best grid cell on either half of the ideas is k=2 with 12-24 reactions per side. On the
  held-out half it reaches recall 43-65% with precision 25-28%, against 26-59% and 15-21% for moved lines. The gain
  comes mostly from drawing twice as many zones.
- **His BTC levels after publishing (E1, 24 resolved lines):** price held 62% of his lines, 64% of the same lines moved
  (500 draws each), 64% of the default map and 63% of the calibrated map. The standard error is about 10 points. This
  matches the YouTube result (62% vs 60%).
- **Full plan with the calibrated map (E2, in-sample 2017-2022 only):** portfolio Sharpe falls from -0.14 (default map)
  to -0.43 with the calibrated map on 4h and -0.39 with it on daily bars. Default parameters on daily bars give -0.43.
  All 30 zone-placebo runs (zones moved 2-6 ATR) beat the calibrated maps; 29 of 30 beat the default map. The map's own
  S1+S3 trades average -0.05 to -0.12 R against placebo medians of +0.11 to +0.19 R: limit orders at real structure
  levels are adversely selected. `ronnie_plan.simulate` takes the zone map through `zone_sched`, and building it that
  way reproduces the default run exactly (928 trades).

Verdict: fitting the map to his drawings makes the plan worse, and his own levels do not beat nearby random levels. The
only drawing that is measurably non-random is the trend line, and the zone x trend line setup (S6) was already negative.
More drawings of the same kind, such as his Bilibili charts, would refine a map that carries no edge here.

## Grading his declared trades (2026-09-30)

`tv/trades_annot.csv` has one hand-checked row per idea: side, market or limit entry, first and final target, and
stated stop, each value with its source. The source is either a stated number, the extreme of his projected arrows, or
a "tp" label's position. 114 ideas carry an unconditional trade; two-sided and scenario ideas carry none.
- `tv_prices.py` fetches TradingView daily bars for every symbol.
- `tv_hourly.py` builds hourly windows around each trade from four sources: Bitstamp for BTC, FXCM for the FX majors,
  Binance for altcoins, and Dukascopy for gold, oil and indices. Each window is scaled to his chart's price at publish.
- Dukascopy served about one file every few minutes, so daily and weekly ideas without an hourly window use daily bars.
  Eight 4h/1h gold, oil and dollar-index trades stay ungraded.
- `tv_trades.py` grades 106 trades. Units are his chart's ATR at publish; the horizon is 30 of his chart bars.
- The control for each trade is a random hour within the 10 chart bars after he published, on his side. Controls
  drawn before publish flatter trend calls, because his side was read from that stretch; they are kept only for
  reference.
- Results are gross of costs, in `results/tv_trades.txt`.

Mean ATR per trade, 83 filled trades with controls (95% bootstrap intervals):

| | his exits | hold 30 bars |
|---|---|---|
| his entry | -0.47 [-1.19, +0.19] | -0.15 [-1.07, +0.82] |
| random moment, his side | -0.43 | -0.29 |

- **Entry:** no better than a random moment on his side: -0.04 ATR under his exits, +0.14 when holding, neither
  significant. Only 44-58% of trades move his way after 1-20 bars. His entry leads a random moment by +0.41 ATR after
  10 bars [+0.02, +0.78], but that is one of five horizons and the only one that clears zero.
- **Limit entries:** fill 56% of the time. 41% miss because the target trades first, so the misses are winners, and the
  limits do worse than a market entry at publish.
- **Exit:** 74 of 91 filled trades state no stop. His exits (TP1, no stop, time exit) cost 0.31 ATR per trade against
  holding. After TP1 price goes a further 2.2 ATR (median), and more than 2 ATR in 55% of hits. Trades that time out
  reach only 37% of the TP1 distance.
- **Other exits:** a 1 ATR stop turns the same entries slightly positive (+0.08 to +0.17 ATR) and slightly ahead of
  random moments. No stop/target cell is significant, and wider stops are worse.
- **His own labels:** 63% of the 35 trades he labelled "target reached" hit TP1 first within the horizon; 20% never
  filled at his limit. Only 31% of the 64 trades he never labelled reached TP1.

Verdict: his calls have no edge in direction or timing. His exits (targets near, stops absent) turn a zero-edge entry
into a loss, and better exits bring it back to about zero, not above it.

## His own line intersections (2026-09-30)

`tv_intersections.py` extends his trend lines and channel borders to the right. It finds where they cross his
horizontal lines, or each other, within 30 chart bars after publish (83 ideas with prices).
- Only about a third of those points are ever reached.
- When reached, they hold no better than the same points moved 1-4 ATR: trend x horizontal 50% vs 49% (6), channel x
  horizontal 60% vs 71% (5), sloped x sloped 67% vs 62% (15).
- His horizontal lines alone, all symbols: 58% vs 62% for moved lines (95).

## Cross-timeframe confluence (2026-09-30)

`tv_mtf.py` keeps the confirmed S6 entry and every default, and changes only where the zones come from. The sources are
4h, daily or weekly bars, or daily zones overlapping a weekly zone ("resonance"). Results on BTC, R net of fees and
funding:

| zones x 4h trend line | in-sample 2017-2022 | out-of-sample 2023-2026 (run once) |
|---|---|---|
| 4h (S6) | 93 trades, -0.11 | not run |
| daily | 17 trades, +0.50 | 20 trades, +0.06 |
| resonance | 10 trades, +0.90 | 6 trades, +1.40 |
| resonance, no line | 28 trades, +0.41 | 17 trades, +0.39 |

- The in-sample grid (`tv_mtf_grid.py`: zone pivot order, reactions per side, line pivot order) misses its declared
  robustness rule. Resonance is positive in 12 of 16 cells but ahead of random entries in only 8.
- `tv_fx_mtf.py` replicates the same rules on nine FX majors from FXCM hourly candles, in `results/tv_fx_mtf*.txt`.
  It does not replicate. Pooled over the nine pairs, resonance x line makes -0.10R over 138 in-sample trades (3 of 9
  pairs positive) and -0.17R over 100 out-of-sample trades (1 of 9). Resonance alone makes -0.15R over 388 and -0.32R
  over 263 (0 of 9 positive out of sample), and daily zone x line -0.07R both ways.
- Over the BTC grid, random entries give a best cell at least as good as the real best (+0.92R) in 44% of draws
  (`tv_grid_null.py`). Read together with the FX result, the BTC resonance numbers are small-sample luck.

## Has his method changed? (2024-2026 videos)

No spoken content could be fetched. YouTube refuses anonymous player and transcript requests, and his Bilibili space
lists no public videos (`yt/recent/routes.json`). `yt/recent/` keeps 149 BTC videos from 2024-01 to 2026-09 and 81
calls read from their titles, thumbnails and six community posts, plus the method notes in Chinese
(`methods_zh.json`).
- **What stayed:** support and resistance at round thousands, trend lines, channels. Fibonacci now appears only in live
  streams and gold videos.
- **What is new or louder:** the daily Bollinger middle band as support, weekly closes and candle patterns, a fixed
  "break, retest, confirm" entry phrase, and small-timeframe versus big-timeframe wording.
- **What is still missing:** stop size, position size or reward/risk. None appears in any title or thumbnail.
- **Scoring:** 21 of the 81 calls are after-the-fact claims ("as expected", "precise call").
- **Grading:** `yt_recent_grade.py` grades the 21 directional title forecasts on Bitstamp. They are right 14/21 after
  3 days (p 0.09) and 10/20 after 7 and after 14 days.

## Filters on the level-touch entry (TrialFamily filters-v1)

`filters/INTENT.md` was registered and committed before the runner (`filters/run.py`) and before any result. It fixes
the design in advance:
- **Base signal:** the confirmed zone-touch entry (s6 `zone_only`) on 11 markets: BTC, ETH and nine FX majors.
- **Filters:** ten candidates, among them weekly and daily trend, calm, squeeze, resonance, trend line, reward/risk,
  tested level, strong candle and tight stop.
- **Budget:** every combination of up to three filters, 176 trials, sealed.
- **Segments:** selection on train (2017-2020) and validation (2021-2022); test (2023-2026) protected and read once.
- **Falsifier:** the selected combination must beat both the unfiltered base on test and the 95th percentile of the
  same selection run on placebo events.

Result (`filters/result.txt`, `filters/decision.md`, every trial in `filters/census.csv`):
- **Base:** 2,796 events, -0.17R on train, -0.12R on validation, -0.14R on test.
- **Selected combination:** resonance + tested level + strong candle. It made +0.38R on train (46 trades) and +0.40R on
  validation (23), then -0.33R on test (44).
- **Placebo:** combinations selected the same way from random entries make a median -0.30R on test, 95th percentile
  +0.03R.
- **Permutation:** with outcomes shuffled, selection still reaches a median +0.16R on validation, 95th percentile +0.56R.

Decision: falsified, and the family stops. Picking filters on history finds combinations that look good twice and then
fail on data they never saw. That is the same pattern as the resonance grid on BTC.

## Entry or exit? An exit-free test

`filters/first_passage.py` asks whether the entry is fine and only its exits are poor. Every stop/target exit's
expectancy is set by one question: from the entry, does price reach +a ATR before -b ATR? The script scores that for
30 (a, b) pairs, from targets of 0.5-5 ATR and stops of 0.5-3 ATR, against 20 random entries per event with the same
market, year and side. Nothing is selected. Results are in `filters/first_passage.txt`.
- **Zone touch, 2,791 entries over 11 markets:** every cell lies within +-0.05 ATR of the random entries and none
  differs significantly. The best cell is +0.045 ATR, less than a round trip's cost.
- **Zone x trend line on BTC, 135 entries:** the same or worse. Three cells, all with small targets, are significantly
  below random.

No stop or target can turn these entries into more than a random entry, so poor exits are not what hides an edge.

## Lines as a map for S2b exits, and S2b beyond BTC

`s2b_levels.py` was declared before its run. It keeps S2b's entries and scores each signal on its own, varying only the
exit: a 2R target, a target on the first 4h, daily or resonance zone at least 1R away, or a stop behind the nearest 4h
zone. Results are in `results/s2b_levels.txt`.
- **Exits on levels:** no level-based exit moves avgR by more than 0.05R from the 2R target, in or out of sample, on
  BTC or elsewhere. On BTC out of sample every level variant is slightly worse (-0.01 to -0.05R). Lines do not work as
  a map for exits either.
- **S2b by market:** BTC is positive in and out of sample (+0.32R over 266 trades, +0.21R over 220), and so is ETH
  (+0.20R, +0.07R). The nine FX majors are negative in every pair, at about zero even gross of costs: pooled -0.01R in
  and -0.11R out of sample with no costs, and -0.03R and -0.12R at 0.005% per side.
- **Cost caveat:** every FX run here used the crypto cost model (about 0.06% per side). With 4h stops near 0.5-0.7% of
  price, that charges FX about 0.2R more per trade than a realistic spread. The FX conclusions above rest on
  comparisons with random or displaced controls that carry the same costs, so they hold, but absolute FX avgR figures
  are too low.

## Setup types beyond the breakout (TrialFamily setups-v1)

`setups/INTENT.md` was registered before `setups/run.py` was written. Five setup types on 4h bars, all at declared
defaults:
- B1: the S2b breakout.
- P1: a trend pullback to EMA20.
- P2: a Fibonacci 38.2-61.8% pullback in the trend.
- P3: breakout, retest, confirm, his current catch-phrase.
- R1: a Bollinger range fade in a squeeze with no trend.

Each runs on crypto (BTC, ETH; 0.06% per side) and FX (nine majors; 0.005% per side), and each signal is compared with
20 random entries of the same geometry. A setup holds when its lead over random is above zero at 95% in sample
(2017-2022) and at 90% out of sample (2023-2026, read once). Results are in `setups/result.txt`.

| setup | crypto IS | crypto OOS | FX IS | FX OOS |
|---|---|---|---|---|
| B1 breakout | +0.22 [+0.10, +0.34] | +0.13 [+0.02, +0.25] | -0.03 | -0.12 (below random) |
| P1 EMA pullback | +0.02 | -0.06 | -0.02 | -0.07 (below random) |
| P2 Fibonacci pullback | -0.18 | +0.04 | -0.06 | +0.00 |
| P3 break-retest-confirm | -0.03 | -0.09 (below random) | -0.09 (below random) | -0.09 (below random) |
| R1 range fade | -0.01 | -0.01 | -0.09 | -0.08 |

Each cell is avgR minus the random control over the class's signals. Only the breakout on crypto holds. The
break-retest-confirm entry he now repeats in every video is significantly worse than random in three of four cells.

## Breakouts on unseen coins, FX daily mean reversion, and market character

- **`altcoins/` (altcoins-v1, registered first):** the crypto breakout B1 on 15 coins that never took part in finding
  it: BNB, XRP, ADA, SOL, DOGE, LTC, TRX, LINK, DOT, AVAX, BCH, ETC, XLM, ATOM and FIL, from Binance hourly klines.
  - It holds. 4,312 signals net of 0.06% per side make +0.11R, +0.10R above random entries of the same geometry
    [95% coin-then-signal bootstrap +0.05, +0.16].
  - All 15 coins are above zero and above their control; 7 of 10 years are positive.
  - Survivorship bias remains: these coins are still listed today.
- **`fxrevert/` (fxrevert-v1, registered first):** daily Bollinger, RSI(2) and 5-day-stretch fades on the nine FX
  majors, stop 2 ATR, 0.005% per side.
  - All three fail the registered rule. They sit near random in 2017-2022.
  - Out of sample the Bollinger and RSI(2) fades lead random (+0.09R and +0.04R, 90% intervals above zero, 7 of 9
    pairs). That window's variance ratio helped motivate the test, so this is not independent evidence.
- **`market_character.py`:** variance ratios of 4h returns.
  - All nine FX majors sit below 1: at 1 day in sample, and at 5 days out of sample (mean 0.89). FX leans
    mean-reverting.
  - BTC and ETH sit at 1.00-1.04.
  - This fits breakouts working on crypto and failing on FX. The FX reversion is too weak (about -0.02
    autocorrelation per 4h bar) for the simple 4h rules tested here.

## Cross-check against the repository BacktestEngine

The studies above use Python simulators. `xcheck/` replays every one of their 16,466 orders through the repository's
`BacktestEngine` (`replay/`, built in a disposable `CARGO_TARGET_DIR` by `xcheck/run.sh`) and compares them order by
order with `xcheck/compare.py`. The orders cover setups-v1 on BTC (4h and 1-minute bars), EURUSD and USDJPY (hourly),
fxrevert-v1 on the nine FX majors (hourly) and altcoins-v1 on the 15 coins (hourly). Results are in
`xcheck/result.txt`.
- **Agreement:** 99.2-100% of orders exit the same way (target, stop or time). Every group's engine avgR is within
  0.02R of Python's (0.005R on BTC and the coins), and no setup's conclusion changes.
- **4h vs 1-minute on BTC:** the two engine runs agree on 99.6% of exit roles. The 4h stop-first assumption moves 2 of
  545 trades in one lane.
- **A defect found:** the first fxrevert replay skipped 1,003 orders. The export had placed the unreachable target at
  entry - 50 ATR, which went negative for shorts in March 2020. The engine rejected that child order, and the replay
  kept the position open. The target is now capped at half the price, and every order closes.

## Evolved line-based entries, developed blind (TrialFamily combo-v2)

`combo/INTENT.md` was registered before anything else in this family. It separates two roles:
- **Developer:** a subagent that iterated freely on BTC and ETH only, through `combo/harness.py`. It scored 120 variants
  and froze three candidates. By its own account it saw 2023-2026 results for about 20 early variants, so only the coin
  holdout is clean.
- **Evaluator:** the main agent. It built the holdout (the 15 coins of altcoins-v1, never used for a line-based entry)
  only after the candidates were committed with their hashes, and scored each candidate once (`combo/evaluate.py`).

The separation rests on instructions and file custody in one container, not a sandbox. All three candidates are
strong-candle closes through a line, with a stop at the bar's far end, a 2R target and 30 bars:
- `level_break_calm_trend`: through an intact order-3 swing level, in low volatility, with the daily trend.
- `trendline_break_strong`: through the line of the last two order-8 swing highs or lows.
- `line_break_ridge`: through any line (swing levels, trend lines, prior day and week, round numbers), ranked by a
  frozen ridge model of candle, volume, trend and volatility features; only the top half is traded.

Holdout results (`combo/holdout_result.txt`), net of 0.06% per side, with 98.3% coin-then-signal intervals:

| candidate | signals | avgR | minus random control | coins above control | verdict |
|---|---|---|---|---|---|
| trend-line break | 1,653 | +0.121 | +0.136 [+0.017, +0.252] | 13/15 | holds |
| ranked line break | 17,764 | +0.055 | +0.086 [+0.049, +0.124] | 14/15 | holds |
| swing-level break, calm and trend | 2,970 | +0.107 | +0.087 [-0.001, +0.174] | 13/15 | fails narrowly |
| unfiltered zone touch (reference) | 3,970 | -0.031 | -0.031 [-0.110, +0.051] | 5/15 | no edge |

- **Beyond B1 (declared diagnostic):** the ranked line break keeps +0.078R [95% +0.043, +0.113] on its 14,362 signals
  that do not coincide with B1. The trend-line break keeps +0.103R [-0.04, +0.24] on 1,205, not significant.
- **Reading:** lines earn their place when price closes through them with conviction, and not when it touches and
  bounces; the touch has now failed on every universe tested. Whether the line itself adds anything to a strong
  candle is still open. On development data, strong candles that crossed no line did as well in 2023-2026, and that
  split was not scored on the holdout. Settling it needs data neither the Developer nor the evaluator has read, which
  means future bars.
- **Limits:** each signal was scored alone. Concurrent positions, funding and capacity are not modelled, and the
  ranked line break's +0.055R average is thin after costs.

## A forward journal for hand-drawn trades

A history test can always be doubted as "not how I draw". `journal/` tests the drawer instead:
- **Record:** add one row to `journal/journal.csv` per drawing: time, symbol, chart timeframe, side, market or limit
  entry, stop, targets and the lines used. `journal/EXAMPLE.csv` has two filled rows.
- **Commit at once:** commit each row before price reaches the entry; the commit time is the proof.
- **Score:** `python journal/score.py` fetches TradingView bars and fills trades with the same conservative model as
  `tv_trades.py`. It compares each trade with 200 random entries on the same side, drawn within the next 10 chart bars,
  with the same stop and target distances. It excludes rows committed more than an hour after their drawn time and
  reports how many closed trades a +0.2R edge needs, about 60-140 at typical spreads.

## Acting before the 4h close (TrialFamily timing-v1)

`timing/` tests whether a line break must wait for the 4h close. The alternative is to act on the first 1h, 15m or 5m
close through the same line.
- **Setup:** BTCUSDT and ETHUSDT on Binance 5m bars, 2018-2026. All variants use the same lines (as in
  `line_break_ridge`). The stop is the 4h bar's extreme so far and the target is 2R.
- **Controls:** each variant is compared with its own random entries, on the same year and side with the same stop in
  ATR.
- **Result:** no lower-timeframe trigger beats the 4h close on either market (`timing/result.txt`).
  - **Edges:** the edge over random is +0.03R to +0.06R for every variant.
  - **Differences:** every difference from the 4h edge lies inside [-0.07R, +0.07R].
- **Why the two effects cancel:**
  - **False breaks:** a lower-timeframe close takes breaks that the 4h close rejects. They are 24-26% of 1h triggers
    and 41-42% of 5m triggers, and they lose about 0.7-0.8R each.
  - **Kept breaks:** the breaks that hold earn more for entering earlier, +0.18R at 1h and +0.37-0.40R at 5m.
- **Conclusion:** the earlier price and the false breaks cancel. Waiting for the 4h close is not what holds these
  results down, and entering earlier does not lift them.

## A range box, position rules, and long versus short

**Range box (TrialFamily range-v1, `range/`).** Ronnie's range box is a sideways 60-bar box with at least two touches
of each edge. The rule buys a rejection at the floor and sells one at the ceiling, with the stop 0.5 ATR outside and
the target at the far edge.
- **Result:** it fails on every market (`range/result.txt`).
  - **BTC and ETH:** 51 signals in nine years, -0.67R against random in sample, and +0.50R out of sample (not
    significant).
  - **FX:** +0.09R in sample and +0.03R out of sample, both inside zero.
  - **The 15 altcoins:** -0.08R, with 7 of 15 above zero.
- **Earlier range tests agree:** the Bollinger fade (R1) and the level-touch entries were at random as well.

**Position rules (TrialFamily risk-v1, `risk/`).** Six rules were tried on the three-strategy crypto book, fixed before
the run. The design period was 2018-2022 and the check period 2023-2026 (`risk/result.txt`, `risk/fig_risk.png`).
- **Rules:**
  - one position per coin;
  - total risk and same-side caps;
  - confidence size by daily trend and by strategy agreement;
  - a drawdown brake;
  - a volatility target;
  - confidence plus brake.
- **Decision:** no rule beats the base on both Sharpe and Calmar in both periods.
  - **Closest:** confidence sizing lifts the check-period Sharpe from 0.17 to 0.22 and cuts the drawdown from 76% to
    57%, but loses Calmar in design.
  - **Confidence plus brake:** it has the best design period (Sharpe 1.64, drawdown 32%) and still does not beat the
    base's check-period Sharpe.
- **Why:** in 2023-2026 the book's trades average only +0.02R to +0.04R. Sizing reshapes a drawdown but cannot create
  an edge.
- **Agreement:** the one input with information is agreement between strategies.
  - Trades where two or three strategies fire on the same coin, side and bar average +0.21R in design and +0.08R in
    check.
  - Single-strategy trades average +0.08R in design and -0.01R in check.
  - This was seen in the check period, so it is a hypothesis for the forward record, not a rule.

**Long versus short (descriptive, all book trades).** Shorts are not the weak side.
- **Shorts:** they averaged above zero every year, and did best in the bear year 2018 (+0.45R).
- **Longs:** they lost in 2022 (-0.08R), 2025 (-0.06R) and 2026 (-0.13R), yet outnumbered shorts in each of those
  years.
- **Weak markets:** below BTC's daily SMA200, both sides weaken, longs from +0.10R to +0.03R and shorts from +0.13R to
  +0.05R. The bear-year shortfall is fewer good trades plus losing breakout longs, not weak shorts.
- **B1:** the exception, with shorts at +0.03R against +0.19R for longs.

## Other traders' lines (TrialFamily community-v1)

`community/` compares our rule-drawn lines with lines other traders publish.
- **Sample:** 2487 recent TradingView ideas on the 17 forward coins, 150 sampled per coin from the public listing
  (`community/INTENT.md`, amended for the drawing format before any measure ran).
- **Lines:** 3218 horizontal levels, 3689 zone edges and 782 trend lines within 5 ATR of price at publish time.
- **Scoring:** the reaction test is the E1 test used on Ronnie's lines (`community/result.txt`).
- **Horizontal agreement:**
  - 35% of community levels lie within 0.25 ATR of one of our levels, against 27% for the same levels moved 1-4 ATR.
  - The ratio is 1.29, under the 1.5 bar, so the overlap is real but loose.
- **Trend lines** rarely match: 3% against 1% moved. Our rule keeps only the last two swings, so 65% of the time we had
  no line of that slope at all.
- **Do their lines hold?** No.
  - **Community levels:** 64% held after publishing, against 66% for moved copies (-1.7% [-4.2%, +0.7%]).
  - **Zone edges:** held 60% against 67% (-6.8% [-9.4%, -4.1%]). Part of this may be distance, since zones sit
    close to price.
  - **Our own nearest levels, at the same moments:** 66% against 67%.
  - **Consensus levels** (three authors or more within 0.25 ATR and 72 hours, 41 clusters): 68% against 65%, far too
    few to tell.
- **Conclusion:** whether we draw "like people do" is not the issue. Neither the community's lines nor ours hold better
  than the same line moved away, which matches Ronnie's own lines (62% against 64%).

## Filters on 20 unused coins (TrialFamily filters-v2)

`filters2/` tests three filters suggested by the 17-coin book on 20 coins never used before. It also scores the three
entries there (`filters2/result.txt`, 24169 signals, 2021-2026).
- **Base replicates:**
  - all signals beat random by +0.064R [+0.039, +0.089];
  - B1 +0.060R, ridge +0.065R, trend-line breaks +0.063R (interval crosses zero);
  - every year from 2021 to 2026 is above zero.
- **Small in absolute terms:** the average net R is only +0.035, because random entries with the same stops lose
  -0.029R to fees.
- **Every filter fails** the pre-registered rule (kept edge above zero and above the dropped edge).
  - **F1**, stop at least 2% of price: +0.017R over dropped [-0.058, +0.092].
  - **F2**, two or three strategies agree: +0.039R [-0.021, +0.099]. This is the right direction, but not significant.
  - **F3**, not a busy market: -0.019R [-0.074, +0.034]. The busy-month effect in the 17-coin book does not carry over.
  - **F4**, F1 and F2: +0.043R [-0.016, +0.101].

## Triangle and wedge breakouts, and stops behind lines (patterns-v1, stops-v1)

**Converging triangles and wedges (`patterns/`).** The patterns come from the last two order-5 swing highs and lows,
converging to under 0.6 of their starting width. They cover symmetric, ascending and descending triangles, and rising
and falling wedges. The stop sits beyond the pattern and the target is the measured move.
- **Result:** no variant holds on crypto or FX (`patterns/result.txt`). The holdout was 20 unused coins (IOTA, KSM,
  RUNE and others), 2021-2026.
  - **Raw breakout:** -0.07R against random on BTC and ETH, -0.03R on FX, and +0.004R on the holdout (2394 signals).
  - **With a strong, high-volume breakout bar:** +0.04R on BTC and ETH (62 signals), -0.05R and +0.00R on FX, and
    -0.00R on the holdout.
  - **Retest entry:** -0.14R on BTC and ETH, -0.03R and -0.06R on FX, and -0.00R on the holdout. It is once again the
    worst of the three.

**Where to put the stop (`stops/`).** Same entries (B1, trendline, ridge), four stops, and a target of 2R of each stop
(`stops/result.txt`).
- **Result:** no stop beats the signal-bar stop on both development and the holdout.
  - **1.5 ATR stop:** +0.037R [+0.003, +0.072] on BTC and ETH, and +0.014R [-0.007, +0.035] on the holdout.
  - **Stop behind the nearest support:** -0.064R [-0.113, -0.014] on BTC and ETH, and +0.023R [-0.005, +0.051] on the
    holdout. That stop is about 3.5 ATR wide.
  - **Stop just behind the broken line:** -0.010R and -0.036R. That stop is about 0.7 ATR wide and is hit most often.
- **Conclusion:** a stop placed by a line does no better than a mechanical one.

## Higher-timeframe levels used as practitioners describe, and volume (mtf-v1, volume-v1)

**Practitioner uses of higher-timeframe levels (`mtf/`).** The holdout was 20 unused coins (ICX, ZRX, TRB and others),
2021-2026. No variant holds (`mtf/result.txt`).
- **M1, strong-level fade:** fading daily levels with at least two prior touches gives -0.28R against random on BTC and
  ETH, -0.09R and -0.13R on FX, and -0.02R on the holdout.
  - **Fresh levels, as a reference:** fading them is significantly worse than random, at -0.25R and -0.06R.
  - **What it shows:** strong levels lose less than fresh ones, the direction Chung and Bellotti report, but neither
    pays. Fading touches loses, which fits breaks carrying on.
- **M2, top-down sweep and change of character:** a daily or weekly level is swept, and a 1h close back through the last
  swing gives the entry.
  - **Results:** +0.01R on BTC and ETH, +0.01R and +0.03R on FX, and -0.07R [-0.135, -0.004] on the holdout, which is
    significantly worse than random.
  - **Geometry:** the median target was 3.8R.
- **M3, 4h sweep fade:** -0.08R on BTC and ETH, +0.03R and +0.02R on FX (not significant), and -0.00R on the holdout
  (15722 signals).

**Volume (`volume/`).** Development was BTC and ETH, and the holdout 20 unused coins (AUDIO, STX, AR and others),
2022-2026. All three pre-registered claims fail (`volume/result.txt`).
- **A. Profile nodes:**
  - **HVNs:** held +6.6% more often than moved copies on development and +4.4% on the holdout.
  - **LVNs:** held +4.1% and +4.9% more often.
  - **Decision:** the claim fails, because HVNs did not beat LVNs (+1.3% and -1.1%).
  - **Unplanned finding:** profile nodes of both kinds hold more than moved lines, on both sets. A hold-rate edge is
    not yet a trading edge. It is a hypothesis for a new family on unused data.
- **B. Volume-backed swing levels:** backed minus hollow is -2.4% and -1.6%, so the volume at a swing level does not
  separate real levels from false ones.
- **C. Break volume:**
  - high-volume breaks beat low-volume breaks by +0.24R [+0.11, +0.39] on BTC and ETH;
  - by +0.003R [-0.03, +0.04] on the holdout.
  - This is a clean example of an in-sample effect that vanishes on new data.

## Profile nodes as a trade, and flags after an impulse (volume2-v1, patterns-v2)

**Profile-node fade (`volume2/`).** A limit order at the nearest volume-profile node above and below each day's open,
stop 1 ATR(4h) beyond, compared with the same order at nodes moved 1-4 ATR. The holdout was 15 unused coins (IMX, ENS,
JASMY and others), 2022-2026 (`volume2/result.txt`).
- **Result:** not tradable.
  - **Target 1 ATR:** nodes average -0.096R. The difference from moved nodes is -0.043R [-0.077, -0.011], which is
    significantly worse.
  - **Target 2 ATR:** -0.053R, and -0.016R against moved nodes.
- **Why the volume-v1 effect does not carry over:** the higher hold rate of volume-v1 does not become a trade. A fill
  at the node is itself the start of a touch, and the stop sits inside the range where volume-v1 still counted a
  "hold".

**Flags and pennants after an impulse (`patterns2/`).** A pole of at least 4 ATR, a pause of 4-20 bars with at most a
half retracement, and a break in the pole's direction. The holdout was 14 unused coins (CVX, SLP, BNT and others),
2022-2026 (`patterns2/result.txt`).
- **Result:** both variants fail.
  - **Raw:** +0.03R [-0.14, +0.22] on BTC and ETH, and +0.12R [-0.03, +0.27] on the holdout.
  - **With the daily trend:** -0.02R and +0.09R.
- **Reading:** the point estimates are positive on crypto, in line with momentum, but the intervals include zero.
- **Decision:** as agreed beforehand, the pattern line stops here. Converging patterns both ways, volume confirmation,
  retests and continuation flags have all failed.
- **FX:** from here on research is crypto only (user decision), so the FX rows in `patterns2/result.txt` are not used.

## Daily trend following and cross-sectional momentum (TrialFamily trend-v1)

**Rules.** `trend/` tests a 50-day close breakout with a 2 ATR stop and a 20-day close exit, on daily bars with fees
and funding. Four line and timeframe variants are scored paired on the same signals. The weekly cross-sectional
momentum rule is scored as well (`trend/result.txt`).
- **Trend following, before:** +1.00R per trade on 17 coins over 2018-2022, +0.43R above random entries with the same
  exits [-0.08, +1.05].
- **Trend following, holdout:** +0.07R per trade on 20 coins listed since mid-2023, +0.12R above random [-0.09, +0.38].
  It fails the 95% rule; the returns are positive but fat-tailed.
- **Line and timeframe variants:** none is adopted.
  - The retest entry gives -0.56R and +0.02R against T0.
  - The stop behind structure gives -0.22R and -0.02R.
  - The weekly-level target gives -0.09R and -0.07R.
  - The weekly-trend filter gives +0.48R and -0.28R.
- **Cross-sectional momentum (top fifth by 28-day return):** +0.84% a week over the universe before (not significant),
  and -0.02% on the holdout.

**The 17 majors over 2018-2026 (`trend/majors.txt`, descriptive).** These are development coins.
- **Per coin:** the rule averages above zero on every coin, near zero for LTC, BCH and FIL. Some per-trade averages:
  - BTC +1.03R over 63 trades;
  - ETH +0.89R;
  - SOL +1.90R;
  - BNB +2.20R.
- **Recent years:** 2023-2026 still averages +0.33R per trade, +0.25R above random [-0.06, +0.63].
- **Longs** carry it; shorts are near zero.
- **Exits:** random entries with the same exits also earned in 2018-2022. Much of the result comes from the exit that
  lets winners run, not from the entry.

**Portfolio view (`trend/portfolio.py`, `trend/portfolio.txt`, `trend/fig_portfolio.png`, descriptive).** The book is
long only, spot with no leverage or funding, 0.1% per side, at most 1x invested, and one trade per coin, over
2018-01 to 2026-08.

| Book                       | CAGR   | Max DD | Sharpe | Average invested |
| -------------------------- | -----: | -----: | -----: | ---------------: |
| trend, 17 majors, 1% risk  | +53.7% | -39.5% |   1.26 |              34% |
| trend, 17 majors, 0.5%     | +32.8% | -32.4% |   1.08 |              23% |
| trend, BTC+ETH+SOL, 1%     | +23.4% | -20.1% |   1.27 |              12% |
| hold BTC                   | +22.7% | -81.2% |   0.64 |             100% |
| hold 17, equal weight      | +23.0% | -79.9% |   0.66 |             100% |

- **What the book does:** it sits mostly in cash and loses little in bear years: -23% in 2022, against -64% for BTC
  and -70% for the equal-weight hold.
- **Recent years:** since 2023 the 1% book returned +48%, +73%, +3% and -2% (to August 2026).
- **Caveat, concentration:** 2021 alone (+519%) carries much of the total.
- **Caveat, survivorship:** the 17 majors are today's survivors, chosen knowing they became majors. On coins listed
  since 2023 the same rule earned only +0.07R per trade.
- **Caveat, development data:** these coins were development data, although the rule's parameters are textbook values
  and were not tuned here.

**Forward record (`trend/forward.py`).** It records long-only daily trend following on the 17 majors from 2026-10-01,
starting flat. It places no orders and uses no account.
- **Events:** each daily run appends newly known events to `trend/forward/events.csv`. There are three kinds:
  - signal, at the close;
  - entry, at the next open;
  - exit, at the stop or at the close.
- **State:** each run rewrites `trend/forward/state.csv`, with each coin's status, entry trigger and exit level.
- **Score:** `python trend/forward.py score` summarises the closed paper trades.
- **Schedule:** a daily routine runs it, with `combo/forward.py`, and commits the result. The commit time is the proof.

## Multi-timeframe range boxes (TrialFamily range-v2)

`range2/` fades both edges of 60-bar range boxes on 1h, 4h and 1d bars, using the 17 majors. The development period is
2018-2022 and the check period 2023-2026 (`range2/result.txt`).
- **Result:** no variant holds.
  - **L, a limit at the edge (stop 0.5 ATR beyond, target the far edge, about 11R):** it wins 9-14% of the time and is
    significantly worse than random on 1h and 4h in 2023-2026 (-0.27R and -0.35R).
  - **C, the rejection close:** from -0.12R to +0.34R, every interval spanning zero. The daily rows rest on 24-37 trades.
  - **M, the 4h edge matching a daily edge:** it produced no trade, so 4h and 1d boxes almost never share an edge within
    0.5 ATR.
- **Conclusion:** together with range-v1, box fading shows no edge on any timeframe.

## Running the survivors together, and a forward record

`combo/portfolio.py` runs B1, trendline_break_strong and line_break_ridge as one book on BTC, ETH and the 15 holdout
coins, 2018-01 to 2026-09 (`combo/portfolio.txt`, `combo/fig_portfolio.png`).
- **Rules:** risk is 0.5% of equity per trade, with at most 10 positions, one per coin and strategy, and at most 3x
  notional. Costs are 0.06% per side plus funding of 0.01% per 8 hours, always paid.
- **Evidence status:** descriptive only, because every coin here was already used for evidence.

| Book       | Trades taken | CAGR   | Max DD | Sharpe | 2025 | 2026 to Sep |
| ---------- | -----------: | -----: | -----: | -----: | ---: | ----------: |
| B1         |         4026 | +24.5% | -45.2% |   0.97 | -11% |         -1% |
| trendline  |         1922 | +13.7% | -25.5% |   0.96 |  +1% |        -17% |
| ridge      |        11585 | +23.4% | -79.3% |   0.69 | -28% |        -33% |
| all three  |        12717 | +37.9% | -76.2% |   0.90 | -30% |        -42% |

- **The recent years are weak.** Almost all of the gain came in 2018-2021 and 2024. The combined book peaked in early
  2025 and has since lost about two thirds.
- **Overlap:** B1 and ridge often take the same trade, which doubles the risk on it.
- **Partly in sample:** ridge's coefficients were fitted on BTC and ETH for 2017-2022, so part of its early run is
  in sample.
- **Trendline:** the trend-line break is the smoothest book, but it earns the least.
- **Checked jump:** the late-August 2026 jump is real. On 2026-08-21, a broad rally took eleven long positions to target
  in one bar.

`combo/forward.py` records the three frozen entries on the same 17 coins as they happen, so their future bars test them.
It places no orders and uses no account.
- **Logging:** each run takes Binance archive bars plus TradingView's feed and drops the 4h bar still forming. It
  appends every signal from the last 7 days that is not yet logged to `combo/forward/signals.csv`.
- **Entry and void rows:** a logged signal enters at the first 4h open after the run, whatever the run frequency. It is
  marked `void` if its stop or target already traded before the run.
- **Proof:** commit the file right after each run; the commit time is the proof.
- **Scoring:** `python combo/forward.py score` scores the matured `open` rows against random controls with the harness
  fill model. It excludes rows committed more than an hour after `logged_at`.
- **First run:** the 2026-09-30 run logged 64 signals, 24 of them open.

## Where this leaves the Ronnie line of research

- **His calls:** his published calls (2018-2021, 106 graded trades) and his recent title forecasts (2024-2026) show no
  edge in direction or timing.
- **His exits:** targets are near and stops mostly absent, which turns a zero-edge entry into a loss.
- **His drawings:** his lines, his line intersections, a zone map fitted to his lines, cross-timeframe resonance, and
  filters chosen over 176 combinations all fail on held-out data or on other markets.
- **What survives:** S2b, the large-body breakout, does not depend on his drawings. It holds on crypto only. The blind
  combo-v2 line breaks also hold on crypto only, at +0.09R to +0.14R per trade, and whether the line itself adds anything
  there is still open. As a book, all of them lost in 2025-2026, so `combo/forward.py` now gathers future evidence.
- **Recommendation:** close the drawing-based line.

Trial count so far: roughly 43 variants before the cross-timeframe section. That section added six in-sample variants,
a 36-cell robustness grid, three out-of-sample runs and the nine-pair FX replication. The filter family added 176
trials with one protected test read. Deflate any "winner" accordingly.
