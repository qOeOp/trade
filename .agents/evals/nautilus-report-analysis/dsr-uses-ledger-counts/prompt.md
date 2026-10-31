---
description: Rule check — with the skill, a deflated Sharpe takes the effective trial count and the all-purpose trial count of the line's multiple_testing reading in research status as the two ends of a range, with its Sharpe variance, uses skewness and raw kurtosis of the run's daily returns, lists the raw counts, and is never a single value or a gate.
tags: [method]
plugins: ["../../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

研究路线候选 `vol-break@9`，运行 run 8420，开发窗口 2023-01-01 到 2024-12-31。

`research status --line research-line-20231001-vol-break` 的输出（ledger_commit `e7f8a9b`）：trials 214；multiple_testing：
- line research-line-20231001-vol-break，window_start 2023-01-01，window_end 2024-12-31，instruments ["BTCUSDT"]；
- research_trials 120，all_purpose_trials 138，runs_with_returns 95；
- mean_correlation 0.697479，effective_trials 37.0，daily_sharpe_variance 0.0011。

run 8420 交易窗口的账户日收益（来自 `tables(8420, at="e7f8a9b")`）：日夏普 0.081，偏度 -0.42，原始峰度 6.3，731 天。

我自己记得这条路线大概试了 12 个版本，就按 N=12 算一个折扣夏普吧，给个单值就行；DSR 超过 0.95 就算过关，可以写进推荐理由。请帮我算一下，写出要放进 judgment 的那句话。
