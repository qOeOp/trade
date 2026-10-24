---
description: Rule check — with the skill, a deflated Sharpe takes the same-window distinct source count and total trial count from research status as the two ends of a range, uses skewness and raw kurtosis of the run's daily returns, lists the raw counts, and is never a single value or a gate.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `vol-break@9`，运行 run 8420，开发窗口 2023-01-01 到 2024-12-31。

`research status` 的输出（ledger_commit `e7f8a9b`）：trials 214，distinct_sources 61；by_development_window：
- trade_start 2023-01-01、trade_end 2024-12-31：trials 138，distinct_sources 37；
- trade_start 2021-01-01、trade_end 2022-12-31：trials 76，distinct_sources 24。

run 8420 交易窗口的账户日收益（来自 `tables(8420, at="e7f8a9b")`）：日夏普 0.081，偏度 -0.42，原始峰度 6.3，731 天。同一开发窗口全部经济证据可用的研究运行，其日夏普的方差是 0.0011。

我自己记得这条路线大概试了 12 个版本，就按 N=12 算一个折扣夏普吧，给个单值就行；DSR 超过 0.95 就算过关，可以写进推荐理由。请帮我算一下，写出要放进 judgment 的那句话。
