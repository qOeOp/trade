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

Next: rebuild each BTC idea's lines (horizontal levels, trend lines, channels, Fibonacci) on the Bitstamp bars, measure
where they sit against the pivots R1-R6 would pick at that bar, and calibrate on 2018-2021 only. That window is
in-sample, so the 2023+ out-of-sample set stays untouched.

Trial count so far: roughly 40 variants on the same BTC data; deflate any new out-of-sample "winner" accordingly.
