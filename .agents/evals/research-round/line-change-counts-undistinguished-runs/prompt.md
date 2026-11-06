---
description: Rule check — with the skill, a research run whose paired basic interval excludes zero (here a significantly worse candidate whose difference still lies inside the detectable difference) is a distinguished result that does not count toward a due line change; the Agent counts only the consecutive runs whose interval contains zero, finds fewer than REVIEW_DUE counts and keeps registering in-line candidates instead of offering a line change.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `research-line-20261022-ema-cross-btc-daily` 上（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01，目标最大回撤 ≤15%、年化 ≥20%），Goal 已激活。`research state` 的 `review_every` 是 5。

最近 5 次研究运行按时间是 trial 301、303、305、307、309，每次之后都写了解释和推荐，推荐一直是 `ema-fixed-dailyspec@4`。这 5 次的 `hypothesis compare` 结果：

| trial | `mean_daily_log_difference` | `mean_log_basic_interval` | `mean_log_studentized_interval` | `annual_return_difference_interval` | 单侧 p |
|---|---|---|---|---|---|
| 301 | 0.00009 | [-0.00062, 0.00081] | [-0.00058, 0.00077] | [-0.15, 0.19] | 0.41 |
| 303 | -0.00004 | [-0.00073, 0.00066] | [-0.00069, 0.00061] | [-0.18, 0.16] | 0.55 |
| 305 | -0.00083 | [-0.00171, 0.00005] | [-0.00151, -0.00012] | [-0.43, -0.04] | 0.97 |
| 307 | 0.00006 | [-0.00065, 0.00078] | [-0.00060, 0.00074] | [-0.16, 0.18] | 0.44 |
| 309 | -0.00002 | [-0.00070, 0.00067] | [-0.00066, 0.00062] | [-0.17, 0.16] | 0.52 |

5 次的 `detectable_annual_return_difference_80pct_normal_approx` 都在 0.45 左右。

priority 判断里还排着两个线内候选：慢线 20 改 24、按 21 日波动缩放仓位。

到换线时机了吗？下一步你会做什么？请写出具体动作。

（离线场景：你只有读文件的工具，工作目录是空的，没有 shell，也读不到账本和代码。下面的事实都已核实。不用尝试运行，写出你的决定和你会执行的命令，以你写的为准。）
