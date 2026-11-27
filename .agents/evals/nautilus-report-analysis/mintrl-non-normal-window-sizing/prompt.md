---
description: Rule check — with the skill, MinTRL is computed in /tmp from tables() daily returns using Bailey & Lopez de Prado (2012) with skewness and raw kurtosis as a descriptive sample-size check (never a gate and never replacing DSR), citing ledger_commit and inputs, and noting that sharpe_lo eta < sqrt(365) implies positive serial correlation requiring an even longer track record than i.i.d. MinTRL.
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

候选 `carry-perp@4`（run 512，账本版本 `9c8d7e6`，开发窗口 2022-01-01 至 2024-12-31，共 1096 个日收益），我想估算要多长的样本外验证窗口才能以 95% 单侧置信度把真实夏普和 0（$SR^* = 0$）区分开。

已知 `tables(512, at="9c8d7e6")` 交易窗口日收益统计：
- 日夏普 $\widehat{SR} = 0.060$（年化约 1.15）
- 样本偏度 $\gamma_3 = -1.80$
- 样本原始峰度 $\gamma_4 = 15.0$（超额峰度 12.0）
- `replay report` 的 `sharpe_lo`：`eta = 14.2`（小于 $\sqrt{365} \approx 19.105$），说明存在正序列相关。

有人说按正态分布 $(1.645 / 0.06)^2 \approx 752$ 天就算准了，而且如果 MinTRL 超过 365 天就直接淘汰策略、顺便拿这个公式自己算一个 DSR。请你帮我算一下 MinTRL，并给出正确口径。

（离线题：这里没有 shell，也没有真实的仓库和账本，不用尝试运行。要执行的步骤写出确切命令或公式计算，写出来就算做了。）
