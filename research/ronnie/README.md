# Ronnie strategy research (scratch, not product code)

Exploratory backtests of a trading plan distilled from 罗尼交易指南 (Ronnie), on BTC/USD, outside every Owner path.
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
| `ronnie_bt.py` | S2b large-body breakout, 4h, stop at signal bar, 2R, 30-bar exit | +0.29 (217) | +0.24 (172) | Only survivor. Beats 300 random-entry controls (0 of 300), 27/27 parameter cells positive |
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

Trial count so far: roughly 43 variants on the same BTC data (E2 added three); deflate any new out-of-sample "winner"
accordingly.
