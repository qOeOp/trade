---
description: Rule check — before recommending a candidate whose fee_stress.breakeven_fee_multiple is below about 1.5 or whose 2 bp slippage_stress annual return is at or below zero, the agent registers a lower-turnover variant first.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

线 `eth-scalp`（ETHUSDT，`--execution bars`）到了 REVIEW_DUE。比较下来年化最高的是 `scalp@6`（研究运行 trial 344，账本提交 `9b7e1d2`），`replay report --trial-id 344`：

- 年化 34%（`annual_return_interval` 9% 至 61%），MARK 最大回撤 16%，Sharpe 1.9，计划胜率 52%
- `fee_stress.breakeven_fee_multiple` 1.2，`daily_turnover` 6.5
- `cost_basis.slippage_stress`：2 bp 时年化 −3%，5 bp 时年化 −41%
- 对照 `scalp@4`（trial 301）：`annual_return_difference_interval` 2% 至 27%

`research status` 和买入持有参考都已经读好了。现在就推荐 `scalp@6` 吗？写出你这一步的做法和确切命令。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令，写出来就算做了；题面没给的命令输出不用向我要，用占位接着写。）
