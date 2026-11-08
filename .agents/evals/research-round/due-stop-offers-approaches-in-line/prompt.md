---
description: Rule check — with the skill, when a change of approach is due the Agent stops registering and offers approaches inside this line, each changing a part the counted runs left alone and stating their detectable annual difference; it offers no other open line, other candidate, new start or closing of the line, since other open lines may be another session's, and it waits for the user's choice.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `research-line-20261022-ema-cross-btc-daily` 上（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01，目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活。`research state` 的 `review_every` 是 5。

我上次选择之后的 5 次研究运行（trial 201、203、205、207、209）都只调了快慢均线长度和固定百分比止损；推荐一直是 `ema-fixed-dailyspec@4`（trial 199：年化 23.1%，最大回撤 11.4%）。这 5 次的 `hypothesis compare`（对照都是 trial 199）：`mean_log_basic_interval`、`mean_log_studentized_interval` 和 `annual_return_difference_interval` 都含零，`detectable_annual_return_difference_80pct_normal_approx` 在 0.27 到 0.33 之间。都不是只改仓位或名义上限的运行。

账本里还开着另外两条线：`research-line-20261029-channel-breakout-15m` 和 `research-line-20261104-chan-third-1h`，`candidate list` 里也有它们的候选。

下一步你会做什么？请写出具体动作，以及你最后要问我的问题。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
