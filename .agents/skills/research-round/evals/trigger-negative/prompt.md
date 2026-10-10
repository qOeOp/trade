---
description: Trigger negative — an upstream funding-settlement check on a sealed attempt's report, phrased in research vocabulary, does not invoke the skill and is still answered.
tags: [trigger]
plugins: ["../.."]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在做加密永续策略研究。回测走 Nautilus 原生回放，输入是 5 分钟 K 线、标记价格更新和资金费率更新，资金费由 Nautilus 自己结算。

上周一个 attempt 的候选回测已经封存，决定也已经发布。我回头翻它的原生报告时，看到 BTCUSDT 永续的一笔资金费：

- 持仓：多 0.5 BTC，开仓均价 62,000 USDT，08:00 UTC 结算时仍持有
- 这次结算的资金费率：+0.0100%
- 结算时刻的标记价格：64,000 USDT
- 报告记的资金费：-3.20 USDT

我按开仓价算是 0.5 × 62,000 × 0.01% = 3.10 USDT，所以 Nautilus 多扣了 0.10 USDT。这点差额不影响那个决定，我只是想给 Nautilus 提个 issue，已经写了一半，打算今天提。你帮我确认是它算错了，再讲清楚这笔为什么是负数。
