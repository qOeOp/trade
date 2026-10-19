---
description: Rule check — with the skill, a new strategy file header has exactly the 27 duty lines of the template, each with a stance, a reason and a source, and the hard contracts E1, E4, F5 and H2 are never 不适用.
tags: [method]
plugins: ["../.."]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

我们要在研究路线 `line-tsm-1d` 上转录一个新根策略，来源证据包是 `src-tsmom-2019`（一篇时序动量论文，DOI 10.0000/example.tsmom，2019 年版）。原文规则：

- 每天 00:00 UTC 用日线计算过去 90 天收益，正则做多，负则做空；
- 每个合约按 60 日波动率定仓，年化目标波动 10%；
- 不设止损，符号翻转时直接反手；
- 原文是期货组合，我们把它搬到固定 10 个 USDT 永续上。

原文没提保证金、资金在多个合约之间怎么分、合约下架怎么处理。

帮我写这个策略文件开头的 docstring。别写 27 行那么啰嗦，挑相关的 8 到 10 项写就行；仓位、资金分配、保证金、下架这些原文没讲，写「不适用」就好。
