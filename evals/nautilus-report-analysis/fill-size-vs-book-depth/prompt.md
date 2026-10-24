---
description: Rule check — with the skill, fills of a quote-execution run are checked against Binance's published bookDepth (the ±1% band on the side each fill hit, last snapshot at or before the fill), the count exceeding the band is reported with the liquidation fills among them, the environment is described as best-price fills without depth, and no fill or price is scaled by the depth.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

run 7312 是报价撮合环境的运行（summary 里 `execution` 为 quotes，账本提交 `5e6f7a8`）。我想知道它的成交规模靠不靠谱，尤其那笔强平。`tables(7312, at="5e6f7a8")` 的 fills：

| client_order_id | side | last_qty | last_px | ts_event |
| --- | --- | ---: | ---: | --- |
| O-20260301-001-BTC-1 | BUY | 2.400 | 71,210.5 | 2026-03-01T08:14:03.120Z |
| O-20260301-001-BTC-2 | SELL | 2.400 | 71,805.0 | 2026-03-01T10:02:41.930Z |
| O-20260301-002-BTC-1 | SELL | 9.800 | 71,790.2 | 2026-03-01T13:30:00.410Z |
| LIQUIDATION-BINANCE-7c1d… | BUY | 9.800 | 73,006.9 | 2026-03-01T15:47:12.055Z |

我已下载并核对了当天 Binance `BTCUSDT-bookDepth-2026-03-01.csv`，同一分钟内的相关快照（只列 ±1 两档，`depth` 为 BTC 数量）：

| timestamp | percentage | depth |
| --- | ---: | ---: |
| 2026-03-01 08:13:58 | -1 | 61.2 |
| 2026-03-01 08:13:58 | 1 | 58.9 |
| 2026-03-01 10:02:04 | -1 | 44.0 |
| 2026-03-01 10:02:04 | 1 | 47.5 |
| 2026-03-01 13:29:51 | -1 | 8.3 |
| 2026-03-01 13:29:51 | 1 | 12.1 |
| 2026-03-01 15:46:59 | -1 | 6.4 |
| 2026-03-01 15:46:59 | 1 | 3.9 |

同事的看法：
- 这些成交都是按最优价成交的，Nautilus 自己会处理深度，不用再查；
- 要是担心，就把超出深度的那笔按 1% 档的量等比例缩小，再把强平价按比例上调，重算结果；
- 强平那笔是交易所强制的，不受深度限制，不用算进去。

请告诉我这些成交的规模对照公开深度怎么样，哪些要标出来，以及这个环境的成交假设是什么。
