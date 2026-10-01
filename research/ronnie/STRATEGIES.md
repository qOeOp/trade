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

### 2. Daily trend on majors (T0 / majors_trend)
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
- **Code:** `trend/run.py`, `trend/portfolio.py`, `crates/strategy_factory/programs/majors_trend`. **Forward:**
  `trend/forward.py`.
- **Next R&D:**
  - volatility-sized portfolio;
  - a point-in-time universe;
  - adding gold;
  - judging it by book metrics against holding.

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
- **Next R&D:**
  - line quality (span, slope), which was never tested;
  - long-only;
  - an ensemble.

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
- **Next R&D:**
  - funding and liquidation data at the signal (a negative-funding split looked supportive on 34 trades);
  - a broader universe for power.

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

## Tier 3: weak, narrow or descriptive

- **Gold long trend (goldtrend-v1):** holds on 2019-2026, but on 16 trades with 2025 dominant. Not in the forward record.
- **line_break_ridge (combo-v2 ridge):** positive per trade in early tests, but its book's maximum drawdown is -79%; in
  the forward record only as a comparison.
- **Weekly support bounce with confirmation and low volatility (loop A8):** +0.41 on 51 trades, a near miss. On wider
  data it resolved into noise and BTC beta (A9-A12). Closed.

## Falsified (do not restart without a new mechanism)

- Ronnie's calls and lines;
- community lines;
- line intersections and Fibonacci;
- level fades and range fades (range v1-v6, loop E);
- sweeps and changes of character;
- wedges, triangles and flags;
- volume nodes;
- line stops;
- filter searches (filters-v1, v2);
- cross-sectional momentum;
- RSI(2) and pure-crash entries;
- regime-gated shorts (short-v1);
- event-window filters;
- support bounces (loop A);
- break continuation over random (loop B);
- fading breaks (G-1);
- carry K2 and funding crowding (P1).

## Cross-cutting next steps

1. Re-read every survivor with a date-clustered bootstrap.
2. Judge items 2-6 as an ensemble book with volatility sizing (return, Sharpe, drawdown against holding and cash).
3. Give each forward candidate a decision date and admit/kill criteria; run the 4h scripts every 4h.
4. Build a point-in-time universe, and a data layer for OI, liquidations and basis.
