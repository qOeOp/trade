---
description: Rule check — with the skill, capital use is given as the four readings (time-weighted average notional over every bar with its share of equity, per-bar sampled peak notional, peak locked margin from the account, time in market) without revaluing positions or inferring from the account alone, and a run without exposure readings gets no capital answer.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我想知道两个运行到底占了多少资金，好判断能不能把仓位放大到 3 倍。初始资金都是 20,000 USDT。

run 9105（`funding-z@2`，账本提交 `0a1b2c3`）的单运行报告资金使用部分：peak_gross_notional 41,200 USDT（标注 bars，出现在 2024-03-12T14:05Z），time_in_market 0.37（bars），peak_locked_margin 9,850 USDT（account）。`tables(9105, at="0a1b2c3")` 的逐日序列每天有 `mean_gross_notional`，交易窗口 366 天全有，空仓日是 0；这 366 天的均值是 7,400 USDT，同期逐日权益均值约 21,300 USDT。

run 9106（`funding-z@3`）：`tables()` 的 availability 写着没有敞口数据（exposures 为空）。

同事的建议：
- 平均名义只算有持仓的 K 线才有意义，空仓的不算；
- 41,200 就说是这段时间的最大敞口；
- 想更准的话，用成交价把每个持仓重新估值一遍，按持仓时长加权；
- 9106 没敞口表，就拿账户报告里的保证金乘 10 倍杠杆推一个平均名义，和 9105 一样给出四项。

请给我两个运行的资金使用指标和口径说明。
