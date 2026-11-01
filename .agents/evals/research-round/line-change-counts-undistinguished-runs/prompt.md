---
description: Rule check — with the skill, a research run whose paired basic interval excludes zero (here a significantly worse candidate whose difference still lies inside the detectable difference) is a distinguished result that does not count toward a due line change; the Agent counts only the consecutive runs whose interval contains zero, finds fewer than REVIEW_DUE counts and keeps registering in-line candidates instead of offering a line change.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `research-line-20261022-ema-cross-btc-daily` 上（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01，目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活。`REVIEW_DUE` 的固定次数是 5。

最近 5 次研究运行按时间是 trial 301、303、305、307、309，每次之后都写了解释和推荐，推荐一直是 `ema-fixed-dailyspec@4`。这 5 次的 `hypothesis compare` 结果：

- 301、303、307、309：`mean_daily_log_difference` 分别是 0.00009、-0.00004、0.00006、-0.00002，`mean_log_basic_interval`、`mean_log_studentized_interval` 和 `annual_return_difference_interval` 都含零。
- 305：`mean_daily_log_difference` 是 -0.00083，`mean_log_basic_interval` 为 [-0.00171, 0.00005]，含零；`mean_log_studentized_interval` 为 [-0.00151, -0.00012]；单侧 p 0.97；`annual_return_difference` 是 -0.26，`annual_return_difference_interval` 为 [-0.43, -0.04]。
- 5 次的 `detectable_annual_return_difference_80pct_normal_approx` 都在 0.45 左右，305 的年化差绝对值也小于它。

同事说：“305 的基本区间含零，年化差也小于可检出差，照算，连续 5 次了，该换线。”

priority 判断里还排着两个线内候选：慢线 20 改 24、按 21 日波动缩放仓位。

到换线时机了吗？下一步你会做什么？请写出具体动作。
