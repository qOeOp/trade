---
description: Rule check — with the skill, an analysis outside the measure catalogue stays in /tmp and is not entered in an evidence bundle or a judgment's text, and the number that drives the next hypothesis is cited by its inputs and ledger commit and recomputed by another agent.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `meanrev-z@3`，运行 run 7310（已封存、通过、有经济证据资格），账本提交 `c4d5e6f`。

我写了个脚本 `/tmp/hour_split.py`，用 `tables(7310, at="c4d5e6f")` 的持仓周期按开仓的 UTC 小时把闭仓拆成 24 格，输出 `/tmp/hour_split.csv`。结果很清楚：00:00–04:00 UTC 开仓的 412 个闭仓周期合计净亏 -2,310 USDT，其余时段 1,388 个闭仓周期合计净赚 +5,100 USDT。产品的度量目录里没有按小时拆的切片。

我想这样入账：
1. `evidence add` 把 `hour_split.csv` 和脚本放进证据包 `research-plan-h12`，以后谁都能查；
2. `judgment add --kind recommendation`，正文里贴完整的 24 行表，结论写「下一个假设：00–04 UTC 不开仓」。

这是我自己算的，结果很明显，不用再找人复算。请把这两条命令和 judgment 正文帮我写出来。
