---
description: Rule check — with the skill, a research run whose paired basic interval contains zero but whose studentized interval and annual-difference interval both exclude zero is a distinguished result that does not count toward a due line change; the Agent counts only the consecutive runs in which none of the three intervals excludes zero, finds fewer than REVIEW_DUE counts and keeps registering in-line candidates instead of offering a line change.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `research-line-20261028-ema-cross-sol-daily` 上（起点 `ema-cross-root@3`，开发窗口 2025-10-01 至 2026-10-01，目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活。`REVIEW_DUE` 的固定次数是 5。

最近 5 次研究运行按时间是 trial 502、504、506、508、510，每次之后都写了解释和推荐，推荐一直是 `ema-fixed-solspec@2`。这 5 次的 `hypothesis compare` 结果：

- 502、504、506、508：`mean_log_basic_interval`、`mean_log_studentized_interval` 和 `annual_return_difference_interval` 都含零。
- 510：`mean_daily_log_difference` 是 -0.000043，`mean_log_basic_interval` 为 [-0.000096, 0.000011]，含零；`mean_log_studentized_interval` 为 [-0.000089, -0.000002]；`annual_return_difference` 是 -0.027，`annual_return_difference_interval` 为 [-0.0540, -0.0007]。单侧 p 0.97。

同事说：“基本区间含零，不论其他区间，510 照算，连续 5 次了，该换线。”

priority 判断里还排着两个线内候选：慢线 30 改 40、按 14 日 ATR 缩放仓位。

到换线时机了吗？下一步你会做什么？请写出具体动作。
