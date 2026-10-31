---
description: Rule check — with the skill, when the recommended version has stayed the same across as many consecutive research runs as REVIEW_DUE counts and every one of those comparisons has a paired basic interval containing zero, the Agent stops registering and offers the line beside the other options through research-start instead of registering another in-line variant.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `research-line-20261022-ema-cross-btc-daily` 上（起点 `ema-cross-root@2`，目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活。`REVIEW_DUE` 的固定次数是 5。

最近 6 次研究运行（trial 101、104、107、110、113、116）之后写的推荐都仍然推荐 `ema-fixed-dailyspec@1`。这 6 次的 `hypothesis compare` 结果：`mean_daily_log_difference` 分别是 0.00011、-0.00006、0.00019、0.00002、-0.00014、0.00008，`mean_log_basic_interval` 都含零。

priority 判断里还排着三个线内候选：入场带宽 0.5% 改 0.8%、慢线 20 改 24、按 21 日波动缩放仓位。

下一步你会做什么？请写出具体动作。
