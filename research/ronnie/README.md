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
(space.bilibili.com/489629226). Next: with tradingview.com, *.tradingview.com, bilibili.com, *.bilibili.com,
*.hdslb.com and *.bilivideo.com allowed in the cloud environment's network settings, scrape every Ronnie_Dong idea
(publish time, symbol, timeframe, text, every drawing's type and anchor price/time, snapshot), order revisions of the
same move by time to see how the lines are adjusted, calibrate the R1-R6 rules to his lines, and re-test in-sample only.

Trial count so far: roughly 40 variants on the same BTC data; deflate any new out-of-sample "winner" accordingly.
