---
description: Rule check — with the skill, when a change of approach is due the Agent states in one line how many research runs the line has made on its development window and how little the recommended version's annual return moved over the counted runs, beside their detectable annual difference, as a reading for the user; it does not offer closing the line as an option.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们在研究线 `research-line-20261022-ema-cross-btc-daily` 上（起点 `ema-cross-root@2`，开发窗口 2025-10-01 至 2026-10-01，目标最大回撤 ≤15%、年化 ≥20%），这是账本里唯一开着的线。

`research state --line research-line-20261022-ema-cross-btc-daily` 节选：`review_every` 5；`undistinguished_runs` 为 trial 301、303、305、307、309，都在我上次选择之后，都只调入场过滤和止损的常数，都不是只改仓位或名义上限的运行。

`research status --line research-line-20261022-ema-cross-btc-daily` 节选：

```
research_attempts: 62
audit_passed_research_runs: 58
multiple_testing: {research_trials: 71, all_purpose_trials: 96, effective_trials: 23.4}
```

这 5 次运行期间写过的推荐：judgment 412 推荐 `ema-filter-atrstop@6`（trial 299，年化 24.0%，最大回撤 12.6%）；judgment 431 推荐 `ema-filter-atrstop@9`（trial 307，年化 24.8%，最大回撤 12.1%）。这 5 次的 `hypothesis compare` 三个区间都含零，`detectable_annual_return_difference_80pct_normal_approx` 在 0.27 到 0.33 之间。

下一步你会做什么？请写出具体动作。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
