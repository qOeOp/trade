# Strategy catalogue of research/ronnie, ranked by usability

A working index for further R&D. Rank is by the strength of evidence, in this order:
1. tiers passed (development, holdout, final, majors slice);
2. sample size and independence;
3. mechanism;
4. forward-record status.

Every interval below comes from a coin-clustered bootstrap that ignores same-day correlation across coins, so all of
them are somewhat too narrow (`loop/RETROSPECTIVE.md`). Edges are R per trade against matched random entries, unless
stated otherwise.

## Tier 1: passed every tier

### 1. Carry K1: conditional cash-and-carry
- **Rule:** long spot and short the perpetual on a coin when its trailing 7-day mean funding is at least 0.01% per 8h;
  close when the 3-day mean turns negative.
- **Evidence:**
  - development (17 majors, 2020-2022): +20.9% a year [+15.7, +26.4];
  - holdout (37 coins, 2023-2026): +5.9% [+4.5, +7.5];
  - final tier (12 never-used coins): PASS.
  - Worst week -0.61%.
- **Limits:**
  - returns per notional; on capital about half;
  - decaying (2025 +1.4%, 2026 +0.2%);
  - no margin or liquidation model.
- **Code:** `carry/run.py`, `carry/final.py`. **Forward:** `carry/forward.py` (daily, estimated funding).
- **Next R&D:**
  - funding-persistence ranking;
  - quarterly-futures basis;
  - capital efficiency (margin use);
  - switching on in funding-rich regimes;
  - pairing with the trend book.

## Tier 2: positive in several independent samples, not significant alone

### 2. Daily trend on majors (T0 / majors_trend) and the Donchian ensemble book (B3)
- **Rule:** buy on a daily close above the prior 50-day closing high; stop at 2 ATR(20); exit on a daily close below the
  20-day closing low; long only.
- **Evidence:**
  - development: +1.00R a trade, +0.43R over random;
  - holdout of 20 new coins: +0.12R [-0.09, +0.38];
  - 17 majors 2023-2026: +0.33R a trade;
  - book of the 17 majors 2018-2026: CAGR +53.7%, maximum drawdown -39.5%, Sharpe 1.26 (survivors);
  - gold 2019-2026: holds on 16 trades.
- **Limits:**
  - much of the gain comes from the exit and the regime, not the entry timing;
  - survivorship;
  - 2021 carries the total.
- **B3, the Donchian ensemble (loops T-1, T-2):** lookbacks 5-360 days, a midpoint trailing stop, 25% volatility
  target per coin.
  - 17 majors 2018-2022: Sharpe 1.45 against 1.04 for the 200-day regime book; difference +0.46 [+0.10, +0.80]; max DD
    -7.6%.
  - Point-in-time top 20 (70 symbols, delistings included): Sharpe 0.98 against 0.56; difference +0.40 [+0.05, +0.75].
  - Validation read 2023-2026: FAIL (edge positive, interval spans zero).
- **Code:** `trend/run.py`, `trend/portfolio.py`, `trend/books.py`, `trend/books_pit.py`,
  `crates/strategy_factory/programs/majors_trend`. **Forward:** `trend/forward.py` (T0), `trend/forward_b3.py` (B3, from
  2026-10-01).
- **Next R&D:**
  - the forward record of B3;
  - adding gold;
  - funding as a crowding gate is closed (X-2: the flag fired twice in 2021, both before rallies).

### 3. 4h box breakout (range-v3 X1 / loop D-1) and its retest entry (G-2)
- **Rule:**
  - a 4h close beyond a 60-bar box;
  - entry at the next open;
  - stop at the box middle;
  - target one box width;
  - 30 bars.
- **Evidence (X1):**
  - development: +0.31;
  - 14 unused coins: +0.18;
  - 37 large caps: +0.13;
  - final tier: +0.23 (fails at 97.5%);
  - majors 2023-2026: positive, interval spans zero.
  - Not beta; shorts carry more than longs; no ablation improves it.
- **G-2 (limit at the broken edge, 12 bars):**
  - extended iteration tier: +0.25 [+0.07, +0.43];
  - per unit of price, the same as the market entry;
  - per unit of risk, better;
  - reserve tier: FAIL; majors: positive, spans zero.
- **Lookback check (D-2):** the edge is a plateau from 60 to 120 bars (+0.19, +0.17) that falls at 30 (+0.10) and 240
  (-0.01). The registered fragility test failed narrowly, so the stated edge is cut to the pooled +0.14 [+0.03, +0.26]
  (week-clustered, iteration).
- **Conditioning (S-0 to S-2):** the session window, open-interest change, taker flow and a funding veto add nothing.
- **Code:** `range3/run.py`, `loop/family_d.py`, `loop/family_g.py`. **Forward:** `box_break` (G-2 cannot be tracked:
  limit orders).
- **Next R&D:**
  - forward support for limit orders;
  - an ensemble with trend-line breaks;
  - checking the clustered intervals.

### 4. Trend-line strong break (combo-v2 trendline_break_strong / loop F-1, F-2)
- **Rule:**
  - the line through the last two 4h swing pivots of order 8;
  - the first close beyond it by a bar with a body of at least 1 ATR that closes in its outer 30%;
  - stop at the bar's opposite extreme.
- **Evidence:**
  - iteration tier: +0.23 [+0.11, +0.35] on 994 trades;
  - with a time-only exit (F-2): +0.32 [+0.13, +0.56];
  - not beta; longs carry more than shorts;
  - reserve tier: FAIL; majors 2023-2026: positive, spans zero;
  - the combo book lost in 2025-2026.
- **Code:** `combo/candidates/trendline_break_strong.py`, `combo/candidates/trendline_time.py`. **Forward:**
  `trendline`, `trendline_time`.
- **Line quality (F-3):** span, slope, age, pivot gap and body carry no reliable information (all |t| < 1.4). Closed.
- **Next R&D:**
  - long-only;
  - its place in the ensemble book (item 7).

### 5. Capitulation reversal (oversold O3 and its idiosyncratic variant C-6)
- **Rule (O3):** a 3-day drop of 15% or more, at least 2.5x volume, and a close in the upper half; long; stop at the low
  minus 0.5 ATR; target half way back; 10 days.
- **Rule (C-6):** the same, with the drop measured against BTC (coin minus BTC over 1-5 days, at most -15%).
- **Evidence:**
  - O3 holdout: +0.62 [+0.27, +0.93] on 30 trades;
  - C-6 extended iteration tier: +0.58 [+0.30, +0.85] on 30 trades, stop rate 7%;
  - C-6 final tier: 7 trades, +0.15;
  - majors 2023-2026: positive, spans zero.
  - The mechanism is diagnosed: a market-wide crash continues, an idiosyncratic crash reverts (Da, Liu and Schaumburg,
    2014).
- **Limits:** rare (about 30 signals in five years on 50 coins).
- **Code:** `oversold/run.py`, `loop/family_c.py`. **Forward:** `oversold_o3`, `oversold_idio`.
- **Variants (C-7, C-8):** a beta-adjusted residual picks 26 of the same 29 events (+0.67, noise against C-6). A 4h
  definition gives 632 trades at +0.07, which dilutes the event.
- **Next R&D:**
  - a broader universe (post-2022 listings) on the daily definition for power;
  - open-interest flush data exists only from 2021-12 for alts.

### 6. B1, the 4h large-body breakout (S2b), and its time-only exit
- **Evidence:**
  - setups-v1 crypto in-sample: +0.22 [+0.10, +0.34];
  - out of sample: +0.13 [+0.02, +0.25];
  - combo-v2: about +0.06R over random on unseen sets;
  - time-only exit (exit-v1 X4): development +0.17 (significant), holdout +0.07.
  - The book lost in 2025-2026.
- **Code:** `ronnie_bt.py`, `combo/portfolio.py`, `exits/run.py`. **Forward:** `B1`, `b1_time`.
- **Next R&D:**
  - the time exit as default;
  - an ensemble with items 3 and 4.

### 7. The ensemble book of the timing rules (loops N-1 to N-4)
- **Rule:** B3, D-1, F-2 and C-6 weekly streams, each scaled to equal risk by trailing 26-week volatility, equal
  weights, no fitted parameters.
- **Evidence:**
  - effective N of the five candidate rules (with K1): 4.2; mean bear-year correlation of the timing rules +0.05;
  - 2018-07 to 2022: Sharpe 2.04 against the best single rule (F-2) at 1.71; difference +0.34 [-0.54, +1.11]; max DD
    -6.7% at 10% volatility, against -18.1% for buy-and-hold;
  - PBO over 32 construction variants: 0.29;
  - one read on the majors slice 2023-2026 (N-4): against cash and against buy-and-hold, both FAIL (edge positive,
    interval spans zero) at 97.5%.
- **Limits:** the single-rule streams are in-sample, trades are booked in their entry week (drawdowns understated),
  and K1 correlates +0.63 with B3 outside crashes.
- **Code:** `loop/ensemble.py`, `loop/gatekeeper_book.py`.

## Tier 3: weak, narrow or descriptive

- **Gold long trend (goldtrend-v1):** holds on 2019-2026, but on 16 trades with 2025 dominant. Not in the forward record.
- **line_break_ridge (combo-v2 ridge):** positive per trade in early tests, but its book's maximum drawdown is -79%; in
  the forward record only as a comparison.
- **Weekly support bounce with confirmation and low volatility (loop A8):** +0.41 on 51 trades, a near miss. The
  earlier claim that it resolved on wider data was wrong; the A8x retest on 36 new coins gives -0.23 [-0.52, +0.06],
  so it is closed on evidence.

## Family status under `loop/CRITERIA.md` (replaces the old "falsified" list)

Every status names the buckets it covers (CRITERIA section C); an untested bucket is untested, not closed.
Statuses: **active** (on the acceptance ladder), **parked** (inconclusive, under-powered), **absorbed** (carried by
another line), **immaterial**, and **closed**, which needs equivalence or a falsified mechanism. Evidence: the loop
closure audit (`loop/closure_audit.txt`, week-clustered, SESOI +0.10R) and the pre-loop family audit (LOG,
"Pre-loop closure audit").

| family | status | evidence for the status |
| --- | --- | --- |
| Carry K1 | active, stage 3 (forward) | passed development, holdout and final; at its forward kill line |
| Carry K1b, K1p | closed (as variants) | K1p -9.4% a year against K1 [-11.1, -7.7]; K1b no gain |
| Carry K2 | closed | holdout -3.3% a year [-4.1, -2.6] |
| Carry P1 (funding crowding) | parked, low | holdout +1.4% [-0.3, +3.2] |
| Trend B3 book, T0 | active, stage 3 | T-1 and T-2 positive; validation positive, spans zero; cross-asset (X-3, 21 instruments 2008-2026) positive, spans zero |
| Box break D-1 | active, stage 3 | holdout and majors positive, spans zero; the lookback plateau cuts the edge to +0.14 |
| Box retest G-2 | absorbed into D-1 | correlation with D-1 +0.39 (+0.61 in bear years) |
| Trend-line break F-1/F-2 | active, stage 3 | reserve fail, majors positive, spans zero; pooled over 69 holdout coins (P-1): F-1 interval above zero, t below 3; decay diagnosis D-R: within-regime decay -0.23 [-0.45, -0.02] after 2022 |
| Capitulation O3/C-6 | active but power-capped (parked for proof) | iteration +0.58; final 7 trades; new coins give no events (C-6u) |
| Pure crash O1 | parked, lowest | R-2 pooled -0.055 [-0.21, +0.103] |
| B1 4h momentum | active, stage 3 | 15 unseen coins +0.104 [+0.048, +0.159]; at SESOI |
| Ensemble book T | active, stage 3 | N-4 positive, spans zero, against cash and buy-and-hold |
| Gold long trend | parked | 16 trades |
| line_break_ridge | parked | +0.086, upper +0.124; its book's drawdown is -79% |
| Break continuation over random (family B) | absorbed into the trend book (round-number breaks closed in daily FX: B-9fx -0.13) | B-5x new coins +0.056 [-0.43, +0.56]; the return is trend exposure |
| Support bounces (family A) | closed: crypto majors and mid caps, daily FX; intraday FX untested | A1-A4 harmful; A12 equivalent-null on 1,189 trades; A8x new coins upper +0.06; A3fx -0.12, A12fx -0.14 |
| Range and box fades (range v1-v6, rangex, family E) | closed: crypto majors and mid caps; small caps untested | E-1x harmful, E-4 equivalent-null, range-v2 L harmful; small inconclusive variants superseded |
| Fading breaks G-1 | closed | -0.38 [-0.60, -0.12] |
| Flags F-raw | closed | R-1 new coins -0.128 [-0.25, +0.01] |
| Wedges and triangles (patterns-v1) | closed | W-raw and W-retest equivalent-null |
| MTF alignment | closed | M1 and M3 equivalent-null, M2 harmful |
| Shorts (short-v1) | closed | S1, S2, S4 harmful; S0 equivalent-null |
| Volume confirmation, volume nodes | closed | volume C holdout +0.015 [-0.016, +0.047]; nodes harmful or equivalent-null |
| Filters (v1, v2), stops, entry timeframe | closed | all equivalent-null; filters-v2 F4 parked, low |
| Exits other than the time exit | closed | harmful or equivalent-null; the time exit is active in F-2 and B1 |
| Pairs (family H) | closed at bar horizons of 1h and above; parked intraday | 4h and daily net returns below zero; intraday needs an execution simulator |
| Cross-sectional funding X-1 | parked, low | holdout verdict "edge at or below zero" carries no upper bound, so equivalence is unproven |
| Funding-extreme overlay X-2 | parked | 2 episodes |
| Breakout conditioning S-0, S-1 | parked, low | small splits, wide intervals |
| Breakout funding veto S-2 | immaterial | touches 2% of trades |
| Line quality F-3 | closed (as a filter) | span Q5-Q1 upper +0.12 against a predicted positive effect; no reliable feature |
| Community lines | parked, low | held-minus-moved spans zero, no information |
| FX reversion (fxrevert) | parked, out of scope | M1 +0.094 on FX |
| Ronnie's own calls and lines (early descriptive studies) | not audited | descriptive studies without a random-entry interval; a low prior |

## Cross-cutting next steps

1. Done: survivors re-read with a date-clustered bootstrap; breakout lineages unchanged, capitulation wider.
2. Done in part: the ensemble book (item 7); next a forward record of the frozen book.
3. Give each forward candidate a decision date and admit/kill criteria; run the 4h scripts every 4h.
4. Build a point-in-time universe, and a data layer for OI, liquidations and basis.
